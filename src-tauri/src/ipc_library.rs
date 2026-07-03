//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::library::{self, LibraryFacets, LibraryFilter, LibraryTrack};
use crate::metadata::{self, MetadataEdit};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// Filed tracks joined to metadata + genres, filtered (folder / quality / genre / q).
#[tauri::command]
pub fn list_library(
    conn: State<'_, Mutex<Connection>>,
    filter: Option<LibraryFilter>,
) -> Result<Vec<LibraryTrack>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::list_filed(&conn, &filter.unwrap_or_default()).map_err(|e| e.to_string())
}

/// Folder + genre facet counts for the sidebar.
#[tauri::command]
pub fn library_folders(conn: State<'_, Mutex<Connection>>) -> Result<LibraryFacets, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::folder_facets(&conn).map_err(|e| e.to_string())
}

/// Edit a filed track's metadata: writes the file tags first, then updates the DB.
/// If the file write fails the DB is left untouched (no partial state).
#[tauri::command]
pub fn update_metadata(
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
    edit: MetadataEdit,
) -> Result<(), String> {
    // (1) Look up the track path — error immediately if unknown.
    let path: String = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT path FROM tracks WHERE id=?1",
            rusqlite::params![track_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("track {track_id} not found"))?
    };

    // (2) Write the file tags. Lock is released before this call; if it fails we stop here and
    // the DB is untouched.
    crate::tagging::write_tags_full(
        &path,
        &edit.artist,
        &edit.title,
        edit.label.as_deref(),
        edit.year,
        &edit.genres,
        edit.cover_path.as_deref(),
    )?;

    // (3) Persist to the DB only after the file write succeeded.
    let conn = conn.lock().map_err(|e| e.to_string())?;
    metadata::update_metadata_db(&conn, track_id, &edit).map_err(|e| e.to_string())
}

/// Group `filed` tracks by acoustic fingerprint into duplicate clusters, each with a
/// recommended keeper. Read-only — resolving a group is a plain `trash_track` per loser.
#[tauri::command]
pub fn scan_library_duplicates(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<crate::dedup::DupGroup>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::dedup::scan_library_duplicates(&conn).map_err(|e| e.to_string())
}

/// Dashboard aggregate stats for the Bibliothèque (totals, lossless/mp3 split, duplicates,
/// tracks to re-source, genre breakdown).
#[tauri::command]
pub fn library_stats(conn: State<'_, Mutex<Connection>>) -> Result<library::DashboardStats, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::library_stats(&conn).map_err(|e| e.to_string())
}

// ── M7 Rekordbox XML export + playlist path repair ──────────────────────────

/// Status of the linked Rekordbox XML — surfaced to the Bibliothèque dashboard card.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RekordboxLinkStatus {
    pub path: Option<String>,
    pub linked: bool,
    pub playlist_count: usize,
    pub track_count: usize,
    /// Set (linked=false is NOT implied) when the linked file is unreadable/corrupt at last
    /// check — the card shows this and blocks further auto-repair until the user re-links.
    pub error: Option<String>,
}

fn count_playlists(nodes: &[crate::rekordbox_xml::PlaylistNode]) -> usize {
    nodes
        .iter()
        .map(|n| match n {
            crate::rekordbox_xml::PlaylistNode::Playlist { .. } => 1,
            crate::rekordbox_xml::PlaylistNode::Folder { children, .. } => count_playlists(children),
        })
        .sum()
}

/// Plain (testable without a `State`) implementation of `link_rekordbox_xml`: parse+validate
/// `path` as a Rekordbox XML and, on success, persist it as the linked file via `conn`. Fails
/// fast (nothing persisted) if the file can't be read or parsed.
fn link_rekordbox_xml_inner(conn: &Connection, path: &str) -> Result<RekordboxLinkStatus, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("lecture impossible: {e}"))?;
    let parsed = crate::rekordbox_xml::parse(&bytes)?;
    crate::settings::set(conn, crate::settings::REKORDBOX_XML_PATH, path).map_err(|e| e.to_string())?;
    Ok(RekordboxLinkStatus {
        path: Some(path.to_string()),
        linked: true,
        playlist_count: count_playlists(&parsed.playlists),
        track_count: parsed.collection.len(),
        error: None,
    })
}

/// Parse+validate `path` as a Rekordbox XML and, on success, persist it as the linked file.
/// Fails fast (path NOT persisted) if the file can't be read or parsed — no silent partial link.
#[tauri::command]
pub fn link_rekordbox_xml(
    conn: State<'_, Mutex<Connection>>,
    path: String,
) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    link_rekordbox_xml_inner(&conn, &path)
}

