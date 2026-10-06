//! Les groupes de l'écran Doublons (`docs/ui-specs/doublons.md`, validée le 2026-10-05).
//!
//! Trois relations relient deux copies, c'est-à-dire deux pistes `pending` ou `filed` :
//! - la même **clé de nom** : artiste + titre + version, noms sales nettoyés ;
//! - le même **contenu** : même taille, et mêmes octets au début, au milieu et à la fin du
//!   fichier (`empreinte_contenu`). Comparer les fichiers en entier coûterait plus de 10 Go de
//!   lecture à la première ouverture : la vraie bibliothèque compte 132 groupes identiques, de
//!   copies lossless pour la plupart (mesure du 2026-10-04) ;
//! - des **empreintes concordantes** : les arêtes `dup_edges` du scan acoustique.
//!
//! Un groupe est une composante connexe de leur union, moins les paires que l'utilisateur a
//! refusées (« Ce ne sont pas des doublons », table `dup_refused`, migration v27).
//!
//! Découpage, même forme que `dedup` : `charger_*` lisent la base sous un verrou COURT tenu par
//! l'appelant ; `former_groupes` et `assembler` sont purs ; les lectures de fichiers
//! (`echantillonner`, l'existence des copies) se font verrou relâché, hors du fil de la fenêtre
//! (`ipc_doublons::list_duplicate_groups`).

use crate::analysis::{tags::rail_from_ext, Rail};
use crate::naming;
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Écart de durée au-delà duquel deux copies de même nom ne sont plus présumées le même
/// enregistrement. Une copie MP3 et sa source diffèrent de quelques dizaines de millisecondes
/// (délai et remplissage de l'encodeur) : 0,1 s les couvre. Au-delà, sans preuve plus forte, le
/// groupe est « À vérifier » et sort du plan (spec § Ce qui forme un groupe). La spec écrivait
/// « plus de 2 s » pour À vérifier et « à 0,1 s près » pour le geste de masse ; la bande entre
/// les deux (4 groupes sur 304, mesure du 2026-10-04) va du côté prudent.
const TOLERANCE_DUREE_S: f64 = 0.1;

/// Taille de chacune des trois fenêtres lues par `empreinte_contenu`.
const FENETRE_OCTETS: u64 = 64 * 1024;

/// Ce qui fonde un groupe, du plus faible au plus fort : l'ordre des variantes EST l'ordre de
/// force (`Ord` dérivé), la preuve d'un groupe est le maximum de ses liens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DupProof {
    SameName,
    SameSound,
    Identical,
}

/// Ce que Rekordbox sait d'une copie. Jamais « absente » sans l'avoir lu :
/// - `Unknown` : aucune source lisible, ou l'intégration Rekordbox n'est pas activée ;
/// - `Unverified` : la source lue ne contient pas la copie, mais elle peut taire une piste jouée
///   (`ipc_doublons::usage_rekordbox`). La copie n'est pas gardée d'office ; la confirmation
///   AVERTIT (décision d'Antoine, 2026-10-05).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RekordboxUse {
    Unknown,
    Absent,
    Present { playlists: u32 },
    Unverified { reason: RekordboxDoubt },
}

/// Pourquoi une source ne peut pas affirmer qu'une copie est absente de Rekordbox. Miroir :
/// `RekordboxDoubt` de `shared/contracts.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RekordboxDoubt {
    /// Rekordbox est ouvert (`master.db-wal` non vide) : ses derniers imports ne sont pas lus.
    RekordboxOpen,
    /// `master.db` ne se lit pas, le XML lié a servi : un instantané d'export.
    XmlSnapshot,
}

/// Une copie, telle que l'écran l'affiche. Miroir : `DupScreenCopy` de `shared/contracts.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupScreenCopy {
    pub id: i64,
    pub path: String,
    pub status: String,
    pub source_id: Option<i64>,
    pub verdict: Option<String>,
    pub cutoff_hz: Option<f64>,
    /// Extension réelle du fichier, en minuscules.
    pub format: String,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub duration: Option<f64>,
    pub size_bytes: Option<i64>,
    pub truncated: bool,
    /// Le fichier n'est plus sur le disque : jamais gardé, jamais envoyé.
    pub missing: bool,
    /// La règle peut la garder : présente, et entière — sauf quand toutes les copies présentes du
    /// groupe sont tronquées, où la troncature ne départage plus rien (tranché le 2026-10-06).
    pub keepable: bool,
    pub discogs_release_id: Option<String>,
    pub year: Option<i64>,
    pub rekordbox: RekordboxUse,
    /// Cochée par défaut : la meilleure selon la règle, plus les copies que Rekordbox joue.
    pub keep: bool,
    /// À égalité de qualité avec la meilleure : seuls les départages (dossier, extension, âge)
    /// les séparent. C'est là que « Préférer ce dossier » a le droit de recocher.
    pub tied_with_best: bool,
    pub name_key: String,
}

/// Un lien plus fort que le nom entre deux copies d'un groupe. Les liens de nom ne voyagent pas :
/// deux copies de même `name_key` sont liées par le nom.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupScreenLink {
    pub a: i64,
    pub b: i64,
    pub kind: DupProof,
    pub similarity: Option<f32>,
}

/// Un groupe de l'écran. Miroir : `DupScreenGroup` de `shared/contracts.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupScreenGroup {
    /// Plus petit id de piste du groupe : stable tant que ce membre reste.
    pub id: i64,
    pub artist: Option<String>,
    pub title: String,
    pub version: Option<String>,
    pub proof: DupProof,
    /// Hors du plan : durées écartées sans preuve plus forte, ou aucune copie gardable.
    pub to_check: bool,
    /// Écart entre la plus longue et la plus courte des copies non tronquées.
    pub duration_spread: Option<f64>,
    /// La meilleure d'abord, puis l'ordre de la règle.
    pub copies: Vec<DupScreenCopy>,
    pub links: Vec<DupScreenLink>,
}

/// Une piste candidate, telle que la base la connaît.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Ligne {
    pub id: i64,
    pub path: String,
    pub status: String,
    pub source_id: Option<i64>,
    pub verdict: Option<String>,
    pub cutoff_hz: Option<f64>,
    pub bitrate: Option<i64>,
    pub duration: Option<f64>,
    pub size_bytes: Option<i64>,
    pub mtime: Option<i64>,
    pub truncated: bool,
    pub discogs_release_id: Option<String>,
    pub year: Option<i64>,
}

