//! Pure-Rust reader **and** Tier 1 write engine for Rekordbox's SQLCipher-encrypted
//! `master.db` (see `docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md`
//! for the reader, `docs/superpowers/specs/2026-07-06-m8-tier1-write-path-rust-design-v2.md`
//! for the write engine). Reads (`read_rekordbox_masterdb`) are always safe; the write
//! path (`repair_track_path`) is only ever reached through an explicit, user-confirmed
//! IPC call (`ipc_library::rekordbox_masterdb_apply_repairs`) and owns its own
//! guard/backup/verify/rollback safety chain — nothing here writes `master.db` as a side
//! effect of a read.
//!
//! # Approach
//!
//! Rather than reimplementing SQLite's on-disk B-tree format, this module only
//! decrypts each SQLCipher page to plaintext, reassembles a standard
//! (unencrypted) SQLite file buffer in memory, and hands that buffer to
//! `rusqlite` via [`rusqlite::Connection::deserialize_read_exact`] — the rest
//! (B-tree parsing, SQL queries) is then plain SQLite, already proven inside
//! Sift. The decrypted buffer is never written to disk.
//!
//! # SQLCipher v4 parameters (empirically confirmed, not assumed)
//!
//! Confirmed against a real `sqlcipher3` connection (`PRAGMA kdf_iter`,
//! `PRAGMA cipher_kdf_algorithm`, `PRAGMA cipher_hmac_algorithm`) and by a
//! full round-trip decrypt of a synthetic fixture (all pages HMAC-verified,
//! reconstructed buffer readable by stdlib SQLite):
//!
//! - Key derivation: PBKDF2-HMAC-SHA512, 256 000 iterations, 32-byte key.
//! - HMAC key derivation: PBKDF2-HMAC-SHA512, salt XORed with `0x3a`, 2
//!   iterations, 32-byte key.
//! - Page size: 4096 bytes. Reserve: 80 bytes (16-byte IV + 64-byte
//!   HMAC-SHA512 — already a multiple of the AES block size, no extra
//!   padding).
//! - Per-page HMAC covers `ciphertext || iv || page_number` (`page_number`
//!   as little-endian `u32`, 1-indexed), verified *before* decryption.
//! - Page 1 special case: the first 16 bytes on disk are the (unencrypted)
//!   salt; only `page_size - 16 - reserve` bytes of page 1 are ciphertext.
//!
//! Note: the SQLite magic string `"SQLite format 3\0"` lives in that
//! never-encrypted salt region, so it is *not* usable as a correctness
//! check (it "matches" even with a wrong key). Correctness here is
//! established by the per-page HMAC (fail-fast) plus the fact that the
//! reassembled buffer parses as a valid SQLite database.
//!
//! # Status
//!
//! Wired to IPC: `read_rekordbox_masterdb` (via `actions::detect_masterdb_repair_if_linked`,
//! read-only) and `repair_track_path` (via `ipc_library::rekordbox_masterdb_apply_repairs`,
//! the only write path). No UI screen consumes these commands yet (a separate,
//! later plan) — that's the only remaining "not yet" here.

use std::io::Cursor;
use std::path::Path;

use aes::Aes256;
use sysinfo::System;
use cbc::cipher::block_padding::NoPadding;
use cbc::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use flate2::read::ZlibDecoder;
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::Connection;
use sha2::Sha512;
use std::io::Read;

/// SQLCipher v4 default page size, confirmed via `PRAGMA cipher_page_size`.
const PAGE_SIZE: usize = 4096;
/// IV (16 bytes) + full HMAC-SHA512 digest (64 bytes); already AES-block-aligned.
const RESERVE: usize = 80;
/// SQLCipher v4 default KDF iteration count, confirmed via `PRAGMA kdf_iter`.
const KDF_ITER: u32 = 256_000;
/// SQLCipher v4 default HMAC-key derivation iteration count.
const HMAC_KDF_ITER: u32 = 2;
/// Byte XORed into the salt to derive the HMAC-key salt (SQLCipher convention).
const HMAC_SALT_XOR: u8 = 0x3a;
/// Salt occupies the first 16 bytes of the file (and of page 1 on disk).
const SALT_LEN: usize = 16;

/// `NoPadding` requires every AES-CBC input to be exactly block-aligned (16
/// bytes). The page-body lengths derived from these constants
/// (`PAGE_SIZE - RESERVE` for most pages, `PAGE_SIZE - RESERVE - SALT_LEN`
/// for page 1) are currently aligned only because `RESERVE`/`SALT_LEN`/
/// `PAGE_SIZE` all happen to be multiples of 16 — nothing else enforces
/// that. If a future edit to these constants broke it, `encrypt_masterdb`/
/// `decrypt_page_body` would fail unpredictably instead of failing here,
/// at compile time, with a clear reason.
const _: () = assert!(
    PAGE_SIZE % 16 == 0 && RESERVE % 16 == 0 && SALT_LEN % 16 == 0,
    "PAGE_SIZE/RESERVE/SALT_LEN must all be AES-block-aligned (16 bytes) for NoPadding CBC"
);

type Aes256CbcDec = cbc::Decryptor<Aes256>;
type Aes256CbcEnc = cbc::Encryptor<Aes256>;
type HmacSha512 = Hmac<Sha512>;

/// Deobfuscated Rekordbox `master.db` passphrase, base85(RFC1924)+XOR+zlib
/// obfuscated in Rekordbox's own source (mirrored from the public,
/// documented constants in `pyrekordbox`: `db6/database.py`'s `BLOB` and
/// `utils.py`'s `BLOB_KEY`). This is a static, publicly known constant, not a
/// per-installation secret.
const BLOB: &str = "PN_Pq^*N>(JYe*u^8;Yg76HuZ<mR13S?=>)b9;DpoTXV(6ItkU`}8*m6tx_I{Solh_N#dfe{v=";
const BLOB_KEY: &[u8] = b"657f48f84c437cc1";

