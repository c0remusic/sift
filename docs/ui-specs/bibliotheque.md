# Spec — Bibliothèque

> Écran canonique. Les cinq autres specs héritent de sa table (`DESIGN.md` § 16) et
> ne redécrivent que leurs écarts. Toute décision prise ici et contredite ailleurs
> est un défaut, pas une variante.

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Finder / Music** — sidebar de
sources, toolbar unifiée, table dense, inspecteur.

Trois zones : rail (`--rail-w`, fixe) · table (flexe) · inspecteur (`--pane-w`, fixe,
repliable). La page ne défile pas ; la table défile chez elle, en-têtes de colonne
figés.

Cet écran absorbe **Écartés** (`DESIGN.md` § 15, fusion 2) : « À re-sourcer » et
« Corbeille » sont deux entrées de la section Bibliothèque du rail, rendues par la
même table.

## Layout

### Zone B — rail, section « Bibliothèque »

Trois entrées, sélection exclusive, fond plein arrondi
(`--color-background-secondary`) sur l'active :

| Entrée | Contenu de la table | Compte |
|---|---|---|
| **Rangés** | Pistes converties et rangées | oui |
| **À re-sourcer** | Écartées avec un motif récupérable | oui, ton `warning` si > 0 |
| **Corbeille** | En attente de purge | oui, ton neutre |

Sous ces trois entrées, la **facette active** se choisit dans la barre unifiée, pas
dans le rail — le rail porte des *sources*, pas des filtres.

### Zone A — barre unifiée

De gauche à droite après les contrôles de fenêtre :

1. **Titre** — le nom de la source active (« Rangés », « À re-sourcer », « Corbeille »),
   suivi du compte en `--color-text-tertiary`.
2. **Facette** — contrôle segmenté à trois options : Dossiers · Genres · Artistes.
   Le choix pilote le contenu du sélecteur de facette (ci-dessous).
3. **Qualité** — trois chips : Tous · Lossless · MP3. Grammaire chip (filtre non
   exclusif de la facette), pas contrôle segmenté.
4. **Doublons** — action, pas filtre. Lance le scan sur toute la bibliothèque.
5. **Mode de vue** — contrôle segmenté, deux icônes : Table · Grille.
6. **Recherche** — à droite, toujours. ⌘/Ctrl+F y place le focus.

Le sélecteur de facette (liste des dossiers / genres / artistes avec leurs comptes)
descend en **tête de la table**, replié par défaut en un bouton portant la valeur
active. Il ne prend plus une colonne à lui : il filtrait, et un filtre appartient à la
barre. Ce geste supprime `.sift-library-side` et sa hauteur
`calc(100dvh - 210px)`, qui encodait la hauteur du bloc au-dessus.

### Zone C — table

Colonnes, largeurs, tri, densité, sélection, menu contextuel : **`DESIGN.md` § 16 sans
écart**. Rappel des deux ajouts : **BPM** et **Durée**, colonnes fixes en `--font-mono`
avec `tabular-nums`, alignées à droite.

En-tête de table figé pendant le défilement.

Au-dessus de la table, une seule ligne : bouton de facette · nom de la valeur active ·
compte de pistes. Les cartes de statistiques d'aujourd'hui (`statsCardsHtml`) quittent
le haut de l'écran — elles poussaient tout le contenu vers le bas et forçaient la
constante `210`. Leur donnée remonte dans l'inspecteur en état « aucune sélection ».

**Mode Grille** : mêmes données, tuiles de pochette. Il hérite du tri de la table et
n'a pas de contrôle de tri propre. `LIBRARY_GRID_TILES_PER_ROW` reste piloté par la
largeur réelle de la zone, pas par une constante.

Virtualisation obligatoire dans les deux modes — la zone C est le conteneur de
défilement, plus `#content`.

### Zone D — inspecteur

- **Aucune sélection** — résumé de la source active : nombre de pistes, répartition par
  format, occupation disque. C'est là que vont les cartes de statistiques retirées de
  la zone C.
- **Une piste** — pochette, artiste, titre, version · lecture et forme d'onde ·
  verdict avec son détail · métadonnées (label, année, genres, BPM, durée, format,
  débit) · chemin du fichier · actions : Identifier, Fiche Discogs, Réanalyser.
- **Plusieurs pistes** — résumé agrégé : compte, formats présents, durée totale, et les
  seules actions applicables en masse.

