# M8 Tier 1 — écran UI des réparations `master.db` (design)

> Statut : design, prêt pour `writing-plans`. Dernière pièce manquante avant
> tout usage réel de Tier 1 (voir `docs/plan-implementation.md:236-255`) — le
> moteur (`repair_track_path`) et le câblage IPC (3 commandes) sont déjà
> livrés et testés (`docs/superpowers/plans/2026-07-06-m8-tier1-ipc-wiring.md`).
> Ce design ajoute uniquement l'écran qui consomme ces commandes, plus une
> extension backend ciblée pour la résolution manuelle des lignes ambiguës.

## Intention

`rekordbox_masterdb_pending_repairs`/`apply_repairs`/`dismiss_repair`
existent côté Rust et sont déjà mirorées en TypeScript (`frontend/ipc.ts:281-291`)
mais aucun écran ne les appelle — le seul signal visible aujourd'hui est un
`console.log` de détection et une bannière statique sans rapport
(`drift_detected`, voir clarification ci-dessous). Ce chantier construit
l'écran qui rend Tier 1 réellement utilisable.

## Clarification actée en amont : deux signaux distincts, jamais fusionnés

`RekordboxLinkStatus.drift_detected` (`ipc_library.rs:98`) signale un échec de
la réparation **XML** existante (`repair_rekordbox_xml_if_linked`) — un
mécanisme totalement différent des réparations `master.db` (table
`rekordbox_masterdb_repairs`). La bannière `drift_detected` déjà affichée dans
`renderRekordboxLive()` (`sift-live.ts:1550-1560`) reste **inchangée**. La
nouvelle section décrite ici s'ajoute **en dessous**, comme un bloc
indépendant — jamais fusionnés dans un même message générique.

## Placement dans la page Rekordbox

Dans `renderRekordboxLive()` (`sift-live.ts:1519-1563`), après
`rekordboxCardHtml(status)` :

```
intro
driftBanner        (inchangé, signal XML)
rekordboxCardHtml   (inchangé)
masterdbRepairsSection   ← nouveau
```

Chargée seulement quand `status.linked === true` (même garde que le reste de
la page — `pioneer_dir` se déduit du chemin XML lié, donc la section n'a pas
de sens sans lien). Indépendante de `status.error` : la lecture `master.db`
ne dépend que du **dossier parent** du chemin XML lié, pas de sa lisibilité
XML — une section peut donc apparaître même si `status.error` est vrai.

**Absence de contenu = section absente** (pas de "0 réparation en attente"),
cohérent avec le reste de la page (`driftBanner` suit la même règle).

## Chargement des données

`rekordboxMasterdbPendingRepairs()` appelée dans `renderRekordboxLive()` juste
après avoir confirmé `status.linked`, en parallèle du reste du rendu de la
page (pas de `Promise.all` avec `rekordboxStatus()` lui-même, puisque l'appel
est conditionné à son résultat). Échec de l'appel → section masquée +
`console.error`, le reste de la page (statut/bannière) reste fonctionnel —
jamais un `renderRekordboxLive()` entier cassé par un souci sur cette seule
section.

## Extension backend : résolution manuelle des lignes ambiguës

Décision actée : contrairement au choix minimal initial (lignes ambiguës en
lecture seule, dismiss uniquement), l'utilisateur doit pouvoir **choisir
manuellement** le bon candidat. Deux additions, toutes deux **additives** au
design IPC déjà livré (aucune régression sur le contrat existant) :

### 1. Enrichissement de `rekordbox_masterdb_pending_repairs`

Nouveau champ sur `PendingMasterdbRepair` :

```rust
pub struct PendingMasterdbRepair {
    pub id: i64,
    pub track_id: Option<String>,
    pub candidate_track_ids: Option<String>,
    pub candidate_tracks: Option<Vec<CandidateTrack>>,  // NOUVEAU
    pub from_path: String,
    pub to_path: String,
    pub status: String,
    pub detected_at: String,
}

pub struct CandidateTrack {
    pub track_id: String,
    pub folder_path: Option<String>,  // None si l'ID n'existe plus dans master.db
}
```

Calcul, une seule fois par appel (pas par ligne) : si au moins une ligne
`ambiguous` existe, résoudre `pioneer_dir` puis `read_rekordbox_masterdb` une
fois ; construire une map `track_id → folder_path` réutilisée pour enrichir
toutes les lignes ambiguës du lot. Échec de résolution `pioneer_dir` ou
lecture `master.db` → `candidate_tracks: None` sur toutes les lignes
concernées (dégradation gracieuse : le front retombe sur l'affichage des IDs
bruts, la commande entière ne doit jamais échouer pour cette seule raison —
les lignes `pending` normales restent listées).

### 2. Nouvelle commande `rekordbox_masterdb_resolve_ambiguous`

```rust
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String>;
```

Flux :
1. Charger la ligne `id`. `status != "ambiguous"` → erreur
   `"cette ligne n'est plus ambiguë — rechargement nécessaire"`.
2. `chosen_track_id` doit être un élément de `candidate_track_ids` (split
   par virgule) — sinon `"piste choisie invalide pour cette ambiguïté"`.
3. `UPDATE ... SET track_id=?, candidate_track_ids=NULL, status='pending' WHERE id=?`.

Après résolution, la ligne est un `pending` ordinaire — **aucun changement**
au flux `apply_repairs` existant, elle devient sélectionnable/appliquable
normalement au prochain rendu de la section.

