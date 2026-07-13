# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger les six constats de la revue du checkout `main@397c70d` sans modifier le comportement fonctionnel nominal.

**Architecture:** Les écritures SQLite liées entre elles deviennent transactionnelles et les effets fichiers sont compensés lorsqu'une transaction échoue. La purge ne masque plus les erreurs de suppression. Les migrations deviennent atomiques. La CI génère ses fixtures et exécute les tests. Le protocole asset Tauri part d'un scope vide et autorise uniquement les fichiers réellement exposés à l'interface.

**Tech Stack:** Rust 2021, rusqlite 0.32, Tauri 2.11, TypeScript/Vite, GitHub Actions.

## Global Constraints

- Conserver les signatures IPC frontend existantes.
- Ne jamais écraser un fichier pendant une compensation.
- Ajouter un test de régression observé en échec avant chaque correction Rust.
- Ne pas ajouter de dépendance.

---

### Task 1: Atomicité du rangement et de la corbeille

**Files:**
- Modify: `src-tauri/src/filing.rs`

**Interfaces:**
- Consumes: `actions::record`, `save_metadata`, `rollback_fs`.
- Produces: `commit_file`, `reject_track` et `trash_track` atomiques côté SQLite, avec compensation filesystem.

- [ ] Ajouter un test où un trigger SQLite fait échouer `save_metadata`; vérifier l'absence d'action, le statut `pending` et le retour du fichier à sa source.
- [ ] Exécuter ce test et constater l'échec sur l'état partiellement persisté.
- [ ] Encapsuler les écritures de `commit_file` dans `unchecked_transaction`, puis compenser le filesystem si la transaction échoue.
- [ ] Ajouter puis observer en échec un test où le changement de statut `trash` est refusé.
- [ ] Rendre `trash_track` transactionnel et restaurer le fichier si la transaction échoue; rendre `reject_track` transactionnel.
- [ ] Réexécuter les tests ciblés.

### Task 2: Purge fiable

**Files:**
- Modify: `src-tauri/src/ecartes.rs`

**Interfaces:**
- Consumes: journal `actions` et lignes `tracks` existantes.
- Produces: `purge_trash` qui ne marque jamais purgé un fichier dont la suppression a échoué.

- [ ] Ajouter un test avec un chemin pointant vers un répertoire, que `remove_file` refuse.
- [ ] Exécuter le test et constater que l'état est actuellement marqué `purged`.
- [ ] Propager les erreurs autres que `NotFound` et grouper les deux mises à jour SQLite de chaque ligne dans une transaction.
- [ ] Réexécuter les tests ciblés.

### Task 3: Migrations atomiques

**Files:**
- Modify: `src-tauri/src/db.rs`

**Interfaces:**
- Produces: `apply_migration(conn, sql, version)` atomique, utilisée par `run_migrations`.

- [ ] Ajouter un test de migration contenant une création de table suivie d'un SQL invalide.
- [ ] Exécuter le test et constater l'absence du helper attendu.
- [ ] Implémenter le helper avec transaction, mise à jour de `user_version` et commit unique.
- [ ] Vérifier que la table partielle et la version restent absentes après échec.

### Task 4: Tests audio exécutés en CI

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `src-tauri/tests/characterization.rs`
- Modify: `src-tauri/src/encode.rs`
- Modify: `src-tauri/src/dedup.rs`
- Modify: `src-tauri/src/fingerprint.rs`
- Modify: `src-tauri/src/tagging.rs`
- Modify: `src-tauri/src/filing.rs`

**Interfaces:**
- Consumes: `npm run fetch-ffmpeg`, `node scripts/make-fixtures.mjs`.
- Produces: CI qui génère les fixtures et exécute `cargo test`; tests obligatoires qui échouent si une fixture générée manque.

- [ ] Ajouter les étapes génération puis test à la CI.
- [ ] Remplacer les retours silencieux des fixtures générées par des échecs explicites; conserver l'anchor utilisateur optionnelle.
- [ ] Générer localement le sidecar et les fixtures, puis exécuter les tests.

### Task 5: Scope asset Tauri minimal

**Files:**
- Create: `scripts/check-tauri-security.mjs`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/ipc.rs`

**Interfaces:**
- Consumes: `Manager::asset_protocol_scope().allow_file` de Tauri 2.11.2.
- Produces: scope statique vide, CSP sans exécution inline/eval, autorisation dynamique des seuls fichiers audio servis.

- [ ] Ajouter un contrôle Node qui refuse le wildcard asset et les directives script dangereuses.
- [ ] Exécuter le contrôle et constater son échec.
- [ ] Vider le scope statique, durcir `script-src` et autoriser dynamiquement les fichiers validés par les commandes IPC.
- [ ] Exécuter le contrôle et les builds frontend/Rust.

### Task 6: Vérification finale

**Files:**
- Modify only if a verification exposes a defect caused by these changes.

- [ ] Exécuter `cargo fmt` puis `cargo fmt --check`.
- [ ] Exécuter `npx tsc --noEmit` et `npm run build`.
- [ ] Exécuter `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Exécuter `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- [ ] Relire `git diff --check` et le diff complet.
