# M8 Tier 3 — câblage IPC + hook filing + écran UI pour `sync_track_metadata` (design)

> Statut : design, prêt pour `writing-plans`. Suite de
> `docs/superpowers/plans/2026-07-09-m8-tier3-metadata-sync-rust.md` (moteur
> `sync_track_metadata` livré : find-or-create Artist/Genre/Label, écriture
> directe Title/ReleaseYear, chaîne de sûreté identique à Tier 1/2, vérifié
> contre une copie réelle — voir `docs/ressources-externes.md`, Évaluation
> 23). Ce design couvre le câblage complet (détection, table, IPC, écran) en
> un seul chantier — contrairement à Tier 1 qui avait scindé IPC et UI en
> deux sessions séparées, ici les deux sont regroupés car la détection et
> l'écran sont trop couplés pour être révisés utilement l'un sans l'autre.
> Synchro pochette (`sync_track_artwork`, moteur livré le même jour) reste un
> chantier séparé, volontairement après celui-ci.

## Intention

`sync_track_metadata` est prouvé sûr mais isolé — rien ne l'appelle. Ce
design connecte le moteur : détecter (lecture seule) quand une piste liée à
Rekordbox vient d'être retaguée par Sift, lister les candidats de synchro,
et n'écrire `master.db` qu'après confirmation explicite (jamais
d'auto-apply — même politique que Tier 1/2).

## Détection : 3 points d'écriture, valeurs passées explicitement

Sift écrit les tags ID3 à 3 endroits, jamais via un chemin partagé unique :

1. `filing.rs::execute_file` (Ranger) — écrit les tags puis déplace/encode.
2. `ipc_filing.rs::apply_tags` (bouton "Appliquer les tags", Revue) — écrit
   les tags sans déplacer.
3. `ipc_library.rs::update_metadata` (édition inline, Bibliothèque) — écrit
   les tags. **Aujourd'hui ce site ne journalise aucune action** (pas
   d'appel à `actions::record_with_meta`) — contrairement aux deux autres,
   ses éditions n'ont aucun bouton d'annulation (ni Journal, qui exclut de
   toute façon les `tag_edit` — voir plus bas, ni bouton dédié). Ce chantier
   corrige ce gap au passage (nécessaire de toute façon : la nouvelle table
   dépend d'un `action_id`).

**Décision (tranchée en brainstorm)** : plutôt que d'étendre la signature
générique `actions::record_with_meta`/`maybe_repair_rekordbox_xml` (qui
servirait alors artist/title/label/year/genre à des dizaines d'appelants qui
n'en ont rien à faire), une nouvelle fonction dédiée est appelée
**directement** par chacun des 3 sites, juste après l'écriture des tags —
mais **pas au même point d'accroche exact** pour les 3, car `filing.rs` ne
passe jamais par `record_with_meta` :

- `apply_tags`/`update_metadata` : appellent bien `record_with_meta`
  (`update_metadata` après le fix ci-dessous) et récupèrent son `action_id`
  de retour — la nouvelle fonction est appelée juste après.
- `filing.rs::commit_file` **n'appelle jamais `record_with_meta`** — il
  journalise chaque `FsLog` via `record_row_only` **dans la transaction**
  (`filing.rs:540-543`, un `action_id` distinct par ligne : `tag_edit`+`move`
  pour le cas conforme, `convert`+`trash` pour le cas non-conforme), puis
  déclenche les hooks Tier 1 (`maybe_repair_rekordbox_xml`/
  `maybe_detect_masterdb_repair`) **après le commit**, dans une boucle
  séparée sur `log.iter().zip(action_ids.iter())` restreinte à
  `kind ∈ {move, convert}` (`filing.rs:571-574`). **Le cas non-conforme n'a
  aucune ligne `tag_edit`** — les tags sont écrits sur `plan.dest`
  (`execute_file`, `filing.rs:467`) sans action dédiée ; c'est la ligne
  `convert` qui représente cet événement.

  La détection Tier 3 s'accroche donc dans **cette même boucle
  post-commit existante** (`filing.rs:571-574`), au même point exact que Tier
  1, via un wrapper `maybe_` qui porte le même garde `kind ∈ {move, convert}`
  que `maybe_detect_masterdb_repair` (une seule itération qualifie par
  commit, donc déclenché une seule fois) :
  ```rust
  for (fs, action_id) in log.iter().zip(action_ids.iter()) {
      actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to));
      actions::maybe_detect_masterdb_repair(conn, fs.kind, Some(&fs.from), Some(&fs.to), *action_id);
      actions::maybe_detect_masterdb_metadata_sync(conn, fs.kind, &fs.from, plan, *action_id); // NEW
  }
  ```
  `lookup_path = fs.from` (= `plan.source`, identique aux deux kinds — c'est
  un déplacement/encodage FROM `plan.source`) — cohérent avec Tier 1 qui
  matche aussi sur `from_path`. Les valeurs à synchroniser viennent
  directement de `plan.canonical`/`plan.extras` (déjà en mémoire dans
  `commit_file`), jamais d'un `FsLog` précis — la ligne `tag_edit`
  éventuelle n'a pas besoin d'être lue.

```rust
/// Guard wrapper used only by filing.rs's post-commit loop — mirrors
/// maybe_detect_masterdb_repair's kind ∈ {move, convert} guard exactly,
/// then builds MetadataSyncValues from `plan` (already in memory, no file
/// re-read) and delegates to the shared detector below.
pub fn maybe_detect_masterdb_metadata_sync(
    conn: &Connection,
    kind: &str,
    lookup_path: &str,
    plan: &crate::filing::FilePlan,
    action_id: i64,
);

/// M8 Tier 3: the shared detector. Called by `maybe_detect_masterdb_metadata_sync`
/// (filing.rs's post-commit loop) AND directly by apply_tags/update_metadata
/// right after their own `record_with_meta` call — never threaded through
/// record_with_meta's generic signature, since only these 3 call sites have
/// tag values in hand. `lookup_path` is the path master.db is expected to
/// still reference RIGHT NOW: for a move/convert this is the PRE-move path
/// (Tier 1's own repair is a separate, unconfirmed step — master.db's
/// FolderPath hasn't moved yet), for a same-path tag edit it's simply the
/// track's current path.
pub fn detect_masterdb_metadata_sync_if_linked(
    conn: &Connection,
    lookup_path: &str,
    track_id: i64,
    values: &MetadataSyncValues,
    action_id: i64,
)
```

où `MetadataSyncValues` est un petit struct local à `actions.rs` (pas le
`MetadataSync` du moteur, qui a besoin d'un `track_id` Rekordbox déjà résolu
— celui-ci porte les valeurs Sift encore non résolues côté Rekordbox) :

```rust
pub struct MetadataSyncValues {
    pub artist: Option<String>,
    pub title: Option<String>,
    pub label: Option<String>,
    pub year: Option<i64>,
    pub genre: Option<String>,   // déjà joint "A; B", comme write_tags_full l'écrit
}
```

Chaque site construit ce struct depuis les valeurs qu'il vient d'écrire (pas
de relecture disque) :
- `filing.rs` : `canonical.artist` / `naming::tag_title(canonical)` /
  `extras.label` / `extras.year` / `extras.genres.join("; ")`.
- `apply_tags` : `edited.artist` / `naming::tag_title(&edited)` / mêmes
  `extras` que filing.
- `update_metadata` : `edit.artist` / `edit.title` / `edit.label` /
  `edit.year` / `edit.genres.join("; ")`.

Guard interne (mêmes conventions que `detect_masterdb_repair_if_linked`) :
pas de XML Rekordbox lié → no-op ; `master.db` illisible → `log::error!` +
no-op, jamais de panic.

## Fix du gap : `update_metadata` journalise désormais un `tag_edit`, avec un vrai bouton Annuler

**Correction post-revue adverse** : la première version de ce design disait
"revertable via le Journal" — faux. `list_journal` exclut explicitement
toutes les lignes `tag_edit` (`actions.rs:481`, `AND type NOT IN
('tag_edit')`) : journaliser seul ne fait rien apparaître dans l'écran
Journal, pour aucun des 3 sites. Le vrai mécanisme d'undo d'un `tag_edit`
est un bouton dédié piloté par le `batch_id` que la commande retourne —
c'est ce qu'`apply_tags` fait déjà (`ipc_filing.rs:182/226`, front
`.sift-applytags-btn` qui bascule en "Annuler", `filing.ts:1521/1556`).
`update_metadata` doit faire pareil pour que le fix serve vraiment à
quelque chose, pas juste satisfaire le FK `action_id` de la nouvelle table :

**Backend** — `ipc_library.rs::update_metadata` capture l'ancien snapshot
(`read_tags_full` avant écriture, comme `apply_tags`), appelle
`actions::record_with_meta(conn, &batch_id, Some(track_id), "tag_edit",
Some(&path), None, Some(&meta))` après l'écriture DB (`batch_id` via
`filing::new_batch_id(track_id)`, même forme qu'`apply_tags`), et **change
de signature** : `Result<(), String>` → `Result<String, String>` (retourne
le `batch_id`).

**Frontend** — `frontend/ipc.ts:258` (`updateMetadata`) : retour
`Promise<void>` → `Promise<string>`. `frontend/library-detail.ts::doSave`
(ligne ~264) : `const batchId = await updateMetadata(...)`, puis au lieu du
`toast("Enregistré")` actuel (son propre `toast()` local, ligne 35, qui ne
supporte pas d'action) — étendre ce `toast()` local avec les mêmes
paramètres optionnels `undo`/`onUndo` que celui de `filing.ts:1575` (3
implémentations locales de `toast()` coexistent déjà dans le repo — Accueil/
Revue/Bibliothèque — dupliquer le pattern est cohérent avec l'existant, pas
une nouvelle divergence) : `toast("Enregistré", true, () =>
revertBatch(batchId))`. `revertBatch` est déjà importé/exposé
(`frontend/ipc.ts:164`, utilisé par `filing.ts`).

Effet : les éditions Bibliothèque deviennent réellement annulables (bouton
"Annuler" sur le toast, 6s comme les autres toasts), et la table Tier 3 a
son `action_id` NOT NULL satisfait sur les 3 sites.

## Table `rekordbox_masterdb_metadata_syncs` (migration v13)

Clée par `track_id` (Sift), pas par `action_id` — contrairement à
`rekordbox_masterdb_repairs` (Tier 1, clée `action_id` car chaque réparation
de chemin est un événement distinct lié à UN déplacement précis), ici un
retag répété avant synchro doit remplacer le candidat précédent, pas
s'accumuler :

```sql
CREATE TABLE rekordbox_masterdb_metadata_syncs (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    rekordbox_track_id TEXT,            -- djmdContent.ID ; NULL si ambigu
    candidate_track_ids TEXT,           -- IDs candidats joints par virgule, NULL sauf si ambigu
    new_artist TEXT,
    new_title TEXT,
    new_label TEXT,
    new_year INTEGER,
    new_genre TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | ambiguous | applied | dismissed
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    UNIQUE(track_id)
);
CREATE INDEX idx_rkbmdb_metasync_status ON rekordbox_masterdb_metadata_syncs(status);
```

`INSERT OR REPLACE ... ON CONFLICT(track_id) DO UPDATE SET ...` (pas un
simple `INSERT OR REPLACE` brut — celui-ci changerait `id`, cassant toute
référence déjà affichée côté front pendant le même rendu ; un `ON CONFLICT
DO UPDATE` préserve `id`) : un nouveau retag avant synchro écrase
`rekordbox_track_id`/`candidate_track_ids`/les 5 champs `new_*`/`status`
(retombe à `pending` même si l'ancienne ligne était `applied`/`dismissed`)/
`detected_at`, jamais `applied_at` qui reste tel quel jusqu'à la prochaine
application.

Mêmes 3 branches de correspondance que Tier 1 (recherche `FolderPath ==
lookup_path` dans l'index `master.db`) :
- 0 correspondance → aucune ligne écrite (le fichier n'est pas dans
  Rekordbox, ou son chemin y a déjà dérivé — rien à faire ici).
- 1 correspondance → `status='pending'`, `rekordbox_track_id` posé.
- 2+ correspondances → `status='ambiguous'`, `rekordbox_track_id=NULL`,
  `candidate_track_ids` joints par virgule.

## Commandes IPC (`ipc_library.rs`, section M8 Tier 3, à côté de Tier 1/2)

```rust
#[derive(Serialize)]
pub struct CandidateTrack {
    pub rekordbox_track_id: String,
    pub path: String,             // FolderPath actuel dans master.db, pour que l'utilisateur distingue les candidats
}

#[derive(Serialize)]
pub struct PendingMetadataSync {
    pub id: i64,
    pub track_id: i64,
    pub sift_path: String,                       // tracks.path, pour l'affichage
    pub rekordbox_track_id: Option<String>,       // None ⇒ ambigu
    pub candidate_tracks: Option<Vec<CandidateTrack>>,
    pub new_artist: Option<String>,
    pub new_title: Option<String>,
    pub new_label: Option<String>,
    pub new_year: Option<i64>,
    pub new_genre: Option<String>,
    pub status: String,                           // "pending" | "ambiguous"
    pub detected_at: String,
}

#[derive(Serialize)]
pub struct ApplyMetadataSyncOutcome {
    pub id: i64,
    pub ok: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn rekordbox_masterdb_pending_metadata_syncs(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PendingMetadataSync>, String>;

#[tauri::command]
pub fn rekordbox_masterdb_apply_metadata_syncs(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    ids: Vec<i64>,
) -> Result<Vec<ApplyMetadataSyncOutcome>, String>;

#[tauri::command]
pub fn rekordbox_masterdb_dismiss_metadata_sync(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
) -> Result<(), String>;

#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous_metadata_sync(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String>;
```

- `pending_metadata_syncs` : `SELECT ... WHERE status IN ('pending','ambiguous') ORDER BY detected_at`,
  joint `tracks.path` pour `sift_path`. `candidate_tracks` peuplé (chemin
  actuel de chaque candidat dans `master.db`, relu à la demande — même
  pattern que Tier 1's `resolve_ambiguous` UI) seulement pour les lignes
  `ambiguous`.
- `dismiss_metadata_sync` : `UPDATE ... SET status='dismissed' WHERE id=?`.
- `resolve_ambiguous_metadata_sync` : même contrat que Tier 1 — rejette si
  la ligne n'est pas `ambiguous`, rejette si `chosen_track_id` n'est pas
  dans `candidate_track_ids`, sinon `rekordbox_track_id=chosen`,
  `candidate_track_ids=NULL`, `status='pending'`.
- `apply_metadata_syncs` : voir flux ci-dessous.

### Flux `apply_metadata_syncs`, par `id`, séquentiel

1. Une fois, avant toute ligne : résoudre `pioneer_dir` (dossier parent du
   XML lié) — non lié → échec de tout l'appel, aucune ligne touchée.
2. Charger la ligne. `status != "pending"` ou `rekordbox_track_id` est
   `None` (ambigu) → `{ok:false, error:"ambigu ou déjà traité — résolution
   manuelle requise"}`, `sync_track_metadata` jamais appelé.
3. Construire `MetadataSync{ track_id: rekordbox_track_id, artist:
   new_artist, title: new_title, label: new_label, year: new_year, genre:
   new_genre }`.
4. Backup dédié à la ligne, même convention que Tier 1 :
   `app_data_dir()/rekordbox-backups/<horodatage-du-lot>/<id>/`.
5. `sync_track_metadata(pioneer_dir, &backup_dir, &sync)`.
6. Succès → `status='applied', applied_at=now`, `{ok:true}`.
7. Échec → ligne reste `pending` (réessayable), `{ok:false, error:
   humanize(err)}`, **le lot continue** vers l'`id` suivant (continue-on-
   failure, identique à Tier 1).

**Garde-fou "piste toujours là"** : contrairement à Tier 1 (où le fichier
peut avoir été déplacé/annulé entre détection et application), ici rien ne
déplace le fichier — seul son contenu ID3 a changé. Le seul risque
équivalent est que `tracks.id` ait disparu (piste supprimée de Sift) ou que
`rekordbox_track_id` n'existe plus dans `master.db` (bibliothèque Rekordbox
changée depuis) : ce dernier cas est déjà couvert par
`MasterDbError::TrackNotFound` du moteur, pas besoin d'un garde-fou
indépendant supplémentaire côté IPC.

## Messages d'erreur (`humanize`)

Mêmes conventions que Tier 1 (`docs/superpowers/specs/2026-07-06-m8-tier1-ipc-wiring-design.md`) :

| Cas | Message |
|---|---|
| Aucun XML Rekordbox lié | `aucun XML Rekordbox lié — relie un fichier avant de synchroniser` |
| Ligne `ambiguous`/`applied`/`dismissed` passée à `apply_metadata_syncs` | `piste ambiguë ou déjà traitée — résolution manuelle requise` |
| `resolve_ambiguous_metadata_sync` sur une ligne non-`ambiguous` | `cette ligne n'est pas ambiguë` |
| `resolve_ambiguous_metadata_sync` avec un `chosen_track_id` hors liste | `piste choisie hors de la liste des candidats détectés` |
| `MasterDbError::RekordboxRunning` | `Rekordbox est ouvert — ferme-le avant de synchroniser` |
| `MasterDbError::TrackNotFound{track_id}` | `piste {track_id} introuvable dans master.db — la bibliothèque Rekordbox a peut-être changé depuis la détection` |
| `MasterDbError::WriteVerificationFailedRolledBack(m)` | `l'écriture a échoué à la vérification, la sauvegarde a été restaurée automatiquement : {m}` |
| `MasterDbError::WriteVerificationFailedRollbackFailed(m)` | `l'écriture ET la restauration de la sauvegarde ont échoué — intervention manuelle nécessaire : {m}` |
| Toute autre `MasterDbError` | `err.to_string()` tel quel |

## Écran UI — nouvelle section sur la page Rekordbox

Sous les sections Tier 1 (`masterdbRepairsSectionHtml`) et Tier 2
(`playlistDuplicatesSectionHtml`), une 3ᵉ section `metadataSyncsSectionHtml`,
mêmes conventions visuelles :

| Groupe | Condition | Rendu |
|---|---|---|
| Ambiguës (en premier) | `status="ambiguous"` | Chemin Sift + liste de boutons « Choisir cette piste — {chemin master.db} » (`data-sift="mdsresolve"`) + « Ignorer » |
| Prêtes (pending) | `status="pending"` | Checkbox (`.sift-batch-ck`) + chemin Sift + diff avant→après par champ modifié (seuls les champs non-`None` s'affichent, ex. `Artiste: Larry Heard`) + « Ignorer » ; barre « Appliquer la sélection (N) » sous la liste si ≥1 coché |
| Erreur d'application | ligne restée `pending` après un lot en échec | Message d'erreur humanisé sous la ligne (état transitoire en mémoire, `mdsErrorById`, pas de colonne DB — même pattern que Tier 1/2) |

Sélection multi (`mdsSyncSel`) module-level persistante entre rendus, même
pattern que `mdbRepairSel`/`batchSel`. `confirmAction()` obligatoire avant
tout `apply_metadata_syncs` (jamais `window.confirm()`).

Section absente si `pending_metadata_syncs` retourne une liste vide — même
règle show-nothing-when-empty que Tier 1/2.

## Tests

Convention `_inner` existante :

- `detect_masterdb_metadata_sync_if_linked` : 0/1/2+ correspondances ; pas
  de XML lié → no-op ; lecture `master.db` échoue → no-op ; un 2ᵉ appel pour
  le même `track_id` avec des valeurs différentes remplace la ligne
  (`ON CONFLICT DO UPDATE`, `id` stable, `status` retombe à `pending` même
  si la ligne précédente était `applied`).
- `update_metadata` : vérifie qu'un `tag_edit` est désormais journalisé
  (nouveau test, régression du fix de gap) — snapshot avant écriture
  correct, `batch_id` retourné non-vide, `revert_batch(batch_id)` restaure
  les anciens tags.
- `maybe_detect_masterdb_metadata_sync` (le wrapper `filing.rs`) : garde
  `kind ∈ {move, convert}` identique à `maybe_detect_masterdb_repair` —
  n'appelle jamais le détecteur pour `tag_edit`/`trash` ; déclenché
  exactement une fois par commit conforme ET non-conforme (le cas
  non-conforme, sans ligne `tag_edit`, doit quand même produire une ligne
  `rekordbox_masterdb_metadata_syncs` via sa ligne `convert`).
- `rekordbox_masterdb_pending_metadata_syncs_inner` : exclut
  `applied`/`dismissed`, ordre par `detected_at`, `candidate_tracks` peuplé
  seulement pour `ambiguous`.
- `rekordbox_masterdb_apply_metadata_syncs_inner` (fixture étendue
  existante) :
  - une ligne `pending` s'applique, passe `applied`.
  - lot de 2 : ligne 1 réussit, ligne 2 vise un `rekordbox_track_id`
    disparu → ligne 1 `applied`, ligne 2 reste `pending` avec `error`
    peuplé (continue-on-failure).
  - une ligne `ambiguous` passée dans `ids` → `{ok:false}`, moteur jamais
    appelé.
- `rekordbox_masterdb_dismiss_metadata_sync_inner` : bascule `status`.
- `rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner` : résout vers
  `pending` ; rejette un `chosen_track_id` hors liste ; rejette une ligne
  non-`ambiguous`.
- `db.rs` : migration v13 s'applique proprement.
- 3 call sites (filing.rs conformant + non-conformant, apply_tags,
  update_metadata) : un test d'intégration par site vérifie qu'une piste
  liée à Rekordbox (fixture `master.db` + XML) produit bien une ligne
  `rekordbox_masterdb_metadata_syncs` après l'action, avec les bonnes
  valeurs.

## Hors scope (rappel)

Synchro pochette (`sync_track_artwork`, chantier séparé suivant celui-ci) ;
nettoyage des lignes `djmdArtist`/`Genre`/`Label` orphelines (aucun
mécanisme observé chez Rekordbox non plus, risque résiduel documenté et
accepté dans le plan moteur) ; gestion explicite du revert pour la table de
synchro (même limite acceptée que Tier 1 — un revert d'un `move`/`tag_edit`
n'invalide pas une ligne déjà détectée ou déjà appliquée).