/// Why reading `master.db` failed. Kept in the same style as other Sift
/// internal error enums (`FilingError`, `EncodeError`): `Debug + Clone +
/// PartialEq` + manual `Display`, converted to `String` at any future IPC
/// boundary rather than derived `Serialize` directly (no IPC command exists
/// for this module yet — that wiring is explicit out-of-scope for now).
#[derive(Debug, Clone, PartialEq)]
pub enum MasterDbError {
    /// Could not read the file from disk.
    Io(String),
    /// The file is smaller than one SQLCipher page — not a valid `master.db`.
    FileTooShort,
    /// The file's size is not an exact multiple of `PAGE_SIZE` — a truncated
    /// or partially-written file. Refuses to silently drop the trailing
    /// partial page (and whatever rows might live on it) via integer
    /// division.
    TruncatedFile {
        /// Total size on disk, in bytes.
        len: usize,
    },
    /// Deobfuscating the static passphrase constant failed (base85/zlib).
    KeyDeobfuscation(String),
    /// A page's HMAC did not match — refuses to trust its decrypted content.
    HmacMismatch {
        /// 1-indexed page number that failed verification.
        page: u32,
    },
    /// The reassembled plaintext buffer was rejected by SQLite itself.
    Sqlite(String),
    /// AES-CBC decryption itself failed (e.g. ciphertext not block-aligned).
    /// Distinct from `HmacMismatch`: this can only happen if the HMAC check
    /// already passed but the page geometry is still malformed — should not
    /// occur for the confirmed page size/reserve, kept as a fail-fast guard
    /// rather than a silent panic.
    Decrypt {
        /// 1-indexed page number that failed to decrypt.
        page: u32,
    },
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
    /// `dedup_playlist_group` was called with a group that has nothing to
    /// remove — the caller should have filtered this out via
    /// `detect_playlist_duplicates` first.
    #[allow(dead_code)]
    NoDuplicatesToRemove,
    /// A `djmdSongPlaylist.ID` from `PlaylistDuplicateGroup::remove` no
    /// longer matched any row at delete time (already removed by something
    /// else since detection ran).
    #[allow(dead_code)]
    SongPlaylistEntryNotFound {
        /// The `djmdSongPlaylist.ID` that was not found.
        song_playlist_id: String,
    },
}

impl std::fmt::Display for MasterDbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MasterDbError::Io(m) => write!(f, "io: {m}"),
            MasterDbError::FileTooShort => write!(f, "file too short to be a master.db"),
            MasterDbError::TruncatedFile { len } => write!(
                f,
                "file size ({len} bytes) is not a multiple of the {PAGE_SIZE}-byte page size — truncated or corrupted"
            ),
            MasterDbError::KeyDeobfuscation(m) => write!(f, "key deobfuscation: {m}"),
            MasterDbError::HmacMismatch { page } => {
                write!(f, "HMAC mismatch on page {page} — refusing to trust decrypted content")
            }
            MasterDbError::Sqlite(m) => write!(f, "sqlite: {m}"),
            MasterDbError::Decrypt { page } => write!(f, "AES-CBC decrypt failed on page {page}"),
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
            MasterDbError::NoDuplicatesToRemove => {
                write!(f, "dedup_playlist_group called with an empty remove list")
            }
            MasterDbError::SongPlaylistEntryNotFound { song_playlist_id } => {
                write!(f, "no djmdSongPlaylist row with ID {song_playlist_id}")
            }
        }
    }
}

impl std::error::Error for MasterDbError {}

/// One entry of the path→TrackID index read from `master.db`. Field names
/// match the `chemin → TrackID` index consumed by the M7 XML module
/// (`2026-07-03-m7-rekordbox-xml-export-design.md`) so the two sources are
/// interchangeable there — this module does not itself wire into that one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RekordboxTrack {
    /// Rekordbox `djmdContent.ID`.
    pub track_id: String,
    /// Rekordbox `djmdContent.FolderPath` (full file path as Rekordbox knows it).
    pub folder_path: String,
}

/// Path→TrackID index read from a Rekordbox `master.db`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RekordboxIndex {
    /// All tracks found in `djmdContent`.
    pub tracks: Vec<RekordboxTrack>,
}

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

/// One `djmdSongPlaylist` row involved in a duplicate group — either the
/// occurrence being kept or one being removed.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistDuplicateEntry {
    /// Rekordbox `djmdSongPlaylist.ID` of this row.
    pub song_playlist_id: String,
    /// Rekordbox `djmdSongPlaylist.TrackNo` of this row.
    pub track_no: i64,
}

/// A set of `djmdSongPlaylist` rows in the same playlist that reference the
/// same track more than once. `keep` is the occurrence with the lowest
/// `TrackNo` (kept untouched by `dedup_playlist_group`); `remove` is every
/// other occurrence.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistDuplicateGroup {
    /// Rekordbox `djmdPlaylist.ID` the duplicated entries belong to.
    pub playlist_id: String,
    /// Rekordbox `djmdContent.ID` that appears more than once in this playlist.
    pub content_id: String,
    /// The occurrence that survives (lowest `TrackNo`).
    pub keep: PlaylistDuplicateEntry,
    /// Every other occurrence — these are what `dedup_playlist_group` deletes.
    pub remove: Vec<PlaylistDuplicateEntry>,
}