Sections repliables, en-têtes discrets, libellé à gauche en `--color-text-secondary`,
valeur à droite en `--color-text-primary`.

### Section doublons

Aujourd'hui rendue dans le flux, sous la table. Elle devient un **mode de la zone C** :
lancer le scan remplace la table par la liste des groupes, avec un retour explicite.
Un scan est un résultat, pas un appendice de liste.

## États

| État | Rendu |
|---|---|
| **Vide, sans filtre** | `emptyStateHtml` — « Bibliothèque vide », note vers Revue, une action. Impasse assumée : le rail et la barre restent |
| **Vide, avec filtre** | La table seule est remplacée par « Aucun résultat » + « Réinitialiser les filtres ». Barre, facettes et recherche **restent à l'écran** — le filtre doit pouvoir être défait |
| **Chargement, premier rendu** | Squelette de lignes dans la structure finale. Jamais un écran blanc |
| **Chargement, re-rendu** | Les données valides restent affichées. Un rendu déclenché par une frappe, un clic de facette ou un changement de tri **ne blanchit jamais** l'écran |
| **Recherche en cours** | Indicateur discret dans la barre unifiée, à droite du champ. Débounce 250 ms |
| **Scan de doublons en cours** | Zone C en mode scan, progression déterminée, bouton Annuler présent |
| **Erreur de scan** | Carte douce, encre `danger`, bouton Réessayer. **Rien n'est dit du contenu** : ne jamais afficher « aucun doublon » après un scan échoué |
| **Sélection** | `--color-background-secondary` sur les lignes, inspecteur en résumé agrégé |

## Interactions

### Souris

- **Clic** ligne : sélectionne, remplit l'inspecteur.
- **⇧+clic** : étend la plage · **⌘/Ctrl+clic** : ajoute ou retire.
- **Double-clic** : ouvre l'emplacement du fichier.
- **Clic** sur le bouton lecture de la ligne : écoute. Seul bouton restant dans la ligne.
- **Clic droit** : Ouvrir l'emplacement · Identifier · Fiche Discogs · Réanalyser ·
  Écarter · (sur À re-sourcer et Corbeille) Restaurer, Purger.
- **Glisser** sur un séparateur d'en-tête : largeur de colonne, mémorisée.
- **Glisser** un en-tête : ordre des colonnes, mémorisé.
- **Glisser** un dossier depuis l'OS : ajout aux sources surveillées.

### Clavier

Couche 1 et couche 2 de `DESIGN.md` § 9 intégralement. Rien de propre à cet écran, et
c'est voulu — une table se pilote partout de la même façon.

`⌘/Ctrl+F` place le focus dans la recherche · `Échap` la vide puis rend le focus à la
table.

### Retour

Changement de facette et de tri : instantané, aucune animation sur les lignes.
Le pouce du contrôle segmenté glisse en `--duration-slow`.
Aucune animation sur le défilement ni sur le tri.

## Décisions du 2026-08-19

Les trois questions ouvertes de cette spec sont tranchées ci-dessous, chacune par une
mesure du dépôt et non par arbitrage de goût.

### Actions de masse — trois, et le contrat IPC les nomme

La question était : « quelles actions s'appliquent réellement à N pistes **déjà
rangées** ? » Le mode Lot de Revue n'en offre que deux, Convertir et Écarter
(`batch-panel.ts::actionButtonHtml`), et la première n'a pas d'objet ici : une piste de
la Bibliothèque est par définition déjà convertie et rangée. Il restait donc à mesurer
ce que le contrat permet, action par action.

| Action | En masse ? | Pourquoi |
|---|---|---|
| **Réanalyser** | oui | `reanalyzeTracks(trackIds: number[])` prend déjà un tableau (`ipc.ts:51`). Non destructive |
| **Écarter** | oui | `rejectBatch(trackIds)` existe et rend `{rejected, failed[]}` (`ipc.ts:233`) — c'est l'IPC du mode Lot |
| **Corbeille** | oui | `trashTrack(trackId)` est unitaire : la boucle se fait côté frontend, séquentiellement |
| Ouvrir le détail | non | Singulier par définition — un inspecteur montre une piste |
| Fiche Discogs | non | Ouvrirait N pages de navigateur |
| Identifier | non | Réseau Discogs, et chaque identification demande de **choisir** un candidat. Une identification de masse serait un choix pris à la place de l'utilisateur |

