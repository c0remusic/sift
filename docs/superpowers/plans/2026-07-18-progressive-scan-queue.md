# File progressive pendant le scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire apparaître les morceaux dans la File « à traiter » au fil du scan d'un dossier, au lieu d'un saut de 0 à N une fois le scan entier terminé.

**Architecture:** `scanner::scan_dir()` marche actuellement tout l'arbre du dossier et le collecte en `Vec<DiskFile>` (`.collect()`) avant qu'aucune ligne ne soit insérée en base ; `ipc.rs::spawn_scan()` n'émet ensuite qu'un seul événement `queue:changed` à la toute fin. On extrait la marche `WalkDir` en un itérateur paresseux partagé, on fait consommer cet itérateur directement à `reconcile()` (upsert au fil de l'eau, plus de collecte intermédiaire), et on ajoute un callback de progression appelé tous les `PROGRESS_BATCH` fichiers net-changés pour que `spawn_scan()` puisse ré-émettre `queue:changed` pendant le scan, pas seulement à la fin.

**Tech Stack:** Rust (`sift_lib`), `walkdir`, `rusqlite`, Tauri v2 `AppHandle::emit`.

## Global Constraints

- `unwrap()`/`expect()` hors `#[cfg(test)]` interdit (fail-fast, pas de fallback silencieux) — `.claude/rules/rust.md`.
- Tests `#[cfg(test)] mod tests` inline dans le même fichier, pas de fichier séparé — convention du repo (`scanner.rs` a déjà ce pattern).
- Pas de nouvelle dépendance (`walkdir` est déjà utilisé).
- `cargo fmt`/`clippy -D warnings`/`cargo test` doivent rester verts après chaque tâche (`.claude/rules/rust.md` § Avant de dire « fini »).
- Nommer la fréquence supposée d'un événement répété avant de l'émettre en boucle (`CLAUDE.md` § Front — événements répétés) : ici, un `queue:changed` tous les 25 fichiers net-changés, sur un thread de scan séparé — le front debounce déjà sa redraw à 150ms (`sift-live.ts:462-468`), donc aucun changement frontend n'est nécessaire.
- Verification UI : app réelle (`tauri dev`), jamais la maquette navigateur — `CLAUDE.md` § Vérification UI.

## Note d'exécution (2026-07-18)

Task 1 (commit `f25a999`) et Task 2 (commit `d85ca8c`) sont livrées et review-approuvées. Task 2 a supprimé `pub fn scan_dir` (plus aucun appelant après le refactor, `clippy -D warnings` la rejetait en dead-code, `#[allow]` interdit sans accord) — écart au texte original de Task 1 ci-dessous ("`scan_dir` signature publique inchangée"), accepté explicitement par Antoine après revue. `walk_audio_files` (privée) est désormais le seul point d'entrée du walk.

---

### Task 1: Extraire la marche `WalkDir` en itérateur paresseux partagé

Refactor à comportement identique (characterization) : `scan_dir()` doit continuer à renvoyer exactement les mêmes résultats. Ce découplage permet à la Task 2 de consommer les fichiers un par un, sans attendre la fin de la marche complète.

**Files:**
- Modify: `src-tauri/src/scanner.rs:44-64`
- Test: `src-tauri/src/scanner.rs` (module `tests` existant, ligne ~173)

**Interfaces:**
- Produces: `fn walk_audio_files(root: &Path) -> impl Iterator<Item = DiskFile>` — itérateur paresseux, consommé par `scan_dir()` (Task 1) et `reconcile_with_progress()` (Task 2).
- `scan_dir(root: &Path) -> Vec<DiskFile>` — signature publique inchangée.

**STATUT : livré, commit `f25a999`, review approuvée.**

---

### Task 2: `reconcile_with_progress` — upsert au fil de l'eau + callback de progression

`reconcile()` collectait `scan_dir(root)` (donc marchait tout l'arbre) avant de commencer à diffuser en base. On le fait maintenant consommer `walk_audio_files` directement, upsert fichier par fichier, et appeler un callback tous les `PROGRESS_BATCH` fichiers net-changés (ajoutés + mis à jour).

**Files:**
- Modify: `src-tauri/src/scanner.rs:119-171` (fonction `reconcile`)
- Test: `src-tauri/src/scanner.rs` (module `tests`)

**Interfaces:**
- Consumes: `walk_audio_files(root: &Path) -> impl Iterator<Item = DiskFile>` (Task 1), `upsert_file(conn, source_id, f) -> rusqlite::Result<bool>` (existant, `scanner.rs:69`), `forget_path(conn, path) -> rusqlite::Result<usize>` (existant, `scanner.rs:112`).
- Produces: `fn reconcile_with_progress(conn: &Connection, source_id: i64, root: &Path, on_batch: impl FnMut(usize)) -> rusqlite::Result<ReconcileStats>` — consommé par `ipc.rs::spawn_scan` (Task 3). `on_batch` reçoit le nombre cumulé de fichiers ajoutés+mis à jour au moment de l'appel.
- `reconcile(conn, source_id, root) -> rusqlite::Result<ReconcileStats>` — signature publique inchangée, devient un appel à `reconcile_with_progress(conn, source_id, root, |_| {})`.

**STATUT : livré, commit `d85ca8c`, review approuvée avec écart signalé (suppression de `scan_dir`, accepté).**

---

### Task 3: Câbler `spawn_scan` pour ré-émettre `queue:changed` pendant le scan

Le frontend écoute déjà `queue:changed` et debounce sa redraw à 150ms (`sift-live.ts:462-468`) — aucun changement frontend requis. On remplace juste l'appel à `reconcile` par `reconcile_with_progress`, avec un callback qui ré-émet l'événement existant.

**Files:**
- Modify: `src-tauri/src/ipc.rs:368-406` (fonction `spawn_scan`)

**Interfaces:**
- Consumes: `scanner::reconcile_with_progress(conn, source_id, root, on_batch)` (Task 2).
- Ne change aucun contrat IPC/TS existant : même événement `queue:changed`, même payload (aucun), déjà mirroré dans `frontend/ipc.ts:67-69`.

- [x] **Step 1: Remplacer l'appel à `reconcile` par `reconcile_with_progress`**

Dans `src-tauri/src/ipc.rs`, fonction `spawn_scan` (lignes 368-406), remplacer :

```rust
        match scanner::reconcile(&conn, source_id, std::path::Path::new(&path)) {
            Ok(stats) => log::info!("scan source {source_id}: {stats:?}"),
            Err(e) => log::error!("scan source {source_id} failed: {e}"),
        }
        crate::watcher::start(&app, source_id, &path);
        app.emit("queue:changed", ()).ok();
        crate::worker::refill(&app);
```

par :

```rust
        // Ré-émet queue:changed tous les PROGRESS_BATCH fichiers net-changés (scanner.rs) pendant
        // le scan, en plus de l'émission finale ci-dessous — le front debounce déjà sa redraw
        // à 150ms (sift-live.ts) donc aucune saturation IPC/UI même sur une grosse bibliothèque.
        match scanner::reconcile_with_progress(
            &conn,
            source_id,
            std::path::Path::new(&path),
            |_done| {
                app.emit("queue:changed", ()).ok();
            },
        ) {
            Ok(stats) => log::info!("scan source {source_id}: {stats:?}"),
            Err(e) => log::error!("scan source {source_id} failed: {e}"),
        }
        crate::watcher::start(&app, source_id, &path);
        app.emit("queue:changed", ()).ok();
        crate::worker::refill(&app);
```

- [x] **Step 2: cargo check pour valider la compilation (emprunt de `app` dans la closure)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compile sans erreur — `app: AppHandle` est capturé par référence dans la closure `|_done| { app.emit(...) }` (méthode `.emit` prend `&self`), puis réutilisé après (`watcher::start(&app, ...)`, `app.emit(...)`, `worker::refill(&app)`) : aucun déplacement, donc aucun conflit d'emprunt.

- [x] **Step 3: cargo fmt + clippy + suite complète**

Run:
```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: aucun warning, tous les tests passent

- [x] **Step 3bis (écart de scope autorisé en cours de tâche, même motif que la suppression de `scan_dir` en Task 2) : suppression de `pub fn reconcile()` dans `scanner.rs`**

Une fois `spawn_scan` réécrit pour appeler `reconcile_with_progress` directement, le thin wrapper `reconcile()` n'avait plus d'appelant en dehors des tests → dead code sous `clippy -D warnings` (`#[allow]` interdit sans accord). Supprimé ; les 6 tests de `scanner.rs` redirigés vers `reconcile_with_progress(&conn, sid, root, |_| {})`. Accepté par Antoine (même raisonnement que `scan_dir`).

- [x] **Step 3ter : correction du commentaire périmé `frontend/sift-live.ts:462-463`** (finding remonté par la revue Codex du repo) — décrivait `queue:changed` comme émis "once per burst source", devenu inexact une fois l'émission périodique ajoutée. Reformulé pour refléter les deux déclencheurs (burst source ET tous les 25 fichiers net-changés pendant un scan).

- [ ] **Step 4: Vérification manuelle app réelle (Tauri n'est pas unit-testable pour l'émission d'événements) — RESTE À FAIRE PAR ANTOINE**

Pas de test automatisé possible ici : `AppHandle::emit` nécessite un contexte Tauri vivant, absent des tests `#[cfg(test)]` de `ipc.rs` (fichier sans tests aujourd'hui, cohérent avec le reste du repo — la vérification IPC réelle passe par l'app, cf. `CLAUDE.md` § Vérification UI).

Run: `npm run tauri dev`

Dans la fenêtre qui s'ouvre :
1. Aller sur Accueil.
2. Importer un dossier contenant plusieurs centaines de fichiers audio (ou plus, si disponible).
3. Observer que le compteur de la source / la File se met à jour progressivement pendant le scan, au lieu de sauter d'un coup à la toute fin.

Expected: mise à jour visible par paliers pendant le scan, pas un saut unique en fin de scan.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/src/scanner.rs frontend/sift-live.ts
git commit -m "feat(ipc): emit queue:changed progressively during a folder scan"
```

**STATUT : livré, commit `8afff73`, revue de tâche approuvée + revue finale de branche approuvée (« Ready to merge: With fixes », le seul point restant étant la vérification manuelle Step 4 ci-dessus, jamais un défaut de code).**

---

## Self-Review

**Couverture** : le gap identifié (scan_dir collecte tout en Vec avant le 1er insert ; spawn_scan n'émet qu'un seul queue:changed final) est couvert par les 3 tâches — Task 1 rend la marche paresseuse, Task 2 fait consommer cette marche au fil de l'eau avec callback de progression, Task 3 câble ce callback à l'émission Tauri déjà existante. Aucun changement frontend de comportement requis (déjà debounce-ready, vérifié `sift-live.ts:462-468`) — seul le commentaire décrivant l'événement a dû être corrigé (Step 3ter).

**Placeholders** : aucun — chaque step contient le code exact à écrire/remplacer, les commandes exactes, et les résultats attendus. Task 3 Step 4 est une vérification manuelle explicitement justifiée (Tauri `AppHandle::emit` non testable en `#[cfg(test)]`), pas un "TODO tester" vague — reste à faire par Antoine, pas par un agent.

**Cohérence des types** : `reconcile_with_progress(conn: &Connection, source_id: i64, root: &Path, on_batch: impl FnMut(usize)) -> rusqlite::Result<ReconcileStats>` — signature identique entre sa définition (Task 2) et son usage (Task 3, closure `|_done| {...}` compatible avec `FnMut(usize)`). **Correction post-exécution** : `reconcile()` n'a PAS gardé sa signature publique — elle a été supprimée en Task 3 (Step 3bis), les 6 tests de `scanner.rs` redirigés vers `reconcile_with_progress`. Écart au texte original de ce paragraphe, accepté par cohérence avec la suppression de `scan_dir` en Task 2 (même cause : dead code sous `clippy -D warnings`, `#[allow]` interdit sans accord).