/// Scans `djmdSongPlaylist` for `(PlaylistID, ContentID)` pairs that appear
/// more than once — the same track added twice (or more) to the same
/// playlist. Read-only, mirroring `read_rekordbox_masterdb`'s shape (decrypt
/// → deserialize → query, no write).
#[allow(dead_code)]
pub fn detect_playlist_duplicates(path: &Path) -> Result<Vec<PlaylistDuplicateGroup>, MasterDbError> {
    let raw = std::fs::read(path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT ID, PlaylistID, ContentID, TrackNo FROM djmdSongPlaylist ORDER BY PlaylistID, ContentID, TrackNo")
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut all = Vec::new();
    for row in rows {
        all.push(row.map_err(|e| MasterDbError::Sqlite(e.to_string()))?);
    }

    // Rows are sorted by (PlaylistID, ContentID, TrackNo), so duplicates of
    // the same (PlaylistID, ContentID) pair are always contiguous — a single
    // linear scan finds every group without a HashMap.
    let mut groups: Vec<PlaylistDuplicateGroup> = Vec::new();
    let mut i = 0;
    while i < all.len() {
        let (keep_id, playlist_id, content_id, keep_track_no) = &all[i];
        let mut j = i + 1;
        let mut remove = Vec::new();
        while j < all.len() && &all[j].1 == playlist_id && &all[j].2 == content_id {
            remove.push(PlaylistDuplicateEntry {
                song_playlist_id: all[j].0.clone(),
                track_no: all[j].3,
            });
            j += 1;
        }
        if !remove.is_empty() {
            groups.push(PlaylistDuplicateGroup {
                playlist_id: playlist_id.clone(),
                content_id: content_id.clone(),
                keep: PlaylistDuplicateEntry {
                    song_playlist_id: keep_id.clone(),
                    track_no: *keep_track_no,
                },
                remove,
            });
        }
        i = j;
    }
    Ok(groups)
}

/// Reverses Rekordbox's own obfuscation of the static `master.db` passphrase:
/// base85 (RFC1924 alphabet, same as CPython's `base64.b85decode`) decode →
/// XOR with the repeating key → zlib decompress → UTF-8. Order is the exact
/// inverse of `pyrekordbox.utils.obfuscate`.
fn deobfuscate_key() -> Result<String, MasterDbError> {
    let decoded = base85::decode(BLOB).map_err(|e| MasterDbError::KeyDeobfuscation(e.to_string()))?;
    let xored: Vec<u8> = decoded
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ BLOB_KEY[i % BLOB_KEY.len()])
        .collect();
    let mut decompressor = ZlibDecoder::new(Cursor::new(xored));
    let mut out = String::new();
    decompressor
        .read_to_string(&mut out)
        .map_err(|e| MasterDbError::KeyDeobfuscation(e.to_string()))?;
    Ok(out)
}

/// Derives the AES key and the separate HMAC key from the passphrase and the
/// file's salt, per SQLCipher v4's two-stage PBKDF2 scheme.
fn derive_keys(passphrase: &str, salt: &[u8; SALT_LEN]) -> ([u8; 32], [u8; 32]) {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha512>(passphrase.as_bytes(), salt, KDF_ITER, &mut key);

    let hmac_salt: Vec<u8> = salt.iter().map(|b| b ^ HMAC_SALT_XOR).collect();
    let mut hmac_key = [0u8; 32];
    pbkdf2_hmac::<Sha512>(&key, &hmac_salt, HMAC_KDF_ITER, &mut hmac_key);

    (key, hmac_key)
}

/// Verifies and decrypts a single SQLCipher page. `raw_page` is exactly
/// `PAGE_SIZE` bytes: for page 1, this is the *whole* on-disk page (salt
/// included) — the salt handling is done by the caller, this function only
/// verifies/decrypts the ciphertext + reserve region.
///
/// Returns the decrypted content, `PAGE_SIZE - RESERVE` bytes for pages
/// after the salt has been stripped by the caller.
fn decrypt_page_body(
    page_no: u32,
    ciphertext: &[u8],
    iv: &[u8; 16],
    stored_hmac: &[u8],
    key: &[u8; 32],
    hmac_key: &[u8; 32],
) -> Result<Vec<u8>, MasterDbError> {
    let mut mac = <HmacSha512 as Mac>::new_from_slice(hmac_key)
        .expect("HMAC-SHA512 accepts any key length");
    mac.update(ciphertext);
    mac.update(iv);
    mac.update(&page_no.to_le_bytes());
    mac.verify_slice(stored_hmac)
        .map_err(|_| MasterDbError::HmacMismatch { page: page_no })?;

    // SQLCipher pages carry no PKCS7 padding (the ciphertext region is
    // already a fixed, block-aligned size) — `NoPadding` just decrypts every
    // block in place without trying to strip/validate a padding tail.
    let decryptor = Aes256CbcDec::new(key.into(), iv.into());
    let plain = decryptor
        .decrypt_padded_vec_mut::<NoPadding>(ciphertext)
        .map_err(|_| MasterDbError::Decrypt { page: page_no })?;
    Ok(plain)
}

