# Bibliothèque — vue tableau + grille pochettes + arbre Artistes

Date : 2026-07-09
Contexte : Antoine veut que l'onglet Bibliothèque se rapproche de MusicBee en
fonctions (pas en look). Brainstorm en dialogue + compagnon visuel
(3 rounds de maquettes, voir `.superpowers/brainstorm/45902-1783586150/`).

## Périmètre

Ce chantier couvre uniquement l'**affichage** : vue tableau triable, vue
grille pochettes, et une nouvelle facette Artistes dans le panneau latéral.
Le fetch automatique d'images artiste/label depuis Discogs est un
**sous-système séparé** (chantier 2, non couvert ici) — cette vue affiche
les artistes sans avatar pour l'instant, l'avatar viendra se greffer une
fois le chantier 2 livré.

**Décision actée pendant le brainstorm** : pas de niveau Album dans l'arbre.
Le schéma `metadata` actuel (`artist`/`title`/`label`/`year`/`genre`/
`version`) n'a pas de champ album, et la majorité de la crate d'Antoine est
constituée de singles/rips isolés, pas d'albums complets. L'arbre est donc
**Artiste → Pistes** (2 niveaux), pas Artiste → Album → Pistes. Différé, pas
écarté : si un vrai besoin de groupement par sortie apparaît, on pourra
dériver un pseudo-album depuis le titre de la release Discogs identifiée
(quand elle existe) — non fait ici faute de champ stocké aujourd'hui.

## Architecture

Deux modes d'affichage basculables via un segmented control
(`.sift-seg`/`.sift-seg-opt`, même composant que Détail/Lot en Revue et
Format en filing) :

- **Tableau** (défaut) — colonnes Pochette / Artiste / Titre / Genre / Année,
  en-tête cliquable pour trier.
- **Grille** — tuiles carrées pochette + titre + artiste, façon casier de
  disques.

Le panneau latéral gagne une 3ᵉ facette **Artistes**, à côté de Dossiers et
Genres (mêmes `.sift-seg` que l'existant, `sift-live.ts`). Cliquer un
artiste filtre le Tableau/Grille sur ses pistes — même mécanisme que le
clic Dossiers/Genres actuel (`data-bib="pick"`).

## Backend (Rust)

### `LibraryFacets` — nouveau champ `artists`

`src-tauri/src/library.rs:60-63` :

```rust
pub struct LibraryFacets {
    pub folders: Vec<LibraryFolder>,
    pub genres: Vec<LibraryFolder>,
    pub artists: Vec<LibraryFolder>,   // nouveau — réutilise LibraryFolder (name+count)
}
```

`folder_facets()` (`library.rs:288`) gagne une 3ᵉ requête, même patron que
`genres` :

```sql
SELECT m.artist, COUNT(*) FROM metadata m
JOIN tracks t ON t.id = m.track_id AND t.status='filed'
WHERE m.artist IS NOT NULL AND m.artist <> ''
GROUP BY m.artist ORDER BY m.artist
```

Pas de nouvelle commande IPC — `library_folders` (`ipc_library.rs:22`)
retourne déjà `LibraryFacets` en entier, le front reçoit `artists` dans le
même aller-retour que `folders`/`genres`.

### `LibraryFilter` — nouveau champ `artist`

`library.rs:38-49` gagne `pub artist: Option<String>`, branché dans
`list_filed()` (`library.rs:188`) avec le même patron que `folder`/`genre`
(`AND m.artist = :artist`, exact match). Aucun changement à `LibraryTrack` —
`artist` y est déjà présent (`library.rs:20`).

### Tri — aucun changement backend

Le tri de la vue Tableau est **côté client** (voir Frontend) — le jeu de
données d'une bibliothèque DJ personnelle reste modeste (dizaines à
quelques milliers de pistes), pas besoin d'un `ORDER BY` paramétrable côté
SQL pour ce volume.

## Frontend (TypeScript)

### Nouveau fichier `frontend/library-views.ts`