/// Plain (testable) implementation of `rekordbox_status`.
fn rekordbox_status_inner(conn: &Connection) -> Result<RekordboxLinkStatus, String> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(RekordboxLinkStatus { path: None, linked: false, playlist_count: 0, track_count: 0, error: None });
    };
    match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| crate::rekordbox_xml::parse(&b)) {
        Ok(parsed) => Ok(RekordboxLinkStatus {
            path: Some(path),
            linked: true,
            playlist_count: count_playlists(&parsed.playlists),
            track_count: parsed.collection.len(),
            error: None,
        }),
        Err(e) => Ok(RekordboxLinkStatus {
            path: Some(path),
            linked: true,
            playlist_count: 0,
            track_count: 0,
            error: Some(e),
        }),
    }
}

/// Current link status: re-reads the linked file (if any) fresh from disk. If a path is
/// persisted but the file is now unreadable/corrupt, reports `linked:true, error:Some(..)` —
/// the setting is NOT cleared automatically (the spec: block auto-rewrite, don't lose the
/// reference silently; the user must explicitly re-link).
#[tauri::command]
pub fn rekordbox_status(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_status_inner(&conn)
}

/// Plain (testable) implementation of `export_rekordbox_xml`.
fn export_rekordbox_xml_inner(conn: &Connection) -> Result<RekordboxLinkStatus, String> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant d'exporter")?;
    let filed = library::list_filed(conn, &LibraryFilter::default()).map_err(|e| e.to_string())?;

    let bytes = std::fs::read(&path).map_err(|e| format!("XML Rekordbox illisible: {e}"))?;
    let mut parsed = crate::rekordbox_xml::parse(&bytes)?;
    crate::rekordbox_xml::merge_filed_tracks(&mut parsed, &filed);
    let out = crate::rekordbox_xml::write(&parsed);
    std::fs::write(&path, &out).map_err(|e| format!("écriture impossible: {e}"))?;
    Ok(RekordboxLinkStatus {
        path: Some(path),
        linked: true,
        playlist_count: count_playlists(&parsed.playlists),
        track_count: parsed.collection.len(),
        error: None,
    })
}

/// Reload the linked XML, merge every `filed` track absent from it, rewrite the file. Fails fast
/// (no write attempted) if no XML is linked, or if the linked file is unreadable/corrupt — no
/// silent recreation of an empty tree, matching the spec's fail-fast requirement.
#[tauri::command]
pub fn export_rekordbox_xml(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    export_rekordbox_xml_inner(&conn)
}

#[cfg(test)]
mod rekordbox_tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&c).unwrap();
        c
    }

    #[test]
    fn link_rekordbox_xml_persists_path_on_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        let status = link_rekordbox_xml_inner(&conn, xml_path.to_str().unwrap()).unwrap();
        assert!(status.linked);
        assert_eq!(status.track_count, 3);
        assert!(status.error.is_none());
        assert_eq!(
            crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH).unwrap(),
            Some(xml_path.to_str().unwrap().to_string())
        );
    }

    #[test]
    fn link_rekordbox_xml_reports_error_on_corrupt_file_and_does_not_persist() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("bad.xml");
        std::fs::write(&xml_path, b"<not-even-xml").unwrap();
        let conn = db();
        let result = link_rekordbox_xml_inner(&conn, xml_path.to_str().unwrap());
        assert!(result.is_err(), "corrupt XML must be rejected, not silently linked");
        let saved = crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH).unwrap();
        assert_eq!(saved, None, "no path persisted on a failed link");
    }

    #[test]
    fn rekordbox_status_reports_unlinked_when_no_setting() {
        let conn = db();
        let status = rekordbox_status_inner(&conn).unwrap();
        assert!(!status.linked);
        assert_eq!(status.path, None);
    }

    #[test]
    fn export_rekordbox_xml_fails_fast_when_nothing_linked() {
        let conn = db();
        let result = export_rekordbox_xml_inner(&conn);
        assert!(result.is_err(), "export with no linked XML must fail, not create one silently");
    }

    #[test]
    fn export_rekordbox_xml_merges_filed_tracks_and_rewrites_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status, folder) VALUES('C:/Music/Disco/new.mp3', 'filed', 'Disco')",
            [],
        )
        .unwrap();

        let status = export_rekordbox_xml_inner(&conn).unwrap();
        assert_eq!(status.track_count, 4, "3 original + 1 newly filed");

        let rewritten = std::fs::read_to_string(&xml_path).unwrap();
        assert!(rewritten.contains("Disco/new.mp3") || rewritten.contains("Disco%2Fnew.mp3"));
    }
}
