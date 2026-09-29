//! Cover-art cache. Covers are downloaded into a per-app cache dir keyed by Discogs release id
//! so the same release isn't re-fetched. Download is best-effort: failures are non-fatal (the
//! caller applies metadata anyway). Only the path mapping is unit-tested (no network in CI).

use std::path::{Path, PathBuf};
use std::time::Duration;

/// The cache path for a release's cover. `release_id` is sanitized so it can't escape `dir`.
pub fn cover_path(dir: &Path, release_id: &str) -> PathBuf {
    let safe: String = release_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    dir.join(format!("{safe}.jpg"))
}

/// Ce que le téléchargement de la pochette d'une release a donné. Distingué pour un CHANGEMENT de
/// release (#68) : une release SANS image fait retirer la pochette du fichier, une PANNE (réseau,
/// délai, disque) la fait garder — vider sur une simple coupure effacerait la pochette qu'on avait.
#[derive(Debug, PartialEq)]
pub enum CoverFetch {
    Downloaded(PathBuf),
    /// Pas d'URL, ou le « no image » de Discogs (moins de 1 Ko) : la release n'a pas de pochette.
    NoImage,
    Failed(String),
}

/// Download the cover of `release_id` into `dir` (idempotent: an already-cached file is returned
/// without re-downloading). `url` absent → `NoImage`.
pub fn fetch_cover(dir: &Path, release_id: &str, url: Option<&str>) -> CoverFetch {
    let Some(url) = url else {
        return CoverFetch::NoImage;
    };
    let out = cover_path(dir, release_id);
    if out.exists() {
        return CoverFetch::Downloaded(out);
    }
    if let Err(e) = std::fs::create_dir_all(dir) {
        return CoverFetch::Failed(e.to_string());
    }
    let resp = ureq::get(url)
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .header("User-Agent", concat!("Sift/", env!("CARGO_PKG_VERSION")))
        .call();
    let mut resp = match resp {
        Ok(r) => r,
        Err(e) => return CoverFetch::Failed(e.to_string()),
    };
    let bytes = match resp
        .body_mut()
        .with_config()
        .limit(10 * 1024 * 1024) // cap at 10 MB
        .read_to_vec()
    {
        Ok(b) => b,
        Err(e) => return CoverFetch::Failed(e.to_string()),
    };
    classify_download(&out, bytes)
}

/// Discogs sometimes serves a tiny "no image available" placeholder (a spacer GIF, a few dozen
/// bytes) instead of real art on this same cover_url mechanism — caching it verbatim showed a
/// broken/blank image forever. Real Discogs cover art is always several KB+; anything under this
/// floor is the placeholder: the release HAS no cover, which is not a failure.
fn classify_download(out: &Path, bytes: Vec<u8>) -> CoverFetch {
    if bytes.len() < 1024 {
        return CoverFetch::NoImage;
    }
    match std::fs::write(out, &bytes) {
        Ok(()) => CoverFetch::Downloaded(out.to_path_buf()),
        Err(e) => CoverFetch::Failed(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #68 : le « no image » de Discogs dit « pas de pochette » (on la retire du fichier), une image
    /// réelle se pose, et une URL absente dit la même chose que le « no image ».
    #[test]
    fn un_placeholder_est_une_release_sans_pochette_pas_une_panne() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("r.jpg");
        assert_eq!(classify_download(&out, vec![0u8; 40]), CoverFetch::NoImage);
        assert!(!out.exists(), "le placeholder n'est pas mis en cache");
        assert_eq!(
            classify_download(&out, vec![0u8; 4096]),
            CoverFetch::Downloaded(out.clone())
        );
        assert_eq!(fetch_cover(dir.path(), "1", None), CoverFetch::NoImage);
    }

    #[test]
    fn path_is_under_dir_and_keyed_by_release_id() {
        let dir = std::path::Path::new("/cache/covers");
        let p = cover_path(dir, "12345");
        assert_eq!(p, std::path::Path::new("/cache/covers/12345.jpg"));
    }

    #[test]
    fn release_id_is_sanitized() {
        let dir = std::path::Path::new("/cache/covers");
        let p = cover_path(dir, "a/b");
        assert_eq!(p, std::path::Path::new("/cache/covers/a_b.jpg"));
    }
}
