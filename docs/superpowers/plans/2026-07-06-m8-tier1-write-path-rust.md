# M8 Tier 1 — Write path Rust pour `master.db` (réparation de chemin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `src-tauri/src/rekordbox_masterdb.rs` (currently read-only) with a
Tier 1 write path — repairing `FolderPath`/`FileNameL`/`FileNameS` on one
`djmdContent` row, with USN bump, mandatory backup, Rekordbox-running guard,
and post-write verification — proven on the existing synthetic fixture.

**Architecture:** Symmetric to the existing reader: decrypt the whole
`master.db` into a plaintext SQLite buffer, mutate it with ordinary `rusqlite`
SQL inside a transaction, re-serialize, re-encrypt page-by-page with fresh
random IVs, then swap the file atomically (temp file + rename). A safety
engine (running-process guard, timestamped backup, round-trip verification,
rollback) wraps the single Tier 1 operation. No IPC command, no UI — this
plan proves the engine only, matching the existing reader module's own
"not yet wired" precedent.

**Tech Stack:** Rust (`rusqlite` w/ `serialize` feature, `aes`, `cbc`,
`hmac`/`sha2`, `pbkdf2` — all already deps), plus 3 new deps added in this
plan: `rand` (fresh per-page IVs), `sysinfo` (Rekordbox-running detection),
`chrono` (`updated_at` timestamp formatting). Fixture regenerated via Python +
`sqlcipher3` (already used by the existing fixture, see
`src-tauri/src/rekordbox_masterdb.rs:322-337`).

## Global Constraints

- MSRV 1.77.2 (`src-tauri/Cargo.toml:9`) — every new dependency version must
  support it. Verified: `rand 0.8` (MSRV 1.36), `sysinfo 0.39` (no stated
  floor above ours), `chrono 0.4.45` (MSRV 1.62.0).
- **Never flip `Analysed`/`AnalysisUpdated`** (M8 non-negotiable rule,
  `docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`)
  — not touched by this plan at all (Tier 1 only touches path columns + USN).
