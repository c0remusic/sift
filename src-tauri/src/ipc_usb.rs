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
