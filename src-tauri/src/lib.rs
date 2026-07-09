mod actions;
pub mod analysis;
mod db;
mod dedup;
mod dev_annotate;
mod dev_locate;
mod ecartes;
mod encode;
mod ffmpeg;
mod filing;
mod fingerprint;
mod genres;
mod ipc;
mod ipc_filing;
mod ipc_identify;
mod ipc_library;
mod ipc_usb;
mod library;
mod metadata;
mod naming;
mod queue;
mod rekordbox_masterdb;
mod rekordbox_repairs;
mod rekordbox_xml;
mod scanner;
mod settings;
mod sources;
mod tagging;
mod usb_format;
mod watcher;
mod worker;

use std::sync::Mutex;
use tauri::Manager;

/// Extends the DWM frame into the whole client area (all margins -1) so Windows treats the
/// entire window as "glass" instead of drawing its own opaque backdrop in the native resize-margin
/// strip around an undecorated, transparent, resizable window — that strip was showing as a solid
/// blue-grey rectangle instead of true transparency (visible only in windowed, not maximized,
/// mode — maximized windows have no resize margin). See docs/ressources-externes.md.
#[cfg(windows)]
fn extend_frame_into_client_area(window: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows::Win32::UI::Controls::MARGINS;
    let Ok(hwnd) = window.hwnd() else { return };
    let margins = MARGINS {
        cxLeftWidth: -1,
        cxRightWidth: -1,
        cyTopHeight: -1,
        cyBottomHeight: -1,
    };
    unsafe {
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the FIRST plugin. A second launch focuses the running window instead of
        // opening a rival instance — two Sift processes on one SQLite DB + file-moving
        // pipeline risks corruption.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            ffmpeg::init_ffmpeg_path();
            let dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = db::open(&dir.join("sift.db")).expect("db open failed");
            let session_id = format!(
                "{}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
                std::process::id()
            );
            settings::set(&conn, settings::CURRENT_SESSION_ID, &session_id)
                .expect("session_id write failed");
            app.manage(Mutex::new(conn));
            app.manage(ipc_filing::FilingCancel::default());
            watcher::init_state(app.handle());
            watcher::start_all(app.handle());
            worker::init(app.handle());
            worker::refill(app.handle());
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                extend_frame_into_client_area(&w);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::app_info,
            ipc::db_health,
            ipc::ffmpeg_version,
            ipc::report_smoke,
            ipc::add_source,
            ipc::list_sources,
            ipc::remove_source,
            ipc::list_queue,
            ipc::rescan_source,
            ipc::set_source_watched,
            ipc::set_source_color,
            ipc::analyze_path,
            ipc::analysis_progress,
            ipc::import_paths,
            ipc::open_url,
            ipc::playback_url,
            ipc_filing::reconcile,
            ipc_filing::preview_filename,
            ipc_filing::track_release,
            ipc_filing::track_file_tags,
            ipc_filing::apply_tags,
            ipc_filing::file_track,
            ipc_filing::file_batch,
            ipc_filing::file_cancel,
            ipc_filing::reject_track,
            ipc_filing::reject_batch,
            ipc_filing::trash_track,
            ipc_filing::list_bins,
            ipc_filing::create_bin,
            ipc_filing::undo_last,
            ipc_filing::revert_batch,
            ipc_filing::list_journal,
            ipc_filing::get_session_id,
            ipc_filing::get_setting,
            ipc_filing::set_setting,
            ipc_filing::list_ecartes,
            ipc_filing::restore_track,
            ipc_filing::requeue_track,
            ipc_filing::purge_trash,
            ipc_filing::find_duplicate,
            ipc_identify::identify,
            ipc_identify::apply_identity_cmd,
            ipc_library::list_library,
            ipc_library::library_folders,
            ipc_library::update_metadata,
            ipc_library::scan_library_duplicates,
            ipc_library::library_stats,
            ipc_library::link_rekordbox_xml,
            ipc_library::rekordbox_status,
            ipc_library::export_rekordbox_xml,
            ipc_library::rekordbox_masterdb_pending_repairs,
            ipc_library::rekordbox_masterdb_apply_repairs,
            ipc_library::rekordbox_masterdb_scan_playlist_duplicates,
            ipc_library::rekordbox_masterdb_dedup_playlist_group,
            ipc_library::rekordbox_masterdb_dismiss_repair,
            ipc_library::rekordbox_masterdb_resolve_ambiguous,
            ipc_library::rekordbox_masterdb_pending_metadata_syncs,
            ipc_library::rekordbox_masterdb_apply_metadata_syncs,
            ipc_library::rekordbox_masterdb_dismiss_metadata_sync,
            ipc_library::rekordbox_masterdb_resolve_ambiguous_metadata_sync,
            ipc_library::rekordbox_masterdb_pending_artwork_syncs,
            ipc_library::rekordbox_masterdb_dismiss_artwork_sync,
            ipc_library::rekordbox_masterdb_resolve_ambiguous_artwork_sync,
            ipc_usb::list_removable_drives,
            ipc_usb::format_drive,
            dev_locate::locate_source,
            dev_annotate::save_annotation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
