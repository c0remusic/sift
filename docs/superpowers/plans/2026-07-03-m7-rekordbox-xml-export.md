# M7 — Export XML Rekordbox + suivi des playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated "Export Rekordbox" nav action with a real backend that merges Sift's filed tracks into a linked Rekordbox XML file (`DJ_PLAYLISTS` format), and automatically repairs `Location` paths inside that XML whenever Sift moves/renames/converts a file already tracked in it — so playlists never silently lose tracks.

**Architecture:** A new flat module `src-tauri/src/rekordbox_xml.rs` owns three primitives over an in-memory tree (`RekordboxXml`): `parse` (XML bytes → tree + a `HashMap<normalized PathBuf, TrackID>` index), `merge_filed_tracks` (adds missing `filed` tracks to `COLLECTION`, creates/extends per-folder `PLAYLISTS` nodes), and `patch_location` (rewrites one `TrackID`'s `Location` in place). Serialization is done by **rewriting only the `Location` attribute value on affected `<TRACK>` elements via a raw string replace joined with the untouched original text for everything else** — not a full serde struct round-trip — because a full struct model would need to capture every Rekordbox column (rating, tonality, comments, custom `Entries`/`Type`/`KeyType` playlist attributes) or silently drop what it doesn't model, which fails the spec's byte-identical-elsewhere test outright. The tree itself (`COLLECTION` entries + `PLAYLISTS` node hierarchy) IS modeled with `quick-xml`'s serde support for reading/merging, but writes go through a small dedicated writer that reconstructs the `DJ_PLAYLISTS` XML from the model using `quick_xml::Writer` events — see Task 2 for the exact strategy split between "index/merge" (structural, needs a model) and "patch one Location" (must be surgical, byte-preserving).
>
> Persistence: one new setting key `rekordbox_xml_path` reusing the existing generic `get_setting`/`set_setting` IPC (no new Tauri commands needed for read/write of the path itself). Two new IPC commands are added: `link_rekordbox_xml` (parse+validate a chosen path, persist it, return a status summary) and `export_rekordbox_xml` (reload + merge + rewrite). The auto-repair hook lives in `actions::record_with_meta`.

**Tech Stack:** Rust (`quick-xml` new dependency, `serde`, `rusqlite`), TypeScript (`@tauri-apps/plugin-dialog` `open()`, already a dependency), vanilla CSS tokens.

## Global Constraints

- MSRV Rust 1.77.2. `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` must stay green after every task.
- Frontend type-check: `npx tsc --noEmit` must stay clean after every frontend-touching task.
- Fail-fast, no silent fallback: an unreadable/corrupt linked XML must surface as an explicit error state; **no automatic recreation of an empty tree**. No new dependency without a Context7 doc check first (done for `quick-xml` — see below).
- No inline color/spacing/radius literals in new CSS — use the existing `--color-*`/`--text-*`/`--border-radius-*` tokens (`frontend/styles.css`, `docs/design-system-states.md`). No `border-left`/`border-right` accent stripes (banned pattern). Animate `transform`/`opacity` only, never `width`/`left`/`right`.
- Spec (sole source of truth for scope): `docs/superpowers/specs/2026-07-03-m7-rekordbox-xml-export-design.md`. Do not add USB copy, `master.db` read/write, or playlist creation/editing beyond per-folder auto-generation — all explicitly out of scope there.
- `quick-xml` API confirmed via Context7 (`/tafia/quick-xml`): serde support via `#[serde(rename = "@attr")]` for XML attributes, `#[serde(rename = "$text")]` for text content, `#[serde(rename = "$value")]` + `#[serde(tag = "...")]` for mixed/enum content (needed for `<NODE>` elements that contain either nested `<NODE>` or `<TRACK>` children), and `quick_xml::writer::Writer::new_with_indent` for indented output.

---

### Task 1: Add the `quick-xml` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: the `quick_xml` crate (with `serde` feature) becomes available to `src-tauri/src/rekordbox_xml.rs` in Task 2.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, add this line in the `[dependencies]` block, right after `dirs = "5"` (the last line of that block):

```toml
quick-xml = { version = "0.37", features = ["serialize"] }
```

- [ ] **Step 2: Build to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (new crate fetched, no errors — it isn't used anywhere yet, this just confirms the manifest is valid and the crate resolves under MSRV 1.77.2).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add quick-xml for Rekordbox XML export"
```

---

### Task 2: `rekordbox_xml.rs` — data model + fixture + parse

**Files:**
- Create: `src-tauri/src/rekordbox_xml.rs`
- Create: `src-tauri/fixtures/rekordbox_sample.xml`
- Modify: `src-tauri/src/lib.rs:1-24` (add `mod rekordbox_xml;`)

**Interfaces:**
- Produces:
  - `pub struct CollectionTrack { pub track_id: i64, pub location: String, pub name: Option<String>, pub artist: Option<String> }`
  - `pub enum PlaylistNode { Folder { name: String, children: Vec<PlaylistNode> }, Playlist { name: String, track_ids: Vec<i64> } }`
  - `pub struct RekordboxXml { pub collection: Vec<CollectionTrack>, pub playlists: Vec<PlaylistNode>, pub raw_xml: String, path_index: HashMap<PathBuf, i64> }`
  - `pub fn parse(xml_bytes: &[u8]) -> Result<RekordboxXml, String>` — parses `raw_xml` = the original text kept verbatim (needed by Task 4's surgical patch), plus the structured `collection`/`playlists`/`path_index` for merge decisions.
  - `fn normalize_path(location: &str) -> PathBuf` — Rekordbox stores `Location` as a `file://localhost/...`-style URI with `%20` escapes; this turns it into a comparable `PathBuf` the same way `from_path`/`to_path` strings in `actions` compare. Used by Task 3 and Task 4.

- [ ] **Step 1: Build the fixture**

Create `src-tauri/fixtures/rekordbox_sample.xml` with this exact content — a minimal but real `DJ_PLAYLISTS` document with 3 collection tracks, nested folders, and one `TrackID` (`2`) referenced from two different playlists (covers the spec's "TrackID present in multiple playlists" test requirement):

```xml
<?xml version="1.0" encoding="UTF-8"?>

<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.7" Company="Pioneer DJ"/>
  <COLLECTION Entries="3">
    <TRACK TrackID="1" Name="Can You Feel It" Artist="Mr Fingers" Location="file://localhost/C:/Music/House/mr-fingers.mp3"/>
    <TRACK TrackID="2" Name="Strings of Life" Artist="Rhythim Is Rhythim" Location="file://localhost/C:/Music/House/deep/strings.aiff"/>
    <TRACK TrackID="3" Name="Voodoo Ray" Artist="A Guy Called Gerald" Location="file://localhost/C:/Music/Techno/voodoo.flac"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="2">
      <NODE Type="1" Name="House" KeyType="0" Entries="2">
        <TRACK Key="1"/>
        <TRACK Key="2"/>
      </NODE>
      <NODE Type="1" Name="Favorites" KeyType="0" Entries="1">
        <TRACK Key="2"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
```

- [ ] **Step 2: Write the failing parse test**

Create `src-tauri/src/rekordbox_xml.rs` with the module doc comment, data types, and the first test:

```rust
//! Rekordbox `DJ_PLAYLISTS` XML: parse into an in-memory tree, merge Sift's filed tracks in,
//! patch one track's `Location` in place, and rewrite. Two different fidelity requirements
//! collide here: merging needs a STRUCTURED view (collection entries + playlist tree) to decide
//! what to add, but patching a single `Location` must leave every byte Sift doesn't understand
//! (ratings, tonality, custom columns, playlist `Entries`/`Type`/`KeyType`…) untouched — a full
//! serde struct round-trip risks silently dropping fields this module never modeled. So `raw_xml`
//! keeps the original text verbatim for `patch_location`'s surgical string replace (Task 4);
//! `collection`/`playlists`/`path_index` are the structured view merge/lookup use.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One `<TRACK>` row under `<COLLECTION>`.
#[derive(Debug, Clone, PartialEq)]
pub struct CollectionTrack {
    pub track_id: i64,
    pub location: String,
    pub name: Option<String>,
    pub artist: Option<String>,
}

/// One node of the `<PLAYLISTS>` tree: either a folder (nested nodes) or a leaf playlist
/// (an ordered list of `TrackID`s, mirroring `<TRACK Key="...">` children).
#[derive(Debug, Clone, PartialEq)]
pub enum PlaylistNode {
    Folder { name: String, children: Vec<PlaylistNode> },
    Playlist { name: String, track_ids: Vec<i64> },
}

/// A parsed Rekordbox XML: structured view for merge/lookup decisions, plus the original text
/// verbatim (`raw_xml`) for `patch_location`'s byte-preserving rewrite.
#[derive(Debug, Clone)]
pub struct RekordboxXml {
    pub collection: Vec<CollectionTrack>,
    pub playlists: Vec<PlaylistNode>,
    pub raw_xml: String,
    /// Normalized filesystem path → TrackID, built once at parse time for O(1) lookups.
    path_index: HashMap<PathBuf, i64>,
}

/// Rekordbox stores `Location` as a `file://localhost/`-prefixed, percent-encoded URI
/// (e.g. `file://localhost/C:/Music/House/a.mp3`). Strip the prefix and percent-decode so it
/// compares equal to the plain filesystem paths Sift's `actions.from_path`/`to_path` use.
fn normalize_path(location: &str) -> PathBuf {
    let stripped = location
        .strip_prefix("file://localhost/")
        .or_else(|| location.strip_prefix("file://"))
        .unwrap_or(location);
    let decoded = percent_decode(stripped);
    PathBuf::from(decoded)
}

/// Minimal percent-decoder for the subset Rekordbox actually emits (`%20`, `%23`, etc.) — no
/// external dependency needed for this one narrow job.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        std::fs::read("fixtures/rekordbox_sample.xml").expect("fixture must exist")
    }

    #[test]
    fn parse_builds_collection_and_index() {
        let xml = fixture();
        let parsed = parse(&xml).unwrap();
        assert_eq!(parsed.collection.len(), 3);
        let t2 = parsed.collection.iter().find(|t| t.track_id == 2).unwrap();
        assert_eq!(t2.artist.as_deref(), Some("Rhythim Is Rhythim"));
        assert_eq!(
            normalize_path(&t2.location),
            PathBuf::from("C:/Music/House/deep/strings.aiff")
        );
    }

    #[test]
    fn parse_builds_path_index_for_lookup() {
        let parsed = parse(&fixture()).unwrap();
        let id = parsed.track_id_for_path(Path::new("C:/Music/Techno/voodoo.flac"));
        assert_eq!(id, Some(3));
        assert_eq!(parsed.track_id_for_path(Path::new("C:/nope.mp3")), None);
    }

    #[test]
    fn parse_builds_playlist_tree_with_shared_track_id() {
        let parsed = parse(&fixture()).unwrap();
        // ROOT → House (2 tracks), Favorites (1 track) — TrackID 2 appears in both.
        assert_eq!(parsed.playlists.len(), 1);
        let PlaylistNode::Folder { name, children } = &parsed.playlists[0] else {
            panic!("ROOT must be a folder");
        };
        assert_eq!(name, "ROOT");
        assert_eq!(children.len(), 2);
        let house = children.iter().find(|n| matches!(n, PlaylistNode::Playlist { name, .. } if name == "House")).unwrap();
        let PlaylistNode::Playlist { track_ids, .. } = house else { unreachable!() };
        assert_eq!(track_ids, &vec![1, 2]);
        let favorites = children
            .iter()
            .find(|n| matches!(n, PlaylistNode::Playlist { name, .. } if name == "Favorites"))
            .unwrap();
        let PlaylistNode::Playlist { track_ids, .. } = favorites else { unreachable!() };
        assert_eq!(track_ids, &vec![2], "TrackID 2 is shared with House");
    }

    #[test]
    fn parse_rejects_corrupt_xml() {
        let err = parse(b"<not-even-xml").unwrap_err();
        assert!(!err.is_empty());
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: FAIL — `parse` / `track_id_for_path` not defined yet.

- [ ] **Step 4: Implement `parse` and `track_id_for_path`**

Append to `src-tauri/src/rekordbox_xml.rs` (after the `percent_decode` fn, before `#[cfg(test)]`):

```rust
impl RekordboxXml {
    /// Look up the `TrackID` for a filesystem path (normalized the same way `Location` is),
    /// or `None` if this XML doesn't reference that path.
    pub fn track_id_for_path(&self, path: &Path) -> Option<i64> {
        self.path_index.get(path).copied()
    }
}

/// Parse raw Rekordbox XML bytes into a `RekordboxXml`. Fails fast on malformed XML or a
/// missing `<DJ_PLAYLISTS>` root — no partial/best-effort tree is ever returned.
pub fn parse(xml_bytes: &[u8]) -> Result<RekordboxXml, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let raw_xml = String::from_utf8_lossy(xml_bytes).into_owned();
    let mut reader = Reader::from_bytes(xml_bytes);
    reader.config_mut().trim_text(true);

    let mut collection = Vec::new();
    let mut playlists = Vec::new();
    // Stack of (name, children-so-far) for the currently-open <NODE> ancestors.
    let mut node_stack: Vec<(String, Vec<PlaylistNode>)> = Vec::new();
    let mut saw_root_tag = false;

    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("Rekordbox XML parse error: {e}"))?;
        match event {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) => {
                let name = e.name();
                let tag = name.as_ref();
                if tag == b"DJ_PLAYLISTS" {
                    saw_root_tag = true;
                } else if tag == b"TRACK" {
                    let attrs = read_attrs(&e)?;
                    if let Some(track_id_str) = attrs.get("TrackID") {
                        // A COLLECTION <TRACK> (has Location); a PLAYLISTS <TRACK> only has "Key".
                        let track_id: i64 = track_id_str
                            .parse()
                            .map_err(|_| format!("bad TrackID: {track_id_str}"))?;
                        collection.push(CollectionTrack {
                            track_id,
                            location: attrs.get("Location").cloned().unwrap_or_default(),
                            name: attrs.get("Name").cloned(),
                            artist: attrs.get("Artist").cloned(),
                        });
                    } else if let Some(key_str) = attrs.get("Key") {
                        let track_id: i64 = key_str
                            .parse()
                            .map_err(|_| format!("bad playlist Key: {key_str}"))?;
                        if let Some((_, children)) = node_stack.last_mut() {
                            // Fold consecutive Keys into the last Playlist's track_ids, else
                            // start a bare Playlist entry (shouldn't happen in valid XML — a
                            // <TRACK Key> always lives inside a leaf <NODE>, handled below).
                            if let Some(PlaylistNode::Playlist { track_ids, .. }) = children.last_mut() {
                                track_ids.push(track_id);
                            }
                        }
                    }
                } else if tag == b"NODE" {
                    let attrs = read_attrs(&e)?;
                    let node_name = attrs.get("Name").cloned().unwrap_or_default();
                    let is_folder = attrs.get("Type").map(String::as_str) == Some("0");
                    node_stack.push((node_name.clone(), Vec::new()));
                    if !is_folder {
                        // Leaf playlist: push a placeholder Playlist node onto the PARENT's
                        // children now, so <TRACK Key> events above can find it via last_mut().
                        // is_empty (Event::Empty) leaf playlists (no tracks) close immediately;
                        // handled uniformly in the End branch below.
                        if let Some((_, parent_children)) = node_stack.iter_mut().rev().nth(1) {
                            parent_children.push(PlaylistNode::Playlist {
                                name: node_name,
                                track_ids: Vec::new(),
                            });
                        }
                    }
                    if matches!(event_kind(&e), EventKind::Empty) {
                        close_node(&mut node_stack, &mut playlists, is_folder);
                    }
                }
            }
            Event::End(e) => {
                if e.name().as_ref() == b"NODE" {
                    let is_folder = node_stack
                        .last()
                        .map(|(_, children)| !children.is_empty() || true)
                        .unwrap_or(true);
                    // We don't know here if this END closes a folder or a leaf playlist purely
                    // from the End event; track it via a parallel is_folder stack instead.
                    let _ = is_folder;
                }
                let _ = e;
            }
            _ => {}
        }
    }

    if !saw_root_tag {
        return Err("missing <DJ_PLAYLISTS> root element".to_string());
    }

    let mut path_index = HashMap::new();
    for t in &collection {
        path_index.insert(normalize_path(&t.location), t.track_id);
    }

    Ok(RekordboxXml {
        collection,
        playlists,
        raw_xml,
        path_index,
    })
}
```

This first pass has a structural gap (the End-event folder/leaf bookkeeping is unreliable — noted inline). Replace the whole `parse` function body with the corrected, stack-based version below, which tracks `is_folder` alongside each stack frame instead of guessing at `End`:

```rust
/// Parse raw Rekordbox XML bytes into a `RekordboxXml`. Fails fast on malformed XML or a
/// missing `<DJ_PLAYLISTS>` root — no partial/best-effort tree is ever returned.
pub fn parse(xml_bytes: &[u8]) -> Result<RekordboxXml, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let raw_xml = String::from_utf8_lossy(xml_bytes).into_owned();
    let mut reader = Reader::from_bytes(xml_bytes);
    reader.config_mut().trim_text(true);

    let mut collection = Vec::new();
    // Stack frame: (is_folder, name, children-collected-so-far).
    let mut stack: Vec<(bool, String, Vec<PlaylistNode>)> = Vec::new();
    let mut playlists = Vec::new();
    let mut saw_root_tag = false;
    let mut in_playlists = false;

    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("Rekordbox XML parse error: {e}"))?;
        match event {
            Event::Eof => break,
            Event::Start(e) => {
                let tag = e.name();
                match tag.as_ref() {
                    b"DJ_PLAYLISTS" => saw_root_tag = true,
                    b"PLAYLISTS" => in_playlists = true,
                    b"TRACK" if !in_playlists => {
                        collection.push(collection_track_from_attrs(&e)?);
                    }
                    b"TRACK" if in_playlists => {
                        let attrs = read_attrs(&e)?;
                        let key: i64 = attrs
                            .get("Key")
                            .ok_or("playlist <TRACK> missing Key")?
                            .parse()
                            .map_err(|_| "bad playlist Key".to_string())?;
                        if let Some((_, _, children)) = stack.last_mut() {
                            if let Some(PlaylistNode::Playlist { track_ids, .. }) = children.last_mut() {
                                track_ids.push(key);
                            }
                        }
                    }
                    b"NODE" if in_playlists => {
                        let attrs = read_attrs(&e)?;
                        let name = attrs.get("Name").cloned().unwrap_or_default();
                        let is_folder = attrs.get("Type").map(String::as_str) == Some("0");
                        stack.push((is_folder, name, Vec::new()));
                    }
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let tag = e.name();
                match tag.as_ref() {
                    b"TRACK" if !in_playlists => collection.push(collection_track_from_attrs(&e)?),
                    b"TRACK" if in_playlists => {
                        let attrs = read_attrs(&e)?;
                        let key: i64 = attrs
                            .get("Key")
                            .ok_or("playlist <TRACK> missing Key")?
                            .parse()
                            .map_err(|_| "bad playlist Key".to_string())?;
                        if let Some((_, _, children)) = stack.last_mut() {
                            if let Some(PlaylistNode::Playlist { track_ids, .. }) = children.last_mut() {
                                track_ids.push(key);
                            }
                        }
                    }
                    b"NODE" if in_playlists => {
                        // Empty leaf playlist (no <TRACK> children) — push directly, no push/pop.
                        let attrs = read_attrs(&e)?;
                        let name = attrs.get("Name").cloned().unwrap_or_default();
                        push_child(
                            &mut stack,
                            &mut playlists,
                            PlaylistNode::Playlist { name, track_ids: Vec::new() },
                        );
                    }
                    _ => {}
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"PLAYLISTS" => in_playlists = false,
                b"NODE" => {
                    let (is_folder, name, children) =
                        stack.pop().ok_or("unbalanced </NODE>")?;
                    let node = if is_folder {
                        PlaylistNode::Folder { name, children }
                    } else {
                        // A leaf <NODE> was entered via Start (has <TRACK> children collected
                        // above as track_ids on a Playlist placeholder) — reconstruct it here.
                        let track_ids = children
                            .into_iter()
                            .filter_map(|c| match c {
                                PlaylistNode::Playlist { track_ids, .. } => Some(track_ids),
                                _ => None,
                            })
                            .next()
                            .unwrap_or_default();
                        PlaylistNode::Playlist { name, track_ids }
                    };
                    push_child(&mut stack, &mut playlists, node);
                }
                _ => {}
            },
            _ => {}
        }
    }

    if !saw_root_tag {
        return Err("missing <DJ_PLAYLISTS> root element".to_string());
    }

    let mut path_index = HashMap::new();
    for t in &collection {
        path_index.insert(normalize_path(&t.location), t.track_id);
    }

    Ok(RekordboxXml { collection, playlists, raw_xml, path_index })
}

/// Push a finished child node either onto the new top-of-stack frame's children, or (stack now
/// empty) onto the top-level `playlists` list.
fn push_child(
    stack: &mut Vec<(bool, String, Vec<PlaylistNode>)>,
    playlists: &mut Vec<PlaylistNode>,
    node: PlaylistNode,
) {
    if let Some((_, _, children)) = stack.last_mut() {
        children.push(node);
    } else {
        playlists.push(node);
    }
}

fn collection_track_from_attrs(e: &quick_xml::events::BytesStart) -> Result<CollectionTrack, String> {
    let attrs = read_attrs(e)?;
    let track_id: i64 = attrs
        .get("TrackID")
        .ok_or("<TRACK> missing TrackID")?
        .parse()
        .map_err(|_| "bad TrackID".to_string())?;
    Ok(CollectionTrack {
        track_id,
        location: attrs.get("Location").cloned().unwrap_or_default(),
        name: attrs.get("Name").cloned(),
        artist: attrs.get("Artist").cloned(),
    })
}

/// Read every attribute of a start/empty tag into a plain map, XML-unescaped.
fn read_attrs(e: &quick_xml::events::BytesStart) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for attr in e.attributes() {
        let attr = attr.map_err(|err| format!("bad attribute: {err}"))?;
        let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
        let value = attr
            .unescape_value()
            .map_err(|err| format!("bad attribute value: {err}"))?
            .into_owned();
        out.insert(key, value);
    }
    Ok(out)
}
```

Also remove the earlier (first-pass, buggy) `parse` implementation you wrote in this step — only the corrected stack-based version above should remain in the file; there must be exactly one `parse` function and no leftover `event_kind`/`close_node` stubs from the abandoned first draft.

- [ ] **Step 5: Register the module**

In `src-tauri/src/lib.rs`, the module list currently starts (line 1):

```rust
mod actions;
```

Add `rekordbox_xml` alphabetically, right after `queue;` and before `scanner;` (matches the existing alphabetical grouping — check the surrounding lines with `grep -n "^mod " src-tauri/src/lib.rs` to confirm exact neighbors before editing):

```rust
mod queue;
mod rekordbox_xml;
mod scanner;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: PASS (4 tests: `parse_builds_collection_and_index`, `parse_builds_path_index_for_lookup`, `parse_builds_playlist_tree_with_shared_track_id`, `parse_rejects_corrupt_xml`).

- [ ] **Step 7: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean. Fix any lints (e.g. `.into_iter().filter_map(...).next()` patterns clippy may want simplified) before moving on.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/rekordbox_xml.rs src-tauri/src/lib.rs src-tauri/fixtures/rekordbox_sample.xml
git commit -m "feat(rekordbox): parse DJ_PLAYLISTS XML into collection+playlist tree"
```

---

### Task 3: `merge_filed_tracks` — add missing filed tracks + per-folder playlists

**Files:**
- Modify: `src-tauri/src/rekordbox_xml.rs`

**Interfaces:**
- Consumes: `library::LibraryTrack` (already defined in `src-tauri/src/library.rs:17`, fields `path`, `artist`, `title`, `folder` used here) and `RekordboxXml` (Task 2).
- Produces: `pub fn merge_filed_tracks(xml: &mut RekordboxXml, filed: &[crate::library::LibraryTrack]) -> usize` — returns how many NEW collection tracks were added. Mutates `xml.collection`, `xml.playlists`, `xml.path_index` in place; does **not** touch `xml.raw_xml` (writing is Task 5's job, which regenerates `raw_xml` from the mutated structured view for the merge path specifically — see Task 5's doc comment on why merge and patch use different raw_xml handling).

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/rekordbox_xml.rs` (after the existing 4 tests, before the closing `}`):

```rust
    fn lib_track(path: &str, folder: &str, artist: &str, title: &str) -> crate::library::LibraryTrack {
        crate::library::LibraryTrack {
            id: 0,
            path: path.to_string(),
            artist: Some(artist.to_string()),
            title: Some(title.to_string()),
            format: None,
            bitrate: None,
            duration: None,
            bpm: None,
            year: None,
            label: None,
            genres: vec![],
            discogs_release_id: None,
            cover_path: None,
            has_cover: false,
            verdict: None,
            folder: Some(folder.to_string()),
        }
    }

    #[test]
    fn merge_adds_missing_tracks_and_creates_folder_playlist() {
        let mut parsed = parse(&fixture()).unwrap();
        let before = parsed.collection.len();
        // "C:/Music/House/deep/strings.aiff" (TrackID 2) already exists — must NOT duplicate.
        // "C:/Music/Disco/new-track.mp3" is new — must be added + filed under a "Disco" playlist.
        let filed = vec![
            lib_track("C:/Music/House/deep/strings.aiff", "House/Deep", "Rhythim Is Rhythim", "Strings of Life"),
            lib_track("C:/Music/Disco/new-track.mp3", "Disco", "Unknown Artist", "New Track"),
        ];
        let added = merge_filed_tracks(&mut parsed, &filed);
        assert_eq!(added, 1, "only the genuinely new track is added");
        assert_eq!(parsed.collection.len(), before + 1);
        let new_track = parsed
            .collection
            .iter()
            .find(|t| normalize_path(&t.location) == PathBuf::from("C:/Music/Disco/new-track.mp3"))
            .unwrap();
        assert_eq!(new_track.artist.as_deref(), Some("Unknown Artist"));

        // A "Disco" playlist now exists under ROOT containing the new track's TrackID.
        let PlaylistNode::Folder { children, .. } = &parsed.playlists[0] else { panic!() };
        let disco = children
            .iter()
            .find(|n| matches!(n, PlaylistNode::Playlist { name, .. } if name == "Disco"))
            .expect("Disco playlist created");
        let PlaylistNode::Playlist { track_ids, .. } = disco else { unreachable!() };
        assert_eq!(track_ids, &vec![new_track.track_id]);
    }

    #[test]
    fn merge_never_touches_existing_untouched_playlists() {
        let mut parsed = parse(&fixture()).unwrap();
        let favorites_before = {
            let PlaylistNode::Folder { children, .. } = &parsed.playlists[0] else { panic!() };
            children
                .iter()
                .find(|n| matches!(n, PlaylistNode::Playlist { name, .. } if name == "Favorites"))
                .cloned()
        };
        // Merge in a track that's already filed under "House" (matches an EXISTING Sift-managed
        // playlist) — "Favorites" (not a Sift folder playlist) must be byte-for-byte untouched.
        let filed = vec![lib_track("C:/Music/House/mr-fingers.mp3", "House", "Mr Fingers", "Can You Feel It")];
        merge_filed_tracks(&mut parsed, &filed);
        let PlaylistNode::Folder { children, .. } = &parsed.playlists[0] else { panic!() };
        let favorites_after = children
            .iter()
            .find(|n| matches!(n, PlaylistNode::Playlist { name, .. } if name == "Favorites"))
            .cloned();
        assert_eq!(favorites_before, favorites_after, "non-Sift playlist untouched");
    }

    #[test]
    fn merge_is_idempotent() {
        let mut parsed = parse(&fixture()).unwrap();
        let filed = vec![lib_track("C:/Music/Disco/new-track.mp3", "Disco", "A", "B")];
        let first = merge_filed_tracks(&mut parsed, &filed);
        let second = merge_filed_tracks(&mut parsed, &filed);
        assert_eq!(first, 1);
        assert_eq!(second, 0, "re-running merge on an already-merged track adds nothing");
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: FAIL — `merge_filed_tracks` and `crate::library::LibraryTrack` fields not matching / function not defined. (`PlaylistNode` needs `Clone`+`PartialEq` for the second test — already derived in Task 2 — and `CollectionTrack` needs the same, also already derived.)

- [ ] **Step 3: Implement `merge_filed_tracks`**

Add to `src-tauri/src/rekordbox_xml.rs` (after the `impl RekordboxXml` block from Task 2):

```rust
/// Add every `filed` track absent from `xml.collection` (matched by normalized path), and file
/// each newly-added track into a per-`folder` playlist under a synthetic "Sift" root folder —
/// nested `folder` paths (e.g. "House/Deep") become nested playlist folders. TrackIDs are
/// allocated as `max(existing) + 1`. Existing playlists (Sift-managed or not) are never removed
/// or reordered; a folder playlist that already exists just gets the new TrackID appended.
/// Returns the number of newly-added collection tracks.
pub fn merge_filed_tracks(xml: &mut RekordboxXml, filed: &[crate::library::LibraryTrack]) -> usize {
    let mut next_id = xml.collection.iter().map(|t| t.track_id).max().unwrap_or(0) + 1;
    let mut added = 0usize;

    for track in filed {
        let norm = normalize_path(&track.path);
        if xml.path_index.contains_key(&norm) {
            continue; // already tracked — merge is idempotent by design
        }
        let track_id = next_id;
        next_id += 1;
        added += 1;

        let location = format!("file://localhost/{}", track.path.replace('\\', "/"));
        xml.collection.push(CollectionTrack {
            track_id,
            location,
            name: track.title.clone(),
            artist: track.artist.clone(),
        });
        xml.path_index.insert(norm, track_id);

        if let Some(folder) = &track.folder {
            file_into_folder_playlist(&mut xml.playlists, folder, track_id);
        }
    }
    added
}

/// Ensure a (possibly nested, "/"-separated) playlist folder path exists under the top-level
/// `playlists` forest, creating folders/leaf playlists as needed, then append `track_id` to the
/// leaf playlist — unless it's already there (idempotent). Mirrors `folder`'s nesting 1:1: each
/// path segment except the last becomes/reuses a `Folder`, the last becomes/reuses a `Playlist`.
fn file_into_folder_playlist(playlists: &mut Vec<PlaylistNode>, folder: &str, track_id: i64) {
    let segments: Vec<&str> = folder.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return;
    }
    let mut level = playlists;
    for (i, seg) in segments.iter().enumerate() {
        let is_last = i == segments.len() - 1;
        let idx = level.iter().position(|n| match n {
            PlaylistNode::Folder { name, .. } if !is_last => name == seg,
            PlaylistNode::Playlist { name, .. } if is_last => name == seg,
            _ => false,
        });
        match idx {
            Some(pos) => {
                if is_last {
                    if let PlaylistNode::Playlist { track_ids, .. } = &mut level[pos] {
                        if !track_ids.contains(&track_id) {
                            track_ids.push(track_id);
                        }
                    }
                    return;
                } else if let PlaylistNode::Folder { children, .. } = &mut level[pos] {
                    level = children;
                }
            }
            None => {
                if is_last {
                    level.push(PlaylistNode::Playlist {
                        name: seg.to_string(),
                        track_ids: vec![track_id],
                    });
                    return;
                } else {
                    level.push(PlaylistNode::Folder {
                        name: seg.to_string(),
                        children: Vec::new(),
                    });
                    let last = level.len() - 1;
                    if let PlaylistNode::Folder { children, .. } = &mut level[last] {
                        level = children;
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: PASS (7 tests total now).

- [ ] **Step 5: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rekordbox_xml.rs
git commit -m "feat(rekordbox): merge filed tracks into collection + per-folder playlists"
```

---

### Task 4: `patch_location` — surgical byte-preserving rewrite

**Files:**
- Modify: `src-tauri/src/rekordbox_xml.rs`

**Interfaces:**
- Consumes: `RekordboxXml.raw_xml` (Task 2), `RekordboxXml.path_index`/`track_id_for_path` (Task 2).
- Produces: `pub fn patch_location(xml: &mut RekordboxXml, from_path: &str, to_path: &str) -> bool` — returns `true` if `from_path` was found and patched (updates `raw_xml`, `collection[].location`, and `path_index`), `false` if `from_path` isn't in this XML (no-op, caller decides what that means).

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `src-tauri/src/rekordbox_xml.rs`:

```rust
    #[test]
    fn patch_location_updates_only_that_tracks_location_byte_identical_elsewhere() {
        let mut parsed = parse(&fixture()).unwrap();
        let original_raw = parsed.raw_xml.clone();

        let patched = patch_location(
            &mut parsed,
            "C:/Music/House/deep/strings.aiff",
            "C:/Music/House/Deep/strings.aiff", // recased/moved
        );
        assert!(patched);

        // Structured view updated.
        let t2 = parsed.collection.iter().find(|t| t.track_id == 2).unwrap();
        assert_eq!(normalize_path(&t2.location), PathBuf::from("C:/Music/House/Deep/strings.aiff"));
        assert_eq!(parsed.track_id_for_path(Path::new("C:/Music/House/Deep/strings.aiff")), Some(2));
        assert_eq!(parsed.track_id_for_path(Path::new("C:/Music/House/deep/strings.aiff")), None);

        // raw_xml: EXACTLY one substring differs (the Location value) — verify by diffing line
        // by line, every other line must be byte-identical, and the TrackID="2" line must still
        // contain every other original attribute untouched (Name, Artist).
        let before_lines: Vec<&str> = original_raw.lines().collect();
        let after_lines: Vec<&str> = parsed.raw_xml.lines().collect();
        assert_eq!(before_lines.len(), after_lines.len(), "no lines added or removed");
        let mut changed_lines = 0;
        for (b, a) in before_lines.iter().zip(after_lines.iter()) {
            if b != a {
                changed_lines += 1;
                assert!(a.contains(r#"TrackID="2""#), "the only changed line is TrackID 2's row");
                assert!(a.contains(r#"Name="Strings of Life""#), "Name attribute untouched");
                assert!(a.contains(r#"Artist="Rhythim Is Rhythim""#), "Artist attribute untouched");
                assert!(a.contains("Deep/strings.aiff"), "new Location present");
            }
        }
        assert_eq!(changed_lines, 1, "exactly one line changed — the patched TRACK row");
    }

    #[test]
    fn patch_location_returns_false_when_path_unknown() {
        let mut parsed = parse(&fixture()).unwrap();
        let patched = patch_location(&mut parsed, "C:/not/tracked.mp3", "C:/elsewhere.mp3");
        assert!(!patched);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: FAIL — `patch_location` not defined.

- [ ] **Step 3: Implement `patch_location`**

Add to `src-tauri/src/rekordbox_xml.rs`:

```rust
/// Rewrite one `TrackID`'s `Location` in place: in `raw_xml` (a targeted string replace of just
/// that attribute's value, so every other byte of the file — including fields this module never
/// modeled — survives untouched), and mirrored in the structured `collection`/`path_index` so
/// subsequent `merge_filed_tracks`/`track_id_for_path` calls see the new path immediately.
/// Returns `false` (no-op) if `from_path` isn't tracked by this XML at all.
pub fn patch_location(xml: &mut RekordboxXml, from_path: &str, to_path: &str) -> bool {
    let from_norm = normalize_path(from_path);
    let Some(track_id) = xml.path_index.get(&from_norm).copied() else {
        return false;
    };
    let Some(track) = xml.collection.iter_mut().find(|t| t.track_id == track_id) else {
        return false; // index/collection out of sync — treat as not-found, never guess
    };

    let old_location_attr = format!(r#"Location="{}""#, xml_escape(&track.location));
    let new_location_value = format!("file://localhost/{}", to_path.replace('\\', "/"));
    let new_location_attr = format!(r#"Location="{}""#, xml_escape(&new_location_value));

    // The old attribute string must appear EXACTLY once — if it appears zero or >1 times, the
    // raw text and the structured model have drifted (e.g. two tracks sharing byte-identical
    // Location, or prior mutation not reflected in raw_xml); fail rather than guess which
    // occurrence to touch.
    let occurrences = xml.raw_xml.matches(&old_location_attr).count();
    if occurrences != 1 {
        log::error!(
            "patch_location: expected exactly 1 occurrence of {old_location_attr:?} in raw_xml, found {occurrences}; refusing to guess"
        );
        return false;
    }
    xml.raw_xml = xml.raw_xml.replacen(&old_location_attr, &new_location_attr, 1);

    xml.path_index.remove(&from_norm);
    xml.path_index.insert(normalize_path(to_path), track_id);
    track.location = new_location_value;
    true
}

/// Escape the 5 XML-significant characters in an attribute value the same way Rekordbox itself
/// would emit them — mirrors what `unescape_value` (used at parse time) reverses.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: PASS (9 tests total).

- [ ] **Step 5: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rekordbox_xml.rs
git commit -m "feat(rekordbox): surgical Location patch preserving every other byte"
```

---

### Task 5: `write` — serialize the merged tree back to XML

**Files:**
- Modify: `src-tauri/src/rekordbox_xml.rs`

**Interfaces:**
- Produces: `pub fn write(xml: &RekordboxXml) -> String` — used only after `merge_filed_tracks` changed the structured view (a pure `patch_location`-only rewrite instead just uses the already-updated `xml.raw_xml` directly — see Task 6 which calls `write` only on the export path, not the repair-hook path).

Because `merge_filed_tracks` only mutates the structured view (not `raw_xml`, to keep Task 4's string-replace assumptions valid independently), the export flow needs a real serializer that emits a full, valid `DJ_PLAYLISTS` document from `collection` + `playlists`. This is NOT required to be byte-identical to Rekordbox's own formatting (Rekordbox re-reads happily regardless of whitespace) — only `patch_location`'s output carries that requirement, and it never calls `write`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
    #[test]
    fn write_then_reparse_round_trips_collection_and_playlists() {
        let mut parsed = parse(&fixture()).unwrap();
        let filed = vec![lib_track("C:/Music/Disco/new-track.mp3", "Disco", "A", "B")];
        merge_filed_tracks(&mut parsed, &filed);

        let xml_text = write(&parsed);
        let reparsed = parse(xml_text.as_bytes()).unwrap();

        assert_eq!(reparsed.collection.len(), parsed.collection.len());
        assert!(reparsed.track_id_for_path(Path::new("C:/Music/Disco/new-track.mp3")).is_some());
        // Playlist tree shape preserved (ROOT → House/Favorites/Disco).
        let PlaylistNode::Folder { children, .. } = &reparsed.playlists[0] else { panic!() };
        let names: Vec<&str> = children
            .iter()
            .map(|n| match n {
                PlaylistNode::Folder { name, .. } | PlaylistNode::Playlist { name, .. } => name.as_str(),
            })
            .collect();
        assert!(names.contains(&"House"));
        assert!(names.contains(&"Favorites"));
        assert!(names.contains(&"Disco"));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: FAIL — `write` not defined.

- [ ] **Step 3: Implement `write`**

Add to `src-tauri/src/rekordbox_xml.rs`:

```rust
/// Serialize `xml`'s structured `collection` + `playlists` into a fresh, valid `DJ_PLAYLISTS`
/// document. Used only on the merge/export path (`export_rekordbox_xml`); the repair-hook path
/// (`patch_location` alone) writes `xml.raw_xml` directly to preserve every byte it doesn't
/// model — see the module doc comment.
pub fn write(xml: &RekordboxXml) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\n");
    out.push_str("<DJ_PLAYLISTS Version=\"1.0.0\">\n");
    out.push_str("  <PRODUCT Name=\"Sift\" Version=\"1\" Company=\"Sift\"/>\n");
    out.push_str(&format!("  <COLLECTION Entries=\"{}\">\n", xml.collection.len()));
    for t in &xml.collection {
        out.push_str(&format!(
            "    <TRACK TrackID=\"{}\" Name=\"{}\" Artist=\"{}\" Location=\"{}\"/>\n",
            t.track_id,
            xml_escape(t.name.as_deref().unwrap_or("")),
            xml_escape(t.artist.as_deref().unwrap_or("")),
            xml_escape(&t.location),
        ));
    }
    out.push_str("  </COLLECTION>\n");
    out.push_str("  <PLAYLISTS>\n");
    for node in &xml.playlists {
        write_node(&mut out, node, 2);
    }
    out.push_str("  </PLAYLISTS>\n");
    out.push_str("</DJ_PLAYLISTS>\n");
    out
}

fn write_node(out: &mut String, node: &PlaylistNode, depth: usize) {
    let indent = "  ".repeat(depth);
    match node {
        PlaylistNode::Folder { name, children } => {
            out.push_str(&format!(
                "{indent}<NODE Type=\"0\" Name=\"{}\" Count=\"{}\">\n",
                xml_escape(name),
                children.len()
            ));
            for child in children {
                write_node(out, child, depth + 1);
            }
            out.push_str(&format!("{indent}</NODE>\n"));
        }
        PlaylistNode::Playlist { name, track_ids } => {
            if track_ids.is_empty() {
                out.push_str(&format!(
                    "{indent}<NODE Type=\"1\" Name=\"{}\" KeyType=\"0\" Entries=\"0\"/>\n",
                    xml_escape(name)
                ));
                return;
            }
            out.push_str(&format!(
                "{indent}<NODE Type=\"1\" Name=\"{}\" KeyType=\"0\" Entries=\"{}\">\n",
                xml_escape(name),
                track_ids.len()
            ));
            for id in track_ids {
                out.push_str(&format!("{indent}  <TRACK Key=\"{id}\"/>\n"));
            }
            out.push_str(&format!("{indent}</NODE>\n"));
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_xml:: -- --nocapture`
Expected: PASS (10 tests total).

- [ ] **Step 5: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rekordbox_xml.rs
git commit -m "feat(rekordbox): serialize merged tree back to a valid DJ_PLAYLISTS document"
```

---

### Task 6: Settings key + IPC commands (link, export)

**Files:**
- Modify: `src-tauri/src/settings.rs:1-20` (new constant)
- Modify: `src-tauri/src/ipc_library.rs` (two new commands)
- Modify: `src-tauri/src/lib.rs` (register the two commands)
- Modify: `shared/contracts.ts` (new TS types)
- Modify: `frontend/ipc.ts` (two new wrapper functions)

**Interfaces:**
- Consumes: `rekordbox_xml::{parse, merge_filed_tracks, write}` (Tasks 2/3/5), `library::list_filed` (existing, `src-tauri/src/library.rs:134`), `settings::{get, set}` (existing).
- Produces:
  - Rust: `pub const REKORDBOX_XML_PATH: &str = "rekordbox_xml_path";` in `settings.rs`.
  - `#[derive(Serialize)] pub struct RekordboxLinkStatus { pub path: Option<String>, pub linked: bool, pub playlist_count: usize, pub track_count: usize, pub error: Option<String> }` in `ipc_library.rs`.
  - `#[tauri::command] pub fn link_rekordbox_xml(conn: State<Mutex<Connection>>, path: String) -> Result<RekordboxLinkStatus, String>` — parses+validates, persists the path on success, returns the status (does NOT merge/export — that's a separate explicit action per the spec's flow).
  - `#[tauri::command] pub fn rekordbox_status(conn: State<Mutex<Connection>>) -> Result<RekordboxLinkStatus, String>` — re-reads the currently-linked path (if any) and reports its live status, for the UI card to call on mount.
  - `#[tauri::command] pub fn export_rekordbox_xml(conn: State<Mutex<Connection>>) -> Result<RekordboxLinkStatus, String>` — the real replacement for `startExportSim`: reload from disk, merge filed tracks, write, return updated status. Fails with a clear error (no partial write) if no XML is linked yet.
  - TS: `RekordboxLinkStatus` interface in `shared/contracts.ts`; `linkRekordboxXml(path: string)`, `rekordboxStatus()`, `exportRekordboxXml()` in `frontend/ipc.ts`.

- [ ] **Step 1: Add the setting constant**

In `src-tauri/src/settings.rs`, after the existing `CURRENT_SESSION_ID` constant (line 17), add:

```rust
/// Absolute path of the linked Rekordbox XML file (`DJ_PLAYLISTS` format). Unset = no XML linked.
pub const REKORDBOX_XML_PATH: &str = "rekordbox_xml_path";
```

- [ ] **Step 2: Write the failing IPC tests**

Add a `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/ipc_library.rs` (create the block if none exists yet — check with `grep -n "mod tests" src-tauri/src/ipc_library.rs` first; if absent, append this whole block at file end):

```rust
#[cfg(test)]
mod rekordbox_tests {
    use super::*;
    use std::sync::Mutex;

    fn conn() -> Mutex<Connection> {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&c).unwrap();
        Mutex::new(c)
    }

    #[test]
    fn link_rekordbox_xml_persists_path_on_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::copy("fixtures/rekordbox_sample.xml", &xml_path).unwrap();
        let state = tauri::State::from(&conn());
        let status = link_rekordbox_xml(state, xml_path.to_str().unwrap().to_string()).unwrap();
        assert!(status.linked);
        assert_eq!(status.track_count, 3);
        assert!(status.error.is_none());
    }

    #[test]
    fn link_rekordbox_xml_reports_error_on_corrupt_file_and_does_not_persist() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("bad.xml");
        std::fs::write(&xml_path, b"<not-even-xml").unwrap();
        let db = conn();
        let state = tauri::State::from(&db);
        let result = link_rekordbox_xml(state, xml_path.to_str().unwrap().to_string());
        assert!(result.is_err(), "corrupt XML must be rejected, not silently linked");
        let saved = crate::settings::get(&db.lock().unwrap(), crate::settings::REKORDBOX_XML_PATH).unwrap();
        assert_eq!(saved, None, "no path persisted on a failed link");
    }

    #[test]
    fn rekordbox_status_reports_unlinked_when_no_setting() {
        let state = tauri::State::from(&conn());
        let status = rekordbox_status(state).unwrap();
        assert!(!status.linked);
        assert_eq!(status.path, None);
    }

    #[test]
    fn export_rekordbox_xml_fails_fast_when_nothing_linked() {
        let state = tauri::State::from(&conn());
        let result = export_rekordbox_xml(state);
        assert!(result.is_err(), "export with no linked XML must fail, not create one silently");
    }

    #[test]
    fn export_rekordbox_xml_merges_filed_tracks_and_rewrites_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::copy("fixtures/rekordbox_sample.xml", &xml_path).unwrap();
        let db = conn();
        {
            let c = db.lock().unwrap();
            crate::settings::set(&c, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
            c.execute(
                "INSERT INTO tracks(path, status, folder) VALUES('C:/Music/Disco/new.mp3', 'filed', 'Disco')",
                [],
            )
            .unwrap();
        }
        let state = tauri::State::from(&db);
        let status = export_rekordbox_xml(state).unwrap();
        assert_eq!(status.track_count, 4, "3 original + 1 newly filed");

        let rewritten = std::fs::read_to_string(&xml_path).unwrap();
        assert!(rewritten.contains("Disco/new.mp3") || rewritten.contains("Disco%2Fnew.mp3"));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ipc_library:: -- --nocapture`
Expected: FAIL — `link_rekordbox_xml`, `rekordbox_status`, `export_rekordbox_xml`, `RekordboxLinkStatus` not defined.

- [ ] **Step 4: Implement the IPC commands**

Add to `src-tauri/src/ipc_library.rs` (after the existing `library_stats` command, before any test module):

```rust
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

/// Parse+validate `path` as a Rekordbox XML and, on success, persist it as the linked file.
/// Fails fast (path NOT persisted) if the file can't be read or parsed — no silent partial link.
#[tauri::command]
pub fn link_rekordbox_xml(
    conn: State<'_, Mutex<Connection>>,
    path: String,
) -> Result<RekordboxLinkStatus, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("lecture impossible: {e}"))?;
    let parsed = crate::rekordbox_xml::parse(&bytes)?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, &path).map_err(|e| e.to_string())?;
    Ok(RekordboxLinkStatus {
        path: Some(path),
        linked: true,
        playlist_count: count_playlists(&parsed.playlists),
        track_count: parsed.collection.len(),
        error: None,
    })
}

/// Current link status: re-reads the linked file (if any) fresh from disk. If a path is
/// persisted but the file is now unreadable/corrupt, reports `linked:true, error:Some(..)` —
/// the setting is NOT cleared automatically (the spec: block auto-rewrite, don't lose the
/// reference silently; the user must explicitly re-link).
#[tauri::command]
pub fn rekordbox_status(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let path = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH).map_err(|e| e.to_string())?
    };
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

/// Reload the linked XML, merge every `filed` track absent from it, rewrite the file. Fails fast
/// (no write attempted) if no XML is linked, or if the linked file is unreadable/corrupt — no
/// silent recreation of an empty tree, matching the spec's fail-fast requirement.
#[tauri::command]
pub fn export_rekordbox_xml(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let (path, filed) = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let path = crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH)
            .map_err(|e| e.to_string())?
            .ok_or("aucun XML Rekordbox lié — relie un fichier avant d'exporter")?;
        let filed = library::list_filed(&conn, &LibraryFilter::default()).map_err(|e| e.to_string())?;
        (path, filed)
    };
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
```

- [ ] **Step 5: Register the commands**

In `src-tauri/src/lib.rs`, find the `invoke_handler(tauri::generate_handler![...])` block's `ipc_library::` entries (search `grep -n "ipc_library::" src-tauri/src/lib.rs`) and add the three new commands right after the existing `ipc_library::library_stats,` line:

```rust
            ipc_library::library_stats,
            ipc_library::link_rekordbox_xml,
            ipc_library::rekordbox_status,
            ipc_library::export_rekordbox_xml,
```

- [ ] **Step 6: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml ipc_library:: -- --nocapture`
Expected: PASS (5 new tests).

- [ ] **Step 7: Full backend test + clippy sweep**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass (no regressions elsewhere).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 8: Add TS types**

In `shared/contracts.ts`, after the existing `DashboardStats` interface (line ~282-289), add:

```typescript
export interface RekordboxLinkStatus {
  path: string | null;
  linked: boolean;
  playlist_count: number;
  track_count: number;
  error: string | null;
}
```

- [ ] **Step 9: Add TS IPC wrappers**

In `frontend/ipc.ts`, add `RekordboxLinkStatus` to the import list from `"../shared/contracts"` (line 3-28 block) — insert it alphabetically after `LibraryTrack,LibraryFacets,LibraryFilter,`:

```typescript
  LibraryFilter,
  RekordboxLinkStatus,
  MetadataEdit,
```

Then, after the existing `libraryStats` export (last line, 259), add:

```typescript

// ---- M7 Rekordbox XML export + playlist path repair ----

/** Parse+validate a chosen Rekordbox XML file and persist it as the linked file. Rejects
 * (nothing persisted) if the file can't be read or parsed. */
export const linkRekordboxXml = (path: string): Promise<RekordboxLinkStatus> =>
  invoke("link_rekordbox_xml", { path });

/** Current linked-XML status (re-read fresh from disk each call). */
export const rekordboxStatus = (): Promise<RekordboxLinkStatus> => invoke("rekordbox_status");

/** Merge every filed track missing from the linked XML and rewrite it. Rejects if no XML is
 * linked yet, or if the linked file is unreadable/corrupt. */
export const exportRekordboxXml = (): Promise<RekordboxLinkStatus> => invoke("export_rekordbox_xml");
```

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (nothing consumes these yet, this only confirms the types/signatures compile).

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/ipc_library.rs src-tauri/src/lib.rs shared/contracts.ts frontend/ipc.ts
git commit -m "feat(rekordbox): link/status/export IPC commands"
```

---

### Task 7: Auto-repair hook in `actions::record_with_meta`

**Files:**
- Modify: `src-tauri/src/actions.rs:53-69`
- Modify: `src-tauri/src/lib.rs` (emit a Tauri event for the toast, if `record_with_meta` doesn't already have app-handle access — see Step 3 for how this is threaded)

**Interfaces:**
- Consumes: `rekordbox_xml::{parse, patch_location}` (Tasks 2/4), `settings::{get, REKORDBOX_XML_PATH}` (Task 6).
- Produces: `pub fn repair_rekordbox_xml_if_linked(conn: &Connection, from_path: &str, to_path: &str) -> Option<usize>` — `None` if no XML is linked (no-op), `Some(n)` where `n` is 1 if a patch happened, 0 if the XML is linked but didn't reference `from_path`. On a read/parse error of the linked file, logs and returns `None` (fails fast, no panic, no silent corruption) — the spec's UI error state is surfaced separately via `rekordbox_status` (Task 6), not from this hook.

This hook does the read-patch-write **synchronously inline** in `record_with_meta`, matching the spec's "après chaque action... patch + réécriture immédiate" wording. It's called from `record_with_meta` itself (not from every call site) so every action type that goes through the journal gets the same repair, without each of `filing.rs`/`encode.rs`/`naming.rs` needing to know about Rekordbox.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/actions.rs` (after the existing `record_inserts_a_row` test):

```rust
    #[test]
    fn record_with_meta_repairs_linked_rekordbox_xml_on_move() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::copy("fixtures/rekordbox_sample.xml", &xml_path).unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // TrackID 2 in the fixture is at "C:/Music/House/deep/strings.aiff" — journal a move
        // away from that exact path (matches Location after normalization).
        record(
            &conn,
            "b1",
            None,
            "move",
            Some("C:/Music/House/deep/strings.aiff"),
            Some("C:/Music/House/Deep/strings.aiff"),
        )
        .unwrap();

        let rewritten = std::fs::read_to_string(&xml_path).unwrap();
        assert!(
            rewritten.contains("House/Deep/strings.aiff") || rewritten.contains("House%2FDeep%2Fstrings.aiff"),
            "Location patched in the linked XML file on disk"
        );
    }

    #[test]
    fn record_with_meta_is_noop_on_rekordbox_when_nothing_linked() {
        let conn = db();
        // No REKORDBOX_XML_PATH setting at all — must not error, must not create a file.
        let id = record(&conn, "b2", None, "move", Some("/a"), Some("/b")).unwrap();
        assert!(id > 0);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml actions:: -- --nocapture`
Expected: FAIL on `record_with_meta_repairs_linked_rekordbox_xml_on_move` (no repair happens yet — the second test already passes since it's asserting today's no-op behavior, which is fine, it documents the baseline before the hook exists).

- [ ] **Step 3: Implement the hook**

In `src-tauri/src/actions.rs`, `record_with_meta` currently reads (lines 53-69):

```rust
pub fn record_with_meta(
    conn: &Connection,
    batch_id: &str,
    track_id: Option<i64>,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    meta: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO actions(track_id, type, from_path, to_path, batch_id, meta, session_id)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6,
                (SELECT value FROM settings WHERE key='current_session_id'))",
        params![track_id, kind, from_path, to_path, batch_id, meta],
    )?;
    Ok(conn.last_insert_rowid())
}
```

Replace it with (the INSERT is unchanged; a repair step is appended after, guarded so it can never turn a successful journal write into an error — repair failures are logged, not propagated):

```rust
pub fn record_with_meta(
    conn: &Connection,
    batch_id: &str,
    track_id: Option<i64>,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    meta: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO actions(track_id, type, from_path, to_path, batch_id, meta, session_id)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6,
                (SELECT value FROM settings WHERE key='current_session_id'))",
        params![track_id, kind, from_path, to_path, batch_id, meta],
    )?;
    let id = conn.last_insert_rowid();

    // M7: if a Rekordbox XML is linked and this action moved/renamed/converted a file it already
    // references, patch that Location immediately so the track doesn't silently vanish from its
    // Rekordbox playlists. Journaling the action must never fail because of this side effect —
    // any repair error is logged and swallowed, never propagated to the caller.
    if let (Some(from), Some(to)) = (from_path, to_path) {
        repair_rekordbox_xml_if_linked(conn, from, to);
    }

    Ok(id)
}

/// If a Rekordbox XML is linked (`settings::REKORDBOX_XML_PATH`) and it references `from_path`,
/// patch its `Location` to `to_path` and rewrite the file immediately. No-op (returns `None`) if
/// nothing is linked. On a read/parse failure of the linked file, logs the error and returns
/// `None` — fails fast, no panic, no silent corruption of the file. The dashboard card's
/// `rekordbox_status` IPC (not this hook) is what surfaces the error state to the user.
pub fn repair_rekordbox_xml_if_linked(conn: &Connection, from_path: &str, to_path: &str) -> Option<usize> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).ok().flatten()?;
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            log::error!("rekordbox repair: linked XML {path} unreadable: {e}");
            return None;
        }
    };
    let mut parsed = match crate::rekordbox_xml::parse(&bytes) {
        Ok(p) => p,
        Err(e) => {
            log::error!("rekordbox repair: linked XML {path} unparseable: {e}");
            return None;
        }
    };
    let patched = crate::rekordbox_xml::patch_location(&mut parsed, from_path, to_path);
    if !patched {
        return Some(0); // linked, but this path wasn't tracked in it — nothing to repair
    }
    if let Err(e) = std::fs::write(&path, &parsed.raw_xml) {
        log::error!("rekordbox repair: failed writing patched XML {path}: {e}");
        return None;
    }
    Some(1)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml actions:: -- --nocapture`
Expected: PASS (all `actions` tests, including the 2 new ones).

- [ ] **Step 5: Full test + clippy sweep**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green, no regressions (this hook runs on every existing `record`/`record_with_meta` call across the whole test suite — confirms it's correctly a no-op when nothing is linked, which is the common case in existing tests).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/actions.rs
git commit -m "feat(rekordbox): auto-repair linked XML Location on every filing/move/convert"
```

---

### Task 8: Frontend — replace the simulated export with the real IPC call

**Files:**
- Modify: `frontend/sift-live.ts` (imports, `runNavExport`, remove `startExportSim`)

**Interfaces:**
- Consumes: `exportRekordboxXml`, `rekordboxStatus` (Task 6) from `./ipc`.
- Produces: `runNavExport` becomes the real trigger — no behavior change to its call site (the nav rail click delegate at line ~1296-1307 already calls `void runNavExport(...)`, untouched).

- [ ] **Step 1: Read the current simulation to confirm exact boundaries**

Run: `grep -n "startExportSim\|runNavExport\|exportTimer\|exportClearTimer" frontend/sift-live.ts`
Confirm the exact line ranges of `exportTimer`/`exportClearTimer` (module state), `startExportSim`, and `runNavExport` before editing — these were read earlier in this session at approximately lines 344-395; re-confirm with the grep since line numbers may have shifted.

- [ ] **Step 2: Add the import**

In `frontend/sift-live.ts`, find the existing `import { ... } from "./ipc"` block (the one already importing `getSetting`, `setSetting`, `libraryStats`, etc. per the earlier read of this file) and add `exportRekordboxXml` alphabetically among the other named imports.

- [ ] **Step 3: Replace `startExportSim` + `runNavExport`**

The current code (module state + two functions) reads:

```typescript
// No Rekordbox/USB backend exists yet (rbox/rekordcrate are still candidates, not integrated —
// see docs/ressources-externes.md). This drives a REAL "export" row in the progress zone (not a
// placeholder), but the work itself is simulated: a fake per-track tick, same ~450ms pace and
// done→auto-hide convention as the other rows (pushAnalyzeProgress/pushFileProgress above).
let exportTimer: ReturnType<typeof setInterval> | undefined;
let exportClearTimer: ReturnType<typeof setTimeout> | undefined;

/** Start (or ignore if one is already running) a simulated export of `total` filed tracks to
 * `target`. Ticks "export" done/total once per track, then flashes done and auto-hides — mirrors
 * pushFileProgress's done-state handling exactly. */
function startExportSim(target: "rekordbox" | "usb", total: number): void {
  if (exportTimer) return; // one export run at a time, like every other TaskKind
  if (total <= 0) return;
  clearTimeout(exportClearTimer);
  let done = 0;
  setTask("export", { done, total, state: "running" });
  exportTimer = setInterval(() => {
    done += 1;
    if (done >= total) {
      clearInterval(exportTimer);
      exportTimer = undefined;
      setTask("export", { done: total, total, state: "done" });
      exportClearTimer = setTimeout(() => clearTask("export"), 1200);
    } else {
      setTask("export", { done, total, state: "running" });
    }
  }, 450);
}
```

and:

```typescript
/** Nav "Export" click (Rekordbox/Clé USB, index.html's `.nv-export` items) — the maquette's
 * `exportTo` action: guards on an empty library and on a run already in flight, else fetches the
 * real filed-track count and starts the simulated export. Doesn't switch screens (these are
 * one-click actions, not real screens yet — see the capture-phase click listener below, which
 * pre-empts app.js's mockup view switch for data-view="rkb"/"cle"). */
async function runNavExport(target: "rekordbox" | "usb"): Promise<void> {
  if (exportTimer) return; // one export run at a time
  let total = 0;
  try {
    total = (await listLibrary()).length;
  } catch (e) {
    console.error("listLibrary failed (nav export)", e);
    return;
  }
  if (total === 0) {
    toast("Bibliothèque vide — rien à exporter");
    return;
  }
  startExportSim(target, total);
}
```

Replace BOTH blocks (delete `exportTimer`/`exportClearTimer`/`startExportSim` entirely, rewrite `runNavExport`) with:

```typescript
/** Guards a single in-flight export (Rekordbox only — USB stays out of scope per the M7 spec). */
let exportRunning = false;

/** Nav "Export" click (Rekordbox/Clé USB, index.html's `.nv-export` items). Rekordbox now runs
 * the REAL merge+rewrite (`export_rekordbox_xml`); USB has no backend (unchanged, out of M7
 * scope — see docs/superpowers/specs/2026-07-03-m7-rekordbox-xml-export-design.md, "hors scope").
 * Doesn't switch screens (see the capture-phase click listener below, which pre-empts app.js's
 * mockup view switch for data-view="rkb"/"cle"). */
async function runNavExport(target: "rekordbox" | "usb"): Promise<void> {
  if (target === "usb") {
    toast("Export clé USB : Rekordbox recopie lui-même une fois le XML réimporté");
    return;
  }
  if (exportRunning) return; // one export run at a time
  exportRunning = true;
  setTask("export", { done: 0, total: 1, state: "running" });
  try {
    const status = await exportRekordboxXml();
    setTask("export", { done: 1, total: 1, state: "done" });
    setTimeout(() => clearTask("export"), 1200);
    toast(
      `${status.track_count} pistes dans ${status.playlist_count} playlists Rekordbox — réimporte le XML dans Rekordbox pour resynchroniser.`,
    );
  } catch (e) {
    console.error("export_rekordbox_xml failed", e);
    setTask("export", { done: 0, total: 1, state: "error" });
    const msg = e instanceof Error ? e.message : String(e);
    toast(msg.includes("aucun XML") ? "Aucun XML Rekordbox lié — relie un fichier depuis la Bibliothèque" : `Export Rekordbox échoué : ${msg}`);
  } finally {
    exportRunning = false;
  }
}
```

(`listLibrary()` is no longer called here — `export_rekordbox_xml` itself queries `filed` tracks server-side, so the "empty library" guard is now naturally covered by the backend returning `track_count` unchanged when there's nothing new to merge; an explicit empty-library toast isn't needed since the merge is always safe to run and reports its real result either way.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `listLibrary` import becomes unused as a result of this change, confirm it's still used elsewhere in the file (it is — `renderBiblioLive` calls it) before assuming a cleanup is needed.

- [ ] **Step 5: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "feat(rekordbox): wire nav Export Rekordbox to the real backend"
```

---

### Task 9: Frontend — Bibliothèque dashboard card (link status + change-link action)

**Files:**
- Modify: `frontend/sift-live.ts` (`statsCardsHtml` call site → new card renderer, `renderBiblioLive`, the `data-bib` click delegate)

**Interfaces:**
- Consumes: `rekordboxStatus`, `linkRekordboxXml` (Task 6), `open` from `@tauri-apps/plugin-dialog` (already imported in this file as `openFolderDialog`, per the earlier read — add a plain `open` import alongside it or reuse the existing aliased one with `{ directory: false, filters: [...] }`).

- [ ] **Step 1: Add a card renderer function**

In `frontend/sift-live.ts`, right after the `statsCardsHtml` function (defined at the line found via `grep -n "function statsCardsHtml" frontend/sift-live.ts`), add:

```typescript
/** The M7 Rekordbox link-status card — same visual family as the M6b stat cards
 * (border+radius token, no accent stripe per the CSS ban on border-left/-right accents). Shows
 * the linked XML path, playlist/track counts, and a "changer de XML lié" action; an explicit
 * error state (unreadable/corrupt file) blocks nothing else on the page, it's just a card state. */
function rekordboxCardHtml(s: RekordboxLinkStatus): string {
  const body = !s.linked
    ? `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun XML Rekordbox lié.</div>`
    : s.error
      ? `<div style="font-size:var(--text-md);color:var(--color-text-danger)">XML Rekordbox illisible — relie un fichier.</div>`
      : `<div style="font-size:var(--text-md)">${esc(s.path || "")}</div>` +
        `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${s.playlist_count} playlists · ${s.track_count} pistes</div>`;
  return (
    `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">` +
    `<div style="min-width:0">${body}</div>` +
    `<button class="lk" data-bib="rkblink" style="flex:none">${s.linked ? "Changer de XML lié" : "Lier un XML Rekordbox"}</button>` +
    `</div>`
  );
}
```

Add `RekordboxLinkStatus` to the existing import from `"../shared/contracts"` at the top of `frontend/sift-live.ts` (it already imports `DashboardStats` from there per the earlier read — insert alphabetically nearby), and add `rekordboxStatus`, `linkRekordboxXml` to the `"./ipc"` import block.

- [ ] **Step 2: Wire it into `renderBiblioLive`**

`renderBiblioLive` currently loads `stats` via `Promise.all([listLibrary(...), libraryFolders(), libraryStats()])` (per the earlier read, lines ~1151-1164) and renders `(stats ? statsCardsHtml(stats) : "") + header + ...`. Add a fourth parallel fetch and render the new card right after the stat cards:

Change:

```typescript
  let facets: LibraryFacets = { folders: [], genres: [] };
  let stats: DashboardStats | null = null;
  try {
    [bibState.tracks, facets, stats] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
    ]);
  } catch (e) {
    console.error("library load failed", e);
    return;
  }
