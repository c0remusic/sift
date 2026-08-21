# Spec — Revue

> ⚠️ **En retard sur le code depuis la session du 2026-08-21.** Le volet Détail a été affiné
> en direct au-delà de cette spec — voir [#47](https://github.com/c0remusic/sift/issues/47).
> Écarts principaux : le verdict est passé du « bloc d'atterrissage » (§ Zone C, point 2) à une
> **ligne d'état dans l'en-tête** (verdict + format réel, sous l'artiste) ; le **tempo et le
> key-lock (« Écoute avancée ») sont retirés** du lecteur ; les Métadonnées s'éditent **en place,
> en permanence** (plus de mode entré via « Identifier ») ; le rail d'action est **à plat et
> structuré** (labels de section + séparateurs). La **direction du lecteur n'est pas figée** :
> Antoine veut le vrai composant scrubber d'Apple, pas la waveform. Réconcilier cette spec une
> fois cette dernière décision prise.

> L'écran de décision. Le seul en profil **Poste de décision** (`DESIGN.md` § 14).

## Contexte dans le shell

Patron macOS : **Finder** pour la file et la sélection · **Utilitaire de disque** pour
le mode Lot (cible → action → progression → rapport).

Trois zones : rail (`--rail-w`, fixe) · **file** (`--pane-w`, fixe, redimensionnable
220–480 px, valeur persistée) · **surface de travail** (flexe). Pas d'inspecteur droit :
la surface de travail *est* l'inspecteur, agrandi.

**Pourquoi cette zone flexe et pas la file.** La surface porte le spectrogramme, borné
par `--measure-data` (1200 px) et **dupliqué côté Rust** dans
`analysis::spectrum::MAX_COLS`, épinglé par
`analysis::spectrum::tests::css_data_measure_matches_max_cols`. Une largeur fixe y
présenterait de la donnée étirée ou tronquée — donc fausse, dans l'app qui détecte du
faux. La contrainte est technique, pas confortable.

L'utilisateur répond ici à quatre questions, dans cet ordre :
**le fichier est-il sain ? l'identification est-elle fiable ? où va-t-il ? sous quel
format et quel nom ?**

## Layout

### Zone A — barre unifiée

Titre « Revue » + compte de la file · contrôle segmenté **Détail / Lot** · recherche à
droite (filtre la file).

La bascule Détail/Lot quitte l'en-tête de la colonne file, où elle est aujourd'hui.
C'est un mode de vue : sa place est la barre, comme Table/Grille en Bibliothèque.

### Zone B′ — file

En-tête : « File » + compte. Sous lui, la liste virtualisée.

Une ligne de file porte, dans cet ordre : **pastille de verdict** (`DESIGN.md` § 16,
même rendu qu'en Bibliothèque) · nom de fichier · artiste — titre · durée en
`--font-mono`. Hauteur `--row-h`.

Au pied : bascule « + N traités » quand la file en contient.

Poignée de redimensionnement à droite, révélée au survol.

### Zone C — surface de travail, mode Détail

**Direction « verdict promu », validée sur wireframe le 2026-08-21** (audit Revue,
skill `sift-macos-ui` ; wireframe aux tokens réels :
https://claude.ai/code/artifact/52c9e3a5-fcd6-4be8-b13d-03a40801548f). Elle répond au
défaut mesuré : la surface de travail était à moitié vide (345 px de vide sur 690 mesurés)
et le verdict — le signal central — n'était qu'un badge sur un accordéon replié. Elle
honore le patron Mail (volet de lecture plein) sans toucher à la grammaire colonne-unique
de la file. Trois directions ont été comparées (Finder-inspecteur, Photos-hero, Mail+volet)
avant de retenir celle-ci.

Ordre vertical, et il est le parcours de décision :

1. **En-tête piste** — pochette, titre, artiste, chemin d'origine.
2. **Verdict** — le **bloc d'atterrissage**, placé haut pour que l'œil tombe dessus : la
   réponse à « est-ce sain ». **Sans surface** — point de couleur + mot (`LOSSLESS`,
   `FAKE`, `DUPLICATE`, `à vérifier`) posé sur le sol, séparé par l'espace, jamais une
   carte (la carte verdict pleine page a été retirée le 2026-07-06, `verdictCardHtml()`
   est un no-op ; #8/#23 interdisent une surface de contenu dans le milieu de Revue) ni un
   dégradé. **Le verdict se dit une fois, ici.** Aucune section en dessous ne le répète —
   l'ancien badge `LOSSLESS` sur l'en-tête Diagnostic est retiré.
3. **Lecture** — bouton, forme d'onde pleine largeur, temps écoulé / restant, volume,
   tempo. La waveform ne s'anime pas au chargement.
4. **Diagnostic audio** — repliable, **fermé par défaut**. Contient le spectrogramme
   (borné à `--measure-data`) **et** les mesures (coupure, densité de l'aigu, durée, pics,
   phase, dynamique, structure) : un seul repli, les chiffres sont du contenu Diagnostic,
   pas un bandeau flottant. Fermé au repos parce que la grille se recalcule à l'ouverture
   (~631 ms mesurées) et n'est plus stockée : **le spectrogramme ne peint qu'à
   l'ouverture**, donc le passage de piste en piste (↑↓) reste instantané. L'en-tête replié
   ne porte pas de badge de verdict.
5. **Métadonnées** — **toujours visible, en liste d'attributs** (patron inspecteur : Finder
   « Lire les informations », panneau Info de Photos — à confirmer sur les HIG, ce patron
   n'est pas illustré dans `docs/design-refs/`). Montre le **résultat** d'identification tel
   qu'il sera écrit — artiste, titre, version, genres — ce qui remplit le volet
   fonctionnellement. L'édition (recherche Discogs, champs canoniques, application des tags)
   est un **mode qu'on entre** via « Identifier », pas un formulaire ouvert en permanence
   avec des champs vides. Le badge de lisibilité CDJ vit sur cet en-tête. Son **critère est
   maintenant défini** (`docs/cdj-metadata-formats.md`, 2026-08-21) : la platine affiche
   Artiste + Titre si le tag est dans un format qu'elle lit — le **WAV est exclu** (tags RIFF
   INFO non affichés fiablement, elle retombe sur le nom de fichier). Le code ne l'applique
   pas encore ([#46](https://github.com/c0remusic/sift/issues/46)) : il teste la seule
   présence d'Artiste+Titre, donc un WAV taggé passe faussement « compatible ».

### Zone C, pied — rail d'action

Barre persistante, jamais dans le flux de défilement.

**Réglage à gauche, engagement à droite.** Rangée du haut, de gauche à droite :
**Destination** (bouton ouvrant l'arbre en popover) · **Format** (contrôle segmenté :
MP3 320 · AIFF 16/44 · WAV 16/44, options lossless désactivées sur source lossy) ·
**Nom final** (aperçu, rendu par `previewFilename`, **jamais** réimplémenté en TS).

Rangée du bas, **actions groupées au bord droit (trailing)** : **Écarter** (secondaire,
ghost — ou Re-source si le verdict est `fake`) puis **Convertir** (action principale,
dominante, aplat d'accent, la plus à droite). C'est la convention macOS du bouton par
défaut au bord trailing, et Convertir est l'action `Entrée` : l'œil lit « je règle à gauche,
je valide à droite ». Le contraste ghost / aplat porte seul la distinction entre les deux
issues opposées (comme macOS sépare Annuler du bouton par défaut par le style, pas par un
grand écart). ⚠️ Le rendu actuel **aligne les deux boutons à gauche** — dérive à corriger à
l'implémentation.

En pied, la **légende des raccourcis** en ligne discrète, centrée, toujours visible.

### Zone C — mode Lot

La zone C devient une table à cases à cocher. La file et le rail restent en place.

Patron Utilitaire de disque : les pistes cochées sont la **cible**, « Ranger la
sélection » est l'**action** unique et dominante, la **progression** s'affiche en sheet
attachée à la fenêtre, le **rapport** final donne rangés / à valider / échecs avec accès
au détail des échecs.

Colonnes : case · pastille de verdict · nom · format · durée. Groupes : file · faux ·
lecture seule.

## États

| État | Rendu |
|---|---|
| **File vide** | `emptyStateHtml` dans la zone C — « Tout est trié », compte de ce qui a été traité, action vers Bibliothèque |
| **Aucune piste ouverte** | Zone C en indice sobre, jamais un canevas nu |
| **Analyse en cours** | Ligne de file avec indicateur ; la zone C montre ce qui est déjà connu (tags, nom) et un squelette pour ce qui manque |
| **Analyse échouée** | La ligne se voit **mieux** que les autres, pas moins bien. Jamais d'atténuation à l'opacité. Bouton Réanalyser dans la ligne |
| **Rangement en cours** | Bouton Ranger en attente, rail verrouillé, file non bloquée |
| **Rangé** | Bandeau au-dessus du rail, avec le chemin final. Neutre, pas coloré en permanence — seule la transition se colore |
| **Lot, confirmation** | Au-delà de `BATCH_CONFIRM_THRESHOLD`, confirmation in-app **armée et horodatée**. Jamais `window.confirm()` |
| **Lot, progression** | Sheet attachée, barre déterminée, étape en texte, Annuler toujours présent |
| **Destination non réglée** | Porte de premier réglage dans le popover Destination. L'échec de lecture de l'arbre se dit **avant** la porte |

## Interactions

### Souris

- **Clic** ligne de file : ouvre la piste dans la zone C.
- **Clic droit** ligne : Ouvrir l'emplacement · Réanalyser · Écarter · Changer la
  destination.
- **Clic** sur la waveform : déplace la lecture. Survol : indicateur de position.
- **Glisser** la poignée : largeur de la file, persistée.
- **Glisser** des fichiers depuis l'OS sur la file : import. Sur le rail d'action :
  nouvelle destination.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9, plus la couche 3 propre à cet écran :

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `Entrée` | Ranger |
| `⌫` ou `X` | Écarter, ou Re-source si le verdict est `fake` |
| `I` | Identifier |
| `↑` `↓` | Piste précédente / suivante dans la file |

Règles de focus, non négociables : aucun raccourci ne se déclenche dans un `INPUT` ou
un `TEXTAREA` ; un raccourci à une lettre retire le focus du bouton actif avant d'agir
(sinon `Espace` active le bouton focalisé **et** la lecture) ; en mode Lot, les lignes
de sélection possèdent `Espace` et `Entrée` exclusivement.

### Retour

Le pouce du contrôle segmenté de format glisse en `--duration-slow`. Le passage d'une
piste à l'autre ne rejoue aucune animation d'entrée : c'est un changement de contenu,
pas une transition d'écran. La forme d'onde ne s'anime pas au chargement.

## Hors périmètre / questions ouvertes

- **Analyse froide et réactivité.** `analyze_path` est une commande Tauri **synchrone**
  qui appelle `analyse()` en ligne sur cache miss : toute l'IPC est bloquée pendant.
  Le dépôt a l'outil pour chiffrer la durée (`bench_sqlite.rs` via
  `SIFT_BENCH_TRACKS_DIR`, `--ignored`) et ce chiffre n'existe pas. Tant qu'il manque,
  « ça gèle » est vrai en droit et inconnu en amplitude. **Décision d'architecture, pas
  de design.**
- **Seuil de confirmation du Lot.** `BATCH_CONFIRM_THRESHOLD = 10` traite au même niveau
  une action annulable (ranger) et une irréversible (purger). Deux réglages, pas une
  suppression — la confirmation elle-même reste, elle vise un clic non humain.
- **Recherche dans la file.** Utile au-delà de combien d'entrées ? Non tranché.
- **Patron inspecteur des Métadonnées.** Le « toujours visible en liste d'attributs » est
  repris de Finder « Lire les informations » et du panneau Info de Photos, mais ces panneaux
  ne sont **pas** dans `docs/design-refs/` (vues grille/liste seulement). À confirmer sur les
  HIG avant l'implémentation.
- **Critère du badge CDJ — établi, code à recâbler.** La matrice format-de-tag × platine est
  documentée (`docs/cdj-metadata-formats.md`) : le WAV est le vrai cas d'échec (tags non
  affichés fiablement), la version ID3 n'est pas une contrainte. Le check `tags_cdj_ok`
  (`analysis/tags.rs:85`) reste à recâbler sur le format réel via `lofty`
  ([#46](https://github.com/c0remusic/sift/issues/46)). Question restante : faut-il intégrer
  la contrainte codec / génération (FLAC/ALAC ≥ 2016) au badge, ou la laisser hors champ.