/// Decrypts the whole file into a plaintext SQLite buffer.
fn decrypt_masterdb(raw: &[u8]) -> Result<Vec<u8>, MasterDbError> {
    if raw.len() < PAGE_SIZE {
        return Err(MasterDbError::FileTooShort);
    }
    if raw.len() % PAGE_SIZE != 0 {
        // A partial trailing page would otherwise be silently dropped by the
        // integer division below — whatever rows live on it (e.g. tracks in
        // a large djmdContent B-tree) would vanish from the returned index
        // without any signal. Fail fast instead, consistent with this
        // module's strict HMAC verification elsewhere.
        return Err(MasterDbError::TruncatedFile { len: raw.len() });
    }
    let passphrase = deobfuscate_key()?;
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&raw[..SALT_LEN]);
    let (key, hmac_key) = derive_keys(&passphrase, &salt);

    let n_pages = raw.len() / PAGE_SIZE;
    let mut out = Vec::with_capacity(raw.len());

    for i in 0..n_pages {
        let page_no = (i + 1) as u32;
        let page = &raw[i * PAGE_SIZE..(i + 1) * PAGE_SIZE];

        let ciphertext_start = if page_no == 1 { SALT_LEN } else { 0 };
        let ciphertext = &page[ciphertext_start..PAGE_SIZE - RESERVE];
        let tail = &page[PAGE_SIZE - RESERVE..];
        let iv: [u8; 16] = tail[..16].try_into().expect("iv is 16 bytes");
        let stored_hmac = &tail[16..16 + 64];

        let mut plain = decrypt_page_body(page_no, ciphertext, &iv, stored_hmac, &key, &hmac_key)?;

        if page_no == 1 {
            // Bytes 18/19 of a standard SQLite header ("file format
            // write/read version") on a *real* Rekordbox master.db read 2/2
            // (WAL), and stay that way even once the companion `-wal`/`-shm`
            // files are gone after a clean Rekordbox shutdown (confirmed
            // empirically: closing Rekordbox removes `master.db-wal`/`-shm`
            // entirely, but master.db's own header byte is never rewritten
            // back to 1). `rusqlite`'s `deserialize_read_exact`/`sqlite3_deserialize`
            // path uses SQLite's in-memory "memdb" VFS, which has no real
            // file to open a `-wal` sidecar against — so a header that
            // claims WAL mode makes the *first* query against the
            // deserialized connection fail with `SQLITE_CANTOPEN` ("unable
            // to open database file"), even though `sqlite3_deserialize`
            // itself reports success. The small synthetic fixture used by
            // this module's other tests was generated fresh in rollback
            // mode (1/1), which is why this never showed up before testing
            // against a real copy (see `docs/plan-implementation.md`, M8
            // Tier 1 status). Forcing 1/1 here is safe for both reads and
            // writes: by the time Sift ever sees this buffer, any real WAL
            // content has already been checkpointed into the page data
            // itself (that's what "Rekordbox is closed" / "no `-wal` file
            // present" guarantees, enforced by `is_rekordbox_running` before
            // any write) — declaring rollback mode doesn't drop data, it
            // just stops SQLite expecting a WAL sidecar that doesn't apply
            // to an in-memory deserialize. On the write side
            // (`encrypt_masterdb`), this buffer is re-serialized from a
            // connection that was never put into WAL mode, so the
            // re-encrypted file legitimately is rollback-mode — Rekordbox
            // itself is free to switch it back to WAL on its next write.
            //
            // Byte 20 ("reserved space per page") must likewise read the
            // *true* reserve (RESERVE = 80), matching what real SQLCipher
            // pages always declare — verified against a genuine page 1
            // (manual PBKDF2+AES-CBC decrypt showed byte 20 = 80, not 0).
            // Declaring it truthfully costs nothing for reads (those
            // trailing bytes were never real SQLite content) and is
            // required for writes: if we declared 0, SQLite would believe
            // the full page is usable and could write real cell content
            // into the last RESERVE bytes, which the re-encryption path
            // (`encrypt_masterdb`) discards as padding — silently dropping
            // data.
            //
            // Offsets below are relative to `plain`, which excludes the
            // 16-byte magic prefix (added separately just below) — so file
            // offset 18 is `plain[2]`, file offset 20 is `plain[4]`.
            // Guarded rather than bare indexing: `plain` is HMAC-verified
            // but its length still depends on AES decrypting to the
            // expected size — a checked write turns any future geometry
            // mismatch into a clear error instead of a panic on malformed
            // input.
            if plain.len() < 5 {
                return Err(MasterDbError::Decrypt { page: page_no });
            }
            plain[2] = 1; // file offset 18: write_version
            plain[3] = 1; // file offset 19: read_version
            match plain.get_mut(4) {
                Some(b) => *b = RESERVE as u8,
                None => return Err(MasterDbError::Decrypt { page: page_no }),
            }
            out.extend_from_slice(b"SQLite format 3\0");
        }
        out.extend_from_slice(&plain);
        // Reassembled pages stay a fixed PAGE_SIZE; the trailing RESERVE
        // bytes are zero padding (the header at offset 20 declares the
        // true reserve, set above — this padding is never real content).
        out.extend(std::iter::repeat(0u8).take(RESERVE));
    }

    Ok(out)
}

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

        let encryptor = Aes256CbcEnc::new((&key).into(), (&iv).into());
        let ciphertext = encryptor.encrypt_padded_vec_mut::<NoPadding>(body);

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

#[cfg(test)]
pub(crate) fn decrypt_masterdb_for_test(raw: &[u8]) -> Vec<u8> {
    decrypt_masterdb(raw).expect("decrypt fixture for test setup")
}

#[cfg(test)]
pub(crate) fn encrypt_masterdb_for_test(plaintext: &[u8]) -> Vec<u8> {
    encrypt_masterdb(plaintext).expect("encrypt fixture for test setup")
}

/// Reads a Rekordbox `master.db` file and returns its path→TrackID index.
///
/// Read-only: no write path exists here (and none is planned — see M8,
/// frozen). The decrypted database is only ever held in memory
/// (`Connection::deserialize_read_exact`, read-only flag set); nothing is
/// written to disk.
///
/// # Errors
///
/// Fails fast on any HMAC mismatch (never returns unverified data), on I/O
/// errors, or if the reassembled buffer is rejected by SQLite.
pub fn read_rekordbox_masterdb(path: &Path) -> Result<RekordboxIndex, MasterDbError> {
    let raw = std::fs::read(path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT ID, FolderPath FROM djmdContent")
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RekordboxTrack {
                track_id: row.get(0)?,
                folder_path: row.get(1)?,
            })
        })
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut tracks = Vec::new();
    for row in rows {
        tracks.push(row.map_err(|e| MasterDbError::Sqlite(e.to_string()))?);
    }

    Ok(RekordboxIndex { tracks })
}

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

