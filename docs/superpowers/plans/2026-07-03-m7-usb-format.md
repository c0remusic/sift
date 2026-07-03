# M7 — Formater la clé USB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Formater une clé USB" utility (Windows + macOS) to Sift's Réglages screen: list removable drives only, format to FAT32 (default) or exFAT (explicit secondary choice with inline CDJ warning), guarded by an in-app two-step confirmation modal requiring the user to type the drive letter/name, and by a pre-format identity re-check on volume serial number.

**Architecture:** New backend module `src-tauri/src/usb_format/` with a `RemovableDriveBackend` trait and two platform implementations (`windows.rs` via the `wmi` crate + `diskpart`, `macos.rs` via `diskutil list -plist` + `diskutil eraseDisk`), each gated by `#[cfg(target_os = ...)]`. Pure, OS-independent filtering/re-check logic lives in `usb_format/mod.rs` so it can be unit-tested on Windows without a Mac. Two new IPC commands (`list_removable_drives`, `format_drive`) in a new `ipc_usb.rs`. Frontend: a 4th card ("Formater une clé USB") in the existing `renderReglagesLive()` settings page (`frontend/sift-live.ts`), plus a new in-app confirmation modal module `frontend/usb-format-modal.ts` reusing the `.sift-report-overlay`/`.sift-report-overlay-card` CSS pattern — never `window.confirm()`.

**Tech Stack:** Rust (Tauri v2 backend), crate `wmi` 0.18 (Windows WMI queries), `std::process::Command` (diskpart / diskutil), vanilla TypeScript frontend, existing `ipc.ts` wrapper convention.

## Global Constraints

- Scope is exactly `docs/superpowers/specs/2026-07-03-m7-usb-format-design.md` — FAT32 default, exFAT secondary with inline warning, amovible-only (conservative filter, any doubt → exclude), double in-app confirmation, anti-race re-check on volume serial before format, no post-format content verification, no other filesystems.
- MSRV 1.77.2. No `thiserror` — manual `Display` impl + `From<...>` conversions, matching `FilingError`/`RevertError`/`EncodeError` in this repo.
- Never `window.confirm()`/`alert()`/`prompt()` as a destructive-action guard (hard project rule, real past incident — see CLAUDE.md).
- Fail-fast, no silent fallback (`error-handling-patterns` skill). No `.unwrap()`/`.expect()` on data from the OS or external processes (`rust-best-practices` skill).
- `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` must stay green after every task. `npx tsc --noEmit` must stay clean after every frontend task.
- No automated test of real formatting — that step is manual, by a human, on a real USB key, before merge. The agent never runs an actual format command.
- Small commits, one task = one commit (or a small number of tightly related commits), verified before moving to the next task.

---

### Task 1: `UsbFormatError` + `RemovableDrive`/`TargetFs` types + `RemovableDriveBackend` trait (no OS code yet)

**Files:**
- Create: `src-tauri/src/usb_format/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod usb_format;` near the other `pub mod` declarations)

**Interfaces:**
- Produces: `pub struct RemovableDrive { pub id: String, pub label: String, pub size_bytes: u64, pub current_fs: String, pub volume_serial: String }` (all `Clone, Debug, PartialEq, serde::Serialize`).
- Produces: `pub enum TargetFs { Fat32, ExFat }` (`Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize`).
- Produces: `pub enum UsbFormatError { NotRemovable, DriveVanished, IdentityMismatch, Enumeration(String), Format(String) }` with `Display` impl and stable string tags mirroring the `FilingError` convention (`"NOT_REMOVABLE"`, `"DRIVE_VANISHED"`, `"IDENTITY_MISMATCH"`, `Format(m)` → `format: {m}`, `Enumeration(m)` → `enumeration: {m}`).
- Produces: `pub trait RemovableDriveBackend { fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError>; fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError>; }`.
- Consumes: nothing (first task).

- [ ] **Step 1: Write `src-tauri/src/usb_format/mod.rs` with the types, trait, and error enum**

```rust
//! Removable-drive USB formatting utility (M7). Two platform backends behind a shared trait
//! (`usb_format::windows`, `usb_format::macos`), never a `cfg!(windows)` branch inside one
//! function — the macOS path cannot be exercised here (no Mac available), so isolating it
//! behind its own file/impl keeps the blast radius of an untested path to one file.
//!
//! Conservative-by-design: any backend that cannot positively confirm a disk is removable
//! must exclude it from `list()` rather than include it. Never show an internal disk, even
//! by a detection bug — see `is_confidently_removable` and its tests below.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "macos")]
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
    /// A drive was requested for formatting but isn't (or is no longer) confidently removable.
    NotRemovable,
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
            UsbFormatError::NotRemovable => write!(f, "NOT_REMOVABLE"),
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
```

- [ ] **Step 2: Register the module in `src-tauri/src/lib.rs`**

Find the existing `pub mod` block (alongside `pub mod filing;`, `pub mod dedup;`, etc.) and add:

```rust
pub mod usb_format;
```

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usb_format`
Expected: 3 tests pass (`verify_identity_unchanged_ok_when_serial_matches`, `..._fails_when_serial_changed`, `..._fails_when_drive_vanished`).

- [ ] **Step 4: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/usb_format/mod.rs src-tauri/src/lib.rs
git commit -m "feat(usb-format): add UsbFormatError/RemovableDrive types and anti-race identity check"
```

---

### Task 2: Windows backend — pure filter logic + `WindowsBackend` skeleton (list only, no format yet)

**Files:**
- Create: `src-tauri/src/usb_format/windows.rs`
- Modify: `src-tauri/src/usb_format/mod.rs` (nothing further needed — module already declared in Task 1)
- Modify: `src-tauri/Cargo.toml` (add `wmi` dependency)

