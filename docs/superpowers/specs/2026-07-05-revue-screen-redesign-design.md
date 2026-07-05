# Refonte écran Revue — zones repliables, verdict en conclusion, métadonnées génériques

> Formalise les décisions actées en session sur un prototype HTML/CSS/JS autonome
> (`sift-revue-refonte.html`, hors repo, jetable — comme `Sift.dc.html`/`app.js`, pas un
> livrable à resynchroniser). Ce document est la seule source de vérité pour le portage ;
> le fichier HTML ne doit plus être consulté après ce document écrit.

## Contexte

L'écran Revue actuel (`report-view.ts` + `filing.ts`) manque de hiérarchie : le lecteur, les
preuves techniques, la carte Identification et le verdict s'enchaînent sans distinction visuelle
forte, et l'action Discogs n'est pas assez visible. Le prototype a exploré une réorganisation en
zones, itérée sur ~10 tours d'allers-retours. Ce spec fige le résultat.

## Ce qui NE change PAS (périmètre)

- **Position du rail** : reste dans `#filfoot` (colonne droite verticale, `.dest`), PAS une barre
  horizontale sticky en bas comme dans le prototype — ce point n'a jamais été discuté comme un
  changement de layout d'écran, seulement le contenu de `#mid`. Le prototype montrait une barre
  horizontale par contrainte d'autonomie du fichier (pas de vraie colonne `.dest` à côté), pas par
  décision de redesign.
- **Contrat IPC / logique métier** : `doIdentify`, `doApplyTags`, `doRanger`, `reconcile`,
  `analyzePath`, tout le state management (`state.canonical`, `state.genres`...) — inchangés.
  Seule la structure DOM/CSS et l'agencement changent.
- **Format des chips de format, Destination popover, keyboardHintsHtml** — déjà conformes
  (glyphes réels `SPACE`/`ENTER`/`BKSP`/`HAUT-BAS`, voir `report-view.ts:163-170`), le prototype
  les avait mal recopiés (glyphes `⏎`/`⌫`) — pas une régression à porter.

## Décision ouverte à trancher AVANT implémentation

**Mode édition de l'Identification (pencil-toggle)** : le vrai `filing.ts::renderEditor` a
aujourd'hui un mode lecture-seule par défaut + bouton crayon qui bascule vers un formulaire
éditable (`identEditing`, `sift-ident-edit-btn`). Le prototype a supprimé cette distinction
(champs toujours éditables). Cette conversation n'a jamais tranché ce point — à décider avant
la tâche 3 du plan : **(a)** garder le pencil-toggle existant sous la nouvelle zone repliable
« Métadonnées », ou **(b)** l'aplatir en champs toujours visibles comme le prototype. Le plan
d'implémentation part sur **(a)** par défaut (changement minimal, préserve un comportement
existant non remis en cause) — à confirmer ou inverser en tâche 3.

## Composition cible de `#mid` (ordre, dans l'existant `.sift-fil-scroll`)

Aucun changement de la structure des 3 conteneurs (`.sift-fil-report` / `.sift-fil-editor` /
`.sift-fil-verdict`, `openFilingInto`, `filing.ts:1534-1546`) — le nouvel agencement vit
**à l'intérieur** de chacun :

1. **`.sift-fil-report`** (report-view.ts) :
   - En-tête morceau (cover/titre/artiste/chemin) — inchangé.
   - Zone **Écoute** (lecteur/waveform/volume/tempo/key-lock) — inchangée visuellement, fond
     `--color-background-secondary` (déjà le cas via `.sift-player-row` actuel à vérifier).
   - Zone **Diagnostic**, repliable, **repliée par défaut** : badge qualité (ex. "LOSSLESS" /
     "MP3 ≈ X kbps") dans l'EN-TÊTE du disclosure (visible replié, caché déplié — le détail en
     dessous suffit alors) ; corps = spectrogramme + tableau de mesures actuel
     (`spectroAndTagsHtml`). Remplace l'actuel `evidenceChipsHtml` + `.sift-spectro-box` toujours
     visibles.
   - **Le chip CDJ compatible/incompatible (`evidenceChipsHtml`, `report-view.ts:296`) est
     RETIRÉ d'ici** — voir Métadonnées ci-dessous (retour utilisateur explicite : la
     compatibilité CDJ est un fait de tags, pas un fait audio, elle doit vivre avec son critère
     et son fix).
