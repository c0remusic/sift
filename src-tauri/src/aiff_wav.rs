//! AIFF / AIFF-C non compressé → WAV, sans ffmpeg, pour la LECTURE (`ipc::playback_url`).
//!
//! Le webview (Chromium) ne lit pas l'AIFF : chaque AIFF écouté passait par un transcodage ffmpeg
//! complet vers un WAV 16 bits / 44,1 kHz avant de pouvoir jouer. Mesuré le 2026-10-30 dans la
//! vraie fenêtre : 0,4 à 0,9 s d'attente sur une piste jamais écoutée. Or un AIFF n'est que du PCM
//! gros-boutiste dans des chunks IFF, et un WAV du PCM petit-boutiste dans des chunks RIFF : la
//! conversion est un réécrivage d'en-tête et une inversion d'octets par échantillon, en un seul
//! passage de lecture-écriture, sans décodage ni rééchantillonnage. Le format d'origine (taux,
//! profondeur, canaux) est gardé tel quel.
//!
//! Hors périmètre, rendu en `Err` pour que l'appelant retombe sur ffmpeg : AIFF-C compressé (tout
//! type autre que `NONE` et `sowt`), échantillons flottants (`fl32`, `fl64`), fichier mal formé.
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Ce que dit le chunk COMM, plus l'emplacement des échantillons dans SSND.
#[derive(Debug, PartialEq)]
struct Pcm {
    canaux: u16,
    trames: u32,
    bits: u16,
    taux: u32,
    /// `sowt` : AIFF-C dont les échantillons sont DÉJÀ petit-boutistes.
    petit_boutiste: bool,
    /// Décalage des premiers échantillons depuis le début du fichier.
    debut: u64,
    /// Octets d'échantillons disponibles dans SSND.
    octets: u64,
}

/// Flottant étendu 80 bits (IEEE 754, gros-boutiste) → entier : le taux d'échantillonnage d'un
/// chunk COMM.
fn taux_80_bits(b: &[u8; 10]) -> u32 {
    let exposant = (u16::from_be_bytes([b[0], b[1]]) & 0x7FFF) as i32;
    let mantisse = u64::from_be_bytes([b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]]);
    if mantisse == 0 {
        return 0;
    }
    let decalage = exposant - 16383 - 63;
    let v = if decalage >= 0 {
        (mantisse as f64) * 2f64.powi(decalage)
    } else {
        (mantisse as f64) / 2f64.powi(-decalage)
    };
    v.round() as u32
}

fn lire<const N: usize>(r: &mut impl Read) -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    r.read_exact(&mut b)
        .map_err(|e| format!("lecture AIFF : {e}"))?;
    Ok(b)
}

