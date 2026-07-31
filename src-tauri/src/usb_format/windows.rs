//! Windows backend: enumerate removable disks via WMI (`Win32_DiskDrive`), format via a scripted
//! `diskpart`.
//!
//! ⚠️ **`diskpart` does NOT lift the 32 GB FAT32 ceiling.** This module claimed it was "the only
//! CLI path that formats FAT32 past the 32 GB ceiling the GUI imposes" — that is false, and so is
//! the promise the Clé USB screen still shows the user. The limit lives in the Windows format
//! driver, shared by `format.com`, `diskpart` and the Explorer dialog alike; a 64 GB key answers
//! `format fs=fat32` with "The volume is too big for FAT32". Delivering FAT32 on a modern DJ key
//! needs either a bundled third-party formatter (the route Rufus takes) or our own FAT32 writer —
//! an open product decision, not something to paper over here.
//!
//! **Enumerates physical disks, not volumes.** It used to walk `Win32_DiskDrive` ->
//! `Win32_DiskPartition` -> `Win32_LogicalDisk` and emit one entry per *mounted volume*, dropping
//! any disk with no partition or no `VolumeSerialNumber`. That excluded a brand-new, RAW or
//! corrupted key — the exact thing a formatting tool exists for. Volumes are still looked up, but
//! only to *describe* a disk (drive letter, current filesystem); they never gate it.

use super::{RemovableDrive, RemovableDriveBackend, TargetFs, UsbFormatError};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Write;
use std::process::Command;
use wmi::{Variant, WMIConnection};

pub struct WindowsBackend;

/// What the removable decision is made from. Kept free of WMI types so the decision itself is
/// unit-testable with fabricated values, on any OS.
pub(crate) struct RawDiskInfo {
    pub interface_type: Option<String>,
    /// One of this disk's logical drives is `%SystemDrive%` — the running Windows install.
    pub carries_system_volume: bool,
}

/// The bus is the positive signal; the system volume is the veto.
///
/// The original filter also demanded `MediaType == "Removable Media"`, and that was a second
/// reason nothing ever showed up: measured on this machine 2026-07-31, the only USB storage
/// device present reports `MediaType = null`, and a USB SSD reports `"Fixed hard disk media"`.
/// Both are legitimate things to format, both were silently excluded.
///
/// `InterfaceType == "USB"` already rules out every internal SATA/NVMe/IDE disk on its own — it
/// is a stronger signal than `MediaType`, not a weaker one. `carries_system_volume` covers the
/// residual case of a Windows install running from a USB disk, which must never be offered.
pub(crate) fn is_confidently_removable(disk: &RawDiskInfo) -> bool {
    let on_usb_bus = disk
        .interface_type
        .as_deref()
        .is_some_and(|i| i.eq_ignore_ascii_case("USB"));
    on_usb_bus && !disk.carries_system_volume
}

