//! Présence Rekordbox d'un fichier de Sift : Rekordbox le joue-t-il, et dans combien de
//! playlists ? Brique de l'écran Doublons (lot 1, décidé par Antoine le 2026-10-05) : une copie
//! que Rekordbox joue est gardée par défaut, et la confirmation propose de garder aussi les N
//! copies que Rekordbox joue. **Lecture seule** : rien ici n'écrit dans Rekordbox.
//!
//! # La source, et pourquoi
//!
//! 1. **`master.db`** quand il se lit : c'est la bibliothèque que Rekordbox joue, celle de
//!    l'instant. Lu par le lecteur M8 (`rekordbox_masterdb::read_track_playlists`), dont le
//!    déchiffrement est mis en cache et partagé avec l'écran Rekordbox.
//! 2. **Sinon le XML lié.** Un instantané exporté à la main, biaisé dans les deux sens : il ignore
//!    ce qui a été importé dans Rekordbox après l'export (absent à tort), et
//!    `ipc_library::export_rekordbox_xml` y fusionne les pistes rangées par Sift, chacune dans la
//!    playlist de son dossier (présente à tort). Le second biais garde une copie de trop ; le
//!    premier propose à la suppression une copie que Rekordbox joue — d'où son rang de repli, et
//!    une réponse qui dit toujours de quelle source elle sort ([`RekordboxPresence::source`]).
//! 3. **Sinon : inconnu.** Jamais « absent » faute de source : absent est une affirmation, et
//!    « 0 playlist » un nombre — ni l'un ni l'autre ne se dit sans avoir lu.
//!
//! Le premier biais n'est pas théorique. Mesuré le 2026-10-05 sur des copies des vraies données
//! (`tests::mesure_sur_copies_reelles`) : sur 3 461 pistes de Sift, `master.db` en reconnaît 536 ;
//! le XML lié, exporté le 2026-07-10, 297 seulement — les 239 autres, il les dirait absentes. Sur
//! les 297 communes, les deux sources donnent le même nombre de playlists, piste par piste. Le
//! second biais, lui, est nul dans ce XML-là : aucune de ses 2 828 pistes n'a la forme qu'écrit
//! un export de Sift.
//!
//! Le XML lié reste le signal d'opt-in de toute l'intégration Rekordbox, comme en M8
//! (`actions::masterdb_path_if_linked`) : sans lui, `master.db` n'est pas lu non plus.
//!
//! # Deux moitiés, pour le verrou
//!
//! [`presence_sources`] lit un réglage : assez rapide pour tenir sous le verrou global de la base.
//! [`rekordbox_presence`] lit le disque et ne touche jamais la base : à froid il déchiffre
//! `master.db` (≈ 0,2 s mesurées, chiffres dans sa doc), donc à appeler verrou relâché et hors du
//! fil de la fenêtre. Même découpe que `actions::masterdb_path_if_linked` /
//! `actions::read_masterdb_index`.
//!
//! # Une passe
//!
//! Toute la collection est lue d'un coup et indexée par clé de chemin ; [`RekordboxPresence::of`]
//! n'est ensuite qu'une recherche dans une table, jamais une requête par piste.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// Ce que Sift sait de la présence d'UN fichier dans Rekordbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Presence {
    /// La source lue ne référence pas ce fichier.
    Absent,
    /// La source lue référence ce fichier. `playlists` compte les playlists DISTINCTES qui le
    /// contiennent ; 0 = dans la collection, dans aucune playlist — Rekordbox le joue quand même.
    Present { playlists: u32 },
    /// Aucune source lisible : ni présent ni absent. La cause : [`RekordboxPresence::unavailable`].
    Unknown,
}

/// La source d'une réponse connue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PresenceSource {
    /// `master.db`. `wal_pending` : un `master.db-wal` non vide l'accompagne — Rekordbox est
    /// ouvert (ou s'est mal fermé), et ses derniers changements, pas encore reportés dans le
    /// fichier principal, ne sont pas lus. Un « absent » peut alors ignorer une piste importée
    /// pendant la session en cours.
    MasterDb { wal_pending: bool },
    /// Le XML lié, faute de `master.db` (`masterdb` dit pourquoi). Un instantané d'export : voir
    /// la doc du module pour ses deux biais.
    LinkedXml { masterdb: MasterDbUnavailable },
}

/// Pourquoi `master.db` n'a pas servi.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MasterDbUnavailable {
    /// L'OS ne donne pas de dossier de configuration : l'emplacement de `master.db` est inconnu.
    NoLocation,
    /// Rien à l'emplacement standard : Rekordbox n'est pas installé sur cette machine.
    Missing,
    /// Le fichier existe mais ne se lit pas (taille, HMAC, SQLite…). Détail de diagnostic, pas un
    /// libellé d'interface.
    Unreadable(String),
}

/// Pourquoi rien n'est connu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Unavailable {
    /// Aucun XML Rekordbox lié : l'intégration n'est pas activée, rien n'est lu.
    NotLinked,
    /// Ni `master.db` ni le XML lié ne se lisent. `xml` : détail de diagnostic.
    Unreadable {
        masterdb: MasterDbUnavailable,
        xml: String,
    },
}

/// Où lire : la moitié « base » de la résolution, rendue par [`presence_sources`]. Champs ouverts
/// pour qu'un appelant (ou un test) puisse désigner des copies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PresenceSources {
    /// `settings::REKORDBOX_XML_PATH` ; `None` = aucun XML lié, intégration Rekordbox inactive.
    pub(crate) linked_xml: Option<PathBuf>,
    /// `master.db` à son emplacement standard (`actions::rekordbox_pioneer_dir`) ; `None` quand
    /// l'OS ne donne pas de dossier de configuration.
    pub(crate) masterdb: Option<PathBuf>,
}

/// La présence Rekordbox de toute une collection, lue en une passe par [`rekordbox_presence`].
#[derive(Debug, Clone)]
pub(crate) struct RekordboxPresence {
    state: State,
}

#[derive(Debug, Clone)]
enum State {
    /// Une source a été lue : chaque clé de chemin qu'elle référence, avec son nombre de playlists.
    Known {
        source: PresenceSource,
        by_key: HashMap<String, u32>,
    },
    Unknown(Unavailable),
}

