# Lecteur SQLCipher master.db Rekordbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Do NOT dispatch a subagent (Task/Agent tool) for this plan — execute inline,
> one task at a time, in the same session.** A prior attempt lost 15 minutes and
> 144k tokens to two subagents editing `Cargo.toml` concurrently with no commit
> to show for it, and left an uncommitted draft of this exact plan on disk with
> unresolved "to confirm" placeholders. This version replaces that draft with
> empirically confirmed parameters (see below) — no more placeholders to resolve.

**Goal:** Read-only, pure-Rust decryption of Rekordbox's SQLCipher-encrypted
`master.db`, producing a plaintext in-memory SQLite buffer that `rusqlite`
(via `Connection::deserialize`) can query normally — no OpenSSL, no writes to
disk, no writes to the encrypted source.

**Architecture:** One new module, `src-tauri/src/rekordbox_masterdb.rs`,
exposing `pub fn read_rekordbox_masterdb(path: &Path) -> Result<Vec<u8>, MasterDbError>`.
Internally: read salt (first 16 bytes) → derive AES key + HMAC key via PBKDF2 →
for every 4096-byte page, verify HMAC-SHA512 then AES-256-CBC-decrypt the
non-reserved region → reassemble a byte-valid unencrypted SQLite file in
memory → caller (out of scope here) hands it to `rusqlite::Connection::deserialize`.
No IPC wiring, no `RekordboxIndex`/track-parsing logic in this plan — deferred
per the design spec ("Intégration avec le reste de Sift": bascule prévue
après validation complète de ce lecteur, pas en même temps que M7). This plan
stops at: decrypt bytes in, valid SQLite buffer out, verified against a
committed fixture + a Python byte-level oracle.

**Tech Stack:** `pbkdf2` 0.12, `hmac` 0.12, `sha2` 0.10, `aes` 0.8, `cbc` 0.1,
`flate2` 1.1.9, `base85` 2.0.0 (all already added to `src-tauri/Cargo.toml`,
uncommitted — Task 1 commits them as-is). `rusqlite` 0.40 with `serialize`
feature (already enabled). Fixture generated via Python `sqlcipher3` +
`pyrekordbox` (dev-time only, not a Rust dependency, not committed).

## Global Constraints

- Read-only. No write path to `master.db` in this plan (M8 stays frozen).
- No data ever written to disk in cleartext — decrypted buffer lives in
  memory only, handed directly to `rusqlite::Connection::deserialize`.
- No OpenSSL / no C toolchain dependency — pure Rust crypto only (RustCrypto
  crates), confirmed already resolved in `Cargo.toml`.
- Fail-fast on HMAC mismatch — never return page data if its HMAC tag does
  not verify. No silent fallback.
- Fixture contains zero personal data (synthetic tracks/playlists only),
  committed to `src-tauri/tests/fixtures/rekordbox-master-fixture.db`.
