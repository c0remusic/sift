# M8 Tier 3 — Écriture directe des tables normalisées (moteur Rust) Implementation Plan

**Goal:** Étendre `src-tauri/src/rekordbox_masterdb.rs` avec une fonction
`sync_track_metadata` qui écrit Artist/Genre/Label (find-or-create FK) et
Title/Year (colonnes directes) sur `djmdContent`, en réutilisant intégralement
la chaîne de sûreté des Tiers 1/2 (garde process → backup → transaction →
ré-encrypt → écriture atomique → vérification round-trip → rollback auto).
Design complet :
`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`
(section Tier 3, mise à jour n°8).

**Périmètre de ce plan** : moteur Rust seul, prouvé sur fixture puis sur une
copie de la vraie bibliothèque — même précédent que
`docs/superpowers/plans/2026-07-06-m8-tier1-write-path-rust.md`. IPC + UI +
hook de détection au filing sont un plan séparé, à écrire une fois le moteur
prouvé.

## Contraintes globales

- Jamais toucher `Analysed`/`AnalysisUpdated`/`CueUpdated` (invariant M8 non
  négociable).
- Refuser d'écrire si Rekordbox tourne (réutilise `is_rekordbox_running`
  existant).
- Backup horodaté avant toute écriture, round-trip vérifié après, rollback
  automatique sur échec — réutilise `backup_rekordbox_files`/
  `restore_rekordbox_backup` existants tels quels.
- `cargo test`/`cargo clippy` jamais en concurrence avec un `tauri dev` actif.
- Fixture régénérée via `scripts/make-rekordbox-fixture.py` étendu (nouvelles
  tables `djmdArtist`/`djmdGenre`/`djmdLabel`), jamais de vraie donnée
  personnelle dedans.

## Tasks

- [x] **Task 1 — Étendre la fixture avec `djmdArtist`/`djmdGenre`/`djmdLabel`**
  - `scripts/make-rekordbox-fixture.py` : ajouter les 3 tables (schéma exact
    vérifié 2026-07-09 : `ID, Name, UUID, rb_data_status,
    rb_local_data_status, rb_local_deleted, rb_local_synced, usn,
    rb_local_usn, created_at, updated_at` — `djmdArtist` a en plus
    `SearchStr`, laissé NULL).
  - Étendre `djmdContent` avec `ArtistID, GenreID, LabelID, ReleaseYear`
    (actuellement absentes du fixture).
  - Semer : track `40000001` avec `ArtistID` pointant vers un artiste
    existant nommé `"Existing Artist"` ; aucun artiste nommé
    `"New Artist"` (pour tester les deux branches find-or-create dans un
    seul run). Idem genre/label avec un existant + un absent.
  - Régénérer `src-tauri/tests/fixtures/rekordbox_master.db`, committer le
    script modifié + le fixture binaire.
  - Vérification : `python scripts/make-rekordbox-fixture.py` tourne sans
    erreur, fixture non vide.

