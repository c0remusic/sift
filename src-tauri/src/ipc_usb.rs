//! IPC surface for the M7 "Formater une clé USB" utility. Selects the platform backend via
//! `#[cfg(target_os = ...)]` at this single call site — the two backends themselves never
//! branch on OS internally (see `usb_format::windows`/`usb_format::macos`).

use crate::usb_format::{self, RemovableDrive, RemovableDriveBackend, TargetFs};

use usb_format::backend_for_this_os as backend;

/// List drives Sift is confident are removable (conservative filter — see backend docs).
#[tauri::command]
pub fn list_removable_drives() -> Result<Vec<RemovableDrive>, String> {
    backend().list().map_err(|e| e.to_string())
}

/// Format `drive_id` to `fs`. `identity` must match what the frontend last saw for this drive —
/// re-checked against a fresh listing immediately before formatting (anti-race guard); fails with
/// `"IDENTITY_MISMATCH"` or `"DRIVE_VANISHED"` if a different drive now answers to the same id
/// (e.g. a USB stick was swapped between listing and confirmation).
///
/// The disk actually formatted is `confirmed` — the entry from the **fresh** listing, never the
/// caller's. `drive_id` only selects; every field `format` acts on is backend-produced.
#[tauri::command]
pub fn format_drive(drive_id: String, identity: String, fs: TargetFs) -> Result<(), String> {
    let b = backend();
    let fresh = b.list().map_err(|e| e.to_string())?;
    let candidate = RemovableDrive {
        id: drive_id,
        label: String::new(),
        mount: String::new(),
        size_bytes: 0,
        free_bytes: 0,
        current_fs: String::new(),
        has_media: false,
        identity,
    };
    usb_format::verify_identity_unchanged(&candidate, &fresh).map_err(|e| e.to_string())?;
    let confirmed = fresh
        .into_iter()
        .find(|d| d.id == candidate.id)
        .ok_or_else(|| usb_format::UsbFormatError::DriveVanished.to_string())?;
    // An enumerated-but-empty card reader is listable (so the UI can say why it is useless) but
    // never formattable — `diskpart` would fail on it anyway, and failing here says why.
    if !confirmed.has_media {
        return Err("Aucun média dans ce lecteur — rien à formater.".to_string());
    }
    b.format(&confirmed, fs).map_err(|e| e.to_string())
}