/// Toutes les pistes `pending` et `filed`. Lecture brève, sous le verrou de l'appelant. Le
/// `report_json` (≈ 39 ko par piste) n'est PAS lu ici : sa fréquence d'échantillonnage se lit
/// pour les seuls membres des groupes (`charger_frequences`).
pub(crate) fn charger_lignes(conn: &Connection) -> rusqlite::Result<Vec<Ligne>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.status, t.source_id, t.verdict, t.cutoff_hz, t.bitrate, \
                t.duration, t.size_bytes, t.mtime, t.truncated, m.discogs_release_id, m.year \
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id \
         WHERE t.status IN ('pending','filed')",
    )?;
    let lignes = stmt
        .query_map([], |r| {
            Ok(Ligne {
                id: r.get(0)?,
                path: r.get(1)?,
                status: r.get(2)?,
                source_id: r.get(3)?,
                verdict: r.get(4)?,
                cutoff_hz: r.get(5)?,
                bitrate: r.get(6)?,
                duration: r.get(7)?,
                size_bytes: r.get(8)?,
                mtime: r.get(9)?,
                truncated: r.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
                discogs_release_id: r.get(11)?,
                year: r.get(12)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(lignes)
}

/// Les arêtes du scan acoustique : `(a, b, similarité)`.
pub(crate) fn charger_aretes_son(conn: &Connection) -> rusqlite::Result<Vec<(i64, i64, f32)>> {
    // Seulement entre deux pistes qui ont ENCORE leur empreinte : un fichier modifié depuis le scan
    // acoustique perd la sienne (`scanner::upsert_file`), et l'arête calculée sur l'ancien contenu
    // ne prouve plus rien. Plus rien ne recalcule les arêtes depuis que Rangés a perdu son mode
    // Doublons : « Même son » vit sur celles déjà calculées, la comparaison au son en tâche de fond
    // est hors de la 0.1.4 (`docs/ui-specs/doublons.md`).
    let mut stmt = conn.prepare(
        "SELECT e.a_id, e.b_id, e.similarity FROM dup_edges e
         JOIN tracks a ON a.id = e.a_id AND a.fingerprint IS NOT NULL AND a.fingerprint <> ''
         JOIN tracks b ON b.id = e.b_id AND b.fingerprint IS NOT NULL AND b.fingerprint <> ''",
    )?;
    let aretes = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get::<_, f64>(2)? as f32))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(aretes)
}

/// Les paires refusées par « Ce ne sont pas des doublons », normalisées `a < b`.
pub(crate) fn charger_refus(conn: &Connection) -> rusqlite::Result<HashSet<(i64, i64)>> {
    let mut stmt = conn.prepare("SELECT a_id, b_id FROM dup_refused")?;
    let refus = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(refus)
}

/// Fréquence d'échantillonnage lue dans le rapport, pour les seules pistes `ids`. Par paquets de
/// 500 paramètres liés (plafond SQLite). `CASE WHEN json_valid()` : un rapport illisible rend
/// `NULL`, jamais une erreur qui viderait l'écran.
pub(crate) fn charger_frequences(
    conn: &Connection,
    ids: &[i64],
) -> rusqlite::Result<HashMap<i64, i64>> {
    let mut frequences = HashMap::new();
    for paquet in ids.chunks(500) {
        let marques = vec!["?"; paquet.len()].join(",");
        let sql = format!(
            "SELECT id, CASE WHEN json_valid(report_json) \
                        THEN CAST(json_extract(report_json, '$.sample_rate') AS INTEGER) END \
             FROM tracks WHERE id IN ({marques})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let lignes = stmt.query_map(params_from_iter(paquet.iter()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?))
        })?;
        for ligne in lignes {
            let (id, frequence) = ligne?;
            if let Some(f) = frequence {
                frequences.insert(id, f);
            }
        }
    }
    Ok(frequences)
}

/// Extension réelle du fichier, en minuscules (`""` sans extension).
fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn radical(path: &str) -> &str {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
}

/// La clé de nom d'une copie : `naming::group_key` sur son radical — artiste, titre et version
/// d'un nom nettoyé de ses salissures (numéro de piste, URL, suffixe de copie…). Une version
/// différente donne une clé différente (sur la vraie base, 36 groupes mêlaient des remixes quand
/// la version était ignorée), sauf « Original Mix », qui vaut absence de version. Une clé vide ne
/// relie rien : `group_key` rend `None` pour un nom qui ne nomme rien (« Track 01 »,
/// « Untitled »), et deux tels noms ne se réunissent jamais.
pub(crate) fn cle_de_nom(path: &str) -> String {
    naming::group_key(radical(path)).unwrap_or_default()
}

/// FNV-1a sur 64 bits : une somme déterministe, la même d'une version de Rust à l'autre
/// (`DefaultHasher` ne le promet pas), sans dépendance.
struct Fnv64(u64);

impl Fnv64 {
    fn new() -> Self {
        Fnv64(0xcbf2_9ce4_8422_2325)
    }
    fn update(&mut self, octets: &[u8]) {
        for &o in octets {
            self.0 ^= u64::from(o);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

/// Somme de trois fenêtres de 64 ko — début, milieu, fin — et de la taille. Deux fichiers de
/// même taille et de même somme sont tenus pour identiques : les en-têtes, les étiquettes (en
/// tête ou en queue) et l'audio des trois endroits concordent. Ce n'est PAS une comparaison
/// intégrale, et la spec le dit (§ Ce qui forme un groupe) : celle-ci coûterait plus de 10 Go à
/// la première ouverture, et rien n'est détruit avant « Vider la corbeille ».
pub(crate) fn empreinte_contenu(path: &Path, taille: u64) -> std::io::Result<u64> {
    let mut fichier = std::fs::File::open(path)?;
    let mut somme = Fnv64::new();
    somme.update(&taille.to_le_bytes());
    let milieu = (taille / 2).saturating_sub(FENETRE_OCTETS / 2);
    let fin = taille.saturating_sub(FENETRE_OCTETS);
    let mut tampon = Vec::with_capacity(FENETRE_OCTETS as usize);
    for debut in [0, milieu, fin] {
        fichier.seek(SeekFrom::Start(debut))?;
        tampon.clear();
        (&mut fichier)
            .take(FENETRE_OCTETS)
            .read_to_end(&mut tampon)?;
        somme.update(&tampon);
    }
    Ok(somme.0)
}

/// Sommes déjà calculées pendant la vie du processus : id → (taille, mtime, somme). Une
/// piste dont la taille ou la date changent se relit.
type CacheSommes = Mutex<HashMap<i64, (i64, Option<i64>, u64)>>;

fn cache_sommes() -> &'static CacheSommes {
    static CACHE: OnceLock<CacheSommes> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Les sommes de contenu des seules pistes qui partagent leur taille avec une autre : elles
/// seules peuvent être identiques. Lit des fichiers : appeler verrou de la base relâché. Un
/// fichier illisible n'a pas de somme, donc pas de lien d'identité, et le dit au journal.
pub(crate) fn echantillonner(lignes: &[Ligne]) -> HashMap<i64, u64> {
    let mut par_taille: HashMap<i64, Vec<&Ligne>> = HashMap::new();
    for l in lignes {
        if let Some(t) = l.size_bytes.filter(|t| *t > 0) {
            par_taille.entry(t).or_default().push(l);
        }
    }
    let mut sommes = HashMap::new();
    for (taille, membres) in par_taille {
        if membres.len() < 2 {
            continue;
        }
        for l in membres {
            if let Some(s) = somme_en_cache(l.id, taille, l.mtime) {
                sommes.insert(l.id, s);
                continue;
            }
            match empreinte_contenu(Path::new(&l.path), taille as u64) {
                Ok(s) => {
                    mettre_en_cache(l.id, taille, l.mtime, s);
                    sommes.insert(l.id, s);
                }
                Err(e) => log::warn!("doublons : contenu illisible ({}) : {e}", l.path),
            }
        }
    }
    sommes
}

fn somme_en_cache(id: i64, taille: i64, mtime: Option<i64>) -> Option<u64> {
    match cache_sommes().lock() {
        Ok(cache) => cache
            .get(&id)
            .filter(|(t, m, _)| *t == taille && *m == mtime)
            .map(|(_, _, s)| *s),
        Err(_) => {
            log::error!("doublons : cache des sommes empoisonné, relecture des fichiers");
            None
        }
    }
}

fn mettre_en_cache(id: i64, taille: i64, mtime: Option<i64>, somme: u64) {
    match cache_sommes().lock() {
        Ok(mut cache) => {
            cache.insert(id, (taille, mtime, somme));
        }
        Err(_) => log::error!("doublons : cache des sommes empoisonné, somme non retenue"),
    }
}

/// Un lien entre deux copies, par indices dans les lignes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Lien {
    pub a: usize,
    pub b: usize,
    pub kind: DupProof,
    pub similarity: Option<f32>,
}

/// Un groupe avant assemblage : indices de ses membres dans les lignes, et ses liens.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GroupeBrut {
    pub membres: Vec<usize>,
    pub liens: Vec<Lien>,
}

fn racine(parent: &mut [usize], x: usize) -> usize {
    let mut r = x;
    while parent[r] != r {
        r = parent[r];
    }
    let mut y = x;
    while parent[y] != r {
        let suivant = parent[y];
        parent[y] = r;
        y = suivant;
    }
    r
}

/// Ajoute un lien pour chaque paire d'un paquet de copies qui partagent une même relation.
fn lier_paquet(paquet: &[usize], kind: DupProof, liens: &mut Vec<Lien>) {
    for (i, &a) in paquet.iter().enumerate() {
        for &b in &paquet[i + 1..] {
            liens.push(Lien {
                a,
                b,
                kind,
                similarity: None,
            });
        }
    }
}

/// Les groupes : composantes connexes de l'union des trois relations, moins les paires
/// refusées. Pur. `cles[i]` est la clé de nom de `lignes[i]` (vide : aucun lien de nom) ;
/// `sommes` ne contient que les pistes échantillonnées.
pub(crate) fn former_groupes(
    lignes: &[Ligne],
    cles: &[String],
    sommes: &HashMap<i64, u64>,
    aretes_son: &[(i64, i64, f32)],
    refus: &HashSet<(i64, i64)>,
) -> Vec<GroupeBrut> {
    let index: HashMap<i64, usize> = lignes.iter().enumerate().map(|(i, l)| (l.id, i)).collect();
    let mut liens = Vec::new();

    let mut par_cle: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, cle) in cles.iter().enumerate() {
        if !cle.is_empty() {
            par_cle.entry(cle.as_str()).or_default().push(i);
        }
    }
    for paquet in par_cle.values().filter(|p| p.len() >= 2) {
        lier_paquet(paquet, DupProof::SameName, &mut liens);
    }

