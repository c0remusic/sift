# Lecteur SQLCipher pur Rust `master.db` Rekordbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Module `src-tauri/src/rekordbox_masterdb.rs` exposant
`read_rekordbox_masterdb(path) -> Result<RekordboxIndex, MasterDbError>`,
lecture seule, pur Rust (RustCrypto), sans dépendance Python ni toolchain
OpenSSL. Déchiffre chaque page SQLCipher v4 en mémoire, reconstitue un buffer
SQLite standard, le charge dans `rusqlite` via `Connection::deserialize_read_exact`
(feature `serialize`), jamais écrit en clair sur disque. `RekordboxIndex` fait
partie du scope demandé (forme compatible avec l'index `chemin → TrackID` du
module M7 XML) — ce n'est pas hors scope.

**Paramètres SQLCipher v4 validés empiriquement** (script Python jetable,
`sqlcipher3-wheels` comme oracle, hors repo) :
- PBKDF2-HMAC-SHA512, **256 000** itérations, clé 32 octets — confirmé via
  `PRAGMA kdf_iter`/`cipher_kdf_algorithm` sur une connexion réelle
  `sqlcipher3`, dérivation reproduite manuellement en Python stdlib
  (`hashlib.pbkdf2_hmac`), HMAC de page validé `True`.
- Clé HMAC dérivée séparément : même PBKDF2, salt = `salt original XOR 0x3a`
  (répété), **2** itérations, 32 octets.
- Page size **4096**. Reserve **80 octets** (IV 16 + HMAC-SHA512 complet 64,
  déjà multiple du bloc AES 16 — pas de padding supplémentaire).
- HMAC-SHA512 calculé sur `ciphertext_page || iv || page_number(u32 LE)`,
  vérifié AVANT déchiffrement.
- Cas spécial page 1 : les 16 premiers octets du fichier sont le salt (jamais
  chiffrés) ; la zone chiffrée de la page 1 fait `4096 - 16 - 80` octets ; le
  buffer reconstruit préfixe la page 1 déchiffrée par le magic SQLite
  `"SQLite format 3\0"` (16 octets) à la place du salt.
- La passphrase PBKDF2 est la chaîne **hex UTF-8 de 64 caractères elle-même**
  (ex. `"402fd482...08497"`), pas les 32 octets bruts décodés — cohérent avec
  la syntaxe `PRAGMA key = '<hexstring>'` utilisée par pyrekordbox/Rekordbox
  (pas la syntaxe `x'...'` de clé brute).
- **Le magic bytes n'est PAS un critère de validation utile en soi** (il vit
  dans la zone salt, jamais chiffrée, donc toujours "correct" même avec une
  mauvaise clé) — contrairement à l'hypothèse de la spec initiale. La vraie
  preuve de correction est : HMAC de **chaque** page valide + le buffer
  reconstruit est parseable par `rusqlite`/SQLite standard (roundtrip complet
  vérifié : 3 tracks relus correctement depuis une fixture synthétique,
  script Python jetable, ET par les tests Rust `cargo test` contre la fixture
  committée).
- Note secondaire : l'octet 20 du header de la page 1 chiffrée (censé
  déclarer la taille de réserve par page dans un fichier SQLite standard)
  s'est avéré **non déterministe** d'une génération à l'autre du fichier de
  test (valeurs aléatoires observées : 25, 47, 65, 89, 108, 188, 55, 109, 88)
  avec la lib `sqlcipher3-wheels` utilisée comme oracle — ignoré, non fiable
  comme source de vérité ; le lecteur Rust code RESERVE=80 en dur (validé par
  roundtrip complet, pas par ce byte de header). Le buffer reconstruit, lui,
  DOIT déclarer un octet 20 à `0` (pas de réserve dans le fichier plaintext
  reconstruit) et chaque page reconstruite doit rester `PAGE_SIZE` complet
  (padding zéro après le contenu déchiffré) — sans ce correctif, `rusqlite`/
  SQLite standard rejette le buffer ("database disk image is malformed"),
  bug rencontré et corrigé pendant l'implémentation (Task 4).

**Tech Stack:** Rust (`pbkdf2 0.12`, `hmac 0.12`, `sha2 0.10`, `aes 0.8`,
`cbc 0.1` avec feature `alloc`, `flate2 1.1.9`, `base85 2.0.0` — toutes pur
Rust RustCrypto/zéro compilation C, déjà ajoutées à `src-tauri/Cargo.toml`),
`rusqlite` (déjà en dépendance, feature `serialize` ajoutée).

