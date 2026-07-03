//! Removable-drive USB formatting utility (M7). Two platform backends behind a shared trait
//! (`usb_format::windows`, `usb_format::macos`), never a `cfg!(windows)` branch inside one
//! function — the macOS path cannot be exercised here (no Mac available), so isolating it
//! behind its own file/impl keeps the blast radius of an untested path to one file.
//!
//! Conservative-by-design: any backend that cannot positively confirm a disk is removable
//! must exclude it from `list()` rather than include it. Never show an internal disk, even
//! by a detection bug — see `is_confidently_removable` in each backend and its tests.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
pub mod windows;

// NOT OS-gated at the module level (unlike `windows` above): the macOS backend's pure
// parsing/filter functions must compile and run under `cargo test` on any OS, including this
// Windows dev machine, so they're actually verified without access to a Mac. Only the
// `RemovableDriveBackend` impl inside `macos.rs` (which shells out to `diskutil`) is gated
// `#[cfg(target_os = "macos")]` — see that file's module doc.
pub mod macos;

/// A drive Sift considers safe to offer for formatting: passed the conservative removable
/// filter. `volume_serial` is the anti-race identity anchor — re-checked immediately before
/// formatting (see `verify_identity_unchanged`) in case a drive letter/id was reassigned
/// between listing and confirmation.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RemovableDrive {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub current_fs: String,
    pub volume_serial: String,
}

/// Target filesystem for formatting. FAT32 is the default (spec: bypasses the Windows GUI's
/// 32 GB `format.com` ceiling). exFAT is a secondary, explicit-only choice (CDJ compatibility
/// warning lives in the frontend modal, not here).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetFs {
    Fat32,
    ExFat,
}

/// Why listing or formatting could not complete. Stable string tags (mirrors the
/// `FilingError`/`"RAIL_MISMATCH"` convention) so the frontend can pattern-match distinctly.
#[derive(Debug, Clone, PartialEq)]
pub enum UsbFormatError {
    /// The drive last seen at this id/serial is no longer present at format time.
    DriveVanished,
    /// The anti-race check: the volume serial at format time doesn't match what was listed.
    IdentityMismatch,
    /// Backend-specific enumeration failure (WMI/diskutil call failed, unparseable output).
    Enumeration(String),
    /// Backend-specific format failure (diskpart/diskutil exited non-zero or errored).
    Format(String),
}

impl std::fmt::Display for UsbFormatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsbFormatError::DriveVanished => write!(f, "DRIVE_VANISHED"),
            UsbFormatError::IdentityMismatch => write!(f, "IDENTITY_MISMATCH"),
            UsbFormatError::Enumeration(m) => write!(f, "enumeration: {m}"),
            UsbFormatError::Format(m) => write!(f, "format: {m}"),
        }
    }
}

/// Per-OS enumeration + formatting. Two impls (`windows::WindowsBackend`,
/// `macos::MacBackend`), never a mixed `cfg!` branch inside one function.
pub trait RemovableDriveBackend {
    fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError>;
    fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError>;
}

/// Anti-race guard: re-resolve `drive` by volume serial from a **fresh** listing (`fresh`,
/// passed in by the caller right before formatting) and fail explicitly if it's gone or its
/// serial changed — never fall back to "the id still matches, must be the same drive".
pub fn verify_identity_unchanged(
    drive: &RemovableDrive,
    fresh: &[RemovableDrive],
) -> Result<(), UsbFormatError> {
    match fresh.iter().find(|d| d.id == drive.id) {
        None => Err(UsbFormatError::DriveVanished),
        Some(d) if d.volume_serial != drive.volume_serial => Err(UsbFormatError::IdentityMismatch),
        Some(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(id: &str, serial: &str) -> RemovableDrive {
        RemovableDrive {
            id: id.to_string(),
            label: "TEST".to_string(),
            size_bytes: 8_000_000_000,
            current_fs: "FAT32".to_string(),
            volume_serial: serial.to_string(),
        }
    }

    #[test]
    fn verify_identity_unchanged_ok_when_serial_matches() {
        let d = drive("E:", "AAAA-1111");
        let fresh = vec![drive("E:", "AAAA-1111")];
        assert_eq!(verify_identity_unchanged(&d, &fresh), Ok(()));
    }

    #[test]
    fn verify_identity_unchanged_fails_when_serial_changed() {
        let d = drive("E:", "AAAA-1111");
        let fresh = vec![drive("E:", "BBBB-2222")]; // same letter, different key was plugged in
        assert_eq!(
            verify_identity_unchanged(&d, &fresh),
            Err(UsbFormatError::IdentityMismatch)
        );
    }

    #[test]
    fn verify_identity_unchanged_fails_when_drive_vanished() {
        let d = drive("E:", "AAAA-1111");
        let fresh: Vec<RemovableDrive> = vec![];
        assert_eq!(
            verify_identity_unchanged(&d, &fresh),
            Err(UsbFormatError::DriveVanished)
        );
    }
}
