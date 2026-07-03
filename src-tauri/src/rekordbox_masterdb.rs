//! Read-only, pure-Rust reader for Rekordbox's SQLCipher-encrypted `master.db`.
//!
//! Exploratory module, separate from M7 (see
//! `docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md`).
//! No write path exists or is planned here — writing `master.db` stays frozen (M8).
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
//! Not yet wired to any IPC command or other module — deliberately
//! out-of-scope for this chantier (see the design doc's "Intégration"
//! section). `#[allow(dead_code)]` below is intentional: everything here is
//! exercised by this module's own tests, just not yet called from the rest
//! of the app.

#![allow(dead_code)]

use std::io::Cursor;
use std::path::Path;

use aes::Aes256;
use cbc::cipher::block_padding::NoPadding;
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use flate2::read::ZlibDecoder;
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
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

type Aes256CbcDec = cbc::Decryptor<Aes256>;
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
}

impl std::fmt::Display for MasterDbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MasterDbError::Io(m) => write!(f, "io: {m}"),
            MasterDbError::FileTooShort => write!(f, "file too short to be a master.db"),
            MasterDbError::KeyDeobfuscation(m) => write!(f, "key deobfuscation: {m}"),
            MasterDbError::HmacMismatch { page } => {
                write!(f, "HMAC mismatch on page {page} — refusing to trust decrypted content")
            }
            MasterDbError::Sqlite(m) => write!(f, "sqlite: {m}"),
            MasterDbError::Decrypt { page } => write!(f, "AES-CBC decrypt failed on page {page}"),
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
            // Byte 20 of a standard SQLite header ("reserved space per
            // page") must read 0 here: our reconstructed buffer declares
            // full-size, no-reserve pages (the reserve bytes below are
            // stripped from every page's usable content and replaced with
            // zero padding instead, keeping all pages a fixed PAGE_SIZE).
            plain[4] = 0; // offset 4 within `plain`, i.e. file offset 20 (16-byte magic prefix + 4)
            out.extend_from_slice(b"SQLite format 3\0");
        }
        out.extend_from_slice(&plain);
        // Reassembled pages must stay a fixed PAGE_SIZE (no on-disk reserve
        // region anymore — the plaintext file declares reserve=0).
        out.extend(std::iter::repeat(0u8).take(RESERVE));
    }

    Ok(out)
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

// Fixture provenance: `tests/fixtures/rekordbox_master.db` is a synthetic
// SQLCipher v4 database (3 fake tracks, 1 fake playlist, no personal data),
// generated once via Python + `sqlcipher3-wheels` (already a project
// dependency of `pyrekordbox`, used purely as the reference oracle):
//
//   from sqlcipher3 import dbapi2 as sqlite3
//   from pyrekordbox.utils import deobfuscate
//   from pyrekordbox.db6.database import BLOB
//   key = deobfuscate(BLOB)
//   conn = sqlite3.connect("rekordbox_master.db")
//   conn.execute(f"PRAGMA key = '{key}'")
//   conn.execute("PRAGMA cipher_compatibility = 4")
//   # ... create djmdContent/djmdPlaylist/djmdSongPlaylist, insert fake rows ...
//
// Regenerate only if the fixture's schema/data needs to change; never copy
// data from a real Rekordbox library into this file.
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
    fn rejects_corrupted_page_hmac() {
        let mut raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        // Flip a byte inside page 1's ciphertext region (well past the
        // never-encrypted salt) to break its HMAC.
        raw[100] ^= 0xFF;
        let err = decrypt_masterdb(&raw).unwrap_err();
        assert_eq!(err, MasterDbError::HmacMismatch { page: 1 });
    }
}
