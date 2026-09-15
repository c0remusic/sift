//! Intégration FFmpeg par le crate `ffmpeg-sidecar`, pointé sur NOTRE binaire.
//!
//! Modèle de binaire, sans téléchargement à l'exécution :
//!
//! - **release** : `externalBin` de Tauri place le sidecar à côté du binaire de l'app, sous le nom
//!   `ffmpeg(.exe)`. `ffmpeg_sidecar::paths::ffmpeg_path()` le résout par adjacence à
//!   `current_exe()`, et c'est le bon.
//! - **dev et TEST** : le binaire bundlé vit à `<manifest>/binaries/ffmpeg-<triple>`, et
//!   [`chemin`] le désigne explicitement.
//!
//! ⚠️ La condition est `any(debug_assertions, test)`, et le second terme n'est pas décoratif :
//! `cargo test --release` compile avec `debug_assertions` DÉSACTIVÉ — il n'y a ni
//! `[profile.release]` dans `Cargo.toml` ni `.cargo/config.toml` pour le rallumer. Or c'est
//! exactement l'invocation que `CLAUDE.md` documente pour les benchmarks
//! (`cargo test --release -- --ignored --nocapture`), dont `bench_cpu_budget` qui MESURE des
//! débits d'encodage. Le premier correctif de ce module, le 2026-09-15, ne portait que
//! `debug_assertions` : sous `--release`, l'encodage repartait sur le PATH, et le test censé
//! l'attraper n'était pas compilé non plus — `running 0 tests`. Une gate absente là où le défaut
//! survit.
//!
//! ⚠️ **Ce module posait `FFMPEG_BINARY` jusqu'au 2026-09-15, et cette variable n'existe pas.**
//! Vérifié dans la source liée de `ffmpeg-sidecar` 2.5.2 : zéro occurrence de `FFMPEG_BINARY` dans
//! tout le crate, dont la seule variable d'environnement lue est `KEEP_ONLY_FFMPEG`
//! (`download.rs:10`, un chemin que nous n'empruntons pas). `paths::ffmpeg_path()` prend le binaire
//! adjacent à `current_exe()`, sinon retombe sur `"ffmpeg"` du PATH système.
//!
//! La conséquence n'était PAS la même partout, et c'est ce qui l'a rendue invisible :
//!
//! - sous `tauri dev`, `current_exe()` est `target/debug/sift.exe` et Tauri a copié `ffmpeg.exe`
//!   à côté — mesuré identique au bundlé au SHA256 près — donc le bon binaire tournait, par un
//!   mécanisme que personne n'avait écrit ;
//! - sous `cargo test`, `current_exe()` est `target/debug/deps/sift_lib-<hash>.exe`, et il n'y a
//!   **aucun** `ffmpeg.exe` dans `deps/` : la résolution retombait sur le PATH système. Toutes les
//!   mesures d'encodage et d'empreinte faites en test portaient donc sur un binaire non identifié
//!   — sur cette machine, un shim WinGet de 141 octets.
//!
//! [`le_binaire_lance_est_celui_que_nous_avons_bundle`] est la gate qui tient ce fait, et elle
//! vise ce qui est réellement lancé, pas la présence d'un fichier sur le disque.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Le chemin du binaire ffmpeg à lancer. À passer à **tout** point de lancement.
///
/// Calculé une fois. En debug OU en test — donc en dev, en `cargo test` ET en
/// `cargo test --release` — c'est le binaire bundlé, désigné explicitement parce que l'adjacence
/// ne tient pas sous `cargo test` : `current_exe()` y vit dans `deps/`, où rien ne dépose de
/// sidecar. Dans le binaire RELEASE expédié, `cfg(test)` est faux et l'adjacence est le mécanisme
/// correct et suffisant : `externalBin` garantit le voisin.
///
/// Le repli sur `paths::ffmpeg_path()` n'est pas un fallback silencieux : en debug, `tauri-build`
/// refuse déjà de compiler quand `binaries/ffmpeg-<triple>` manque (`cargo check` sort en 101,
/// « resource path doesn't exist »), donc la branche `None` n'est atteignable que si le fichier
/// disparaît entre la compilation et l'exécution.
pub fn chemin() -> PathBuf {
    static CHEMIN: OnceLock<PathBuf> = OnceLock::new();
    CHEMIN
        .get_or_init(|| {
            #[cfg(any(debug_assertions, test))]
            if let Some(p) = find_bundled_ffmpeg() {
                return p;
            }
            ffmpeg_sidecar::paths::ffmpeg_path()
        })
        .clone()
}

/// Localise le binaire bundlé de dev à `<manifest>/binaries/ffmpeg-<triple>(.exe)`.
///
/// `any(debug_assertions, test)` et pas `debug_assertions` seul : la fonction doit exister
/// partout où [`chemin`] l'appelle, sinon `clippy -D warnings` la déclare morte sous
/// `--release --test`.
#[cfg(any(debug_assertions, test))]
fn find_bundled_ffmpeg() -> Option<std::path::PathBuf> {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("ffmpeg-"))
                .unwrap_or(false)
        })
}

/// La version du binaire que [`chemin`] désigne — donc celui qui encodera réellement.
pub fn version() -> Result<String, String> {
    ffmpeg_sidecar::version::ffmpeg_version_with_path(chemin()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    /// **Le binaire réellement lancé est celui que nous avons bundlé.**
    ///
    /// Remplace `finds_bundled_ffmpeg_in_dev`, dont le doc annonçait « validates the dev
    /// binary-resolution logic — the exact wiring we de-risk here » alors qu'il ne vérifiait que
    /// la présence d'un fichier dans `binaries/`. C'est l'écart entre le label et la portée qui a
    /// laissé passer deux ans de `FFMPEG_BINARY` inopérant : le fichier était bien là, et le test
    /// vert ; c'est le lancement qui allait ailleurs.
    ///
    /// MUTATION qui le fait tomber : dans [`super::chemin`], retirer la branche debug pour rendre
    /// `ffmpeg_sidecar::paths::ffmpeg_path()` — sous `cargo test`, `current_exe()` est dans
    /// `target/debug/deps/`, où aucun `ffmpeg.exe` ne vit, donc le repli rend le `"ffmpeg"`
    /// relatif du PATH et l'assertion d'appartenance à `binaries/` tombe.
    ///
    /// ⚠️ **Sans `#[cfg(debug_assertions)]`, et c'est le point.** Il le portait, donc il n'était
    /// pas compilé sous `cargo test --release` — `running 0 tests` — c'est-à-dire précisément là
    /// où le défaut survivait. Une gate qui disparaît avec le profil qu'elle doit couvrir ne
    /// couvre rien.
    ///
    /// Demande `npm run fetch-ffmpeg` — même prérequis qu'avant.
    #[test]
    fn le_binaire_lance_est_celui_que_nous_avons_bundle() {
        let lance = super::chemin();
        assert!(
            lance.is_file(),
            "le chemin résolu doit exister : {} — lancer `npm run fetch-ffmpeg`",
            lance.display()
        );
        let attendu = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        assert!(
            lance.starts_with(&attendu),
            "le binaire lancé doit être le bundlé ({}), pas {}",
            attendu.display(),
            lance.display()
        );
    }
}