2. **`.sift-fil-editor`** (filing.ts `renderEditor`) — renommé **Métadonnées** (plus
   "Identification · Discogs", générique pour un futur enrichissement multi-source non-Discogs) :
   - Zone repliable, **repliée par défaut**, même mécanique/style que Diagnostic (voir Style
     commun ci-dessous).
   - En-tête : badge **Compatibilité CDJ** (visible replié, caché déplié), calculé depuis
     `report.tags_cdj_ok` (déjà disponible, `AnalysisReport.tags_cdj_ok`, `tags.rs:73-76` — le
     critère réel est Artiste+Titre gravés dans le fichier, PAS les champs de ce formulaire qui
     restent un brouillon tant qu'ils ne sont pas écrits).
   - Corps : CTA Discogs (texte neutre par défaut, doré `--color-accent-identify` réservé au
     vrai état "rien identifié pour l'instant" — voir Style CTA), candidats, champs
     Artiste/Titre/Label/Année, Genres, ligne "Version ID3" (déjà là, `filing.ts:1088-1096`),
     **bouton "Appliquer les tags ID3" + bandeau d'avertissement explicite** ("Artiste et Titre
     pas encore gravés dans le fichier — un CDJ ne peut pas les lire tant que ce n'est pas fait")
     quand `!report.tags_cdj_ok` — ce bandeau + ce libellé explicite n'existent pas encore
     ailleurs, `.sift-tag-warn` actuel est plus générique ("Tags non écrits...") sans nommer
     Artiste/Titre.
   - `.sift-match-row` (CHECK MATCH) : **inchangé**, déjà conforme au principe "un badge existe
     pour signaler un doute, jamais pour confirmer l'évidence" (`filing.ts:1105-1108`) — rien à
     faire ici, le prototype avait un temps affiché un badge MATCH vert permanent par erreur,
     corrigé en cours de session, jamais à réintroduire.
3. **`.sift-fil-verdict`** (report-view.ts `verdictCardHtml`) : reste la CONCLUSION, en dernier —
   déjà le cas dans le vrai code (`openFilingInto` le rend après l'éditeur). Redevient un
   **bandeau plein coloré** (icône + label + sous-texte + nom final) — cohérent avec l'actuel,
   pas de changement structurel ici, juste vérifier que `verdictCardHtml` n'a pas dérivé vers
   une version "ligne discrète" (elle ne l'a jamais fait dans le vrai code, seul le prototype
   a exploré puis abandonné cette variante).

## Style commun aux deux zones repliables (Diagnostic, Métadonnées)

Nouvelle classe unique (ex. `.sift-zone-toggle`) réutilisée par les deux disclosures — **ne pas**
dupliquer deux boutons de repli avec des styles légèrement différents (c'était le bug initial du
prototype, corrigé en cours de route) :
- Fond de zone identique aux deux (`--color-background-secondary`, même que la zone Écoute).
- En-tête : chevron + titre à gauche, groupe droit = `[badge optionnel] [hint afficher/masquer]`.
- Badge d'en-tête cascade `hidden`/visible en JS selon l'état replié/déplié (masqué si le corps
  est déjà visible, visible si replié) — pas de logique CSS `:has()` (compat navigateur).
- **Repliées par défaut toutes les deux** — décision utilisateur explicite, dernière itération.
- Animation de mise en évidence si un signal pointe vers un fix ailleurs dans la même zone
  (ex. bouton Appliquer les tags) : halo discret `box-shadow` uniquement, PAS de changement de
  couleur de fond, ~0.6s, classe retirée après `animationend` (jamais laissée collée sur
  l'élément — bug constaté et corrigé dans le prototype : sans `animationend`/`forwards`
  cohérents, un cadre residuel restait visible en permanence).

## Style CTA Discogs (bouton "Rechercher")

**Contextuel, pas permanent** : neutre (`--color-surface-raised`, texte secondaire) quand une
identité Discogs existe déjà pour ce morceau (texte "Rechercher à nouveau") ; réservé au gold
plein `--color-accent-identify` (déjà tokenisé, `styles.css`) uniquement pour l'état "rien
identifié pour l'instant" — c'est un vrai changement de comportement vs le vrai code actuel, qui
a un seul style de bouton bold+gold que l'état soit identifié ou non (`.sift-id-btn`,
`filing.ts:1063`). Nécessite de faire dépendre le style du bouton de `state.identified`/
`c.artist && c.title`.

## Sélection de candidat Discogs (`.sift-cand`)

État de repos = neutre (`overlay-selected` + bordure secondaire, même langage que les autres
lignes sélectionnées de Sift, ex. `.qrow.on`), PAS un vert permanent
(`--color-background-success` actuel de `.cand.applied`... équivalent réel à identifier dans
`styles.css`, probablement `.sift-cand.on`/logique dans `identify-shared.ts` ou `filing.ts` —
à vérifier au moment de l'implémentation, ce pattern spécifique n'a peut-être pas d'équivalent
"sélectionné visuellement" aujourd'hui puisque le candidat appliqué n'a pas de style dédié
persistant, seul le remplissage des champs le signale). Un flash vert bref (~0.7s,
`@keyframes`) au moment précis de la sélection, qui retombe vers cet état neutre — pas un état
figé.

## Noms de touches

Aucune régression à corriger ici : le vrai `keyboardHintsHtml()` utilise déjà des noms textuels
(`SPACE`/`ENTER`/`BKSP`/`HAUT/BAS`) — c'était une erreur du prototype (glyphes `⏎`/`⌫`), pas un
état réel à corriger dans le code de prod.

## Vérification

- `npx tsc --noEmit` clean après les changements (`report-view.ts`, `filing.ts`, `styles.css`
  uniquement — aucun fichier Rust touché, aucune migration de schéma).
- Vérification visuelle dans la vraie fenêtre `tauri dev` (Antoine, ou CDP ponctuel WebView2 —
  voir CLAUDE.md, section Vérification UI) sur au moins 3 états : morceau non identifié, morceau
  identifié avec `tags_cdj_ok=false` (bandeau + badge visibles), morceau identifié avec
  `tags_cdj_ok=true` (rien à corriger, badge vert discret). Clair ET sombre.
- `design-review` (skill) en passe finale, comme pour les précédents chantiers UI Sift.

## Non-objectifs

- Pas de changement du contrat IPC (`analyze_path`, `identify`, `apply_tags`, `ranger`...).
- Pas de renommage des commandes backend même si le libellé UI "Identification · Discogs" devient
  "Métadonnées" — seul le texte affiché change, pas les noms de fonctions/commandes.
- Pas de nouvelle source de metadata (le multi-source Discogs+autre reste un non-objectif futur,
  seul le LIBELLÉ générique est posé maintenant pour ne pas avoir à renommer une deuxième fois).