/// `rename` is load-bearing, not cosmetic: `WMIConnection::query()` builds `SELECT … FROM <name>`
/// where `<name>` is the *serde* name of this struct (wmi 0.18.4, `query.rs` → `build_query` →
/// `de::meta::struct_name_and_fields`). Without it the class queried is `Win32DiskDrive`, which
/// does not exist, and every enumeration fails with `0x80041010` (`WBEM_E_INVALID_CLASS`) — the
/// state this backend shipped in from M7 until 2026-07-31. The `raw_query` calls below use a
/// literal class name, so they were never affected.
/// Pinned by `typed_query_targets_the_real_wmi_class`.
#[allow(non_snake_case)]
#[derive(Deserialize, Debug)]
#[serde(rename = "Win32_DiskDrive")]
struct Win32DiskDrive {
    Index: u32,
    /// `\\.\PHYSICALDRIVE2` — the id `RemovableDrive.id` carries and `format` parses back.
    DeviceID: String,
    Model: Option<String>,
    /// Read by `live_dump_what_this_machine_reports` only — deliberately NOT part of the filter
    /// (see `is_confidently_removable`). Kept selected because it is the field the old filter got
    /// wrong, so the diagnostic must be able to show what it actually says on a given machine.
    #[allow(dead_code)]
    MediaType: Option<String>,
    InterfaceType: Option<String>,
    // `Size` is CIM_UINT64. Even when WMI marshals it as a BSTR, wmi 0.18.4 normalizes it back to
    // a number before serde sees it (`variant.rs`: `CIM_UINT64 => Variant::UI8(s.parse()?)`), so
    // `u64` is right in both marshalling paths and `String` is right in neither — it shipped as
    // `Option<String>` from M7 and failed with `invalid type: integer`, hidden until 2026-07-31
    // behind the class-name bug above, which failed earlier in the same call.
    Size: Option<u64>,
    /// Frequently junk on USB bridges — measured 2026-07-31, the card reader on this machine
    /// reports `"+"`. Never used alone as an identity anchor; see `disk_identity`.
    SerialNumber: Option<String>,
    /// `USBSTOR\DISK&VEN_…&PROD_…\7&2615ADB3&0` — always present, structured, and what Windows
    /// itself uses to identify a device instance.
    PNPDeviceID: Option<String>,
}

/// WQL object paths take the DeviceID **verbatim**: `\\.\PHYSICALDRIVE2`, backslashes NOT
/// doubled. This shipped doubling them (`\\\\.\\PHYSICALDRIVE2`) from M7, and WMI answers that
/// with "objet introuvable" for every disk — so the partition lookup found nothing and the
/// error-swallowing `continue` dropped every candidate in silence. Measured on this machine
/// 2026-07-31 against `Win32_DiskDrive` disk 0: the doubled form fails, the verbatim form
/// returns `Disk #0, Partition #0`. Pinned by `partitions_query_does_not_double_backslashes`.
pub(crate) fn partitions_query(disk_index: u32) -> String {
    format!(
        "ASSOCIATORS OF {{Win32_DiskDrive.DeviceID='\\\\.\\PHYSICALDRIVE{disk_index}'}} \
         WHERE AssocClass = Win32_DiskDriveToDiskPartition"
    )
}

/// Partition DeviceIDs look like `Disk #0, Partition #0` — no backslash, so nothing to escape
/// here. Extracted next to `partitions_query` only so both query shapes are visible (and
/// testable) side by side; this one was never broken.
pub(crate) fn logical_disks_query(partition_id: &str) -> String {
    format!(
        "ASSOCIATORS OF {{Win32_DiskPartition.DeviceID='{partition_id}'}} \
         WHERE AssocClass = Win32_LogicalDiskToPartition"
    )
}

/// Everything the mounted volumes of one physical disk can tell us about it. All of it is
/// descriptive: an empty `VolumeFacts` means "RAW / not formatted", which is a perfectly
/// listable disk, not a reason to drop it.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct VolumeFacts {
    pub letters: Vec<String>,
    pub filesystems: Vec<String>,
    /// Per-volume `VolumeSerialNumber`s. Not an identity anchor by themselves (a RAW disk has
    /// none) but they change the moment a different key is formatted into the same slot, so they
    /// sharpen `disk_identity` when they exist.
    pub serials: Vec<String>,
    pub total_size: u64,
}

/// What the UI shows under "actuellement …". A disk with no readable filesystem is the normal
/// state of a new key, so it gets a plain French label rather than the old `"unknown"`.
pub(crate) fn describe_filesystem(facts: &VolumeFacts) -> String {
    if facts.filesystems.is_empty() {
        "non formaté".to_string()
    } else {
        facts.filesystems.join(", ")
    }
}

