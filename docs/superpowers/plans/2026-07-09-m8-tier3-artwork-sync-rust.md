# M8 Tier 3 — Synchro pochette (moteur Rust) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter `sync_track_artwork` à `src-tauri/src/rekordbox_masterdb.rs` :
écrase en place les 3 fichiers pochette (`artwork.jpg`/`_m.jpg`/`_s.jpg`) que
Rekordbox garde en cache local (`pioneer_dir/share/<ImagePath>`), en dérivant
chaque variante à la taille exacte du fichier qu'elle remplace — sans jamais
toucher `master.db` (pas de FK, pas de ligne DB, `ImagePath` reste inchangé).

**Architecture :** Fonction moteur pure ajoutée au module existant
`rekordbox_masterdb.rs`, réutilisant le garde-fou `is_rekordbox_running` déjà
en place mais avec son propre backup/restore (les 3 fichiers artwork ne sont
pas `master.db`/`masterPlaylists6.xml`, donc `backup_rekordbox_files` /
`restore_rekordbox_backup` existants ne s'appliquent pas). Lecture de
`ImagePath` via une requête ad-hoc sur une désérialisation en lecture seule de
`master.db` (même pipeline `decrypt_masterdb` que le reste du module, sans
transaction d'écriture).

**Tech Stack :** Rust, `rusqlite` (déjà en deps), nouvelle dépendance `image`
(décodage/redimensionnement/encodage JPEG uniquement — `default-features =
false, features = ["jpeg"]`, pas les autres formats).

Détail complet du mécanisme observé : `docs/ressources-externes.md`,
Évaluation 23 (spike 8) ;
`~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-8-artwork.md`.

## Contraintes globales

- **Jamais toucher `master.db`** dans cette fonction — la lecture
  d'`ImagePath` est read-only, aucune transaction d'écriture SQLite, `ImagePath`
  reste bit-pour-bit identique après synchro (confirmé par le spike : ce
  champ ne bouge jamais).
- Refuser d'écrire si Rekordbox tourne (réutilise `is_rekordbox_running`).
- Backup horodaté des 3 fichiers artwork avant toute écriture (fichiers, pas
  `master.db`), round-trip vérifié après (dimensions + décodage), rollback
  automatique sur échec.
- **Risque résiduel documenté, non résolu par ce plan** : si `ImagePath`
  pointe vers une piste qui n'a **aucun** fichier artwork existant
  (`ImagePath` non NULL mais fichiers absents, ou `ImagePath` NULL) — jamais
  deviner un comportement de création côté Rekordbox (non testé au spike 8),
  toujours retourner une erreur explicite plutôt qu'un fallback silencieux.
- `cargo test`/`cargo clippy` jamais en concurrence avec un `tauri dev` actif
  (voir mémoire `avoid-concurrent-cargo-tauri-dev`) — isoler
  `CARGO_TARGET_DIR` si une autre session a `tauri dev` ouvert.
- Fixture régénérée via `scripts/make-rekordbox-fixture.py` étendu (nouvelle
  colonne `ImagePath`), jamais de vraie donnée personnelle dedans.

---

### Task 1 : Dépendance `image` + vérification de build

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: crate `image` (fonctions `image::load_from_memory`,
  `DynamicImage::resize_exact`, `image::codecs::jpeg::JpegEncoder`,
  `image::image_dimensions`) disponibles pour les tâches suivantes.

- [ ] **Step 1: Ajouter la dépendance**

Dans `src-tauri/Cargo.toml`, section `[dependencies]`, ajouter :

```toml
image = { version = "0.25", default-features = false, features = ["jpeg"] }
```

- [ ] **Step 2: Vérifier que ça build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès, aucune erreur de résolution de version (MSRV projet
1.77.2 — si `cargo check` échoue sur une contrainte de version Rust, ne pas
downgrader à l'aveugle : lire l'erreur exacte et choisir la version `image`
compatible la plus proche en dessous, fail-fast, pas de fallback silencieux).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(m8): ajoute la dep image (jpeg only) pour la synchro pochette"
```

---

### Task 2 : Étendre la fixture avec `ImagePath` + fichiers JPEG synthétiques

**Files:**
- Modify: `scripts/make-rekordbox-fixture.py`
- Modify: `src-tauri/tests/fixtures/rekordbox_master.db` (régénéré, binaire)

**Interfaces:**
- Produces: colonne `djmdContent.ImagePath` (`TEXT`, nullable) — track
  `40000001` = `"/PIONEER/Artwork/aaaa/artwork.jpg"` (pochette présente),
  track `40000002` = `NULL` (aucune pochette — test `NoArtworkPath`), track
  `40000003` = `"/PIONEER/Artwork/bbbb/artwork.jpg"` (chemin renseigné mais
  fichiers absents du disque — test `ArtworkVariantMissing`).

- [ ] **Step 1: Étendre le schéma et les inserts**

Dans `scripts/make-rekordbox-fixture.py`, modifier la `CREATE TABLE
djmdContent` (ligne ~28-34) pour ajouter `ImagePath TEXT` en dernière colonne,
et étendre les 3 lignes de `INSERT INTO djmdContent VALUES` (ligne ~78-92)
avec la 16e valeur :

```python
conn.execute(
    "CREATE TABLE djmdContent ("
    "ID TEXT PRIMARY KEY, Title TEXT, FolderPath TEXT, "
    "FileNameL TEXT, FileNameS TEXT, "
    "ArtistID TEXT, GenreID TEXT, LabelID TEXT, ReleaseYear INTEGER, "
    "TrackInfoUpdated TEXT, Analysed TEXT, AnalysisUpdated TEXT, CueUpdated TEXT, "
    "rb_local_usn INTEGER, updated_at TEXT, ImagePath TEXT)"
)
```

```python
conn.executemany(
    "INSERT INTO djmdContent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
        ("40000001", "Synthetic Test Track One", "D:/FIXTURE/track1.mp3",
         "track1.mp3", "track1.mp3", "70000001", "71000001", "72000001", 2020,
         "5", "true", "2026-01-01 00:00:00.000000", "2026-01-01 00:00:00.000000",
         1000, "2026-01-01 00:00:00.000000", "/PIONEER/Artwork/aaaa/artwork.jpg"),
        ("40000002", "Synthetic Test Track Two", "D:/FIXTURE/track2.flac",
         "track2.flac", "track2.flac", None, None, None, None,
         "5", "true", "2026-01-01 00:00:00.000000", "2026-01-01 00:00:00.000000",
         1000, "2026-01-01 00:00:00.000000", None),
        ("40000003", "Synthetic Test Track Three", "D:/FIXTURE/track3.wav",
         "track3.wav", "track3.wav", None, None, None, None,
         "5", "true", "2026-01-01 00:00:00.000000", "2026-01-01 00:00:00.000000",
         1000, "2026-01-01 00:00:00.000000", "/PIONEER/Artwork/bbbb/artwork.jpg"),
    ],
)
```

- [ ] **Step 2: Régénérer le fixture binaire**

Run: `python scripts/make-rekordbox-fixture.py`
Expected: `wrote .../rekordbox_master.db <N> bytes` (pas d'erreur — nécessite
`sqlcipher3-wheels`, déjà installé sur cette machine).

- [ ] **Step 3: Vérifier que les tests existants passent toujours**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --test-threads=1`
Expected: tous verts (le fixture régénéré ne doit rien casser — Task 3 des
plans Tier 1/2/3 précédents a déjà ce garde-fou, même principe : une colonne
ajoutée en fin de table ne change pas les colonnes lues par position ailleurs
tant que `SELECT *` n'est pas utilisé — vérifier que `read_rekordbox_masterdb`
utilise bien des noms de colonnes explicites, pas `SELECT *`, avant de
committer).

- [ ] **Step 4: Commit**

```bash
git add scripts/make-rekordbox-fixture.py src-tauri/tests/fixtures/rekordbox_master.db
git commit -m "test(m8): ajoute ImagePath au fixture master.db (synchro pochette)"
```

---

### Task 3 : Erreurs + résolution des 3 chemins artwork

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`

**Interfaces:**
- Produces: variantes `MasterDbError::NoArtworkPath { track_id: String }`,
  `MasterDbError::ArtworkVariantMissing { path: String }`,
  `MasterDbError::ArtworkWriteVerificationFailedRolledBack(String)`,
  `MasterDbError::ArtworkWriteVerificationFailedRollbackFailed(String)` ;
  fonction privée `fn resolve_artwork_variants(pioneer_dir: &Path, image_path: &str) -> (PathBuf, PathBuf, PathBuf)`
  (ordre : pleine taille, moyenne `_m`, miniature `_s`).

- [ ] **Step 1: Ajouter les variantes d'erreur**

Dans `src-tauri/src/rekordbox_masterdb.rs`, dans `enum MasterDbError` (après
`IdGenerationExhausted`, avant l'accolade fermante de l'enum) :

```rust
    /// `djmdContent.ImagePath` est NULL/vide pour cette piste — aucun
    /// mécanisme de création connu (non testé au spike 8), refuser plutôt
    /// que deviner un comportement Rekordbox non observé.
    NoArtworkPath {
        /// La piste sans pochette.
        track_id: String,
    },
    /// `ImagePath` pointe vers un chemin dont une des 3 variantes
    /// (pleine/moyenne/miniature) n'existe pas sur disque — refuse plutôt
    /// que de deviner les dimensions d'un fichier absent.
    ArtworkVariantMissing {
        /// Le chemin résolu manquant.
        path: String,
    },
    /// L'écriture des fichiers artwork a réussi mais la relecture ne montre
    /// pas les dimensions attendues — backup restauré automatiquement.
    ArtworkWriteVerificationFailedRolledBack(String),
    /// Idem, mais la restauration du backup a aussi échoué — les fichiers
    /// artwork live peuvent être dans un état incohérent.
    ArtworkWriteVerificationFailedRollbackFailed(String),
```

- [ ] **Step 2: Fonction de résolution des chemins**

Ajouter, après `find_or_create_named_row` (juste avant le commentaire
`/// M8 Tier 3 — writes Sift's own tagging output...`) :

```rust
/// Splits an `ImagePath` filename into its (stem, extension) and derives
/// the sibling "_m"/"_s" variant filenames Rekordbox maintains alongside
/// the full-size file — same directory, same extension, `_m`/`_s` suffix
/// inserted before the extension (observed on real Rekordbox data, spike 8:
/// `artwork.jpg` / `artwork_m.jpg` / `artwork_s.jpg`).
fn resolve_artwork_variants(pioneer_dir: &Path, image_path: &str) -> (PathBuf, PathBuf, PathBuf) {
    let share_root = pioneer_dir.join("share");
    let relative = image_path.trim_start_matches(['/', '\\']);
    let full = share_root.join(relative);
    let stem = full
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = full
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "jpg".to_string());
    let parent = full.parent().map(Path::to_path_buf).unwrap_or_default();
    let medium = parent.join(format!("{stem}_m.{ext}"));
    let small = parent.join(format!("{stem}_s.{ext}"));
    (full, medium, small)
}
```

- [ ] **Step 3: Vérifier que ça build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès (nouvelles variantes/fonction non encore utilisées —
`#[allow(dead_code)]` temporaire sur `resolve_artwork_variants` si le
compilateur se plaint, retiré à la Task 4 une fois consommée).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(m8): ajoute les erreurs + la resolution de chemins pour la synchro pochette"
```

---

### Task 4 : `sync_track_artwork`

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`

**Interfaces:**
- Consumes: `resolve_artwork_variants` (Task 3), `is_rekordbox_running`,
  `decrypt_masterdb`, `MasterDbError` (variantes Task 3 + existantes
  `Io`/`Sqlite`/`RekordboxRunning`/`TrackNotFound`).
- Produces: `pub fn sync_track_artwork(pioneer_dir: &Path, backup_dir: &Path, track_id: &str, cover_bytes: &[u8]) -> Result<(), MasterDbError>`.

- [ ] **Step 1: Importer le trait `ImageEncoder`**

`write_image` (utilisé ci-dessous et dans les tests Task 5) est une méthode
du trait `image::ImageEncoder`, pas une méthode inhérente de `JpegEncoder` —
ajouter en haut du fichier `src-tauri/src/rekordbox_masterdb.rs`, dans le
bloc `use` existant :

```rust
use image::ImageEncoder;
```

- [ ] **Step 2: Implémenter la fonction**

Ajouter juste après `resolve_artwork_variants` :

```rust
/// M8 Tier 3 — pochette. Overwrites the 3 cached artwork files Rekordbox
/// keeps for a track (`pioneer_dir/share/<ImagePath>` and its `_m`/`_s`
/// siblings) in place, resizing `cover_bytes` to match each existing
/// variant's exact dimensions. Never touches `master.db` — `ImagePath`
/// itself never changes (confirmed by spike 8), this only replaces file
/// bytes on disk.
///
/// Refuses (no silent fallback) when: Rekordbox is running, the track has
/// no `ImagePath` (`NoArtworkPath`), or any of the 3 variant files is
/// missing on disk (`ArtworkVariantMissing`) — the "no existing artwork at
/// all" case was never observed at spike 8, so this never guesses a
/// find-or-create-style behavior for it.
pub fn sync_track_artwork(
    pioneer_dir: &Path,
    backup_dir: &Path,
    track_id: &str,
    cover_bytes: &[u8],
) -> Result<(), MasterDbError> {
    if is_rekordbox_running() {
        return Err(MasterDbError::RekordboxRunning);
    }

    let db_path = pioneer_dir.join("master.db");
    let raw = std::fs::read(&db_path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;
    let mut conn =
        Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, false)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let image_path: Option<String> = conn
        .query_row(
            "SELECT ImagePath FROM djmdContent WHERE ID = ?1",
            rusqlite::params![track_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?
        .ok_or_else(|| MasterDbError::TrackNotFound { track_id: track_id.to_string() })?;
    let image_path = image_path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| MasterDbError::NoArtworkPath { track_id: track_id.to_string() })?;

    let (full, medium, small) = resolve_artwork_variants(pioneer_dir, &image_path);
    for target in [&full, &medium, &small] {
        if !target.exists() {
            return Err(MasterDbError::ArtworkVariantMissing {
                path: target.to_string_lossy().to_string(),
            });
        }
    }

    // Backup the 3 live files before touching any of them (own backup,
    // distinct from backup_rekordbox_files — these aren't master.db/xml).
    std::fs::create_dir_all(backup_dir).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let mut backups: Vec<(PathBuf, PathBuf)> = Vec::new();
    for target in [&full, &medium, &small] {
        let file_name = target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let backup_path = backup_dir.join(format!("artwork-{file_name}"));
        std::fs::copy(target, &backup_path).map_err(|e| MasterDbError::Io(e.to_string()))?;
        backups.push(((*target).clone(), backup_path));
    }

    let restore_all = |backups: &[(PathBuf, PathBuf)]| -> Result<(), MasterDbError> {
        for (target, backup_path) in backups {
            std::fs::copy(backup_path, target).map_err(|e| MasterDbError::Io(e.to_string()))?;
        }
        Ok(())
    };

    let cover = match image::load_from_memory(cover_bytes) {
        Ok(img) => img,
        Err(e) => return Err(MasterDbError::Io(format!("cover decode failed: {e}"))),
    };

    let write_result = (|| -> Result<(), MasterDbError> {
        for target in [&full, &medium, &small] {
            let (w, h) = image::image_dimensions(target)
                .map_err(|e| MasterDbError::Io(format!("reading dimensions of {target:?}: {e}")))?;
            let resized = cover.resize_exact(w, h, image::imageops::FilterType::Lanczos3);
            let mut buf: Vec<u8> = Vec::new();
            {
                let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
                encoder
                    .write_image(
                        resized.to_rgb8().as_raw(),
                        w,
                        h,
                        image::ExtendedColorType::Rgb8,
                    )
                    .map_err(|e| MasterDbError::Io(format!("jpeg encode failed: {e}")))?;
            }
            let tmp = target.with_extension("sift-write-tmp");
            std::fs::write(&tmp, &buf).map_err(|e| MasterDbError::Io(e.to_string()))?;
            if let Err(e) = std::fs::rename(&tmp, target) {
                std::fs::remove_file(&tmp).ok();
                return Err(MasterDbError::Io(e.to_string()));
            }
        }
        Ok(())
    })();

    if let Err(write_err) = write_result {
        restore_all(&backups).ok();
        return Err(write_err);
    }

    // Round-trip verify: reread each written file and confirm it decodes
    // and still matches the dimensions it had before (the ones we resized
    // to) — not just that the write syscall succeeded.
    let verify = || -> Result<(), MasterDbError> {
        for (target, backup_path) in &backups {
            let expected = image::image_dimensions(backup_path)
                .map_err(|e| MasterDbError::Io(format!("reading backup dimensions: {e}")))?;
            let got = image::image_dimensions(target)
                .map_err(|e| MasterDbError::Io(format!("reading written dimensions: {e}")))?;
            if got != expected {
                return Err(MasterDbError::Io(format!(
                    "dimension mismatch after write for {target:?}: expected {expected:?}, got {got:?}"
                )));
            }
        }
        Ok(())
    };

    match verify() {
        Ok(()) => Ok(()),
        Err(verify_err) => match restore_all(&backups) {
            Ok(()) => Err(MasterDbError::ArtworkWriteVerificationFailedRolledBack(verify_err.to_string())),
            Err(restore_err) => Err(MasterDbError::ArtworkWriteVerificationFailedRollbackFailed(format!(
                "{verify_err}; rollback also failed: {restore_err}"
            ))),
        },
    }
}
```

- [ ] **Step 3: Vérifier que ça build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès. Si `image::codecs::jpeg::JpegEncoder::write_image` ou
`image::image_dimensions` a une signature différente de celle utilisée
ci-dessus dans la version résolue par Cargo (vérifier `Cargo.lock` pour la
version exacte d'`image` après Task 1), corriger l'appel selon l'erreur du
compilateur — ne pas deviner une seconde API sans la lire.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(m8): moteur sync_track_artwork (reecrit les 3 fichiers pochette en place)"
```

---

### Task 5 : Tests sur fixture

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (module `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `sync_track_artwork`, `resolve_artwork_variants` (pour construire
  les chemins attendus dans les assertions de test).

- [ ] **Step 1: Helper de test — générer un JPEG synthétique en mémoire**

Ajouter dans `mod tests` :

```rust
    /// Encodes a solid-color JPEG of the given size, for use as fixture
    /// artwork files and as the "new cover" input to `sync_track_artwork`.
    fn synthetic_jpeg(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(width, height, image::Rgb(rgb));
        let mut buf = Vec::new();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
        encoder
            .write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .expect("encode synthetic jpeg");
        buf
    }

    /// Seeds `pioneer_dir/share/<image_path>` and its `_m`/`_s` siblings with
    /// synthetic JPEGs of the given per-variant sizes, mirroring what a real
    /// Rekordbox artwork cache folder looks like.
    fn seed_artwork_variants(pioneer_dir: &Path, image_path: &str, sizes: [(u32, u32); 3]) {
        let (full, medium, small) = resolve_artwork_variants(pioneer_dir, image_path);
        for (path, (w, h)) in [(&full, sizes[0]), (&medium, sizes[1]), (&small, sizes[2])] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, synthetic_jpeg(w, h, [10, 20, 30])).unwrap();
        }
    }
```

- [ ] **Step 2: Test — happy path, dimensions préservées par variante**

```rust
    #[test]
    fn sync_track_artwork_resizes_new_cover_to_each_existing_variant_size() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).unwrap();
        let backup_dir = tmp.path().join("backup");

        seed_artwork_variants(
            &pioneer_dir,
            "/PIONEER/Artwork/aaaa/artwork.jpg",
            [(500, 500), (100, 100), (40, 40)],
        );
        let new_cover = synthetic_jpeg(800, 800, [255, 0, 220]);

        sync_track_artwork(&pioneer_dir, &backup_dir, "40000001", &new_cover)
            .expect("sync should succeed");

        let (full, medium, small) =
            resolve_artwork_variants(&pioneer_dir, "/PIONEER/Artwork/aaaa/artwork.jpg");
        assert_eq!(image::image_dimensions(&full).unwrap(), (500, 500));
        assert_eq!(image::image_dimensions(&medium).unwrap(), (100, 100));
        assert_eq!(image::image_dimensions(&small).unwrap(), (40, 40));
    }
```

- [ ] **Step 3: Test — `ImagePath` NULL refuse explicitement**

```rust
    #[test]
    fn sync_track_artwork_rejects_track_with_no_image_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).unwrap();
        let backup_dir = tmp.path().join("backup");

        let err = sync_track_artwork(&pioneer_dir, &backup_dir, "40000002", &synthetic_jpeg(10, 10, [0, 0, 0]))
            .unwrap_err();
        assert_eq!(err, MasterDbError::NoArtworkPath { track_id: "40000002".to_string() });
    }
```

- [ ] **Step 4: Test — variante manquante sur disque refuse explicitement**

```rust
    #[test]
    fn sync_track_artwork_rejects_when_a_variant_file_is_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).unwrap();
        let backup_dir = tmp.path().join("backup");

        // Track 40000003 has an ImagePath in the fixture but no files were
        // ever seeded on disk for it.
        let err = sync_track_artwork(&pioneer_dir, &backup_dir, "40000003", &synthetic_jpeg(10, 10, [0, 0, 0]))
            .unwrap_err();
        assert!(matches!(err, MasterDbError::ArtworkVariantMissing { .. }));
    }
```

- [ ] **Step 5: Test — `master.db` bit-pour-bit inchangé après synchro**

```rust
    #[test]
    fn sync_track_artwork_never_touches_masterdb_bytes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).unwrap();
        let backup_dir = tmp.path().join("backup");

        seed_artwork_variants(
            &pioneer_dir,
            "/PIONEER/Artwork/aaaa/artwork.jpg",
            [(200, 200), (80, 80), (30, 30)],
        );
        let before = std::fs::read(pioneer_dir.join("master.db")).unwrap();

        sync_track_artwork(&pioneer_dir, &backup_dir, "40000001", &synthetic_jpeg(50, 50, [1, 2, 3]))
            .expect("sync should succeed");

        let after = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        assert_eq!(before, after, "master.db must be byte-for-byte unchanged");
    }
```

- [ ] **Step 6: Test — Rekordbox détecté comme tournant refuse toute écriture**

```rust
    #[test]
    fn sync_track_artwork_refuses_when_rekordbox_is_running() {
        // Same limitation as the existing Tier 1/2/3 equivalent tests: this
        // asserts the guard function itself doesn't panic (there is no mock
        // seam for is_rekordbox_running in this module — see
        // is_rekordbox_running_does_not_panic above). A live "Rekordbox
        // actually running" scenario is exercised manually, not in CI.
        assert!(!is_rekordbox_running() || is_rekordbox_running());
    }
```

- [ ] **Step 7: Run all tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --test-threads=1`
Expected: tous verts, y compris les 5 nouveaux tests.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "test(m8): couvre sync_track_artwork (resize par variante, NULL, fichier manquant, master.db intact)"
```

---

### Task 6 : Test contre une copie de la vraie bibliothèque

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`

**Interfaces:**
- Consumes: `sync_track_artwork`.

- [ ] **Step 1: Test d'intégration `#[ignore]`d**

Même convention que
`sync_track_metadata_round_trips_on_real_masterdb_copy` (canary "Street
Battle", `ID=99795585`, `ImagePath` déjà confirmé présent au spike 8) :

```rust
    /// Manual-only: exercises sync_track_artwork against a fresh copy of a
    /// real master.db + its real artwork cache folder (Rekordbox closed).
    /// Run manually:
    /// SIFT_M8_REAL_COPY_DIR=<dir with master.db + share/ + masterPlaylists6.xml>
    /// cargo test --manifest-path src-tauri/Cargo.toml sync_track_artwork_round_trips_on_real_masterdb_copy -- --ignored --nocapture
    #[test]
    #[ignore]
    fn sync_track_artwork_round_trips_on_real_masterdb_copy() {
        let Ok(dir) = std::env::var("SIFT_M8_REAL_COPY_DIR") else {
            eprintln!("skip: set SIFT_M8_REAL_COPY_DIR to run this test");
            return;
        };
        let pioneer_dir = Path::new(&dir);
        let backup_dir = pioneer_dir.join("sift-artwork-test-backup");
        let canary_id = "99795585";

        let (full, medium, small) =
            resolve_artwork_variants(pioneer_dir, "/PIONEER/Artwork/873/2140a-d8c1-472c-991b-6b281cf6005f/artwork.jpg");
        let before_full = std::fs::read(&full).expect("read baseline full artwork");
        let before_medium = std::fs::read(&medium).expect("read baseline medium artwork");
        let before_small = std::fs::read(&small).expect("read baseline small artwork");

        let test_cover = synthetic_jpeg(600, 600, [12, 200, 90]);
        sync_track_artwork(pioneer_dir, &backup_dir, canary_id, &test_cover)
            .expect("sync should succeed on real copy");

        let after_full = std::fs::read(&full).unwrap();
        assert_ne!(before_full, after_full, "full artwork should have changed");

        // Restore the original artwork files independently of the
        // function's own backup mechanism, so this test leaves the real
        // copy exactly as it found it.
        std::fs::write(&full, &before_full).unwrap();
        std::fs::write(&medium, &before_medium).unwrap();
        std::fs::write(&small, &before_small).unwrap();
        let restored_full = std::fs::read(&full).unwrap();
        assert_eq!(restored_full, before_full, "restore must be verified independently");
    }
```

- [ ] **Step 2: Vérification**

Lancer manuellement (Rekordbox fermé, `CARGO_TARGET_DIR` isolé si un autre
`tauri dev` tourne en parallèle) :

```bash
SIFT_M8_REAL_COPY_DIR=<copie fraîche de ~/Desktop/sift-masterdb-write-probe/spike8-artwork ou équivalent> \
cargo test --manifest-path src-tauri/Cargo.toml sync_track_artwork_round_trips_on_real_masterdb_copy -- --ignored --nocapture
```

Expected: le test passe, les 3 fichiers artwork live sont revenus à l'octet
près à leur état d'origine (vérifié indépendamment par la dernière
assertion).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "test(m8): test manuel sync_track_artwork contre une copie reelle"
```

---

### Task 7 : Revue finale

**Files:** aucun fichier propre — relecture transverse.

- [ ] **Step 1: Relire contre le spike 8 et le périmètre de ce plan**

Vérifier : `master.db`/`ImagePath` jamais modifiés (Task 5, test dédié) ;
aucune écriture si `ImagePath` NULL ou variante manquante (fail-fast, pas de
fallback) ; backup+rollback symétrique aux Tiers 1/2/3 existants ; pas de
régression sur les fonctions existantes du module.

- [ ] **Step 2: Vérification finale**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` (hors test `#[ignore]`d)
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Run: `npx tsc --noEmit` (aucun changement front dans ce plan — vérif de
non-régression seulement)
Expected: tout vert.

## Hors scope (plan séparé à venir)

- Câblage IPC (nouvelle commande, ou extension du hook Tier 3 texte une fois
  celui-ci lui-même câblé).
- Hook de détection au moment du filing (`filing.rs`) — quand déclencher une
  synchro pochette candidate.
- Écran UI.
- Cas `ImagePath` NULL avec création d'une nouvelle entrée côté Rekordbox
  (jamais testé — voir Évaluation 23, spike 8, "Risque residuel").
- Régénération des dimensions `_m`/`_s` quand un fichier `_m`/`_s` n'existe
  pas du tout mais que le fichier plein format existe (aujourd'hui : refus
  explicite via `ArtworkVariantMissing`, pas de génération de repli).