- [x] **Task 2 — Types + génération d'ID**
  - `pub struct MetadataSync { pub track_id: String, pub artist: Option<String>, pub title: Option<String>, pub year: Option<i64>, pub genre: Option<String>, pub label: Option<String> }`
    (miroir des champs de `write_tags_full` — `None` = ne pas toucher, cohérent
    avec la convention "fields left None/empty are not touched" de
    `tagging.rs`).
  - Fonction privée `fn find_or_create_named_row(tx: &Transaction, table: &str, name: &str, now: &str) -> Result<i64, MasterDbError>` :
    paramétrée par nom de table (`djmdArtist`/`djmdGenre`/`djmdLabel` — même
    schéma) plutôt que 3 fonctions dupliquées.
    1. `SELECT ID FROM {table} WHERE Name = ?1` (match exact, casse incluse
       — voir Risque ouvert #1 du design).
    2. Si trouvé → retourner l'ID tel quel, ne rien écrire.
    3. Sinon → générer un ID aléatoire 32-bit (`rand`, déjà en deps depuis
       Tier 1), vérifier l'absence de collision (`SELECT 1 FROM {table}
       WHERE ID = ?1`, retry si collision — 32-bit donne un espace assez
       large pour qu'un retry unique suffise en pratique, mais boucler
       jusqu'à succès plutôt que supposer), insérer une nouvelle ligne
       (`UUID` via `uuid` crate v4 — **nouvelle dep, à ajouter**, `Name`,
       `rb_data_status=0`, `rb_local_data_status=0`, `rb_local_deleted=0`,
       `rb_local_synced=0`, `usn=NULL`, `rb_local_usn=<bump global>`,
       `created_at=now`, `updated_at=now`), bumper le compteur global
       `agentRegistry` (même requête que `repair_track_path`), retourner
       le nouvel ID.
  - ⚠️ Ne pas utiliser de concaténation de string pour `table` dans le SQL
    (le nom de table vient d'une constante interne à ce module, jamais
    d'une entrée utilisateur — mais whitelister quand même les 3 noms
    valides en tête de fonction, fail-fast sur tout autre nom, pour éviter
    qu'un futur appel accidentel n'ouvre une injection).
  - Vérification : `cargo build --manifest-path src-tauri/Cargo.toml`.

- [x] **Task 3 — `sync_track_metadata`**
  - Signature : `pub fn sync_track_metadata(pioneer_dir: &Path, backup_dir: &Path, sync: &MetadataSync) -> Result<(), MasterDbError>`.
  - Corps : garde Rekordbox → backup → decrypt → connexion in-memory →
    transaction :
    - Si `sync.artist.is_some()` → `find_or_create_named_row("djmdArtist", ...)`
      → `UPDATE djmdContent SET ArtistID = ?`.
    - Idem `genre`→`GenreID`, `label`→`LabelID`.
    - Si `sync.title.is_some()` → `UPDATE djmdContent SET Title = ?` direct.
    - Si `sync.year.is_some()` → `UPDATE djmdContent SET ReleaseYear = ?`
      direct.
    - Si au moins un champ a été fourni : `UPDATE djmdContent SET
      rb_local_usn = <bump>, updated_at = now, TrackInfoUpdated =
      TrackInfoUpdated + 1 WHERE ID = ?` (une seule requête, tous les champs
      touchés en un `UPDATE`, pas un par champ modifié).
    - Si `track_id` ne matche aucune ligne → `MasterDbError::TrackNotFound`
      (réutilise la variante existante), pas de commit.
  - Re-encrypt, écriture atomique (même pattern temp-file+rename que
    `repair_track_path`).
  - Vérification round-trip : relecture fraîche via `read_rekordbox_masterdb`
    + une requête ciblée sur les champs modifiés (Title/Year visibles dans
    `RekordboxTrack` seulement si ce struct les expose déjà — sinon requête
    directe post-reload sur une connexion fraîche, pas de nouvelle
    dépendance de lecture). Rollback auto sur échec (réutilise
    `restore_rekordbox_backup`).
  - Vérification : `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` clean.

- [x] **Task 4 — Tests sur fixture**
  - Cas 1 : artist déjà existant (`"Existing Artist"`) → `ArtistID` repointe
    vers la ligne existante, **aucune nouvelle ligne** `djmdArtist` créée
    (compte avant/après identique) — miroir direct du verdict spike 7.
  - Cas 2 : artist inédit (`"New Artist"`) → nouvelle ligne créée, `ArtistID`
    pointe dessus, compte +1 — miroir direct du verdict spike 6.
  - Cas 3 : title+year seuls (aucun champ FK) → écriture directe, aucune
    table FK touchée, aucun bump USN autre que celui de `djmdContent`.
  - Cas 4 : les 5 champs en même temps → vérifier le nombre exact de bumps
    USN globaux (jusqu'à 4, voir design).
  - Cas 5 : `Analysed`/`AnalysisUpdated`/`CueUpdated` inchangés après
    synchro (assertion explicite, invariant non négociable).
  - Cas 6 : Rekordbox détecté comme tournant → `Err(RekordboxRunning)`,
    aucune écriture (mock/simulation cohérente avec le test existant de
    Tier 1, si un tel mock existe déjà — sinon test manuel documenté comme
    non automatisable, même limite que les tests Tier 1/2 existants).
  - Vérification : `cargo test --manifest-path src-tauri/Cargo.toml
    rekordbox_masterdb` tout vert.

- [x] **Task 5 — Test contre une copie de la vraie bibliothèque**
  - Test d'intégration `#[ignore]`d (même convention que
    `repair_track_path_round_trips_on_real_masterdb_copy`, activé via une
    var d'env dédiée type `SIFT_M8_REAL_COPY_DIR`) : synchronise un artiste
    déjà connu (reuse) ET un artiste inédit (create) sur une copie réelle,
    vérifie round-trip, restaure.
  - Objectif explicite : reproduire la classe de bug trouvée au Tier 1 (WAL
    header invisible sur fixture synthétique) — un fixture "shape correcte"
    peut encore diverger de la vraie donnée sur des détails hors schéma
    applicatif.
  - Vérification : lancer manuellement avec
    `SIFT_M8_REAL_COPY_DIR=~/Desktop/sift-masterdb-write-probe/spike7-reuse-vs-duplicate`
    (ou une copie fraîche dédiée), Rekordbox fermé, `CARGO_TARGET_DIR` isolé
    si un autre `tauri dev` tourne en parallèle.

- [x] **Task 6 — Revue finale**
  - Relire l'ensemble contre le design v2 (section Tier 3) : périmètre
    respecté (5 champs seulement, cover/Album hors scope), invariants de
    sûreté tenus, pas de nouvelle divergence introduite dans les tiers
    existants.
  - `cargo test` + `cargo clippy --all-targets -- -D warnings` + `npx tsc
    --noEmit` (aucun changement front dans ce plan, vérif de non-régression
    seulement) tout vert.

## Hors scope (plan séparé à venir)

- Câblage IPC (nouvelle commande ou extension de
  `rekordbox_masterdb_repairs`).
- Hook de détection au moment du filing (`filing.rs`) — quand déclencher une
  synchro candidate.
- Écran UI (section dédiée sur la page Rekordbox, même convention que
  Tier 1/2).
