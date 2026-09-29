//! IPC surface for M6a identification. `identify` queries Discogs (token from settings) and
//! returns ranked candidates; `apply_release` downloads the cover and applies the chosen
//! candidate to the file AND the DB, as one revertable batch (#68). Errors are flattened to stable sentinel codes the front maps
//! to messages: NO_TOKEN, RATE_LIMITED:<s>, NETWORK, PARSE.

use crate::db;
use crate::metadata::{self, Candidate, MetadataProvider, Query};
use crate::naming::{Canonical, Confidence};
use crate::settings;
use crate::tagging::{CoverSnap, TagsSnapshot};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Ce que l'écran affiche au moment du clic sur Identifier : l'éditeur de Revue (titre et version
/// séparés) ou le formulaire de la Bibliothèque (titre complet, version comprise, `version` nul).
/// Miroir de `IdentifyHint` dans `shared/contracts.ts`, épinglé par
/// `identify_hint_shape_matches_contracts_ts`.
///
/// Issue #67 : `identify` n'envoyait que l'id, et le backend relisait les tags SUR DISQUE. Une
/// correction faite à l'écran ne comptait qu'une fois gravée, et encore : filtrée par le portail
/// « junk » de `naming::is_clean` (« Jay Tripwire » contient « rip »), la version reprise du nom de
/// fichier. Une saisie est intentionnelle : elle passe telle quelle.
#[derive(Debug, Clone, Deserialize)]
pub struct IdentifyHint {
    pub artist: String,
    pub title: String,
    pub version: Option<String>,
}

/// Query Discogs for `track_id`'s best-guess artist/title; ranked candidates, best first. `hint`
/// is what the screen shows — it wins over the file's tags and name when its title is non-empty.
///
/// `async`, et c'est la DEUXIÈME exception au backend synchrone (`CLAUDE.md` § Backend), décidée
/// par Antoine le 2026-09-28 sur mesure (issue #74). Synchrone, la commande s'exécutait sur le fil
/// de la fenêtre et y gardait TOUT l'IPC pendant la recherche Discogs : un `get_setting` qui prend
/// 3 à 9 ms au repos a pris 1 334 ms lancé pendant une identification de 1 396 ms. Au pire,
/// 13 requêtes à 15 s de délai chacune (`discogs::HTTP_TIMEOUT`). Même forme qu'`analyze_path` :
/// le corps synchrone part sur `spawn_blocking`, la connexion se reprend depuis l'`AppHandle`.
/// Gardé par `identify_reste_hors_du_fil_de_la_fenetre`.
#[tauri::command]
pub async fn identify(
    app: AppHandle,
    track_id: i64,
    hint: Option<IdentifyHint>,
) -> Result<Vec<Candidate>, String> {
    tauri::async_runtime::spawn_blocking(move || identify_bloquant(app, track_id, hint))
        .await
        // Le fil a paniqué ou été annulé : l'échec se rend en Err, jamais un `unwrap`.
        .map_err(|e| {
            crate::tr!(
                "identify : le fil de recherche n'a pas rendu : {e}",
                "identify: the search thread didn't return: {e}"
            )
        })?
}

/// Le corps d'`identify`, SYNCHRONE : lectures sous le verrou, puis la cascade réseau.
fn identify_bloquant(
    app: AppHandle,
    track_id: i64,
    hint: Option<IdentifyHint>,
) -> Result<Vec<Candidate>, String> {
    let conn = app.state::<Mutex<Connection>>();
    // Chemin sous le verrou, lecture des tags APRÈS l'avoir relâché : une lecture disque ne doit
    // pas geler les autres utilisateurs de la base (même découpage que `ipc_filing::reconcile`).
    let (token, path) = {
        let conn = db::lock_conn(&conn)?;
        let token = settings::get(&conn, settings::DISCOGS_TOKEN)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let path = crate::filing::track_path(&conn, track_id).map_err(|e| e.to_string())?;
        (token, path)
    };
    if token.trim().is_empty() {
        return Err("NO_TOKEN".into());
    }
    let query = build_query(&path, hint.as_ref());
    let provider = metadata::discogs::Discogs { token };
    provider.search(&query).map_err(|e| e.code())
}

/// Demande à Discogs si le jeton enregistré est accepté. Rend les MÊMES codes que `identify`.
///
/// Impasse A11 de l'issue #15 : « Jeton enregistré. » dit l'écriture et rien d'autre, et un jeton
/// faux ne se découvrait qu'au premier Identifier — plus tard, dans un autre écran, sur un morceau
/// qu'on voulait traiter. Ce bouton déplace la découverte au moment où on colle le jeton.
///
/// Les codes sont ceux de `ProviderError::code()`, déjà traduits par `identifyErrorHtml` côté
/// front : pas de second vocabulaire d'erreur pour la même API.
#[tauri::command]
pub fn verify_discogs_token(conn: State<'_, Mutex<Connection>>) -> Result<(), String> {
    let token = {
        let conn = db::lock_conn(&conn)?;
        settings::get(&conn, settings::DISCOGS_TOKEN)
            .map_err(|e| e.to_string())?
            .unwrap_or_default()
    };
    // Même garde que `identify`, et pour la même raison : sans jeton il n'y a pas de recherche
    // anonyme à tenter, donc rien à demander au réseau.
    if token.trim().is_empty() {
        return Err("NO_TOKEN".into());
    }
    metadata::discogs::Discogs { token }
        .verify_token()
        .map_err(|e| e.code())
}

/// Assemble la requête depuis TROIS sources, par ordre de confiance.
///
/// 1. Ce que l'écran affiche (`hint`), dès que son titre n'est pas vide : une saisie est
///    intentionnelle, aucun portail ne la filtre (issue #67).
/// 2. Les tags embarqués quand ils sont propres : ils peuvent avoir été corrigés par l'utilisateur,
///    et aucune analyse du nom de fichier ne peut battre une donnée saisie.
/// 3. Sinon — le cas de 79 % des fichiers dont le nom est sale, mesuré le 2026-07-28 —
///    `search_terms`, qui lit le nom ET le dossier parent.
///
/// La version suit la même priorité, puis tombe sur celle du nom de fichier. Elle est tirée de la
/// parenthèse finale du titre (`naming::split_tag_title`), qui est là où `apply_tags` la grave
/// depuis 3698a55 : jusqu'au 2026-09-23 elle venait TOUJOURS du nom de fichier, et le titre gardait
/// la sienne — « Elastic (Original Mix) » cherché avec la version « Original-Mix » comptait deux
/// fois « original » et « mix » au score de tracklist (issue #66).
///
/// Les marches d'une source nommée partent SANS version d'abord : « Cherry Bomb Elastic
/// (Original Mix) » rend 0 résultat (le vinyle de 1994 ne porte pas « Original Mix », et la
/// recherche fait un ET implicite) quand « Cherry Bomb Elastic » trouve la release en #1 — mesuré
/// sur l'API. Le bon mix se départage ensuite au score de tracklist, qui reçoit la version.
///
/// Note délibérée : cette fonction n'appelle PAS `filing::reconcile_track`. `Canonical` est
/// l'identité qu'on écrit sur le disque et son portail de rejet la rend volontairement timide ;
/// s'en servir comme requête est précisément le défaut que ce chantier corrige. Les deux chemins
/// restent séparés — `ipc_filing::reconcile` continue d'alimenter les champs éditables.
fn build_query(path: &str, hint: Option<&IdentifyHint>) -> Query {
    let p = std::path::Path::new(path);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let folder = p
        .parent()
        .and_then(|d| d.file_name())
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();

    let terms = crate::search_terms::build(&stem, &folder);
    let (tag_artist, tag_title) = crate::tagging::read_artist_title(path);
    build_query_from(&terms, &tag_artist, &tag_title, hint)
}

/// « Original Mix », « Original », « Original Version » : la version qu'on n'a pas besoin de
/// chercher, parce qu'un pressage d'origine ne la nomme presque jamais.
fn is_default_version(v: &str) -> bool {
    let words: Vec<String> = v
        .to_lowercase()
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(String::from)
        .collect();
    words.iter().any(|w| w == "original")
        && words
            .iter()
            .all(|w| matches!(w.as_str(), "original" | "mix" | "version"))
}

/// Partie PURE de `build_query` : aucune lecture disque, testable sans fixture.
fn build_query_from(
    terms: &crate::search_terms::Terms,
    tag_artist: &str,
    tag_title: &str,
    hint: Option<&IdentifyHint>,
) -> Query {
    let ladder = terms.ladder.iter().map(|a| a.q.clone());
    let named: Option<(String, String, Option<String>)> = match hint {
        Some(h) if !h.title.trim().is_empty() => {
            let (base, in_title) = crate::naming::split_tag_title(&h.title);
            let typed = h
                .version
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(String::from);
            Some((h.artist.trim().to_string(), base, typed.or(in_title)))
        }
        _ if crate::naming::is_clean(tag_artist, tag_title) => {
            let (base, version) = crate::naming::split_tag_title(tag_title);
            Some((tag_artist.trim().to_string(), base, version))
        }
        _ => None,
    };
    let Some((artist, title, version)) = named else {
        return Query {
            artist: terms.artist.clone(),
            title: terms.title.clone(),
            version: terms.version.clone(),
            attempts: ladder.collect(),
        };
    };
    let head = if artist.is_empty() {
        title.clone()
    } else {
        format!("{artist} {title}")
    };
    // Ordre des deux premières marches. Une version par DÉFAUT (« Original Mix ») est une étiquette
    // Beatport que les vinyles ne portent pas : elle part en second. Un vrai mix (« Joe Claussell
    // Remix ») part en PREMIER — sinon la marche sans version trouve l'original, un mot du titre
    // suffit au score, la cascade s'arrête, et le 12" de remixes n'est jamais cherché (relecture
    // #66 : l'ancien code le trouvait, son essai des tags portait le titre complet).
    let mut attempts = match &version {
        Some(v) if !is_default_version(v) => vec![format!("{head} {v}"), head.clone()],
        Some(v) => vec![head.clone(), format!("{head} {v}")],
        None => vec![head.clone()],
    };
    attempts.extend(ladder);
    Query {
        artist,
        title,
        version: version.or_else(|| terms.version.clone()),
        attempts,
    }
}

/// Ce que `apply_release` rend à l'écran (#68). Le titre et la version n'y sont pas : c'est
/// l'écran qui les a envoyés, et ils ont été gravés tels quels. Miroir d'`AppliedRelease` dans
/// `shared/contracts.ts`, épinglé par `applied_release_shape_matches_contracts_ts`.
#[derive(Debug, Clone, Serialize)]
pub struct AppliedRelease {
    pub label: Option<String>,
    pub year: Option<i64>,
    pub styles: Vec<String>,
    /// La pochette que la base retient désormais : celle de la release, `None` quand la release
    /// n'en a pas, et l'ANCIENNE quand le téléchargement a échoué (`cover_failed`).
    pub cover_path: Option<String>,
    /// Le téléchargement de la pochette a échoué (réseau, délai, disque) : le fichier et la base
    /// gardent celle d'avant, et l'écran le dit au lieu de le taire.
    pub cover_failed: bool,
    /// Le lot `tag_edit` qui porte ce changement — « Rétablir » l'annule, fichier ET release.
    pub batch_id: String,
}

/// Ce que devient la pochette, décidé AVANT la moindre écriture.
#[derive(Debug, PartialEq)]
enum CoverChoice {
    /// La pochette de la release, en cache sur le disque.
    Set(String),
    /// La release n'a pas de pochette : on retire celle d'avant (décision « Vider »).
    Clear,
    /// Le téléchargement a échoué : on garde celle d'avant plutôt que de l'effacer sur une coupure.
    Keep,
}

/// `(choix, échec)` depuis le résultat du téléchargement — l'échec remonte à l'écran.
fn cover_choice(fetch: metadata::cover::CoverFetch) -> (CoverChoice, bool) {
    use metadata::cover::CoverFetch;
    match fetch {
        CoverFetch::Downloaded(p) => (CoverChoice::Set(p.to_string_lossy().into_owned()), false),
        CoverFetch::NoImage => (CoverChoice::Clear, false),
        CoverFetch::Failed(e) => {
            log::warn!("apply_release : pochette non téléchargée ({e}), celle d'avant est gardée");
            (CoverChoice::Keep, true)
        }
    }
}

/// Phase 1, sous le verrou : le chemin du fichier et la release d'avant, pour « Rétablir ».
fn release_prepare(
    conn: &Connection,
    track_id: i64,
) -> Result<(String, metadata::ReleaseSnapshot), String> {
    let path: String = conn
        .query_row(
            "SELECT path FROM tracks WHERE id=?1",
            rusqlite::params![track_id],
            |r| r.get(0),
        )
        .map_err(|_| "unknown track id".to_string())?;
    let before = metadata::snapshot_release(conn, track_id).map_err(|e| e.to_string())?;
    Ok((path, before))
}

/// Ce que la phase 2 a lu et écrit, pour la phase 3.
struct ReleaseWrite {
    /// Les tags d'AVANT, relus sur le fichier : c'est ce que « Rétablir » y remet.
    old_tags: TagsSnapshot,
    /// Une image reste-t-elle dans le fichier après l'écriture — la règle de `tracks.has_cover`.
    has_cover: bool,
    /// Le candidat tel qu'il a été ÉCRIT : complété des tags du fichier pour une première
    /// identification (`fill_from_file`), sinon le candidat lui-même. La base le reprend tel quel.
    effective: Candidate,
    /// La pochette telle qu'elle a été décidée ÉCRITE (une première identification ne vide pas).
    cover: CoverChoice,
    /// Ce que l'écriture a RETIRÉ du fichier — Rekordbox peut encore le porter (#81).
    removed: Vec<crate::actions::SyncField>,
}

/// Première identification — la piste n'a encore aucune release liée : ce que Discogs ne fournit
/// pas (label, année, genres) se reprend des tags du fichier. Revue de #68, 2026-09-29 : la
/// décision « Vider » vise une AUTRE release (« rien de l'ancienne release ne survit »), et les
/// tags d'un fichier acheté — sa pochette Beatport, son label — ne sont pas une release. Les vider
/// au premier choix perdait ce que l'ancien chemin (`write_tags_full`, qui ne fait que poser)
/// gardait.
fn fill_from_file(c: &Candidate, old: &TagsSnapshot) -> Candidate {
    let mut e = c.clone();
    if e.label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .is_none()
    {
        e.label = old.label.clone();
    }
    if e.year.filter(|y| *y > 0).is_none() {
        e.year = old.year;
    }
    if crate::tagging::joined_genres(&e.styles).is_none() {
        e.styles = old
            .genre_joined
            .as_deref()
            .map(|g| {
                g.split(';')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
    }
    e
}

/// Phase 2, verrou relâché : rend au fichier EXACTEMENT la release choisie, chaque champ posé OU
/// RETIRÉ (`restore_tags`). `write_tags_full` ne fait que poser : il laissait sur le fichier le
/// label, l'année ou la pochette de la release précédente quand la nouvelle n'en a pas
/// (décision « Vider », 2026-09-29, #68). `first` : la piste n'avait aucune release liée — rien
/// n'est alors vidé, ce qui manque se reprend du fichier (`fill_from_file`). Un échec avant
/// l'enregistrement laisse le fichier intact.
fn release_write_file(
    path: &str,
    c: &Candidate,
    title_tag: &str,
    cover: CoverChoice,
    first: bool,
) -> Result<ReleaseWrite, String> {
    let old_tags = crate::tagging::read_tags_full(path)?;
    let (effective, cover) = if first {
        let cover = match cover {
            CoverChoice::Clear => CoverChoice::Keep,
            other => other,
        };
        (fill_from_file(c, &old_tags), cover)
    } else {
        (c.clone(), cover)
    };
    let c = &effective;
    let cover_snap = match &cover {
        CoverChoice::Set(p) => Some(CoverSnap {
            mime: Some(
                if p.to_lowercase().ends_with(".png") {
                    "image/png"
                } else {
                    "image/jpeg"
                }
                .to_string(),
            ),
            bytes: std::fs::read(p).map_err(|e| format!("read cover {p}: {e}"))?,
        }),
        CoverChoice::Clear => None,
        CoverChoice::Keep => old_tags.cover.clone(),
    };
    let target = TagsSnapshot {
        artist: Some(c.artist.clone()),
        title: Some(title_tag.to_string()),
        label: c
            .label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string),
        year: c.year.filter(|y| *y > 0),
        genre_joined: crate::tagging::joined_genres(&c.styles),
        cover: cover_snap,
    };
    crate::tagging::restore_tags(path, &target)?;
    let removed = removed_fields(&old_tags, &target);
    // Le fichier est écrit : un échec de relecture ici ne doit pas priver l'écriture de son
    // journal (donc de son « Rétablir »). `has_cover` n'est qu'un drapeau que la prochaine analyse
    // recalcule — on prend la valeur attendue, et on le dit dans le journal.
    let has_cover = crate::tagging::has_any_picture(path).unwrap_or_else(|e| {
        log::error!("apply_release : relecture des images de {path} impossible ({e})");
        target.cover.is_some()
    });
    Ok(ReleaseWrite {
        old_tags,
        has_cover,
        effective,
        cover,
        removed,
    })
}

/// Les champs que le fichier portait et que la cible n'a plus : `restore_tags` vient de les
/// retirer, et Rekordbox, qui les a lus à l'import, les porte peut-être encore (#81).
fn removed_fields(old: &TagsSnapshot, target: &TagsSnapshot) -> Vec<crate::actions::SyncField> {
    use crate::actions::SyncField;
    let had = |v: &Option<String>| v.as_deref().is_some_and(|s| !s.trim().is_empty());
    let mut out = Vec::new();
    if had(&old.label) && !had(&target.label) {
        out.push(SyncField::Label);
    }
    if crate::actions::sync_year(old.year).is_some()
        && crate::actions::sync_year(target.year).is_none()
    {
        out.push(SyncField::Year);
    }
    if had(&old.genre_joined) && !had(&target.genre_joined) {
        out.push(SyncField::Genre);
    }
    if old.cover.is_some() && target.cover.is_none() {
        out.push(SyncField::Cover);
    }
    out
}

/// Phase 3, sous le verrou : la base suit le fichier, et le tout se journalise en UN `tag_edit`
/// dont le `meta` porte, à côté des tags d'avant, la release d'avant (`release`). « Rétablir » rend
/// alors le fichier ET le lien de release (décision du 2026-09-29) — l'ancien chemin,
/// `apply_identity_cmd` puis `apply_tags`, ne rendait que les tags et gardait la release annulée.
fn release_commit(
    conn: &Connection,
    track_id: i64,
    path: &str,
    shown: &Canonical,
    cover_failed: bool,
    before: &metadata::ReleaseSnapshot,
    written: ReleaseWrite,
) -> Result<AppliedRelease, String> {
    let c = &written.effective;
    let cover = written.cover;
    // EN PREMIER sous le verrou : le watcher décante ~500 ms après l'écriture (issue #73).
    crate::scanner::restamp_after_own_write(conn, track_id, path).map_err(|e| e.to_string())?;
    let artwork = match &cover {
        CoverChoice::Set(p) => Some(p.clone()),
        _ => None,
    };
    // #81 : la release n'a pas d'image, la pochette vient d'être retirée du fichier. Une candidate
    // pochette de la release d'avant, restée en attente, aurait poussé l'ancienne image dans
    // Rekordbox — lié ou non, elle n'a plus lieu d'être.
    if matches!(cover, CoverChoice::Clear) {
        crate::actions::drop_pending_artwork_sync(conn, track_id);
    }
    let cover_path = match cover {
        CoverChoice::Set(p) => Some(p),
        CoverChoice::Clear => None,
        CoverChoice::Keep => before.row.as_ref().and_then(|r| r.cover_path.clone()),
    };
    let applied =
        metadata::apply_identity(conn, track_id, c, cover_path).map_err(|e| e.to_string())?;
    // Titre et version tels que l'écran les montre, dans la forme de `persist_tag_edit`.
    metadata::persist_tag_edit(conn, track_id, shown, None).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET has_cover=?2 WHERE id=?1",
        rusqlite::params![track_id, written.has_cover],
    )
    .map_err(|e| e.to_string())?;

    let mut meta = serde_json::to_value(&written.old_tags).map_err(|e| e.to_string())?;
    let release = serde_json::to_value(before).map_err(|e| e.to_string())?;
    meta.as_object_mut()
        .ok_or_else(|| "tag snapshot is not a JSON object".to_string())?
        .insert("release".into(), release);
    let batch_id = crate::filing::new_batch_id(track_id);
    let action_id = crate::actions::record_with_meta(
        conn,
        &batch_id,
        Some(track_id),
        "tag_edit",
        Some(path),
        None,
        Some(&meta.to_string()),
    )
    .map_err(|e| e.to_string())?;

    // M8 Tier 3 : mêmes détecteurs, en lecture seule, qu'`apply_tags` — un seul déchiffrement.
    let (genre, label) = crate::actions::sanitize_genre_label(&c.styles, c.label.as_deref());
    let values = crate::actions::MetadataSyncValues {
        artist: Some(c.artist.clone()),
        title: Some(crate::naming::tag_title(shown)),
        label,
        year: crate::actions::sync_year(c.year),
        genre,
        cleared: written.removed.clone(),
        cover_set: artwork.is_some(),
    };
    // #81 : la mémoire de ce que Rekordbox peut garder se tient lié ou non — un lien posé plus
    // tard doit la trouver.
    crate::actions::record_sync_debt(conn, track_id, &values);
    if let Some(index) = crate::actions::resolve_masterdb_index_if_linked(conn) {
        crate::actions::detect_masterdb_metadata_sync_with_index(
            conn, &index, path, track_id, &values, action_id,
        );
        if let Some(cp) = &artwork {
            crate::actions::detect_masterdb_artwork_sync_with_index(
                conn, &index, path, track_id, cp, action_id,
            );
        }
    }

    Ok(AppliedRelease {
        label: applied.label,
        year: applied.year,
        styles: applied.styles,
        cover_path: applied.cover_path,
        cover_failed,
        batch_id,
    })
}

/// Aucune release liée avant ce choix : ni ligne `metadata`, ni lien Discogs sur celle qui existe
/// (une édition de label seule, une fiche Bibliothèque saisie à la main).
fn is_first_identification(before: &metadata::ReleaseSnapshot) -> bool {
    before
        .row
        .as_ref()
        .and_then(|r| r.discogs_release_id.as_deref())
        .is_none()
}

/// Le titre et la version que l'écran affiche pour la release choisie, en `Canonical`.
fn shown_canonical(
    c: &Candidate,
    title: &str,
    version: Option<String>,
) -> Result<Canonical, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("apply_release: empty title".into());
    }
    Ok(Canonical {
        artist: c.artist.clone(),
        title: title.to_string(),
        version: version
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        label: c.label.clone(),
        confidence: Confidence::Green,
    })
}

