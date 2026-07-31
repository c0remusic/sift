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

/// `rename` is load-bearing, not cosmetic: `WMIConnection::query()` builds `SELECT … FROM <name>`
/// where `<name>` is the *serde* name of this struct (wmi 0.18.4, `query.rs` → `build_query` →
/// `de::meta::struct_name_and_fields`). Without it the class queried is `Win32DiskDrive`, which
/// does not exist, and every enumeration fails with `0x80041010` (`WBEM_E_INVALID_CLASS`) — the
/// state this backend shipped in from M7 until 2026-07-31. The three other queries below are
/// `raw_query` with a literal class name, so they were never affected.
/// Pinned by `typed_query_targets_the_real_wmi_class`.
#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
#[serde(rename = "Win32_DiskDrive")]
struct Win32DiskDrive {
    Index: u32,
    Model: Option<String>,
    MediaType: Option<String>,
    InterfaceType: Option<String>,
    // `Size` is CIM_UINT64. Even when WMI marshals it as a BSTR, wmi 0.18.4 normalizes it back to
    // a number before serde sees it (`variant.rs`: `CIM_UINT64 => Variant::UI8(s.parse()?)`), so
    // `u64` is right in both marshalling paths and `String` is right in neither — it shipped as
    // `Option<String>` from M7 and failed with `invalid type: integer`, hidden until 2026-07-31
    // behind the class-name bug above, which failed earlier in the same call.
    Size: Option<u64>,
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
            // via the partition->logicaldisk association. Any failure to resolve a letter for
            // this disk excludes it (conservative -- an unmounted/unpartitioned removable disk
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
                    let size_bytes: u64 = disk.Size.unwrap_or(0);
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

        let script = format!("select volume {letter}\nformat fs={fs_name} quick\nexit\n");

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

    /// The bug this pins was invisible to every other test here: they all feed
    /// `is_confidently_removable` fabricated values, so the filter was covered and the query that
    /// produces the values never was. `build_query` is the same code path `query()` takes, minus
    /// the WMI call — so this asserts the real class name without touching the machine's WMI, and
    /// fails on any CI box.
    #[test]
    fn typed_query_targets_the_real_wmi_class() {
        let q = wmi::build_query::<Win32DiskDrive>(None).expect("build_query");
        assert!(
            q.contains("FROM Win32_DiskDrive"),
            "typed query must name the real WMI class, got: {q}"
        );
    }

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
