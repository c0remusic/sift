# M8 Tier 3 — câblage IPC + hook filing + écran UI pour `sync_track_artwork` (design)

> Statut : design, prêt pour `writing-plans` (déjà écrit dans le même chantier,
> voir `plan.md`). Suite de
> `docs/superpowers/plans/2026-07-09-m8-tier3-artwork-sync-rust.md` (moteur
> `sync_track_artwork` livré : réécrit les 3 fichiers pochette
> `artwork.jpg`/`_m.jpg`/`_s.jpg` en place, jamais `master.db`/`ImagePath`,
> vérifié contre une copie réelle). Ce design suit le même patron que
> `docs/superpowers/specs/2026-07-09-m8-tier3-metadata-sync-ipc-ui-design.md`
> (déjà livré, `29a8fc9`) — les deux chantiers sont volontairement séparés,
> celui-ci vient après.

## Intention

`sync_track_artwork` est prouvé sûr mais isolé — rien ne l'appelle. Ce design
connecte le moteur : détecter (lecture seule) quand une piste liée à
Rekordbox vient de recevoir une nouvelle pochette via Sift, lister les
candidats, et n'écrire les fichiers artwork qu'après confirmation explicite
(jamais d'auto-apply — même politique que Tier 1/2/3 metadata).

## Détection : mêmes 3 points d'écriture, déclenchée seulement si une pochette a changé

Sift écrit `cover_path` (chemin vers un fichier JPEG — le cache Discogs
`app_data_dir()/covers/<release_id>.jpg`, ou tout autre chemin fourni côté
édition manuelle) aux mêmes 3 endroits que les tags texte :

1. `filing.rs::commit_file` (Ranger) — écrit les tags puis déplace/encode.
   Le code réel (post-livraison Tier 3 metadata) a été optimisé pour lire
   `master.db` **une seule fois par commit** (`resolve_masterdb_index_if_linked`,
   `filing.rs:574`) et le partager entre `maybe_detect_masterdb_repair_with_index`
   et `detect_masterdb_metadata_sync_with_index` — ce chantier ajoute un 3ᵉ
   appel sur le **même index déjà chargé**, jamais un 3ᵉ déchiffrement de
   `master.db` par commit.
2. `ipc_filing.rs::apply_tags` — écrit les tags sans déplacer.
3. `ipc_library.rs::update_metadata_inner` — édition inline Bibliothèque.

**Différence clé avec la synchro metadata** : les champs metadata
(artist/title/label/year/genre) sont TOUJOURS présents dans un
`MetadataSyncValues` (certains `None` si non modifiés, mais la structure est
toujours construite et le détecteur toujours appelé). La pochette, elle, n'a
de sens que si `cover_path` est effectivement `Some` sur CET appel — une
édition Bibliothèque qui ne change que l'artiste ne doit produire AUCUN
candidat de synchro pochette. Le détecteur n'est donc appelé que quand
`cover_path.is_some()`, à chacun des 3 sites — pas de "valeurs vides" comme
pour les tags texte.

```rust
/// M8 Tier 3 (pochette) — read-only detection, mirroring
/// `detect_masterdb_metadata_sync_with_index`'s guard and 0/1/2+ match
/// branches exactly, but writing to `rekordbox_masterdb_artwork_syncs`
/// (keyed by Sift `track_id`, `UNIQUE(track_id)`) and storing `cover_path`
/// (a string, not resolved image bytes — the bytes are read fresh at apply
/// time, see "Flux apply_artwork_syncs" below) instead of resolved values.
pub fn detect_masterdb_artwork_sync_if_linked(
    conn: &Connection,
    lookup_path: &str,
    track_id: i64,
    cover_path: &str,
    action_id: i64,
);

/// Same as above, but against an already-loaded `master.db` index — the variant
/// filing.rs's post-commit loop calls, reusing `resolve_masterdb_index_if_linked`'s
/// single decrypt for the whole commit.
pub fn detect_masterdb_artwork_sync_with_index(
    conn: &Connection,
    index: &crate::rekordbox_masterdb::RekordboxIndex,
    lookup_path: &str,
    track_id: i64,
    cover_path: &str,
    action_id: i64,
);
```

Guard interne : identique à la synchro metadata (0 correspondance → no-op ;
1 → `pending` ; 2+ → `ambiguous`).

## Pourquoi stocker `cover_path` (une chaîne) plutôt que les octets

Contrairement aux 5 champs texte de la synchro metadata (qui sont de simples
scalaires, coût de stockage négligeable), embarquer les octets JPEG dans une
ligne SQLite gonflerait la table pour rien — `cover_path` pointe déjà vers un
fichier stable :
- Cas dominant : le cache Discogs (`app_data_dir()/covers/<release_id>.jpg`,
  voir `metadata/cover.rs::cover_path`) — jamais purgé automatiquement,
  persiste tant que Sift tourne.
- Cas édition manuelle : un chemin fourni par l'utilisateur, potentiellement
  déplacé/supprimé entre détection et application — risque accepté et
  explicite (voir plus bas), pas un fallback silencieux.

À l'application, `apply_artwork_syncs` relit `cover_path` sur disque **au
moment de l'écriture**, jamais au moment de la détection — si le fichier a
disparu depuis, erreur explicite (`"le fichier de pochette source n'existe
plus — {cover_path}"`), ligne reste `pending`, retryable après ré-édition.

## Table `rekordbox_masterdb_artwork_syncs` (migration v14)

Même discipline que `rekordbox_masterdb_metadata_syncs` (v13) — clée par
`track_id`, remplacée à chaque nouvelle pochette, jamais accumulée :

```sql
CREATE TABLE rekordbox_masterdb_artwork_syncs (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    rekordbox_track_id TEXT,            -- djmdContent.ID ; NULL si ambigu
    candidate_track_ids TEXT,           -- IDs candidats joints par virgule, NULL sauf si ambigu
    cover_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | ambiguous | applied | dismissed
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    UNIQUE(track_id)
);
CREATE INDEX idx_rkbmdb_artsync_status ON rekordbox_masterdb_artwork_syncs(status);
```

`ON CONFLICT(track_id) DO UPDATE` (même raisonnement que v13 : préserve
`id`, retombe à `pending` même si la ligne précédente était `applied`).

## Commandes IPC (`rekordbox_repairs.rs`, wrappers `#[tauri::command]` dans `ipc_library.rs` — même split que Tier 1/2/3 existant)

```rust
#[derive(Serialize)]
pub struct PendingArtworkSync {
    pub id: i64,
    pub track_id: i64,
    pub sift_path: String,
    pub rekordbox_track_id: Option<String>,
    pub candidate_track_ids: Option<String>,
    pub candidate_tracks: Option<Vec<CandidateTrack>>,  // réutilise le CandidateTrack existant
    pub cover_path: String,
    pub status: String,
    pub detected_at: String,
}

#[derive(Serialize)]
pub struct ApplyArtworkSyncOutcome {
    pub id: i64,
    pub ok: bool,
    pub error: Option<String>,
}

pub fn rekordbox_masterdb_pending_artwork_syncs(conn) -> Result<Vec<PendingArtworkSync>, String>;
pub fn rekordbox_masterdb_apply_artwork_syncs(app, conn, ids: Vec<i64>) -> Result<Vec<ApplyArtworkSyncOutcome>, String>;
pub fn rekordbox_masterdb_dismiss_artwork_sync(conn, id: i64) -> Result<(), String>;
pub fn rekordbox_masterdb_resolve_ambiguous_artwork_sync(conn, id: i64, chosen_track_id: String) -> Result<(), String>;
```

### Flux `apply_artwork_syncs`, par `id`, séquentiel

1. Une fois, avant toute ligne : résoudre `pioneer_dir` — non lié → échec de
   tout l'appel.
2. Charger la ligne. `status != "pending"` ou `rekordbox_track_id` est
   `None` → `{ok:false, error:"ambigu ou déjà traité"}`, moteur jamais
   appelé.
3. **Relire `cover_path` sur disque MAINTENANT** (`std::fs::read`) — fichier
   absent → `{ok:false, error:"le fichier de pochette source n'existe plus —
   {cover_path}"}`, ligne reste `pending`, `sync_track_artwork` jamais
   appelé.
4. Backup dédié à la ligne : `app_data_dir()/rekordbox-backups/<horodatage-du-lot>/<id>/`
   (même convention que Tier 1/2/3 — `sync_track_artwork` fait déjà son
   propre backup des 3 fichiers dedans, ce chantier ne réinvente rien).
5. `sync_track_artwork(pioneer_dir, &backup_dir, &rekordbox_track_id, &cover_bytes)`.
6. Succès → `status='applied', applied_at=now`.
7. Échec → ligne reste `pending`, `error` humanisé, le lot continue
   (continue-on-failure).

## Messages d'erreur (`humanize_masterdb_error`, extension)

4 nouvelles variantes `MasterDbError` du moteur artwork (déjà livrées,
`rekordbox_masterdb.rs`) n'ont pas encore d'entrée dans
`humanize_masterdb_error` (`rekordbox_repairs.rs`) — ajout nécessaire :

| Cas | Message |
|---|---|
| `NoArtworkPath{track_id}` | `la piste {track_id} n'a pas de pochette dans master.db — aucune synchro possible` |
| `ArtworkVariantMissing{path}` | `fichier pochette manquant côté Rekordbox ({path}) — bibliothèque peut-être corrompue ou jamais scannée` |
| `ArtworkWriteVerificationFailedRolledBack(m)` | `l'écriture de la pochette a échoué à la vérification, la sauvegarde a été restaurée automatiquement : {m}` |
| `ArtworkWriteVerificationFailedRollbackFailed(m)` | `l'écriture ET la restauration de la pochette ont échoué — intervention manuelle nécessaire : {m}` |
| Fichier source (`cover_path`) absent au moment de l'apply | géré côté IPC directement (pas une `MasterDbError` — voir flux ci-dessus, étape 3), pas dans `humanize_masterdb_error` |

Les messages `RekordboxRunning`/`TrackNotFound` existants sont réutilisés
tels quels (déjà génériques, pas spécifiques metadata).

## Écran UI — 4ᵉ section sur la page Rekordbox (`frontend/rekordbox-view.ts`)

Sous `masterdbRepairsSectionHtml` (Tier 1), `playlistDuplicatesSectionHtml`
(Tier 2), `metadataSyncsSectionHtml` (Tier 3 texte), une 4ᵉ section
`artworkSyncsSectionHtml`, mêmes conventions visuelles exactement :

| Groupe | Condition | Rendu |
|---|---|---|
| Ambiguës (en premier) | `status="ambiguous"` | Chemin Sift + liste de boutons « Choisir cette piste — {chemin master.db} » (`data-sift="masresolve"`) + « Ignorer » |
| Prêtes (pending) | `status="pending"` | Checkbox + chemin Sift + nom du fichier pochette source (`cover_path.split(/[\\/]/).pop()`, pas le chemin complet — bruit) + « Ignorer » ; barre « Appliquer la sélection (N) » sous la liste si ≥1 coché |
| Erreur d'application | ligne restée `pending` après échec | Message d'erreur humanisé sous la ligne (état transitoire en mémoire, `masErrorById`, pas de colonne DB) |

Préfixe d'actions `data-sift` : `mas*` (« MasterDb ArtworkSync ») —
distinct de `mdb*` (Tier 1), `mds*` (Tier 3 texte) pour que le handler
délégué de `sift-live.ts` route sans collision. Sélection multi
`masSyncSel` module-level dans `rekordbox-view.ts`, même pattern que
`mdsSyncSel`. `confirmAction()` obligatoire avant tout `apply_artwork_syncs`.

Section absente si `pending_artwork_syncs` retourne une liste vide — même
règle show-nothing-when-empty que les 3 sections existantes.

## Hors scope (rappel)

Génération d'une pochette pour une piste qui n'en a encore aucune côté
Rekordbox (`NoArtworkPath` — jamais testé, moteur refuse explicitement,
voir plan moteur) ; nettoyage des fichiers artwork orphelins.
