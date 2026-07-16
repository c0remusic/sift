# Audit Rust — override projet Sift

Chargé par `auditor.md` EN PLUS du module global `~/.claude/rules/audit/rust.md`,
jamais à sa place. Le global porte le savoir générique du langage ; ce fichier
ne porte QUE les spécificités vérifiées de Sift qui précisent ou relâchent le
générique. Source : contenu spécifique déplacé depuis l'ex-agent
`dj-assistant-m6a/.claude/agents/rust-engineer.md`.

Cible : backend Sift (`src-tauri/`, crate `sift_lib`) — app desktop Tauri v2.
Pas un projet de systems-programming, pas une lib publiée, pas un service async.

## Forme réelle du code (vérifiée, pas supposée)

- **MSRV 1.77.2, edition 2021.** Modules plats par domaine (voir `CLAUDE.md`
  racine pour la liste), pas un workspace multi-crate.
- **Sync, aucun runtime async.** Ni `tokio` ni `async-std` dans l'arbre. La
  concurrence est un petit pool `std::thread::spawn` dimensionné sur
  `std::thread::available_parallelism()`, coordonné par `Arc<Mutex<...>> +
  Condvar` (`worker.rs`) — pas de channels, pas d'executor. Ne pas proposer de
  patterns async : ils ne s'appliquent pas ici. → Relâche la section
  « Concurrence » du module global (les items async/tokio ne s'appliquent pas).
- **Accès SQLite = `Mutex<Connection>` derrière un Tauri `State`.** Utiliser
  `db::lock_conn(&conn)` (extrait 2026-07, remplace ~40 sites de lock dupliqués)
  plutôt que `.lock().map_err(...)` à la main.
- **Pas de FFI au sens C/`bindgen`/`cbindgen`.** La seule frontière qui y
  ressemble est le sidecar FFmpeg (`ffmpeg-sidecar` spawne un binaire bundlé en
  sous-process) — c'est de l'I/O de process, pas un passage d'ABI. Le codebase a
  exactement **un** bloc `unsafe` (`lib.rs`, `DwmExtendFrameIntoClientArea`, API
  Win32 de titlebar) ; s'il est touché, ajouter le `// SAFETY:` manquant. Pas de
  surface `no_std`/embarqué/WASM — ne pas appliquer ces patterns.
- **Erreurs : enums à la main** (`Debug, Clone, PartialEq` + `Display` manuel +
  `impl std::error::Error`), ex. `MasterDbError` (`rekordbox_masterdb.rs`). À la
  frontière IPC Tauri, les commandes renvoient `Result<T, String>` via
  `.map_err(|e| e.to_string())`, pas un `Serialize` dérivé sur le type d'erreur.
  Le projet **n'utilise pas** `thiserror`/`anyhow` — ne pas les introduire sans
  le signaler d'abord. → Surcharge l'item global « `Box<dyn Error>` → thiserror » :
  ici l'absence de thiserror est un choix, pas un défaut.
- **`unwrap()`/`expect()` hors `#[cfg(test)]` = interdit dur** (méthode projet :
  fail fast, pas de fallback silencieux) — plus strict que le global (« documenter
  l'invariant et utiliser `expect` »). `Option<T>` seulement pour de l'optionnel
  réel, jamais comme échappatoire d'erreur.
- **Perf : pas de `criterion`.** L'unique benchmark (`bench_volume.rs`) est un
  `#[cfg(test)] mod` lancé via `cargo test --release -- --ignored --nocapture` —
  suivre ce pattern plutôt que d'introduire criterion. `profile.dev` met déjà les
  dépendances à `opt-level = 3` pour les hot paths DSP ; bencher en `--release`.
- **Tests : `#[cfg(test)] mod tests` inline par module.** Pas de `proptest`,
  `mockall`, ni `cargo-fuzz` dans l'arbre — ne pas les introduire pour une seule
  tâche sans le signaler (décision de dépendance, pas un ajout au passage).

## Ownership (précisions projet)

- Types owned au repos (`String`, `Vec<T>`, `PathBuf`) ; emprunt en paramètre.
- `.clone()` = signal à revoir, pas un pansement — SAUF quand il évite de tenir
  un `MutexGuard` à travers une frontière IPC ou une section critique longue :
  là, cloner est souvent le choix correct. Juger par ce qu'il évite.
- App desktop, pas un parser zero-copy : données owned = souvent le bon compromis
  quand un lifetime devient compliqué.
- `Arc<Mutex<T>>` est le pattern établi pour l'état partagé cross-thread (pool ↔
  connexion DB ↔ commandes Tauri) — le suivre, pas introduire une autre primitive.

## Fan-out d'agents sur du Rust (incident 2026-07-04/05, migré depuis l'ex-registre)

**Jamais deux agents `cargo`/`tauri dev` concurrents sur ce repo** — le cache
incrémental Rust ne supporte pas les builds concurrents (LNK2019 observé,
mémoire `avoid-concurrent-cargo-tauri-dev`). Toujours arrêter `tauri dev` avant
un fan-out qui touche `src-tauri/`. Cargo sérialise via son lock (deux agents
peuvent compiler l'un après l'autre sans casser), mais donner à chaque agent
Rust parallèle un périmètre de fichiers strictement disjoint reste nécessaire
(cf. gabarit `Exécuteur borné` de `~/.claude/rules/sizing-templates.md`).

## Avant de dire « fini » (commandes exactes du projet)

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

- Tout bloc `unsafe` neuf ou touché a un `// SAFETY:` expliquant l'invariant.
- Aucune dépendance `thiserror`/`anyhow`/`tokio`/`criterion`/`proptest`
  introduite en douce — ce sont des décisions projet, à remonter, pas à ajouter
  dans une tâche.