/// Copies `master.db` + `masterPlaylists6.xml` from `pioneer_dir` into
/// `backup_dir` (created if missing), then verifies the copied `master.db`
/// actually decrypts (full HMAC check on every page) before returning `Ok`
/// — a backup that can't be read back is worse than no backup, so this
/// fails fast rather than trusting a raw file copy blindly.
///
/// On any failure *after* `backup_dir` starts getting populated (XML copy
/// failing after `master.db` copied, or the readability check failing),
/// this removes whatever this call already copied into `backup_dir` before
/// returning the error — a partial or known-unreadable `master.db` left
/// behind under the fixed filename would otherwise look like a valid
/// backup to a later `restore_rekordbox_backup` call. Cleanup uses `.ok()`
/// so a failure to remove never masks the real error being returned.
pub(crate) fn backup_rekordbox_files(pioneer_dir: &Path, backup_dir: &Path) -> Result<(), MasterDbError> {
    std::fs::create_dir_all(backup_dir).map_err(|e| MasterDbError::Io(e.to_string()))?;

    let src_db = pioneer_dir.join("master.db");
    let dst_db = backup_dir.join("master.db");
    std::fs::copy(&src_db, &dst_db).map_err(|e| MasterDbError::Io(e.to_string()))?;

    let src_xml = pioneer_dir.join("masterPlaylists6.xml");
    let dst_xml = backup_dir.join("masterPlaylists6.xml");
    if let Err(e) = std::fs::copy(&src_xml, &dst_xml) {
        std::fs::remove_file(&dst_db).ok();
        return Err(MasterDbError::Io(e.to_string()));
    }

    // Verify the backup is actually readable before trusting it.
    if let Err(e) = read_rekordbox_masterdb(&dst_db) {
        std::fs::remove_file(&dst_db).ok();
        std::fs::remove_file(&dst_xml).ok();
        return Err(e);
    }
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

/// Repairs one track's `FolderPath`/`FileNameL`/`FileNameS` in a Rekordbox
/// `master.db`, bumping the global USN counter (`agentRegistry`) and the
/// row's own `rb_local_usn`/`updated_at`, per the M8 Tier 1 design
/// (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`).
///
/// Deliberately does **not** touch `masterPlaylists6.xml`. The M8 spike
/// found that a pure `FolderPath` change doesn't semantically require an
/// XML resync (design doc Tier 1 section), but the spike's own real-Rekordbox
/// acceptance test happened to run through `pyrekordbox`, which rewrites the
/// XML as a side effect of *any* `commit()` — so that spike proved
/// "XML-rewritten copies are accepted", not "leaving the XML untouched is
/// equally accepted". This function takes the documented-but-not-fully-proven
/// position that leaving it untouched is fine (no playlists are touched by
/// Tier 1) — flagged here so a future session doesn't mistake this for a
/// fully closed question.
///
/// Also deliberately does **not** touch `Analysed`/`AnalysisUpdated`/
/// `CueUpdated` (the M8 non-negotiable rule — metadata/path writes must
/// never look like an analysis change).
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
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, false)
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

    let plaintext2 = conn
        .serialize(rusqlite::MAIN_DB)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?
        .to_vec();
    let raw2 = encrypt_masterdb(&plaintext2)?;

    let tmp_path = pioneer_dir.join("master.db.sift-write-tmp");
    std::fs::write(&tmp_path, &raw2).map_err(|e| MasterDbError::Io(e.to_string()))?;
    if let Err(e) = std::fs::rename(&tmp_path, &db_path) {
        // The live master.db is untouched (rename never started), but don't
        // leave the temp file behind for a future glob/user to mistake for
        // something real.
        std::fs::remove_file(&tmp_path).ok();
        return Err(MasterDbError::Io(e.to_string()));
    }

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

