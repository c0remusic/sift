//! IPC surface for M6a identification. `identify` queries Discogs (token from settings) and
//! returns ranked candidates; `apply_identity_cmd` downloads the cover (best-effort) and
//! persists the chosen candidate. Errors are flattened to stable sentinel codes the front maps
//! to messages: NO_TOKEN, RATE_LIMITED:<s>, NETWORK, PARSE.

use crate::db;
use crate::metadata::{self, AppliedIdentity, Candidate, MetadataProvider, Query};
use crate::settings;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Query Discogs for `track_id`'s best-guess artist/title; ranked candidates, best first.
#[tauri::command]
pub fn identify(
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
) -> Result<Vec<Candidate>, String> {
    // Chemin sous le verrou, lecture des tags APRÈS l'avoir relâché : une lecture disque ne doit
    // pas geler les autres utilisateurs de la base (même découpage que `ipc_filing::reconcile`).
    let (token, path) = {
        let conn = db::lock_conn(&conn)?;
        let token = settings::get(&conn, settings::DISCOGS_TOKEN)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let path = crate::filing::track_path(&conn, track_id).map_err(|e| e.to_string())?;
        (token, path)
    };
    if token.trim().is_empty() {
        return Err("NO_TOKEN".into());
    }
    let query = build_query(&path);
    let provider = metadata::discogs::Discogs { token };
    provider.search(&query).map_err(|e| e.code())
}

/// Assemble la requête depuis les DEUX sources, chacune dans son domaine de compétence.
///
/// Les tags embarqués priment quand ils sont propres : ils peuvent avoir été corrigés par
/// l'utilisateur, et aucune analyse du nom de fichier ne peut battre une donnée saisie. Sinon —
/// et c'est le cas de 79 % des fichiers dont le nom est sale, mesuré le 2026-07-28 — on s'appuie
/// sur `search_terms`, qui lit le nom ET le dossier parent.
///
/// La version vient TOUJOURS de `search_terms` en priorité : elle est extraite du nom de fichier,
/// où elle figure presque toujours, alors que les tags la portent rarement séparément.
///
/// Note délibérée : cette fonction n'appelle PAS `filing::reconcile_track`. `Canonical` est
/// l'identité qu'on écrit sur le disque et son portail de rejet la rend volontairement timide ;
/// s'en servir comme requête est précisément le défaut que ce chantier corrige. Les deux chemins
/// restent séparés — `ipc_filing::reconcile` continue d'alimenter les champs éditables.
fn build_query(path: &str) -> Query {
    let p = std::path::Path::new(path);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let folder = p
        .parent()
        .and_then(|d| d.file_name())
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();

    let terms = crate::search_terms::build(&stem, &folder);
    let (tag_artist, tag_title) = crate::tagging::read_artist_title(path);
    let tags_clean = crate::naming::is_clean(&tag_artist, &tag_title);

    let (artist, title) = if tags_clean {
        (tag_artist.trim().to_string(), tag_title.trim().to_string())
    } else {
        (terms.artist.clone(), terms.title.clone())
    };

    let mut attempts: Vec<String> = Vec::new();
    if tags_clean {
        attempts.push(format!("{artist} {title}"));
    }
    attempts.extend(terms.ladder.iter().map(|a| a.q.clone()));

    Query {
        artist,
        title,
        version: terms.version,
        attempts,
    }
}

/// Persist a chosen candidate for `track_id`: download its cover (best-effort) then write the
/// metadata + genres. Emits `queue:changed` so the front refreshes.
#[tauri::command]
pub fn apply_identity_cmd(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
    candidate: Candidate,
) -> Result<AppliedIdentity, String> {
    // Gate to a known track before doing any work (network download / DB writes) — mirrors the
    // implicit gate `identify` gets from reconcile_track, so a bogus id can't drive a fetch.
    {
        let conn = db::lock_conn(&conn)?;
        let known = conn
            .query_row(
                "SELECT 1 FROM tracks WHERE id=?1",
                rusqlite::params![track_id],
                |_| Ok(()),
            )
            .is_ok();
        if !known {
            return Err("unknown track id".into());
        }
    }
    let cover_path = candidate.cover_url.as_ref().and_then(|url| {
        let dir = app.path().app_cache_dir().ok()?.join("covers");
        metadata::cover::download_cover(&dir, &candidate.release_id, url)
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    });
    let applied = {
        let conn = db::lock_conn(&conn)?;
        metadata::apply_identity(&conn, track_id, &candidate, cover_path)
            .map_err(|e| e.to_string())?
    };
    app.emit("queue:changed", ()).ok();
    Ok(applied)
}
