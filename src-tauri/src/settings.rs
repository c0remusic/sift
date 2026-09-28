//! Typed access to the `settings(key, value)` table: the few app-wide preferences the
//! filing loop needs (library root, filename template, encode profile). String values
//! only; callers parse as needed — sauf le profil d'encodage (#71), lu et écrit d'un bloc par
//! `encode_profile` / `set_encode_profile`, qui le valident. Created in migration v4.

use crate::encode::EncodeProfile;
use rusqlite::{params, Connection};

/// Absolute path of the library root under which bins live.
pub const LIBRARY_ROOT: &str = "library_root";
/// Output filename template (placeholders {artist} {title} {version}).
pub const FILENAME_TEMPLATE: &str = "filename_template";
/// Discogs personal access token (entered in Réglages). Empty/unset = identification disabled.
pub const DISCOGS_TOKEN: &str = "discogs_token";
/// Key under which the current session's unique ID is stored at app launch.
/// Written once at startup; read by the `actions` INSERT via SQL subquery.
pub const CURRENT_SESSION_ID: &str = "current_session_id";
/// Absolute path of the linked Rekordbox XML file (`DJ_PLAYLISTS` format). Unset = no XML linked.
pub const REKORDBOX_XML_PATH: &str = "rekordbox_xml_path";
/// FIX-7: set to "1" when `actions::repair_rekordbox_xml_if_linked` hits an AMBIGUOUS
/// `patch_location` match (0 or >1 occurrences of the expected Location text in raw_xml — the
/// linked XML has drifted from what Sift's DB thinks a track's path is) and the repair could not
/// proceed. Unset/absent = no known drift. Surfaced on `RekordboxLinkStatus.drift_detected` so the
/// dashboard can show it instead of the failure being visible only in the server log. Cleared on
/// a fresh `link_rekordbox_xml` (re-linking is the user's explicit "I've resolved it" signal).
pub const REKORDBOX_XML_DRIFT: &str = "rekordbox_xml_drift";

/// The default filename template when the setting is unset.
pub const DEFAULT_TEMPLATE: &str = "{artist} - {title}{version}";

// Profil d'encodage de la catégorie Conversion (#71) : une clé par champ d'`EncodeProfile`. Clé
// absente = défaut du champ (le comportement d'avant #71). Écrites ensemble et validées par
// `set_encode_profile`, relues ensemble par `encode_profile` — jamais une à une par `set`, qui ne
// valide rien (`ipc_filing::set_setting` les refuse, voir `is_encode_profile_key`).
/// Débit MP3 en kbps (`EncodeProfile::mp3_kbps`).
pub const ENCODE_MP3_KBPS: &str = "encode_mp3_kbps";
/// Fréquence MP3 en Hz (`EncodeProfile::mp3_rate`).
pub const ENCODE_MP3_RATE: &str = "encode_mp3_rate";
/// Profondeur AIFF en bits (`EncodeProfile::aiff_bits`).
pub const ENCODE_AIFF_BITS: &str = "encode_aiff_bits";
/// Fréquence AIFF en Hz (`EncodeProfile::aiff_rate`).
pub const ENCODE_AIFF_RATE: &str = "encode_aiff_rate";
/// Profondeur WAV en bits (`EncodeProfile::wav_bits`).
pub const ENCODE_WAV_BITS: &str = "encode_wav_bits";
/// Fréquence WAV en Hz (`EncodeProfile::wav_rate`).
pub const ENCODE_WAV_RATE: &str = "encode_wav_rate";

/// Les six clés du profil d'encodage, dans l'ordre des champs d'`EncodeProfile`.
const ENCODE_PROFILE_KEYS: [&str; 6] = [
    ENCODE_MP3_KBPS,
    ENCODE_MP3_RATE,
    ENCODE_AIFF_BITS,
    ENCODE_AIFF_RATE,
    ENCODE_WAV_BITS,
    ENCODE_WAV_RATE,
];

