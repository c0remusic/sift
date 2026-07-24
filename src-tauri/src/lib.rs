mod actions;
pub mod analysis;
#[cfg(test)]
mod bench_volume;
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
    // SAFETY: `hwnd` comes from `window.hwnd()` on a live WebviewWindow owned by this
    // process (the `let Ok(hwnd) = ... else { return }` above discards the failure case),
    // so it is a valid, currently-open top-level window handle. `margins` is a local,
    // fully-initialized `MARGINS` struct passed by reference for the duration of this
    // call only. `DwmExtendFrameIntoClientArea` has no other safety preconditions beyond
    // a valid HWND and a valid MARGINS pointer.
    unsafe {
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

/// True only for the one specific, expected updater-plugin init failure: the WHOLE
/// `plugins.updater` key absent from the merged config, so serde tries to deserialize `null` as
/// the entire `Config` struct — the normal case for `tauri dev` and the unsigned CI build
/// (`npm run tauri build`, no `--config tauri.release.conf.json`). Deliberately narrow: matches
/// the exact captured phrase (verbatim from a real `tauri dev` run, see the test fixture) rather
/// than two independent `.contains()` checks — an earlier version of this classifier matched
/// `msg.contains("updater") && msg.contains("invalid type: null")` separately, which ALSO
/// classified a null SUB-FIELD inside an otherwise-present config (e.g. `"pubkey": null` on a
/// signed release build) as expected, silently swallowing a genuine misconfiguration (caught by
/// verify-gate before landing). Anything not matching this exact phrase — malformed pubkey, bad
/// `endpoints`, a null sub-field, any other plugin init failure — returns false and stays
/// fail-fast: a signed release build failing to register the updater for a REAL reason must crash
/// loudly, not vanish into a log line nobody reads (tauri_plugin_log itself is only registered
/// under cfg!(debug_assertions), so a release build's log::warn! is a no-op — see run()'s call
/// site). String-matched on the plugin's own error text, not a public tauri error variant — no
/// public API surfaces "config key was absent vs malformed" more precisely than this; a wording
/// change upstream would revert this to fail-fast-on-dev (loud, immediately visible), not to a
/// silent swallow, so the failure mode of drift here is the safe direction.
fn is_missing_updater_config(err: &tauri::Error) -> bool {
    err.to_string()
        .contains("'plugins.updater' within your Tauri configuration: invalid type: null, expected struct Config")
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
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // plugins.updater only exists in tauri.release.conf.json, merged in by `--config` on
            // the signed release build (.github/workflows/release.yml) — NOT by `npm run tauri
            // build` (.github/workflows/build.yml, unsigned CI smoke-build) nor `tauri dev`. This
            // isn't a debug/release split: cfg!(debug_assertions) can't see whether `--config` was
            // passed, so gating on it just moves the crash from `tauri dev` (caught immediately,
            // 2026-07-24) to every unsigned release-mode build. Fail-fast stays the rule
            // (.claude/rules/rust.md) for anything this process doesn't itself control the cause
            // of: only the ONE specific, classified "config absent" failure is tolerated below
            // (is_missing_updater_config) — a genuine init failure on the signed release build
            // (malformed pubkey, bad endpoints...) still propagates and crashes setup() as before,
            // exactly where it must be loud. log::warn! is a documented best-effort here, not the
            // safety net: tauri_plugin_log itself is debug-only (this same match arm), so a
            // release build's warning is a no-op by construction — the real guardrail is the
            // classifier being narrow enough that anything unexpected still fails hard.
            if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                if is_missing_updater_config(&e) {
                    log::warn!("tauri_plugin_updater not registered (expected without plugins.updater config, e.g. unsigned/dev builds): {e}");
                } else {
                    return Err(e.into());
                }
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
            ipc::reanalyze_tracks,
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
            ipc_library::rekordbox_masterdb_apply_artwork_syncs,
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

#[cfg(test)]
mod updater_config_classification_tests {
    use super::is_missing_updater_config;

    // Verbatim from a real `tauri dev` run (2026-07-24, captured in
    // scratchpad/tauri-dev2.log): "[WARN] tauri_plugin_updater not registered (...): failed to
    // initialize plugin `updater`: Error deserializing 'plugins.updater' within your Tauri
    // configuration: invalid type: null, expected struct Config" — not hand-approximated.
    const ABSENT_CONFIG_MESSAGE: &str = "Error deserializing 'plugins.updater' within your Tauri configuration: invalid type: null, expected struct Config";

    #[test]
    fn absent_config_is_recognized_as_expected() {
        let err =
            tauri::Error::PluginInitialization("updater".into(), ABSENT_CONFIG_MESSAGE.into());
        assert!(is_missing_updater_config(&err));
    }

    #[test]
    fn other_plugin_missing_config_is_not_misclassified() {
        // Same shape of error, different plugin — must not match on a loose two-part contains().
        let err = tauri::Error::PluginInitialization(
            "some-other-plugin".into(),
            "Error deserializing 'plugins.some-other-plugin' within your Tauri configuration: invalid type: null, expected struct Config".into(),
        );
        assert!(!is_missing_updater_config(&err));
    }

    #[test]
    fn genuine_init_failure_without_null_stays_fail_fast() {
        let err = tauri::Error::PluginInitialization(
            "updater".into(),
            "Error deserializing 'plugins.updater': invalid value for 'pubkey': malformed base64"
                .into(),
        );
        assert!(!is_missing_updater_config(&err));
    }

    #[test]
    fn null_subfield_on_an_otherwise_present_config_is_not_misclassified() {
        // The exact gap verify-gate caught in an earlier version of this classifier: a plugin
        // present in tauri.release.conf.json with ONE null field still contains both "updater"
        // and "invalid type: null" somewhere in its message, but is NOT the same failure as the
        // whole `plugins.updater` key being absent — a signed release build with this error is
        // genuinely misconfigured and must still crash setup(), not be silently swallowed.
        let err = tauri::Error::PluginInitialization(
            "updater".into(),
            "Error deserializing 'plugins.updater.pubkey' within your Tauri configuration: invalid type: null, expected a string".into(),
        );
        assert!(!is_missing_updater_config(&err));
    }
}