    let mut par_contenu: HashMap<(i64, u64), Vec<usize>> = HashMap::new();
    for (i, l) in lignes.iter().enumerate() {
        if let (Some(taille), Some(somme)) = (l.size_bytes, sommes.get(&l.id)) {
            par_contenu.entry((taille, *somme)).or_default().push(i);
        }
    }
    for paquet in par_contenu.values().filter(|p| p.len() >= 2) {
        lier_paquet(paquet, DupProof::Identical, &mut liens);
    }

    for &(a, b, similarity) in aretes_son {
        if similarity < crate::fingerprint::MATCH_THRESHOLD {
            continue;
        }
        if let (Some(&ia), Some(&ib)) = (index.get(&a), index.get(&b)) {
            liens.push(Lien {
                a: ia,
                b: ib,
                kind: DupProof::SameSound,
                similarity: Some(similarity),
            });
        }
    }

    let refuse = |l: &Lien| {
        let (x, y) = (lignes[l.a].id, lignes[l.b].id);
        refus.contains(&(x.min(y), x.max(y)))
    };
    liens.retain(|l| l.a != l.b && !refuse(l));

    let mut parent: Vec<usize> = (0..lignes.len()).collect();
    for l in &liens {
        let (ra, rb) = (racine(&mut parent, l.a), racine(&mut parent, l.b));
        if ra != rb {
            parent[ra.max(rb)] = ra.min(rb);
        }
    }
    let mut composantes: HashMap<usize, GroupeBrut> = HashMap::new();
    for l in liens {
        let r = racine(&mut parent, l.a);
        composantes
            .entry(r)
            .or_insert_with(|| GroupeBrut {
                membres: Vec::new(),
                liens: Vec::new(),
            })
            .liens
            .push(l);
    }
    for i in 0..lignes.len() {
        let r = racine(&mut parent, i);
        if let Some(g) = composantes.get_mut(&r) {
            g.membres.push(i);
        }
    }
    let mut groupes: Vec<GroupeBrut> = composantes
        .into_values()
        .filter(|g| g.membres.len() >= 2)
        .collect();
    groupes.sort_by_key(|g| g.membres.iter().map(|&i| lignes[i].id).min());
    groupes
}

/// Rang du verdict dans la règle : VRAI avant À VÉRIFIER avant FAUX. Une piste pas encore
/// analysée se range entre les deux : rien ne dit qu'elle est fausse.
fn rang_verdict(verdict: Option<&str>) -> u8 {
    match verdict {
        Some("ok") => 3,
        Some("grey") => 2,
        Some("fake") => 0,
        _ => 1,
    }
}

/// La qualité d'une copie, au sens de la règle (spec § Ce que l'écran demande au backend) :
/// présente, non tronquée, verdict, lossless avant lossy, débit ENTRE COPIES LOSSY SEULEMENT,
/// fréquence. Le débit d'un FLAC mesure sa compression, pas sa qualité (tranché le 2026-10-05) :
/// entre deux lossless il vaut 0 pour tous, et la comparaison passe au critère suivant.
fn qualite(c: &DupScreenCopy) -> (bool, bool, u8, bool, i64, i64) {
    let lossless = rail_from_ext(&c.format) == Rail::Lossless;
    let debit_lossy = if lossless { 0 } else { c.bitrate.unwrap_or(-1) };
    (
        !c.missing,
        !c.truncated,
        rang_verdict(c.verdict.as_deref()),
        lossless,
        debit_lossy,
        c.sample_rate.unwrap_or(0),
    )
}

/// Les départages, à qualité égale : `.aiff` plutôt que `.aif`, puis la plus ancienne, puis le
/// plus petit id. Le dossier préféré, premier départage de la spec, est un geste de session :
/// le frontend le rejoue sur les copies `tied_with_best`.
fn departage(c: &DupScreenCopy, mtime: Option<i64>) -> (bool, Reverse<i64>, Reverse<i64>) {
    (
        c.format != "aif",
        Reverse(mtime.unwrap_or(i64::MAX)),
        Reverse(c.id),
    )
}

/// Ce que l'assemblage reçoit, en plus des lignes, pour chaque piste : lu hors verrou.
#[derive(Debug, Clone, Default)]
pub(crate) struct Faits {
    pub frequences: HashMap<i64, i64>,
    pub absentes: HashSet<i64>,
    pub rekordbox: HashMap<i64, RekordboxUse>,
    /// Faute de source lisible pour Rekordbox, toute copie est `Unknown`.
    pub rekordbox_connu: bool,
}

