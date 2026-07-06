# M8 Tier 1 — IPC wiring pour `repair_track_path` (design)

> Statut : design, prêt pour `writing-plans`. Suite de
> `2026-07-06-m8-tier1-write-path-rust-design.md`/plan (moteur `repair_track_path`
> livré, prouvé sur fixture, 18 tests, audit indépendant appliqué — voir
> `docs/superpowers/plans/2026-07-06-m8-tier1-write-path-rust.md`). Ce design
> couvre **uniquement le câblage IPC** (détection, table, 3 commandes) —
> l'écran/UI est un chantier séparé (suite décidée), Tier 2/3 hors scope.

## Intention

`repair_track_path` (le moteur Rust) est prouvé sûr mais totalement isolé —
rien ne l'appelle. Ce design connecte le moteur au reste de l'app : détecter
automatiquement (mais sans jamais écrire) quelles pistes filées par Sift ont
désynchronisé leur `master.db` Rekordbox, lister ces candidats, et appliquer
un lot choisi seulement après confirmation explicite de l'utilisateur (décidé
en brainstorm : jamais automatique/silencieux sur un simple déplacement de
fichier, contrairement au repair XML existant — le risque de `master.db`
n'est pas comparable à un patch texte XML).

## Détection : table dédiée + hook existant

**Table** (nouvelle migration `db.rs`) :

```sql
CREATE TABLE rekordbox_masterdb_repairs (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    track_id TEXT,                      -- djmdContent.ID ; NULL si ambigu
    candidate_track_ids TEXT,           -- IDs candidats joints par virgule, NULL sauf si ambigu
    from_path TEXT NOT NULL,
    to_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | ambiguous | applied | dismissed
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    UNIQUE(action_id)
);
CREATE INDEX idx_rkbmdb_repairs_status ON rekordbox_masterdb_repairs(status);
```

`track_id`/`candidate_track_ids` sont mutuellement mieux comprises comme un
seul cas à 3 branches, jamais mélangées :
- 0 correspondance → aucune ligne créée (rien à réparer).
- 1 correspondance → `status='pending'`, `track_id` posé, `candidate_track_ids=NULL`.
- 2+ correspondances (le vrai doublon trouvé par les spikes M8 dans la bibliothèque
  d'Antoine) → `status='ambiguous'`, `track_id=NULL`,
  `candidate_track_ids` = IDs joints par virgule — **jamais résolu
  automatiquement**, seulement listé puis `dismiss`-able.

**Détection** : nouvelle fonction `actions::detect_masterdb_repair_if_linked`,
appelée au même point d'accroche que l'existant `repair_rekordbox_xml_if_linked`
(`actions.rs:115`), même garde (pas de XML Rekordbox lié → no-op), même
convention d'erreur (lecture `master.db` illisible/corrompue →
`log::error!` + no-op, jamais de panic ni de ligne créée sur un échec de
lecture). `pioneer_dir` se déduit du dossier parent du chemin XML lié
(`settings::REKORDBOX_XML_PATH`) — pas de nouveau setting, `master.db` et
`masterPlaylists6.xml` sont toujours frères (confirmé par les spikes).
`UNIQUE(action_id)` : un second appel pour le même `action_id` (improbable
mais possible) ne duplique pas la ligne.

**Ce hook ne touche jamais `master.db`** — seulement une lecture
(`read_rekordbox_masterdb`, déjà read-only) + une écriture Sift-side (la
nouvelle table). Toute la surface de risque reste isolée à l'étape
d'application confirmée.