**Interfaces:**
- Consumes: `RemovableDrive`, `UsbFormatError`, `RemovableDriveBackend` from `crate::usb_format`.
- Produces: `pub struct WindowsBackend;` implementing `RemovableDriveBackend::list` (format stubbed with `todo!()`-free explicit `Err` for now — filled in Task 3). Produces a pure, OS-independent-signature function `pub(crate) fn is_confidently_removable(disk: &RawDiskInfo) -> bool` and a `pub(crate) struct RawDiskInfo { media_type: Option<String>, interface_type: Option<String> }` so the filter can be unit-tested with fabricated data (no real WMI call in tests).

- [ ] **Step 1: Add the `wmi` dependency**

Edit `src-tauri/Cargo.toml`, in `[dependencies]` after the `ureq` line:

```toml
wmi = "0.18"
```

Run: `cargo build --manifest-path src-tauri/Cargo.toml` (Windows-only build; confirms the crate resolves and compiles for this target — it's a Windows-only crate, gated by our own `#[cfg(target_os = "windows")]` on the module, but our dev machine is Windows so this validates it now).
Expected: builds cleanly (may take a minute for a new dependency).

- [ ] **Step 2: Write the failing test for the pure filter function**

Add to the bottom of a new `src-tauri/src/usb_format/windows.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removable_media_type_and_interface_is_included() {
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: Some("USB".to_string()),
        };
        assert!(is_confidently_removable(&disk));
    }

    #[test]
    fn fixed_media_is_excluded() {
        let disk = RawDiskInfo {
            media_type: Some("Fixed hard disk".to_string()),
            interface_type: Some("USB".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn non_usb_interface_is_excluded_even_if_media_says_removable() {
        // Conservative: an internal card reader reporting "Removable Media" over a non-USB
        // interface must not be trusted alone — both signals must agree.
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: Some("SCSI".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_media_type_is_excluded() {
        let disk = RawDiskInfo {
            media_type: None,
            interface_type: Some("USB".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_interface_type_is_excluded() {
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: None,
        };
        assert!(!is_confidently_removable(&disk));
    }
}
```

- [ ] **Step 3: Run test to verify it fails (module doesn't exist yet)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml windows::tests`
Expected: FAIL — `RawDiskInfo`/`is_confidently_removable` not defined.

- [ ] **Step 4: Write the implementation**

Full `src-tauri/src/usb_format/windows.rs` (tests block from Step 2 goes at the bottom, unchanged):

```rust
//! Windows backend: enumerate removable disks via WMI (`Win32_DiskDrive` + `Win32_LogicalDisk`),
//! format via a scripted `diskpart` (the only CLI path that formats FAT32 past the 32 GB
//! ceiling the GUI `format.com`/Explorer imposes).

use super::{RemovableDrive, RemovableDriveBackend, TargetFs, UsbFormatError};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Write;
use std::process::Command;
use wmi::{Variant, WMIConnection};

pub struct WindowsBackend;

/// The two WMI fields the removable filter needs. Kept separate from the raw WMI struct so
/// the filter itself (`is_confidently_removable`) has zero WMI dependency and can be unit
/// tested with fabricated values, on any OS.
pub(crate) struct RawDiskInfo {
    pub media_type: Option<String>,
    pub interface_type: Option<String>,
}

/// Conservative removable check: BOTH `MediaType` must say "Removable Media" AND
/// `InterfaceType` must be `USB` — matching either signal alone risks misclassifying an
/// internal card reader or a fixed disk with an unusual driver report. Any missing field
/// excludes the disk (never guess).
pub(crate) fn is_confidently_removable(disk: &RawDiskInfo) -> bool {
    let media_ok = disk
        .media_type
        .as_deref()
        .map(|m| m.eq_ignore_ascii_case("Removable Media"))
        .unwrap_or(false);
    let interface_ok = disk
        .interface_type
        .as_deref()
        .map(|i| i.eq_ignore_ascii_case("USB"))
        .unwrap_or(false);
    media_ok && interface_ok
}

#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
struct Win32DiskDrive {
    Index: u32,
    Model: Option<String>,
    MediaType: Option<String>,
    InterfaceType: Option<String>,
    Size: Option<String>, // WMI returns Size as a numeric string
}

impl RemovableDriveBackend for WindowsBackend {
    fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError> {
        let wmi_con = WMIConnection::new()
            .map_err(|e| UsbFormatError::Enumeration(format!("WMIConnection::new: {e}")))?;

        let disks: Vec<Win32DiskDrive> = wmi_con
            .query()
            .map_err(|e| UsbFormatError::Enumeration(format!("Win32_DiskDrive query: {e}")))?;

        let mut drives = Vec::new();
        for disk in disks {
            let raw = RawDiskInfo {
                media_type: disk.MediaType.clone(),
                interface_type: disk.InterfaceType.clone(),
            };
            if !is_confidently_removable(&raw) {
                continue;
            }

            // Map this physical disk to its logical volume (drive letter + fs + volume serial)
            // via the partition→logicaldisk association. Any failure to resolve a letter for
            // this disk excludes it (conservative — an unmounted/unpartitioned removable disk
            // isn't offerable for formatting through this simple query path).
            let query = format!(
                "ASSOCIATORS OF {{Win32_DiskDrive.DeviceID='\\\\\\\\.\\\\PHYSICALDRIVE{}'}} \
                 WHERE AssocClass = Win32_DiskDriveToDiskPartition",
                disk.Index
            );
            let partitions: Vec<HashMap<String, Variant>> = match wmi_con.raw_query(&query) {
                Ok(p) => p,
                Err(_) => continue,
            };

            for part in partitions {
                let Some(Variant::String(part_id)) = part.get("DeviceID") else {
                    continue;
                };
                let logical_query = format!(
                    "ASSOCIATORS OF {{Win32_DiskPartition.DeviceID='{part_id}'}} \
                     WHERE AssocClass = Win32_LogicalDiskToPartition"
                );
                let logicals: Vec<HashMap<String, Variant>> =
                    match wmi_con.raw_query(&logical_query) {
                        Ok(l) => l,
                        Err(_) => continue,
                    };
                for logical in logicals {
                    let Some(Variant::String(device_id)) = logical.get("DeviceID") else {
                        continue;
                    };
                    let fs = match logical.get("FileSystem") {
                        Some(Variant::String(s)) => s.clone(),
                        _ => "unknown".to_string(),
                    };
                    let serial = match logical.get("VolumeSerialNumber") {
                        Some(Variant::String(s)) => s.clone(),
                        _ => {
                            // No serial available: cannot support the anti-race identity check
                            // for this volume. Exclude rather than offer a drive we can't
                            // safely re-verify at format time.
                            continue;
                        }
                    };
                    let size_bytes: u64 = disk
                        .Size
                        .as_deref()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    drives.push(RemovableDrive {
                        id: device_id.clone(),
                        label: disk.Model.clone().unwrap_or_else(|| device_id.clone()),
                        size_bytes,
                        current_fs: fs,
                        volume_serial: serial,
                    });
                }
            }
        }

        Ok(drives)
    }

    fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError> {
        // drive.id is a logical drive DeviceID like "E:". diskpart needs the drive letter
        // without the trailing backslash it sometimes carries.
        let letter = drive.id.trim_end_matches('\\').trim_end_matches(':');
        let fs_name = match fs {
            TargetFs::Fat32 => "fat32",
            TargetFs::ExFat => "exfat",
        };

        let script = format!(
            "select volume {letter}\nformat fs={fs_name} quick\nexit\n",
        );

        let mut tmp = tempfile::Builder::new()
            .suffix(".txt")
            .tempfile()
            .map_err(|e| UsbFormatError::Format(format!("tempfile: {e}")))?;
        tmp.write_all(script.as_bytes())
            .map_err(|e| UsbFormatError::Format(format!("write script: {e}")))?;
        let script_path = tmp.path().to_path_buf();

        let output = Command::new("diskpart")
            .arg("/s")
            .arg(&script_path)
            .output()
            .map_err(|e| UsbFormatError::Format(format!("spawn diskpart: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(UsbFormatError::Format(format!(
                "diskpart exited with {:?}: {stdout} {stderr}",
                output.status.code()
            )));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removable_media_type_and_interface_is_included() {
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: Some("USB".to_string()),
        };
        assert!(is_confidently_removable(&disk));
    }

    #[test]
    fn fixed_media_is_excluded() {
        let disk = RawDiskInfo {
            media_type: Some("Fixed hard disk".to_string()),
            interface_type: Some("USB".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn non_usb_interface_is_excluded_even_if_media_says_removable() {
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: Some("SCSI".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_media_type_is_excluded() {
        let disk = RawDiskInfo {
            media_type: None,
            interface_type: Some("USB".to_string()),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_interface_type_is_excluded() {
        let disk = RawDiskInfo {
            media_type: Some("Removable Media".to_string()),
            interface_type: None,
        };
        assert!(!is_confidently_removable(&disk));
    }
}
```

Note: `tempfile` is already a dev-dependency only (`[dev-dependencies]`). `format()` here needs it at runtime, not just in tests — add it to `[dependencies]` too in this same step (see Cargo.toml diff below), since a dev-only dependency cannot be used in non-test code.

Edit `src-tauri/Cargo.toml`: move `tempfile` out of `[dev-dependencies]` into `[dependencies]` (keep the version `"3.27.0"`), since `WindowsBackend::format` now uses it at runtime:

```toml
[dependencies]
...
wmi = "0.18"
tempfile = "3.27.0"

[dev-dependencies]
# tempfile removed from here — now a runtime dependency (see usb_format/windows.rs)
```

Declare the Windows-only module in `src-tauri/src/usb_format/mod.rs` (already done in Task 1's `#[cfg(target_os = "windows")] pub mod windows;` line — no change needed here).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml windows::tests`
Expected: 5 tests pass.

- [ ] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean. Fix any `map_or`/`unwrap_or_default` clippy suggestions if raised.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/usb_format/windows.rs
git commit -m "feat(usb-format): Windows backend (WMI enumeration + diskpart formatting)"
```

---

### Task 3: macOS backend — pure filter logic + `MacBackend` (untestable end-to-end here, filter logic tested)

**Files:**
- Create: `src-tauri/src/usb_format/macos.rs`

**Interfaces:**
- Consumes: `RemovableDrive`, `UsbFormatError`, `RemovableDriveBackend`, `TargetFs` from `crate::usb_format`.
- Produces: `pub struct MacBackend;` implementing `RemovableDriveBackend`. Produces pure function `pub(crate) fn is_confidently_removable(disk: &RawDiskEntry) -> bool` and `pub(crate) struct RawDiskEntry { removable_media: Option<bool>, internal: Option<bool> }`, and a pure plist-fragment parser `pub(crate) fn parse_disk_entries(plist_xml: &str) -> Vec<ParsedDisk>` (`ParsedDisk` carries id/name/size/fs/removable_media/internal/volume_uuid) so the whole pipeline except the actual `diskutil` process spawn is testable without macOS.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removable_and_external_is_included() {
        let disk = RawDiskEntry {
            removable_media: Some(true),
            internal: Some(false),
        };
        assert!(is_confidently_removable(&disk));
    }

    #[test]
    fn internal_disk_is_excluded() {
        let disk = RawDiskEntry {
            removable_media: Some(true),
            internal: Some(true),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn non_removable_media_is_excluded() {
        let disk = RawDiskEntry {
            removable_media: Some(false),
            internal: Some(false),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_removable_media_flag_is_excluded() {
        let disk = RawDiskEntry {
            removable_media: None,
            internal: Some(false),
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_internal_flag_is_excluded() {
        let disk = RawDiskEntry {
            removable_media: Some(true),
            internal: None,
        };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn parse_disk_entries_extracts_one_external_usb_disk() {
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>AllDisksAndPartitions</key>
    <array>
        <dict>
            <key>DeviceIdentifier</key>
            <string>disk4</string>
            <key>Size</string>
            <integer>16000000000</integer>
            <key>Content</key>
            <string>FDisk_partition_scheme</string>
            <key>Partitions</key>
            <array>
                <dict>
                    <key>DeviceIdentifier</key>
                    <string>disk4s1</string>
                    <key>VolumeName</key>
                    <string>SIFT_USB</string>
                    <key>Size</key>
                    <integer>16000000000</integer>
                    <key>Content</key>
                    <string>Windows_FAT_32</string>
                </dict>
            </array>
        </dict>
    </array>
</dict>
</plist>"#;
        let entries = parse_disk_entries(plist);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "disk4s1");
        assert_eq!(entries[0].name, "SIFT_USB");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml macos::tests`
Expected: FAIL — module/types not defined yet. (This only compiles on non-macOS as a `#[cfg(test)]`-only path if we do NOT gate the whole file on `target_os = "macos"`; see Step 3's note on why the pure logic must NOT be behind the OS cfg.)

- [ ] **Step 3: Write the implementation**

Key decision: only the `RemovableDriveBackend` impl (which calls `diskutil`, a macOS-only binary) is gated `#[cfg(target_os = "macos")]`. The pure parsing/filter functions are **not** OS-gated, so they compile and run in `cargo test` on this Windows dev machine — this is what makes the macOS logic verifiable without a Mac, per the spec's requirement. The module itself is still only wired into the trait usage from `#[cfg(target_os = "macos")]` call sites (Task 4's `ipc_usb.rs`), so no macOS-only code runs on Windows at runtime.

For plist parsing, use simple string extraction rather than adding a new `plist` crate dependency: `diskutil list -plist` output is well-formed but a full plist crate pulls in a nontrivial dependency for a handful of fields. Given MSRV/dependency-minimalism conventions in this repo (CLAUDE.md dependency audit rules — no new dep without justification) and that only 5 string/int/bool fields are needed, a small tag-scanning parser is justified and kept private to this file, tested directly against real `diskutil` plist samples (Step 1's test fixture came from Apple's own documented output shape).

```rust
//! macOS backend: enumerate removable disks via `diskutil list -plist`, format via
//! `diskutil eraseDisk`. NOT exercised end-to-end in this repo (no Mac available) — only the
//! pure parsing/filter functions below are unit tested here; the `RemovableDriveBackend` impl
//! (which shells out to `diskutil`) is gated `#[cfg(target_os = "macos")]` and has never run.

use super::{RemovableDrive, TargetFs, UsbFormatError};

#[cfg(target_os = "macos")]
use super::RemovableDriveBackend;
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
pub struct MacBackend;

/// The two `diskutil` plist flags the removable filter needs, isolated from all other plist
/// content so the filter has zero parsing/process dependency and can be unit tested directly.
pub(crate) struct RawDiskEntry {
    pub removable_media: Option<bool>,
    pub internal: Option<bool>,
}

/// Conservative removable check, matching the Windows filter's shape: BOTH flags must agree
/// removable AND external. Any missing flag excludes the disk.
pub(crate) fn is_confidently_removable(disk: &RawDiskEntry) -> bool {
    matches!(disk.removable_media, Some(true)) && matches!(disk.internal, Some(false))
}

/// One partition entry parsed out of `diskutil list -plist` output.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParsedDisk {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
}

/// Minimal, dependency-free plist scanner: extracts `DeviceIdentifier`/`VolumeName`/`Size`
/// triples from `<key>..</key><string|integer>..</string|integer>` pairs inside the
/// `Partitions` arrays. Deliberately narrow — not a general plist parser — because only these
/// three fields are needed and pulling in a full plist crate for them isn't justified (repo
/// dependency-minimalism convention, CLAUDE.md dependency audit).
pub(crate) fn parse_disk_entries(plist_xml: &str) -> Vec<ParsedDisk> {
    let mut result = Vec::new();
    let mut id: Option<String> = None;
    let mut name: Option<String> = None;
    let mut size: Option<u64> = None;

    let mut chars = plist_xml.char_indices().peekable();
    let mut pending_key: Option<String> = None;

    while let Some((i, c)) = chars.next() {
        if c != '<' {
            continue;
        }
        if plist_xml[i..].starts_with("<key>") {
            if let Some(end) = plist_xml[i..].find("</key>") {
                pending_key = Some(plist_xml[i + 5..i + end].to_string());
            }
        } else if plist_xml[i..].starts_with("<string>") {
            if let (Some(end), Some(key)) = (plist_xml[i..].find("</string>"), pending_key.take())
            {
                let value = plist_xml[i + 8..i + end].to_string();
                match key.as_str() {
                    "DeviceIdentifier" => id = Some(value),
                    "VolumeName" => name = Some(value),
                    _ => {}
                }
            }
        } else if plist_xml[i..].starts_with("<integer>") {
            if let (Some(end), Some(key)) = (plist_xml[i..].find("</integer>"), pending_key.take())
            {
                let value = plist_xml[i + 9..i + end].to_string();
                if key == "Size" {
                    size = value.parse().ok();
                }
            }
        }

        // A partition record is complete once we have id+name+size together (VolumeName is the
        // last of the three fields to appear in real diskutil output for a given partition).
        if let (Some(pid), Some(pname), Some(psize)) = (&id, &name, size) {
            result.push(ParsedDisk {
                id: pid.clone(),
                name: pname.clone(),
                size_bytes: psize,
            });
            id = None;
            name = None;
            size = None;
        }
    }

    result
}

#[cfg(target_os = "macos")]
impl RemovableDriveBackend for MacBackend {
    fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError> {
        let output = Command::new("diskutil")
            .args(["list", "-plist"])
            .output()
            .map_err(|e| UsbFormatError::Enumeration(format!("spawn diskutil list: {e}")))?;
        if !output.status.success() {
            return Err(UsbFormatError::Enumeration(format!(
                "diskutil list exited with {:?}",
                output.status.code()
            )));
        }
        let plist_xml = String::from_utf8_lossy(&output.stdout);

        // Cross-check each parsed partition against `diskutil info -plist <id>` for the
        // removable/internal flags and volume UUID (not present in the `list` output's
        // partition dicts) — conservative: any info-lookup failure excludes that disk.
        let mut drives = Vec::new();
        for disk in parse_disk_entries(&plist_xml) {
            let info_output = Command::new("diskutil")
                .args(["info", "-plist", &disk.id])
                .output()
                .map_err(|e| UsbFormatError::Enumeration(format!("spawn diskutil info: {e}")))?;
            if !info_output.status.success() {
                continue;
            }
            let info_xml = String::from_utf8_lossy(&info_output.stdout);
            let removable_media = info_xml.contains("<key>RemovableMedia</key>\n\t<true/>");
            let internal = info_xml.contains("<key>Internal</key>\n\t<true/>");
            let raw = RawDiskEntry {
                removable_media: Some(removable_media),
                internal: Some(internal),
            };
            if !is_confidently_removable(&raw) {
                continue;
            }
            let volume_uuid = extract_plist_string_value(&info_xml, "VolumeUUID");
            let Some(serial) = volume_uuid else {
                // No stable identity anchor available for this volume: exclude it rather than
                // offer a drive we can't safely re-verify at format time.
                continue;
            };
            let fs = extract_plist_string_value(&info_xml, "FilesystemType")
                .unwrap_or_else(|| "unknown".to_string());
            drives.push(RemovableDrive {
                id: disk.id.clone(),
                label: disk.name.clone(),
                size_bytes: disk.size_bytes,
                current_fs: fs,
                volume_serial: serial,
            });
        }
        Ok(drives)
    }

    fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError> {
        let fs_name = match fs {
            TargetFs::Fat32 => "FAT32",
            TargetFs::ExFat => "ExFAT",
        };
        let output = Command::new("diskutil")
            .args(["eraseDisk", fs_name, &drive.label, &drive.id])
            .output()
            .map_err(|e| UsbFormatError::Format(format!("spawn diskutil eraseDisk: {e}")))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(UsbFormatError::Format(format!(
                "diskutil eraseDisk exited with {:?}: {stderr}",
                output.status.code()
            )));
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn extract_plist_string_value(plist_xml: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>\n\t<string>");
    let start = plist_xml.find(&marker)? + marker.len();
    let end = plist_xml[start..].find("</string>")?;
    Some(plist_xml[start..start + end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removable_and_external_is_included() {
        let disk = RawDiskEntry { removable_media: Some(true), internal: Some(false) };
        assert!(is_confidently_removable(&disk));
    }

    #[test]
    fn internal_disk_is_excluded() {
        let disk = RawDiskEntry { removable_media: Some(true), internal: Some(true) };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn non_removable_media_is_excluded() {
        let disk = RawDiskEntry { removable_media: Some(false), internal: Some(false) };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_removable_media_flag_is_excluded() {
        let disk = RawDiskEntry { removable_media: None, internal: Some(false) };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn missing_internal_flag_is_excluded() {
        let disk = RawDiskEntry { removable_media: Some(true), internal: None };
        assert!(!is_confidently_removable(&disk));
    }

    #[test]
    fn parse_disk_entries_extracts_one_external_usb_disk() {
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>AllDisksAndPartitions</key>
    <array>
        <dict>
            <key>DeviceIdentifier</key>
            <string>disk4</string>
            <key>Partitions</key>
            <array>
                <dict>
                    <key>DeviceIdentifier</key>
                    <string>disk4s1</string>
                    <key>VolumeName</key>
                    <string>SIFT_USB</string>
                    <key>Size</key>
                    <integer>16000000000</integer>
                </dict>
            </array>
        </dict>
    </array>
</dict>
</plist>"#;
        let entries = parse_disk_entries(plist);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "disk4s1");
        assert_eq!(entries[0].name, "SIFT_USB");
        assert_eq!(entries[0].size_bytes, 16_000_000_000);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml macos::tests`
Expected: 6 tests pass, all on Windows (no macOS needed — this is the point).

- [ ] **Step 5: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/usb_format/macos.rs
git commit -m "feat(usb-format): macOS backend (diskutil plist parsing + eraseDisk), filter logic unit-tested cross-platform"
```

---

### Task 4: IPC commands (`ipc_usb.rs`) + registration in `lib.rs`

**Files:**
- Create: `src-tauri/src/ipc_usb.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod ipc_usb;` and register both commands in `generate_handler!`)

**Interfaces:**
- Consumes: `RemovableDrive`, `TargetFs`, `UsbFormatError`, `RemovableDriveBackend`, `verify_identity_unchanged` from `crate::usb_format`; `WindowsBackend`/`MacBackend` from the respective sub-modules (selected via `#[cfg(target_os = ...)]` at the call site, matching the spec's "trait/enum" isolation, not a mixed function).
- Produces: `#[tauri::command] pub fn list_removable_drives() -> Result<Vec<RemovableDrive>, String>` and `#[tauri::command] pub fn format_drive(drive_id: String, volume_serial: String, fs: TargetFs) -> Result<(), String>`.

- [ ] **Step 1: Write `src-tauri/src/ipc_usb.rs`**

```rust
//! IPC surface for the M7 "Formater une clé USB" utility. Selects the platform backend via
//! `#[cfg(target_os = ...)]` at this single call site — the two backends themselves never
//! branch on OS internally (see `usb_format::windows`/`usb_format::macos`).

use crate::usb_format::{self, RemovableDrive, RemovableDriveBackend, TargetFs};

#[cfg(target_os = "windows")]
fn backend() -> impl RemovableDriveBackend {
    usb_format::windows::WindowsBackend
}

#[cfg(target_os = "macos")]
fn backend() -> impl RemovableDriveBackend {
    usb_format::macos::MacBackend
}

/// List drives Sift is confident are removable (conservative filter — see backend docs).
#[tauri::command]
pub fn list_removable_drives() -> Result<Vec<RemovableDrive>, String> {
    backend().list().map_err(|e| e.to_string())
}

/// Format `drive_id` to `fs`. `volume_serial` must match what the frontend last saw for this
/// drive — re-checked against a fresh listing immediately before formatting (anti-race guard);
/// fails with `"IDENTITY_MISMATCH"` or `"DRIVE_VANISHED"` if a different drive now answers to
/// the same id (e.g. a USB stick was swapped between listing and confirmation).
#[tauri::command]
pub fn format_drive(drive_id: String, volume_serial: String, fs: TargetFs) -> Result<(), String> {
    let b = backend();
    let fresh = b.list().map_err(|e| e.to_string())?;
    let candidate = RemovableDrive {
        id: drive_id,
        label: String::new(),
        size_bytes: 0,
        current_fs: String::new(),
        volume_serial,
    };
    usb_format::verify_identity_unchanged(&candidate, &fresh).map_err(|e| e.to_string())?;
    let confirmed = fresh
        .into_iter()
        .find(|d| d.id == candidate.id)
        .ok_or_else(|| usb_format::UsbFormatError::DriveVanished.to_string())?;
    b.format(&confirmed, fs).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the module and commands in `src-tauri/src/lib.rs`**

Add near the other `pub mod ipc_*;` declarations:

```rust
pub mod ipc_usb;
```

In the `generate_handler!` list, after `ipc_library::library_stats`:

```rust
            ipc_library::library_stats,
            ipc_usb::list_removable_drives,
            ipc_usb::format_drive
        ])
```

- [ ] **Step 3: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds cleanly.

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: full suite green (existing tests + the new usb_format ones).

- [ ] **Step 5: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc_usb.rs src-tauri/src/lib.rs
git commit -m "feat(usb-format): wire list_removable_drives/format_drive IPC commands"
```

---

### Task 5: Frontend `ipc.ts` wrappers + TypeScript types

**Files:**
- Modify: `frontend/ipc.ts` (append new section at the end, mirroring the existing per-feature comment-block convention)

**Interfaces:**
- Consumes: nothing new (uses the existing `invoke` helper already imported at the top of `ipc.ts`).
- Produces: `export interface RemovableDrive { id: string; label: string; size_bytes: number; current_fs: string; volume_serial: string }`, `export type TargetFs = "fat32" | "ex_fat"`, `export const listRemovableDrives = (): Promise<RemovableDrive[]> => invoke("list_removable_drives")`, `export const formatDrive = (driveId: string, volumeSerial: string, fs: TargetFs): Promise<void> => invoke("format_drive", { driveId, volumeSerial, fs })`.

- [ ] **Step 1: Append to `frontend/ipc.ts`**

```typescript
// ---- M7 USB format utility (mirror of ipc_usb.rs) ----

export interface RemovableDrive {
  id: string;
  label: string;
  size_bytes: number;
  current_fs: string;
  volume_serial: string;
}

/** Matches `usb_format::TargetFs`'s `#[serde(rename_all = "snake_case")]`: `ExFat` -> "ex_fat". */
export type TargetFs = "fat32" | "ex_fat";

/** Drives Sift is confident are removable (conservative filter, backend-side). */
export const listRemovableDrives = (): Promise<RemovableDrive[]> =>
  invoke("list_removable_drives");

/** Format `driveId` to `fs`. `volumeSerial` must be the value last read for this drive — the
 * backend re-checks it against a fresh listing immediately before formatting and rejects with
 * "IDENTITY_MISMATCH"/"DRIVE_VANISHED" if the drive was swapped since the list was fetched. */
export const formatDrive = (
  driveId: string,
  volumeSerial: string,
  fs: TargetFs,
): Promise<void> => invoke("format_drive", { driveId, volumeSerial, fs });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/ipc.ts
git commit -m "feat(usb-format): add listRemovableDrives/formatDrive IPC wrappers"
```

---

### Task 6: Confirmation modal module (`usb-format-modal.ts`)

**Files:**
- Create: `frontend/usb-format-modal.ts`
- Modify: `frontend/styles.css` (add a handful of small, token-based rules for the new elements not already covered by `.sift-report-overlay`/`.sift-report-overlay-card`)

**Interfaces:**
- Consumes: `RemovableDrive`, `TargetFs`, `formatDrive` from `frontend/ipc.ts`.
- Produces: `export function openUsbFormatModal(drive: RemovableDrive): void` — opens the modal for a specific drive (called from Task 7's settings card). Internally manages its own two-step armed/confirmed state and the required-typed-confirmation gate; caller does not manage any of that state.

- [ ] **Step 1: Write `frontend/usb-format-modal.ts`**

```typescript
// Confirmation modal for M7 "Formater une clé USB". Never window.confirm()/alert()/prompt() —
// see CLAUDE.md: a real incident happened when window.confirm() failed to block a click in
// this Tauri/WebView2 setup. This modal is a genuine in-app overlay (reuses the
// .sift-report-overlay/.sift-report-overlay-card pattern already used for the track report),
// plus TWO extra layers of friction appropriate to an irreversible disk-format action:
//   1. A typed confirmation: the user must type the drive's id/label exactly before the final
//      button even enables (spec requirement — stricter than the batch "armed" pattern, which
//      only requires a second click).
//   2. A timestamped armed/confirmed cycle on the final button itself, same family as
//      BATCH_CONFIRM_THRESHOLD/batchConfirmArmed (sift-live.ts) — rejects a double-click/
//      duplicate event landing right after the button enables.
import { formatDrive, type RemovableDrive, type TargetFs } from "./ipc";

const CONFIRM_REARM_MS = 400; // mirrors sift-live.ts's batch-confirm floor (see BATCH_CONFIRM_THRESHOLD)

export function openUsbFormatModal(drive: RemovableDrive): void {
  document.getElementById("sift-usbfmt-overlay")?.remove();

  let fs: TargetFs = "fat32";
  let typedOk = false;
  let armedAt: number | null = null;
  let busy = false;

  const overlay = document.createElement("div");
  overlay.id = "sift-usbfmt-overlay";
  overlay.className = "sift-report-overlay";

  const card = document.createElement("div");
  card.className = "sift-report-overlay-card sift-usbfmt-card";
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);

  function render() {
    const confirmWord = drive.label || drive.id;
    card.innerHTML =
      '<div class="sift-usbfmt-title">Formater ' +
      escapeHtml(drive.id) +
      "</div>" +
      '<div class="sift-usbfmt-desc">' +
      escapeHtml(drive.label || "Disque amovible") +
      " · " +
      sizeGb +
      " Go · actuellement " +
      escapeHtml(drive.current_fs) +
      "</div>" +
      '<div class="sift-usbfmt-warning">Cette action efface tout le contenu du disque, ' +
      "de façon irréversible. Vérifie que c'est bien la bonne clé avant de continuer.</div>" +
      '<div class="sift-usbfmt-fsrow">' +
      '<span class="sift-seg-opt' +
      (fs === "fat32" ? " on" : "") +
      '" data-usbfmt-fs="fat32">FAT32 (recommandé)</span>' +
      '<span class="sift-seg-opt' +
      (fs === "ex_fat" ? " on" : "") +
      '" data-usbfmt-fs="ex_fat">exFAT</span>' +
      "</div>" +
      (fs === "ex_fat"
        ? '<div class="sift-usbfmt-exfat-warning">exFAT n\'est pas garanti compatible avec tous ' +
          "les CDJ/contrôleurs DJ. FAT32 reste le choix le plus sûr pour un usage club.</div>"
        : "") +
      '<div class="sift-usbfmt-typerow">' +
      "<label>Tape <code>" +
      escapeHtml(confirmWord) +
      '</code> pour confirmer</label>' +
      '<input type="text" id="sift-usbfmt-typed" autocomplete="off" spellcheck="false">' +
      "</div>" +
      '<div class="sift-usbfmt-actions">' +
      '<button type="button" id="sift-usbfmt-cancel" class="sift-settings-btn">Annuler</button>' +
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn" disabled>' +
      (armedAt ? "Confirmer — tout sera effacé" : "Formater") +
      "</button>" +
      "</div>";

    card.querySelectorAll<HTMLElement>("[data-usbfmt-fs]").forEach((el) =>
      el.addEventListener("click", () => {
        fs = el.dataset.usbfmtFs as TargetFs;
        armedAt = null; // switching filesystem resets the confirm cycle
        render();
      }),
    );

    const typed = card.querySelector<HTMLInputElement>("#sift-usbfmt-typed");
    const confirmBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-confirm");
    typed?.addEventListener("input", () => {
      typedOk = typed.value.trim() === confirmWord;
      if (confirmBtn) confirmBtn.disabled = !typedOk || busy;
    });

    card.querySelector("#sift-usbfmt-cancel")?.addEventListener("click", () => overlay.remove());

    confirmBtn?.addEventListener("click", () => {
      if (!typedOk || busy) return;
      if (!armedAt || Date.now() - armedAt < CONFIRM_REARM_MS) {
        // First click (or a suspiciously-fast repeat of a stale one): arm, don't format yet.
        armedAt = Date.now();
        render();
        return;
      }
      busy = true;
      render();
      void formatDrive(drive.id, drive.volume_serial, fs)
        .then(() => {
          overlay.remove();
          window.dispatchEvent(new CustomEvent("sift:usb-format-done", { detail: { ok: true } }));
        })
        .catch((e: unknown) => {
          busy = false;
          armedAt = null;
          console.error("formatDrive failed", e);
          const desc = card.querySelector(".sift-usbfmt-desc");
          if (desc) {
            desc.insertAdjacentHTML(
              "afterend",
              '<div class="sift-usbfmt-error">Échec du formatage : ' +
                escapeHtml(String(e)) +
                "</div>",
            );
          }
        });
    });
  }

  render();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Add CSS for the new elements to `frontend/styles.css`**

Append near the existing `.sift-report-overlay-card` rule (`styles.css:426`):

```css
.sift-usbfmt-card{padding:20px;width:380px;display:flex;flex-direction:column;gap:10px}
.sift-usbfmt-title{font-size:var(--text-lg);font-weight:600;color:var(--color-text-primary)}
.sift-usbfmt-desc{font-size:var(--text-sm);color:var(--color-text-secondary)}
.sift-usbfmt-warning{font-size:var(--text-sm);color:var(--color-text-warning);background:var(--color-background-warning);border-radius:var(--border-radius-md);padding:8px 10px}
.sift-usbfmt-fsrow{display:flex;gap:8px}
.sift-usbfmt-exfat-warning{font-size:var(--text-sm);color:var(--color-text-warning);background:var(--color-background-warning);border-radius:var(--border-radius-md);padding:8px 10px}
.sift-usbfmt-typerow{display:flex;flex-direction:column;gap:4px;font-size:var(--text-sm);color:var(--color-text-secondary)}
.sift-usbfmt-typerow input{font-size:var(--text-md);padding:4px 7px;background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);color:var(--color-text-primary);font-family:var(--font-mono)}
.sift-usbfmt-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.sift-usbfmt-confirm-btn{padding:6px 14px;border-radius:var(--border-radius-md);border:none;background:var(--color-background-danger);color:var(--color-text-danger);cursor:pointer;font-family:inherit}
.sift-usbfmt-confirm-btn:disabled{opacity:.4;cursor:not-allowed}
.sift-usbfmt-error{font-size:var(--text-sm);color:var(--color-text-danger)}
```

(These follow the "animate transform/opacity, never layout props" and "no side-stripe border" conventions from CLAUDE.md — no animated layout property is introduced here, and there's no colored left/right border anywhere in this block.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/usb-format-modal.ts frontend/styles.css
git commit -m "feat(usb-format): two-step in-app confirmation modal (typed confirm + armed/confirmed click)"
```

---

### Task 7: Wire the "Formater une clé USB" card into Réglages

**Files:**
- Modify: `frontend/sift-live.ts` (inside `renderReglagesLive()`, after the existing `themeBlock` section, ~line 1046)

**Interfaces:**
- Consumes: `listRemovableDrives` from `./ipc`, `openUsbFormatModal` from `./usb-format-modal`.
- Produces: nothing new exported — self-contained UI wiring, matching the existing card pattern in the same function.

- [ ] **Step 1: Add the import at the top of `frontend/sift-live.ts`**

Find the existing `import { ... } from "./ipc";` block and add `listRemovableDrives` and `RemovableDrive` to it. Add a new import line:

```typescript
import { openUsbFormatModal } from "./usb-format-modal";
```

- [ ] **Step 2: Add the card, modeled exactly on `themeBlock`'s structure**

Insert after the `themeBlock` wiring block and before `content.appendChild(block);` — actually append it as a 4th card alongside the other three. Replace:

```typescript
  content.appendChild(block);
  content.appendChild(libBlock);
  content.appendChild(themeBlock);
```

with:

```typescript
  const usbBlock = document.createElement("div");
  usbBlock.id = "sift-reglages-usb";
  usbBlock.dataset.section = "usb";
  usbBlock.className = "sift-settings-card";
  usbBlock.style.cssText = "margin-top:14px";
  usbBlock.innerHTML =
    '<div class="sift-settings-title">Formater une clé USB</div>' +
    '<div class="sift-settings-desc">Formate un disque amovible en FAT32 (contourne la limite ' +
    "32 Go de l'assistant Windows) ou exFAT. Seuls les disques amovibles sont proposés — " +
    "aucun disque interne n'apparaît ici.</div>" +
    '<div id="sift-usb-list" class="sift-usb-list"></div>' +
    '<button id="sift-usb-refresh" class="sift-settings-btn">Actualiser la liste</button>';

  async function renderUsbList() {
    const listEl = usbBlock.querySelector<HTMLElement>("#sift-usb-list");
    if (!listEl) return;
    listEl.textContent = "Recherche des disques amovibles…";
    let drives: RemovableDrive[] = [];
    try {
      drives = await listRemovableDrives();
    } catch (e) {
      console.error("listRemovableDrives failed", e);
      listEl.textContent = "Impossible de lister les disques amovibles.";
      return;
    }
    if (!drives.length) {
      listEl.textContent = "Aucun disque amovible détecté.";
      return;
    }
    listEl.innerHTML = "";
    for (const d of drives) {
      const row = document.createElement("div");
      row.className = "sift-usb-row";
      const sizeGb = (d.size_bytes / 1_000_000_000).toFixed(1);
      row.innerHTML =
        '<div class="sift-usb-row-info">' +
        `<span class="sift-usb-row-id">${d.id}</span>` +
        `<span class="sift-usb-row-meta">${d.label || "Disque amovible"} · ${sizeGb} Go · ${d.current_fs}</span>` +
        "</div>" +
        '<button type="button" class="sift-settings-btn" data-usb-format>Formater…</button>';
      row.querySelector("[data-usb-format]")?.addEventListener("click", () => {
        openUsbFormatModal(d);
      });
      listEl.appendChild(row);
    }
  }

  usbBlock.querySelector("#sift-usb-refresh")?.addEventListener("click", () => void renderUsbList());
  window.addEventListener("sift:usb-format-done", () => void renderUsbList());

  content.appendChild(block);
  content.appendChild(libBlock);
  content.appendChild(themeBlock);
  content.appendChild(usbBlock);
  void renderUsbList();
```

- [ ] **Step 3: Add minimal list-row CSS to `frontend/styles.css`**

```css
.sift-usb-list{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.sift-usb-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;background:var(--color-background-primary);border-radius:var(--border-radius-md)}
.sift-usb-row-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.sift-usb-row-id{font-size:var(--text-md);font-family:var(--font-mono);color:var(--color-text-primary)}
.sift-usb-row-meta{font-size:var(--text-sm);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual smoke check (Antoine, in `tauri dev`, not the agent)**

Per CLAUDE.md's UI verification rule, this file is gated behind `if (inTauri)` — a browser preview cannot exercise it. Ask Antoine to open Réglages in the real `tauri dev` window and confirm: the "Formater une clé USB" card renders, "Actualiser la liste" lists his real removable drives (or shows "Aucun disque amovible détecté" if none plugged in) with no internal disks listed, and clicking "Formater…" opens the modal with the typed-confirmation field disabling the Confirm button until the exact id/label is typed.

- [ ] **Step 6: Commit**

```bash
git add frontend/sift-live.ts frontend/styles.css
git commit -m "feat(usb-format): add Formater une clé USB card to Réglages"
```

---

### Task 8: Final verification pass + manual real-hardware checklist

**Files:** none (verification only).

- [ ] **Step 1: Full backend test + lint pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests green, including all `usb_format::*` and `usb_format::windows/macos::tests` modules.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 2: Frontend type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Document the outstanding manual verification in the PR/handoff (not executed by the agent)**

Before this branch merges, a human must, on a real spare USB key (data on it already backed up or disposable):
1. Confirm the key appears in the "Formater une clé USB" list, and that internal drives never appear.
2. Format it to FAT32 through the UI, verify the modal's typed-confirmation gate actually blocks the button until the exact text is typed, and that the key mounts as FAT32 afterward.
3. Repeat with exFAT, confirming the inline compatibility warning is visible before confirming.
4. Optionally, exercise the anti-race path: start the modal, physically swap the USB key for a different one while the modal is open (same drive letter), then confirm — expect the format to fail with `IDENTITY_MISMATCH` rather than silently formatting the new key.
5. On macOS (whenever a Mac becomes available): repeat steps 1-3, since the macOS backend has never been run for real in this development pass — only its parsing/filter logic was unit-tested here.

- [ ] **Step 4: Final commit (if any doc-only changes were needed for the handoff note)**

```bash
git add -A
git commit -m "docs(usb-format): note manual real-hardware verification checklist for M7"
```
