//! Budget CPU partagé entre le pool d'analyse et le pool d'encodage — **ligne 6 du diagnostic
//! architectural du 2026-07-13**.
//!
//! Pourquoi ce fichier existe. L'audit final du 2026-08-05
//! (`docs/superpowers/changes/2026-08-05-audit-archi/review.md`) a trouvé que cette ligne était
//! comptée close alors qu'elle n'avait **jamais été mesurée**. La Phase 5 avait mesuré l'attente
//! du verrou SQLite (`bench_sqlite.rs`) — une autre question : un `Mutex<Connection>` tenu 0,4 %
//! du temps ne dit rien de N threads de FFT tournant en même temps que M process FFmpeg
//! eux-mêmes multi-threads.
//!
//! ## Pourquoi des débits et non des durées
//!
//! Une première version chronométrait trois passages sur le même lot : analyse seule, encodage
//! seul, les deux ensemble. Elle a été jetée après sa première exécution, qui l'a réfutée :
//! l'analyse mettait 1,49 s là où l'encodage mettait 28,13 s. L'analyse finissait donc dans les
//! 5 % premiers de la fenêtre commune, « les deux ensemble » valait mécaniquement « encodage
//! seul », et l'écart résiduel ne mesurait que le cache disque réchauffé entre les passages —
//! au point de rendre une position négative, sous la borne de cohabitation parfaite.
//!
//! Ce fichier mesure donc, pour chaque charge, **combien de fichiers elle traite par seconde**
//! sur une fenêtre de durée fixe, seule puis pendant que l'autre tourne. Le rapport des deux est
//! la part de débit conservée. Cette forme est insensible au déséquilibre : les deux pools
//! tournent pendant TOUTE la fenêtre commune, quel que soit leur coût unitaire.
//!
//! ## Lecture
//!
//! - conservation ≈ 100 % des deux côtés → les charges cohabitent, la ligne 6 se ferme en
//!   « écartée, motif mesuré », comme les lignes 3 et 7 ;
//! - conservation ≈ 50 % des deux côtés → elles se partagent une ressource saturée, et le
//!   sémaphore partagé qu'envisageait la spec devient justifié ;
//! - asymétrie forte → une charge écrase l'autre, ce qui est un résultat en soi : c'est
//!   l'ordonnancement qu'il faut corriger, pas le budget total.
//!
//! ## Aucune erreur n'est avalée
//!
//! La version jetée faisait `let _ = analyze(...)`. Une phase qui échouait entièrement se lisait
//! alors comme une phase rapide — exactement le fallback silencieux que la méthode du projet
//! interdit. Ici chaque passage compte ses succès ET ses échecs, les publie, et le verdict est
//! refusé si une charge n'a pas au moins un succès.
//!
//! Lancement (jamais dans la suite normale) :
//! ```text
//! SIFT_BENCH_TRACKS_DIR=<dossier de vrais fichiers audio> \
//!   cargo test --manifest-path src-tauri/Cargo.toml --release \
//!   -- --ignored --nocapture bench_cpu_budget
//! ```

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const EXTS: [&str; 5] = ["mp3", "flac", "wav", "aif", "aiff"];
/// Assez de fichiers pour qu'une fenêtre de mesure n'en refasse pas toujours le même.
const MAX_FILES: usize = 24;
/// Durée de chaque fenêtre. Assez longue pour absorber la variance d'un encodage, assez courte
/// pour que les quatre fenêtres tiennent en quelques minutes.
const WINDOW: Duration = Duration::from_secs(20);