/// Assemble un groupe brut en groupe d'écran : copies ordonnées par la règle, copies cochées,
/// À vérifier, affichage. Pur.
pub(crate) fn assembler(
    lignes: &[Ligne],
    cles: &[String],
    brut: &GroupeBrut,
    faits: &Faits,
) -> DupScreenGroup {
    let mut copies: Vec<(DupScreenCopy, Option<i64>)> = brut
        .membres
        .iter()
        .map(|&i| {
            let l = &lignes[i];
            let rekordbox = if faits.rekordbox_connu {
                faits
                    .rekordbox
                    .get(&l.id)
                    .copied()
                    .unwrap_or(RekordboxUse::Absent)
            } else {
                RekordboxUse::Unknown
            };
            let copie = DupScreenCopy {
                id: l.id,
                path: l.path.clone(),
                status: l.status.clone(),
                source_id: l.source_id,
                verdict: l.verdict.clone(),
                cutoff_hz: l.cutoff_hz,
                format: extension(&l.path),
                bitrate: l.bitrate,
                sample_rate: faits.frequences.get(&l.id).copied(),
                duration: l.duration,
                size_bytes: l.size_bytes,
                truncated: l.truncated,
                missing: faits.absentes.contains(&l.id),
                keepable: false,
                discogs_release_id: l.discogs_release_id.clone(),
                year: l.year,
                rekordbox,
                keep: false,
                tied_with_best: false,
                name_key: cles[i].clone(),
            };
            (copie, l.mtime)
        })
        .collect();
    copies.sort_by(|(a, ma), (b, mb)| {
        (qualite(b), departage(b, *mb)).cmp(&(qualite(a), departage(a, *ma)))
    });

    // Quand TOUTES les copies présentes sont tronquées, la troncature ne départage plus rien : la
    // règle garde la meilleure comme ailleurs, la marque « tronquée » reste affichée (tranché le
    // 2026-10-06). Sans ça le groupe sortait tout décoché, cases grisées, sans geste possible.
    let toutes_tronquees = copies
        .iter()
        .filter(|(c, _)| !c.missing)
        .all(|(c, _)| c.truncated);
    for (c, _) in copies.iter_mut() {
        c.keepable = !c.missing && (!c.truncated || toutes_tronquees);
    }
    let meilleure = copies.first().map(|(c, _)| qualite(c));
    for (c, _) in copies.iter_mut() {
        c.tied_with_best = meilleure == Some(qualite(c));
    }
    if let Some((premiere, _)) = copies.first_mut() {
        premiere.keep = premiere.keepable;
    }
    for (c, _) in copies.iter_mut() {
        if c.keepable && matches!(c.rekordbox, RekordboxUse::Present { .. }) {
            c.keep = true;
        }
    }

    let durees: Vec<(i64, f64)> = copies
        .iter()
        .filter(|(c, _)| c.keepable)
        .filter_map(|(c, _)| c.duration.map(|d| (c.id, d)))
        .collect();
    let duration_spread = durees
        .iter()
        .map(|(_, d)| *d)
        .fold(None, |acc: Option<(f64, f64)>, d| match acc {
            None => Some((d, d)),
            Some((lo, hi)) => Some((lo.min(d), hi.max(d))),
        })
        .map(|(lo, hi)| hi - lo);
    let fort = |a: i64, b: i64| {
        brut.liens.iter().any(|l| {
            l.kind > DupProof::SameName && {
                let (x, y) = (lignes[l.a].id, lignes[l.b].id);
                (x == a && y == b) || (x == b && y == a)
            }
        })
    };
    let ecart_sans_preuve = durees.iter().enumerate().any(|(i, &(a, da))| {
        durees[i + 1..]
            .iter()
            .any(|&(b, db)| (da - db).abs() > TOLERANCE_DUREE_S && !fort(a, b))
    });
    // Une copie présente dont la durée est INCONNUE — pas encore analysée, ou illisible
    // (`persist_failure` laisse la durée à NULL) — ne prouve pas « durées à 0,1 s près » : sans lien
    // plus fort que le nom avec chacune des autres, le groupe est À vérifier. Sinon un radio edit et
    // une version longue de même nom, pas encore analysés, passaient au geste de masse.
    let duree_inconnue_sans_preuve = copies.iter().any(|(c, _)| {
        c.keepable
            && c.duration.is_none()
            && copies
                .iter()
                .any(|(o, _)| o.id != c.id && !o.missing && !fort(c.id, o.id))
    });
    let aucune_gardable = !copies.iter().any(|(c, _)| c.keepable);

    let proof = brut
        .liens
        .iter()
        .map(|l| l.kind)
        .max()
        .unwrap_or(DupProof::SameName);
    let links = brut
        .liens
        .iter()
        .filter(|l| l.kind > DupProof::SameName)
        .map(|l| DupScreenLink {
            a: lignes[l.a].id,
            b: lignes[l.b].id,
            kind: l.kind,
            similarity: l.similarity,
        })
        .collect();

    // L'en-tête est le nom de la meilleure copie, nettoyé par les mêmes règles que la clé.
    let tete = copies
        .first()
        .map(|(c, _)| naming::display_parts(radical(&c.path)))
        .unwrap_or((None, String::new(), None));
    DupScreenGroup {
        id: brut
            .membres
            .iter()
            .map(|&i| lignes[i].id)
            .min()
            .unwrap_or(0),
        artist: tete.0,
        title: tete.1,
        version: tete.2,
        proof,
        to_check: ecart_sans_preuve || duree_inconnue_sans_preuve || aucune_gardable,
        duration_spread,
        copies: copies.into_iter().map(|(c, _)| c).collect(),
        links,
    }
}

/// Clé de tri des groupes : artiste de A à Z, puis titre, puis version, sur la forme normalisée
/// (accents repliés, casse ignorée) — tranché le 2026-10-05. Sans artiste lisible, le titre
/// nettoyé tient lieu de clé. L'id départage, pour un ordre stable.
fn cle_de_tri(g: &DupScreenGroup) -> (String, String, i64) {
    (
        naming::name_key(g.artist.as_deref().unwrap_or(""), &g.title),
        naming::name_key("", g.version.as_deref().unwrap_or("")),
        g.id,
    )
}

/// Trie les groupes dans l'ordre de l'écran.
pub(crate) fn trier(groupes: &mut [DupScreenGroup]) {
    groupes.sort_by_cached_key(cle_de_tri);
}

