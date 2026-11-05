//! Protocole `sift-audio:` : sert un AIFF au lecteur comme un WAV, à la volée, sans fichier.
//!
//! Chromium ne lit pas l'AIFF. Chaque piste jamais écoutée passait par une conversion disque avant
//! de jouer, et le préchargement convertissait aussi la suivante. Décision du 2026-11-03 (issue
//! #91) : rien n'est écrit, rien n'est préparé. Les octets demandés par `Range` sont lus dans l'AIFF
//! et inversés au moment de la requête (`aiff_wav::Flux`).
//!
//! Même garde que le scope `asset:` : seul un chemin que `ipc::playback_url` a vérifié contre la
//! base est servi. Le protocole lit donc un ensemble en mémoire et ne prend jamais le verrou de la
//! base, ce qui compte pendant une analyse : un saut dans la piste ne doit pas l'attendre.
use crate::aiff_wav;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::http::{header, Request, Response, StatusCode};

pub const SCHEME: &str = "sift-audio";

/// Taille maximale d'une réponse à une plage ouverte, la même que le protocole `asset:` de Tauri.
const MAX_OCTETS: u64 = 1000 * 1024;

/// Les chemins que `playback_url` a vérifiés contre la base pendant cette session.
#[derive(Default)]
pub struct FluxAutorises(Mutex<HashSet<String>>);

impl FluxAutorises {
    pub fn autoriser(&self, chemin: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| format!("verrou des flux audio empoisonné : {e}"))?
            .insert(chemin.to_string());
        Ok(())
    }

    fn contient(&self, chemin: &str) -> Result<bool, String> {
        Ok(self
            .0
            .lock()
            .map_err(|e| format!("verrou des flux audio empoisonné : {e}"))?
            .contains(chemin))
    }
}

/// `convertFileSrc` passe le chemin par `encodeURIComponent` : `%XX` en UTF-8.
fn decoder_chemin(uri: &str) -> Option<String> {
    let brut = uri.strip_prefix('/').unwrap_or(uri).as_bytes();
    let mut sortie = Vec::with_capacity(brut.len());
    let mut i = 0;
    while i < brut.len() {
        if brut[i] == b'%' {
            let hex = std::str::from_utf8(brut.get(i + 1..i + 3)?).ok()?;
            sortie.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            sortie.push(brut[i]);
            i += 1;
        }
    }
    String::from_utf8(sortie).ok()
}

/// Plage d'octets demandée, bornes incluses. `Err` : plage invalide ou multiple, que le lecteur ne
/// demande jamais.
fn lire_plage(entete: &str, total: u64) -> Result<(u64, u64), ()> {
    let spec = entete.strip_prefix("bytes=").ok_or(())?;
    let (a, b) = spec.split_once('-').ok_or(())?;
    if spec.contains(',') || total == 0 {
        return Err(());
    }
    if a.is_empty() {
        let n: u64 = b.parse().map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        return Ok((total.saturating_sub(n), total - 1));
    }
    let debut: u64 = a.parse().map_err(|_| ())?;
    let fin: u64 = if b.is_empty() {
        total - 1
    } else {
        b.parse().map_err(|_| ())?
    };
    if debut >= total || fin < debut {
        return Err(());
    }
    Ok((debut, fin.min(total - 1)))
}

fn reponse(statut: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(statut)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
}

