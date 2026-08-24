# Spec — Revue

> **Réconciliée le 2026-08-21**, **complétée le 2026-08-24** avec les six décisions A–F du
> wireframe (§ 08, tranchées sur visuel) : Batch armé par une **icône de sélection dans la
> barre** (§ 11 option 4), **filtre** en pop-up cochable, **popover Destination**, **états**,
> **volume replié**, **recherche en tête** de la file, **genres** en texte + tag et badge
> **« Prêt CDJ »**. Wireframe aux tokens réels
> (https://claude.ai/code/artifact/cec49229-4c84-4e6b-bfac-0843488ecb35), kit Big Sur lu sur
> les **PDF vectoriels** (`docs/design-refs/*.pdf`). Implémentation à faire (issue
> [#47](https://github.com/c0remusic/sift/issues/47)), en **série stricte** par lane de
> fichiers.

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

Titre « Revue » + compte de la file, à gauche. Au bord droit, avant les contrôles de
fenêtre : **icône de sélection** (Batch, § 11 option 4) — icône seule + infobulle, patron
*toolbar* Photos macOS. Elle arme le mode Batch (Zone C — mode Batch) ; active, elle prend
la teinte d'accent et le compte devient « N sélectionnées ». Contrôles de fenêtre à droite
(convention hôte Windows).

**La recherche NE monte PAS dans la barre** — décision du 2026-08-21 : elle reste dans la
colonne file (Zone B′), désormais en **tête** de colonne (décision E, 2026-08-24). Le
segmenté **Détail / Lot est retiré** (« plus besoin du picker Lot ») : le mode Batch est
armé par l'icône de la barre, pas par un onglet. Écart assumé à `DESIGN.md` § 15, noté
là-bas.

### Zone B′ — file

**En tête de la colonne** (patron HIG d'une liste : Notes, Mail compact, Music) : le
**champ de recherche** — loupe (SVG monochrome, jamais un emoji) + placeholder
« Rechercher » + bouton clear `×` quand du texte + anneau d'accent au focus (patron *search
field* du kit, § 03-02). Passée **en tête** le 2026-08-24 (décision E) ; elle était en pied.
Sous elle : **« File » + compte** et un **bouton de filtre** en pop-up cochable (ci-dessous).
Puis la liste virtualisée. Il n'y a **plus** de segmenté Détail / Lot (retiré ; le mode
Batch s'arme par l'icône de la barre, Zone A).

Une ligne de file porte, dans cet ordre : **pastille de verdict** (`DESIGN.md` § 16,
même rendu qu'en Bibliothèque) · nom de fichier · artiste — titre · **pastille
`DUPLICATE`** au bord droit si la piste est un doublon (rendu hors colonne verdict, cf.
§ 16). **La durée est retirée de la file** (2026-08-21) : inutile ici, et elle mangeait la
place du signal doublon. Hauteur `--row-h`. **Quand le mode Batch est armé** (Zone A), une
**case à cocher** apparaît en tête de chaque ligne ; on coche track par track.

**Filtre — pop-up à options cochables** (décision du 2026-08-24). Un bouton en tête de file
(« Faux », « Faux + Doublons »…) ouvre un menu à **cases à cocher** : `Lossless`, `MP3`,
`Faux`, `Doublons`, chacun avec son compte, un séparateur, puis « Tout afficher ». Plusieurs
critères cochés = **union** (Faux *ou* Doublons). « Tout afficher » remet à zéro. Le bouton
résume la combinaison ; la recherche (en tête) reste **par-dessus** le filtre. Le filtre
isole une catégorie pour la cocher vite en mode Batch.

Au pied de la colonne : bascule « + N traités » quand la file en contient. Poignée de
redimensionnement à droite, révélée au survol.

### Zone C — surface de travail, mode Détail

**Direction « verdict promu », retenue puis affinée le 2026-08-21** (audit Revue, skill
`sift-macos-ui`). Elle répond au défaut mesuré : la surface était à moitié vide et le
verdict — le signal central — n'était qu'un badge sur un accordéon replié. Elle honore le
patron **Mail** (volet de lecture plein) sans toucher à la grammaire colonne-unique de la
file.

**Largeur de lecture — le plein écran.** Chaque bloc (path bar, en-tête, lecteur,
Métadonnées, rail) est borné à une **largeur de lecture unique (~720 px)**, sur un **seul
bord de conduite** gauche partagé avec la file. Seul le **spectrogramme** s'étend jusqu'à
`--measure-data` (1200 px), sur ce même bord. C'est le correctif du plein écran :
aujourd'hui seule `.sift-player-row` est bornée ; `.sift-fil-editor` (Métadonnées) et
`#filfoot` (rail) n'ont pas de `max-width`, d'où l'étalement en fenêtre large.

Ordre vertical, et il est le parcours de décision :

1. **Path bar** — le chemin d'origine en **fil d'Ariane de tête**, pleine largeur, en
   **segments** (`Dossier › Dossier › fichier`), en **police système** (Outfit), **pas en
   monospace**. Patron *path control* (HIG « Path controls » / `NSPathControl`, la barre
   de chemin du Finder) : segments, troncature **par le milieu** si trop long (garder le
   premier et le dernier). Le mono est un réflexe Terminal, écarté ici.
2. **En-tête piste** — **pochette à taille fixe** (~56 px, alignée en haut, **jamais
   étirée** à la hauteur du texte : `sizeCoverToBody` est abandonné) + titre + artiste +
   **format** (petite ligne : `FLAC · 44,1 kHz`). Le **verdict** est une **pastille
   discrète en haut à droite**, au niveau du titre : **point coloré + mot** (`LOSSLESS`,
   `FAKE`, `À VÉRIFIER`, `—`), **sans capsule**, ~10 px / 500. La couleur (teinte de la
   table, `.sift-lib-v-*`) double le libellé (§ 16, daltonisme). **Dit une seule fois**,
   ici — jamais répété plus bas. Discret par choix : Apple Music tient « Lossless » en
   indicateur neutre parce qu'il n'a qu'un état ; Sift garde la couleur (verdict
   catégoriel : lossless / faux / douteux) mais lâche le poids (fond, majuscules 600).
3. **Lecture** — bouton play **triangle nu** (sans cercle, patron Voice Memos / Musique) ·
   **waveform-overview** fine + pouce rond blanc (bord + ombre) : l'onde tient lieu de
   piste de navigation, exactement le *scrubber* de Voice Memos ; l'inspection fine du
   signal reste au spectrogramme, pas ici · **un seul temps affiché, cliquable** (bascule
   écoulé ↔ restant, patron Musique / Podcasts — jamais les deux à la fois) · volume
   **replié en icône au repos, déplié au survol** (décision D, 2026-08-24) : au repos une
   **icône haut-parleur** seule (cône simple du kit, § 04-07) ; au survol la **pilule volume
   macOS** se déplie — piste fine + pastille ronde blanche, fill accent, icône intégrée à
   gauche. La waveform ne s'anime pas au chargement. Tempo / key-lock **retirés** : le
   pitch DJ n'est pas voulu sur un écran de décision.
4. **Métadonnées** — **toujours visible**, en **liste d'attributs éditables en place**
   (*text field inline* : texte au repos, champ + anneau d'accent au focus ; patron
   inspecteur Finder « Lire les informations »). Artiste / Titre / Version éditables ;
   Label en lecture seule ; **genres en texte + icône tag** (glyphe *tag* du kit, § 01
   Icons — « Electronic, Synth-pop », **pas de chips** ; décision F, 2026-08-24). L'en-tête
   de section porte, à droite du titre « Métadonnées » : le badge **« Prêt CDJ »** (coche +
   mot ; passe en **warning + raison** si la piste n'est pas prête, jamais masqué) puis le
   bouton **« Identifier »** — « Identifier » lance la recherche Discogs et remplit ces
   mêmes champs, **sans changer de mode** (plus de formulaire à entrer). **La ligne
   « Tags ID3 » est supprimée** (tautologique : « Tags ID3 : ID3 »). Critère CDJ défini
   (`docs/cdj-metadata-formats.md`, WAV exclu) mais code à recâbler
   ([#46](https://github.com/c0remusic/sift/issues/46)).
5. **Diagnostic audio** — **placé sous les Métadonnées** (on identifie plus souvent qu'on
   n'inspecte ; les détails techniques vont en bas du volet). Repliable, **fermé par
   défaut**, en-tête **nu** : « ▸ Diagnostic audio », **sans sous-texte** (un disclosure
   macOS = chevron + titre, rien d'autre). Ouvert : le **spectrogramme domine** (pleine
   largeur de lecture, la preuve du verdict) ; sous lui, **deux pastilles compactes**
   (format · lecture du spectro, ex. `FLAC` · `Pleine bande · 22 kHz`) ; puis **« Détails »**
   qui replie **toutes** les mesures chiffrées (coupure, densité de l'aigu, durée,
   true-peak, phase, écrêtage, canaux, silence…). Le verdict n'est **pas** répété ici, ni
   le format déjà en en-tête. Fermé au repos parce que la grille se recalcule à l'ouverture
   (~631 ms mesurées) et n'est plus stockée : le pas de piste en piste (↑↓) reste
   instantané.

### Zone C, pied — rail d'action

Barre persistante, **à plat** (pas de carte, `.sift-action-rail--flat`), jamais dans le
flux de défilement.

Rangée du haut, réglages : **Destination** (bouton ouvrant l'arbre en **popover** — carte
arrondie + **bec** pointant vers le bouton, patron *popover* du kit § 06-03, avec ombre ;
détail ci-dessous) · **Format** (contrôle segmenté : MP3 320 · AIFF 16/44 · WAV 16/44,
options lossless désactivées sur source lossy) · **Nom final** (aperçu, rendu par
`previewFilename`, **jamais** réimplémenté en TS).

**Popover Destination** (décision B, 2026-08-24). Une carte + bec (kit § 06-03). En haut,
l'**arbre** des dossiers de la bibliothèque (chevron + icône dossier + nom, indentés) ; le
dossier courant est **surligné**. Sous un groupe **« Autres »**, les **dossiers custom**
déjà choisis hors bibliothèque (ex. `Sets 2026 · D:\Promo`). Un séparateur, puis **« Ranger
sur place (ne pas déplacer) »** (case). En pied : **« + Nouveau dossier »** — ouvre
l'**explorateur natif** pour choisir où le créer — et **« Choisir un dossier… »** —
sélecteur natif pour un dossier custom existant. Dans les deux cas, **le dossier choisi
entre dans la liste** (groupe « Autres »), disponible ensuite sans re-parcourir l'arbre.

Rangée du bas : **légende clavier** à gauche · **actions groupées au bord droit
(trailing)** : **Écarter** (secondaire — **gris rempli**, *pas* un ghost à bordure : le kit
ne connaît pas le ghost, le *secondary push button* est un fond gris ; ou **Re-source** si
le verdict est `fake`) puis **Convertir** (primaire, **aplat d'accent bleu + texte blanc**,
la plus à droite, action `Entrée`). Le contraste primaire / secondaire porte seul la
distinction entre les deux issues, comme macOS.

### Zone C — mode Batch

Armé par l'**icône de sélection** de la barre (Zone A ; § 11 option 4, patron
« Sélectionner » iOS / Photos), **pas** par une bascule de vue. Off → file normale, pas de
cases. On → une **case** apparaît par ligne dans la file (Zone B′) et on **coche track par
track** ; il n'y a **pas** de seconde table. La file et le rail restent en place.

La zone C devient le **résumé de la sélection** : compte (« N sélectionnées »), répartition
par verdict (« 2 FAKE »), totaux format / durée (« 1 MP3 320 · 1 FLAC · 6:24 »), puis les
actions **« Écarter la sélection »** (secondaire) et **« Ranger la sélection »** (primaire,
dominante). Le **clic droit** sur la sélection porte les mêmes actions (Ranger · Écarter ·
Changer la destination). Combiné au **filtre** (Zone B′), il isole une catégorie pour la
cocher vite (« Faux » + tout cocher = agir sur une catégorie).

Le rangement d'un lot affiche la **progression** en **sheet** attachée à la fenêtre (carte
blanche arrondie glissant du haut, ombre douce, patron *sheet* du kit § 06-01) ; le
**rapport** final donne rangés / à valider / échecs avec accès au détail des échecs.

**Confirmation au-delà du seuil** : patron **alerte** du kit (§ 06-02) — carte + titre +
message + boutons **secondaire gris / primaire bleu** + case **« ne plus demander »**.
Le « ne plus demander » est la réponse retenue à la question du seuil (plutôt que deux
réglages) : la confirmation reste, elle vise un clic non humain, et l'utilisateur régulier
la coupe lui-même. In-app, **jamais** `window.confirm()`.

## États

| État | Rendu |
|---|---|
| **File vide** | `emptyStateHtml` dans la zone C — « Tout est trié », compte de ce qui a été traité, action vers Bibliothèque |
| **Aucune piste ouverte** | Zone C en indice sobre, jamais un canevas nu |
| **Analyse en cours** | Ligne de file avec indicateur ; la zone C montre ce qui est déjà connu (tags, nom) et un **squelette** pour ce qui manque (patron HIG *Loading* : placeholder animé, jamais un spinner nu sur canevas vide) |
| **Analyse échouée** | La ligne se voit **mieux** que les autres, pas moins bien. Jamais d'atténuation à l'opacité. Bouton Réanalyser dans la ligne |
| **Rangement en cours** | Bouton Convertir en attente, rail verrouillé, file non bloquée |
| **Rangé** | Bandeau **au-dessus du rail**, avec le chemin final et « Annuler ». **Neutre** en permanence ; au rangement il **flashe vert brièvement** puis retombe neutre (`DESIGN.md` § 8 : un état permanent ne se colore pas) |
| **Lot, confirmation** | Alerte in-app **armée et horodatée** + « ne plus demander ». Jamais `window.confirm()` |
| **Lot, progression** | Sheet attachée, barre déterminée, étape en texte, Annuler toujours présent |
| **Destination non réglée** | Porte de premier réglage dans le popover Destination. L'échec de lecture de l'arbre se dit **avant** la porte |

## Interactions

### Souris

- **Clic** ligne de file : ouvre la piste dans la zone C.
- **Clic** sur l'**icône de sélection** (barre) : arme / désarme le mode Batch (cases par
  ligne). **Clic** sur le **bouton de filtre** (tête de file) : ouvre le menu cochable.
- **Clic droit** ligne : Ouvrir l'emplacement · Réanalyser · Écarter · Changer la
  destination. En mode Batch, agit sur la sélection.
- **Clic** sur la waveform : déplace la lecture. Survol : indicateur de position.
- **Clic** sur le temps : **bascule écoulé / restant** (une seule valeur affichée).
- **Glisser** la poignée : largeur de la file, persistée.
- **Glisser** des fichiers depuis l'OS sur la file : import. Sur le rail d'action :
  nouvelle destination.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9, plus la couche 3 propre à cet écran :

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `Entrée` | Convertir (ranger) |
| `⌫` ou `X` | Écarter, ou Re-source si le verdict est `fake` |
| `I` | Identifier |
| `↑` `↓` | Piste précédente / suivante dans la file |

Règles de focus, non négociables : aucun raccourci ne se déclenche dans un `INPUT` ou
un `TEXTAREA` ; un raccourci à une lettre retire le focus du bouton actif avant d'agir
(sinon `Espace` active le bouton focalisé **et** la lecture) ; en mode Batch, les lignes
de sélection possèdent `Espace` et `Entrée` exclusivement.

### Retour

Le pouce du contrôle segmenté glisse en `--duration-slow`. Le passage d'une piste à
l'autre ne rejoue aucune animation d'entrée : c'est un changement de contenu, pas une
transition d'écran. La forme d'onde ne s'anime pas au chargement.

## Composants — calés sur le kit Big Sur (PDF)

Relevés sur `docs/design-refs/macOS Big Sur UI Kit (Community).pdf` (vectoriel) ; les
valeurs chiffrées restent des tokens `styles.css`, jamais extraites au pixel.

- **Convertir** = *push button* primaire : aplat d'accent (`--color-accent-fill`) + texte
  blanc (`--color-accent-ink`).
- **Écarter** = *push button* **secondaire = gris rempli** (fond `--overlay-selected`, texte
  encre). Le kit **ne connaît pas** le ghost à bordure — à ne pas réintroduire.
- **Recherche** = *search field* : loupe + placeholder + clear `×` + anneau d'accent au
  focus. **En tête** de la colonne file (décision E).
- **Segmented** (**Format** seul ; le Détail/Lot est **retiré**) = pill blanc **surélevé**
  (ombre) dans un conteneur gris.
- **Icône de sélection** (Batch, barre unifiée) = icône seule + infobulle ; teinte d'accent
  quand armée. Arme les cases par ligne (patron « Sélectionner » Photos, § 11 option 4).
- **Filtre** = *pop-up button* + menu à **cases à cocher** (union multi-critères, compte par
  option, « Tout afficher » remet à zéro).
- **Genres** = **texte + icône tag** (glyphe *tag* du kit, § 01 Icons) ; pas de chips.
- **Champs Métadonnées** = *text field inline* : texte au repos, champ + anneau au focus.
- **Slider** (volume, waveform-overview) = piste fine + **pastille ronde blanche** (bord +
  ombre) ; portion active en accent. Le **volume** est **replié en icône au repos, déplié
  au survol** (décision D) : cône haut-parleur seul au repos, pilule complète au survol.
- **Badge « Prêt CDJ »** = *label* d'état (coche + mot) dans l'en-tête Métadonnées ; variante
  **warning + raison** quand la piste n'est pas prête.
- **Popover** (Destination) = carte arrondie + **bec** vers l'ancre + ombre ; arbre +
  groupe « Autres » (dossiers custom) + « Nouveau dossier » / « Choisir un dossier… » →
  explorateur natif, le dossier choisi **entre dans la liste**.
- **Alerte** (Lot) = carte + titre + message + boutons secondaire/primaire + « ne plus
  demander ».
- **Rail (sidebar)** = item actif **gris arrondi**, **jamais bleu** (le kit montre le bleu ;
  `DESIGN.md` § 14 l'écarte, le bleu est déjà pris — on tient le gris).
- **Typographie** = 3 tailles effectives (`--text-lg` 15 / `--text-base` 13 / `--text-sm`
  11), hiérarchie par l'**encre**, **monospace réservé** aux chiffres alignés en colonne
  (durées, mesures) + `tabular-nums`. Échelle SF Pro du styleguide confirmée
  (26/22/17/15/13/11/10 pt).

## Hors périmètre / questions ouvertes

- **Analyse froide et réactivité.** `analyze_path` est une commande Tauri **synchrone**
  qui appelle `analyse()` en ligne sur cache miss : toute l'IPC est bloquée pendant.
  Le dépôt a l'outil pour chiffrer la durée (`bench_sqlite.rs` via
  `SIFT_BENCH_TRACKS_DIR`, `--ignored`) et ce chiffre n'existe pas. **Décision
  d'architecture, pas de design.**
- **Critère du badge CDJ — établi, code à recâbler.** Le WAV est le vrai cas d'échec
  (tags non affichés fiablement). `tags_cdj_ok` (`analysis/tags.rs`) reste à recâbler sur
  le format réel via `lofty` ([#46](https://github.com/c0remusic/sift/issues/46)).
  Question restante : intégrer la contrainte codec / génération (FLAC/ALAC ≥ 2016) au
  badge, ou la laisser hors champ.
- **Patron inspecteur des Métadonnées** — repris de Finder « Lire les informations » ; le
  *text field inline* du kit (§ 03-03) le confirme comme composant. La disposition exacte
  (ordre des champs, densité) se cale à l'implémentation.