// Les points d'entrée sont branchés par l'écran Doublons (lot 1, session d'intégration) : ces
// `allow` tombent avec leur premier appelant de production.
#[allow(dead_code)]
impl RekordboxPresence {
    fn unknown(why: Unavailable) -> Self {
        Self {
            state: State::Unknown(why),
        }
    }

    /// La présence d'un fichier, désigné par son chemin tel que Sift le stocke (`tracks.path`,
    /// séparateurs natifs) ou sous toute autre forme que [`path_key`] ramène à la même clé.
    pub(crate) fn of(&self, path: &str) -> Presence {
        match &self.state {
            State::Unknown(_) => Presence::Unknown,
            State::Known { by_key, .. } => match by_key.get(&path_key(path)) {
                Some(&playlists) => Presence::Present { playlists },
                None => Presence::Absent,
            },
        }
    }

    /// La source lue ; `None` quand rien n'est connu.
    pub(crate) fn source(&self) -> Option<&PresenceSource> {
        match &self.state {
            State::Known { source, .. } => Some(source),
            State::Unknown(_) => None,
        }
    }

    /// Pourquoi rien n'est connu ; `None` quand une source a été lue.
    pub(crate) fn unavailable(&self) -> Option<&Unavailable> {
        match &self.state {
            State::Known { .. } => None,
            State::Unknown(why) => Some(why),
        }
    }
}

/// La moitié « base » : où lire. Un réglage et un chemin calculé, rien sur le disque — à appeler
/// sous le verrou, puis à le relâcher avant [`rekordbox_presence`].
#[allow(dead_code)]
pub(crate) fn presence_sources(conn: &Connection) -> rusqlite::Result<PresenceSources> {
    Ok(PresenceSources {
        linked_xml: crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)?
            .map(PathBuf::from),
        masterdb: crate::actions::rekordbox_pioneer_dir().map(|dir| dir.join("master.db")),
    })
}

/// La moitié « disque » : lit la collection de Rekordbox une fois, depuis `master.db` sinon le XML
/// lié (voir la doc du module), et rend de quoi répondre pour n'importe quel chemin. Aucun accès à
/// la base de Sift.
///
/// Ne rend pas d'`Err` : chaque échec est soit un repli (le XML, quand `master.db` manque ou ne se
/// lit pas), soit un état inconnu qui dit pourquoi. Un `Err` inviterait l'appelant à faire tomber
/// l'écran Doublons entier sur un problème Rekordbox (`?`), ou à l'éteindre en silence (`.ok()`).
/// Les échecs de LECTURE sont journalisés ; un `master.db` absent (machine sans Rekordbox) et un
/// XML non lié sont des états normaux, pas des erreurs.
///
/// Coût mesuré le 2026-10-05 en `--release`, sur des copies des vraies données (`master.db` de
/// 21 Mo et 2 828 pistes, XML de 6 Mo, 3 461 pistes de Sift), sept processus neufs :
/// - **à froid, 211 à 249 ms**, dominés par la dérivation de clé SQLCipher (PBKDF2, 256 000
///   itérations : ≈ 210 ms par ouverture selon `bench_derive_keys_cout_fixe_par_ouverture`, coût
///   fixe quelle que soit la taille de la base) ;
/// - **à chaud, 15 à 30 ms** : le déchiffrement est mis en cache par `rekordbox_masterdb` (clé :
///   chemin, date de modification, taille), partagé avec l'écran Rekordbox ;
/// - **3 461 recherches** par [`RekordboxPresence::of`] : ≈ 1,1 ms en tout ;
/// - **repli sur le XML** : 41 à 122 ms (le plus long sur cache disque froid).
#[allow(dead_code)]
pub(crate) fn rekordbox_presence(sources: &PresenceSources) -> RekordboxPresence {
    let Some(xml) = &sources.linked_xml else {
        return RekordboxPresence::unknown(Unavailable::NotLinked);
    };

    let masterdb = match &sources.masterdb {
        None => MasterDbUnavailable::NoLocation,
        Some(db) => match db.try_exists() {
            Ok(false) => MasterDbUnavailable::Missing,
            // Présent, ou indéterminable : la lecture tranche, et son erreur dit pourquoi.
            Ok(true) | Err(_) => match masterdb_index(db) {
                Ok(by_key) => {
                    return RekordboxPresence {
                        state: State::Known {
                            source: PresenceSource::MasterDb {
                                wal_pending: wal_pending(db),
                            },
                            by_key,
                        },
                    };
                }
                Err(e) => {
                    log::error!(
                        "présence Rekordbox : {} illisible, repli sur le XML lié : {e}",
                        db.display()
                    );
                    MasterDbUnavailable::Unreadable(e.to_string())
                }
            },
        },
    };

    match xml_index(xml) {
        Ok(by_key) => RekordboxPresence {
            state: State::Known {
                source: PresenceSource::LinkedXml { masterdb },
                by_key,
            },
        },
        Err(xml_err) => {
            log::error!(
                "présence Rekordbox : XML lié {} illisible, présence inconnue : {xml_err}",
                xml.display()
            );
            RekordboxPresence::unknown(Unavailable::Unreadable {
                masterdb,
                xml: xml_err,
            })
        }
    }
}

/// `master.db` → clé de chemin → nombre de playlists distinctes.
fn masterdb_index(
    db: &Path,
) -> Result<HashMap<String, u32>, crate::rekordbox_masterdb::MasterDbError> {
    let mut tally = Tally::new();
    for row in crate::rekordbox_masterdb::read_track_playlists(db)? {
        tally.add(&row.folder_path, row.playlist_id);
    }
    Ok(tally.counts())
}

/// XML lié → clé de chemin → nombre de playlists distinctes. Une playlist est une feuille de
/// `<PLAYLISTS>`, désignée par son rang de parcours : deux playlists homonymes dans deux dossiers
/// restent deux playlists.
fn xml_index(xml: &Path) -> Result<HashMap<String, u32>, String> {
    let bytes = std::fs::read(xml).map_err(|e| e.to_string())?;
    let parsed = crate::rekordbox_xml::parse(&bytes)?;

    let mut playlists_of: HashMap<i64, Vec<usize>> = HashMap::new();
    let mut rank = 0usize;
    for_each_leaf(&parsed.playlists, &mut |track_ids| {
        for &id in track_ids {
            playlists_of.entry(id).or_default().push(rank);
        }
        rank += 1;
    });

    let mut tally = Tally::new();
    for track in &parsed.collection {
        let path = location_path(&track.location);
        if path.is_empty() {
            continue; // une ligne sans `Location` ne désigne aucun fichier
        }
        match playlists_of.get(&track.track_id) {
            None => tally.add(&path, None),
            Some(ranks) => {
                for &r in ranks {
                    tally.add(&path, Some(r));
                }
            }
        }
    }
    Ok(tally.counts())
}