/// Removes every extra occurrence in `group.remove` from `djmdSongPlaylist`,
/// keeping `group.keep` untouched, per the M8 Tier 2 design
/// (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`,
/// Tier 2 section). Bumps the global `agentRegistry` USN counter once per
/// deleted row — a deleted row has no `rb_local_usn` of its own to stamp,
/// unlike `repair_track_path`'s in-place `UPDATE`.
///
/// Deliberately does **not** touch `djmdPlaylist`, `masterPlaylists6.xml`,
/// or `TrackNo` on any surviving row (see this function's module-level scope
/// note).
///
/// Safety sequence: identical to `repair_track_path` — refuse if Rekordbox
/// is running → backup → decrypt → delete inside a transaction → re-encrypt
/// → atomic rename → round-trip verify via `detect_playlist_duplicates` →
/// on verification failure, automatically restore the backup.
#[allow(dead_code)]
pub fn dedup_playlist_group(
    pioneer_dir: &Path,
    backup_dir: &Path,
    group: &PlaylistDuplicateGroup,
) -> Result<(), MasterDbError> {
    if group.remove.is_empty() {
        return Err(MasterDbError::NoDuplicatesToRemove);
    }
    if is_rekordbox_running() {
        return Err(MasterDbError::RekordboxRunning);
    }

    let db_path = pioneer_dir.join("master.db");
    backup_rekordbox_files(pioneer_dir, backup_dir)?;

    let raw = std::fs::read(&db_path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, false)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.6f").to_string();
    let tx = conn.transaction().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    for entry in &group.remove {
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
                "DELETE FROM djmdSongPlaylist WHERE ID = ?1",
                rusqlite::params![entry.song_playlist_id],
            )
            .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
        if rows_changed != 1 {
            return Err(MasterDbError::SongPlaylistEntryNotFound {
                song_playlist_id: entry.song_playlist_id.clone(),
            });
        }
    }

    tx.commit().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let plaintext2 = conn
        .serialize(rusqlite::MAIN_DB)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?
        .to_vec();
    let raw2 = encrypt_masterdb(&plaintext2)?;

    let tmp_path = pioneer_dir.join("master.db.sift-write-tmp");
    std::fs::write(&tmp_path, &raw2).map_err(|e| MasterDbError::Io(e.to_string()))?;
    if let Err(e) = std::fs::rename(&tmp_path, &db_path) {
        std::fs::remove_file(&tmp_path).ok();
        return Err(MasterDbError::Io(e.to_string()));
    }

    match detect_playlist_duplicates(&db_path) {
        Ok(remaining) => {
            let still_duplicated = remaining
                .iter()
                .any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id);
            if still_duplicated {
                let msg = format!(
                    "playlist {} / content {} still has duplicates after dedup",
                    group.playlist_id, group.content_id
                );
                match restore_rekordbox_backup(pioneer_dir, backup_dir) {
                    Ok(()) => Err(MasterDbError::WriteVerificationFailedRolledBack(msg)),
                    Err(restore_err) => Err(MasterDbError::WriteVerificationFailedRollbackFailed(
                        format!("{msg}; rollback also failed: {restore_err}"),
                    )),
                }
            } else {
                Ok(())
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

// Fixture provenance: `tests/fixtures/rekordbox_master.db` is a synthetic
// SQLCipher v4 database (3 fake tracks, 1 fake playlist, 1 fake
// agentRegistry row, no personal data), generated by
// `scripts/make-rekordbox-fixture.py` — regenerate with
// `python scripts/make-rekordbox-fixture.py` only if the fixture's
// schema/data needs to change; never copy data from a real Rekordbox
// library into this file.
#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db");

    #[test]
    fn deobfuscate_key_matches_pyrekordbox_reference() {
        let key = deobfuscate_key().expect("deobfuscate");
        assert_eq!(
            key,
            "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497"
        );
    }

    #[test]
    fn reads_fixture_tracks() {
        let index = read_rekordbox_masterdb(Path::new(FIXTURE)).expect("read fixture");
        assert_eq!(index.tracks.len(), 3);
        let mut ids: Vec<&str> = index.tracks.iter().map(|t| t.track_id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["40000001", "40000002", "40000003"]);

        let track1 = index
            .tracks
            .iter()
            .find(|t| t.track_id == "40000001")
            .expect("track 40000001 present");
        assert_eq!(track1.folder_path, "D:/FIXTURE/track1.mp3");
    }

    #[test]
    fn rejects_truncated_file() {
        let err = decrypt_masterdb(&[0u8; 10]).unwrap_err();
        assert_eq!(err, MasterDbError::FileTooShort);
    }

    #[test]
    fn rejects_file_size_not_a_multiple_of_page_size() {
        let mut raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        // Fixture is an exact multiple of PAGE_SIZE (7 full pages); truncate
        // a few trailing bytes to simulate a partial last page (e.g.
        // interrupted copy / partial read over a network share).
        let truncated_len = raw.len() - 10;
        raw.truncate(truncated_len);
        let err = decrypt_masterdb(&raw).unwrap_err();
        assert_eq!(err, MasterDbError::TruncatedFile { len: truncated_len });
    }

    #[test]
    fn rejects_corrupted_page_hmac() {
        let mut raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        // Flip a byte inside page 1's ciphertext region (well past the
        // never-encrypted salt) to break its HMAC.
        raw[100] ^= 0xFF;
        let err = decrypt_masterdb(&raw).unwrap_err();
        assert_eq!(err, MasterDbError::HmacMismatch { page: 1 });
    }

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

    #[test]
    fn fixture_has_a_playlist_duplicate() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        let len = plaintext.len();
        conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
            .expect("deserialize fixture");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM djmdSongPlaylist WHERE PlaylistID = '50000001' AND ContentID = '40000001'",
                [],
                |row| row.get(0),
            )
            .expect("query djmdSongPlaylist");
        assert_eq!(count, 2, "fixture must have track 40000001 twice in playlist 50000001");
    }

    #[test]
    fn reconstructed_buffer_declares_true_reserve() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        // SQLite file header offset 20 = "reserved space per page".
        assert_eq!(plaintext[20], RESERVE as u8);
    }

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

    #[test]
    fn backup_cleans_up_after_verification_failure() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        // Both source files exist, so both copies into backup_dir succeed —
        // the failure happens only at the read_rekordbox_masterdb
        // verification step, after backup_dir is already populated.
        std::fs::write(pioneer_dir.join("master.db"), b"not a real database")
            .expect("write garbage master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let err = backup_rekordbox_files(&pioneer_dir, &backup_dir).unwrap_err();
        assert!(matches!(err, MasterDbError::FileTooShort));

        // The broken master.db copy must not be left behind under the fixed
        // filename — a later restore_rekordbox_backup call against this
        // backup_dir must not find anything to (wrongly) trust.
        assert!(!backup_dir.join("master.db").exists());
        assert!(!backup_dir.join("masterPlaylists6.xml").exists());
    }

    #[test]
    fn backup_cleans_up_after_xml_copy_failure() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");

        // master.db exists and is valid, but masterPlaylists6.xml is
        // deliberately missing — the master.db copy succeeds first, then
        // the XML copy fails.
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");

        let err = backup_rekordbox_files(&pioneer_dir, &backup_dir).unwrap_err();
        assert!(matches!(err, MasterDbError::Io(_)));

        // The master.db copy that succeeded before the XML failure must not
        // be left behind under the fixed filename.
        assert!(!backup_dir.join("master.db").exists());
    }

    #[test]
    fn detect_playlist_duplicates_finds_the_fixture_duplicate() {
        let groups = detect_playlist_duplicates(Path::new(FIXTURE)).expect("detect");
        assert_eq!(groups.len(), 1, "fixture has exactly one duplicate group");
        let g = &groups[0];
        assert_eq!(g.playlist_id, "50000001");
        assert_eq!(g.content_id, "40000001");
        assert_eq!(g.keep.song_playlist_id, "60000001");
        assert_eq!(g.keep.track_no, 1);
        assert_eq!(g.remove.len(), 1);
        assert_eq!(g.remove[0].song_playlist_id, "60000003");
        assert_eq!(g.remove[0].track_no, 3);
    }

    #[test]
    fn detect_playlist_duplicates_ignores_non_duplicated_entries() {
        let groups = detect_playlist_duplicates(Path::new(FIXTURE)).expect("detect");
        // Track 40000002 appears exactly once (TrackNo 2, playlist 50000001)
        // — must not show up as a group.
        assert!(!groups
            .iter()
            .any(|g| g.content_id == "40000002"));
    }

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

    #[test]
    fn repair_track_path_handles_long_path_forcing_page_growth() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let original_size = std::fs::metadata(pioneer_dir.join("master.db")).expect("stat before").len();

        // Well past SQLite's per-cell local-payload threshold (~page_size - 35
        // bytes) — this forces the updated row onto an overflow page, growing
        // the file past its original page count. Exercises encrypt_masterdb
        // on a plaintext buffer LARGER than what decrypt_masterdb produced
        // for this file, not just the fixture's original fixed geometry.
        let long_component = "a".repeat(8000);
        let long_path = format!("D:/FIXTURE/{long_component}/track1.mp3");
        let repair = PathRepair {
            track_id: "40000001".to_string(),
            new_folder_path: long_path.clone(),
            new_file_name_l: "track1.mp3".to_string(),
            new_file_name_s: "track1.mp3".to_string(),
        };
        repair_track_path(&pioneer_dir, &backup_dir, &repair).expect("repair path with long path");

        let new_size = std::fs::metadata(pioneer_dir.join("master.db")).expect("stat after").len();
        assert!(
            new_size > original_size,
            "expected the database to grow past its original {original_size} bytes to hold the long path (overflow page), got {new_size}"
        );

        let index = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread");
        let repaired = index
            .tracks
            .iter()
            .find(|t| t.track_id == "40000001")
            .expect("track 40000001 present");
        assert_eq!(repaired.folder_path, long_path);
        assert_eq!(index.tracks.len(), 3);
    }

    #[test]
    fn repair_track_path_handles_non_ascii_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let accented_path = "D:/Musique/Various Artistes/Beyoncé - Déjà vu (édit).mp3".to_string();
        let repair = PathRepair {
            track_id: "40000002".to_string(),
            new_folder_path: accented_path.clone(),
            new_file_name_l: "Beyoncé - Déjà vu (édit).mp3".to_string(),
            new_file_name_s: "Beyonce.mp3".to_string(),
        };
        repair_track_path(&pioneer_dir, &backup_dir, &repair)
            .expect("repair path with accented characters");

        let index = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread");
        let repaired = index
            .tracks
            .iter()
            .find(|t| t.track_id == "40000002")
            .expect("track 40000002 present");
        assert_eq!(repaired.folder_path, accented_path);
    }

    /// M8 Tier 1 real-data gate (`docs/plan-implementation.md:254-256`): the
    /// synthetic fixture above proves the write engine is correct against a
    /// *known-shape* database, but never against a real Rekordbox B-tree
    /// (real page fragmentation, real row count, real column content).
    /// This is the "test against a copy of a real master.db" step the M8
    /// status notes as still outstanding before any real usage.
    ///
    /// `#[ignore]`d because it needs an out-of-repo copy that doesn't exist
    /// in CI or a fresh checkout. Run manually:
    /// `SIFT_M8_REAL_COPY_DIR=<path to a folder containing a COPY of
    /// master.db + masterPlaylists6.xml, never the live Pioneer folder>
    /// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
    /// real_masterdb_copy --nocapture`
    ///
    /// Requires Rekordbox closed (the function's own safety gate refuses
    /// otherwise, which is itself part of what this test proves).
    #[test]
    #[ignore]
    fn repair_track_path_round_trips_on_real_masterdb_copy() {
        let pioneer_dir = std::path::PathBuf::from(
            std::env::var("SIFT_M8_REAL_COPY_DIR")
                .expect("set SIFT_M8_REAL_COPY_DIR to a folder holding a COPY of master.db + masterPlaylists6.xml"),
        );
        assert!(
            pioneer_dir.join("master.db").exists(),
            "no master.db under SIFT_M8_REAL_COPY_DIR"
        );

        let tmp = tempfile::tempdir().expect("tempdir");
        let backup_dir = tmp.path().join("backup");

        let xml_before = std::fs::read(pioneer_dir.join("masterPlaylists6.xml")).expect("read xml before");

        let baseline = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("read real copy");
        let track_count_before = baseline.tracks.len();
        assert!(track_count_before > 0, "real copy has no tracks — wrong file?");
        let target = baseline.tracks.first().expect("at least one track").clone();

        // RekordboxTrack only carries FolderPath — fetch the real
        // FileNameL/FileNameS for this row directly so the restore step at
        // the end writes back the exact original values, not a guess.
        let raw = std::fs::read(pioneer_dir.join("master.db")).expect("read real copy bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt real copy");
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        let len = plaintext.len();
        conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
            .expect("deserialize real copy");
        let (orig_file_name_l, orig_file_name_s): (String, String) = conn
            .query_row(
                "SELECT FileNameL, FileNameS FROM djmdContent WHERE ID = ?1",
                rusqlite::params![target.track_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("original FileNameL/FileNameS for target track");
        drop(conn);

        println!(
            "baseline: {track_count_before} tracks; repairing track_id={} original_path={}",
            target.track_id, target.folder_path
        );

        let test_path = format!("D:/SIFT_M8_TIER1_REALDATA_TEST/{}.flac", target.track_id);
        let repair = PathRepair {
            track_id: target.track_id.clone(),
            new_folder_path: test_path.clone(),
            new_file_name_l: format!("{}.flac", target.track_id),
            new_file_name_s: format!("{}.flac", target.track_id),
        };
        repair_track_path(&pioneer_dir, &backup_dir, &repair).expect("repair on real copy");

        let after_repair = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread after repair");
        assert_eq!(
            after_repair.tracks.len(),
            track_count_before,
            "track count changed — repair must not add/remove rows"
        );
        let repaired = after_repair
            .tracks
            .iter()
            .find(|t| t.track_id == target.track_id)
            .expect("repaired track still present");
        assert_eq!(repaired.folder_path, test_path);

        // Tier 1 deliberately never touches the XML (see repair_track_path's
        // doc comment) — assert that holds on real data too.
        let xml_after = std::fs::read(pioneer_dir.join("masterPlaylists6.xml")).expect("read xml after");
        assert_eq!(xml_before, xml_after, "masterPlaylists6.xml must be untouched by Tier 1");

        // Restore the original path so the copy stays reusable for a rerun,
        // and to prove a second real-data write round-trips too.
        let restore = PathRepair {
            track_id: target.track_id.clone(),
            new_folder_path: target.folder_path.clone(),
            new_file_name_l: orig_file_name_l,
            new_file_name_s: orig_file_name_s,
        };
        repair_track_path(&pioneer_dir, &backup_dir, &restore).expect("restore original path on real copy");

        let after_restore = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread after restore");
        let restored = after_restore
            .tracks
            .iter()
            .find(|t| t.track_id == target.track_id)
            .expect("restored track still present");
        assert_eq!(restored.folder_path, target.folder_path);
        assert_eq!(after_restore.tracks.len(), track_count_before);

        println!("PASS: repair + restore round-tripped cleanly on real master.db copy ({track_count_before} tracks)");
    }

    /// M8 Tier 2 real-data gate, same rationale as Tier 1's
    /// `repair_track_path_round_trips_on_real_masterdb_copy` — a synthetic
    /// fixture proves the engine's SQL is correct, not that it survives a
    /// real Rekordbox B-tree. Unlike Tier 1's test, this one does not
    /// restore the original state afterward: the real copy conveniently
    /// already has a genuine pre-existing duplicate (see
    /// `docs/ressources-externes.md`, Évaluation 18, the "Suivi même jour"
    /// paragraph appended to that section), and cleaning it up is a
    /// harmless, disposable side effect on a throwaway copy, never the
    /// live file.
    ///
    /// `#[ignore]`d for the same reason as Tier 1's — needs
    /// `SIFT_M8_REAL_COPY_DIR` and Rekordbox closed, not runnable in CI.
    #[test]
    #[ignore]
    fn dedup_playlist_group_round_trips_on_real_masterdb_copy() {
        let pioneer_dir = std::path::PathBuf::from(
            std::env::var("SIFT_M8_REAL_COPY_DIR")
                .expect("set SIFT_M8_REAL_COPY_DIR to a folder holding a COPY of master.db + masterPlaylists6.xml"),
        );
        let tmp = tempfile::tempdir().expect("tempdir");
        let backup_dir = tmp.path().join("backup");

        let groups = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect on real copy");
        assert!(!groups.is_empty(), "expected at least one real duplicate group to dedup");
        let group = groups[0].clone();
        println!(
            "deduping playlist={} content={} keep={} remove={:?}",
            group.playlist_id,
            group.content_id,
            group.keep.song_playlist_id,
            group.remove.iter().map(|e| &e.song_playlist_id).collect::<Vec<_>>()
        );

        dedup_playlist_group(&pioneer_dir, &backup_dir, &group).expect("dedup on real copy");

        let after = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect after");
        assert!(
            !after.iter().any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id),
            "duplicate group must be gone after dedup"
        );

        println!("PASS: deduped 1 real playlist duplicate group on a real master.db copy");
    }

    #[test]
    fn dedup_playlist_group_removes_extra_entries_and_bumps_usn() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let groups = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect");
        assert_eq!(groups.len(), 1);
        let group = groups[0].clone();

        dedup_playlist_group(&pioneer_dir, &backup_dir, &group).expect("dedup");

        // No more duplicates for this (playlist, content) pair.
        let after = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect after");
        assert!(!after
            .iter()
            .any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id));

        // The kept row is still there, untouched.
        let index = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread");
        assert_eq!(index.tracks.len(), 3, "djmdContent must be untouched by a playlist dedup");

        // Backup exists and matches the original fixture.
        let backed_up = std::fs::read(backup_dir.join("master.db")).expect("read backup");
        let original = std::fs::read(FIXTURE).expect("read fixture");
        assert_eq!(backed_up, original);
    }

    #[test]
    fn dedup_playlist_group_rejects_empty_remove_list() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let empty_group = PlaylistDuplicateGroup {
            playlist_id: "50000001".to_string(),
            content_id: "40000002".to_string(),
            keep: PlaylistDuplicateEntry { song_playlist_id: "60000002".to_string(), track_no: 2 },
            remove: vec![],
        };
        let err = dedup_playlist_group(&pioneer_dir, &backup_dir, &empty_group).unwrap_err();
        assert_eq!(err, MasterDbError::NoDuplicatesToRemove);
    }

    #[test]
    fn dedup_playlist_group_rejects_unknown_song_playlist_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let bogus_group = PlaylistDuplicateGroup {
            playlist_id: "50000001".to_string(),
            content_id: "40000001".to_string(),
            keep: PlaylistDuplicateEntry { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntry {
                song_playlist_id: "99999999".to_string(),
                track_no: 9,
            }],
        };
        let err = dedup_playlist_group(&pioneer_dir, &backup_dir, &bogus_group).unwrap_err();
        assert_eq!(
            err,
            MasterDbError::SongPlaylistEntryNotFound { song_playlist_id: "99999999".to_string() }
        );
    }
}