/// Parcourt les chunks IFF jusqu'à avoir COMM et SSND.
fn analyser(f: &mut (impl Read + Seek)) -> Result<Pcm, String> {
    if &lire::<4>(f)? != b"FORM" {
        return Err("pas un fichier IFF".into());
    }
    let _taille = u32::from_be_bytes(lire::<4>(f)?);
    let forme = lire::<4>(f)?;
    let aifc = match &forme {
        b"AIFF" => false,
        b"AIFC" => true,
        _ => return Err("forme IFF non AIFF".into()),
    };
    let mut comm: Option<(u16, u32, u16, u32, bool)> = None;
    let mut ssnd: Option<(u64, u64)> = None;
    while comm.is_none() || ssnd.is_none() {
        let id = match lire::<4>(f) {
            Ok(id) => id,
            Err(_) => break,
        };
        let taille = u64::from(u32::from_be_bytes(lire::<4>(f)?));
        let corps = f.stream_position().map_err(|e| e.to_string())?;
        match &id {
            b"COMM" => {
                let canaux = u16::from_be_bytes(lire::<2>(f)?);
                let trames = u32::from_be_bytes(lire::<4>(f)?);
                let bits = u16::from_be_bytes(lire::<2>(f)?);
                let taux = taux_80_bits(&lire::<10>(f)?);
                let petit = if aifc {
                    match &lire::<4>(f)? {
                        b"NONE" | b"twos" => false,
                        b"sowt" => true,
                        autre => {
                            return Err(format!(
                                "AIFF-C compressé ({}) : hors périmètre",
                                String::from_utf8_lossy(autre)
                            ))
                        }
                    }
                } else {
                    false
                };
                comm = Some((canaux, trames, bits, taux, petit));
            }
            b"SSND" => {
                let decalage = u64::from(u32::from_be_bytes(lire::<4>(f)?));
                let _bloc = lire::<4>(f)?;
                let debut = corps + 8 + decalage;
                let octets = taille.saturating_sub(8 + decalage);
                ssnd = Some((debut, octets));
            }
            _ => {}
        }
        // Chunks alignés sur 2 octets.
        f.seek(SeekFrom::Start(corps + taille + (taille & 1)))
            .map_err(|e| e.to_string())?;
    }
    let (canaux, trames, bits, taux, petit_boutiste) = comm.ok_or("chunk COMM absent")?;
    let (debut, octets) = ssnd.ok_or("chunk SSND absent")?;
    if canaux == 0 || bits == 0 || bits > 32 || taux == 0 {
        return Err(format!(
            "format AIFF inattendu : {canaux} canaux, {bits} bits, {taux} Hz"
        ));
    }
    Ok(Pcm {
        canaux,
        trames,
        bits,
        taux,
        petit_boutiste,
        debut,
        octets,
    })
}