- Never touch the user's real Rekordbox library in this plan — fixture-only
  testing. (Manual validation against the real, already-copied library from
  the earlier spike is a separate follow-up step for the user, not part of
  this plan's automated tests.)
- `cargo test --manifest-path src-tauri/Cargo.toml` must pass after every
  task — baseline in this worktree right now is **180 passed, 2 pre-existing
  failures** (`analysis::decode::tests::decode_pcm_streams_full_native_stereo`
  and `probe_reports_native_sample_rate`, both failing on a missing audio
  fixture file unrelated to this work — do not try to fix those, just don't
  add new failures).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D
  warnings` must stay clean.
- Never `--no-verify` on commits.
- Do not run `cargo test`/`clippy` while `tauri dev` is running concurrently
  (corrupts the incremental cache) — not a concern in this session, `tauri
  dev` is not running.
- Environment note: `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe` is
  an empty placeholder file already present in this worktree (0 bytes,
  gitignored via `src-tauri/binaries/` in `.gitignore`) so that
  `tauri_build::build()`'s resource check doesn't fail `cargo build`/`cargo
  test` in an environment without the real bundled FFmpeg sidecar. Leave it
  as-is; it has no effect on this plan's code and is never committed.

## Empirically confirmed SQLCipher v4 parameters (do not re-derive)

Validated in this session via a byte-level Python oracle: manual PBKDF2 +
AES-CBC decryption of a `sqlcipher3`-created database, cross-checked three
independent ways — (1) `PRAGMA kdf_iter`/`cipher_kdf_algorithm` read directly
off a live `sqlcipher3` connection, (2) the computed HMAC tag matched the
stored tag byte-for-byte, (3) the fully reassembled plaintext buffer opened
successfully with the **stock** (non-cipher) Python `sqlite3` module and
returned the exact rows inserted. Not assumed, not copied from memory.

- `cipher_page_size` = 4096
- `kdf_iter` = 256000 (confirmed via live `PRAGMA kdf_iter`)
- KDF: PBKDF2-HMAC-SHA512, encryption key length 32 bytes (AES-256)
- HMAC: HMAC-SHA512 (full 64-byte digest, no truncation)
- HMAC key: PBKDF2-HMAC-SHA512(same passphrase bytes as the encryption key,
  `salt XOR 0x3a` repeated per byte, **2** iterations, dklen = **32 bytes**)
  — confirmed by matching the stored HMAC tag exactly on a real fixture page.
- Reserve size per page = `iv_sz (16) + hmac_sz (64)` = **80 bytes**, already
  a multiple of the AES block size (16), no extra rounding.
- Page 1 special case: file's first 16 bytes are the KDF salt (plaintext,
  unencrypted). The encrypted content of page 1 is only
  `page_size - 16 - reserve` = 4000 bytes, immediately followed by the
  16-byte IV then the 64-byte HMAC tag (content, then IV, then HMAC, in that
  order).
- HMAC input = `ciphertext_content || iv || pgno_as_u32_little_endian`
  (confirmed via `cipher_hmac_pgno = 'le'` pragma and byte-exact tag match).
- The passphrase fed into PBKDF2 is the **UTF-8 bytes of the 64-hex-character
  string itself** (e.g. the literal text `"402fd482...08497"`), NOT the
  hex-decoded 32 raw bytes. Both hypotheses were tested against a real
  fixture: hex-decoded-raw-key produced an undecryptable buffer; UTF-8-string
  produced a byte-valid, independently reopenable SQLite database matching
  every row. (SQLCipher's raw-key mode requires the explicit `x'...'`
  blob-literal PRAGMA syntax, which Rekordbox/pyrekordbox do not use — they
  use a bare `PRAGMA key = '<hexstring>'`.)
- The IV is genuinely random per page (generated at encrypt time, stored raw
  in the reserve region) — not derived from the page number. Only the HMAC
  covers the page number for tamper detection; the IV itself must be read
  directly from the reserve region of each page.

Cross-referenced against SQLCipher's own C source
(`sqlcipher_page_cipher` and `sqlcipher_codec_ctx_reserve_setup` in
`src/sqlcipher.c` on `github.com/sqlcipher/sqlcipher@master`, fetched during
this session) — the reserve/IV/HMAC layout above matches the reference
implementation exactly.

## File Structure

- Create: `src-tauri/src/rekordbox_masterdb.rs` — the module (key
  deobfuscation, PBKDF2 derivation, per-page decrypt, buffer assembly, public
  `read_rekordbox_masterdb` function, `MasterDbError` enum).
- Modify: `src-tauri/src/lib.rs` — add `pub mod rekordbox_masterdb;` (no IPC
  wiring — out of scope, deferred per spec).
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` — commit the
  already-uncommitted dependency additions (Task 1, no further edits needed).
- Create (already done, this session): `src-tauri/tests/fixtures/rekordbox-master-fixture.db`
  — synthetic encrypted fixture, 3 tracks / 2 playlists / 3 playlist-song
  links, no personal data.
- Test: `src-tauri/tests/rekordbox_masterdb.rs` — integration test against
  the fixture, comparing decrypted rows to a hardcoded oracle (the same
  values used to generate the fixture, documented inline and in Task 2).

Note: an unrelated stray file `src-tauri/tests/fixtures/rekordbox_master.db`
(underscore, not hyphen) already exists in this worktree from an earlier
aborted attempt — untracked, do not add or reference it. This plan's fixture
is `rekordbox-master-fixture.db` (hyphen).

## Interfaces

- Produces: `pub fn read_rekordbox_masterdb(path: &std::path::Path) -> Result<Vec<u8>, MasterDbError>`
  — returns the fully-assembled plaintext SQLite buffer (ready for
  `rusqlite::Connection::deserialize`). Callers (future M7 wiring, out of
  scope here) open it themselves; this function does not return a
  `Connection` or run any SQL.
- Produces: `#[derive(Debug)] pub enum MasterDbError { Io(std::io::Error), InvalidHeader, HmacMismatch { page: u32 }, TooSmall }`
  with a `std::fmt::Display` + `std::error::Error` impl (no new error-handling
  dependency needed — a small manual enum is consistent with the rest of the
  crate's existing error types, e.g. `MasterDbError` mirrors the shape of
  errors already used elsewhere in `sift_lib` for IPC-adjacent code).

---

### Task 1: Commit the already-staged dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml` (already modified, uncommitted)
- Modify: `src-tauri/Cargo.lock` (already regenerated, uncommitted)

**Interfaces:**
- Produces: `pbkdf2`, `hmac`, `sha2`, `aes`, `cbc`, `flate2`, `base85` available
  as crates in `sift_lib`; `rusqlite` with `serialize` feature enabled.

- [ ] **Step 1: Verify the current diff is exactly the expected dependency additions**

Run: `git diff src-tauri/Cargo.toml`

Expected: only the 7 new dependency lines plus the `serialize` feature flag
added to `rusqlite`'s features list, nothing else.

- [ ] **Step 2: Build to confirm the lockfile is consistent**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`

Expected: builds successfully (first build of the new crates takes longer).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add pure-Rust SQLCipher crypto deps for master.db reader

pbkdf2/hmac/sha2/aes/cbc for page decryption, flate2/base85 for the
key-deobfuscation routine ported from pyrekordbox. rusqlite gains the
serialize feature to load the decrypted buffer via Connection::deserialize
without writing cleartext to disk."
```

---

### Task 2: Commit the fixture + this plan

**Files:**
- Create (already generated this session): `src-tauri/tests/fixtures/rekordbox-master-fixture.db`
- Create: `docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md` (this file)

**Interfaces:**
- Produces: a committed, synthetic, SQLCipher v4-encrypted fixture with a
  known plaintext oracle (values below), for use by all later tasks' tests.

**Oracle values baked into the fixture** (needed by Task 6's test — write
these down now since the fixture won't be regenerated):

`djmdContent` (table columns: `ID, Title, ArtistID, FolderPath, FileNameL, BPM, Length`):
```
("40000001", "Synthetic Test Track One",   "A1", "D:/FIXTURE/track1.mp3",  "track1.mp3",  128000, 240000)
("40000002", "Synthetic Test Track Two",   "A2", "D:/FIXTURE/track2.flac", "track2.flac", 120000, 300000)
("40000003", "Synthetic Test Track Three", "A1", "D:/FIXTURE/track3.wav",  "track3.wav",  140000, 200000)
```

`djmdPlaylist` (`ID, Name, ParentID, Attribute`):
```
("50000001", "Fixture Playlist A", NULL, 0)
("50000002", "Fixture Playlist B", NULL, 0)
```

`djmdSongPlaylist` (`ID, PlaylistID, ContentID, TrackNo`):
```
("60000001", "50000001", "40000001", 1)
("60000002", "50000001", "40000002", 2)
("60000003", "50000002", "40000003", 1)
```

The SQLCipher key is the standard obfuscated Rekordbox key (deobfuscated:
`402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497`), applied
via a plain `PRAGMA key = '<hex string>'` (not `x'...'` raw-hex form) — the
same convention `pyrekordbox` uses. This means the passphrase is processed by
PBKDF2 as literal UTF-8 text, not decoded as raw key bytes (see "Empirically
confirmed parameters" above).

- [ ] **Step 1: Confirm the fixture is present and untracked**

Run: `git status src-tauri/tests/fixtures/`

Expected: `src-tauri/tests/fixtures/rekordbox-master-fixture.db` listed as
untracked (new file). A second, unrelated file `rekordbox_master.db`
(underscore) may also appear from an earlier aborted attempt — leave it
alone, do not add or commit it.

- [ ] **Step 2: Commit fixture + this plan together**

```bash
git add src-tauri/tests/fixtures/rekordbox-master-fixture.db
git add docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md
git commit -m "test(rekordbox): add synthetic encrypted master.db fixture + reader plan

3 fake tracks, 2 fake playlists, no personal data. Generated via
sqlcipher3 (Python) using the same deobfuscated Rekordbox key Sift will
derive in Rust. Oracle values for the reader's test are documented in
the plan and in the test file added in a later task."
```

---

### Task 3: Key deobfuscation (base85 -> XOR -> zlib), with test

**Files:**
- Create: `src-tauri/src/rekordbox_masterdb.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod rekordbox_masterdb;` to the
  alphabetized `mod` list, right before `mod scanner;` and after `mod queue;`)

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces: private `fn deobfuscate_key() -> String` (returns the 64-hex-char
  passphrase string), private constants `BLOB: &[u8]` and `BLOB_KEY: &[u8]`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/rekordbox_masterdb.rs` with:

```rust
//! Pure-Rust, read-only SQLCipher v4 decryption for Rekordbox's `master.db`.
//! No writes, ever — this module only turns encrypted bytes into a plaintext
//! in-memory SQLite buffer for `rusqlite::Connection::deserialize`.

// Obfuscated key blob and XOR key, byte-identical to pyrekordbox's
// `pyrekordbox/db6/database.py::BLOB` and `pyrekordbox/utils.py::BLOB_KEY`.
// This is a public, static, non-secret constant (not a per-user credential) —
// documented in pyrekordbox's open-source code and cited in
// docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md.
const BLOB: &[u8] = b"PN_Pq^*N>(JYe*u^8;Yg76HuZ<mR13S?=>)b9;DpoTXV(6ItkU`}8*m6tx_I{Solh_N#dfe{v=";
const BLOB_KEY: &[u8] = b"657f48f84c437cc1";

// CPython's Lib/base64.py `_b85alphabet` (the git-diff/RFC-1924-adjacent
// base85 variant Python's stdlib uses), reproduced because pyrekordbox's
// `deobfuscate()` decodes with `base64.b85decode`.
const B85_ALPHABET: &[u8] =
    b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";

fn b85_decode(input: &[u8]) -> Vec<u8> {
    let mut table = [0u8; 256];
    for (i, &c) in B85_ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut chunks = input.chunks(5).peekable();
    while let Some(chunk) = chunks.next() {
        let is_last = chunks.peek().is_none();
        let pad = 5 - chunk.len();
        let mut buf = [b'~'; 5];
        buf[..chunk.len()].copy_from_slice(chunk);
        let mut acc: u32 = 0;
        for &c in &buf {
            acc = acc.wrapping_mul(85).wrapping_add(table[c as usize] as u32);
        }
        let bytes = acc.to_be_bytes();
        if is_last && pad > 0 {
            out.extend_from_slice(&bytes[..4 - pad]);
        } else {
            out.extend_from_slice(&bytes);
        }
    }
    out
}

/// Deobfuscates the static Rekordbox SQLCipher passphrase: base85-decode,
/// XOR with the repeating static key, zlib-decompress to get the 64-hex-char
/// passphrase string. Order matches pyrekordbox's `utils.py::deobfuscate()`
/// exactly (decode -> XOR -> decompress).
fn deobfuscate_key() -> String {
    let decoded = b85_decode(BLOB);
    let xored: Vec<u8> = decoded
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ BLOB_KEY[i % BLOB_KEY.len()])
        .collect();
    let mut decoder = flate2::read::ZlibDecoder::new(&xored[..]);
    let mut result = String::new();
    std::io::Read::read_to_string(&mut decoder, &mut result)
        .expect("zlib decompress of static key blob failed");
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deobfuscate_key_matches_known_pyrekordbox_value() {
        // This exact value was confirmed independently against the installed
        // pyrekordbox package's own deobfuscate(BLOB) in Python during this
        // session — see docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md.
        assert_eq!(
            deobfuscate_key(),
            "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497"
        );
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add to the alphabetized `mod` list:

```rust
mod queue;
pub mod rekordbox_masterdb;
mod scanner;
```

(`pub` is needed from the start because Task 6's integration test lives in
`src-tauri/tests/` and needs to reach `read_rekordbox_masterdb` through the
crate's public API — matching how `pub mod analysis;` is already exposed for
its own integration tests in `tests/characterization.rs`.)

- [ ] **Step 3: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml deobfuscate_key_matches_known_pyrekordbox_value`

Expected: `test rekordbox_masterdb::tests::deobfuscate_key_matches_known_pyrekordbox_value ... ok`.
(This is a straight port of logic already validated in this session's
throwaway spike, so it should pass immediately rather than needing a
red-green cycle — if it fails, compare byte-for-byte against
`pyrekordbox/db6/database.py::BLOB` and `pyrekordbox/utils.py::BLOB_KEY` in
the installed package before changing anything.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs src-tauri/src/lib.rs
git commit -m "feat(rekordbox): port pyrekordbox's static key deobfuscation to Rust

base85 -> XOR -> zlib, byte-identical constants (BLOB/BLOB_KEY) to
pyrekordbox's db6/database.py and utils.py. This is a public, non-secret
constant documented in pyrekordbox's open-source code, not a per-user
credential."
```

---

### Task 4: PBKDF2 key + HMAC-key derivation, with test

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`

**Interfaces:**
- Consumes: `deobfuscate_key() -> String` (Task 3).
- Produces:
  - `const PAGE_SIZE: usize = 4096;`
  - `const RESERVE_SIZE: usize = 80;` (16-byte IV + 64-byte HMAC-SHA512 tag)
  - `fn derive_keys(passphrase: &str, salt: &[u8; 16]) -> ([u8; 32], [u8; 32])`
    returning `(encryption_key, hmac_key)`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/rekordbox_masterdb.rs`, inside `mod tests`:

```rust
    #[test]
    fn derive_keys_produces_a_32_byte_pair() {
        // Salt doesn't need to come from the real fixture for this narrow
        // shape test — any 16 bytes exercise the derivation function.
        // Task 6's integration test is what proves these keys are *correct*
        // (via HMAC verification + a full row-level roundtrip against the
        // fixture).
        let salt = [0u8; 16];
        let passphrase = deobfuscate_key();
        let (enc_key, hmac_key) = derive_keys(&passphrase, &salt);
        assert_eq!(enc_key.len(), 32);
        assert_eq!(hmac_key.len(), 32);
        assert_ne!(enc_key, hmac_key, "encryption and HMAC keys must differ");
    }
```

- [ ] **Step 2: Run to verify it fails to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derive_keys_produces_a_32_byte_pair`

Expected: compile error, `cannot find function derive_keys`.

- [ ] **Step 3: Implement `derive_keys`**

Add to `src-tauri/src/rekordbox_masterdb.rs`, above `#[cfg(test)]`:

```rust
const PAGE_SIZE: usize = 4096;
const KDF_ITER: u32 = 256_000;
const HMAC_SALT_XOR: u8 = 0x3a;
const HMAC_KDF_ITER: u32 = 2;
/// IV (16 bytes) + HMAC-SHA512 tag (64 bytes), already a multiple of the
/// AES block size (16) so no extra rounding is needed. Confirmed empirically
/// against SQLCipher's `sqlcipher_codec_ctx_reserve_setup` (src/sqlcipher.c).
const RESERVE_SIZE: usize = 80;

/// Derives the AES-256 page-encryption key and the separate HMAC key,
/// matching SQLCipher v4's default KDF (PBKDF2-HMAC-SHA512, 256 000
/// iterations for the encryption key; same PRF but only 2 iterations and a
/// XOR-masked salt for the HMAC key). `passphrase` is fed in as its raw
/// UTF-8 bytes — SQLCipher treats a bare `PRAGMA key = '<string>'` value as
/// passphrase text run through PBKDF2, not as raw hex key material (that
/// second mode requires the explicit `x'...'` blob-literal syntax, which
/// Rekordbox/pyrekordbox do not use).
fn derive_keys(passphrase: &str, salt: &[u8; 16]) -> ([u8; 32], [u8; 32]) {
    let pass_bytes = passphrase.as_bytes();

    let mut enc_key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha512>(pass_bytes, salt, KDF_ITER, &mut enc_key);

    let hmac_salt: Vec<u8> = salt.iter().map(|b| b ^ HMAC_SALT_XOR).collect();
    let mut hmac_key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha512>(pass_bytes, &hmac_salt, HMAC_KDF_ITER, &mut hmac_key);

    (enc_key, hmac_key)
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derive_keys_produces_a_32_byte_pair`

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox): PBKDF2 key + HMAC-key derivation (SQLCipher v4 defaults)

256k iterations PBKDF2-HMAC-SHA512 for the AES-256 key, 2 iterations with
an XOR-masked salt for the HMAC key -- matches SQLCipher's
sqlcipher_cipher_ctx_key_derive. Parameters confirmed empirically against
a real sqlcipher3-encrypted fixture in this session, not assumed."
```

---

### Task 5: Per-page HMAC verification + AES-256-CBC decryption, with unit test

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`

**Interfaces:**
- Consumes: `derive_keys` (Task 4), `PAGE_SIZE`, `RESERVE_SIZE` (Task 4).
- Produces:
  - `#[derive(Debug)] pub enum MasterDbError { Io(std::io::Error), InvalidHeader, HmacMismatch { page: u32 }, TooSmall }`
    with `impl std::fmt::Display` and `impl std::error::Error`.
  - `fn decrypt_page(enc_key: &[u8; 32], hmac_key: &[u8; 32], pgno: u32, page: &[u8], is_page_one: bool) -> Result<Vec<u8>, MasterDbError>`
    — returns the page's decrypted content (length `PAGE_SIZE - RESERVE_SIZE`,
    minus an extra 16 bytes for page 1's salt prefix).

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block:

```rust
    #[test]
    fn decrypt_page_rejects_tampered_hmac() {
        let salt = [0u8; 16];
        let passphrase = deobfuscate_key();
        let (enc_key, hmac_key) = derive_keys(&passphrase, &salt);

        // An all-zero page-sized buffer will never satisfy a real HMAC check
        // (SQLCipher's all-zero-page short-read exemption only applies in
        // autovacuum mode, which this reader doesn't implement) -- this
        // proves the function fails closed on a bad tag rather than
        // returning zeroed/garbage plaintext silently.
        let bogus_page = vec![0u8; PAGE_SIZE];
        let result = decrypt_page(&enc_key, &hmac_key, 2, &bogus_page, false);
        assert!(matches!(result, Err(MasterDbError::HmacMismatch { page: 2 })));
    }
```

- [ ] **Step 2: Run to verify it fails to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml decrypt_page_rejects_tampered_hmac`

Expected: compile error, `cannot find function decrypt_page` / `cannot find type MasterDbError`.

- [ ] **Step 3: Implement `MasterDbError` and `decrypt_page`**

Add to `src-tauri/src/rekordbox_masterdb.rs`, above `#[cfg(test)]`:

```rust
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use sha2::Sha512;

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type HmacSha512 = Hmac<Sha512>;

#[derive(Debug)]
pub enum MasterDbError {
    Io(std::io::Error),
    InvalidHeader,
    HmacMismatch { page: u32 },
    TooSmall,
}

impl std::fmt::Display for MasterDbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MasterDbError::Io(e) => write!(f, "io error reading master.db: {e}"),
            MasterDbError::InvalidHeader => {
                write!(f, "decrypted page 1 does not start with the SQLite magic header")
            }
            MasterDbError::HmacMismatch { page } => {
                write!(f, "HMAC verification failed on page {page} (wrong key or corrupted/tampered file)")
            }
            MasterDbError::TooSmall => write!(f, "file is smaller than one page, not a valid master.db"),
        }
    }
}

impl std::error::Error for MasterDbError {}

impl From<std::io::Error> for MasterDbError {
    fn from(e: std::io::Error) -> Self {
        MasterDbError::Io(e)
    }
}

/// Verifies the page's HMAC tag, then decrypts its ciphertext content with
/// AES-256-CBC. `page` must be exactly `PAGE_SIZE` bytes. `is_page_one`
/// shifts the content start by 16 bytes (the on-disk KDF salt prefix, which
/// is plaintext and not part of the encrypted page content).
///
/// Fails closed: if the HMAC tag doesn't match, returns
/// `MasterDbError::HmacMismatch` and never returns decrypted bytes for that
/// page. This is a fail-fast tamper/wrong-key check, not a fallback.
fn decrypt_page(
    enc_key: &[u8; 32],
    hmac_key: &[u8; 32],
    pgno: u32,
    page: &[u8],
    is_page_one: bool,
) -> Result<Vec<u8>, MasterDbError> {
    let header_skip = if is_page_one { 16 } else { 0 };
    let content_size = PAGE_SIZE - header_skip - RESERVE_SIZE;

    let content = &page[header_skip..header_skip + content_size];
    let iv: [u8; 16] = page[header_skip + content_size..header_skip + content_size + 16]
        .try_into()
        .expect("slice is exactly 16 bytes");
    let stored_hmac = &page[header_skip + content_size + 16..header_skip + content_size + 16 + 64];

    // HMAC covers: ciphertext content + IV + little-endian page number.
    let mut mac = HmacSha512::new_from_slice(hmac_key).expect("HMAC accepts any key length");
    mac.update(content);
    mac.update(&iv);
    mac.update(&pgno.to_le_bytes());
    let computed = mac.finalize().into_bytes();

    if computed.as_slice() != stored_hmac {
        return Err(MasterDbError::HmacMismatch { page: pgno });
    }

    let mut buf = content.to_vec();
    let blocks = as_blocks_mut(&mut buf);
    Aes256CbcDec::new(enc_key.into(), &iv.into()).decrypt_blocks_mut(blocks);
    Ok(buf)
}

/// Reinterprets a byte buffer (length a multiple of 16) as AES blocks for
/// `decrypt_blocks_mut`, which operates on `&mut [GenericArray<u8, U16>]`.
fn as_blocks_mut(
    buf: &mut [u8],
) -> &mut [aes::cipher::generic_array::GenericArray<u8, aes::cipher::consts::U16>] {
    debug_assert_eq!(buf.len() % 16, 0, "buffer must be a whole number of AES blocks");
    let ptr = buf.as_mut_ptr()
        as *mut aes::cipher::generic_array::GenericArray<u8, aes::cipher::consts::U16>;
    let len = buf.len() / 16;
    // Safety: GenericArray<u8, U16> has the same layout as [u8; 16] (repr
    // transparent wrapper over a fixed-size array), buf's length is a
    // multiple of 16 for every caller in this module (content_size is always
    // PAGE_SIZE minus block-aligned constants), and the returned slice
    // borrows from `buf` for its whole lifetime (tied via the `&mut [u8]`
    // input lifetime), so it cannot outlive the backing buffer.
    unsafe { std::slice::from_raw_parts_mut(ptr, len) }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml decrypt_page_rejects_tampered_hmac`

Expected: `ok`.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 180 previously-passing tests still pass, same 2 pre-existing
unrelated failures, plus the new tests from Tasks 3-5 passing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox): per-page HMAC verification + AES-256-CBC decrypt

Fails closed on HMAC mismatch (MasterDbError::HmacMismatch) rather than
returning unverified plaintext -- a silent wrong-key/tampered-page bug
would otherwise surface as plausible-looking but corrupt metadata."
```

---

### Task 6: Public `read_rekordbox_masterdb`, integration test against the fixture

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs`
- Create: `src-tauri/tests/rekordbox_masterdb.rs`

**Interfaces:**
- Consumes: `decrypt_page`, `derive_keys`, `deobfuscate_key`, `PAGE_SIZE`,
  `RESERVE_SIZE`, `MasterDbError` (Tasks 3-5).
- Produces: `pub fn read_rekordbox_masterdb(path: &std::path::Path) -> Result<Vec<u8>, MasterDbError>`.

- [ ] **Step 1: Write the failing integration test**

Create `src-tauri/tests/rekordbox_masterdb.rs`:

```rust
//! Integration test: decrypt the committed synthetic fixture and verify its
//! rows against the oracle values documented in
//! docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md
//! (the same values used to generate the fixture via Python/sqlcipher3).
use sift_lib::rekordbox_masterdb::read_rekordbox_masterdb;
use std::path::Path;

#[test]
fn decrypts_fixture_and_matches_oracle_rows() {
    let path = Path::new("tests/fixtures/rekordbox-master-fixture.db");
    if !path.exists() {
        eprintln!("skip: fixture not present");
        return;
    }

    let plaintext = read_rekordbox_masterdb(path).expect("decrypt should succeed");

    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
    conn.deserialize(rusqlite::DatabaseName::Main, plaintext, false)
        .expect("deserialize decrypted buffer as SQLite db");

    let mut stmt = conn
        .prepare("SELECT ID, Title, FolderPath FROM djmdContent ORDER BY ID")
        .expect("prepare");
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("query_map")
        .collect::<Result<_, _>>()
        .expect("collect rows");

    assert_eq!(
        rows,
        vec![
            ("40000001".to_string(), "Synthetic Test Track One".to_string(), "D:/FIXTURE/track1.mp3".to_string()),
            ("40000002".to_string(), "Synthetic Test Track Two".to_string(), "D:/FIXTURE/track2.flac".to_string()),
            ("40000003".to_string(), "Synthetic Test Track Three".to_string(), "D:/FIXTURE/track3.wav".to_string()),
        ]
    );

    let mut pstmt = conn
        .prepare("SELECT ID, Name FROM djmdPlaylist ORDER BY ID")
        .expect("prepare playlists");
    let playlists: Vec<(String, String)> = pstmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .expect("query_map")
        .collect::<Result<_, _>>()
        .expect("collect playlists");
    assert_eq!(
        playlists,
        vec![
            ("50000001".to_string(), "Fixture Playlist A".to_string()),
            ("50000002".to_string(), "Fixture Playlist B".to_string()),
        ]
    );

    let mut sstmt = conn
        .prepare("SELECT ID, PlaylistID, ContentID, TrackNo FROM djmdSongPlaylist ORDER BY ID")
        .expect("prepare song-playlist links");
    let links: Vec<(String, String, String, i64)> = sstmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .expect("query_map")
        .collect::<Result<_, _>>()
        .expect("collect links");
    assert_eq!(
        links,
        vec![
            ("60000001".to_string(), "50000001".to_string(), "40000001".to_string(), 1),
            ("60000002".to_string(), "50000001".to_string(), "40000002".to_string(), 2),
            ("60000003".to_string(), "50000002".to_string(), "40000003".to_string(), 1),
        ]
    );
}

#[test]
fn rejects_missing_file() {
    let path = Path::new("tests/fixtures/does-not-exist.db");
    let result = read_rekordbox_masterdb(path);
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run to verify it fails to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test rekordbox_masterdb`

Expected: compile error, `cannot find function read_rekordbox_masterdb`.

- [ ] **Step 3: Implement `read_rekordbox_masterdb`**

Add to `src-tauri/src/rekordbox_masterdb.rs`, above `#[cfg(test)]`:

```rust
/// Reads and decrypts a Rekordbox `master.db` (SQLCipher v4) file, returning
/// a plaintext SQLite buffer suitable for `rusqlite::Connection::deserialize`.
/// Read-only: never writes anything, never touches the source file.
pub fn read_rekordbox_masterdb(path: &std::path::Path) -> Result<Vec<u8>, MasterDbError> {
    let data = std::fs::read(path)?;
    if data.len() < PAGE_SIZE {
        return Err(MasterDbError::TooSmall);
    }

    let salt: [u8; 16] = data[0..16].try_into().expect("checked length above");
    let passphrase = deobfuscate_key();
    let (enc_key, hmac_key) = derive_keys(&passphrase, &salt);

    let num_pages = data.len() / PAGE_SIZE;
    let mut out = Vec::with_capacity(data.len());

    for i in 0..num_pages {
        let pgno = (i + 1) as u32;
        let page = &data[i * PAGE_SIZE..(i + 1) * PAGE_SIZE];
        let is_page_one = pgno == 1;

        let decrypted_content = decrypt_page(&enc_key, &hmac_key, pgno, page, is_page_one)?;

        if is_page_one {
            out.extend_from_slice(b"SQLite format 3\x00");
        }
        out.extend_from_slice(&decrypted_content);
        // Reserve bytes (IV + HMAC) are kept as-is at the tail of each page.
        // SQLite's own page header records how many trailing bytes per page
        // are "usable space" reserved by the storage layer (a field the
        // btree implementation already respects for any nonzero reserve
        // size) — carrying the raw reserve bytes through unchanged keeps the
        // page exactly PAGE_SIZE bytes, matching what stock SQLite expects.
        let header_skip = if is_page_one { 16 } else { 0 };
        let content_size = PAGE_SIZE - header_skip - RESERVE_SIZE;
        let reserve_start = i * PAGE_SIZE + header_skip + content_size;
        out.extend_from_slice(&data[reserve_start..reserve_start + RESERVE_SIZE]);
    }

    if out.len() < 16 || &out[0..16] != b"SQLite format 3\x00" {
        return Err(MasterDbError::InvalidHeader);
    }

    Ok(out)
}
```

- [ ] **Step 4: Run the integration test, expect pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test rekordbox_masterdb -- --nocapture`

Expected: both tests pass.

If it fails: re-check the `RESERVE_SIZE`/`content_size` arithmetic against
"Empirically confirmed parameters" above — this exact page-assembly logic
was validated byte-for-byte against a Python oracle in this session before
this plan was written (full roundtrip: decrypt every page of a real
sqlcipher3-encrypted fixture in Python, reassemble, reopen with the stock
Python `sqlite3` module, read the actual rows back). A failure here most
likely means a transcription slip from that validation into this Rust code,
not a wrong hypothesis about the format.

- [ ] **Step 5: Run the full test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: same 180 pre-existing passes + 2 pre-existing unrelated failures,
plus all new tests from this plan passing. No new failures.

- [ ] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: clean. If clippy flags the `unsafe` block in `as_blocks_mut`,
address the specific lint it names rather than blanket-allowing unsafe code
warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs src-tauri/src/lib.rs src-tauri/tests/rekordbox_masterdb.rs
git commit -m "feat(rekordbox): public read_rekordbox_masterdb, integration test vs fixture

Decrypts every page (HMAC-verified, fail-closed), reassembles a
byte-valid plaintext SQLite buffer, confirmed via rusqlite::deserialize
against the committed synthetic fixture -- 3 tracks, 2 playlists, 3
playlist-song links, all matching the Python-side oracle values."
```

---

### Task 7: Update the design spec with confirmed parameters

**Files:**
- Modify: `docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Update the "Algorithme de déchiffrement" section**

In `docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md`,
replace the "à confirmer empiriquement" hedges in steps 2-3 (PBKDF2
iterations for the encryption key, HMAC-key iterations) with the confirmed
values (256000 for the encryption key, 2 for the HMAC key with `salt XOR
0x3a`), citing this plan
(`docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md`)
as where they were validated. Keep the "Risques connus" section as-is — the
reverse-engineering risk (Pioneer could change SQLCipher config in a future
Rekordbox version) remains real regardless of today's confirmation.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md
git commit -m "docs(specs): mark SQLCipher KDF params empirically confirmed

256k/2-iteration PBKDF2 split, page_size 4096, reserve 80 -- validated
against a real sqlcipher3-encrypted fixture, not assumed. See the reader
implementation plan for the validation method."
```

---

## Explicitly out of scope for this plan (do not implement)

- `RekordboxIndex` type, track/playlist domain parsing, IPC wiring — deferred
  per the design spec ("Bascule prévue après validation complète de ce
  lecteur, pas en même temps que M7").
- Any write path (`M8`, frozen).
- Testing against the user's real library — fixture-only. Manual validation
  against the real (copied) library from the earlier spike
  (`~/Desktop/sift-rekordbox-probe/`) is a separate, manual, follow-up step
  the user can run themselves before any M7 integration decision — not part
  of this plan's automated tests.