/// Anti-race anchor, re-read from a fresh listing immediately before formatting. Composite on
/// purpose: no single field survives every case.
///
/// - `PNPDeviceID` is always present and unique per device instance, but for a key with no
///   hardware serial its tail is derived from the USB port — swap two serial-less keys in the
///   same port and it repeats.
/// - `SerialNumber` is often junk (`"+"` on this machine's card reader) or absent.
/// - Volume serials change whenever the disk is reformatted, but a RAW disk has none.
///
/// Together they catch every swap the old volume-serial-only anchor caught, plus the RAW case it
/// could not represent at all. Opaque to the frontend — it round-trips the string, never parses it.
pub(crate) fn disk_identity(
    pnp_device_id: Option<&str>,
    hardware_serial: Option<&str>,
    size_bytes: u64,
    volume_serials: &[String],
) -> String {
    let pnp = pnp_device_id.unwrap_or("").trim();
    let hw = hardware_serial.unwrap_or("").trim();
    format!("{pnp}|{hw}|{size_bytes}|{}", volume_serials.join(","))
}

/// `\\.\PHYSICALDRIVE2` -> `2`. Returns `None` on anything else, and the caller MUST treat that
/// as a hard error: `format` builds a `select disk N` + `clean` script, so guessing or defaulting
/// a disk number here would wipe the wrong disk. Never add a fallback.
pub(crate) fn disk_index_from_id(id: &str) -> Option<u32> {
    id.rsplit_once("PHYSICALDRIVE")
        .and_then(|(_, n)| n.trim().parse().ok())
}

/// `clean` + `create partition primary` is what makes a RAW or oddly-partitioned key formattable
/// at all — `select volume <letter>` (what this used to do) needs a mounted volume, which is
/// exactly what a new or corrupted key does not have. `assign` gives the result a drive letter so
/// the key is usable the moment the modal closes.
pub(crate) fn diskpart_script(disk_index: u32, fs: TargetFs) -> String {
    let fs_name = match fs {
        TargetFs::Fat32 => "fat32",
        TargetFs::ExFat => "exfat",
    };
    format!(
        "select disk {disk_index}\nclean\ncreate partition primary\nformat fs={fs_name} quick\nassign\nexit\n"
    )
}

/// `ERROR_CANCELLED`. What Windows reports when the user dismisses the UAC prompt; reused as the
/// exit code of the PowerShell shim below so the two outcomes stay distinguishable.
pub(crate) const UAC_DECLINED_EXIT: i32 = 1223;

/// `diskpart` cannot run from a normal user process at all — measured 2026-07-31, even a
/// read-only `list disk` fails with "L'opération demandée nécessite une élévation" before the
/// process starts. Sift is not elevated, so `Command::new("diskpart")` was failing at
/// `CreateProcess` every single time: the format has never been able to run since M7.
///
/// Formatting a disk requires administrator rights on Windows, full stop. The app therefore asks
/// for elevation for this one operation (the way Disk Management does) rather than running
/// elevated for its whole life. `Start-Process -Verb RunAs` is what raises the UAC prompt from a
/// non-elevated parent.
///
/// The nested `cmd /c … > log 2>&1` is not decoration: `-Verb RunAs` cannot redirect the elevated
/// child's stdout, so without it diskpart's own diagnosis (the FAT32-too-big message, "no media",
/// an access error) would be lost and every failure would read the same.
///
/// Refuses paths containing a quote instead of escaping them — these are our own tempfile paths,
/// so a quote means something is wrong upstream, and a mis-escaped path here is a command
/// injection into an *elevated* shell.
pub(crate) fn elevation_powershell(script_path: &str, log_path: &str) -> Option<String> {
    if [script_path, log_path]
        .iter()
        .any(|p| p.contains('\'') || p.contains('"'))
    {
        return None;
    }
    Some(format!(
        "$ErrorActionPreference='Stop'; \
         try {{ $p = Start-Process -FilePath cmd.exe \
         -ArgumentList '/c',\"diskpart /s \\\"{script_path}\\\" > \\\"{log_path}\\\" 2>&1\" \
         -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode }} \
         catch {{ exit {UAC_DECLINED_EXIT} }}"
    ))
}