/// Chaque playlist feuille de l'arbre `<PLAYLISTS>`, dossiers traversés à toute profondeur.
fn for_each_leaf(nodes: &[crate::rekordbox_xml::PlaylistNode], f: &mut impl FnMut(&[i64])) {
    for node in nodes {
        match node {
            crate::rekordbox_xml::PlaylistNode::Folder { children, .. } => {
                for_each_leaf(children, f)
            }
            crate::rekordbox_xml::PlaylistNode::Playlist { track_ids, .. } => f(track_ids),
        }
    }
}

/// Les playlists DISTINCTES de chaque fichier, par clé de chemin. Distinctes, parce qu'un même
/// fichier peut porter deux lignes de collection (doublon côté Rekordbox, casse différente) et
/// qu'une même playlist peut le lister deux fois : compter des lignes surcompterait.
struct Tally<P> {
    by_key: HashMap<String, HashSet<P>>,
}

impl<P: Eq + Hash> Tally<P> {
    fn new() -> Self {
        Self {
            by_key: HashMap::new(),
        }
    }

    /// Le fichier `path` est dans la collection ; `playlist`, quand il y en a une, le contient.
    fn add(&mut self, path: &str, playlist: Option<P>) {
        let playlists = self.by_key.entry(path_key(path)).or_default();
        if let Some(p) = playlist {
            playlists.insert(p);
        }
    }

    fn counts(self) -> HashMap<String, u32> {
        self.by_key
            .into_iter()
            .map(|(key, playlists)| (key, u32::try_from(playlists.len()).unwrap_or(u32::MAX)))
            .collect()
    }
}

/// La clé de comparaison d'un chemin de fichier, d'où qu'il vienne : chemin natif de Sift
/// (`D:\MUSIQUE\a.mp3`, voire `\\?\D:\…`), `FolderPath` de `master.db` (`D:/MUSIQUE/a.mp3`),
/// `Location` décodée par [`location_path`].
///
/// - préfixe verbatim retiré, par la règle de stockage de Sift (`sources::strip_verbatim`) ;
/// - `\` → `/` : Rekordbox écrit toujours `/`, Sift les séparateurs natifs (mémoire
///   `sift-rekordbox-path-separator-mismatch` : un `==` brut n'a jamais rien reconnu sous Windows) ;
/// - casse repliée, Unicode compris : NTFS et APFS l'ignorent par défaut, les deux cibles de Sift ;
/// - espaces de bord retirés.
///
/// Reprend la comparaison des détecteurs M8 (`actions::normalize_masterdb_path` : trim, `\`→`/`,
/// minuscules) et y ajoute le préfixe verbatim : un fichier que M8 reconnaît, la présence le
/// reconnaît aussi. Hors de portée, faute de dépendance : la normalisation Unicode (NFC/NFD) — un
/// nom accentué composé d'un côté et décomposé de l'autre (macOS) ne se reconnaît pas.
fn path_key(path: &str) -> String {
    crate::sources::strip_verbatim(path.trim())
        .replace('\\', "/")
        .to_lowercase()
}

/// Le chemin de fichier que désigne une `Location` du XML.
///
/// Rekordbox écrit une URI percent-encodée : `file://localhost/C:/Music/Mix%20Final.aiff` sous
/// Windows, `file://localhost/Users/antoine/Music/a.aiff` sous macOS. La barre qui suit
/// `localhost` appartient au chemin sous macOS (`/Users/…`) ; sous Windows elle précède une lettre
/// de lecteur, et elle tombe.
///
/// ⚠️ Diffère exprès de `rekordbox_xml::normalize_path`, qui retire `file://localhost/` barre
/// comprise : sur une `Location` macOS il rend `Users/…` sans sa racine, qu'aucun chemin de Sift
/// (`/Users/…`) ne rejoint. Ici, cette erreur serait un « absent » — une copie que Rekordbox joue,
/// proposée à la suppression.
fn location_path(location: &str) -> String {
    let uri_path = location
        .strip_prefix("file://localhost")
        .or_else(|| location.strip_prefix("file://"))
        .unwrap_or(location);
    let decoded = percent_encoding::percent_decode_str(uri_path).decode_utf8_lossy();
    match decoded.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => decoded[1..].to_string(),
        _ => decoded.into_owned(),
    }
}