/// Read a setting, or None if unset.
pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Read a setting or fall back to `default`.
pub fn get_or(conn: &Connection, key: &str, default: &str) -> rusqlite::Result<String> {
    Ok(get(conn, key)?.unwrap_or_else(|| default.to_string()))
}

/// Upsert a setting.
pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Vrai pour une clé du profil d'encodage : elle ne s'écrit que par [`set_encode_profile`], qui
/// valide le profil entier. Sert à `ipc_filing::set_setting` pour refuser le chemin qui écrirait
/// une valeur hors liste sans la voir.
pub fn is_encode_profile_key(key: &str) -> bool {
    ENCODE_PROFILE_KEYS.contains(&key)
}

/// Un champ du profil : clé absente = `defaut` ; valeur présente mais illisible = `Err` au
/// format `ENCODE_PROFILE_INVALID: <champ>=<valeur stockée>`. Jamais un repli silencieux sur le
/// défaut : une valeur corrompue en base doit se voir, pas se faire oublier.
fn read_profile_field<T: std::str::FromStr>(
    conn: &Connection,
    key: &str,
    champ: &str,
    defaut: T,
) -> Result<T, String> {
    match get(conn, key).map_err(|e| e.to_string())? {
        None => Ok(defaut),
        Some(brut) => brut
            .parse::<T>()
            .map_err(|_| crate::encode::invalid_profile_field(champ, &brut)),
    }
}

/// Le profil d'encodage réglé. Chaque clé absente prend le défaut de son champ ; une valeur
/// stockée illisible ou hors liste rend `Err` (`ENCODE_PROFILE_INVALID: …`) — le rangement qui la
/// lit est alors refusé, jamais mené à une valeur corrigée en silence.
pub fn encode_profile(conn: &Connection) -> Result<EncodeProfile, String> {
    let d = EncodeProfile::default();
    let p = EncodeProfile {
        mp3_kbps: read_profile_field(conn, ENCODE_MP3_KBPS, "mp3_kbps", d.mp3_kbps)?,
        mp3_rate: read_profile_field(conn, ENCODE_MP3_RATE, "mp3_rate", d.mp3_rate)?,
        aiff_bits: read_profile_field(conn, ENCODE_AIFF_BITS, "aiff_bits", d.aiff_bits)?,
        aiff_rate: read_profile_field(conn, ENCODE_AIFF_RATE, "aiff_rate", d.aiff_rate)?,
        wav_bits: read_profile_field(conn, ENCODE_WAV_BITS, "wav_bits", d.wav_bits)?,
        wav_rate: read_profile_field(conn, ENCODE_WAV_RATE, "wav_rate", d.wav_rate)?,
    };
    p.validate()?;
    Ok(p)
}