/// Applique une release à une piste (#68) : la première identification comme un changement de
/// release. Fichier ET base, en un seul lot annulable — remplace `apply_identity_cmd` (base seule)
/// suivi d'`apply_tags` (fichier seul, par-dessus), dont le « Rétablir » rendait les tags mais
/// gardait la release annulée, et qui laissait sur le fichier le label ou la pochette d'une release
/// précédente quand la nouvelle n'en avait pas.
///
/// `title` et `version` sont ceux que l'écran affiche pour ce candidat : Revue les sépare, la
/// Bibliothèque envoie son titre complet et `version: null`. Ils sont gravés tels quels, pour que
/// le fichier, la base et l'écran disent la même chose sans que personne ne recalcule rien.
///
/// SYNCHRONE, comme `apply_identity_cmd` avant elle : le téléchargement de la pochette (20 s au
/// pire) et la réécriture du fichier tiennent le fil de la fenêtre. La passer en `async` serait
/// une TROISIÈME exception au backend synchrone (`CLAUDE.md` § Backend) — une décision, pas un
/// suivi de motif ; elle n'a pas été prise ici.
#[tauri::command]
pub fn apply_release(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
    candidate: Candidate,
    title: String,
    version: Option<String>,
) -> Result<AppliedRelease, String> {
    let shown = shown_canonical(&candidate, &title, version)?;
    let (path, before) = {
        let conn = db::lock_conn(&conn)?;
        release_prepare(&conn, track_id)?
    };
    let first = is_first_identification(&before);
    let (cover, cover_failed) = match app.path().app_cache_dir() {
        Ok(dir) => cover_choice(metadata::cover::fetch_cover(
            &dir.join("covers"),
            &candidate.release_id,
            candidate.cover_url.as_deref(),
        )),
        Err(e) => cover_choice(metadata::cover::CoverFetch::Failed(e.to_string())),
    };
    let written = release_write_file(
        &path,
        &candidate,
        &crate::naming::tag_title(&shown),
        cover,
        first,
    )?;
    let applied = {
        let conn = db::lock_conn(&conn)?;
        release_commit(
            &conn,
            track_id,
            &path,
            &shown,
            cover_failed,
            &before,
            written,
        )?
    };
    app.emit("queue:changed", ()).ok();
    Ok(applied)
}

