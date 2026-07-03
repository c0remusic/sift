//! macOS backend: enumerate removable disks via `diskutil list -plist`, format via
//! `diskutil eraseDisk`. NOT exercised end-to-end in this repo (no Mac available) -- only the
//! pure parsing/filter functions below are unit tested here; the `RemovableDriveBackend` impl
//! (which shells out to `diskutil`) is gated `#[cfg(target_os = "macos")]` and has never run.

#[cfg(target_os = "macos")]
use super::{RemovableDrive, RemovableDriveBackend, TargetFs, UsbFormatError};
#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
pub struct MacBackend;

/// The two `diskutil` plist flags the removable filter needs, isolated from all other plist
/// content so the filter has zero parsing/process dependency and can be unit tested directly.
/// Only consumed by `MacBackend::list` (macOS-only) outside of tests — `allow(dead_code)` on
/// non-macOS is deliberate: this struct exists specifically so the logic below is verifiable on
/// any OS via `cargo test`, per the M7 design's cross-platform-testability requirement.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct RawDiskEntry {
    pub removable_media: Option<bool>,
    pub internal: Option<bool>,
}

/// Conservative removable check, matching the Windows filter's shape: BOTH flags must agree
/// removable AND external. Any missing flag excludes the disk.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn is_confidently_removable(disk: &RawDiskEntry) -> bool {
    matches!(disk.removable_media, Some(true)) && matches!(disk.internal, Some(false))
}

/// One partition entry parsed out of `diskutil list -plist` output. Same cross-platform-testing
/// rationale as `RawDiskEntry` above.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParsedDisk {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
}

/// Minimal, dependency-free plist scanner: extracts `DeviceIdentifier`/`VolumeName`/`Size`
/// triples from `<key>..</key><string|integer>..</string|integer>` pairs inside the
/// `Partitions` arrays. Deliberately narrow -- not a general plist parser -- because only these
/// three fields are needed and pulling in a full plist crate for them isn't justified (repo
/// dependency-minimalism convention, CLAUDE.md dependency audit).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn parse_disk_entries(plist_xml: &str) -> Vec<ParsedDisk> {
    let mut result = Vec::new();
    let mut id: Option<String> = None;
    let mut name: Option<String> = None;
    let mut size: Option<u64> = None;

    let mut pending_key: Option<String> = None;

    let mut idx = 0usize;
    while idx < plist_xml.len() {
        let rest = &plist_xml[idx..];
        if !rest.starts_with('<') {
            idx += 1;
            continue;
        }
        if rest.starts_with("<key>") {
            if let Some(end) = rest.find("</key>") {
                pending_key = Some(rest[5..end].to_string());
                idx += end + "</key>".len();
                continue;
            }
        } else if rest.starts_with("<string>") {
            if let Some(end) = rest.find("</string>") {
                if let Some(key) = pending_key.take() {
                    let value = rest[8..end].to_string();
                    match key.as_str() {
                        "DeviceIdentifier" => id = Some(value),
                        "VolumeName" => name = Some(value),
                        _ => {}
                    }
                }
                idx += end + "</string>".len();
                continue;
            }
        } else if rest.starts_with("<integer>") {
            if let Some(end) = rest.find("</integer>") {
                if let Some(key) = pending_key.take() {
                    let value = rest[9..end].to_string();
                    if key == "Size" {
                        size = value.parse().ok();
                    }
                }
                idx += end + "</integer>".len();
                continue;
            }
        }
        idx += 1;

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
        // partition dicts) -- conservative: any info-lookup failure excludes that disk.
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