/// « Ce ne sont pas des doublons », sur un groupe : chaque paire de ses copies est refusée, en
/// une transaction. Rejouer le même refus ne fait rien de plus (`OR IGNORE`).
pub(crate) fn refuser(conn: &Connection, ids: &[i64]) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut ajoutees = 0;
    {
        let mut stmt =
            tx.prepare("INSERT OR IGNORE INTO dup_refused (a_id, b_id) VALUES (?1, ?2)")?;
        for (i, &a) in ids.iter().enumerate() {
            for &b in &ids[i + 1..] {
                if a != b {
                    ajoutees += stmt.execute([a.min(b), a.max(b)])?;
                }
            }
        }
    }
    tx.commit()?;
    Ok(ajoutees)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ligne(id: i64, path: &str) -> Ligne {
        Ligne {
            id,
            path: path.to_string(),
            status: "pending".to_string(),
            source_id: Some(1),
            verdict: Some("ok".to_string()),
            cutoff_hz: Some(20_000.0),
            bitrate: Some(1411),
            duration: Some(300.0),
            size_bytes: Some(50_000_000 + id),
            mtime: Some(1_700_000_000),
            truncated: false,
            discogs_release_id: None,
            year: None,
        }
    }

    fn cles(lignes: &[Ligne]) -> Vec<String> {
        lignes.iter().map(|l| cle_de_nom(&l.path)).collect()
    }

    fn grouper(lignes: &[Ligne]) -> Vec<DupScreenGroup> {
        grouper_avec(lignes, &HashMap::new(), &[], &HashSet::new())
    }

    fn grouper_avec(
        lignes: &[Ligne],
        sommes: &HashMap<i64, u64>,
        aretes: &[(i64, i64, f32)],
        refus: &HashSet<(i64, i64)>,
    ) -> Vec<DupScreenGroup> {
        let k = cles(lignes);
        let faits = Faits {
            rekordbox_connu: true,
            ..Faits::default()
        };
        let mut g: Vec<DupScreenGroup> = former_groupes(lignes, &k, sommes, aretes, refus)
            .iter()
            .map(|b| assembler(lignes, &k, b, &faits))
            .collect();
        trier(&mut g);
        g
    }

    fn ids(g: &DupScreenGroup) -> Vec<i64> {
        g.copies.iter().map(|c| c.id).collect()
    }

    #[test]
    fn la_version_entre_dans_la_cle() {
        assert_eq!(
            cle_de_nom("C:/a/Aldo - Subzero (Original Mix).flac"),
            cle_de_nom("D:/b/aldo - subzero (original mix).mp3")
        );
        assert_ne!(
            cle_de_nom("C:/a/Aldo - Subzero (Original Mix).flac"),
            cle_de_nom("C:/a/Aldo - Subzero (Extended Mix).flac")
        );
    }

    /// La clé est celle de `naming::group_key` (ses règles ont leurs propres tests) : un nom sale
    /// rejoint le nom propre, et un nom qui ne nomme rien ne relie rien.
    #[test]
    fn la_cle_est_celle_des_noms_sales() {
        assert_eq!(
            cle_de_nom("E:/rips/01 - Aldo - Subzero (Original Mix) [www.slider.kz].mp3"),
            cle_de_nom("C:/a/Aldo - Subzero.flac")
        );
        assert_eq!(cle_de_nom("E:/rips/Track 01.mp3"), "");
        let lignes = [
            ligne(1, "E:/rips/Track 01.mp3"),
            ligne(2, "C:/a/Track 01.mp3"),
        ];
        assert!(
            grouper(&lignes).is_empty(),
            "deux noms qui ne nomment rien ne forment pas un groupe"
        );
    }

    /// L'en-tête d'un groupe est le nom de la meilleure copie, nettoyé comme la clé.
    #[test]
    fn l_en_tete_est_le_nom_nettoye() {
        // Le FLAC passe avant le MP3 : c'est son nom, le sale, qui fait l'en-tête.
        let a = ligne(
            1,
            "E:/rips/01 - Aldo - Subzero (Original Mix) [www.slider.kz].flac",
        );
        let b = ligne(2, "C:/a/Aldo - Subzero.mp3");
        let g = &grouper(&[a, b])[0];
        assert_eq!(g.copies[0].id, 1);
        assert_eq!(g.artist.as_deref(), Some("Aldo"));
        assert_eq!(g.title, "Subzero");
        assert_eq!(g.version.as_deref(), Some("Original Mix"));
    }

    #[test]
    fn deux_versions_ne_forment_pas_un_groupe() {
        let lignes = [
            ligne(1, "C:/a/Aldo - Subzero (Original Mix).aiff"),
            ligne(2, "C:/a/Aldo - Subzero (Extended Mix).aiff"),
        ];
        assert!(grouper(&lignes).is_empty());
    }

    #[test]
    fn meme_nom_forme_un_groupe() {
        let lignes = [
            ligne(1, "C:/a/Aldo - Subzero (Original Mix).aif"),
            ligne(2, "C:/b/Aldo - Subzero (Original Mix).aiff"),
            ligne(3, "C:/b/Autre - Morceau.aiff"),
        ];
        let g = grouper(&lignes);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].proof, DupProof::SameName);
        assert_eq!(g[0].artist.as_deref(), Some("Aldo"));
        assert_eq!(g[0].version.as_deref(), Some("Original Mix"));
    }

    #[test]
    fn identiques_relient_des_noms_differents() {
        let mut a = ligne(1, "C:/a/Okami Sound - Tidewater.mp3");
        let mut b = ligne(2, "C:/b/okami tidewater 320kbps.mp3");
        a.size_bytes = Some(9_000_000);
        b.size_bytes = Some(9_000_000);
        let sommes = HashMap::from([(1, 42u64), (2, 42u64)]);
        let g = grouper_avec(&[a, b], &sommes, &[], &HashSet::new());
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].proof, DupProof::Identical);
        assert_eq!(g[0].links.len(), 1);
    }

    #[test]
    fn meme_taille_somme_differente_ne_relie_pas() {
        let mut a = ligne(1, "C:/a/Un - Titre.wav");
        let mut b = ligne(2, "C:/b/Deux - Autre.wav");
        a.size_bytes = Some(9_000_000);
        b.size_bytes = Some(9_000_000);
        let sommes = HashMap::from([(1, 42u64), (2, 43u64)]);
        assert!(grouper_avec(&[a, b], &sommes, &[], &HashSet::new()).is_empty());
    }

    #[test]
    fn une_arete_de_son_relie_et_sous_le_seuil_non() {
        let lignes = [
            ligne(1, "C:/a/Un - Titre.wav"),
            ligne(2, "C:/b/Deux - Autre.wav"),
        ];
        let g = grouper_avec(&lignes, &HashMap::new(), &[(1, 2, 0.98)], &HashSet::new());
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].proof, DupProof::SameSound);
        assert_eq!(g[0].links[0].similarity, Some(0.98));
        assert!(grouper_avec(&lignes, &HashMap::new(), &[(1, 2, 0.3)], &HashSet::new()).is_empty());
    }

    #[test]
    fn une_paire_refusee_ne_relie_plus() {
        let lignes = [
            ligne(1, "C:/a/Aldo - Subzero.aiff"),
            ligne(2, "C:/b/Aldo - Subzero.aiff"),
        ];
        let refus = HashSet::from([(1, 2)]);
        assert!(grouper_avec(&lignes, &HashMap::new(), &[], &refus).is_empty());
    }

    #[test]
    fn la_preuve_est_la_plus_forte_trouvee() {
        let mut lignes = vec![
            ligne(1, "C:/a/Aldo - Subzero.aiff"),
            ligne(2, "C:/b/Aldo - Subzero.aiff"),
        ];
        lignes[0].size_bytes = Some(7);
        lignes[1].size_bytes = Some(7);
        let sommes = HashMap::from([(1, 5u64), (2, 5u64)]);
        let g = grouper_avec(&lignes, &sommes, &[], &HashSet::new());
        assert_eq!(g[0].proof, DupProof::Identical);
    }

    #[test]
    fn vrai_passe_avant_un_lossless_faux() {
        let mut flac = ligne(1, "C:/a/Aldo - Subzero.flac");
        flac.verdict = Some("fake".into());
        let mut mp3 = ligne(2, "C:/b/Aldo - Subzero.mp3");
        mp3.bitrate = Some(320);
        let g = grouper(&[flac, mp3]);
        assert_eq!(ids(&g[0]), vec![2, 1]);
        assert!(g[0].copies[0].keep && !g[0].copies[1].keep);
    }

    #[test]
    fn le_debit_ne_departage_pas_deux_lossless() {
        // WAV à 1411 kbps et FLAC à 912 du même son : à égalité de qualité, la règle passe aux
        // départages (ici, le plus ancien), et non au débit.
        let mut wav = ligne(1, "C:/a/Aldo - Subzero.wav");
        wav.mtime = Some(2_000);
        let mut flac = ligne(2, "C:/b/Aldo - Subzero.flac");
        flac.bitrate = Some(912);
        flac.mtime = Some(1_000);
        let g = grouper(&[wav, flac]);
        assert_eq!(
            ids(&g[0]),
            vec![2, 1],
            "le plus ancien gagne, pas le plus gros débit"
        );
        assert!(g[0].copies[1].tied_with_best);
    }

    #[test]
    fn le_debit_departage_deux_lossy() {
        let mut a = ligne(1, "C:/a/Aldo - Subzero.mp3");
        a.bitrate = Some(256);
        a.mtime = Some(1);
        let mut b = ligne(2, "C:/b/Aldo - Subzero.mp3");
        b.bitrate = Some(320);
        b.mtime = Some(2);
        let g = grouper(&[a, b]);
        assert_eq!(ids(&g[0]), vec![2, 1]);
        assert!(!g[0].copies[1].tied_with_best);
    }

    #[test]
    fn aiff_plutot_que_aif_a_egalite() {
        let mut aif = ligne(1, "C:/a/Bram - Lost Signal.aif");
        aif.mtime = Some(1);
        let mut aiff = ligne(2, "C:/a/Bram - Lost Signal.aiff");
        aiff.mtime = Some(2);
        let g = grouper(&[aif, aiff]);
        assert_eq!(ids(&g[0]), vec![2, 1]);
    }

    #[test]
    fn une_copie_tronquee_nest_jamais_cochee() {
        let mut tronquee = ligne(1, "C:/a/Kovacs - Paper Lanterns.wav");
        tronquee.truncated = true;
        tronquee.duration = Some(221.0);
        let mut entiere = ligne(2, "C:/b/Kovacs - Paper Lanterns.mp3");
        entiere.bitrate = Some(320);
        let g = grouper(&[tronquee, entiere]);
        assert_eq!(ids(&g[0]), vec![2, 1]);
        assert!(!g[0].copies[1].keep);
        assert!(
            !g[0].to_check,
            "seule une tronquée diffère : pas à vérifier"
        );
    }

    #[test]
    fn une_copie_absente_nest_jamais_cochee() {
        let lignes = [
            ligne(1, "C:/a/Pale - Halcyon.aiff"),
            ligne(2, "C:/b/Pale - Halcyon.aif"),
        ];
        let k = cles(&lignes);
        let faits = Faits {
            absentes: HashSet::from([1]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        assert_eq!(ids(&g), vec![2, 1]);
        assert!(g.copies[0].keep && !g.copies[1].keep && g.copies[1].missing);
    }

    #[test]
    fn rekordbox_garde_en_plus_de_la_meilleure() {
        let lignes = [
            ligne(1, "C:/a/Cielo - Overcast.wav"),
            ligne(2, "C:/b/Cielo - Overcast.aiff"),
        ];
        let k = cles(&lignes);
        // À égalité, le plus petit id est la meilleure (1) ; Rekordbox joue l'autre (2).
        let faits = Faits {
            rekordbox: HashMap::from([(2, RekordboxUse::Present { playlists: 3 })]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        assert_eq!(ids(&g), vec![1, 2]);
        assert!(
            g.copies.iter().all(|c| c.keep),
            "la meilleure ET la copie de Rekordbox"
        );
    }

    /// Rekordbox ne coche pas une copie que la règle ne peut pas garder : tronquée à côté d'une
    /// entière, ou introuvable.
    #[test]
    fn rekordbox_ne_coche_pas_une_copie_non_gardable() {
        let mut tronquee = ligne(2, "C:/b/Cielo - Overcast.aiff");
        tronquee.truncated = true;
        let lignes = [
            ligne(1, "C:/a/Cielo - Overcast.wav"),
            tronquee,
            ligne(3, "C:/c/Cielo - Overcast.aiff"),
        ];
        let k = cles(&lignes);
        let faits = Faits {
            absentes: HashSet::from([3]),
            rekordbox: HashMap::from([
                (2, RekordboxUse::Present { playlists: 3 }),
                (3, RekordboxUse::Present { playlists: 1 }),
            ]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        assert_eq!(ids(&g), vec![1, 2, 3]);
        assert!(g.copies[0].keep);
        assert!(!g.copies[1].keep && !g.copies[2].keep);
    }

    #[test]
    fn rekordbox_illisible_rend_inconnu_pas_absent() {
        let lignes = [
            ligne(1, "C:/a/Cielo - Overcast.wav"),
            ligne(2, "C:/b/Cielo - Overcast.aiff"),
        ];
        let k = cles(&lignes);
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &Faits::default());
        assert!(g
            .copies
            .iter()
            .all(|c| c.rekordbox == RekordboxUse::Unknown));
    }

    #[test]
    fn un_ecart_de_duree_sans_preuve_est_a_verifier() {
        let a = ligne(1, "C:/a/Halden - Rivers (Original Mix).aiff");
        let mut b = ligne(2, "C:/b/Halden - Rivers (Original Mix).mp3");
        b.duration = Some(344.0);
        b.bitrate = Some(320);
        let g = grouper(&[a.clone(), b.clone()]);
        assert!(g[0].to_check);
        assert_eq!(g[0].duration_spread, Some(44.0));

        let mut c = b.clone();
        c.duration = Some(300.5);
        let g = grouper(&[a.clone(), c]);
        assert!(g[0].to_check, "la bande 0,1 à 2 s va du côté prudent");

        let mut d = b;
        d.duration = Some(300.05);
        let g = grouper(&[a, d]);
        assert!(
            !g[0].to_check,
            "0,05 s : délai d'encodeur, même enregistrement"
        );
    }

    #[test]
    fn le_son_leve_le_doute_de_duree() {
        let a = ligne(1, "C:/a/Halden - Rivers.aiff");
        let mut b = ligne(2, "C:/b/Halden - Rivers.aiff");
        b.duration = Some(302.03);
        let g = grouper_avec(&[a, b], &HashMap::new(), &[(1, 2, 1.0)], &HashSet::new());
        assert!(!g[0].to_check);
        assert_eq!(g[0].proof, DupProof::SameSound);
    }

    /// Une durée inconnue (copie pas encore analysée, ou illisible) ne prouve pas « à 0,1 s
    /// près » : sans lien plus fort que le nom, le groupe sort du geste de masse.
    #[test]
    fn une_duree_inconnue_sans_preuve_est_a_verifier() {
        let a = ligne(1, "C:/a/Halden - Rivers.aiff");
        let mut b = ligne(2, "C:/b/Halden - Rivers.mp3");
        b.duration = None;
        let g = grouper(&[a.clone(), b.clone()]);
        assert!(g[0].to_check, "même nom seul, une durée inconnue");

        let mut sommes = HashMap::new();
        sommes.insert(1, 7);
        sommes.insert(2, 7);
        b.size_bytes = a.size_bytes;
        let g = grouper_avec(&[a, b], &sommes, &[], &HashSet::new());
        assert_eq!(g[0].proof, DupProof::Identical);
        assert!(
            !g[0].to_check,
            "identiques à l'octet : la durée n'a rien à prouver"
        );
    }

    /// Toutes tronquées : la troncature ne départage rien, la règle garde la meilleure comme
    /// ailleurs, et le groupe entre dans le plan si les durées concordent (tranché le 2026-10-06).
    #[test]
    fn toutes_tronquees_la_meilleure_reste_gardee() {
        let mut a = ligne(1, "C:/a/Kovacs - Lanterns.mp3");
        a.truncated = true;
        a.bitrate = Some(192);
        let mut b = ligne(2, "C:/b/Kovacs - Lanterns.wav");
        b.truncated = true;
        let g = grouper(&[a.clone(), b.clone()]);
        assert_eq!(ids(&g[0]), vec![2, 1]);
        assert!(g[0].copies.iter().all(|c| c.keepable && c.truncated));
        assert!(g[0].copies[0].keep && !g[0].copies[1].keep);
        assert!(
            !g[0].to_check,
            "durées égales : le groupe entre dans le plan"
        );

        // Les durées des tronquées comptent alors : un écart sans preuve reste À vérifier.
        let mut c = a.clone();
        c.duration = Some(344.0);
        let g = grouper(&[c, b.clone()]);
        assert!(g[0].to_check);
        assert_eq!(g[0].duration_spread, Some(44.0));

        // Et une durée inconnue ne prouve rien chez elles non plus.
        let mut d = a;
        d.duration = None;
        let g = grouper(&[d, b]);
        assert!(
            g[0].to_check,
            "durée inconnue sans preuve plus forte que le nom"
        );
    }

    /// Une seule copie entière suffit à rendre les tronquées non gardables.
    #[test]
    fn une_copie_entiere_rend_les_tronquees_non_gardables() {
        let mut a = ligne(1, "C:/a/Kovacs - Lanterns.wav");
        a.truncated = true;
        let mut b = ligne(2, "C:/b/Kovacs - Lanterns.wav");
        b.truncated = true;
        let mut c = ligne(3, "C:/c/Kovacs - Lanterns.mp3");
        c.bitrate = Some(128);
        let g = grouper(&[a, b, c]);
        assert_eq!(g[0].copies[0].id, 3);
        assert!(g[0].copies[0].keepable && g[0].copies[0].keep);
        assert!(g[0].copies[1..].iter().all(|c| !c.keepable && !c.keep));
    }

    /// Les introuvables ne comptent pas : une tronquée seule présente est gardable.
    #[test]
    fn toutes_tronquees_parmi_les_presentes_seulement() {
        let lignes = {
            let mut a = ligne(1, "C:/a/Pale - Halcyon.aiff");
            a.truncated = true;
            [a, ligne(2, "C:/b/Pale - Halcyon.aiff")]
        };
        let k = cles(&lignes);
        let faits = Faits {
            absentes: HashSet::from([2]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        assert_eq!(ids(&g), vec![1, 2]);
        assert!(g.copies[0].keepable && g.copies[0].keep);
        assert!(!g.copies[1].keepable && !g.copies[1].keep);
    }

    #[test]
    fn aucune_copie_gardable_est_a_verifier() {
        let lignes = [
            ligne(1, "C:/a/Kovacs - Lanterns.wav"),
            ligne(2, "C:/b/Kovacs - Lanterns.wav"),
        ];
        let k = cles(&lignes);
        let faits = Faits {
            absentes: HashSet::from([1, 2]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        assert!(g.to_check);
        assert!(g.copies.iter().all(|c| !c.keep && !c.keepable));
    }

    #[test]
    fn les_groupes_se_rangent_par_artiste_de_a_a_z() {
        let lignes = [
            ligne(1, "C:/a/Okami Sound - Tidewater.mp3"),
            ligne(2, "C:/b/Okami Sound - Tidewater.mp3"),
            ligne(3, "C:/a/Aldo Ostrova - Subzero.aiff"),
            ligne(4, "C:/b/Aldo Ostrova - Subzero.aiff"),
            ligne(5, "C:/a/Bram Veit - Lost Signal.aiff"),
            ligne(6, "C:/b/bram veit - lost signal.aiff"),
        ];
        let g = grouper(&lignes);
        let artistes: Vec<_> = g
            .iter()
            .map(|g| g.artist.clone().unwrap_or_default())
            .collect();
        assert_eq!(artistes, vec!["Aldo Ostrova", "Bram Veit", "Okami Sound"]);
    }

    #[test]
    fn empreinte_contenu_suit_les_octets() {
        let dir = std::env::temp_dir().join(format!("sift-doublons-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let taille = 300 * 1024;
        let base: Vec<u8> = (0..taille).map(|i| (i % 251) as u8).collect();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        let c = dir.join("c.bin");
        std::fs::write(&a, &base).unwrap();
        std::fs::write(&b, &base).unwrap();
        let mut modifie = base.clone();
        modifie[taille / 2] ^= 0xff;
        std::fs::write(&c, &modifie).unwrap();
        let t = taille as u64;
        let (sa, sb, sc) = (
            empreinte_contenu(&a, t).unwrap(),
            empreinte_contenu(&b, t).unwrap(),
            empreinte_contenu(&c, t).unwrap(),
        );
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(sa, sb);
        assert_ne!(sa, sc, "un octet changé au milieu change la somme");
    }

    #[test]
    fn dup_screen_copy_shape_matches_contracts_ts() {
        let DupScreenCopy {
            id,
            path,
            status,
            source_id,
            verdict,
            cutoff_hz,
            format,
            bitrate,
            sample_rate,
            duration,
            size_bytes,
            truncated,
            missing,
            keepable,
            discogs_release_id,
            year,
            rekordbox,
            keep,
            tied_with_best,
            name_key,
        } = grouper(&[ligne(1, "C:/a/A - B.aiff"), ligne(2, "C:/b/A - B.aiff")])[0].copies[0]
            .clone();
        let _ = (
            id,
            path,
            status,
            source_id,
            verdict,
            cutoff_hz,
            format,
            bitrate,
            sample_rate,
            duration,
            size_bytes,
            truncated,
            missing,
            keepable,
            discogs_release_id,
            year,
            rekordbox,
            keep,
            tied_with_best,
            name_key,
        );
    }

    #[test]
    fn dup_screen_group_shape_matches_contracts_ts() {
        let DupScreenGroup {
            id,
            artist,
            title,
            version,
            proof,
            to_check,
            duration_spread,
            copies,
            links,
        } = grouper(&[ligne(1, "C:/a/A - B.aiff"), ligne(2, "C:/b/A - B.aiff")])[0].clone();
        let DupScreenLink {
            a,
            b,
            kind,
            similarity,
        } = DupScreenLink {
            a: 1,
            b: 2,
            kind: DupProof::Identical,
            similarity: None,
        };
        let _ = (
            id,
            artist,
            title,
            version,
            proof,
            to_check,
            duration_spread,
            copies,
            links,
            a,
            b,
            kind,
            similarity,
        );
    }

    fn json<T: Serialize>(v: &T) -> String {
        serde_json::to_string(v).unwrap()
    }

    /// Diagnostic sur une COPIE d'une vraie base : les groupes où la règle ne coche AUCUNE copie,
    /// classés par cause, avec leurs copies. `SIFT_DOUBLONS_DB=<copie> cargo test --lib
    /// diagnostic_groupes_sans_copie_gardee -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn diagnostic_groupes_sans_copie_gardee() {
        let Ok(chemin) = std::env::var("SIFT_DOUBLONS_DB") else {
            eprintln!("SIFT_DOUBLONS_DB absent : diagnostic sauté");
            return;
        };
        let conn = Connection::open_with_flags(
            &chemin,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .unwrap();
        let lignes = charger_lignes(&conn).unwrap();
        let aretes = charger_aretes_son(&conn).unwrap();
        let refus = charger_refus(&conn).unwrap_or_default();
        let k = cles(&lignes);
        let sommes = echantillonner(&lignes);
        let bruts = former_groupes(&lignes, &k, &sommes, &aretes, &refus);
        let membres: Vec<i64> = bruts
            .iter()
            .flat_map(|b| b.membres.iter().map(|&i| lignes[i].id))
            .collect();
        let absentes: HashSet<i64> = bruts
            .iter()
            .flat_map(|b| b.membres.iter())
            .filter(|&&i| !Path::new(&lignes[i].path).is_file())
            .map(|&i| lignes[i].id)
            .collect();
        let faits = Faits {
            frequences: charger_frequences(&conn, &membres).unwrap(),
            absentes,
            rekordbox_connu: false,
            ..Faits::default()
        };
        let groupes: Vec<DupScreenGroup> = bruts
            .iter()
            .map(|b| assembler(&lignes, &k, b, &faits))
            .collect();
        let sans: Vec<&DupScreenGroup> = groupes
            .iter()
            .filter(|g| !g.copies.iter().any(|c| c.keep))
            .collect();
        let tous_tronques = sans
            .iter()
            .filter(|g| g.copies.iter().all(|c| c.truncated && !c.missing))
            .count();
        let tous_absents = sans
            .iter()
            .filter(|g| g.copies.iter().all(|c| c.missing))
            .count();
        let mixtes = sans.len() - tous_tronques - tous_absents;
        let copies_tronquees = groupes
            .iter()
            .flat_map(|g| g.copies.iter())
            .filter(|c| c.truncated)
            .count();
        let copies: usize = groupes.iter().map(|g| g.copies.len()).sum();
        eprintln!(
            "groupes {} · sans copie gardée {} (toutes tronquées {}, toutes introuvables {}, mélange tronquées/introuvables {}) · copies tronquées {} sur {}",
            groupes.len(),
            sans.len(),
            tous_tronques,
            tous_absents,
            mixtes,
            copies_tronquees,
            copies
        );
        // Les groupes que la règle « toutes tronquées » (2026-10-06) garde désormais : combien
        // restent À vérifier (durées discordantes ou inconnues), combien entrent dans le plan.
        let toutes_tronquees: Vec<&DupScreenGroup> = groupes
            .iter()
            .filter(|g| {
                g.copies.iter().any(|c| !c.missing)
                    && g.copies.iter().filter(|c| !c.missing).all(|c| c.truncated)
            })
            .collect();
        eprintln!(
            "groupes dont toutes les copies présentes sont tronquées {} · dont À vérifier {}",
            toutes_tronquees.len(),
            toutes_tronquees.iter().filter(|g| g.to_check).count()
        );
        for g in sans.iter().take(12) {
            eprintln!(
                "  {} — {} · à vérifier {}",
                g.artist.as_deref().unwrap_or("?"),
                g.title,
                g.to_check
            );
            for c in &g.copies {
                eprintln!(
                    "    tronquée {} · introuvable {} · {} · {:?} · {:?} s · {}",
                    c.truncated,
                    c.missing,
                    c.format,
                    c.verdict,
                    c.duration.map(|d| d.round()),
                    c.path
                );
            }
        }
        assert!(
            sans.iter().all(|g| g.copies.iter().all(|c| c.missing)),
            "un groupe a une copie présente et aucune cochée"
        );
    }

    /// Mesure sur une COPIE d'une vraie base, ouverte en lecture seule : comptes et coût de
    /// chaque étape. `SIFT_DOUBLONS_DB=<copie de sift.db> cargo test --release --lib
    /// mesure_sur_une_copie -- --ignored --nocapture`. Les fichiers audio sont LUS (échantillons,
    /// existence), jamais écrits.
    #[test]
    #[ignore]
    fn mesure_sur_une_copie_de_la_base() {
        let Ok(chemin) = std::env::var("SIFT_DOUBLONS_DB") else {
            eprintln!("SIFT_DOUBLONS_DB absent : mesure sautée");
            return;
        };
        let conn = Connection::open_with_flags(
            &chemin,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .unwrap();
        let t0 = std::time::Instant::now();
        let lignes = charger_lignes(&conn).unwrap();
        let aretes = charger_aretes_son(&conn).unwrap();
        let refus = charger_refus(&conn).unwrap_or_default();
        let t_lecture = t0.elapsed();
        let t1 = std::time::Instant::now();
        let k = cles(&lignes);
        let t_cles = t1.elapsed();
        let t2 = std::time::Instant::now();
        let sommes = echantillonner(&lignes);
        let t_echantillons = t2.elapsed();
        let t3 = std::time::Instant::now();
        let bruts = former_groupes(&lignes, &k, &sommes, &aretes, &refus);
        let membres: Vec<i64> = bruts
            .iter()
            .flat_map(|b| b.membres.iter().map(|&i| lignes[i].id))
            .collect();
        let t_groupes = t3.elapsed();
        let t4 = std::time::Instant::now();
        let frequences = charger_frequences(&conn, &membres).unwrap();
        let absentes: HashSet<i64> = bruts
            .iter()
            .flat_map(|b| b.membres.iter())
            .filter(|&&i| !Path::new(&lignes[i].path).is_file())
            .map(|&i| lignes[i].id)
            .collect();
        let faits = Faits {
            frequences,
            absentes,
            rekordbox_connu: false,
            ..Faits::default()
        };
        let mut groupes: Vec<DupScreenGroup> = bruts
            .iter()
            .map(|b| assembler(&lignes, &k, b, &faits))
            .collect();
        trier(&mut groupes);
        let t_assemblage = t4.elapsed();
        let compte = |p: DupProof| groupes.iter().filter(|g| g.proof == p).count();
        let copies: usize = groupes.iter().map(|g| g.copies.len()).sum();
        let en_trop: usize = groupes
            .iter()
            .filter(|g| !g.to_check)
            .map(|g| g.copies.iter().filter(|c| !c.keep && !c.missing).count())
            .sum();
        eprintln!(
            "lignes {} · échantillonnées {} · groupes {} (copies {}) · identiques {} · même son {} · même nom {} · à vérifier {} · absentes {} · dans le plan {}",
            lignes.len(),
            sommes.len(),
            groupes.len(),
            copies,
            compte(DupProof::Identical),
            compte(DupProof::SameSound),
            compte(DupProof::SameName),
            groupes.iter().filter(|g| g.to_check).count(),
            faits.absentes.len(),
            en_trop,
        );
        eprintln!(
            "temps : lecture {t_lecture:?} · clés {t_cles:?} · échantillons {t_echantillons:?} · groupes {t_groupes:?} · fréquences+existence+assemblage {t_assemblage:?}"
        );
        // Un second passage montre le coût en régime établi (sommes en cache).
        let t5 = std::time::Instant::now();
        let _ = echantillonner(&lignes);
        eprintln!("échantillons, second passage : {:?}", t5.elapsed());
    }

    #[test]
    fn charge_la_base_ses_refus_et_ses_frequences() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO tracks (id, path, status, verdict, size_bytes, report_json) VALUES
               (1, 'C:/a/A - B.aiff', 'pending', 'ok', 10, '{\"sample_rate\":48000}'),
               (2, 'C:/b/A - B.aiff', 'filed', 'ok', 10, 'pas du json'),
               (3, 'C:/c/A - B.aiff', 'trash', 'ok', 10, NULL);
             INSERT INTO metadata (track_id, discogs_release_id, year) VALUES (2, '123', 2019);
             INSERT INTO dup_refused (a_id, b_id) VALUES (1, 2);",
        )
        .unwrap();
        let mut lignes = charger_lignes(&conn).unwrap();
        lignes.sort_by_key(|l| l.id);
        assert_eq!(
            lignes.iter().map(|l| l.id).collect::<Vec<_>>(),
            vec![1, 2],
            "une piste à la corbeille n'est pas une copie"
        );
        assert_eq!(lignes[1].discogs_release_id.as_deref(), Some("123"));
        assert_eq!(charger_refus(&conn).unwrap(), HashSet::from([(1, 2)]));
        let f = charger_frequences(&conn, &[1, 2, 3]).unwrap();
        assert_eq!(f.get(&1), Some(&48_000));
        assert_eq!(f.get(&2), None, "un rapport illisible ne vide pas l'écran");
        assert!(
            conn.execute("INSERT INTO dup_refused (a_id, b_id) VALUES (2, 1)", [])
                .is_err(),
            "une paire se range a < b"
        );
        conn.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM tracks WHERE id = 2;")
            .unwrap();
        assert!(
            charger_refus(&conn).unwrap().is_empty(),
            "une piste purgée emporte ses refus"
        );
    }

    /// Une arête de son ne vaut que tant que les deux pistes gardent leur empreinte : un fichier
    /// modifié la perd, et l'arête de l'ancien contenu ne lève plus le doute.
    #[test]
    fn une_arete_perimee_ne_relie_plus() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO tracks (id, path, status, fingerprint) VALUES
               (1, 'C:/a/A - B.aiff', 'pending', 'AQAA'),
               (2, 'C:/b/A - B.aiff', 'pending', 'AQAB'),
               (3, 'C:/c/A - B.aiff', 'pending', NULL),
               (4, 'C:/d/A - B.aiff', 'pending', ''),
               (5, 'C:/e/A - B.aiff', 'pending', 'AQAC');
             INSERT INTO dup_edges (a_id, b_id, similarity) VALUES
               (1, 2, 0.9), (1, 3, 0.9), (2, 4, 0.9), (3, 5, 0.9);",
        )
        .unwrap();
        assert_eq!(charger_aretes_son(&conn).unwrap(), vec![(1, 2, 0.9)]);
    }

    #[test]
    fn refuser_un_groupe_refuse_chaque_paire_une_fois() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO tracks (id, path, status) VALUES
               (1, 'C:/a/A - B.aiff', 'pending'),
               (2, 'C:/b/A - B.aiff', 'pending'),
               (3, 'C:/c/A - B.aiff', 'pending');",
        )
        .unwrap();
        assert_eq!(refuser(&conn, &[3, 1, 2]).unwrap(), 3);
        assert_eq!(
            charger_refus(&conn).unwrap(),
            HashSet::from([(1, 2), (1, 3), (2, 3)])
        );
        assert_eq!(refuser(&conn, &[1, 2]).unwrap(), 0, "rejouer ne fait rien");
        let lignes: Vec<Ligne> = charger_lignes(&conn).unwrap();
        let k = cles(&lignes);
        let refus = charger_refus(&conn).unwrap();
        assert!(
            former_groupes(&lignes, &k, &HashMap::new(), &[], &refus).is_empty(),
            "le groupe quitte la table"
        );
    }

    #[test]
    fn les_noms_serialises_sont_ceux_de_contracts_ts() {
        assert_eq!(json(&DupProof::SameName), "\"same_name\"");
        assert_eq!(json(&DupProof::SameSound), "\"same_sound\"");
        assert_eq!(json(&DupProof::Identical), "\"identical\"");
        assert_eq!(json(&RekordboxUse::Unknown), "{\"state\":\"unknown\"}");
        assert_eq!(json(&RekordboxUse::Absent), "{\"state\":\"absent\"}");
        assert_eq!(
            json(&RekordboxUse::Present { playlists: 3 }),
            "{\"state\":\"present\",\"playlists\":3}"
        );
        assert_eq!(
            json(&RekordboxUse::Unverified {
                reason: RekordboxDoubt::RekordboxOpen
            }),
            "{\"state\":\"unverified\",\"reason\":\"rekordbox_open\"}"
        );
        assert_eq!(json(&RekordboxDoubt::XmlSnapshot), "\"xml_snapshot\"");
    }

    /// Une copie non vérifiée n'est PAS gardée d'office : la confirmation avertit, l'utilisateur
    /// tranche (décision d'Antoine, 2026-10-05). Seule une copie que Rekordbox joue l'est.
    #[test]
    fn une_copie_non_verifiee_n_est_pas_gardee_d_office() {
        let lignes = [
            ligne(1, "C:/a/Aldo - Subzero.aiff"),
            ligne(2, "C:/b/Aldo - Subzero.mp3"),
        ];
        let k = cles(&lignes);
        let faits = Faits {
            rekordbox: HashMap::from([(
                2,
                RekordboxUse::Unverified {
                    reason: RekordboxDoubt::RekordboxOpen,
                },
            )]),
            rekordbox_connu: true,
            ..Faits::default()
        };
        let brut = &former_groupes(&lignes, &k, &HashMap::new(), &[], &HashSet::new())[0];
        let g = assembler(&lignes, &k, brut, &faits);
        let mp3 = g.copies.iter().find(|c| c.id == 2).unwrap();
        assert!(!mp3.keep);
        assert_eq!(
            mp3.rekordbox,
            RekordboxUse::Unverified {
                reason: RekordboxDoubt::RekordboxOpen
            }
        );
    }
}