/// Un `master.db-wal` non vide à côté de `db`. Rekordbox le supprime en se fermant (constaté, voir
/// `rekordbox_masterdb::decrypt_masterdb`) : présent et non vide, il porte des pages que le fichier
/// principal n'a pas encore. Présent mais illisible, il compte comme en attente — dans le doute,
/// l'interface prévient.
fn wal_pending(db: &Path) -> bool {
    let mut wal = db.as_os_str().to_owned();
    wal.push("-wal");
    match std::fs::metadata(PathBuf::from(wal)) {
        Ok(meta) => meta.len() > 0,
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/rekordbox_master.db"
    );

    /// Un `master.db` chiffré dans `dir`, tiré de la fixture synthétique du dépôt : déchiffrée par
    /// le helper de `rekordbox_masterdb`, complétée par `sql`, rechiffrée par l'autre helper. Rien
    /// n'est réinventé côté chiffrement, et `sql` vide rend la fixture telle quelle.
    ///
    /// La fixture : pistes 40000001 (`D:/FIXTURE/track1.mp3`), 40000002 (`track2.flac`), 40000003
    /// (`track3.wav`) ; une playlist, 50000001, qui liste la piste 1 DEUX fois et la piste 2 une
    /// fois ; la piste 3 n'est dans aucune playlist.
    fn masterdb_in(dir: &Path, sql: &str) -> PathBuf {
        let raw = std::fs::read(FIXTURE).expect("fixture master.db");
        let plain = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let mut conn = Connection::open_in_memory().expect("base en mémoire");
        let len = plain.len();
        conn.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plain), len, false)
            .expect("désérialisation de la fixture");
        conn.execute_batch(sql).expect("lignes du test");
        let plain = conn
            .serialize(rusqlite::MAIN_DB)
            .expect("sérialisation")
            .to_vec();
        let path = dir.join("master.db");
        std::fs::write(
            &path,
            crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plain),
        )
        .expect("écriture du master.db de test");
        path
    }

    /// `SAMPLE_XML` de `rekordbox_xml` écrit dans `dir` : `C:/Music/House/mr-fingers.mp3` (TrackID
    /// 1, playlist House), `C:/Music/House/deep/strings.aiff` (TrackID 2, House ET Favorites),
    /// `C:/Music/Techno/voodoo.flac` (TrackID 3, aucune playlist).
    fn sample_xml_in(dir: &Path) -> PathBuf {
        let path = dir.join("linked.xml");
        std::fs::write(&path, crate::rekordbox_xml::SAMPLE_XML).expect("écriture du XML");
        path
    }

    fn sources(linked_xml: Option<&Path>, masterdb: Option<&Path>) -> PresenceSources {
        PresenceSources {
            linked_xml: linked_xml.map(Path::to_path_buf),
            masterdb: masterdb.map(Path::to_path_buf),
        }
    }

    /// **Un chemin natif Windows de Sift reconnaît le `FolderPath` à barres de `master.db`.**
    ///
    /// C'est le défaut que M8 a livré une première fois : `==` brut entre `D:\…` et `D:/…`, aucune
    /// correspondance sous Windows, pour aucun fichier (mémoire
    /// `sift-rekordbox-path-separator-mismatch`).
    ///
    /// MUTATION : retirer `.replace('\\', "/")` de `path_key` — les deux clés divergent.
    #[test]
    fn un_chemin_windows_de_sift_rejoint_le_folderpath_de_master_db() {
        assert_eq!(
            path_key(r"D:\MUSIQUE 2025\House\Mr Fingers - Can You Feel It.mp3"),
            path_key("D:/MUSIQUE 2025/House/Mr Fingers - Can You Feel It.mp3"),
        );
    }

    /// **La casse se replie, accents compris.** NTFS et APFS ignorent la casse : `É` et `é`
    /// désignent le même fichier. Un repli ASCII seul (`to_ascii_lowercase`) laisserait passer la
    /// lettre de lecteur et rater l'accent.
    ///
    /// MUTATION : retirer `.to_lowercase()` de `path_key` — l'égalité tombe.
    #[test]
    fn la_casse_se_replie_accents_compris() {
        assert_eq!(
            path_key(r"d:\musique\été\Daft Punk - Da Funk.mp3"),
            path_key("D:/MUSIQUE/ÉTÉ/DAFT PUNK - DA FUNK.MP3"),
        );
    }

    /// **Le préfixe verbatim de Windows ne fait pas un autre fichier.** `std::fs::canonicalize`
    /// rend `\\?\D:\…` (et `\\?\UNC\nas\…` pour un partage réseau) ; Sift les retire au stockage
    /// (`sources::strip_verbatim`), et la clé applique la même règle à ce qu'on lui passe.
    ///
    /// MUTATION : remplacer `crate::sources::strip_verbatim(path.trim())` par
    /// `path.trim().to_string()` — les deux égalités tombent.
    #[test]
    fn le_prefixe_verbatim_ne_fait_pas_un_autre_fichier() {
        assert_eq!(
            path_key(r"\\?\D:\MUSIQUE\a.mp3"),
            path_key("D:/MUSIQUE/a.mp3")
        );
        assert_eq!(
            path_key(r"\\?\UNC\nas\musique\a.mp3"),
            path_key("//nas/musique/a.mp3")
        );
    }

    /// **Une `Location` Windows du XML redevient un chemin de disque.** Préfixe `file://localhost`
    /// retiré, percent-décodage (espace, UTF-8 sur deux octets), barre de tête retirée devant la
    /// lettre de lecteur ; et la forme `file:///C:/…` (hôte vide) arrive au même chemin.
    ///
    /// MUTATIONS, une ligne chacune :
    /// - `percent_encoding::percent_decode_str(uri_path).decode_utf8_lossy()` remplacé par la
    ///   chaîne brute, `std::borrow::Cow::Borrowed(uri_path)` — `%20` et `%C3%A9` restent ;
    /// - le bras `[b'/', drive, b':', ..]` neutralisé (garde `/C:/…`) ;
    /// - le repli `.or_else(|| location.strip_prefix("file://"))` retiré.
    #[test]
    fn une_location_windows_redevient_un_chemin_de_disque() {
        assert_eq!(
            location_path("file://localhost/C:/Music/Mix%20Final%20%C3%A9t%C3%A9.aiff"),
            "C:/Music/Mix Final été.aiff"
        );
        assert_eq!(
            location_path("file:///C:/Music/Mix%20Final.aiff"),
            "C:/Music/Mix Final.aiff"
        );
    }

    /// **Une `Location` macOS garde sa racine.** `file://localhost/Users/…` désigne `/Users/…` :
    /// retirer la barre comme sous Windows rendrait `Users/…`, qu'aucun chemin de Sift ne rejoint —
    /// et l'écran Doublons dirait absente une copie que Rekordbox joue. C'est le défaut de
    /// `rekordbox_xml::normalize_path` sur cette forme ; il ne doit pas entrer ici.
    ///
    /// MUTATION : élargir le bras `[b'/', drive, b':', ..] if drive.is_ascii_alphabetic()` en
    /// `[b'/', ..]` (retirer la barre de tête dans tous les cas) — l'égalité tombe.
    #[test]
    fn une_location_macos_garde_sa_racine() {
        assert_eq!(
            location_path("file://localhost/Users/antoine/Music/Nu%20Disco/a.aiff"),
            "/Users/antoine/Music/Nu Disco/a.aiff"
        );
        assert_eq!(
            path_key(&location_path(
                "file://localhost/Users/antoine/Music/a.aiff"
            )),
            path_key("/Users/antoine/Music/a.aiff")
        );
    }

    /// **`master.db` répond, et compte les playlists DISTINCTES.** Sur la fixture : la piste 1 est
    /// listée deux fois dans LA MÊME playlist — une playlist, pas deux ; la piste 3 n'est dans
    /// aucune playlist mais dans la collection — présente, 0 playlist, et surtout pas absente. Le
    /// XML lié est lisible et dit autre chose (ses pistes sont sur `C:/Music`) : `master.db` est la
    /// vérité, pas une union des deux — `strings.aiff`, que seul le XML connaît, est absent.
    ///
    /// Les chemins de Sift sont passés sous leur forme native Windows (`\`), celle de `tracks.path`.
    ///
    /// MUTATIONS :
    /// - compter des lignes au lieu de playlists : `HashSet<P>` → `Vec<P>` dans `Tally` et
    ///   `playlists.insert(p)` → `playlists.push(p)` — la piste 1 passe à 2 ;
    /// - ignorer les lignes sans playlist dans `masterdb_index` (`if row.playlist_id.is_none() {
    ///   continue; }`) — la piste 3 devient absente ;
    /// - ne jamais lire `master.db` quand il existe (`Ok(false) =>` → `Ok(_) =>`) — la source
    ///   devient le XML et tout tombe.
    #[test]
    fn master_db_repond_et_compte_les_playlists_distinctes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = masterdb_in(tmp.path(), "");
        let xml = sample_xml_in(tmp.path());

        let presence = rekordbox_presence(&sources(Some(&xml), Some(&db)));

        assert_eq!(
            presence.source(),
            Some(&PresenceSource::MasterDb { wal_pending: false })
        );
        assert_eq!(
            presence.of(r"D:\FIXTURE\track1.mp3"),
            Presence::Present { playlists: 1 },
            "listée deux fois dans la même playlist : une playlist"
        );
        assert_eq!(
            presence.of(r"D:\FIXTURE\track2.flac"),
            Presence::Present { playlists: 1 }
        );
        assert_eq!(
            presence.of(r"D:\FIXTURE\track3.wav"),
            Presence::Present { playlists: 0 },
            "dans la collection, dans aucune playlist : présente"
        );
        assert_eq!(presence.of(r"D:\FIXTURE\inconnue.mp3"), Presence::Absent);
        assert_eq!(
            presence.of(r"C:\Music\House\deep\strings.aiff"),
            Presence::Absent,
            "master.db est la vérité : ce que seul le XML connaît n'y est pas"
        );
        assert_eq!(presence.unavailable(), None);
    }

    /// **Deux lignes de collection pour un même fichier : leurs playlists s'unissent, elles ne
    /// s'additionnent pas ; et une entrée dont la playlist n'existe plus ne compte pas.**
    ///
    /// La piste 2 gagne une seconde playlist (50000002) ; une ligne 40000004 désigne LE MÊME
    /// fichier, écrit dans une autre casse (`d:/fixture/TRACK2.flac` — le doublon de chemin que les
    /// spikes M8 ont trouvé dans une vraie bibliothèque), et figure elle aussi dans 50000002. Le
    /// fichier est dans deux playlists distinctes : 2, pas 3. La piste 3 reçoit une entrée qui
    /// pointe sur une playlist supprimée (59999999) : elle reste à 0.
    ///
    /// MUTATIONS :
    /// - sélectionner `sp.PlaylistID` au lieu de `p.ID` dans `read_track_playlists` (l'entrée
    ///   orpheline compte) — la piste 3 passe à 1 ;
    /// - `HashSet<P>` → `Vec<P>` dans `Tally` (lignes comptées) — la piste 2 passe à 3.
    #[test]
    fn deux_lignes_pour_un_fichier_unissent_leurs_playlists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = masterdb_in(
            tmp.path(),
            "INSERT INTO djmdPlaylist (ID, Name, ParentID) VALUES ('50000002', 'Seconde', NULL);
             INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo)
                 VALUES ('60000004', '50000002', '40000002', 1);
             INSERT INTO djmdContent (ID, Title, FolderPath, FileNameL, FileNameS, rb_local_usn)
                 VALUES ('40000004', 'Doublon de chemin', 'd:/fixture/TRACK2.flac',
                         'TRACK2.flac', 'TRACK2.flac', 1000);
             INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo)
                 VALUES ('60000005', '50000002', '40000004', 2);
             INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo)
                 VALUES ('60000006', '59999999', '40000003', 1);",
        );
        let xml = sample_xml_in(tmp.path());

        let presence = rekordbox_presence(&sources(Some(&xml), Some(&db)));

        assert_eq!(
            presence.of(r"D:\FIXTURE\track2.flac"),
            Presence::Present { playlists: 2 },
            "50000001 et 50000002, quelle que soit la ligne de collection qui y mène"
        );
        assert_eq!(
            presence.of(r"D:\FIXTURE\track3.wav"),
            Presence::Present { playlists: 0 },
            "une entrée dont la playlist n'existe plus ne compte pas"
        );
    }

    /// **Sans `master.db`, le XML lié répond — et le dit.** Machine sans Rekordbox installé :
    /// `master.db` manque à son emplacement, la source devient le XML, avec la raison `Missing`.
    /// `strings.aiff` est dans House ET Favorites, deux feuilles sous le dossier ROOT.
    ///
    /// MUTATIONS :
    /// - ne plus descendre dans les dossiers dans `for_each_leaf` (bras `Folder` vidé) — toutes
    ///   les playlists vivent sous ROOT, les comptes tombent à 0 ;
    /// - `Ok(false) => MasterDbUnavailable::Missing,` →
    ///   `Ok(false) => return RekordboxPresence::unknown(Unavailable::NotLinked),` (pas de repli
    ///   quand `master.db` manque) — tout devient inconnu.
    #[test]
    fn sans_master_db_le_xml_lie_repond_et_le_dit() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let xml = sample_xml_in(tmp.path());
        let absent = tmp.path().join("Pioneer").join("master.db");

        let presence = rekordbox_presence(&sources(Some(&xml), Some(&absent)));

        assert_eq!(
            presence.source(),
            Some(&PresenceSource::LinkedXml {
                masterdb: MasterDbUnavailable::Missing
            })
        );
        assert_eq!(
            presence.of(r"C:\Music\House\deep\strings.aiff"),
            Presence::Present { playlists: 2 }
        );
        assert_eq!(
            presence.of(r"C:\Music\House\mr-fingers.mp3"),
            Presence::Present { playlists: 1 }
        );
        assert_eq!(
            presence.of(r"C:\Music\Techno\voodoo.flac"),
            Presence::Present { playlists: 0 }
        );
        assert_eq!(presence.of(r"C:\Music\ailleurs.mp3"), Presence::Absent);
    }

    /// **Un `master.db` illisible passe la main au XML, et la raison suit.** Un fichier présent
    /// mais tronqué : la lecture échoue, le repli sur le XML n'est pas silencieux — la source
    /// porte `Unreadable` et son diagnostic, que l'interface peut montrer.
    ///
    /// MUTATION : rendre `MasterDbUnavailable::Missing` au lieu de `Unreadable(e.to_string())`
    /// dans le bras d'échec de lecture — la raison ment, l'assertion tombe.
    #[test]
    fn un_master_db_illisible_passe_la_main_au_xml_et_le_dit() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = tmp.path().join("master.db");
        std::fs::write(&db, b"pas un master.db").expect("écriture");
        let xml = sample_xml_in(tmp.path());

        let presence = rekordbox_presence(&sources(Some(&xml), Some(&db)));

        match presence.source() {
            Some(PresenceSource::LinkedXml {
                masterdb: MasterDbUnavailable::Unreadable(detail),
            }) => assert!(!detail.is_empty(), "le diagnostic n'est pas vide"),
            other => panic!("attendu : le XML, avec master.db illisible ; obtenu {other:?}"),
        }
        assert_eq!(
            presence.of(r"C:\Music\House\deep\strings.aiff"),
            Presence::Present { playlists: 2 }
        );
    }

    /// **Sans XML lié, rien n'est lu — même un `master.db` lisible.** Le XML lié est le signal
    /// d'opt-in de l'intégration Rekordbox (M8, `actions::masterdb_path_if_linked`) : sans lui,
    /// chaque fichier est inconnu, et la cause est `NotLinked`. Inconnu, pas absent.
    ///
    /// MUTATION : `let Some(xml) = &sources.linked_xml else {` →
    /// `let Some(xml) = sources.linked_xml.as_ref().or(sources.masterdb.as_ref()) else {` (la
    /// garde laisse passer) — `master.db` est lu et la piste 1 devient présente.
    #[test]
    fn sans_xml_lie_rien_n_est_lu() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = masterdb_in(tmp.path(), "");

        let presence = rekordbox_presence(&sources(None, Some(&db)));

        assert_eq!(presence.of(r"D:\FIXTURE\track1.mp3"), Presence::Unknown);
        assert_eq!(presence.unavailable(), Some(&Unavailable::NotLinked));
        assert_eq!(presence.source(), None);
    }

    /// **Aucune source lisible : inconnu, jamais « absent », jamais « 0 playlist ».** Le XML lié
    /// n'est pas du XML Rekordbox et `master.db` manque : chaque fichier est `Unknown`, et la
    /// cause porte les deux échecs.
    ///
    /// MUTATION : dans le bras d'échec du XML, rendre un état connu à table vide
    /// (`State::Known { source: PresenceSource::LinkedXml { masterdb }, by_key: HashMap::new() }`)
    /// — chaque fichier devient `Absent`, l'assertion tombe.
    #[test]
    fn aucune_source_lisible_donne_inconnu_jamais_absent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let xml = tmp.path().join("linked.xml");
        std::fs::write(&xml, b"<pas-du-rekordbox/>").expect("écriture");
        let absent = tmp.path().join("master.db");

        let presence = rekordbox_presence(&sources(Some(&xml), Some(&absent)));

        assert_eq!(
            presence.of(r"C:\Music\House\mr-fingers.mp3"),
            Presence::Unknown
        );
        match presence.unavailable() {
            Some(Unavailable::Unreadable {
                masterdb: MasterDbUnavailable::Missing,
                xml,
            }) => assert!(!xml.is_empty(), "le diagnostic XML n'est pas vide"),
            other => panic!("attendu : les deux sources illisibles ; obtenu {other:?}"),
        }
    }

    /// **Un journal WAL non vide signale une lecture peut-être périmée.** Rekordbox ouvert garde
    /// ses derniers changements dans `master.db-wal` ; Sift ne lit que le fichier principal. Un
    /// `-wal` vidé (rien en attente) ne signale rien.
    ///
    /// MUTATIONS : `Ok(meta) => meta.len() > 0` → `Ok(_) => false` (le cas non vide échoue), puis
    /// → `Ok(_) => true` (le cas vidé échoue).
    #[test]
    fn un_journal_wal_non_vide_signale_une_lecture_en_retard() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = masterdb_in(tmp.path(), "");
        let xml = sample_xml_in(tmp.path());
        let wal = tmp.path().join("master.db-wal");

        std::fs::write(&wal, b"pages en attente").expect("écriture du -wal");
        assert_eq!(
            rekordbox_presence(&sources(Some(&xml), Some(&db))).source(),
            Some(&PresenceSource::MasterDb { wal_pending: true })
        );

        std::fs::write(&wal, b"").expect("-wal vidé");
        assert_eq!(
            rekordbox_presence(&sources(Some(&xml), Some(&db))).source(),
            Some(&PresenceSource::MasterDb { wal_pending: false })
        );
    }

    /// **La moitié « base » lit le bon réglage et pointe `master.db` à l'emplacement standard.**
    /// Sans réglage, pas de XML lié ; avec, son chemin — et `master.db` sous le dossier Pioneer
    /// (surchargé pour ce fil de test, jamais le vrai).
    ///
    /// MUTATION : lire `settings::REKORDBOX_XML_DRIFT` au lieu de `REKORDBOX_XML_PATH` — le XML
    /// lié disparaît.
    #[test]
    fn la_moitie_base_lit_le_reglage_du_xml_lie() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer = tmp.path().join("Pioneer").join("rekordbox");
        crate::actions::set_pioneer_dir_override_for_test(pioneer.clone());
        let conn = Connection::open_in_memory().expect("base");
        crate::db::run_migrations(&conn).expect("migrations");

        let avant = presence_sources(&conn).expect("lecture du réglage");
        assert_eq!(avant.linked_xml, None);

        let xml = tmp.path().join("collection.xml");
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            &xml.to_string_lossy(),
        )
        .expect("réglage");
        let apres = presence_sources(&conn).expect("lecture du réglage");
        assert_eq!(apres.linked_xml, Some(xml));
        assert_eq!(apres.masterdb, Some(pioneer.join("master.db")));
    }

    /// Répartition d'une série de réponses : (présents, absents, inconnus, présents par tranche de
    /// playlists 0 / 1 / 2–5 / 6+).
    fn repartition(answers: &[Presence]) -> (usize, usize, usize, [usize; 4]) {
        let (mut present, mut absent, mut unknown, mut tranches) = (0, 0, 0, [0usize; 4]);
        for a in answers {
            match a {
                Presence::Present { playlists } => {
                    present += 1;
                    tranches[match playlists {
                        0 => 0,
                        1 => 1,
                        2..=5 => 2,
                        _ => 3,
                    }] += 1;
                }
                Presence::Absent => absent += 1,
                Presence::Unknown => unknown += 1,
            }
        }
        (present, absent, unknown, tranches)
    }

    /// MESURE sur les vraies données, en LECTURE SEULE et sur des COPIES — jamais les fichiers
    /// vivants. Le dossier `SIFT_PRESENCE_COPY_DIR` contient `sift.db` (+ `-wal`, `-shm`),
    /// `master.db` (copié Rekordbox fermé) et `linked.xml`. La copie de `sift.db` s'ouvre en
    /// `mode=ro`. Ne sort que des comptes et des durées : aucun chemin, aucun nom.
    ///
    /// `SIFT_PRESENCE_COPY_DIR=<dossier> bash scripts/cargo-isolated.sh test --release --lib --
    /// --exact rekordbox_presence::tests::mesure_sur_copies_reelles --ignored --nocapture`
    #[test]
    #[ignore = "mesure à la demande, sur des copies, en --release"]
    fn mesure_sur_copies_reelles() {
        use std::time::Instant;
        let dir = PathBuf::from(
            std::env::var("SIFT_PRESENCE_COPY_DIR")
                .expect("SIFT_PRESENCE_COPY_DIR : un dossier de COPIES"),
        );
        let db = dir.join("master.db");
        let xml = dir.join("linked.xml");

        // 1. Les pistes de Sift, lues dans la copie ouverte en lecture seule.
        let uri = format!(
            "file:{}?mode=ro",
            dir.join("sift.db").to_string_lossy().replace('\\', "/")
        );
        let sift = Connection::open_with_flags(
            &uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .expect("copie de sift.db, mode=ro");
        let lie = crate::settings::get(&sift, crate::settings::REKORDBOX_XML_PATH)
            .expect("réglage")
            .is_some();
        let tracks: Vec<(String, String)> = sift
            .prepare("SELECT path, status FROM tracks WHERE status IN ('pending', 'filed')")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        let pending = tracks.iter().filter(|(_, s)| s == "pending").count();
        println!(
            "sift.db : XML lié = {lie} ; pending+filed = {} (pending {pending}, filed {}) ; \
             préfixe verbatim : {} ; contenant '/' : {}",
            tracks.len(),
            tracks.len() - pending,
            tracks
                .iter()
                .filter(|(p, _)| p.starts_with(r"\\?\"))
                .count(),
            tracks.iter().filter(|(p, _)| p.contains('/')).count(),
        );

        // 2. master.db : à froid (déchiffrement), puis à chaud (cache de déchiffrement).
        let par_db = sources(Some(&xml), Some(&db));
        let t = Instant::now();
        let froid = rekordbox_presence(&par_db);
        let dt_froid = t.elapsed();
        let t = Instant::now();
        let _chaud = rekordbox_presence(&par_db);
        let dt_chaud = t.elapsed();
        let t = Instant::now();
        let rows = crate::rekordbox_masterdb::read_track_playlists(&db).expect("lecture");
        let dt_requete = t.elapsed();
        let t = Instant::now();
        let answers_db: Vec<Presence> = tracks.iter().map(|(p, _)| froid.of(p)).collect();
        let dt_lookups = t.elapsed();
        let State::Known { by_key, .. } = &froid.state else {
            panic!("master.db illisible : {:?}", froid.unavailable());
        };
        println!(
            "master.db : source {:?} ; {} lignes (piste, playlist) ; {} fichiers distincts ; \
             froid {dt_froid:?} ; chaud {dt_chaud:?} (dont requête, cache chaud, {dt_requete:?}) ; \
             {} recherches en {dt_lookups:?}",
            froid.source(),
            rows.len(),
            by_key.len(),
            answers_db.len(),
        );
        let (p, a, u, t4) = repartition(&answers_db);
        println!(
            "  pistes de Sift selon master.db : présentes {p} (0 playlist {}, 1 : {}, 2–5 : {}, \
             6+ : {}) ; absentes {a} ; inconnues {u}",
            t4[0], t4[1], t4[2], t4[3]
        );

        // Ce que la casse repliée rattrape : clé sans `to_lowercase`, des deux côtés.
        let exacte = |s: &str| crate::sources::strip_verbatim(s.trim()).replace('\\', "/");
        let exactes: HashSet<String> = rows.iter().map(|r| exacte(&r.folder_path)).collect();
        let par_casse = tracks
            .iter()
            .zip(&answers_db)
            .filter(|((p, _), a)| {
                matches!(a, Presence::Present { .. }) && !exactes.contains(&exacte(p))
            })
            .count();
        println!("  présentes rattrapées par le repli de casse seul : {par_casse}");

        // 3. Le XML lié seul (master.db hors jeu), pour comparer les deux sources.
        let t = Instant::now();
        let par_xml = rekordbox_presence(&sources(Some(&xml), None));
        let dt_xml = t.elapsed();
        let answers_xml: Vec<Presence> = tracks.iter().map(|(p, _)| par_xml.of(p)).collect();
        let (p, a, u, t4) = repartition(&answers_xml);
        println!(
            "XML lié : source {:?} ; lecture + analyse {dt_xml:?} ; présentes {p} (0 playlist {}, \
             1 : {}, 2–5 : {}, 6+ : {}) ; absentes {a} ; inconnues {u}",
            par_xml.source(),
            t4[0],
            t4[1],
            t4[2],
            t4[3]
        );
        let (mut deux, mut db_seul, mut xml_seul, mut aucun, mut ecart_compte) = (0, 0, 0, 0, 0);
        for (d, x) in answers_db.iter().zip(&answers_xml) {
            match (d, x) {
                (Presence::Present { playlists: a }, Presence::Present { playlists: b }) => {
                    deux += 1;
                    if a != b {
                        ecart_compte += 1;
                    }
                }
                (Presence::Present { .. }, _) => db_seul += 1,
                (_, Presence::Present { .. }) => xml_seul += 1,
                _ => aucun += 1,
            }
        }
        println!(
            "  accord : les deux {deux} (dont nombre de playlists différent {ecart_compte}) ; \
             master.db seul {db_seul} ; XML seul {xml_seul} ; aucun {aucun}"
        );
        // Les lignes qu'un export de Sift a fusionnées : `merge_filed_tracks` n'écrit que quatre
        // attributs (TrackID, Name, Artist, Location), jamais `TotalTime` que Rekordbox pose
        // toujours. Compté par ÉLÉMENT : un `<TRACK>` de Rekordbox s'étale sur plusieurs lignes.
        let brut = std::fs::read_to_string(&xml).expect("XML");
        let mut lecteur = quick_xml::reader::Reader::from_str(&brut);
        let (mut dans_playlists, mut n_track, mut sans_total) = (false, 0usize, 0usize);
        loop {
            match lecteur.read_event().expect("XML lisible") {
                quick_xml::events::Event::Eof => break,
                quick_xml::events::Event::Start(e) if e.name().as_ref() == b"PLAYLISTS" => {
                    dans_playlists = true
                }
                quick_xml::events::Event::Start(e) | quick_xml::events::Event::Empty(e)
                    if e.name().as_ref() == b"TRACK" && !dans_playlists =>
                {
                    n_track += 1;
                    let a_total = e
                        .attributes()
                        .any(|a| a.map(|a| a.key.as_ref() == b"TotalTime").unwrap_or(false));
                    if !a_total {
                        sans_total += 1;
                    }
                }
                _ => {}
            }
        }
        println!(
            "  XML : {n_track} <TRACK> de collection, dont {sans_total} sans TotalTime (forme \
             écrite par un export de Sift)"
        );

        // 4. Faits de schéma du vrai master.db, qui fondent la requête.
        let raw = std::fs::read(&db).expect("master.db");
        let plain = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let mut m = Connection::open_in_memory().unwrap();
        let len = plain.len();
        m.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plain), len, true)
            .unwrap();
        let compte = |sql: &str| -> i64 { m.query_row(sql, [], |r| r.get(0)).unwrap() };
        let groupes = |sql: &str| -> Vec<(String, i64)> {
            m.prepare(sql)
                .unwrap()
                .query_map([], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?
                            .unwrap_or_else(|| "NULL".into()),
                        r.get(1)?,
                    ))
                })
                .unwrap()
                .map(|x| x.unwrap())
                .collect()
        };
        let colonne = |table: &str, col: &str| -> bool {
            m.prepare(&format!("PRAGMA table_info({table})"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .any(|c| c.unwrap() == col)
        };
        for table in ["djmdContent", "djmdSongPlaylist", "djmdPlaylist"] {
            let total = compte(&format!("SELECT count(*) FROM {table}"));
            let supprimees = if colonne(table, "rb_local_deleted") {
                format!(
                    "{:?}",
                    groupes(&format!(
                        "SELECT CAST(rb_local_deleted AS TEXT), count(*) FROM {table} GROUP BY 1"
                    ))
                )
            } else {
                "colonne absente".to_string()
            };
            println!("{table} : {total} lignes ; rb_local_deleted : {supprimees}");
        }
        if colonne("djmdPlaylist", "Attribute") {
            println!(
                "djmdPlaylist.Attribute : {:?} ; des playlists qui ont des entrées : {:?}",
                groupes("SELECT CAST(Attribute AS TEXT), count(*) FROM djmdPlaylist GROUP BY 1"),
                groupes(
                    "SELECT CAST(p.Attribute AS TEXT), count(*) FROM djmdSongPlaylist sp
                     JOIN djmdPlaylist p ON p.ID = sp.PlaylistID GROUP BY 1"
                ),
            );
        }
        println!(
            "couples (playlist, piste) listés plus d'une fois : {}",
            compte(
                "SELECT count(*) FROM (SELECT 1 FROM djmdSongPlaylist
                 GROUP BY PlaylistID, ContentID HAVING count(*) > 1)"
            ),
        );
        println!(
            "entrées orphelines : playlist absente {} ; piste absente {}",
            compte(
                "SELECT count(*) FROM djmdSongPlaylist sp
                 WHERE NOT EXISTS (SELECT 1 FROM djmdPlaylist p WHERE p.ID = sp.PlaylistID)"
            ),
            compte(
                "SELECT count(*) FROM djmdSongPlaylist sp
                 WHERE NOT EXISTS (SELECT 1 FROM djmdContent c WHERE c.ID = sp.ContentID)"
            ),
        );
        println!(
            "FolderPath : vide/NULL {} ; avec '\\' {} ; lecteur 'X:/' {} ; racine '/' {} ; autre {}",
            compte("SELECT count(*) FROM djmdContent WHERE COALESCE(FolderPath, '') = ''"),
            compte("SELECT count(*) FROM djmdContent WHERE instr(FolderPath, '\\') > 0"),
            compte("SELECT count(*) FROM djmdContent WHERE FolderPath GLOB '[A-Za-z]:/*'"),
            compte("SELECT count(*) FROM djmdContent WHERE FolderPath GLOB '/*'"),
            compte(
                "SELECT count(*) FROM djmdContent WHERE COALESCE(FolderPath, '') <> ''
                 AND NOT FolderPath GLOB '[A-Za-z]:/*' AND NOT FolderPath GLOB '/*'"
            ),
        );
        let mut par_cle: HashMap<String, usize> = HashMap::new();
        for chemin in m
            .prepare("SELECT FolderPath FROM djmdContent WHERE COALESCE(FolderPath, '') <> ''")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
        {
            *par_cle.entry(path_key(&chemin.unwrap())).or_default() += 1;
        }
        println!(
            "fichiers portés par plusieurs lignes djmdContent : {}",
            par_cle.values().filter(|&&n| n > 1).count()
        );
    }
}