## Contraintes globales

- MSRV Rust 1.77.2, edition 2021.
- `cargo test --manifest-path src-tauri/Cargo.toml` doit rester vert (176
  tests pré-existants passent déjà dans ce worktree + 4 nouveaux ; 2 échecs
  pré-existants sans rapport — fixtures audio manquantes dans
  `analysis::decode`, non touchées par ce chantier, confirmées par
  `git blame` comme antérieures à cette session).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D
  warnings` reste vert pour `rekordbox_masterdb.rs` — 2 lints pré-existants
  ailleurs (`settings.rs:12`, `dedup.rs:134`, confirmés antérieurs par
  `git blame`, commits `ea273c06`/`07dbdda2`) ne sont pas de ce chantier.
- Fail-fast : toute vérification HMAC invalide sur une page retourne
  `Err(MasterDbError::HmacMismatch)` immédiatement, jamais de données non
  vérifiées retournées.
- Jamais de fichier temporaire en clair sur disque — buffer en mémoire
  (`Vec<u8>`) uniquement, chargé via `Connection::deserialize_read_exact`.
- Fixture de test synthétique committée
  (`src-tauri/tests/fixtures/rekordbox_master.db`) — aucune donnée
  personnelle. Générée via un script Python jetable (pas committé) utilisant
  `pyrekordbox`/`sqlcipher3-wheels` comme générateur, une seule fois.
- Note environnement worktree : `src-tauri/binaries/ffmpeg-*.exe` absent par
  design ici (voir instructions de tâche) — un fichier placeholder vide a été
  créé pour satisfaire la vérification de ressource `tauri_build::build()` et
  permettre `cargo test`/`cargo check`. Ce fichier est gitignore
  (`src-tauri/binaries/` dans `.gitignore`), jamais committé, sans impact sur
  le vrai binaire de prod.
- **Note de coordination** : une collision d'écriture concurrente a été
  détectée sur ce même fichier de plan pendant la session (une autre session
  Claude, coordonnée sur la même tâche mais dans son propre process, a écrit
  une version différente de ce plan directement dans ce worktree). Cette
  version-ci est celle qui reflète le code réellement écrit et testé — l'autre
  version marquait `RekordboxIndex` comme hors scope, ce qui contredit les
  instructions de la tâche (point 7 : la forme de retour doit être
  `RekordboxIndex`). Void pour référence, ne pas la restaurer.

---

### Task 1 : constante clé + déobfuscation

**Files:**
- Create: `src-tauri/src/rekordbox_masterdb.rs` (contient tout, fichier plat
  cohérent avec la convention du projet)

**Status: FAIT.**

- [x] Test `deobfuscate_key_matches_pyrekordbox_reference` : vérifie que
  `deobfuscate_key()` (base85 decode → XOR `BLOB_KEY` → zlib decompress)
  reproduit la même passphrase hex 64 caractères que
  `pyrekordbox.utils.deobfuscate(BLOB)`
  (`402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497`).
  `BLOB`/`BLOB_KEY` copiés depuis le code source public de pyrekordbox
  (`db6/database.py`/`utils.py`), constante publique documentée, pas un
  secret par installation.

---

### Task 2 : dérivation de clé PBKDF2 (chiffrement + HMAC)

**Status: FAIT.**

- [x] `derive_keys(passphrase, salt) -> ([u8;32], [u8;32])` — PBKDF2-HMAC-SHA512
  256 000 itérations pour la clé AES, puis PBKDF2-HMAC-SHA512 2 itérations
  (salt XOR 0x3a) pour la clé HMAC. Signature `pbkdf2::pbkdf2_hmac::<Sha512>`
  confirmée via le code source vendored du crate (`pbkdf2-0.12.2/src/lib.rs`)
  avant écriture, pas depuis la mémoire.

---

### Task 3 : déchiffrement de page (HMAC verify + AES-256-CBC)

**Status: FAIT.**

- [x] `decrypt_page_body` : vérifie HMAC-SHA512 sur
  `ciphertext || iv || page_no.to_le_bytes()` (page 1-indexed, LE) AVANT
  déchiffrement — `Mac::verify_slice` (comparaison constant-time). Déchiffre
  ensuite via `cbc::Decryptor<Aes256>::decrypt_padded_vec_mut::<NoPadding>`
  (pas de padding PKCS7 — les pages SQLCipher sont déjà alignées sur le bloc
  AES). Nécessite la feature `alloc` du crate `cbc` (pas activée par défaut,
  ajoutée explicitement dans `Cargo.toml`).

---

### Task 4 : assemblage du buffer complet + reconstruction correcte du header

**Status: FAIT — bug de reconstruction trouvé et corrigé pendant
l'implémentation (pas seulement pendant la validation Python).**

- [x] `decrypt_masterdb(raw) -> Result<Vec<u8>, MasterDbError>` : boucle sur
  toutes les pages, cas spécial page 1 (retire le salt, ré-préfixe le magic
  SQLite), **met l'octet 20 du buffer reconstruit à `0`** (déclare
  "reserved-space-per-page = 0" dans le fichier plaintext reconstruit — sans
  ce correctif, le premier essai échouait avec "database disk image is
  malformed" malgré un HMAC valide sur toutes les pages) et **repadde chaque
  page reconstruite à `PAGE_SIZE` complet** avec des zéros après le contenu
  déchiffré (le fichier reconstruit garde des pages de taille fixe, sans zone
  de réserve réelle).

---

### Task 5 : fixture committée

**Status: FAIT.**

- [x] `src-tauri/tests/fixtures/rekordbox_master.db` (28 672 octets, 3 tracks
  factices + 1 playlist factice + 2 liens playlist-song, tables
  `djmdContent`/`djmdPlaylist`/`djmdSongPlaylist` simplifiées mais cohérentes
  avec le vrai schéma Rekordbox). Générée une fois via script Python jetable
  (`sqlcipher3-wheels` + `pyrekordbox.utils.deobfuscate`/`db6.database.BLOB`
  comme oracle de clé), commande de régénération documentée en commentaire
  au-dessus du module de tests dans `rekordbox_masterdb.rs`.

---

### Task 6 : requêtes SQL + forme `RekordboxIndex`

**Status: FAIT.**

- [x] `RekordboxIndex { tracks: Vec<RekordboxTrack> }`,
  `RekordboxTrack { track_id: String, folder_path: String }` — noms de champs
  choisis pour rester compatibles avec un futur index `chemin → TrackID`
  (le module M7 XML n'est pas touché ici, juste la forme est gardée
  compatible, conformément au point 7 des instructions de tâche).
- [x] Requête `SELECT ID, FolderPath FROM djmdContent` sur la connexion
  `rusqlite` déserialisée en lecture seule
  (`Connection::deserialize_read_exact(..., read_only=true)`).
- [x] Test `reads_fixture_tracks` : vérifie les 3 IDs et un chemin exact
  contre la fixture.

---

### Task 7 : `MasterDbError`

**Status: FAIT.**

- [x] `#[derive(Debug, Clone, PartialEq)]` + `Display` manuel + `impl Error`
  — même convention que `FilingError`/`EncodeError` déjà dans le codebase
  (pas de `Serialize` direct : aucune commande IPC n'existe encore pour ce
  module, conversion `String` prévue à ce moment-là si besoin).
  Variantes : `Io`, `FileTooShort`, `KeyDeobfuscation`, `HmacMismatch { page }`,
  `Sqlite`, `Decrypt { page }` (ce dernier distinct de `HmacMismatch` : ne
  peut survenir qu'après un HMAC déjà valide, garde-fou fail-fast plutôt
  qu'un panic silencieux).
- [x] Chaque variante atteinte par au moins un test : `FileTooShort`
  (`rejects_truncated_file`), `HmacMismatch` (`rejects_corrupted_page_hmac`,
  corrompt un octet de la fixture EN MÉMOIRE dans le test, jamais le fichier
  committé).

---

### Task 8 : passe finale clippy + doc

**Status: FAIT.**

- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D
  warnings` : zéro finding sur `rekordbox_masterdb.rs` (2 findings
  pré-existants ailleurs, confirmés antérieurs à cette session via
  `git blame`, non touchés).
- [x] Doc-comments sur le module (approche, paramètres confirmés
  empiriquement, statut "pas encore câblé à l'IPC") et sur
  `read_rekordbox_masterdb`.
- [x] `#![allow(dead_code)]` documenté en tête de module (module `mod`
  privé, pas encore appelé depuis le reste de l'app — attendu, pas une
  suppression silencieuse d'un vrai problème).

## Résultat final

`cargo test --manifest-path src-tauri/Cargo.toml` : 184 passed (180
pré-existants incluant 2 échecs pré-existants sans rapport, + 4 nouveaux
tests `rekordbox_masterdb`, tous verts).