`library-detail.ts` gère déjà l'édition/le panneau détail d'une piste
ouverte — y ajouter le rendu tableau+grille l'alourdirait sans rapport avec
sa responsabilité actuelle (édition). Nouveau fichier dédié au **rendu de
la liste** (tableau/grille), appelé depuis `sift-live.ts` (qui pilote déjà
l'écran Bibliothèque) :

- `renderLibraryTable(container, tracks, sortState)` — construit les lignes,
  gère le clic d'en-tête (toggle asc/desc, flèche indicatrice `▾`/`▴` sur la
  colonne active), tri client via `Array.prototype.sort` sur le champ actif
  (`artist`/`title`/`genre`/`year`, `localeCompare` pour les chaînes).
- `renderLibraryGrid(container, tracks)` — tuiles `.sift-ui-card`-like,
  pochette via `convertFileSrc(track.cover_path)` si présent, sinon
  l'icône de repli `ti-vinyl` déjà utilisée ailleurs (voir
  `library-detail.ts:57`, cohérent avec l'existant).
- Les deux réutilisent le clic existant pour ouvrir le panneau détail
  (`openReportInto`/l'équivalent déjà câblé sur les lignes `.lr`).

### Mode d'affichage (segmented)

Nouveau segmented `.sift-seg` (2 options : Tableau/Grille) au-dessus de la
liste, état en variable module-level (comme `queueShowAll`,
`sift-live.ts:140`) — pas persisté entre sessions pour ce chantier, défaut
Tableau à chaque ouverture de l'écran. Persistance différée : si Antoine
trouve ça frustrant à l'usage, ajouter une clé `settings` (même patron que
`ui_theme`).

### Facette Artistes

Même patron que Dossiers/Genres existant (voir
`docs/design-system-states.md`, section "Pastille segmentée" pour l'onglet
de bascule entre facettes) — ajoute un 3ᵉ onglet, liste les entrées
`facets.artists` triées par nom, clic pose `filter.artist` et re-fetch
`list_library`.

## Accessibilité

Suit la convention posée pendant l'audit référence canonique 2026-07-09
(`docs/design-system-states.md`, "Écran Bibliothèque") : lignes de tableau
et tuiles de grille cliquables reçoivent `tabindex="0"`/`role="button"`,
clavier via `installNavKeyboard()` déjà étendu. En-têtes de colonnes
triables : `<button>` natif (pas de `role` custom nécessaire), avec
`aria-sort` (`ascending`/`descending`/`none`) sur le `<th>` parent pour
annoncer l'état de tri aux lecteurs d'écran.

## Erreurs

Aucun nouveau mode d'erreur : `list_library`/`library_folders` suivent déjà
le patron `invoke()` → `catch` → `toast(...)` en cas d'échec IPC. Un artiste
sans piste (filtre vide après un rangement/suppression) retombe sur l'état
vide déjà géré par la Bibliothèque.

## Tests

- **Rust** : test pour la requête `artists` de `folder_facets` (comptage
  correct, tri alphabétique) — même patron que
  `folder_facets_counts_filed_by_folder_and_genre` (`library.rs:609`) ;
  test pour `list_filed` filtré par `artist` — même patron que le filtre
  `folder`/`genre` existant.
- **Frontend** : pas de runner de test (convention projet) — `npx tsc
  --noEmit` clean, vérification visuelle dans `tauri dev` (tri, bascule
  Tableau/Grille, clic facette Artistes, clavier) par Antoine ou via CDP
  ponctuel.

## Différé (hors scope explicite)

- Fetch d'images artiste/label Discogs (chantier 2, sous-système séparé).
- Niveau Album dans l'arbre (pas de champ stocké aujourd'hui — trigger de
  réouverture : si un vrai besoin de groupement par sortie apparaît).
- Persistance du mode d'affichage (Tableau/Grille) entre sessions — trigger :
  si Antoine trouve la réinitialisation à chaque ouverture frustrante.
- Édition en masse multi-sélection (évoqué comme option non retenue pendant
  le brainstorm — pas demandé explicitement).