/// Convertit `src` (AIFF ou AIFF-C non compressé) en WAV PCM dans `dst`. Au moindre écart du
/// périmètre, `Err` et `dst` n'est pas laissé à moitié écrit.
pub fn convertir(src: &Path, dst: &Path) -> Result<(), String> {
    let mut entree = BufReader::new(std::fs::File::open(src).map_err(|e| e.to_string())?);
    let pcm = analyser(&mut entree)?;
    let octets_ech = usize::from(pcm.bits.div_ceil(8));
    let bloc = octets_ech * usize::from(pcm.canaux);
    let attendu = u64::from(pcm.trames) * bloc as u64;
    // Un SSND plus court que COMM ne l'annonce (fichier tronqué) : on sert ce qui existe.
    let octets = attendu.min(pcm.octets) / bloc as u64 * bloc as u64;
    if octets > u64::from(u32::MAX) - 44 {
        return Err("AIFF trop long pour un WAV".into());
    }
    entree
        .seek(SeekFrom::Start(pcm.debut))
        .map_err(|e| e.to_string())?;

    let mut ecrire = || -> Result<(), String> {
        let mut sortie = BufWriter::new(std::fs::File::create(dst).map_err(|e| e.to_string())?);
        let io = |e: std::io::Error| e.to_string();
        let taux_octets = pcm.taux * bloc as u32;
        let mut h = Vec::with_capacity(44);
        h.extend_from_slice(b"RIFF");
        h.extend_from_slice(&(36 + octets as u32).to_le_bytes());
        h.extend_from_slice(b"WAVEfmt ");
        h.extend_from_slice(&16u32.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes()); // WAVE_FORMAT_PCM
        h.extend_from_slice(&pcm.canaux.to_le_bytes());
        h.extend_from_slice(&pcm.taux.to_le_bytes());
        h.extend_from_slice(&taux_octets.to_le_bytes());
        h.extend_from_slice(&(bloc as u16).to_le_bytes());
        h.extend_from_slice(&((octets_ech * 8) as u16).to_le_bytes());
        h.extend_from_slice(b"data");
        h.extend_from_slice(&(octets as u32).to_le_bytes());
        sortie.write_all(&h).map_err(io)?;

        let mut tampon = vec![0u8; (64 * 1024 / bloc).max(1) * bloc];
        let mut reste = octets;
        while reste > 0 {
            let n = (tampon.len() as u64).min(reste) as usize;
            entree.read_exact(&mut tampon[..n]).map_err(io)?;
            for e in tampon[..n].chunks_exact_mut(octets_ech) {
                if !pcm.petit_boutiste {
                    e.reverse();
                }
                // 8 bits : signé en AIFF, non signé en WAV.
                if octets_ech == 1 {
                    e[0] ^= 0x80;
                }
            }
            sortie.write_all(&tampon[..n]).map_err(io)?;
            reste -= n as u64;
        }
        sortie.flush().map_err(io)
    };
    ecrire().inspect_err(|_| {
        let _ = std::fs::remove_file(dst);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        std::path::Path::new(&p).exists().then_some(p)
    }

    fn pcm_de(chemin: &str) -> Vec<f32> {
        let mut v = Vec::new();
        crate::analysis::decode::decode_pcm(chemin, 2, |b| v.extend_from_slice(b)).unwrap();
        v
    }

    /// Le WAV produit porte EXACTEMENT les échantillons de l'AIFF, en 16 et 24 bits et en AIFF-C
    /// `sowt` : même nombre, mêmes valeurs, décodés par Symphonia des deux côtés.
    #[test]
    fn le_wav_porte_les_memes_echantillons_que_l_aiff() {
        for nom in ["aiff16.aiff", "aiff24.aiff", "sowt.aifc"] {
            let Some(src) = fixture(nom) else {
                eprintln!("skip: no fixture {nom} (node scripts/make-fixtures.mjs)");
                continue;
            };
            let dir = tempfile::tempdir().unwrap();
            let dst = dir.path().join("sortie.wav");
            convertir(Path::new(&src), &dst).unwrap_or_else(|e| panic!("{nom} : {e}"));
            let (a, w) = (pcm_de(&src), pcm_de(dst.to_str().unwrap()));
            assert_eq!(a.len(), w.len(), "{nom} : nombre d'échantillons");
            assert!(!a.is_empty(), "{nom} : fixture vide");
            assert!(
                a.iter().zip(&w).all(|(x, y)| x == y),
                "{nom} : échantillons différents"
            );
        }
    }

    /// Le taux d'un COMM : 44 100 Hz et 48 000 Hz tels que les écrit un AIFF réel.
    #[test]
    fn le_taux_80_bits_se_lit() {
        assert_eq!(
            taux_80_bits(&[0x40, 0x0E, 0xAC, 0x44, 0, 0, 0, 0, 0, 0]),
            44_100
        );
        assert_eq!(
            taux_80_bits(&[0x40, 0x0E, 0xBB, 0x80, 0, 0, 0, 0, 0, 0]),
            48_000
        );
    }

    /// Banc : réécriture directe contre ffmpeg sur un vrai fichier (`SIFT_AIFF_BANC`), fichier
    /// chaud (lu une fois avant). `cargo test --release -- --ignored banc_aiff --nocapture`.
    #[test]
    #[ignore]
    fn banc_aiff_direct_contre_ffmpeg() {
        let Ok(src) = std::env::var("SIFT_AIFF_BANC") else {
            eprintln!("skip: SIFT_AIFF_BANC non posé");
            return;
        };
        let _ = std::fs::read(&src).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let t = std::time::Instant::now();
        convertir(Path::new(&src), &dir.path().join("direct.wav")).unwrap();
        let direct = t.elapsed();
        let t = std::time::Instant::now();
        crate::encode::encode(
            &src,
            dir.path().join("ffmpeg.wav").to_str().unwrap(),
            crate::encode::Target::Wav1644,
        )
        .unwrap();
        eprintln!("direct {direct:?} · ffmpeg {:?}", t.elapsed());
    }

    /// Un fichier hors périmètre rend Err et ne laisse aucune sortie.
    #[test]
    fn hors_perimetre_rend_err_sans_sortie() {
        let dir = tempfile::tempdir().unwrap();
        let faux = dir.path().join("faux.aiff");
        std::fs::write(&faux, b"FORM\0\0\0\x04WAVE").unwrap();
        let dst = dir.path().join("sortie.wav");
        assert!(convertir(&faux, &dst).is_err());
        assert!(!dst.exists());
    }
}
