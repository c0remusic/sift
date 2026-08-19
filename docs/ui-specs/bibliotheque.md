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

## Hors périmètre / questions ouvertes

- **Tonalité et énergie** — absentes du modèle (`shared/contracts.ts`, `db.rs`, vérifié
  le 2026-08-19). Aucune colonne n'est spécifiée pour elles. Les ajouter est un
  chantier d'analyse Rust, pas de design.
- **Colonne Label** — le champ existe (`LibraryTrack.label`) et n'entre pas dans les
  colonnes par défaut. À trancher : colonne optionnelle activable, ou inspecteur seul.
- **Persistance des largeurs de colonnes** — via `settings` (même magasin que
  `ui_theme`) ou `localStorage` ? Le premier survit à un changement de machine, le
  second est plus simple. Non tranché.
- **Sélection multiple et actions de masse** — quelles actions sont réellement
  applicables à N pistes rangées ? Le mode Lot de Revue en a la liste ; il faut vérifier
  laquelle vaut ici avant de peupler le menu contextuel.