/// Les trois phases d'`apply_release` dans le même ordre, sur une seule connexion et avec une
/// pochette déjà décidée — les tests n'ont ni `AppHandle` ni réseau. `cfg(test)` : la production
/// ne doit pas avoir de chemin qui tienne la connexion pendant l'écriture du fichier.
#[cfg(test)]
fn apply_release_inner(
    conn: &Connection,
    track_id: i64,
    c: &Candidate,
    title: &str,
    version: Option<&str>,
    cover: CoverChoice,
) -> Result<AppliedRelease, String> {
    let shown = shown_canonical(c, title, version.map(str::to_string))?;
    let (path, before) = release_prepare(conn, track_id)?;
    let first = is_first_identification(&before);
    let written = release_write_file(&path, c, &crate::naming::tag_title(&shown), cover, first)?;
    release_commit(conn, track_id, &path, &shown, false, &before, written)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une fixture audio réelle, ou `None`. `src-tauri/fixtures/*` est gitignoré (CLAUDE.md) : les
    /// tests qui en dépendent se sautent au lieu d'échouer sur un checkout frais.
    fn fixture(name: &str) -> Option<std::path::PathBuf> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name);
        p.exists().then_some(p)
    }

    /// Le cas majoritaire de la bibliothèque mesurée : nom sale, AUCUN tag (79,3 % des fichiers
    /// dont le nom échoue à `parse_filename`, mesuré le 2026-07-28 sur 300 tirés au hasard).
    /// C'est exactement la population que l'ancienne implémentation envoyait à Discogs avec un
    /// artiste vide et sans repli possible.
    fn hint(artist: &str, title: &str, version: Option<&str>) -> IdentifyHint {
        IdentifyHint {
            artist: artist.into(),
            title: title.into(),
            version: version.map(Into::into),
        }
    }

    /// Issue #74 : `identify` ne doit plus jamais s'exécuter sur le fil de la fenêtre. Test de
    /// SOURCE, pour la raison écrite au-dessus d'`ipc::tests::analyze_path_reste_hors_du_fil_de_la_fenetre`
    /// (exercer le vrai chemin demanderait la feature Cargo `test` de `tauri`, une décision de
    /// dépendance). Solidaire de `cargo fmt --check`, qui fige la forme des lignes cherchées.
    #[test]
    fn identify_reste_hors_du_fil_de_la_fenetre() {
        let source = include_str!("ipc_identify.rs");
        assert!(
            source.contains("pub async fn identify("),
            "`identify` n'est plus `async` : toute la recherche Discogs regèlerait l'IPC de la \
             fenêtre (mesuré : 1,3 s ; jusqu'à 13 × 15 s au pire)"
        );
        let debut = source
            .find("pub async fn identify(")
            .expect("signature déjà vérifiée présente");
        let corps = &source[debut..];
        let fin = corps
            .find("fn identify_bloquant(")
            .expect("le corps synchrone doit suivre la commande");
        let commande = &corps[..fin];
        assert!(
            commande.contains("tauri::async_runtime::spawn_blocking("),
            "la commande ne délègue plus à `spawn_blocking`"
        );
        assert!(
            commande.contains("identify_bloquant("),
            "la commande n'appelle plus le corps synchrone extrait"
        );
        assert!(
            !commande.contains(".unwrap()") && !commande.contains(".expect("),
            "interdiction dure du dépôt hors #[cfg(test)]"
        );
    }

    #[test]
    fn identify_hint_shape_matches_contracts_ts() {
        let IdentifyHint {
            artist,
            title,
            version,
        } = hint("", "", None);
        let _ = (artist, title, version);
    }

    /// Issue #66, le cas réel : tags « Cherry Bomb » / « Elastic  (Original Mix) », nom Beatport.
    /// La fenêtre ENVOYÉE (pas l'échelle entière — c'est ce trou qui avait laissé passer le bug)
    /// commence par les mots qu'Antoine tape lui-même, et aucun mot n'y porte de « - » de tête.
    #[test]
    fn the_sent_window_starts_with_what_a_human_would_type() {
        let terms = crate::search_terms::build("Cherry-Bomb---Elastic-(Original-Mix)", "complete");
        let q = build_query_from(&terms, "Cherry Bomb", "Elastic  (Original Mix)", None);
        assert_eq!(q.title, "Elastic", "titre de requête sans version");
        assert_eq!(q.version.as_deref(), Some("Original Mix"));
        let sent = metadata::discogs::Discogs { token: "t".into() }.attempts_for(&q);
        assert_eq!(
            sent.first().map(String::as_str),
            Some("Cherry Bomb Elastic")
        );
        for a in &sent {
            assert!(a.split_whitespace().all(|w| !w.starts_with('-')), "{a:?}");
        }
    }

    /// Issue #67 : ce que l'écran affiche prime sur les tags ET sur le nom, sans portail junk.
    #[test]
    fn the_screen_wins_over_tags_and_filename() {
        let terms = crate::search_terms::build("01_audio_320", "complete");
        let q = build_query_from(
            &terms,
            "Wrong Artist",
            "Wrong Title",
            Some(&hint("Jay Tripwire", "Nine", Some("Dub"))),
        );
        assert_eq!(
            (q.artist.as_str(), q.title.as_str(), q.version.as_deref()),
            ("Jay Tripwire", "Nine", Some("Dub"))
        );
        // « Dub » est un vrai mix : il part en premier.
        assert_eq!(q.attempts[0], "Jay Tripwire Nine Dub");
        assert_eq!(q.attempts[1], "Jay Tripwire Nine");
    }

    /// Relecture #66 : un vrai remix se cherche AVEC sa version d'abord ; « Original Mix » après.
    #[test]
    fn a_real_mix_is_searched_first_a_default_version_last() {
        let terms = crate::search_terms::build("x", "complete");
        let q = build_query_from(&terms, "Blaze", "Lovelee Dae (Joe Claussell Remix)", None);
        assert_eq!(q.attempts[0], "Blaze Lovelee Dae Joe Claussell Remix");
        assert_eq!(q.attempts[1], "Blaze Lovelee Dae");
        let q = build_query_from(&terms, "Blaze", "Lovelee Dae (Original-Mix)", None);
        assert_eq!(q.attempts[0], "Blaze Lovelee Dae");
        assert!(is_default_version("Original Mix") && is_default_version("original"));
        assert!(!is_default_version("Mix") && !is_default_version("Original Dub"));
    }

    /// Le formulaire de la Bibliothèque envoie le titre COMPLET : sa version se détache. Un titre
    /// seul, artiste inconnu, est cherché quand même.
    #[test]
    fn a_complete_title_is_split_and_a_title_alone_is_searched() {
        let terms = crate::search_terms::build("x", "complete");
        let q = build_query_from(
            &terms,
            "",
            "",
            Some(&hint("", "Elastic (Original Mix)", None)),
        );
        assert_eq!(q.title, "Elastic");
        assert_eq!(q.version.as_deref(), Some("Original Mix"));
        assert_eq!(q.attempts[0], "Elastic");
    }

    /// Un indice au titre vide ne remplace rien : les tags puis le nom reprennent la main.
    #[test]
    fn an_empty_hint_falls_back_to_tags() {
        let terms = crate::search_terms::build("x", "complete");
        let q = build_query_from(
            &terms,
            "Larry Heard",
            "Mystery of Love",
            Some(&hint("", "  ", None)),
        );
        assert_eq!(q.attempts[0], "Larry Heard Mystery of Love");
    }

    #[test]
    fn dirty_name_without_tags_falls_back_to_search_terms() {
        let q = build_query(
            "/dl/complete/01_infunktuation_-_feel_real_good_(club_version)-idc.mp3",
            None,
        );
        assert_eq!(q.artist, "infunktuation");
        assert_eq!(q.title, "feel real good");
        assert_eq!(q.version.as_deref(), Some("club version"));
        assert!(
            !q.attempts.is_empty(),
            "un titre non vide doit toujours produire au moins un essai"
        );
    }

    /// Le dossier parent est la seule source d'artiste pour 243 pistes de la bibliothèque mesurée.
    /// Sans ce chemin, `A1-Stepback` partait en requête titre-seul.
    #[test]
    fn parent_folder_supplies_the_artist_when_the_name_has_none() {
        let q = build_query("/rips/(SOMA 21) Slam-Snapshots/A1-Stepback.aiff", None);
        assert_eq!(q.artist, "Slam");
        assert_eq!(q.title, "Stepback");
    }

    /// Garde-fou inverse, et le plus important des deux : un dossier fourre-tout ne doit JAMAIS
    /// injecter son nom comme artiste. `2_040924` porte 524 pistes — s'y tromper, c'est envoyer
    /// 524 requêtes fausses d'un coup.
    #[test]
    fn a_meaningless_folder_never_becomes_the_artist() {
        let q = build_query("/dl/2_040924/[BU 002] DJ Gregory - Freeze.mp3", None);
        assert_eq!(q.artist, "DJ Gregory");
        assert_eq!(q.title, "Freeze");
        let q2 = build_query("/dl/complete/01 Awaken Abyss.mp3", None);
        assert_eq!(
            q2.artist, "",
            "aucun artiste dérivable: le vide est correct"
        );
        assert_eq!(q2.title, "Awaken Abyss");
    }

    /// La cascade doit rester non vide même sans artiste — c'est tout l'objet du chantier : la
    /// garde retirée de `discogs.rs` excluait précisément ce cas de tout repli.
    #[test]
    fn ladder_is_never_empty_when_a_title_exists() {
        let q = build_query("/dl/complete/01 Give U Love (Deep Mix).mp3", None);
        assert_eq!(q.artist, "");
        assert!(
            q.attempts.len() >= 2,
            "sans artiste, il faut au moins titre+version puis titre: {:?}",
            q.attempts
        );
    }

    /// Entrées hostiles : `build_query` reçoit des chemins venant du disque de l'utilisateur, elle
    /// ne doit jamais paniquer ni produire une requête vide mais présente.
    #[test]
    fn hostile_paths_never_panic_and_never_emit_a_blank_attempt() {
        for p in [
            "",
            "/",
            "/a",
            "/dl//.mp3",
            "/dl/02 [2015]/001_Untitled.mp3",
            "/dl/The Tracking System/A8.wav",
        ] {
            let q = build_query(p, None);
            assert!(
                q.attempts.iter().all(|a| !a.trim().is_empty()),
                "essai vide produit pour {p:?}: {:?}",
                q.attempts
            );
        }
    }

    /// Des tags PROPRES priment sur le nom de fichier : ils ont pu être corrigés à la main, et
    /// aucune analyse de nom ne bat une donnée saisie. La version, elle, continue de venir du nom
    /// — les tags la portent rarement dans un champ séparé.
    #[test]
    fn clean_tags_win_over_the_filename_but_the_version_still_comes_from_it() {
        let Some(src) = fixture("real_320.mp3") else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("complete");
        std::fs::create_dir_all(&sub).unwrap();
        // Nom de fichier volontairement DIVERGENT des tags, et porteur d'une version.
        let dst = sub.join("01_wrong_artist_-_wrong_title_(Club Mix).mp3");
        std::fs::copy(&src, &dst).unwrap();
        let dst_s = dst.to_str().unwrap();
        crate::tagging::write_tags_full(
            dst_s,
            "Larry Heard",
            "Mystery of Love",
            None,
            None,
            &[],
            None,
        )
        .expect("write tags");

        let q = build_query(dst_s, None);
        assert_eq!(q.artist, "Larry Heard", "les tags propres priment");
        assert_eq!(q.title, "Mystery of Love");
        assert_eq!(
            q.version.as_deref(),
            Some("Club Mix"),
            "la version vient du nom de fichier même quand les tags gagnent"
        );
        assert_eq!(
            q.attempts.first().map(|s| s.as_str()),
            Some("Larry Heard Mystery of Love"),
            "le premier essai est celui des tags"
        );
    }

    // ---- #68 : apply_release ------------------------------------------------------------------

    fn release(id: &str, label: Option<&str>, year: Option<i64>, styles: &[&str]) -> Candidate {
        Candidate {
            artist: "Larry Heard".into(),
            title: "Mystery of Love".into(),
            label: label.map(str::to_string),
            year,
            styles: styles.iter().map(|s| s.to_string()).collect(),
            country: None,
            format: None,
            cover_url: None,
            release_id: id.into(),
            source: "discogs".into(),
        }
    }

    /// Une piste en base sur une COPIE de la fixture, et une pochette en cache (octets
    /// quelconques : lofty l'embarque sans la décoder). `None` sans la fixture, gitignorée.
    fn release_setup() -> Option<(tempfile::TempDir, rusqlite::Connection, String, String)> {
        let src = fixture("real_320.mp3")?;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("t.mp3");
        std::fs::copy(&src, &file).unwrap();
        let cover = dir.path().join("A.jpg");
        std::fs::write(&cover, vec![7u8; 4096]).unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let path = file.to_str().unwrap().to_string();
        conn.execute(
            "INSERT INTO tracks(id, path, status) VALUES(1, ?1, 'pending')",
            [&path],
        )
        .unwrap();
        Some((dir, conn, path, cover.to_str().unwrap().to_string()))
    }

    /// Décision « Vider » (2026-09-29) : ce que la nouvelle release n'a pas disparaît du fichier ET
    /// de la base — l'ancien chemin (`write_tags_full`) ne faisait que poser, et le label, l'année,
    /// les genres et la pochette de la release précédente restaient sur le fichier.
    #[test]
    fn changer_de_release_vide_ce_que_la_nouvelle_n_a_pas() {
        let Some((_dir, conn, path, cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let a = release(
            "A",
            Some("Alleviated"),
            Some(1986),
            &["Deep House", "House"],
        );
        apply_release_inner(
            &conn,
            1,
            &a,
            "Mystery of Love",
            Some("Original Mix"),
            CoverChoice::Set(cover),
        )
        .unwrap();
        let tags = crate::tagging::read_tags_full(&path).unwrap();
        assert_eq!(
            tags.title.as_deref(),
            Some("Mystery of Love (Original Mix)")
        );
        assert_eq!(tags.label.as_deref(), Some("Alleviated"));
        assert_eq!(tags.year, Some(1986));
        assert_eq!(tags.genre_joined.as_deref(), Some("Deep House; House"));
        assert!(tags.cover.is_some());

        let b = release("B", None, None, &[]);
        let out =
            apply_release_inner(&conn, 1, &b, "Mystery of Love", None, CoverChoice::Clear).unwrap();
        let tags = crate::tagging::read_tags_full(&path).unwrap();
        assert_eq!(tags.title.as_deref(), Some("Mystery of Love"));
        assert_eq!(
            (tags.label, tags.year, tags.genre_joined, tags.cover),
            (None, None, None, None),
            "le fichier garde un champ de la release A"
        );
        let snap = metadata::snapshot_release(&conn, 1).unwrap();
        let row = snap.row.unwrap();
        assert_eq!(row.discogs_release_id.as_deref(), Some("B"));
        assert_eq!((row.label, row.year, row.cover_path), (None, None, None));
        assert_eq!(
            row.version.as_deref(),
            Some(""),
            "« aucune version », voulu"
        );
        assert!(snap.genres.is_empty());
        assert_eq!(snap.has_cover, Some(false));
        assert_eq!(out.cover_path, None);
        assert!(!out.cover_failed);
    }

    /// #81 : ce que l'écriture retire du fichier, nommé pour la synchro Rekordbox — et seulement ça.
    #[test]
    fn removed_fields_nomme_ce_que_le_fichier_perd() {
        use crate::actions::SyncField;
        let old = TagsSnapshot {
            artist: Some("A".into()),
            title: Some("T".into()),
            label: Some("Trax".into()),
            year: Some(1987),
            genre_joined: Some("House".into()),
            cover: Some(CoverSnap {
                mime: None,
                bytes: vec![1],
            }),
        };
        let mut target = old.clone();
        assert!(removed_fields(&old, &target).is_empty());
        target.label = None;
        target.year = Some(0);
        target.cover = None;
        assert_eq!(
            removed_fields(&old, &target),
            vec![SyncField::Label, SyncField::Year, SyncField::Cover]
        );
        target.genre_joined = Some("  ".into());
        assert_eq!(
            removed_fields(&old, &target).len(),
            4,
            "un genre blanc est un genre vidé"
        );
    }

    /// #81 : une release sans image retire la candidate pochette ENCORE EN ATTENTE de la release
    /// précédente — sinon l'appliquer poussait l'ancienne image vers Rekordbox, déjà périmée.
    #[test]
    fn une_release_sans_image_retire_la_pochette_en_attente() {
        let Some((_dir, conn, _path, cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let a = release("A", Some("Alleviated"), Some(1986), &["Deep House"]);
        let out = apply_release_inner(
            &conn,
            1,
            &a,
            "Mystery of Love",
            None,
            CoverChoice::Set(cover),
        )
        .unwrap();
        let aid: i64 = conn
            .query_row(
                "SELECT id FROM actions WHERE batch_id=?1",
                [&out.batch_id],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO rekordbox_masterdb_artwork_syncs(action_id, track_id, rekordbox_track_id, cover_path, status)
             VALUES(?1, 1, '1', '/cache/A.jpg', 'pending')",
            [aid],
        )
        .unwrap();
        let b = release("B", None, None, &[]);
        apply_release_inner(&conn, 1, &b, "Mystery of Love", None, CoverChoice::Clear).unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT count(*) FROM rekordbox_masterdb_artwork_syncs WHERE track_id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
    }

    /// Revue de #68 : une PREMIÈRE identification ne vide rien. Ce que Discogs n'a pas — label,
    /// année, genres, pochette — reste celui du fichier (un achat Beatport porte sa pochette), et
    /// la base et l'écran le reprennent. Seul un CHANGEMENT de release vide (test précédent).
    #[test]
    fn une_premiere_identification_garde_ce_que_le_fichier_avait() {
        let Some((dir, conn, path, _cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let art = dir.path().join("achat.jpg");
        std::fs::write(&art, vec![9u8; 4096]).unwrap();
        crate::tagging::write_tags_full(
            &path,
            "x",
            "y",
            Some("Trax"),
            Some(2019),
            &["House".to_string(), "Acid".to_string()],
            Some(art.to_str().unwrap()),
        )
        .unwrap();
        let before = crate::tagging::read_tags_full(&path).unwrap();

        let a = release("A", None, None, &[]);
        let out =
            apply_release_inner(&conn, 1, &a, "Mystery of Love", None, CoverChoice::Clear).unwrap();
        let tags = crate::tagging::read_tags_full(&path).unwrap();
        assert_eq!(tags.title.as_deref(), Some("Mystery of Love"));
        assert_eq!(
            (tags.label, tags.year, tags.genre_joined, tags.cover),
            (before.label, before.year, before.genre_joined, before.cover),
            "une première identification a vidé un champ du fichier"
        );
        assert_eq!(out.label.as_deref(), Some("Trax"));
        assert_eq!(out.year, Some(2019));
        assert_eq!(out.styles, vec!["House".to_string(), "Acid".to_string()]);
        let snap = metadata::snapshot_release(&conn, 1).unwrap();
        let row = snap.row.unwrap();
        assert_eq!((row.label.as_deref(), row.year), (Some("Trax"), Some(2019)));
        assert_eq!(snap.genres, vec!["House".to_string(), "Acid".to_string()]);
        assert_eq!(snap.has_cover, Some(true));
    }

    /// Une ligne `metadata` SANS lien Discogs — un label saisi à la main en Revue — n'est pas une
    /// release : le premier choix reste une première identification, et ne vide pas le fichier.
    #[test]
    fn une_ligne_sans_lien_discogs_n_est_pas_une_release() {
        let Some((dir, conn, path, _cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let art = dir.path().join("achat.jpg");
        std::fs::write(&art, vec![9u8; 4096]).unwrap();
        crate::tagging::write_tags_full(
            &path,
            "x",
            "y",
            None,
            None,
            &[],
            Some(art.to_str().unwrap()),
        )
        .unwrap();
        metadata::set_metadata_label(&conn, 1, "Saisi").unwrap();
        let cover_before = crate::tagging::read_tags_full(&path).unwrap().cover;

        let a = release("A", None, None, &[]);
        apply_release_inner(&conn, 1, &a, "Mystery of Love", None, CoverChoice::Clear).unwrap();
        assert_eq!(
            crate::tagging::read_tags_full(&path).unwrap().cover,
            cover_before,
            "une ligne sans lien a été prise pour une release, et la pochette du fichier vidée"
        );
    }

    /// Décision « Fichier et release » (2026-09-29) : « Rétablir » après un changement A → B rend
    /// le fichier ET la ligne de A — lien Discogs, pochette et genres compris. L'ancien chemin
    /// rendait les tags et gardait B en base.
    #[test]
    fn retablir_rend_le_fichier_et_la_release_d_avant() {
        let Some((_dir, conn, path, cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let a = release("A", Some("Alleviated"), Some(1986), &["Deep House"]);
        apply_release_inner(
            &conn,
            1,
            &a,
            "Mystery of Love",
            None,
            CoverChoice::Set(cover),
        )
        .unwrap();
        let tags_a = crate::tagging::read_tags_full(&path).unwrap();
        let release_a = metadata::snapshot_release(&conn, 1).unwrap();

        let b = release("B", Some("Trax"), None, &["Acid"]);
        let out =
            apply_release_inner(&conn, 1, &b, "Can You Feel It", None, CoverChoice::Clear).unwrap();
        crate::actions::revert_batch(&conn, &out.batch_id).unwrap();

        assert_eq!(crate::tagging::read_tags_full(&path).unwrap(), tags_a);
        assert_eq!(metadata::snapshot_release(&conn, 1).unwrap(), release_a);
    }

    /// Rétablir une PREMIÈRE identification rend une piste sans ligne `metadata` — une ligne vide
    /// compterait encore comme une identité — et un fichier à ses tags d'origine.
    #[test]
    fn retablir_une_premiere_identification_supprime_la_ligne() {
        let Some((_dir, conn, path, cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let tags0 = crate::tagging::read_tags_full(&path).unwrap();
        let a = release("A", Some("Alleviated"), Some(1986), &["Deep House"]);
        let out = apply_release_inner(
            &conn,
            1,
            &a,
            "Mystery of Love",
            None,
            CoverChoice::Set(cover),
        )
        .unwrap();
        crate::actions::revert_batch(&conn, &out.batch_id).unwrap();
        assert_eq!(crate::tagging::read_tags_full(&path).unwrap(), tags0);
        assert_eq!(metadata::snapshot_release(&conn, 1).unwrap().row, None);
    }

    /// Une PANNE de téléchargement n'efface pas la pochette : le fichier garde ses octets, la base
    /// garde son chemin. Vider sur une coupure réseau détruirait ce qu'on avait.
    #[test]
    fn une_panne_de_pochette_garde_celle_d_avant() {
        let Some((_dir, conn, path, cover)) = release_setup() else {
            eprintln!("skip: fixture real_320.mp3 absente (gitignoree, cf. CLAUDE.md)");
            return;
        };
        let a = release("A", Some("Alleviated"), Some(1986), &["Deep House"]);
        apply_release_inner(
            &conn,
            1,
            &a,
            "Mystery of Love",
            None,
            CoverChoice::Set(cover.clone()),
        )
        .unwrap();
        let cover_a = crate::tagging::read_tags_full(&path).unwrap().cover;
        let b = release("B", None, None, &[]);
        let out =
            apply_release_inner(&conn, 1, &b, "Mystery of Love", None, CoverChoice::Keep).unwrap();
        assert_eq!(
            crate::tagging::read_tags_full(&path).unwrap().cover,
            cover_a
        );
        assert_eq!(out.cover_path.as_deref(), Some(cover.as_str()));
        let snap = metadata::snapshot_release(&conn, 1).unwrap();
        assert_eq!(snap.has_cover, Some(true));
    }

    #[test]
    fn la_pochette_se_decide_sur_le_resultat_du_telechargement() {
        use metadata::cover::CoverFetch;
        assert_eq!(
            cover_choice(CoverFetch::Downloaded("/c/1.jpg".into())),
            (CoverChoice::Set("/c/1.jpg".into()), false)
        );
        assert_eq!(
            cover_choice(CoverFetch::NoImage),
            (CoverChoice::Clear, false)
        );
        assert_eq!(
            cover_choice(CoverFetch::Failed("timeout".into())),
            (CoverChoice::Keep, true)
        );
    }

    #[test]
    fn un_titre_vide_est_refuse_avant_toute_ecriture() {
        assert!(shown_canonical(&release("A", None, None, &[]), "  ", None).is_err());
    }

    #[test]
    fn applied_release_shape_matches_contracts_ts() {
        let AppliedRelease {
            label,
            year,
            styles,
            cover_path,
            cover_failed,
            batch_id,
        } = AppliedRelease {
            label: None,
            year: None,
            styles: Vec::new(),
            cover_path: None,
            cover_failed: false,
            batch_id: String::new(),
        };
        let _ = (label, year, styles, cover_path, cover_failed, batch_id);
    }
}