**Aucune migration de schéma** (colonnes déjà en place, juste un nouveau chemin
d'écriture dessus).

## Écran : structure et interactions

Ordre d'affichage dans la section : groupe **ambiguous** d'abord (nécessite
une action pour devenir utile), puis groupe **pending** (prêt à appliquer) —
même logique de priorité que la routage par confiance déjà documentée
ailleurs dans le plan (le cas qui bloque le plus passe en premier).

Actions `data-sift` ajoutées au dispatcher délégué existant
(`sift-live.ts:1929`) : `mdbpick` (toggle checkbox d'une ligne pending),
`mdbapply` (bouton batch), `mdbdismiss` (`data-id`, pending ou ambiguous),
`mdbresolve` (`data-id` + `data-track`, ambiguous uniquement).

### Groupe "pending" (résolu, prêt à appliquer)

Réutilise le pattern déjà en place (`sift-batch-ck`/`.bx-row`,
`sift-live.ts:708-722`) plutôt qu'un nouveau système de sélection :

- Une ligne par réparation : checkbox + chemin avant→après (réutilise le
  pattern `pathBeforeAfter` déjà utilisé pour le renommage de fichiers,
  `sift-live.ts:~685-707` — "was <chemin>" en petit sous le nouveau) + bouton
  "Ignorer" (`data-sift="mdbdismiss"`, appelle `dismiss_repair` puis
  recharge la section).
- Barre "Appliquer la sélection (N)" sous la liste, visible seulement si
  ≥ 1 case cochée. État local `mdbRepairSel: Set<number>`, réinitialisé à
  chaque rendu de la section (pas persisté entre navigations, comme
  `batchSel`).

### Groupe "ambiguous" (résolution manuelle requise)

- Une ligne par cas : chemin avant→après, puis la liste des candidats
  (`candidate_tracks`) sous forme de boutons "Choisir cette piste"
  (`data-sift="mdbresolve"`, `data-id` + `data-track`) affichant
  `folder_path` du candidat (ou `track_id` brut si `folder_path` est `None`).
  Bouton "Ignorer" disponible aussi (même dismiss que pending).
- Choisir un candidat → `resolveMasterdbAmbiguous(id, trackId)` → recharge la
  section (la ligne réapparaît dans le groupe pending si le choix a réussi).

### Confirmation avant écriture

Avant tout appel `rekordboxMasterdbApplyRepairs(ids)` : `confirmAction()`
(jamais `window.confirm()`, règle CLAUDE.md) avec un message nommant le
nombre de pistes et rappelant "Ferme Rekordbox avant de continuer" — cohérent
avec la décision de brainstorm citée dans le design Tier 1 IPC
("aucune écriture automatique/silencieuse").

### Résultat de l'application

`apply_repairs` retourne `ApplyRepairOutcome[]` (un par id envoyé). Après
l'appel :
- `toast()` (fonction déjà locale à `sift-live.ts:585`) résume le lot :
  "N réparation(s) appliquée(s)" ou "N appliquée(s), M échouée(s)" selon le
  mix de résultats.
- Recharger la section (`pending_repairs` frais) — les lignes réussies
  disparaissent (passées `applied` en DB, donc hors du filtre
  `pending`/`ambiguous`) ; les lignes échouées réapparaissent en `pending`,
  décochées, avec leur message d'erreur humanisé affiché en petit sous le
  chemin (état transitoire uniquement en mémoire — pas de colonne d'erreur
  en DB, cohérent avec le schéma existant qui ne stocke pas de message
  d'échec par ligne).

## Erreurs / échecs de commande (pas de la ligne, de l'appel IPC lui-même)

`dismiss`/`resolve`/`apply` qui lèvent une exception IPC (jamais une réponse
métier normale) → `console.error` + `toast()` générique ("Action
impossible — réessaie"), section rechargée quand même pour refléter l'état
réel côté DB. Même convention que le reste du fichier (`dupresolve`,
`renderRekordboxLive` lui-même).

## Hors scope

- Tier 2 (dédup playlists), Tier 3 (flag `TrackInfoUpdated`) — inchangés,
  toujours non commencés.
- Vérification manuelle sur une vraie copie de `master.db` + validation
  Antoine dans le vrai Rekordbox (reste un point ouvert distinct, à faire
  après cette UI, pas remplacé par elle).
- Gestion du cas "revert d'un déplacement" (limite déjà actée et acceptée
  dans le design IPC, pas réouverte ici).
- Pagination/virtualisation de la liste — le volume attendu (repairs par
  lot de filing) est sans commune mesure avec la bibliothèque (15k+ pistes),
  pas de raison de complexifier.

## Tests

- Rust : `rekordbox_masterdb_pending_repairs_inner` étendu (nouveau champ
  `candidate_tracks` peuplé pour un cas ambigu avec master.db lisible ;
  `None` si master.db illisible ou `pioneer_dir` non résolu — les lignes
  `pending` normales restent présentes dans les deux cas).
  `rekordbox_masterdb_resolve_ambiguous_inner` : résolution réussie (ligne
  devient `pending`, `candidate_track_ids` vidé) ; `chosen_track_id` hors
  liste → erreur, aucune mutation ; ligne déjà `pending`/`applied`/`dismissed`
  → erreur, aucune mutation.
- Front : `npx tsc --noEmit` clean. Vérification réelle en `tauri dev` par
  Antoine (code gated `inTauri`, cf. règle de vérification UI du CLAUDE.md) —
  scénario minimal : au moins une ligne pending et une ligne ambiguous
  présentes en DB de test, section visible, sélection + apply + dismiss +
  resolve exercés une fois chacun.