/// Écrit le profil d'encodage d'un bloc : validé ENTIER d'abord (un champ hors liste = rien
/// n'est écrit), puis les six clés dans une seule transaction — jamais un profil à moitié écrit.
pub fn set_encode_profile(conn: &Connection, profile: &EncodeProfile) -> Result<(), String> {
    profile.validate()?;
    let EncodeProfile {
        mp3_kbps,
        mp3_rate,
        aiff_bits,
        aiff_rate,
        wav_bits,
        wav_rate,
    } = *profile;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (key, value) in [
        (ENCODE_MP3_KBPS, mp3_kbps.to_string()),
        (ENCODE_MP3_RATE, mp3_rate.to_string()),
        (ENCODE_AIFF_BITS, aiff_bits.to_string()),
        (ENCODE_AIFF_RATE, aiff_rate.to_string()),
        (ENCODE_WAV_BITS, wav_bits.to_string()),
        (ENCODE_WAV_RATE, wav_rate.to_string()),
    ] {
        set(&tx, key, &value).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Efface les six clés du profil : chaque champ revient à son défaut (`encode_profile`, clé absente
/// = défaut). La seule sortie, depuis l'app, d'une valeur stockée hors liste — arrivée par une
/// édition à la main ou un retour à une version antérieure : `encode_profile` refuse alors TOUT
/// rangement, `set_setting` refuse ces clés, et `set_encode_profile` demande un profil entier que
/// Réglages ne peut plus construire (relecture de #71). Un geste explicite de l'utilisateur, jamais
/// une correction silencieuse.
pub fn reset_encode_profile(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for key in ENCODE_PROFILE_KEYS {
        tx.execute("DELETE FROM settings WHERE key=?1", [key])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn get_missing_is_none() {
        let conn = db();
        assert_eq!(get(&conn, LIBRARY_ROOT).unwrap(), None);
    }

    #[test]
    fn set_then_get_round_trips() {
        let conn = db();
        set(&conn, LIBRARY_ROOT, "/music/dj").unwrap();
        assert_eq!(
            get(&conn, LIBRARY_ROOT).unwrap(),
            Some("/music/dj".to_string())
        );
    }

    #[test]
    fn set_overwrites() {
        let conn = db();
        set(&conn, LIBRARY_ROOT, "/a").unwrap();
        set(&conn, LIBRARY_ROOT, "/b").unwrap();
        assert_eq!(get(&conn, LIBRARY_ROOT).unwrap(), Some("/b".to_string()));
    }

    #[test]
    fn get_or_falls_back() {
        let conn = db();
        assert_eq!(
            get_or(&conn, FILENAME_TEMPLATE, DEFAULT_TEMPLATE).unwrap(),
            DEFAULT_TEMPLATE
        );
    }

    /// Base neuve : aucune clé, donc le profil d'avant #71 — rien ne change tant qu'on ne règle
    /// rien.
    #[test]
    fn profil_absent_vaut_le_defaut() {
        let conn = db();
        assert_eq!(encode_profile(&conn), Ok(EncodeProfile::default()));
    }

    /// Clé absente = défaut de CE champ seulement : les autres gardent leur valeur réglée.
    #[test]
    fn une_cle_absente_prend_le_defaut_de_son_seul_champ() {
        let conn = db();
        set(&conn, ENCODE_AIFF_BITS, "24").unwrap();
        set(&conn, ENCODE_WAV_RATE, "96000").unwrap();
        assert_eq!(
            encode_profile(&conn),
            Ok(EncodeProfile {
                aiff_bits: 24,
                wav_rate: 96_000,
                ..EncodeProfile::default()
            })
        );
    }

    /// Deux profils, parce qu'un seul ne peut pas tout tenir : chaque champ doit y être différent
    /// de son défaut (sinon « ce champ se lit au défaut » passe), et deux champs de même nature
    /// doivent différer (sinon une clé croisée passe). A distingue les profondeurs AIFF/WAV et
    /// les fréquences MP3/AIFF et AIFF/WAV ; B porte le WAV 24 bits et distingue MP3/WAV.
    /// Relecture de #71 : une valeur stockée hors liste bloque tout rangement ; la remise aux
    /// défauts l'efface, et le profil se relit à ses défauts.
    #[test]
    fn la_remise_aux_defauts_repare_une_valeur_hors_liste() {
        let conn = db();
        set(&conn, ENCODE_WAV_BITS, "20").unwrap();
        assert!(encode_profile(&conn).is_err());
        reset_encode_profile(&conn).unwrap();
        assert_eq!(encode_profile(&conn).unwrap(), EncodeProfile::default());
        for key in ENCODE_PROFILE_KEYS {
            assert_eq!(get(&conn, key).unwrap(), None, "clé {key} restée");
        }
    }

    #[test]
    fn le_profil_fait_l_aller_retour() {
        let a = EncodeProfile {
            mp3_kbps: 256,
            mp3_rate: 48_000,
            aiff_bits: 24,
            aiff_rate: 96_000,
            wav_bits: 16,
            wav_rate: 48_000,
        };
        let b = EncodeProfile {
            mp3_kbps: 256,
            mp3_rate: 48_000,
            aiff_bits: 16,
            aiff_rate: 48_000,
            wav_bits: 24,
            wav_rate: 96_000,
        };
        for p in [a, b] {
            let conn = db();
            set_encode_profile(&conn, &p).unwrap();
            assert_eq!(encode_profile(&conn), Ok(p));
            // Chaque clé porte la valeur de SON champ (pas de clés croisées).
            for (key, attendu) in [
                (ENCODE_MP3_KBPS, p.mp3_kbps.to_string()),
                (ENCODE_MP3_RATE, p.mp3_rate.to_string()),
                (ENCODE_AIFF_BITS, p.aiff_bits.to_string()),
                (ENCODE_AIFF_RATE, p.aiff_rate.to_string()),
                (ENCODE_WAV_BITS, p.wav_bits.to_string()),
                (ENCODE_WAV_RATE, p.wav_rate.to_string()),
            ] {
                assert_eq!(get(&conn, key).unwrap(), Some(attendu), "{key}");
            }
            // Réécrire le défaut ramène le défaut.
            set_encode_profile(&conn, &EncodeProfile::default()).unwrap();
            assert_eq!(encode_profile(&conn), Ok(EncodeProfile::default()));
        }
    }

    /// Une valeur stockée illisible ou hors liste rend `Err`, avec le champ et la valeur telle
    /// qu'elle est en base — jamais le défaut à sa place.
    #[test]
    fn une_valeur_stockee_invalide_est_une_erreur_jamais_un_defaut() {
        for (key, brut, attendu) in [
            (
                ENCODE_MP3_KBPS,
                "abc",
                "ENCODE_PROFILE_INVALID: mp3_kbps=abc",
            ),
            (
                ENCODE_MP3_KBPS,
                "128",
                "ENCODE_PROFILE_INVALID: mp3_kbps=128",
            ),
            (ENCODE_MP3_RATE, "", "ENCODE_PROFILE_INVALID: mp3_rate="),
            (
                ENCODE_MP3_RATE,
                "96000",
                "ENCODE_PROFILE_INVALID: mp3_rate=96000",
            ),
            (
                ENCODE_AIFF_BITS,
                "300",
                "ENCODE_PROFILE_INVALID: aiff_bits=300",
            ),
            (
                ENCODE_AIFF_BITS,
                " 24",
                "ENCODE_PROFILE_INVALID: aiff_bits= 24",
            ),
            (
                ENCODE_AIFF_RATE,
                "88200",
                "ENCODE_PROFILE_INVALID: aiff_rate=88200",
            ),
            (ENCODE_WAV_BITS, "32", "ENCODE_PROFILE_INVALID: wav_bits=32"),
            (ENCODE_WAV_RATE, "-1", "ENCODE_PROFILE_INVALID: wav_rate=-1"),
        ] {
            let conn = db();
            set(&conn, key, brut).unwrap();
            assert_eq!(
                encode_profile(&conn),
                Err(attendu.to_string()),
                "{key}={brut:?}"
            );
        }
    }

    /// Un profil hors liste n'écrit RIEN, pas même ses champs valides : l'écriture est d'un bloc.
    #[test]
    fn ecrire_un_profil_hors_liste_n_ecrit_rien() {
        let conn = db();
        let p = EncodeProfile {
            mp3_kbps: 256,
            wav_rate: 22_050,
            ..EncodeProfile::default()
        };
        assert_eq!(
            set_encode_profile(&conn, &p),
            Err("ENCODE_PROFILE_INVALID: wav_rate=22050".to_string())
        );
        for key in ENCODE_PROFILE_KEYS {
            assert_eq!(get(&conn, key).unwrap(), None, "{key}");
        }
    }

    #[test]
    fn seules_les_six_cles_du_profil_sont_reservees() {
        for key in ENCODE_PROFILE_KEYS {
            assert!(is_encode_profile_key(key), "{key}");
        }
        for key in [
            LIBRARY_ROOT,
            FILENAME_TEMPLATE,
            DISCOGS_TOKEN,
            "encode_",
            "encode_mp3",
        ] {
            assert!(!is_encode_profile_key(key), "{key}");
        }
    }
}