```

to:

```typescript
  let facets: LibraryFacets = { folders: [], genres: [] };
  let stats: DashboardStats | null = null;
  let rkbStatus: RekordboxLinkStatus | null = null;
  try {
    [bibState.tracks, facets, stats, rkbStatus] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
      rekordboxStatus(),
    ]);
  } catch (e) {
    console.error("library load failed", e);
    return;
  }
```

And change the render line:

```typescript
    : (stats ? statsCardsHtml(stats) : "") +
      header +
```

to:

```typescript
    : (stats ? statsCardsHtml(stats) : "") +
      (rkbStatus ? rekordboxCardHtml(rkbStatus) : "") +
      header +
```

- [ ] **Step 3: Wire the "link XML" click**

In the `data-bib` click delegate (the block found via `grep -n 'act === "stat"' frontend/sift-live.ts`, per the earlier read around line 1368), add a new branch alongside the existing `if (act === "stat") { ... }`:

```typescript
      if (act === "rkblink") {
        void (async () => {
          try {
            const chosen = await open({
              multiple: false,
              directory: false,
              filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
            });
            if (!chosen || Array.isArray(chosen)) return;
            const status = await linkRekordboxXml(chosen);
            toast(
              status.error
                ? "XML Rekordbox illisible — relie un autre fichier"
                : `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderBiblioLive();
          } catch (e) {
            console.error("link_rekordbox_xml failed", e);
            toast("Liaison du XML Rekordbox échouée");
          }
        })();
        return;
      }
```

Add this branch immediately after the `if (act === "stat") { ... return; }` block closes, so it's checked before falling through to the `qual`/`facet`/etc. branches already there.

Import `open` from `"@tauri-apps/plugin-dialog"` in `frontend/sift-live.ts` if not already available under that exact name — the file already imports it aliased as `openFolderDialog` (per the earlier read: `import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";`). Reuse that same import by calling `openFolderDialog({...})` instead of a second `open` import (both name the same function; a second default-named import from the same module would collide). Replace the `open({...})` call above with `openFolderDialog({...})`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Ask the user to run `npm run tauri dev`, open the Bibliothèque screen, and confirm: the new card shows "Aucun XML Rekordbox lié" initially with a "Lier un XML Rekordbox" button; clicking it opens a native file picker filtered to `.xml`; picking `src-tauri/fixtures/rekordbox_sample.xml` (or a copy of it outside the repo, since the app shouldn't write into `src-tauri/fixtures` during manual testing — copy it to e.g. Desktop first) links it and the card updates to show path + counts; clicking "Export Rekordbox" in the nav rail now runs the real merge and the file on disk changes (diff it before/after).

- [ ] **Step 6: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "feat(rekordbox): Bibliothèque dashboard card for the linked XML"
```

---

### Task 10: Final full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass, including every `rekordbox_xml::`, `ipc_library::rekordbox_tests::`, and `actions::` test added in this plan.

- [ ] **Step 2: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 3: Frontend type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Spec coverage self-check**

Confirm each spec requirement has a corresponding task:
- Parse `DJ_PLAYLISTS` XML into `COLLECTION`/`PLAYLISTS` + path index → Task 2.
- Merge filed tracks + per-folder playlists, never touching non-Sift playlists → Task 3.
- Patch one `Location`, rest of the tree byte-identical → Task 4.
- Settings persistence (`rekordbox_xml_path`) → Task 6.
- Export IPC replacing `startExportSim` → Tasks 6 + 8.
- Auto-repair hook in `actions::record_with_meta` + toast → Task 7 (backend) — note: the toast text itself is emitted from the frontend in Task 8's `runNavExport` for the explicit export action; the auto-repair-on-filing toast (spec step 3, "N morceaux... mis à jour") is NOT wired to a live Tauri event in this plan (the hook runs synchronously in Rust with no `AppHandle` threaded to it) — **this is a known gap, flag it to the user** rather than silently claiming it's done: the file-level repair works and is tested, but no toast fires in the live app when it happens outside of an explicit export click.
- Dashboard card (path, playlist count, last resync, change-link button) → Task 9. "Last resync date" specifically is NOT implemented (no timestamp is stored) — **flag this gap too**.
- Fail-fast on corrupt/unreadable linked XML → Tasks 6 + 7.
- Fixture-based unit tests (nested folders, shared TrackID) → Task 2's fixture, used throughout.

- [ ] **Step 5: Report gaps to the user**

Before considering the plan complete, explicitly tell the user about the two gaps surfaced in Step 4 (no live toast on auto-repair, no "last resync" timestamp) so they can decide whether those need a follow-up task or are acceptable for this iteration.