Le menu contextuel garde donc **la même liste d'entrées à la même position**, que la
sélection porte une piste ou mille — règle de `context-menu.ts` : ce qui ne s'applique
pas est **désactivé, jamais retiré**. Seuls les libellés portent le compte au-delà de
une.

**Confirmation.** Écarter et Corbeille au-delà de `BATCH_CONFIRM_THRESHOLD` (10, la
constante du mode Lot) passent par `confirmAction()` — modale in-app armée, jamais
`window.confirm()`. Le motif n'est pas la réversibilité (les deux sont annulables) mais
le clic qui n'est pas humain, et `⌘/Ctrl+A` sur une liste virtualisée sélectionne
précisément ce qu'on ne voit pas.

**Compte-rendu.** `rejectBatch` rend `failed[]` : le toast dit le nombre réellement
traité et nomme les échecs. Un compte seul se lirait comme un succès plus petit.

### Colonne Label — inspecteur seul

`LibraryTrack.label` existe et reste **hors des colonnes**. Une colonne optionnelle
supposerait un mécanisme de colonnes activables qui n'existe nulle part : `SORT_COLUMNS`
(`library-views.ts:62`) est une liste fixe de six entrées et les largeurs sont des
règles CSS (`.sift-lib-col-*`, `styles.css:945-949`). Construire ce mécanisme pour un
seul champ dont personne ne trie une bibliothèque de DJ est disproportionné. Le label
reste éditable dans l'inspecteur (`library-detail.ts:89`), là où il est déjà.

À rouvrir si le mécanisme de colonnes optionnelles arrive par ailleurs — il est déjà
demandé par `DESIGN.md` § 16 (largeurs et ordre mémorisés), et ce jour-là Label est le
premier candidat.

### Persistance des largeurs de colonnes — `localStorage`, et l'argument d'origine était faux

La question opposait `settings` à `localStorage` au motif que « le premier survit à un
changement de machine ». **C'est faux** : la base vit dans `app_data_dir()`
(`src-tauri/src/lib.rs:222`), donc dans le profil utilisateur de la machine, exactement
comme `localStorage`. Ni l'un ni l'autre ne suit l'utilisateur ailleurs.

La ligne de partage réelle est celle que le dépôt applique déjà :

- `localStorage` — **état d'affichage de la fenêtre**, que le backend ne lit jamais.
  Précédent : le repli du rail (`chrome.ts:377`).
- `settings` (SQLite) — **configuration produit** que Rust lit aussi : racine de
  bibliothèque, token Discogs, thème, gabarit de nom de fichier.

Une largeur de colonne est de la première catégorie. Décision : `localStorage`, avec le
`try/catch` du rail — un stockage refusé ne doit pas casser la table.

⚠️ **Le geste n'existe pas encore.** Vérifié le 2026-08-19 : aucun redimensionnement ni
réordonnancement de colonnes dans le dépôt — `col-resize` n'apparaît que sur la poignée
de la file de Revue (`styles.css:729,761`). Cette décision est donc une **règle en
attente de son premier consommateur**, pas un changement à faire aujourd'hui.

## Écarts constatés entre cette spec et le code, au 2026-08-19

Relevés en tranchant les questions ci-dessus. Aucun n'est corrigé dans ce geste.

- **« Ouvrir l'emplacement » n'est appelable par rien.** La section Souris la donne en
  première entrée du clic droit, et le double-clic est censé faire la même chose.
  Aucune commande ne l'expose : zéro occurrence de `reveal`, `open_path` ou équivalent
  dans `frontend/ipc.ts` **et** dans `src-tauri/src/ipc*.rs`. C'est une commande Rust à
  écrire, pas une entrée de menu à ajouter.
- **« Restaurer » et « Purger » au clic droit** supposent que « À re-sourcer » et
  « Corbeille » soient rendues par cette table — c'est la fusion 2, **réfutée par la
  mesure** (`DESIGN.md` § 15). Ces deux actions restent chez Écartés.
- **Largeurs et ordre de colonnes au glisser** : non implémentés, voir ci-dessus.

## Hors périmètre

- **Tonalité et énergie** — absentes du modèle (`shared/contracts.ts`, `db.rs`, vérifié
  le 2026-08-19). Aucune colonne n'est spécifiée pour elles. Les ajouter est un
  chantier d'analyse Rust, pas de design.