fn variant_to_u64(v: Option<&Variant>) -> Option<u64> {
    match v {
        Some(Variant::UI8(n)) => Some(*n),
        Some(Variant::UI4(n)) => Some(u64::from(*n)),
        Some(Variant::String(s)) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn variant_to_string(v: Option<&Variant>) -> Option<String> {
    match v {
        Some(Variant::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

impl WindowsBackend {
    /// Collect the mounted volumes of one physical disk. A failed lookup logs and yields whatever
    /// was gathered so far — it must never remove the disk from the listing, since a disk we
    /// cannot describe is still a disk the user may need to format.
    fn volume_facts(con: &WMIConnection, disk_index: u32) -> VolumeFacts {
        let mut facts = VolumeFacts::default();
        let partitions: Vec<HashMap<String, Variant>> =
            match con.raw_query(partitions_query(disk_index)) {
                Ok(p) => p,
                Err(e) => {
                    // Never silent: a malformed query here used to drop the disk with no trace,
                    // which is how the escaping bug above survived from M7 to 2026-07-31.
                    log::error!("usb_format: partition lookup failed for disk {disk_index}: {e}");
                    return facts;
                }
            };
        for part in partitions {
            let Some(Variant::String(part_id)) = part.get("DeviceID") else {
                continue;
            };
            let logicals: Vec<HashMap<String, Variant>> =
                match con.raw_query(logical_disks_query(part_id)) {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!(
                            "usb_format: logical-disk lookup failed for partition {part_id}: {e}"
                        );
                        continue;
                    }
                };
            for logical in logicals {
                if let Some(letter) = variant_to_string(logical.get("DeviceID")) {
                    facts.letters.push(letter);
                }
                if let Some(fs) = variant_to_string(logical.get("FileSystem")) {
                    facts.filesystems.push(fs);
                }
                if let Some(serial) = variant_to_string(logical.get("VolumeSerialNumber")) {
                    facts.serials.push(serial);
                }
                facts.total_size += variant_to_u64(logical.get("Size")).unwrap_or(0);
            }
        }
        facts
    }
}

impl RemovableDriveBackend for WindowsBackend {
    fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError> {
        let wmi_con = WMIConnection::new()
            .map_err(|e| UsbFormatError::Enumeration(format!("WMIConnection::new: {e}")))?;

        let disks: Vec<Win32DiskDrive> = wmi_con
            .query()
            .map_err(|e| UsbFormatError::Enumeration(format!("Win32_DiskDrive query: {e}")))?;

        // `%SystemDrive%` rather than a hardcoded "C:" — a Windows install is not guaranteed to
        // live on C:, and the veto below is the only thing standing between `diskpart clean` and
        // the running system.
        let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());

        let mut drives = Vec::new();
        for disk in disks {
            // Volumes are read BEFORE the filter because the system-volume veto is derived from
            // them. Cheap: three WMI calls per disk, on a list that is single digits long.
            let facts = Self::volume_facts(&wmi_con, disk.Index);
            let carries_system_volume = facts
                .letters
                .iter()
                .any(|l| l.eq_ignore_ascii_case(&system_drive));

            let raw = RawDiskInfo {
                interface_type: disk.InterfaceType.clone(),
                carries_system_volume,
            };
            if !is_confidently_removable(&raw) {
                continue;
            }

            // `Win32_DiskDrive.Size` is null on some USB bridges (measured 2026-07-31: a card
            // reader reports Model and InterfaceType but neither MediaType nor Size). Falling back
            // to the summed volume size keeps the row from reading "0.0 Go", which the UI would
            // otherwise show as a plausible-looking lie.
            let size_bytes = disk.Size.unwrap_or(facts.total_size);
            // WMI reports no size at all for an empty card-reader slot (measured 2026-07-31:
            // `Size = None`, matching `Get-Disk`'s `OperationalStatus: No Media`). A disk holding
            // real media always reports its capacity, formatted or not — a RAW key included.
            let has_media = size_bytes > 0;

            drives.push(RemovableDrive {
                id: disk.DeviceID.clone(),
                label: disk.Model.clone().unwrap_or_else(|| disk.DeviceID.clone()),
                mount: facts.letters.join(", "),
                size_bytes,
                current_fs: describe_filesystem(&facts),
                has_media,
                identity: disk_identity(
                    disk.PNPDeviceID.as_deref(),
                    disk.SerialNumber.as_deref(),
                    size_bytes,
                    &facts.serials,
                ),
            });
        }

        Ok(drives)
    }

    fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError> {
        // Hard failure, never a fallback: the script below runs `clean` on this number.
        let disk_index = disk_index_from_id(&drive.id).ok_or_else(|| {
            UsbFormatError::Format(format!(
                "identifiant de disque non reconnu: {} — formatage refusé",
                drive.id
            ))
        })?;
        let script = diskpart_script(disk_index, fs);

        let mut tmp = tempfile::Builder::new()
            .suffix(".txt")
            .tempfile()
            .map_err(|e| UsbFormatError::Format(format!("tempfile: {e}")))?;
        tmp.write_all(script.as_bytes())
            .map_err(|e| UsbFormatError::Format(format!("write script: {e}")))?;
        // `into_temp_path` closes our handle while keeping the file (and its delete-on-drop): the
        // elevated diskpart runs as a different process and must be able to open both paths.
        let script_path = tmp.into_temp_path();
        let log_path = tempfile::Builder::new()
            .suffix(".log")
            .tempfile()
            .map_err(|e| UsbFormatError::Format(format!("tempfile: {e}")))?
            .into_temp_path();

        let ps = elevation_powershell(&script_path.to_string_lossy(), &log_path.to_string_lossy())
            .ok_or_else(|| {
                UsbFormatError::Format(
                    "chemin temporaire contenant un guillemet — formatage refusé".to_string(),
                )
            })?;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .output()
            .map_err(|e| UsbFormatError::Format(format!("spawn powershell: {e}")))?;

        let code = output.status.code().unwrap_or(-1);
        if code == UAC_DECLINED_EXIT {
            return Err(UsbFormatError::ElevationDeclined);
        }
        // diskpart's own words, captured through the `cmd /c … > log` shim. Without them every
        // failure — volume too big for FAT32, no media, disk write-protected — reads the same.
        let diagnosis = std::fs::read_to_string(&log_path).unwrap_or_else(|e| {
            log::error!("usb_format: could not read diskpart log: {e}");
            String::new()
        });
        if code != 0 {
            return Err(UsbFormatError::Format(format!(
                "diskpart exited with {code}: {}",
                diagnosis.trim()
            )));
        }
        // diskpart can exit 0 having refused a step it printed an error for, so the log is checked
        // even on success — a silent no-op that reports success is worse than a loud failure.
        if diagnosis.contains("DiskPart has encountered an error")
            || diagnosis.contains("DiskPart a rencontré une erreur")
        {
            return Err(UsbFormatError::Format(diagnosis.trim().to_string()));
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

    /// The escaping bug was invisible to every other test: the query string was built inline at
    /// its single call site, so nothing could read it without a live WMI connection. Extracting
    /// the builder is what makes it assertable on any machine.
    #[test]
    fn partitions_query_does_not_double_backslashes() {
        let q = partitions_query(2);
        assert!(
            q.contains(r"'\\.\PHYSICALDRIVE2'"),
            "device path must be verbatim, got: {q}"
        );
        assert!(
            !q.contains(r"\\\\"),
            "doubling the backslashes makes WMI answer 'object not found', got: {q}"
        );
    }

    #[test]
    fn usb_bus_disk_is_included() {
        assert!(is_confidently_removable(&RawDiskInfo {
            interface_type: Some("USB".to_string()),
            carries_system_volume: false,
        }));
    }

    /// The regression that made this whole screen useless: the card reader measured on this
    /// machine reports no MediaType at all, and a USB SSD reports "Fixed hard disk media".
    /// Neither may be excluded on that basis — the bus is what decides.
    #[test]
    fn usb_bus_disk_is_included_whatever_the_media_type_says() {
        // MediaType is not even an input any more; this test exists to state that on purpose.
        assert!(is_confidently_removable(&RawDiskInfo {
            interface_type: Some("USB".to_string()),
            carries_system_volume: false,
        }));
    }

    #[test]
    fn internal_bus_disk_is_excluded() {
        for iface in ["IDE", "SCSI", "SATA", "NVMe"] {
            assert!(
                !is_confidently_removable(&RawDiskInfo {
                    interface_type: Some(iface.to_string()),
                    carries_system_volume: false,
                }),
                "{iface} must never be offered"
            );
        }
    }

    #[test]
    fn missing_interface_type_is_excluded() {
        assert!(!is_confidently_removable(&RawDiskInfo {
            interface_type: None,
            carries_system_volume: false,
        }));
    }

    /// A Windows install running from a USB disk is on the USB bus like any key. The veto is the
    /// only thing between `diskpart clean` and the running system.
    #[test]
    fn usb_disk_carrying_the_system_volume_is_excluded() {
        assert!(!is_confidently_removable(&RawDiskInfo {
            interface_type: Some("USB".to_string()),
            carries_system_volume: true,
        }));
    }

    #[test]
    fn raw_disk_is_described_as_not_formatted() {
        assert_eq!(describe_filesystem(&VolumeFacts::default()), "non formaté");
    }

    #[test]
    fn formatted_disk_reports_its_filesystems() {
        let facts = VolumeFacts {
            filesystems: vec!["FAT32".to_string()],
            ..Default::default()
        };
        assert_eq!(describe_filesystem(&facts), "FAT32");
    }

    #[test]
    fn disk_index_is_parsed_from_the_device_path() {
        assert_eq!(disk_index_from_id(r"\\.\PHYSICALDRIVE2"), Some(2));
        assert_eq!(disk_index_from_id(r"\\.\PHYSICALDRIVE11"), Some(11));
    }

    /// `format` turns `None` into a refusal. Anything that could make this return `Some(0)` for a
    /// malformed id would point `clean` at the first disk in the machine.
    #[test]
    fn unrecognised_disk_id_yields_no_index() {
        for bogus in ["E:", "", "PHYSICALDRIVE", r"\\.\PHYSICALDRIVEx", "disk2"] {
            assert_eq!(disk_index_from_id(bogus), None, "must refuse {bogus:?}");
        }
    }

    #[test]
    fn diskpart_script_cleans_and_recreates_the_partition() {
        let s = diskpart_script(3, TargetFs::Fat32);
        assert!(s.starts_with("select disk 3\n"), "got: {s}");
        assert!(s.contains("\nclean\n"), "a RAW key needs clean: {s}");
        assert!(
            s.contains("\ncreate partition primary\n"),
            "a cleaned disk has no partition to format: {s}"
        );
        assert!(s.contains("format fs=fat32 quick"), "got: {s}");
        assert!(
            s.contains("\nassign\n"),
            "the key must come back mounted: {s}"
        );
    }

    #[test]
    fn diskpart_script_never_targets_a_volume_letter() {
        let s = diskpart_script(2, TargetFs::ExFat);
        assert!(
            !s.contains("select volume"),
            "selecting a volume is what made RAW keys unformattable: {s}"
        );
        assert!(s.contains("format fs=exfat quick"), "got: {s}");
    }

    /// Two serial-less keys swapped in the same USB port share a `PNPDeviceID`; their volume
    /// serials are what tells them apart. A RAW disk has none — hence the composite.
    #[test]
    fn identity_changes_when_the_volume_serial_changes() {
        let a = disk_identity(
            Some("USBSTOR\\X"),
            Some("+"),
            16_000_000_000,
            &["AAAA-1111".to_string()],
        );
        let b = disk_identity(
            Some("USBSTOR\\X"),
            Some("+"),
            16_000_000_000,
            &["BBBB-2222".to_string()],
        );
        assert_ne!(a, b);
    }

    #[test]
    fn identity_is_stable_for_the_same_disk() {
        let serials = vec!["AAAA-1111".to_string()];
        assert_eq!(
            disk_identity(Some("USBSTOR\\X"), Some("SN123"), 16_000_000_000, &serials),
            disk_identity(Some("USBSTOR\\X"), Some("SN123"), 16_000_000_000, &serials)
        );
    }

    /// A RAW key has no volume serial at all — the anchor must still be non-empty and still
    /// distinguish two different devices, or the anti-race guard silently degrades to "always OK".
    #[test]
    fn identity_still_distinguishes_two_raw_disks() {
        let a = disk_identity(Some("USBSTOR\\DISK&A\\7&1"), None, 8_000_000_000, &[]);
        let b = disk_identity(Some("USBSTOR\\DISK&B\\7&2"), None, 8_000_000_000, &[]);
        assert_ne!(a, b);
        assert!(!a.trim_matches('|').is_empty());
    }

    #[test]
    fn elevation_shim_asks_for_uac_and_keeps_diskpart_output() {
        let ps = elevation_powershell(r"C:\tmp\s.txt", r"C:\tmp\o.log").expect("shim");
        assert!(
            ps.contains("-Verb RunAs"),
            "must raise the UAC prompt: {ps}"
        );
        assert!(
            ps.contains("-Wait"),
            "returning before diskpart finished would report success too early: {ps}"
        );
        assert!(
            ps.contains(r"diskpart /s"),
            "diskpart must still run the script: {ps}"
        );
        assert!(
            ps.contains("o.log") && ps.contains("2>&1"),
            "-Verb RunAs cannot redirect the child; the cmd shim is what keeps the diagnosis: {ps}"
        );
        assert!(
            ps.contains(&UAC_DECLINED_EXIT.to_string()),
            "a declined prompt must be distinguishable from a failure: {ps}"
        );
    }

    /// These are our own tempfile paths, so a quote means something is wrong upstream — and a
    /// mis-escaped one is a command injection into a shell that is about to be *elevated*.
    #[test]
    fn elevation_shim_refuses_quoted_paths() {
        assert_eq!(
            elevation_powershell(r"C:\tmp\a'b.txt", r"C:\tmp\o.log"),
            None
        );
        assert_eq!(
            elevation_powershell(r"C:\tmp\s.txt", "C:\\tmp\\o\".log"),
            None
        );
    }

    /// Live probe against this machine's real WMI. `--ignored` — it reports whatever is
    /// physically plugged in, so it asserts nothing; it exists so that "aucun disque amovible
    /// détecté" can be traced to the stage that dropped the disk instead of guessed at.
    /// `cargo test --manifest-path src-tauri/Cargo.toml usb_format::windows -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_dump_what_this_machine_reports() {
        let con = WMIConnection::new().expect("WMIConnection::new");
        let disks: Vec<Win32DiskDrive> = con.query().expect("Win32_DiskDrive query");
        let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        println!(
            "--- {} disque(s), SystemDrive={system_drive} ---",
            disks.len()
        );
        for disk in &disks {
            let facts = WindowsBackend::volume_facts(&con, disk.Index);
            let carries_system_volume = facts
                .letters
                .iter()
                .any(|l| l.eq_ignore_ascii_case(&system_drive));
            let raw = RawDiskInfo {
                interface_type: disk.InterfaceType.clone(),
                carries_system_volume,
            };
            println!(
                "disk {} model={:?} media={:?} iface={:?} size={:?} pnp={:?} sn={:?}",
                disk.Index,
                disk.Model,
                disk.MediaType,
                disk.InterfaceType,
                disk.Size,
                disk.PNPDeviceID,
                disk.SerialNumber
            );
            println!(
                "    volumes={:?} fs={:?} serials={:?} => offert={}",
                facts.letters,
                facts.filesystems,
                facts.serials,
                is_confidently_removable(&raw)
            );
        }
        let listed = WindowsBackend.list().expect("list()");
        println!("--- list() renvoie {} disque(s) ---", listed.len());
        for d in &listed {
            println!("    {d:?}");
        }
    }
}