fn vide(statut: StatusCode) -> Response<Vec<u8>> {
    let r = reponse(statut).body(Vec::new());
    r.unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Sert un fichier AIFF vu comme un WAV.
fn servir(chemin: &str, plage: Option<&str>) -> Response<Vec<u8>> {
    let mut f = match std::fs::File::open(chemin) {
        Ok(f) => std::io::BufReader::new(f),
        Err(e) => {
            log::warn!("sift-audio : ouverture impossible ({e}) : {chemin}");
            return vide(StatusCode::NOT_FOUND);
        }
    };
    let flux = match aiff_wav::ouvrir(&mut f) {
        Ok(flux) => flux,
        Err(e) => {
            log::warn!("sift-audio : AIFF refusé ({e}) : {chemin}");
            return vide(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
    };
    let total = flux.taille();
    let (debut, fin, partiel) = match plage {
        None => (0, total.saturating_sub(1), false),
        Some(p) => match lire_plage(p, total) {
            Ok((d, f)) => (d, f.min(d + MAX_OCTETS - 1), true),
            Err(()) => {
                let r = reponse(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .body(Vec::new());
                return r.unwrap_or_else(|_| vide(StatusCode::RANGE_NOT_SATISFIABLE));
            }
        },
    };
    let octets = match flux.lire(&mut f, debut, (fin + 1 - debut) as usize) {
        Ok(o) => o,
        Err(e) => {
            log::warn!("sift-audio : lecture impossible ({e}) : {chemin}");
            return vide(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let statut = if partiel {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let mut r = reponse(statut)
        .header(header::CONTENT_TYPE, "audio/wav")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, octets.len());
    if partiel {
        r = r
            .header(
                header::CONTENT_RANGE,
                format!("bytes {debut}-{fin}/{total}"),
            )
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "content-range");
    }
    r.body(octets)
        .unwrap_or_else(|_| vide(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Répond à une requête du protocole. Un chemin non autorisé rend 403 sans toucher au disque.
pub fn repondre(autorises: &FluxAutorises, requete: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(chemin) = decoder_chemin(requete.uri().path()) else {
        return vide(StatusCode::BAD_REQUEST);
    };
    match autorises.contient(&chemin) {
        Ok(true) => {}
        Ok(false) => {
            log::warn!("sift-audio : chemin non autorisé : {chemin}");
            return vide(StatusCode::FORBIDDEN);
        }
        Err(e) => {
            log::error!("{e}");
            return vide(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    let plage = requete
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    servir(&chemin, plage)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AIFF 16 bits stéréo à 44,1 kHz, échantillons distincts pour voir tout décalage.
    fn aiff(dir: &std::path::Path) -> String {
        let trames: u32 = 40_000;
        let mut ssnd = vec![0u8; 8];
        for i in 0..(trames * 4) {
            ssnd.push((i >> 8) as u8);
            ssnd.push(i as u8);
        }
        let mut comm = Vec::new();
        comm.extend_from_slice(&2u16.to_be_bytes());
        comm.extend_from_slice(&trames.to_be_bytes());
        comm.extend_from_slice(&16u16.to_be_bytes());
        comm.extend_from_slice(&[0x40, 0x0E, 0xAC, 0x44, 0, 0, 0, 0, 0, 0]);
        let mut corps = b"AIFF".to_vec();
        corps.extend_from_slice(b"COMM");
        corps.extend_from_slice(&(comm.len() as u32).to_be_bytes());
        corps.extend_from_slice(&comm);
        corps.extend_from_slice(b"SSND");
        corps.extend_from_slice(&(ssnd.len() as u32).to_be_bytes());
        corps.extend_from_slice(&ssnd);
        let mut f = b"FORM".to_vec();
        f.extend_from_slice(&(corps.len() as u32).to_be_bytes());
        f.extend_from_slice(&corps);
        let p = dir.join("été à l'ouest.aiff");
        std::fs::write(&p, f).unwrap();
        p.to_string_lossy().to_string()
    }

    fn encode(chemin: &str) -> String {
        chemin
            .bytes()
            .map(|b| match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' | b'-' | b'_' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    fn requete(chemin: &str, plage: Option<&str>) -> Request<Vec<u8>> {
        let mut r =
            Request::builder().uri(format!("http://sift-audio.localhost/{}", encode(chemin)));
        if let Some(p) = plage {
            r = r.header(header::RANGE, p);
        }
        r.body(Vec::new()).unwrap()
    }

    #[test]
    fn un_chemin_non_autorise_rend_403() {
        let dir = tempfile::tempdir().unwrap();
        let p = aiff(dir.path());
        let r = repondre(&FluxAutorises::default(), &requete(&p, None));
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
        assert!(r.body().is_empty());
    }

    /// Le lecteur saute n'importe où, y compris au milieu d'un échantillon : recoller les plages
    /// redonne le fichier entier, octet pour octet.
    #[test]
    fn des_plages_non_alignees_redonnent_le_wav_entier() {
        let dir = tempfile::tempdir().unwrap();
        let p = aiff(dir.path());
        let a = FluxAutorises::default();
        a.autoriser(&p).unwrap();
        let entier = repondre(&a, &requete(&p, None));
        assert_eq!(entier.status(), StatusCode::OK);
        let entier = entier.into_body();
        assert_eq!(entier.len(), 44 + 160_000);
        assert_eq!(&entier[..4], b"RIFF");
        assert_eq!(&entier[36..40], b"data");
        // Premier échantillon 0x0000, deuxième 0x0001, en petit-boutiste.
        assert_eq!(&entier[44..48], &[0, 0, 1, 0]);

        let mut recolle = Vec::new();
        for taille in [1, 3, 7, 1021] {
            recolle.clear();
            while recolle.len() < entier.len() {
                let (d, f) = (recolle.len(), recolle.len() + taille - 1);
                let r = repondre(&a, &requete(&p, Some(&format!("bytes={d}-{f}"))));
                assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
                recolle.extend_from_slice(r.body());
                if taille == 1 && recolle.len() > 200 {
                    recolle.extend_from_slice(&entier[recolle.len()..]);
                }
            }
            assert!(recolle == entier, "plages de {taille} octets");
        }
    }

    /// Une plage ouverte s'arrête à `MAX_OCTETS` et annonce la taille totale, sans quoi le lecteur
    /// ne sait pas où sauter.
    #[test]
    fn une_plage_ouverte_annonce_le_total() {
        let dir = tempfile::tempdir().unwrap();
        let p = aiff(dir.path());
        let a = FluxAutorises::default();
        a.autoriser(&p).unwrap();
        let r = repondre(&a, &requete(&p, Some("bytes=100-")));
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            r.headers()[header::CONTENT_RANGE],
            "bytes 100-160043/160044"
        );
        assert_eq!(r.headers()[header::CONTENT_TYPE], "audio/wav");
        assert_eq!(r.body().len(), 159_944);
        let r = repondre(&a, &requete(&p, Some("bytes=999999-")));
        assert_eq!(r.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes */160044");
    }

    #[test]
    fn la_plage_se_lit() {
        assert_eq!(lire_plage("bytes=0-", 10), Ok((0, 9)));
        assert_eq!(lire_plage("bytes=2-4", 10), Ok((2, 4)));
        assert_eq!(lire_plage("bytes=2-400", 10), Ok((2, 9)));
        assert_eq!(lire_plage("bytes=-3", 10), Ok((7, 9)));
        assert_eq!(lire_plage("bytes=10-", 10), Err(()));
        assert_eq!(lire_plage("bytes=4-2", 10), Err(()));
        assert_eq!(lire_plage("bytes=0-1,3-4", 10), Err(()));
        assert_eq!(lire_plage("octets=0-1", 10), Err(()));
    }
}