/// Le lot de travail, ou `None` avec un message si l'environnement n'est pas gréé.
fn bench_files() -> Option<Vec<PathBuf>> {
    let Ok(dir) = std::env::var("SIFT_BENCH_TRACKS_DIR") else {
        println!("\n=== Ligne 6 · budget CPU : IGNORE ===");
        println!("  definir SIFT_BENCH_TRACKS_DIR sur un dossier de vrais fichiers audio");
        return None;
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("lecture du dossier de benchmark")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    files.truncate(MAX_FILES);
    if files.is_empty() {
        println!("\n=== Ligne 6 · budget CPU : IGNORE ===");
        println!("  aucun fichier audio dans {dir}");
        return None;
    }
    Some(files)
}

/// Succès et échecs d'une fenêtre de mesure, plus sa durée réelle.
struct Tally {
    ok: usize,
    err: usize,
    elapsed: Duration,
}

impl Tally {
    /// Fichiers traités avec succès par seconde. C'est la seule grandeur comparable entre une
    /// fenêtre seule et une fenêtre partagée.
    fn rate(&self) -> f64 {
        let s = self.elapsed.as_secs_f64();
        if s > 0.0 {
            self.ok as f64 / s
        } else {
            0.0
        }
    }
}

/// Fait tourner `n` threads sur `files` **en rond** jusqu'à ce que `stop` passe à vrai ou que la
/// fenêtre expire, et compte succès/échecs. Le curseur atomique équilibre naturellement : un
/// fichier long ne bloque pas les autres threads, ce qu'un découpage en tranches fixes aurait
/// fait — et qui aurait fabriqué de la fausse contention.
fn run_window<F>(files: &[PathBuf], n: usize, stop: &AtomicBool, work: &F) -> Tally
where
    F: Fn(&Path, usize) -> bool + Sync,
{
    let cursor = AtomicUsize::new(0);
    let ok = AtomicUsize::new(0);
    let err = AtomicUsize::new(0);
    let t = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..n {
            s.spawn(|| loop {
                if stop.load(Ordering::Relaxed) || t.elapsed() >= WINDOW {
                    break;
                }
                let i = cursor.fetch_add(1, Ordering::Relaxed);
                let f = &files[i % files.len()];
                if work(f, i) {
                    ok.fetch_add(1, Ordering::Relaxed);
                } else {
                    err.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });
    Tally {
        ok: ok.load(Ordering::Relaxed),
        err: err.load(Ordering::Relaxed),
        elapsed: t.elapsed(),
    }
}

/// Le travail d'analyse tel que le pool de production l'exécute : `false` = sans conserver la
/// grille de spectrogramme (décision du 2026-08-03, `worker.rs`). La FFT tourne quand même — le
/// verdict en dépend — donc le coût CPU mesuré ici est bien celui de production.
fn analysis_work(p: &Path, _seq: usize) -> bool {
    crate::analysis::analyze(&p.to_string_lossy(), false).is_ok()
}

/// Un encodage MP3 320 par fichier. MP3 est la seule cible qu'aucune source ne peut refuser :
/// `guard_no_upscale` n'interdit que lossy → lossless. `seq` rend le nom unique, sans quoi deux
/// threads écriraient le même fichier de sortie.
fn encode_work(out_dir: &Path, p: &Path, seq: usize) -> bool {
    let dst = out_dir.join(format!("bench-{seq}.mp3"));
    let done = crate::encode::encode(
        &p.to_string_lossy(),
        &dst.to_string_lossy(),
        crate::encode::Target::Mp3320,
    )
    .is_ok();
    let _ = std::fs::remove_file(&dst); // sinon le disque enfle pendant la fenêtre
    done
}

#[test]
#[ignore]
fn bench_analysis_and_encode_cpu_budget() {
    let Some(files) = bench_files() else { return };
    crate::ffmpeg::init_ffmpeg_path();

    let n_analysis = crate::worker::analysis_pool_size();
    let n_encode = crate::ipc_filing::phase2_worker_count();
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);

    let out_dir = std::env::temp_dir().join("sift-bench-cpu-budget");
    std::fs::create_dir_all(&out_dir).expect("creation du dossier de sortie");
    let enc = |p: &Path, seq: usize| encode_work(&out_dir, p, seq);

    println!("\n=== Ligne 6 · budget CPU partage analyse <-> encodage ===");
    println!("  coeurs disponibles   : {cores}");
    println!("  pool analyse (prod)  : {n_analysis} threads  [worker::analysis_pool_size]");
    println!("  pool encodage (prod) : {n_encode} process   [ipc_filing::phase2_worker_count]");
    println!("  lot                  : {} fichiers", files.len());
    println!("  fenetre              : {WINDOW:?} par mesure");
    println!("  ⚠ chaque process ffmpeg est lui-meme multi-thread : le total reel depasse");
    println!("    {n_analysis} + {n_encode} threads, c'est tout l'objet de la mesure.");

    // Préchauffage : une passe d'analyse hors mesure, pour que le cache disque du système soit
    // dans le même état à toutes les fenêtres. Sans lui, la première mesure paie les lectures
    // disque des suivantes — c'est ce qui avait rendu une position négative dans la version
    // jetée de ce benchmark.
    let never = AtomicBool::new(false);
    let warm = run_window(&files, n_analysis, &never, &analysis_work);
    println!("\n  prechauffage (hors mesure) : {} lectures\n", warm.ok);

    let a_alone = run_window(&files, n_analysis, &never, &analysis_work);
    println!(
        "  A · analyse seule    : {:>5} ok / {:>3} echecs en {:>6.2?}  -> {:>6.2} fichiers/s",
        a_alone.ok,
        a_alone.err,
        a_alone.elapsed,
        a_alone.rate()
    );

    let b_alone = run_window(&files, n_encode, &never, &enc);
    println!(
        "  B · encodage seul    : {:>5} ok / {:>3} echecs en {:>6.2?}  -> {:>6.2} fichiers/s",
        b_alone.ok,
        b_alone.err,
        b_alone.elapsed,
        b_alone.rate()
    );

    // Fenêtre partagée. Les deux pools démarrent ensemble ; le premier à finir sa fenêtre lève
    // `stop`, pour que l'autre ne continue pas SEUL et ne gonfle pas son propre débit avec du
    // temps non partagé — c'est le piège central de cette mesure.
    let stop = AtomicBool::new(false);
    let (a_shared, b_shared) = std::thread::scope(|s| {
        let ha = s.spawn(|| {
            let t = run_window(&files, n_analysis, &stop, &analysis_work);
            stop.store(true, Ordering::Relaxed);
            t
        });
        let hb = s.spawn(|| {
            let t = run_window(&files, n_encode, &stop, &enc);
            stop.store(true, Ordering::Relaxed);
            t
        });
        (
            ha.join().expect("thread analyse"),
            hb.join().expect("thread encodage"),
        )
    });
    println!(
        "\n  C · analyse PENDANT encodage  : {:>5} ok / {:>3} echecs en {:>6.2?}  -> {:>6.2} fichiers/s",
        a_shared.ok, a_shared.err, a_shared.elapsed, a_shared.rate()
    );
    println!(
        "  C · encodage PENDANT analyse  : {:>5} ok / {:>3} echecs en {:>6.2?}  -> {:>6.2} fichiers/s",
        b_shared.ok, b_shared.err, b_shared.elapsed, b_shared.rate()
    );

    let _ = std::fs::remove_dir_all(&out_dir);

    // Refus de conclure plutôt que conclusion sur du vide : c'est le défaut exact que l'audit
    // reprochait à la ligne 6.
    if a_alone.ok == 0 || b_alone.ok == 0 {
        println!("\n  VERDICT REFUSE : une charge n'a produit aucun succes.");
        println!(
            "    analyse {} ok, encodage {} ok — corriger l'environnement (ffmpeg bundle ?",
            a_alone.ok, b_alone.ok
        );
        println!("    fichiers decodables ?) avant de relire ce benchmark.");
        return;
    }

    let keep_a = a_shared.rate() / a_alone.rate() * 100.0;
    let keep_b = b_shared.rate() / b_alone.rate() * 100.0;
    println!("\n  DEBIT CONSERVE EN PARTAGE");
    println!("    analyse  : {keep_a:>6.1} %");
    println!("    encodage : {keep_b:>6.1} %");
    println!(
        "    somme    : {:>6.1} %   (200 % = cohabitation parfaite, 100 % = ressource saturee)",
        keep_a + keep_b
    );

    let sum = keep_a + keep_b;
    println!(
        "\n  Lecture : {}",
        if sum >= 170.0 {
            "cohabitation. Fermer la ligne 6 en « ecartee, motif mesure »."
        } else if sum >= 130.0 {
            "contention partielle. Decider sur la gene percue, pas sur ce seul chiffre."
        } else {
            "ressource saturee. Le budget partage de la spec est justifie."
        }
    );
    if (keep_a - keep_b).abs() > 40.0 {
        println!("  ⚠ Asymetrie forte : une charge ecrase l'autre. C'est l'ordonnancement qui");
        println!("    est en cause, pas le budget total — le semaphore n'y repondrait pas.");
    }
}
