# Spec — Revue

> **Réconciliée le 2026-08-21**, **complétée le 2026-08-24** avec les six décisions A–F du
> wireframe (§ 08, tranchées sur visuel) : Batch armé par une **icône de sélection dans la
> barre** (§ 11 option 4), **filtre** en pop-up cochable, **popover Destination**, **états**,
> ~~**volume replié**~~, **recherche en tête** de la file, **genres** en texte + tag et
> ~~badge **« Prêt CDJ »**~~ (les deux barrées ont été retranchées le 2026-08-25, ci-dessous).
> Wireframe aux tokens réels
> (https://claude.ai/code/artifact/cec49229-4c84-4e6b-bfac-0843488ecb35), kit Big Sur lu sur
> les **PDF vectoriels** (`docs/design-refs/*.pdf`). Implémentation à faire (issue
> [#47](https://github.com/c0remusic/sift/issues/47)), en **série stricte** par lane de
> fichiers.

> **Révisée le 2026-08-25.** Quatre points du wireframe ont été retranchés depuis — bec du
> popover, « + Nouveau dossier », badge « Prêt CDJ », taille de la pochette : voir la section
> suivante. S'y ajoutent quatre décisions qui vivent dans leur section respective : largeur de
> lecture **dynamique** (Zone C), bouton de lecture en **triangle nu** (Zone C, 3), **volume**
> (Composants) et **rayons re-racinés sur le kit** (Composants). Sur tout le reste, le
> wireframe fait foi.

> L'écran de décision. Le seul en profil **Poste de décision** (`DESIGN.md` § 14).

## Décisions postérieures au wireframe — tranchées le 2026-08-25

Quatre points où une décision prise **après** le wireframe diverge du dessin. Les quatre
gardent la décision postérieure, **pas** le wireframe — tranchés par Antoine.

| Point | Wireframe | Retenu le 2026-08-25 |
|---|---|---|
| **Bec du popover Destination** | carte + **bec** vers l'ancre (§ 12) | **Sans bec** : un bouton « ▾ » ouvre un *pulldown* macOS ancré à un point, structuré en sections « Bibliothèque » / « Autres ». Le bec appartient au `NSPopover` détaché |
| **« + Nouveau dossier »** | crée un sous-dossier in-library, **inline** (§ 12) | **Sélecteur natif** : les deux boutons du pied versent dans « Autres » ; la commande IPC `create_bin` est retirée |
| **Badge « Prêt CDJ »** | **retenu**, dans l'en-tête Métadonnées (§ 16) | **Retiré** : le helper `paintCdjBadge` est supprimé du code |
| **Taille de la pochette** | **taille fixe**, jamais étirée (*fix 6*) | **Mesure JS conservée** : la pochette carrée prend la hauteur du bloc texte de l'en-tête (`sizeCoverToBody`) |

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
résume la combinaison. La recherche (en tête) **gare** le filtre : elle interroge la file
source **entière**, pas le sous-ensemble filtré (patron Finder — saisir passe en mode
résultats — ce qui tue le piège « 0 résultat = bug »). Le filtre isole une catégorie pour la
cocher vite en mode Batch.

Au pied de la colonne : bascule « + N traités » quand la file en contient. Poignée de
redimensionnement à droite, révélée au survol.

### Zone C — surface de travail, mode Détail

**Direction « verdict promu », retenue puis affinée le 2026-08-21** (audit Revue, skill
`sift-macos-ui`). Elle répond au défaut mesuré : la surface était à moitié vide et le
verdict — le signal central — n'était qu'un badge sur un accordéon replié. Elle honore le
patron **Mail** (volet de lecture plein) sans toucher à la grammaire colonne-unique de la
file.

**Largeur de lecture — dynamique, tranché le 2026-08-25.** Les blocs de la zone C (path bar,
en-tête, lecteur, Métadonnées, rail) **suivent la largeur de la fenêtre**, comme tout le reste
du contenu : **pas de plafond de lecture fixe**. Une version antérieure de cette spec les
bornait à une « largeur de lecture unique (~720 px) » — c'était une proposition, jamais
livrée, et elle est abandonnée. Ils gardent en revanche le **même bord de conduite gauche**,
partagé avec la file.

Seul le **spectrogramme** garde une borne, et elle est **technique, pas confortable** :
`--measure-data` (1200 px), **dupliquée côté Rust** dans `analysis::spectrum::MAX_COLS` (cf.
§ Contexte dans le shell). Au-delà, la donnée serait étirée — donc fausse, dans l'app qui
détecte du faux.

Ordre vertical, et il est le parcours de décision :

1. **Path bar** — le chemin d'origine en **fil d'Ariane de tête**, pleine largeur, en
   **segments** (`Dossier › Dossier › fichier`), en **police système** (Outfit), **pas en
   monospace**. Patron *path control* (HIG « Path controls » / `NSPathControl`, la barre
   de chemin du Finder) : segments, troncature **par le milieu** si trop long (garder le
   premier et le dernier). Le mono est un réflexe Terminal, écarté ici.
2. **En-tête piste** — **pochette carrée, à la hauteur du bloc texte** + titre + artiste +
   **format** (petite ligne : `FLAC · 44,1 kHz`). Cette hauteur se **mesure en JS**
   (`sizeCoverToBody` + un `ResizeObserver`) : le pur CSS (`aspect-ratio:1` +
   `align-self:stretch`) rend une largeur **nulle** dans ce contexte flex, mesuré au CDP, et
   une mesure ponctuelle raterait le reflow tardif (chargement d'Outfit, pose du verdict).
   **Conservée le 2026-08-25** contre le *fix 6* du wireframe, qui voulait une taille fixe —
   décision d'Antoine. Le **verdict** est une **pastille
   discrète en haut à droite**, au niveau du titre : **point coloré + mot** (`LOSSLESS`,
   `FAKE`, `À VÉRIFIER`, `—`), **sans capsule**, ~10 px / 500. La couleur (teinte de la
   table, `.sift-lib-v-*`) double le libellé (§ 16, daltonisme). **Dit une seule fois**,
   ici — jamais répété plus bas. Discret par choix : Apple Music tient « Lossless » en
   indicateur neutre parce qu'il n'a qu'un état ; Sift garde la couleur (verdict
   catégoriel : lossless / faux / douteux) mais lâche le poids (fond, majuscules 600).
3. **Lecture** — bouton play **triangle nu** : sans cercle **ni pastille** derrière lui
   (patron Voice Memos / Musique ; reconfirmé le 2026-08-25) ·
   **waveform-overview** fine + pouce rond blanc (bord + ombre) : l'onde tient lieu de
   piste de navigation, exactement le *scrubber* de Voice Memos ; l'inspection fine du
   signal reste au spectrogramme, pas ici · **un seul temps affiché, cliquable** (bascule
   écoulé ↔ restant, patron Musique / Podcasts — jamais les deux à la fois) · **volume =
   capsule du kit, toujours visible** : pilule pleine hauteur, haut-parleur intégré à gauche
   (clic = couper), gros pouce rond, remplissage à gauche du pouce. Le repli-au-survol de la
   décision D (2026-08-24) est **abandonné le 2026-08-25** ; teintes, survol et pressé :
   § Composants — Volume. La waveform ne s'anime pas au chargement. Tempo / key-lock
   **retirés** : le pitch DJ n'est pas voulu sur un écran de décision.
4. **Métadonnées** — **toujours visible**, en **liste d'attributs éditables en place**
   (*text field inline* : texte au repos, champ + anneau d'accent au focus ; patron
   inspecteur Finder « Lire les informations »). Artiste / Titre / Version éditables ;
   Label en lecture seule ; **genres en texte + icône tag** (glyphe *tag* du kit, § 01
   Icons — « Electronic, Synth-pop », **pas de chips** ; décision F, 2026-08-24). L'en-tête
   de section porte, à droite du titre « Métadonnées », le **seul** bouton
   **« Identifier »** : le badge **« Prêt CDJ »** qui l'y précédait a été **retiré le
   2026-08-25** (demande d'Antoine ; le helper `paintCdjBadge` est supprimé du code).
   « Identifier » lance la recherche Discogs et remplit ces
   mêmes champs, **sans changer de mode** (plus de formulaire à entrer). Quand **plusieurs
   éditions** matchent, elles s'affichent en **liste ouverte inline** (patron Spotlight « Top
   Hit ») : le meilleur match est **pré-appliqué**, les alternatives se permutent d'un clic
   (navigables ↑↓), sans popover ni changement de mode. Le clic sur un match **écrit l'ID3
   immédiatement** (décision datée 2026-08-21, « Entrée = graver »), avec un filet
   **« Rétablir »** inline (+ `Échap`) pour défaire. **La ligne
   « Tags ID3 » est supprimée** (tautologique : « Tags ID3 : ID3 »). Le critère CDJ reste
   défini (`docs/cdj-metadata-formats.md`, WAV exclu) et son recâblage reste ouvert
   ([#46](https://github.com/c0remusic/sift/issues/46)) — il n'a simplement **plus de porteur
   visuel** sur cet écran depuis le retrait du badge.
5. **Diagnostic audio** — **placé sous les Métadonnées** (on identifie plus souvent qu'on
   n'inspecte ; les détails techniques vont en bas du volet). Repliable, **fermé par
   défaut**, en-tête **nu** : « ▸ Diagnostic audio », **sans sous-texte** (un disclosure
   macOS = chevron + titre, rien d'autre). Ouvert : le **spectrogramme domine** (toute la
   largeur disponible jusqu'à sa borne `--measure-data`, la preuve du verdict) ; sous lui,
   **deux pastilles compactes**
   (format · lecture du spectro, ex. `FLAC` · `Pleine bande · 22 kHz`) ; puis **« Détails »**
   qui replie **toutes** les mesures chiffrées (coupure, densité de l'aigu, durée,
   true-peak, phase, écrêtage, canaux, silence…). Le verdict n'est **pas** répété ici, ni
   le format déjà en en-tête. Fermé au repos parce que la grille se recalcule à l'ouverture
   (~631 ms mesurées) et n'est plus stockée : le pas de piste en piste (↑↓) reste
   instantané.

### Zone C, pied — rail d'action

Barre persistante, **à plat** (pas de carte, `.sift-action-rail--flat`), jamais dans le
flux de défilement.

Rangée du haut, réglages : **Destination** (bouton ouvrant l'arbre en **pulldown** — carte
arrondie alignée au bouton, **sans bec**, patron *menu/pulldown* du kit § 05, avec ombre ;
détail ci-dessous) · **Format** (contrôle segmenté : MP3 320 · AIFF 16/44 · WAV 16/44,
options lossless désactivées sur source lossy) · **Nom final** (aperçu, rendu par
`previewFilename`, **jamais** réimplémenté en TS).

**Popover Destination** (décision B, 2026-08-24 ; **bec retiré le 2026-08-25** — un bouton « ▾ »
ouvre un *pulldown* macOS, ancré à un point et **sans bec** ; le bec appartient au NSPopover
détaché, kit § 06-03, cf. `patterns-macos.md` § 8). Une carte alignée, structurée en **sections
façon sidebar Finder** : un en-tête **« Bibliothèque »** coiffe l'arbre, **« Autres »** coiffe les
dossiers externes (style relevé du composant kit `Sidebars/Sidebar-section` via le pont Figma :
10px / poids 600 / tracking 0.12 / casse normale, encre mappée sur token gris). En haut,
l'**arbre** des dossiers de la bibliothèque (chevron + icône dossier + nom, indentés) ; le
dossier courant est **surligné**. Sous le groupe **« Autres »**, les **dossiers custom**
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

Le rangement d'un lot affiche la **progression** en **sheet non-modale** attachée à la fenêtre
(carte glissant du haut, ombre douce, kit § 06-01), **forme mince** (feuille de copie Finder :
barre déterminée + ligne d'étape + disclosure « Afficher les détails ») ; bouton **« Arrêter »**
(la piste en cours finit, rien n'est annulé). À la fin, **la sheet se transforme en rapport** :
chiffres, puis Rangés / À valider / Échecs dépliables, chaque item « Ouvrir en Détail »
(`batchopen`). Le « pourquoi » par ligne d'échec suppose d'enrichir `BatchResult` côté Rust.

**Confirmation au-delà du seuil** : **alerte modale** du kit (§ 06-02) — carte + titre +
**corps récap structuré** (N prêts → Convertir · M FAKE → Écarter · exclus ignorés ·
destination · format) + boutons **secondaire gris / primaire bleu** + case **« ne plus me
demander »**. Elle **remplace l'armement in-rail** (non ancré Apple). Le « ne plus demander »
vaut pour **la session**, pas un réglage permanent : la confirmation vise un clic non humain,
et le plancher horodaté de 250 ms reste le garde. In-app, **jamais** `window.confirm()`.

## États

| État | Rendu |
|---|---|
| **File vide** | `emptyStateHtml` en zone C, **deux cas** (`state.filedThisSession`) : rangé quelque chose cette session (>0) → « Tout est trié » + compte + **Bibliothèque** ; rien rangé (=0) → « Rien à revoir » + **Accueil** (fix #15 — Revue vide n'est jamais un cul-de-sac) |
| **Aucune piste ouverte** | Zone C en indice sobre, jamais un canevas nu |
| **Analyse en cours** | Ligne de file avec indicateur ; la zone C montre ce qui est déjà connu (tags, nom) et un **squelette statique** pour ce qui manque (placeholder **sans animation** — `DESIGN.md` § 6 « la donnée ne s'anime jamais », précédence `.jrnl-skel` ; jamais un spinner nu) |
| **Analyse échouée** | La ligne se voit **mieux** que les autres, pas moins bien (teinte **danger** rouge, distincte de l'ambre « à vérifier »). Jamais d'atténuation à l'opacité. Bouton Réanalyser dans la ligne |
| **Rangement en cours** | Bouton Convertir en attente, rail verrouillé, file non bloquée |
| **Rangé** | Bandeau **au-dessus du rail**, avec le chemin final et « Annuler ». **Neutre** en permanence ; au rangement il **flashe vert brièvement** puis retombe neutre (`DESIGN.md` § 8 : un état permanent ne se colore pas) |
| **Lot, confirmation** | **Alerte modale** (kit § 06-02), corps **récap structuré** (N prêts → Convertir · M FAKE → Écarter · exclus ignorés · destination · format) + case « Ne plus me demander (**cette session**) ». Remplace l'armement in-rail. Plancher 250 ms horodaté = garde anti-clic. Jamais `window.confirm()` |
| **Lot, progression** | Sheet **non-modale** attachée (forme mince, feuille de copie Finder) : barre déterminée + ligne d'étape + disclosure « Afficher les détails » ; bouton **« Arrêter »** (la piste en cours finit). Puis la sheet **devient le rapport** (chiffres + Rangés / À valider / Échecs dépliables, « Ouvrir en Détail ») |
| **Destination non réglée** | Porte de premier réglage dans le popover Destination. L'échec de lecture de l'arbre se dit **avant** la porte |

## Interactions

### Souris

- **Clic** ligne de file : ouvre la piste dans la zone C.
- **Clic** sur l'**icône de sélection** (barre) : arme / désarme le mode Batch (cases par
  ligne). **Clic** sur le **bouton de filtre** (tête de file) : ouvre le menu cochable.
- **Clic droit** ligne : Ouvrir l'emplacement · Réanalyser · Écarter · Changer la
  destination. En mode Batch, agit sur la sélection.
- **Clic** sur la waveform : déplace la lecture. **Survol** : ghost fill jusqu'au curseur + ligne fine + bulle mm:ss (teinte **transitoire**, distincte du fill de lecture) — patron QuickTime + réticule spectro.
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
de sélection possèdent `Espace` et `Entrée` exclusivement. `Échap` dans un champ
Métadonnées **annule l'édition** (revert à la valeur du focus-in) et `stopPropagation` — il
ne remonte pas fermer un popover ou la fenêtre.

### Retour

Le pouce du contrôle segmenté glisse en `--duration-slow`. Le passage d'une piste à
l'autre ne rejoue aucune animation d'entrée : c'est un changement de contenu, pas une
transition d'écran. La forme d'onde ne s'anime pas au chargement. En **fin de piste**, la
lecture s'arrête et le playhead revient à **0** — pas d'auto-avance vers la suivante (la
zone C ne se recompose pas sous l'utilisateur, patron Musique piste isolée).

## Composants — calés sur le kit Big Sur

Relevés sur `docs/design-refs/macOS Big Sur UI Kit (Community).pdf` (vectoriel) ; les
valeurs chiffrées restent des tokens `styles.css`, jamais extraites au pixel. Depuis le
**2026-08-25**, le kit est aussi relevé au **pont Figma REST** (fileKey
`k3ek2XpmIKjqiFUsyn5kCi`), **nœud par nœud** — c'est ce relevé qui a re-raciné l'échelle de
rayons (ci-dessous).

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
- **Slider** (waveform-overview) = piste fine + **pastille ronde** (bord + ombre) ; portion
  active en accent.
- **Volume** = **capsule macOS Big Sur toujours visible** (kit § 07-Slider Pickers, rangée 1) :
  pilule pleine hauteur, **haut-parleur intégré à gauche** (clic = couper), gros pouce rond,
  remplissage à gauche du pouce, pouce et remplissage **bornés à gauche** pour que l'icône
  reste posée sur le remplissage. Le repli-au-survol (ex-décision D) est **abandonné** —
  « le design n'est pas bon du tout » (Antoine 2026-08-25), on tient le composant du kit.

  **Inversion en thème clair, tranchée le 2026-08-25.** En **sombre**, le remplissage reste
  **clair sur piste sombre**, fidèle au kit. En **clair**, il passe **foncé sur piste claire**.
  La mesure qui a décidé : le contraste remplissage / piste vaut **1,45:1 en clair** contre
  **12,67:1 en sombre** — sous le **3:1** qu'exige WCAG 1.4.11 pour un composant d'interface.
  En clair, le remplissage du kit ne se voyait donc pas du tout ; ce n'est pas une préférence
  de teinte, c'est un seuil franchi. **Survol et pressé** sont ajoutés dans le même geste : le
  kit les donne, la première version ne portait que le repos.
- **Popover** (Destination) = carte arrondie **sans bec** + ombre, ancrée au bouton « ▾ »
  (*pulldown* du kit § 05 ; le bec appartient au `NSPopover` détaché, **retiré le
  2026-08-25**) ; sections façon sidebar Finder — en-tête « Bibliothèque » sur l'arbre,
  « Autres » sur les dossiers custom — puis « Nouveau dossier » / « Choisir un dossier… » →
  sélecteur natif, le dossier choisi **entre dans la liste**.
- **Alerte** (Lot) = carte + titre + message + boutons secondaire/primaire + « ne plus
  demander ».
- **Rail (sidebar)** = item actif **gris arrondi**, **jamais bleu** (le kit montre le bleu ;
  `DESIGN.md` § 14 l'écarte, le bleu est déjà pris — on tient le gris).
- **Rayons** = échelle **re-racinée sur le kit le 2026-08-25** (commit `b973ce3`,
  `DESIGN.md` § 3) : `--border-radius-xs` **4** (case à cocher) · `--border-radius-sm` **5**
  (item de menu, champ texte, segmenté) · `--border-radius-md` **7** (bouton, champ de
  recherche, pulldown, bouton icône) · `--border-radius-lg` **14** (grandes surfaces,
  inchangé, et seul cran qui ne vient pas du kit). L'ancienne dérivation par `calc()` donnait
  8 et 10 : les neuf composants livrés de Revue étaient **tous** décalés d'un cran vers le
  rond, pour cette seule raison. Toujours le token, **jamais un littéral**.
- **Typographie** = 3 tailles effectives (`--text-lg` 15 / `--text-base` 13 / `--text-sm`
  11), hiérarchie par l'**encre**, **monospace réservé** aux chiffres alignés en colonne
  (durées, mesures) + `tabular-nums`. Échelle SF Pro du styleguide confirmée
  (26/22/17/15/13/11/10 pt).

## Conflits code ↔ spec — à corriger à l'implémentation

Relevés par le brainstorm Phase 1 (2026-08-24), **chacun vérifié sur le code**. Le code
contredit une décision figée ; c'est le **code** qui bouge, pas la décision.

1. **Volume — capsule Big Sur, repli abandonné (résolu 2026-08-25)** — le repli-au-survol
   (ex-décision D) a été **retiré** : Antoine l'a rejeté (« le design n'est pas bon du tout »)
   au profit du **composant capsule du kit** (§ 07-Slider Pickers, rangée 1, relevé sur les PDF
   `docs/design-refs/`). `.sift-volume-block`, `.sift-volume-track` et la base partagée
   `.sift-slider-*` (seul autre consommateur, le slider tempo, déjà retiré) sont supprimés ;
   la capsule est désormais le **SVG du kit inliné tel quel** — `.sift-volume`, qui **est**
   le slider (`role="slider"`), le rendu ne pilotant que la largeur du remplissage et le `cx`
   du pouce. Coupure du son câblée (icône intégrée à gauche, clic → `setVolume(0)` ↔ dernier
   volume, glyphe barré à 0). Géométrie mesurée dans les deux thèmes avant livraison.
   ⚠️ `DESIGN.md` § 17 (« le débordement de `.sift-volume-track` n'est pas un défaut »)
   décrivait le mécanisme retiré : **marqué périmé sur place le 2026-08-25**, à ne pas
   invoquer pour restaurer le repli.
2. **Deux temps au lecteur** — `report-view.ts:898-908` affiche écoulé **et** restant (façon
   SoundCloud) ; la spec (Zone C, lecture) veut **un seul temps cliquable**. → un seul.
3. **Bandeau « Rangé » vert permanent** — `styles.css:2438`
   (`background:var(--color-background-success)`) ; `docs/design-system/components.md:193`
   interdit « un aplat vert permanent pour dire "c'est fait" » et `DESIGN.md` § 4 veut un état
   permanent neutre. → fond **neutre + flash** vert bref au rangement (`sift-identified-flash`,
   ne rejoue qu'au rangement, pas à la navigation). Le commentaire daté 2026-08-05 ne portait
   que sur l'**encre**, pas sur le fond.
4. **Rail verrouillé à l'opacité** — `filing-actions.ts:30` (`b.style.opacity = "0.55"`) ;
   `DESIGN.md:262` interdit l'atténuation par opacité (« aucune valeur d'opacité ne franchit
   4,5:1 avant ~0,92 »), le levier est le **token** (encre secondary / disabled). → token,
   pas opacité.
5. **⌘F rate la recherche de Revue** — `focusBarSearch` (`toolbar.ts:188`) cible la barre
   unifiée ; décision E a mis la recherche dans la **colonne file**. → ⌘F doit poser le focus
   dans la recherche de la colonne file en Revue (câblage à confirmer au moment du fix).

Tranché (Phase 1, fork) : « échec » passe de l'ambre au **danger** rouge (`queue-panel.ts:345`),
pour le séparer du doute « à vérifier » (qui garde l'ambre). `DESIGN.md:265` n'imposait que la
**visibilité** de l'échec (déjà acquise) ; la couleur, elle, était ouverte.

## Hors périmètre / questions ouvertes

- **Analyse froide et réactivité.** `analyze_path` est une commande Tauri **synchrone**
  qui appelle `analyse()` en ligne sur cache miss : toute l'IPC est bloquée pendant.
  Le dépôt a l'outil pour chiffrer la durée (`bench_sqlite.rs` via
  `SIFT_BENCH_TRACKS_DIR`, `--ignored`) et ce chiffre n'existe pas. **Décision
  d'architecture, pas de design.**
- **Critère CDJ — établi, badge retiré, code à recâbler.** Le badge **« Prêt CDJ » n'existe
  plus** sur cet écran (retiré le 2026-08-25, `paintCdjBadge` supprimé) : ce qui reste ouvert
  est **backend**, pas visuel. Le WAV est le vrai cas d'échec (tags non affichés fiablement),
  et `tags_cdj_ok` (`analysis/tags.rs`) reste à recâbler sur le format réel via `lofty`
  ([#46](https://github.com/c0remusic/sift/issues/46)). La question « intégrer la contrainte
  codec / génération (FLAC/ALAC ≥ 2016) » ne se rouvrira qu'avec un éventuel nouveau porteur
  visuel.
- **Patron inspecteur des Métadonnées** — repris de Finder « Lire les informations » ; le
  *text field inline* du kit (§ 03-03) le confirme comme composant. La disposition exacte
  (ordre des champs, densité) se cale à l'implémentation.