- **Refuse to write if Rekordbox is running** — detection, not just catching
  the SQLite lock exception (design doc invariant #2).
- **Backup before any write, round-trip verify after, rollback as a
  first-class function** (design doc invariants #1/#3/#6).
- No IPC wiring, no UI in this plan — explicitly deferred (design doc
  "Intégration app", "Design UI complet différé à une session dédiée").
- Never copy real personal data into a fixture — synthetic data only (already
  the existing fixture's own rule, `rekordbox_masterdb.rs:336`).
- `cargo test`/`cargo clippy` must never run concurrently with an active
  `tauri dev` (corrupts the incremental cache — project rule).

---

## File Structure

- **Modify `src-tauri/src/rekordbox_masterdb.rs`** (currently 396 lines,
  read-only reader) — extended in place, not split. The design doc explicitly
  calls for extending this file ("extension de `rekordbox_masterdb.rs`
  (encrypt/write/verify)"), and it already has the exact crypto primitives
  (AES key derivation, page geometry constants) the writer must mirror. If a
  future session finds the file unwieldy, a `rekordbox_masterdb/{read,write}.rs`
  split is a reasonable follow-up — not done here, to match the existing flat
  file convention.
- **Modify `src-tauri/Cargo.toml`** — add `rand`, `sysinfo`, `chrono`.
- **Create `scripts/make-rekordbox-fixture.py`** — regenerates the test
  fixture; committed so the fixture's shape is reproducible and auditable
  (the previous fixture had no such script checked in).
- **Modify `src-tauri/tests/fixtures/rekordbox_master.db`** — regenerated
  binary fixture, adding the columns/table Tier 1 needs.

---

### Task 1: Extend the fixture with write-path columns/table

**Files:**
- Create: `scripts/make-rekordbox-fixture.py`
- Modify: `src-tauri/tests/fixtures/rekordbox_master.db` (regenerated binary)
- Modify: `src-tauri/src/rekordbox_masterdb.rs:322-337` (provenance comment)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`, new test)

**Interfaces:**
- Produces: fixture `djmdContent` rows now also carry `FileNameL`, `FileNameS`,
  `rb_local_usn` (INTEGER), `updated_at` (TEXT); new table `agentRegistry`
  (`registry_id` TEXT PK, `int_1` INTEGER, `updated_at` TEXT) with one row
  `('localUpdateCount', 1000, '2026-01-01 00:00:00.000000')`. Existing
  `djmdContent`/`djmdPlaylist`/`djmdSongPlaylist` row *values* for
  `ID`/`Title`/`FolderPath`/playlist membership are unchanged from today's
  fixture — the two existing tests (`deobfuscate_key_matches_pyrekordbox_reference`,
  `reads_fixture_tracks`) must keep passing unmodified.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/rekordbox_masterdb.rs` (after
`rejects_corrupted_page_hmac`, i.e. after line 395's closing `}` before the
module's final `}`):

```rust
    #[test]
    fn fixture_has_tier1_write_columns() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        let len = plaintext.len();
        conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
            .expect("deserialize fixture");

        let (file_name_l, rb_local_usn): (String, i64) = conn
            .query_row(
                "SELECT FileNameL, rb_local_usn FROM djmdContent WHERE ID = '40000001'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("djmdContent has FileNameL/rb_local_usn");
        assert_eq!(file_name_l, "track1.mp3");
        assert_eq!(rb_local_usn, 1000);

        let usn: i64 = conn
            .query_row(
                "SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'",
                [],
                |row| row.get(0),
            )
            .expect("agentRegistry has localUpdateCount row");
        assert_eq!(usn, 1000);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml fixture_has_tier1_write_columns -- --nocapture`
Expected: FAIL — `no such column: FileNameL` (today's fixture only has
`ID`/`Title`/`FolderPath`).

- [ ] **Step 3: Write the fixture-regeneration script**

Create `scripts/make-rekordbox-fixture.py`:

```python
"""Regenerates src-tauri/tests/fixtures/rekordbox_master.db.

Synthetic SQLCipher v4 database, no personal data. The passphrase below is
the deobfuscated static `master.db` passphrase (same value asserted by
rekordbox_masterdb.rs's `deobfuscate_key_matches_pyrekordbox_reference`
test) — it is a publicly documented constant, not a per-installation secret.

Usage: python scripts/make-rekordbox-fixture.py
Requires: pip install sqlcipher3-wheels
"""
import os
import sqlcipher3.dbapi2 as sqlite3

KEY = "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497"
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src-tauri", "tests", "fixtures", "rekordbox_master.db",
)

if os.path.exists(OUT):
    os.remove(OUT)

conn = sqlite3.connect(OUT)
conn.execute("PRAGMA key = '" + KEY + "'")
conn.execute("PRAGMA cipher_compatibility = 4")

conn.execute(
    "CREATE TABLE djmdContent ("
    "ID TEXT PRIMARY KEY, Title TEXT, FolderPath TEXT, "
    "FileNameL TEXT, FileNameS TEXT, "
    "rb_local_usn INTEGER, updated_at TEXT)"
)
conn.execute("CREATE TABLE djmdPlaylist (ID TEXT PRIMARY KEY, Name TEXT, ParentID TEXT)")
conn.execute(
    "CREATE TABLE djmdSongPlaylist ("
    "ID TEXT PRIMARY KEY, PlaylistID TEXT, ContentID TEXT, TrackNo INTEGER)"
)
conn.execute(
    "CREATE TABLE agentRegistry (registry_id TEXT PRIMARY KEY, int_1 INTEGER, updated_at TEXT)"
)

conn.executemany(
    "INSERT INTO djmdContent VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
        ("40000001", "Synthetic Test Track One", "D:/FIXTURE/track1.mp3",
         "track1.mp3", "track1.mp3", 1000, "2026-01-01 00:00:00.000000"),
        ("40000002", "Synthetic Test Track Two", "D:/FIXTURE/track2.flac",
         "track2.flac", "track2.flac", 1000, "2026-01-01 00:00:00.000000"),
        ("40000003", "Synthetic Test Track Three", "D:/FIXTURE/track3.wav",
         "track3.wav", "track3.wav", 1000, "2026-01-01 00:00:00.000000"),
    ],
)
conn.execute("INSERT INTO djmdPlaylist VALUES ('50000001', 'Fixture Playlist', NULL)")
conn.executemany(
    "INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?)",
    [
        ("60000001", "50000001", "40000001", 1),
        ("60000002", "50000001", "40000002", 2),
    ],
)
conn.execute(
    "INSERT INTO agentRegistry VALUES ('localUpdateCount', 1000, '2026-01-01 00:00:00.000000')"
)

conn.commit()
conn.close()
print("wrote", OUT, os.path.getsize(OUT), "bytes")
```

Run: `python scripts/make-rekordbox-fixture.py`
Expected output: `wrote .../rekordbox_master.db 36864 bytes`

- [ ] **Step 4: Update the provenance comment**

In `src-tauri/src/rekordbox_masterdb.rs`, replace the comment block at
lines 322-337 (the one starting `// Fixture provenance:`) with:

```rust
// Fixture provenance: `tests/fixtures/rekordbox_master.db` is a synthetic
// SQLCipher v4 database (3 fake tracks, 1 fake playlist, 1 fake
// agentRegistry row, no personal data), generated by
// `scripts/make-rekordbox-fixture.py` — regenerate with
// `python scripts/make-rekordbox-fixture.py` only if the fixture's
// schema/data needs to change; never copy data from a real Rekordbox
// library into this file.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all of `deobfuscate_key_matches_pyrekordbox_reference`,
`reads_fixture_tracks`, `rejects_truncated_file`,
`rejects_file_size_not_a_multiple_of_page_size`,
`rejects_corrupted_page_hmac`, `fixture_has_tier1_write_columns` (6 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/make-rekordbox-fixture.py src-tauri/tests/fixtures/rekordbox_master.db src-tauri/src/rekordbox_masterdb.rs
git commit -m "test(rekordbox_masterdb): extend fixture with Tier 1 write-path columns"
```

---

### Task 2: Fix the reserve-byte declaration so writes are safe

**Why this task exists (read before touching code):** `decrypt_masterdb`
currently zeroes the SQLite header's "reserved space per page" field
(`plain[4] = 0`) so the reconstructed buffer declares zero reserve. That was
harmless for a read-only module — but empirically verified against a real
SQLCipher page (manual PBKDF2+AES-CBC decrypt of this task's own fixture,
byte offset 20 of a genuine page 1 = `80`, matching the `RESERVE` constant),
real SQLCipher always declares the true reserve. If we keep declaring 0 and
then let `rusqlite` perform a live `UPDATE` on the deserialized buffer,
SQLite believes the *entire* 4096 bytes of every page are usable and may
write new cell content into the last 80 bytes — which our re-encryption step
(Task 3) treats as discardable padding. That would silently drop real
written data. Declaring the true reserve (80) costs nothing for reads (the
last 80 bytes of every page were never real content anyway) and makes writes
safe.

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs:264-271`
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`, existing +
  1 new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `decrypt_masterdb` output buffers now declare `reserve = RESERVE`
  (80) at file offset 20 of every reconstructed database, instead of 0. Same
  function signature, same byte layout otherwise (still `PAGE_SIZE` bytes per
  page, same zero-padded tail) — only the *declared* metadata value changes.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn reconstructed_buffer_declares_true_reserve() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        // SQLite file header offset 20 = "reserved space per page".
        assert_eq!(plaintext[20], RESERVE as u8);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reconstructed_buffer_declares_true_reserve -- --nocapture`
Expected: FAIL — `assertion failed: left == 0, right == 80` (current code
zeroes it).

- [ ] **Step 3: Fix the reserve declaration**

In `src-tauri/src/rekordbox_masterdb.rs`, replace lines 264-271:

```rust
        if page_no == 1 {
            // Byte 20 of a standard SQLite header ("reserved space per
            // page") must read 0 here: our reconstructed buffer declares
            // full-size, no-reserve pages (the reserve bytes below are
            // stripped from every page's usable content and replaced with
            // zero padding instead, keeping all pages a fixed PAGE_SIZE).
            plain[4] = 0; // offset 4 within `plain`, i.e. file offset 20 (16-byte magic prefix + 4)
            out.extend_from_slice(b"SQLite format 3\0");
        }
```

with:

```rust
        if page_no == 1 {
            // Byte 20 of a standard SQLite header ("reserved space per
            // page") must read the *true* reserve (RESERVE = 80), matching
            // what real SQLCipher pages always declare — verified against a
            // genuine page 1 (manual PBKDF2+AES-CBC decrypt showed byte 20
            // = 80, not 0). Declaring it truthfully costs nothing for reads
            // (those trailing bytes were never real SQLite content) and is
            // required for writes: if we declared 0, SQLite would believe
            // the full page is usable and could write real cell content
            // into the last RESERVE bytes, which the re-encryption path
            // (`encrypt_masterdb`) discards as padding — silently dropping
            // data.
            plain[4] = RESERVE as u8; // offset 4 within `plain`, i.e. file offset 20 (16-byte magic prefix + 4)
            out.extend_from_slice(b"SQLite format 3\0");
        }
```

- [ ] **Step 4: Run tests to verify everything still passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all 7 tests (the 6 from Task 1 plus
`reconstructed_buffer_declares_true_reserve`). In particular
`reads_fixture_tracks` must still pass unchanged: the reserve-only metadata
change does not alter any real row data.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "fix(rekordbox_masterdb): declare the true page reserve so writes are safe"
```

---

### Task 3: Add `encrypt_masterdb` (the inverse of `decrypt_masterdb`)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `rand`)
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (new imports, new constant
  removed/reused, new function after `decrypt_masterdb`, i.e. after line 280)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: `PAGE_SIZE`, `RESERVE`, `SALT_LEN`, `derive_keys`, `MasterDbError`
  (all already in this file).
- Produces: `pub(crate) fn encrypt_masterdb(plaintext: &[u8]) -> Result<Vec<u8>, MasterDbError>`
  — takes a plaintext buffer shaped exactly like `decrypt_masterdb`'s output
  (post-Task-2 fix: true reserve declared) and returns SQLCipher-v4-encrypted
  bytes, ready to write to disk. Generates a **fresh random salt** for the
  output file (equivalent to a passphrase-preserving rekey — the static
  passphrase is unchanged, only the per-file salt/derived keys rotate on
  every full rewrite). Task 6 (the actual writer) is the only caller outside
  tests.

- [ ] **Step 1: Add the `rand` dependency**

In `src-tauri/Cargo.toml`, after the `base85 = "2.0.0"` line (line 47), add:

```toml
rand = "0.8"
```

- [ ] **Step 2: Write the failing test**

```rust
    #[test]
    fn encrypt_then_decrypt_round_trips_byte_identical() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");

        let reencrypted = encrypt_masterdb(&plaintext).expect("encrypt plaintext");
        assert_eq!(reencrypted.len(), raw.len());

        let roundtripped = decrypt_masterdb(&reencrypted).expect("decrypt reencrypted");
        assert_eq!(roundtripped, plaintext);
    }

    #[test]
    fn encrypt_then_decrypt_still_reads_via_rusqlite() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        let reencrypted = encrypt_masterdb(&plaintext).expect("encrypt plaintext");

        std::fs::write(FIXTURE.replace(".db", "_reencrypted_tmp.db"), &reencrypted)
            .expect("write temp reencrypted file");
        let index = read_rekordbox_masterdb(std::path::Path::new(
            &FIXTURE.replace(".db", "_reencrypted_tmp.db"),
        ))
        .expect("read reencrypted file");
        std::fs::remove_file(FIXTURE.replace(".db", "_reencrypted_tmp.db")).ok();

        assert_eq!(index.tracks.len(), 3);
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml encrypt_then_decrypt -- --nocapture`
Expected: FAIL with `cannot find function 'encrypt_masterdb' in this scope`.

- [ ] **Step 4: Implement `encrypt_masterdb`**

Add these imports near the top of `src-tauri/src/rekordbox_masterdb.rs`
(alongside the existing `use cbc::cipher::{BlockDecryptMut, KeyIvInit};` on
line 55):

```rust
use cbc::cipher::BlockEncryptMut;
use rand::rngs::OsRng;
use rand::RngCore;
```

Add this type alias next to the existing `type Aes256CbcDec = cbc::Decryptor<Aes256>;`
(line 76):

```rust
type Aes256CbcEnc = cbc::Encryptor<Aes256>;
```

Add this function right after `decrypt_masterdb` (after line 280, before
`read_rekordbox_masterdb`):

```rust
/// Inverse of [`decrypt_masterdb`]: takes a plaintext SQLite buffer shaped
/// exactly like that function's output (fixed `PAGE_SIZE` pages, true
/// reserve declared per Task 2's fix) and re-encrypts it as a SQLCipher v4
/// file. Generates a fresh random salt for the output — equivalent to a
/// passphrase-preserving rekey on every full rewrite, which is simpler and
/// just as valid as trying to reuse the original file's salt.
pub(crate) fn encrypt_masterdb(plaintext: &[u8]) -> Result<Vec<u8>, MasterDbError> {
    if plaintext.len() < PAGE_SIZE || plaintext.len() % PAGE_SIZE != 0 {
        return Err(MasterDbError::TruncatedFile { len: plaintext.len() });
    }
    let passphrase = deobfuscate_key()?;
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let (key, hmac_key) = derive_keys(&passphrase, &salt);

    let n_pages = plaintext.len() / PAGE_SIZE;
    let mut out = Vec::with_capacity(plaintext.len());

    for i in 0..n_pages {
        let page_no = (i + 1) as u32;
        let page = &plaintext[i * PAGE_SIZE..(i + 1) * PAGE_SIZE];

        // Mirrors decrypt_masterdb's page1 special case in reverse: page1's
        // reconstructed plaintext is [16-byte magic][4000-byte body][80-byte
        // pad]; every other page is [4016-byte body][80-byte pad].
        let body = if page_no == 1 {
            &page[SALT_LEN..SALT_LEN + (PAGE_SIZE - RESERVE - SALT_LEN)]
        } else {
            &page[..PAGE_SIZE - RESERVE]
        };

        let mut iv = [0u8; 16];
        OsRng.fill_bytes(&mut iv);

        let encryptor = Aes256CbcEnc::new(key.into(), iv.into());
        let ciphertext = encryptor
            .encrypt_padded_vec_mut::<NoPadding>(body)
            .map_err(|_| MasterDbError::Decrypt { page: page_no })?;

        let mut mac = <HmacSha512 as Mac>::new_from_slice(&hmac_key)
            .expect("HMAC-SHA512 accepts any key length");
        mac.update(&ciphertext);
        mac.update(&iv);
        mac.update(&page_no.to_le_bytes());
        let stored_hmac = mac.finalize().into_bytes();

        if page_no == 1 {
            out.extend_from_slice(&salt);
        }
        out.extend_from_slice(&ciphertext);
        out.extend_from_slice(&iv);
        out.extend_from_slice(&stored_hmac);
    }

    Ok(out)
}
```

Note: `MasterDbError::Decrypt` is reused for an encrypt-side padding failure
too (both are "the AES block cipher rejected this buffer" — no new variant
needed; `NoPadding` requires `body.len()` to already be block-aligned, which
it always is here since `PAGE_SIZE - RESERVE - SALT_LEN` = 4000 and
`PAGE_SIZE - RESERVE` = 4016 are both multiples of 16).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add encrypt_masterdb, the inverse of decrypt_masterdb"
```

---

### Task 4: Rekordbox-running guard

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `sysinfo`)
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (new import, new function,
  new `MasterDbError` variant is NOT needed here — this returns `bool`, the
  caller in Task 6 maps `true` to an error)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub(crate) fn is_rekordbox_running() -> bool`. Task 6 calls this
  and returns `Err(MasterDbError::RekordboxRunning)` when it's `true`, before
  touching any file.

- [ ] **Step 1: Add the `sysinfo` dependency**

In `src-tauri/Cargo.toml`, after the `rand = "0.8"` line just added, add:

```toml
sysinfo = "0.39"
```

- [ ] **Step 2: Write the failing test**

```rust
    #[test]
    fn is_rekordbox_running_does_not_panic() {
        // Can't assert a specific value cross-platform without spawning a
        // real process named "rekordbox" — this is a smoke test proving the
        // sysinfo integration itself doesn't panic. In this test
        // environment Rekordbox is not running, so the honest expectation
        // is `false`; if this ever flakes true on a dev machine that
        // genuinely has Rekordbox open, that is the function working
        // correctly, not a bug.
        let running = is_rekordbox_running();
        assert!(!running, "Rekordbox should not be running in the test environment");
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml is_rekordbox_running_does_not_panic -- --nocapture`
Expected: FAIL with `cannot find function 'is_rekordbox_running' in this scope`.

- [ ] **Step 4: Implement the guard**

Add this import near the top of `src-tauri/src/rekordbox_masterdb.rs`:

```rust
use sysinfo::System;
```

Add this function anywhere after `read_rekordbox_masterdb` (e.g. right
before the `// Fixture provenance:` comment block):

```rust
/// Whether a Rekordbox process is currently running, checked by partial,
/// case-insensitive process-name match ("rekordbox" matches both
/// `rekordbox.exe` on Windows and `rekordbox` on macOS). Equivalent to
/// `pyrekordbox.utils.get_rekordbox_pid()`, which the M8 write-path design
/// (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`)
/// requires as a guard *before* opening the file — the SQLite "database is
/// locked" exception is only a fallback safety net, never the primary
/// guard (Éval 7, `docs/ressources-externes.md`).
pub(crate) fn is_rekordbox_running() -> bool {
    // `System::new_all()` already loads all process info at construction —
    // no separate refresh call needed for a one-shot check like this.
    let sys = System::new_all();
    sys.processes().values().any(|p| {
        p.name()
            .to_string_lossy()
            .to_lowercase()
            .contains("rekordbox")
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all 10 tests. If `System::new_all()` or `Process::name()`
report a different signature than confirmed above (`System::new_all() -> Self`,
`Process::name() -> &OsStr`), the compiler error will name the exact
mismatch — adjust to whatever `cargo check`'s message points at, re-run this
step, and note the actual signature used in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add is_rekordbox_running write guard"
```

---

### Task 5: Backup and restore helpers

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (new `MasterDbError` variant,
  two new functions)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: `read_rekordbox_masterdb` (to verify a backup actually decrypts
  before trusting it).
- Produces:
  - `pub(crate) fn backup_rekordbox_files(pioneer_dir: &Path, backup_dir: &Path) -> Result<(), MasterDbError>`
  - `pub(crate) fn restore_rekordbox_backup(pioneer_dir: &Path, backup_dir: &Path) -> Result<(), MasterDbError>`

  Both operate on the two fixed filenames `master.db` and
  `masterPlaylists6.xml` inside the given directories. `backup_dir` is
  supplied by the caller (Task 6, and eventually a future IPC layer) rather
  than generated here — keeps this module free of wall-clock/dir-naming
  policy, which belongs to the caller.

- [ ] **Step 1: Write the failing test**

```rust
    #[test]
    fn backup_then_restore_round_trips() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");

        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        backup_rekordbox_files(&pioneer_dir, &backup_dir).expect("backup");
        assert!(backup_dir.join("master.db").exists());
        assert!(backup_dir.join("masterPlaylists6.xml").exists());

        // Corrupt the "live" master.db to simulate a bad write.
        std::fs::write(pioneer_dir.join("master.db"), b"corrupted").expect("corrupt live db");

        restore_rekordbox_backup(&pioneer_dir, &backup_dir).expect("restore");
        let restored = std::fs::read(pioneer_dir.join("master.db")).expect("read restored");
        let original = std::fs::read(FIXTURE).expect("read fixture");
        assert_eq!(restored, original);
    }

    #[test]
    fn backup_rejects_unreadable_masterdb() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::write(pioneer_dir.join("master.db"), b"not a real database")
            .expect("write garbage master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let err = backup_rekordbox_files(&pioneer_dir, &backup_dir).unwrap_err();
        assert!(matches!(err, MasterDbError::FileTooShort));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backup_ -- --nocapture`
Expected: FAIL with `cannot find function 'backup_rekordbox_files' in this scope`.

- [ ] **Step 3: Implement the helpers**

Add these functions after `is_rekordbox_running`:

```rust
/// Copies `master.db` + `masterPlaylists6.xml` from `pioneer_dir` into
/// `backup_dir` (created if missing), then verifies the copied `master.db`
/// actually decrypts (full HMAC check on every page) before returning `Ok`
/// — a backup that can't be read back is worse than no backup, so this
/// fails fast rather than trusting a raw file copy blindly.
pub(crate) fn backup_rekordbox_files(pioneer_dir: &Path, backup_dir: &Path) -> Result<(), MasterDbError> {
    std::fs::create_dir_all(backup_dir).map_err(|e| MasterDbError::Io(e.to_string()))?;

    let src_db = pioneer_dir.join("master.db");
    let dst_db = backup_dir.join("master.db");
    std::fs::copy(&src_db, &dst_db).map_err(|e| MasterDbError::Io(e.to_string()))?;

    let src_xml = pioneer_dir.join("masterPlaylists6.xml");
    let dst_xml = backup_dir.join("masterPlaylists6.xml");
    std::fs::copy(&src_xml, &dst_xml).map_err(|e| MasterDbError::Io(e.to_string()))?;

    // Verify the backup is actually readable before trusting it.
    read_rekordbox_masterdb(&dst_db)?;
    Ok(())
}

/// Restores `master.db` + `masterPlaylists6.xml` from `backup_dir` back into
/// `pioneer_dir`, overwriting the live files. Used both as a user-triggered
/// rollback and internally by the write path when post-write verification
/// fails (see Task 6).
pub(crate) fn restore_rekordbox_backup(pioneer_dir: &Path, backup_dir: &Path) -> Result<(), MasterDbError> {
    std::fs::copy(backup_dir.join("master.db"), pioneer_dir.join("master.db"))
        .map_err(|e| MasterDbError::Io(e.to_string()))?;
    std::fs::copy(
        backup_dir.join("masterPlaylists6.xml"),
        pioneer_dir.join("masterPlaylists6.xml"),
    )
    .map_err(|e| MasterDbError::Io(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add backup_rekordbox_files / restore_rekordbox_backup"
```

---

### Task 6: `repair_track_path` — the Tier 1 write engine

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `chrono`)
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (new `MasterDbError`
  variants, new struct, new function)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: `is_rekordbox_running` (Task 4), `backup_rekordbox_files` /
  `restore_rekordbox_backup` (Task 5), `decrypt_masterdb` / `encrypt_masterdb`
  (Tasks 2-3), `read_rekordbox_masterdb` (existing).
- Produces:
  ```rust
  pub struct PathRepair {
      pub track_id: String,
      pub new_folder_path: String,
      pub new_file_name_l: String,
      pub new_file_name_s: String,
  }

  pub fn repair_track_path(
      pioneer_dir: &Path,
      backup_dir: &Path,
      repair: &PathRepair,
  ) -> Result<(), MasterDbError>
  ```
  This is the only function in this plan without `pub(crate)` — it is the
  Tier 1 engine's public entry point, ready for a future IPC command to call
  (not added in this plan).

**Deliberate scope note (read before writing tests):** this function does
**not** touch `masterPlaylists6.xml` at all. The M8 spike found that a pure
`FolderPath` change doesn't semantically require an XML resync (design doc
Tier 1 section), but the spike's own real-Rekordbox acceptance test (Test 2)
happened to run through `pyrekordbox`, which rewrites the XML as a side
effect of *any* `commit()` — so that spike proved "XML-rewritten copies are
accepted", not "leaving the XML untouched is equally accepted". This plan
takes the documented-but-not-fully-proven position that leaving it untouched
is fine (no playlists are touched by Tier 1). Flag this in the doc-comment so
a future session doesn't mistake it for a fully closed question.

- [ ] **Step 1: Add the `chrono` dependency**

In `src-tauri/Cargo.toml`, after the `sysinfo = "0.39"` line just added, add:

```toml
chrono = "0.4"
```

- [ ] **Step 2: Add new `MasterDbError` variants**

In `src-tauri/src/rekordbox_masterdb.rs`, in the `MasterDbError` enum
(after the `Decrypt { page: u32 }` variant, i.e. after line 123), add:

```rust
    /// A write was refused because Rekordbox is currently running — write
    /// must never proceed while Rekordbox might also be touching the file.
    RekordboxRunning,
    /// `agentRegistry` has no `localUpdateCount` row — the file's shape
    /// doesn't match what Tier 1 assumes, refuse rather than guess a USN.
    RegistryRowMissing,
    /// No `djmdContent` row with the given `ID` — nothing to repair.
    TrackNotFound {
        /// The `djmdContent.ID` that was not found.
        track_id: String,
    },
    /// The write succeeded but re-reading the file afterwards didn't show
    /// the expected value — backup was restored automatically.
    WriteVerificationFailedRolledBack(String),
    /// The write succeeded, re-reading it failed verification, AND
    /// restoring the backup also failed — the live file may now be in a
    /// bad state and needs manual attention.
    WriteVerificationFailedRollbackFailed(String),
```

And in the matching `impl std::fmt::Display for MasterDbError` block (after
the `Decrypt { page }` arm, i.e. after line 140), add:

```rust
            MasterDbError::RekordboxRunning => {
                write!(f, "refusing to write: Rekordbox is currently running")
            }
            MasterDbError::RegistryRowMissing => {
                write!(f, "agentRegistry has no localUpdateCount row")
            }
            MasterDbError::TrackNotFound { track_id } => {
                write!(f, "no djmdContent row with ID {track_id}")
            }
            MasterDbError::WriteVerificationFailedRolledBack(m) => {
                write!(f, "write verification failed, backup restored: {m}")
            }
            MasterDbError::WriteVerificationFailedRollbackFailed(m) => {
                write!(f, "write verification failed AND rollback failed — manual attention needed: {m}")
            }
```

- [ ] **Step 3: Write the failing test**

```rust
    #[test]
    fn repair_track_path_updates_path_and_bumps_usn() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let repair = PathRepair {
            track_id: "40000001".to_string(),
            new_folder_path: "D:/FIXTURE/renamed/track1.flac".to_string(),
            new_file_name_l: "track1.flac".to_string(),
            new_file_name_s: "track1.flac".to_string(),
        };
        repair_track_path(&pioneer_dir, &backup_dir, &repair).expect("repair path");

        // Round-trip via the existing read-only reader.
        let index = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread");
        let repaired = index
            .tracks
            .iter()
            .find(|t| t.track_id == "40000001")
            .expect("track 40000001 present");
        assert_eq!(repaired.folder_path, "D:/FIXTURE/renamed/track1.flac");

        // Other two tracks untouched.
        let other = index
            .tracks
            .iter()
            .find(|t| t.track_id == "40000002")
            .expect("track 40000002 present");
        assert_eq!(other.folder_path, "D:/FIXTURE/track2.flac");
        assert_eq!(index.tracks.len(), 3);

        // Backup exists and matches the original fixture.
        let backed_up = std::fs::read(backup_dir.join("master.db")).expect("read backup");
        let original = std::fs::read(FIXTURE).expect("read fixture");
        assert_eq!(backed_up, original);
    }

    #[test]
    fn repair_track_path_rejects_unknown_track_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let repair = PathRepair {
            track_id: "99999999".to_string(),
            new_folder_path: "D:/nope.mp3".to_string(),
            new_file_name_l: "nope.mp3".to_string(),
            new_file_name_s: "nope.mp3".to_string(),
        };
        let err = repair_track_path(&pioneer_dir, &backup_dir, &repair).unwrap_err();
        assert_eq!(err, MasterDbError::TrackNotFound { track_id: "99999999".to_string() });
    }
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repair_track_path -- --nocapture`
Expected: FAIL with `cannot find struct 'PathRepair'`/`cannot find function 'repair_track_path'`.

- [ ] **Step 5: Implement `PathRepair` and `repair_track_path`**

Add near the top-level types (after `RekordboxIndex`, i.e. after line 164):

```rust
/// One Tier 1 path-repair operation: the 3 `djmdContent` path columns that
/// must move together (`FolderPath`, `FileNameL`, `FileNameS` — confirmed by
/// the M8 spike to always change as a set, never `FolderPath` alone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathRepair {
    /// Rekordbox `djmdContent.ID` of the row to repair.
    pub track_id: String,
    /// New `FolderPath`.
    pub new_folder_path: String,
    /// New `FileNameL`.
    pub new_file_name_l: String,
    /// New `FileNameS`.
    pub new_file_name_s: String,
}
```

Add the main function after `restore_rekordbox_backup`:

```rust
/// Repairs one track's `FolderPath`/`FileNameL`/`FileNameS` in a Rekordbox
/// `master.db`, bumping the global USN counter (`agentRegistry`) and the
/// row's own `rb_local_usn`/`updated_at`, per the M8 Tier 1 design
/// (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`).
///
/// Deliberately does **not** touch `masterPlaylists6.xml` (see this
/// function's module-level scope note) and deliberately does **not** touch
/// `Analysed`/`AnalysisUpdated`/`CueUpdated` (the M8 non-negotiable rule —
/// metadata/path writes must never look like an analysis change).
///
/// Safety sequence: refuse if Rekordbox is running → backup → decrypt →
/// update inside a transaction → re-encrypt → atomic rename → round-trip
/// verify via the existing read-only reader → on verification failure,
/// automatically restore the backup and report which case happened.
pub fn repair_track_path(
    pioneer_dir: &Path,
    backup_dir: &Path,
    repair: &PathRepair,
) -> Result<(), MasterDbError> {
    if is_rekordbox_running() {
        return Err(MasterDbError::RekordboxRunning);
    }

    let db_path = pioneer_dir.join("master.db");
    backup_rekordbox_files(pioneer_dir, backup_dir)?;

    let raw = std::fs::read(&db_path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    conn.deserialize(rusqlite::MAIN_DB, &plaintext)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.6f").to_string();

    let tx = conn.transaction().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let old_usn: i64 = tx
        .query_row(
            "SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => MasterDbError::RegistryRowMissing,
            other => MasterDbError::Sqlite(other.to_string()),
        })?;
    let new_usn = old_usn + 1;

    tx.execute(
        "UPDATE agentRegistry SET int_1 = ?1, updated_at = ?2 WHERE registry_id = 'localUpdateCount'",
        rusqlite::params![new_usn, now],
    )
    .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let rows_changed = tx
        .execute(
            "UPDATE djmdContent SET FolderPath = ?1, FileNameL = ?2, FileNameS = ?3, rb_local_usn = ?4, updated_at = ?5 WHERE ID = ?6",
            rusqlite::params![
                repair.new_folder_path,
                repair.new_file_name_l,
                repair.new_file_name_s,
                new_usn,
                now,
                repair.track_id,
            ],
        )
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    if rows_changed != 1 {
        return Err(MasterDbError::TrackNotFound { track_id: repair.track_id.clone() });
    }

    tx.commit().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let plaintext2 = conn.serialize(rusqlite::MAIN_DB).map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let raw2 = encrypt_masterdb(&plaintext2)?;

    let tmp_path = pioneer_dir.join("master.db.sift-write-tmp");
    std::fs::write(&tmp_path, &raw2).map_err(|e| MasterDbError::Io(e.to_string()))?;
    std::fs::rename(&tmp_path, &db_path).map_err(|e| MasterDbError::Io(e.to_string()))?;

    match read_rekordbox_masterdb(&db_path) {
        Ok(index) => {
            let ok = index
                .tracks
                .iter()
                .any(|t| t.track_id == repair.track_id && t.folder_path == repair.new_folder_path);
            if ok {
                Ok(())
            } else {
                let msg = format!("track {} not found with expected path after write", repair.track_id);
                match restore_rekordbox_backup(pioneer_dir, backup_dir) {
                    Ok(()) => Err(MasterDbError::WriteVerificationFailedRolledBack(msg)),
                    Err(restore_err) => Err(MasterDbError::WriteVerificationFailedRollbackFailed(
                        format!("{msg}; rollback also failed: {restore_err}"),
                    )),
                }
            }
        }
        Err(read_err) => match restore_rekordbox_backup(pioneer_dir, backup_dir) {
            Ok(()) => Err(MasterDbError::WriteVerificationFailedRolledBack(read_err.to_string())),
            Err(restore_err) => Err(MasterDbError::WriteVerificationFailedRollbackFailed(format!(
                "{read_err}; rollback also failed: {restore_err}"
            ))),
        },
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all 14 tests. If `conn.deserialize` (the 2-argument,
writable form) errors as read-only or otherwise mismatches, the compiler/test
failure will name the exact issue — resolve against the confirmed
`Connection::serialize`/`deserialize` signatures
(`pub fn serialize(&self, db_name: &str) -> Result<Vec<u8>>`,
`pub fn deserialize(&self, db_name: &str, data: &[u8]) -> Result<()>`) before
falling back to `deserialize_read_exact` with `read_only = false`.

- [ ] **Step 7: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean (fix any warning before proceeding — do not `#[allow]` it away
without checking it's a genuine false positive first).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add repair_track_path, the Tier 1 write engine"
```

---

## Self-Review

- **Spec coverage**: Tier 1's confirmed-safe scope (path repair, 3 columns +
  USN bump, no XML touch, no `Analysed`/`AnalysisUpdated` touch) is fully
  covered (Task 6). The design doc's safety invariants are all covered:
  backup-before-write (Task 5, used in Task 6), refuse-if-running (Task 4),
  round-trip-verify (Task 6's final `read_rekordbox_masterdb` check),
  rollback-as-first-class-function (Task 5's `restore_rekordbox_backup`,
  public at `pub(crate)` — not yet exposed past the crate boundary since no
  IPC command exists yet, matching the explicit "Design UI complet différé"
  deferral). Tier 2 (playlist sync) and Tier 3 (metadata reload flag,
  contingent on the still-unresolved spike retest) are explicitly **not**
  covered by this plan — only Tier 1, which the design doc marks
  "CONFIRMÉ SÛR — gate levé."
- **Placeholder scan**: no TBD/TODO, every step has real code and an exact
  command with expected output.
- **Type consistency**: `PathRepair` fields (`track_id`, `new_folder_path`,
  `new_file_name_l`, `new_file_name_s`) are used identically in Task 6's
  struct definition, its test construction, and `repair_track_path`'s body.
  `MasterDbError` variants introduced in Task 6 match their usages exactly
  (`RekordboxRunning`, `RegistryRowMissing`, `TrackNotFound { track_id }`,
  `WriteVerificationFailedRolledBack(String)`,
  `WriteVerificationFailedRollbackFailed(String)`).

## After this plan

Not covered here, left for follow-up sessions per the design doc's own
sequencing:
- Retest Tier 3 (`TrackInfoUpdated` flag) by exact `ID`, the one point the
  design doc still marks open — does not block this plan's Tier 1 scope.
- Tier 2 (playlist sync) — separate design work, not started.
- IPC command + UI (preview diff, two-click in-app confirmation, journal
  entry + Revert) — explicitly deferred by the design doc to "une session
  dédiée, une fois le moteur prouvé" (this plan is that proof for Tier 1).
- A verification run against a *copy* of a real `master.db` (not just the
  synthetic fixture), followed by Antoine's manual real-Rekordbox
  acceptance check — mirroring the spike protocol, before this ever touches
  a live library.