**Limite connue et acceptée** : un `revert` (annulation d'un déplacement)
n'invalide pas la ligne créée — exactement la même limite que le repair XML
existant (`revert_batch`/`revert_one_fs` ne rappellent pas
`repair_rekordbox_xml_if_linked` non plus, vérifié dans `actions.rs`). Pas
de tracking de revert ajouté ici (hors scope, cohérent avec l'existant) —
compensé par un garde-fou indépendant à l'application (voir plus bas).

## Commandes IPC (`ipc_library.rs`, section M8 à côté de la section M7 existante)

```rust
pub struct PendingMasterdbRepair {
    pub id: i64,
    pub track_id: Option<String>,        // None ⇒ ambigu
    pub candidate_track_ids: Option<String>,
    pub from_path: String,
    pub to_path: String,
    pub status: String,                  // "pending" | "ambiguous"
    pub detected_at: String,
}

pub struct ApplyRepairOutcome {
    pub id: i64,
    pub ok: bool,
    pub error: Option<String>,           // message humanisé
}

#[tauri::command]
pub fn rekordbox_masterdb_pending_repairs(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PendingMasterdbRepair>, String>;

#[tauri::command]
pub fn rekordbox_masterdb_apply_repairs(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    ids: Vec<i64>,
) -> Result<Vec<ApplyRepairOutcome>, String>;

#[tauri::command]
pub fn rekordbox_masterdb_dismiss_repair(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
) -> Result<(), String>;
```

- `pending_repairs` : `SELECT ... WHERE status IN ('pending','ambiguous') ORDER BY detected_at`.
- `dismiss_repair` : `UPDATE ... SET status='dismissed' WHERE id=?`.
- `apply_repairs` : voir flux détaillé ci-dessous.

### Flux `apply_repairs`, par `id`, séquentiel (jamais parallèle — un seul `master.db`)

1. Une fois, avant toute ligne : résoudre `pioneer_dir` (dossier parent du
   XML lié) — non lié → échec de tout l'appel, aucune ligne touchée.
2. Charger la ligne. Si `status != "pending"` ou `track_id` est `None`
   (ambigu) → `{ok:false, error:"ambigu, résolution manuelle requise"}`,
   **`repair_track_path` n'est jamais appelé** pour cette ligne.
3. **Garde-fou indépendant** (compense la limite "revert" ci-dessus) :
   vérifier que `to_path` existe encore sur disque. Absent → `{ok:false,
   error:"le fichier n'existe plus à l'emplacement attendu — la piste a
   peut-être été déplacée ou annulée depuis"}`, `repair_track_path` jamais
   appelé.
4. Construire `PathRepair{ track_id, new_folder_path: to_path,
   new_file_name_l: basename(to_path), new_file_name_s: basename(to_path) }`
   — **simplification délibérée** : pas de troncature DOS-8.3 pour
   `FileNameS`, le spike M8 (Éval 3) a jugé cette distinction sans
   conséquence pour la correction du repair.
5. Générer un backup_dir **propre à cette ligne**, sous
   `app_data_dir()/rekordbox-backups/<horodatage-du-lot>/<id>/` — jamais un
   dossier partagé par tout le lot : `repair_track_path` écrase des noms de
   fichiers fixes à chaque appel, donc un dossier partagé perdrait l'état
   "avant" des lignes précédentes du même lot dès la ligne suivante.
6. `repair_track_path(pioneer_dir, &backup_dir, &repair)`.
7. Succès → `UPDATE ... SET status='applied', applied_at=now`, `{ok:true}`.
8. Échec → la ligne reste `pending` (réessayable plus tard), `{ok:false,
   error: humanize(err)}`, **le lot continue** vers l'`id` suivant plutôt que
   d'abandonner — un `RekordboxRunning` sur la ligne 2 ne doit pas cacher que
   la ligne 1 a réussi.

## Messages d'erreur exacts (`humanize`, pas de "TBD" à l'implémentation)

Mêmes conventions de ton que l'existant M7 (`export_rekordbox_xml_inner`'s
`"aucun XML Rekordbox lié — relie un fichier avant d'exporter"`) :

| Cas | Message |
|---|---|
| Aucun XML Rekordbox lié (résolution `pioneer_dir`) | `aucun XML Rekordbox lié — relie un fichier avant de synchroniser` |
| Ligne `ambiguous` ou déjà `applied`/`dismissed` passée à `apply_repairs` | `piste ambiguë ou déjà traitée — résolution manuelle requise` |
| `to_path` absent du disque (garde-fou indépendant) | `le fichier n'existe plus à l'emplacement attendu — la piste a peut-être été déplacée ou annulée depuis` |
| `MasterDbError::RekordboxRunning` | `Rekordbox est ouvert — ferme-le avant de synchroniser` |
| `MasterDbError::RegistryRowMissing` | `structure de master.db inattendue — synchronisation impossible` |
| `MasterDbError::TrackNotFound{track_id}` | `piste {track_id} introuvable dans master.db — la bibliothèque Rekordbox a peut-être changé depuis la détection` |
| `MasterDbError::WriteVerificationFailedRolledBack(m)` | `l'écriture a échoué à la vérification, la sauvegarde a été restaurée automatiquement : {m}` |
| `MasterDbError::WriteVerificationFailedRollbackFailed(m)` | `l'écriture ET la restauration de la sauvegarde ont échoué — intervention manuelle nécessaire : {m}` |
| Toute autre `MasterDbError` (`Io`/`Sqlite`/…) | `err.to_string()` tel quel (déjà un `Display` lisible) |

Format du répertoire de backup : `app_data_dir()/rekordbox-backups/<horodatage-du-lot>/<id>/`,
`<horodatage-du-lot>` = `chrono::Local::now().format("%Y%m%d-%H%M%S")` calculé
**une fois par appel `apply_repairs`** (pas par ligne — sinon deux lignes du
même lot pourraient collisionner sur la même seconde), `<id>` = l'`id` de la
ligne `rekordbox_masterdb_repairs`.

## Tests

Convention `_inner` existante (`link_rekordbox_xml_inner` etc. — fonctions
testables sans `State` Tauri) :

- `detect_masterdb_repair_if_linked` : 0/1/2+ correspondances (le cas 2+
  avec un vrai test, pas seulement théorique) ; pas de XML lié → no-op ;
  lecture `master.db` échoue → no-op, pas de panic ; second appel même
  `action_id` → pas de doublon (`UNIQUE`).
- `rekordbox_masterdb_pending_repairs_inner` : exclut `applied`/`dismissed`,
  ordre par `detected_at`.
- `rekordbox_masterdb_apply_repairs_inner` (fixture `rekordbox_masterdb`
  existante, `pioneer_dir` temporaire) :
  - une ligne `pending` s'applique, passe `applied`, `applied_at` posé,
    backup dans un sous-dossier propre à la ligne.
  - lot de 2 : ligne 1 réussit, ligne 2 vise un `track_id` disparu (simule
    un `master.db` changé depuis la détection) → ligne 1 `applied`, ligne 2
    reste `pending` avec `error` peuplé (continue-on-failure prouvé).
  - une ligne `ambiguous` passée dans `ids` → `{ok:false}` **sans jamais
    appeler `repair_track_path`** (pas juste un échec récupéré).
  - `to_path` absent du disque au moment de l'apply → `{ok:false}`, garde-fou
    indépendant du revert, `repair_track_path` jamais appelé.
  - deux appels `apply_repairs` dans le même test → deux sous-dossiers de
    backup distincts, tous deux lisibles/non écrasés après coup.
- `rekordbox_masterdb_dismiss_repair_inner` : bascule `status`, disparaît de
  `pending_repairs`.
- `db.rs` : la nouvelle migration s'applique proprement (même test que les
  migrations précédentes, étendu à la nouvelle table).

## Hors scope (rappel)

UI/écran (chantier séparé, suite de ce design), Tier 2 (sync playlist),
Tier 3 (flag `TrackInfoUpdated`, bloqué sur le spike jamais correctement
refait), gestion explicite du revert (limite acceptée, cohérente avec
l'existant XML).
