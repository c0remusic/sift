# Sift — Catalogue d'états des composants réels

> Source de vérité pour le portage design→code : liste, composant par composant,
> tous les états visuels **tels qu'ils existent déjà dans le vrai code**
> (`frontend/styles.css` + les fichiers `.ts` qui les rendent — jamais `app.js`,
> la maquette navigateur jetable, ni `Sift.dc.html`, qui a son propre vocabulaire
> de tokens et sa propre logique). Alimenté au fur et à mesure d'un audit
> composant-par-composant (méthode : cataloguer un à la fois, vérifier, avant de
> continuer — démarré 2026-07-03).
>
> Usage : avant de porter un nouveau design, vérifier ici si le composant existe
> déjà et quels états il a réellement, plutôt que de re-déduire toute la logique
> depuis `Sift.dc.html`. Avant de déclarer un portage "fini", cocher chaque état
> listé contre une preuve fraîche (voir `sift-audit-fidelite-methode` en mémoire).
>
> `.interface-design/system.md` est **périmé sur la palette/direction visuelle**
> (dark superseded, 2026-07-01) — ne pas s'y fier pour les couleurs, seulement
> pour espacement/radius/typo. Ce fichier-ci est la source à jour état-par-état,
> couleurs et comportements réels.
>
> **Audit référence canonique terminé (2026-07-08/09)** : les 8 écrans ont été
> comparés à shadcn/ui-thing/coss/Apple HIG (voir sections « Écran X — audit
> référence canonique » et `docs/superpowers/changes/2026-07-08-ui-reference-audit/`).
> Tout nouveau composant doit suivre la règle CLAUDE.md « Front — référence de
> design avant d'inventer » — consulter le pool avant d'improviser, pas après.
>
> Numéros de ligne vérifiés à jour le 2026-07-03 (après les fixes de cette
> session) — `styles.css` bouge vite, revérifier au grep si un doute.

## Sommaire

> Index de navigation (ligne + gist), pas une table des matières auto-générée.
> Charger ce fichier entier n'est plus automatique (retiré de `CLAUDE.md` le
> 2026-07-09) : ouvrir la section visée via son numéro de ligne plutôt que tout
> lire.

- L30 — Ligne de queue `.qi` — RAS, 4 états déclarés.
- L41 — Item de navigation `.nv` — RAS.
- L52 — Bouton d'action principal `.sift-ranger-btn` — hérite hover/disabled/focus génériques.
- L66 — Chip/tag `.chip` — hover corrigé 07-03.
- L78 — Case à cocher `.cbx` — supprimée (code mort).
- L85 — Segmented control `.sift-seg-opt` (ancien, voir aussi pastille unifiée L603) — RAS.
- L95 — Ligne de journal `.jrnl-qrow` — RAS.
- L105 — Toggle switch `.tog` — perf `transform` corrigée 07-03.
- L118 — Carte verdict `.sift-verdict-card` — tokens corrigés 07-03 (plus de rouge en dur).
- L137 — Ligne candidat `.sift-cand` — hover discret volontaire (bordure seule).
- L150 — Bouton Destination `.sift-dest-btn` — hérite générique.
- L155 — Sliders volume/tempo `.sift-slider-*` — hover/drag ajoutés 07-03.
- L168 — Pochette/cover `.sift-cover-frame` — `alt` fixé 07-03, bug `[hidden]` réellement cassé fixé 07-05.
- L193 — Boutons icon-only — vérifiés, titlebar corrigée 07-03.
- L202 — Barre de progression `.pbar`/`.sift-pz-fill` — perf `transform` 07-03.
- L211 — Popover Destination `.sift-dest-popover` — RAS, scope limité.
- L217 — Bouton Identifier `.sift-id-btn` — tokenisé+dark 07-03, exception 3ᵉ teinte levée 07-06.
- L234 — Bordure latérale `.sift-filed-banner` — anti-pattern side-stripe retiré 07-03.
- L243 — Ombres portées `.sift-toast`/`.sift-report-overlay-card` — tokenisées 07-03.
- L250 — Échelles hauteur/radius — audit 07-03, `--h-36` retiré 07-09 (0 lecteur).
- L287 — Token `disabled` de `Sift.dc.html` — vérifié non manquant.
- L306 — Autres couleurs non tokenisées — restant, pas classées bug.
- L318 — `--text-hero` → `--text-2xl`.
- L330 — Cartes Réglages `.sift-settings-list` — refonte 4→1 carte 07-08.
- L360 — Zone de dépôt drag OS `.sift-dz-on` — token `--overlay-drop` 07-05.
- L384 — Lien rebuy Beatport `.sift-rebuy-btn` — créé 07-05.
- L400 — CTA « Revoir N morceaux → » Accueil — créé 07-05.
- L409 — Page Rekordbox `renderRekordboxLive()` — écran dédié + sections Tier 1/Tier 2 master.db.
- L492 — Écran Revue — zones repliables Diagnostic/Métadonnées, refonte 07-05.
- L528 — `.sift-applytags-btn` — déplacé header Genres 07-09.
- L549 — `.sift-zone-toggle` — accordéon exclusif + animation 07-09.
- L564 — Spectrogramme — légende incrustée + réticule interactif 07-09.
- L587 — `.lk` / `.lk-icon` — bug de réutilisation corrigé 07-07.
- L603 — Pastille segmentée `.sift-seg`/`.sift-seg-opt` unifiée — 6 sites, thumb glissant 07-08.
- L705 — Grammaire de carte — 2 rôles (Groupée/Flottante), jamais 3 — 07-08.
- L741 — Tokens globaux — adaptation tweakcn "ZFlow" (ombres/tracking/radius/OKLCH) 07-08.
- L769 — Écran Accueil — audit référence canonique 07-08.
- L789 — Écran Revue — audit référence canonique 07-08/09.
- L813 — Écran Écartés — audit référence canonique 07-09.
- L831 — Écran Journal — audit référence canonique 07-09, conforme (rien corrigé).
- L842 — Écran Bibliothèque — audit référence canonique 07-09.
- L861 — Écrans Réglages+Rekordbox+Clé USB — audit référence canonique 07-09.
- L881 — Historique des corrections (chronologique, par date de session).

## Ligne de queue — `.qi` (`styles.css:143-148`)

| État | Sélecteur | Valeur (clair) | Valeur (sombre) |
|---|---|---|---|
| Normal | `.qi` | `color: var(--color-text-secondary)` (#5C554E) | #C9C2B7 |
| Hover | `.qi:hover` | `background: var(--color-row-active)` (#F3EFE9) | #413F38 |
| Sélectionnée | `.qi.cur` | `background: var(--color-row-active)` + `color: var(--color-text-primary)` + `font-weight:500` + liseré gauche `box-shadow:inset 2px 0 0 var(--overlay-bar)` | idem, overlay-bar sombre |
| Terminée | `.qi.done` | `color: var(--color-text-tertiary)` | #9C968D |

RAS — 4 états déclarés explicitement, cohérents.

## Item de navigation — `.nv` (`styles.css:106-116`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.nv` | `color: var(--color-text-tertiary)` |
| Hover | `.nv:hover` | `background: var(--color-nav-active)` |
| Actif | `.nv.on` | `background: var(--color-nav-active)` + `color: var(--color-text-primary)` + `font-weight:500` |
| Export (variante) | `.nv-export` / `:hover` | `opacity:.55` → `.85` |

RAS.

## Bouton d'action principal — `.sift-ranger-btn` (`styles.css:170`, `filing.ts:924`)

| État | Source | Valeur |
|---|---|---|
| Normal | `.sift-ranger-btn` | `background: var(--color-background-info)`, `color: var(--color-text-info)` |
| Hover | **hérité de `button:hover`** générique, pas déclaré sur la classe | `background: var(--color-background-secondary)` |
| Disabled | **hérité de `button:disabled`** générique | `opacity:.4` |
| Focus | **hérité de `:focus-visible`** générique | outline 2px `var(--color-text-info)` |

⚠️ **À savoir avant tout portage** : aucun état au-delà du repos n'est déclaré sur
la classe elle-même — tout vient de la cascade sur l'élément `<button>` natif.
Un futur design montrant un hover différent du gris générique serait un vrai
changement à faire, pas un oubli à "ajouter".

## Chip/tag — `.chip` (`styles.css:202`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.chip` | `color: var(--color-text-secondary)`, bordure `var(--color-border-tertiary)` |
| Hover | `.chip:hover` | `background: var(--color-background-secondary)` |
| Sélectionné | `.chip.on` | `background: var(--color-background-info)`, `color: var(--color-text-info)` |
| Sélectionné + hover | `.chip.on:hover` | reste `var(--color-background-info)` (ne pas écraser l'état sélectionné) |
| Disabled | `.sift-chip-disabled` (classe séparée) | `opacity:.4;cursor:not-allowed` |

✅ Corrigé 2026-07-03 (était sans hover — cliquable sans retour visuel).

## Case à cocher — `.cbx`

✅ **Supprimée 2026-07-03** — c'était du code mort côté vraie app (aucun usage
dans `sift-live.ts`/`batch-tracklist.ts`, seulement dans `app.js`, la maquette
jetable). N'existe plus dans `styles.css`. Si un futur design montre une case à
cocher, elle est à construire, pas à réutiliser.

## Segmented control — `.sift-seg-opt` (`styles.css:542-544`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-seg-opt` | `color: var(--color-text-secondary)` |
| Hover | `.sift-seg-opt:hover` | `background: var(--color-row-active)` |
| Actif | `.sift-seg-opt.on` | `background: var(--color-surface-raised)` + `color: var(--color-text-primary)` |

RAS.

## Ligne de journal — `.jrnl-qrow` (`styles.css:561-571`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.jrnl-qrow` | — |
| Hover | `.jrnl-qrow:hover` | `background: var(--color-row-active)` |
| Sélectionnée | `.jrnl-qrow.on` | `background: var(--color-row-active)` + liseré gauche `.jrnl-qrow-bar{opacity:1}` (0 au repos) |

RAS — même famille visuelle que `.qi`, cohérent.

## Toggle switch — `.tog` (`styles.css:203`)

| État | Sélecteur | Valeur |
|---|---|---|
| On (défaut) | `.tog` | `background: var(--color-text-info)`, curseur `transform:translateX(13px)` |
| Off | `.tog.off` | `background: var(--color-border-secondary)`, curseur `transform:translateX(0)` |

✅ Retouché 2026-07-03 (audit Impeccable, perf) : le curseur bougeait via
`left`/`right` (propriété de layout, recalcul à chaque frame) — passé à
`transform:translateX()`. Comportement visuel identique, juste plus performant.
Toujours pas de hover/focus/disabled déclarés — composant discret, faible
priorité, pas classé bug.

## Carte verdict — `.sift-verdict-card` (`styles.css:387`, couleurs en JS `report-view.ts:259-263`)

Le cœur du produit (détection faux-lossless). La couleur de fond n'est pas en
CSS — elle est calculée en JS et injectée en style inline :

```ts
const map = {
  ok:   [..., "var(--color-text-success)", "var(--color-background-success)"],
  fake: [..., "var(--color-text-danger)",  "var(--color-background-danger)"],
  grey: [..., "var(--color-text-warning)", "var(--color-background-warning)"],
} as const;
```

✅ **Corrigé 2026-07-03** — avant, les trois `panelBg` étaient des `rgba(...)`
en dur, dont un vrai rouge pour `fake` qui contredisait la décision de palette
documentée en tête de `styles.css` ("plus de rouge, danger fusionne dans
l'ambre"). Remplacés par les tokens `--color-background-success/danger/warning`
déjà existants — élimine la duplication de valeurs ET la contradiction.

## Ligne candidat (identification) — `.sift-cand` (`styles.css:226-235`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-cand` | bordure `var(--color-border-tertiary)` |
| Hover | `.sift-cand:hover` | bordure `var(--color-border-secondary)` uniquement — **pas de `background`** |
| Erreur | `.sift-cands-error` (posée en JS) | `color: var(--color-text-warning)` |

Pas un bug — juste noté : le hover ici est délibérément discret (bordure seule,
pas de fond), cohérent avec une liste de résultats de recherche. Différent
pattern des lignes `.qi`/`.jrnl-qrow` (fond au survol), à garder en tête pour ne
pas "corriger" par erreur vers l'uniformité lors d'un futur portage.

## Bouton Destination — `.sift-dest-btn` (`styles.css:161`, `filing.ts:917`)

Même famille que `.sift-ranger-btn` — vrai `<button>`, hérite hover/disabled/focus
du sélecteur générique. RAS.

## Sliders (volume, tempo) — `.sift-slider-*` (`styles.css:377-382`, drag wiring `report-view.ts` `dragSlider()`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-slider-thumb` | `transform:translate(-50%,-50%) scale(1)` |
| Hover (survol de la track) | `.sift-slider-track:hover .sift-slider-thumb` | `scale(1.15)` |
| Drag actif | `.sift-slider-track.dragging .sift-slider-thumb` | `scale(1.3)` + halo `box-shadow:0 0 0 4px var(--overlay-selected)` |

✅ Corrigé 2026-07-03 — avant, aucun feedback visuel. La classe `.dragging` est
posée/retirée en JS (`mousedown`/`mouseup` dans `dragSlider()`, partagée par
volume et tempo) car le thumb a `pointer-events:none` (le drag est géré par la
track parente).

## Pochette / cover — `.sift-cover-frame` (`styles.css:356-357`, markup `report-view.ts` `playerHeaderHtml()`)

✅ Corrigé 2026-07-03 — `alt=""` (vide, sur une image de contenu réel, pas
décorative) remplacé par `alt="Pochette — {nom du morceau}"`, rempli
dynamiquement depuis le paramètre `name` déjà disponible dans la fonction.
`hidden` + pas de `src` au premier rendu reste volontaire (divulgation
progressive, pochette affichée une fois chargée) — pas une image cassée.

✅ **Corrigé 2026-07-05 — vraie image cassée trouvée et corrigée** (rapportée
via l'outil d'annotation Alt+Clic, voir Évaluation 12). Root cause : CSS, pas
réseau/backend. `.sift-player-cover{display:block}` (`styles.css:379`) n'avait
aucun garde `:not([hidden])` — une règle auteur bat toujours le user-agent
stylesheet (`[hidden]{display:none}`) quelle que soit la spécificité comparée,
donc poser `covEl.hidden = true` en JS n'avait **aucun effet visuel**. Résultat :
tout échec de chargement de la pochette (même transitoire) restait affiché comme
glyphe "image cassée" du navigateur **pour toujours**, par-dessus le vinyle,
puisque rien ne pouvait jamais le recacher. Vérifié en direct par CDP
(`getComputedStyle(img).display` restait `"block"` avec `hidden=true` avant
fix, bascule correctement `none`/`block` après). Fix : sélecteur changé en
`.sift-player-cover:not([hidden])`. Durci en même temps : `cover.rs` rejette les
téléchargements < 1 Ko (le "spacer" placeholder que Discogs sert parfois à la
place d'une vraie pochette) avant de les mettre en cache ; `filing.ts` pose un
`onerror` qui recache l'image en cas d'échec (inefficace avant ce fix CSS,
fonctionne maintenant).

## Boutons icon-only (lecture, lien Discogs, titlebar) — vérifiés

`sift-play-btn` (`report-view.ts:208`) a `title` + `aria-label`. Lien Discogs
icon-only dans la Bibliothèque (`sift-live.ts:1139`) a `aria-label="Page
Discogs"`. Le bouton "Voir la release" (`library-detail.ts:70`) a du texte
visible, pas besoin d'`aria-label`. ✅ Titlebar (`chrome.ts:122-124`, boutons
min/max/close) corrigée 2026-07-03 — n'avait que `title`, `aria-label` ajouté
sur les 3 boutons (seul manque trouvé dans cette catégorie).

## Barre de progression — `.pbar`/`.pfill` (`styles.css:149`) et `.sift-pz-fill` (`styles.css:135-136`, JS `progress-zone.ts`)

`.sift-pz-row.error .sift-pz-fill` bascule vers `var(--color-text-danger)` en
cas d'erreur — cohérent avec les tokens. ✅ Perf corrigée 2026-07-03 (audit
Impeccable) : `.sift-pz-fill` animait `width` (propriété de layout) — passé à
`transform:scaleX()` + `transform-origin:left`, `width:100%` fixe désormais.
`progress-zone.ts` mis à jour en conséquence (`style.transform` au lieu de
`style.width`, deux points d'écriture).

## Popover Destination — `.sift-dest-popover` (`styles.css:176-182`) — RAS (scope limité)

Seul état géré en CSS : `[hidden]` (fermé). Pas de transition d'ouverture ni
d'état focus-trap dédié, mais rien qui contredise un token ou une décision
actée — pas classé bug, juste minimal.

## Bouton Identifier — `.sift-id-btn` (`styles.css:237-238`)

```css
/* Deliberate 3rd hue (gold), documented exception... */
.sift-id-btn{background:var(--color-accent-identify);border-color:var(--color-accent-identify-border);color:var(--color-accent-identify-text);...}
.sift-id-btn:hover{background:var(--color-accent-identify-hover)}
```

✅ **Corrigé 2026-07-03** — avant, doré (`#FFdc82`/`#f0cc6a`/`#1d1c1a`) en dur,
sans token, **sans variante sombre du tout** (même couleurs en mode sombre).
Contredisait la règle documentée en tête de fichier ("2 couleurs sémantiques
seulement, pas de 3e teinte"). Tokenisé (`--color-accent-identify`/`-hover`/
`-text`/`-border`, défini dans `:root` + les deux blocs sombres) et **gardé
comme exception documentée** — c'est le CTA de l'identification, pas un statut,
donc une 3e teinte assumée plutôt que supprimée. Commentaire inline explique le
choix pour la prochaine lecture.

## Bordure latérale colorée — `.sift-filed-banner` (`styles.css:478`)

✅ **Corrigé 2026-07-03** (audit Impeccable, anti-pattern) — avait un
`border-left:2px solid var(--color-text-success)`, ban explicite Impeccable
("side-stripe borders... never intentional", tell reconnaissable d'UI générée
par IA). Retiré, fond teinté (`background:var(--color-background-success)`)
conservé + `border-radius` ajouté pour ne pas perdre toute délimitation
visuelle.

## Ombres portées — `.sift-toast` (`styles.css:476`) / `.sift-report-overlay-card` (`styles.css:423`)

✅ **Tokenisées 2026-07-03** — `box-shadow` en `rgba(0,0,0,.4)`/`.5` en dur
remplacé par `var(--shadow-toast)`/`var(--shadow-overlay)`, définis dans
`:root` (mêmes valeurs, noir fixe volontaire, lisible dans les deux thèmes —
pas besoin de variante sombre pour une ombre).

## Échelles hauteur/radius (`/design-system audit`, 2026-07-03)

**Hauteur** (`--h-*`, `styles.css:47-48`) — les 4 tokens déclarés (32/36/40/44)
avaient **0 lecteur** (`grep -rn "var(--h-"` sur tout `frontend/` : aucun
match). `--h-32`/`--h-44` **supprimés** (aucun composant réel ne les utilise,
déclarés sans plan). `--h-36`/`--h-40` **gardés et câblés** sur leurs deux
vrais consommateurs : `.sift-play-btn` (`styles.css:348`, était `36px` en
dur) et `.jrnl-insp-revert` (`styles.css:591`, était `40px` en dur). Deux
autres 36px/40px existants (`.cov` avatar, `.sift-cand img/noart` vignette,
`styles.css:209`/`228`) **laissés en littéral, exprès** : ce sont des tailles
de cadre image/avatar, pas des hauteurs de contrôle — l'échelle ne couvre que
les boutons/contrôles interactifs.

**Mise à jour 2026-07-09 (audit Project Cleaner)** : `--h-36` a depuis perdu
son seul consommateur — la refonte Revue "surface continue" du 2026-07-06
(voir plus bas) a agrandi `.sift-play-btn` à une valeur littérale `46px`, sans
que ce paragraphe soit mis à jour en conséquence. Confirmé par grep (`var(--h-36)`
: zéro match) puis supprimé de `styles.css`. `--h-40` reste câblé sur
`.jrnl-insp-revert`, seul survivant de l'échelle hauteur.

**Radius** (`--border-radius-*`, `styles.css:29`) — `system.md` déclare 4
valeurs (sharp 4 / default 6 / soft 10 / pill 999) mais seuls `md`(6)/`lg`(10)
existaient. Ajouté `--border-radius-sm:4px` et `--border-radius-pill:999px`,
et câblés partout où la valeur littérale correspondait exactement : 3
occurrences de `4px` (`.sift-cand img/noart`, `.sift-bgrp-box`,
`.sift-time-elapsed`/`.sift-time-total`) → `var(--border-radius-sm)` ; 7
occurrences de `999px` (`.nv-export-dot`, `.nav-badge`, `.sift-genre-chip`,
`.jrnl-cat-badge`, `.sift-vchip`, `.jrnl-qrow-dot`, `.jrnl-insp-dot`) →
`var(--border-radius-pill)`.

**Reste hors scope, pas corrigé** : les valeurs qui ne correspondent à aucune
des 4 tailles déclarées (1px, 2px, 3px, 7px, 8px, 9px, 11px, 12px — ex.
`.jrnl-qmode`/`.sift-settings-seg`/`.jrnl-qrow` à `7px`, `.jrnl-cat` à `12px`)
n'ont pas été retouchées : les tokeniser demanderait d'étendre l'échelle
elle-même (décision de design, pas un simple câblage de token existant vers
un littéral identique).

## Token `disabled` de `Sift.dc.html` — vérifié non manquant (2026-07-04)

Investigation drift `Sift.dc.html`↔`styles.css` (docs/ressources-externes.md,
Évaluation 6) : sur les 17 clés de l'objet `theme()` (`Sift.dc.html:836-846`),
16 sont portées et câblées ; `disabled` (#CFC9BF clair / #57554D sombre)
semblait absente de `styles.css`. Vérification des 3 usages réels de
`T.disabled` dans la maquette (`Sift.dc.html:1135` dot "pending",
`1170`/`1210` barres de waveform inactives, `1339` fond de bouton primaire
désactivé) : **chacun a déjà un équivalent dans le vrai code**, avec un
mécanisme différent mais volontaire — dot "En analyse"
(`sift-live.ts:559`) réutilise `--color-text-tertiary` plutôt qu'une 5ᵉ
teinte neutre ; bouton désactivé hérite de `button:disabled{opacity:.4}`
(atténuation, pas couleur de substitution — voir `.sift-ranger-btn`
ci-dessus) ; waveform reste un canvas toujours sombre (voir note plus bas).
**Décision : ne pas ajouter de token `--color-disabled`** — aucun
consommateur réel n'en a besoin, cohérent avec le retrait de `--h-32`/`--h-44`
(audit du même jour, zéro lecteur). Cas classé non-bug, pas juste priorité
basse.

## Autres couleurs non tokenisées (audit complémentaire "tokens pour toutes les fonctions ?") — restant, pas classées bug

- `.sift-time-elapsed{color:#ff5500}` (`styles.css:371`) — orange en dur,
  horodatage sur la waveform, aucun token, aucune variante sombre. Pas
  corrigé — priorité basse, élément mineur sur canvas déjà fixe.
- Overlays waveform/spectrogramme (`rgba(255,255,255,.6)`, fond `#000`,
  badges temps `rgba(0,0,0,.55)`) — **volontaire** : ce canvas reste toujours
  sombre indépendamment du thème de l'app, comme un lecteur audio pro. Pas un
  manque de token, ne pas "corriger" à tort.
- `.tog::after{background:#fff}` — blanc en dur sur pastille colorée, mineur,
  pattern courant (curseur blanc sur fond coloré), pas de token nécessaire.

## `--text-hero` → `--text-2xl` (échelle typo, 2026-07-03)

Token renommé, valeur inchangée (26px). Il s'appelait "hero" pour un rôle de
titre de morceau en 30px/600 (`system.md:103`) qui n'existe plus dans le
layout actuel — sa seule vraie utilisation (`library-detail.ts:57`) est la
taille de l'icône vinyle de repli dans le cadre pochette 72×72
(`library-detail.ts:59`), pas un titre. Renommé selon la convention de
l'échelle existante (`xs`→`2xl`) plutôt que de prétendre encore à un rôle
"hero" qu'il ne joue pas ; valeur gardée telle quelle (26px reste la bonne
taille visuelle pour cette icône, aucun changement rendu). Le vrai titre de
morceau (`.sift-player-name`) reste sur `--text-lg` (14px), non affecté.

## Cartes Réglages — `.sift-settings-list` (`styles.css`, structure `sift-live.ts` `renderReglagesLive()`)

**Refonte 2026-07-08** : avant, chaque section (Discogs/Bibliothèque/Apparence/
Clé USB) était sa propre `.sift-ui-card-soft` — 4 cartes empilées. Retour
utilisateur : "trop de boîtes" ; vérifié que chaque carte ne contenait
**qu'un seul réglage** — une boîte groupe des informations liées (règle HIG
"Boxes", voir spec `2026-07-07-hig-adaptation-design-spec.md`), en grouper
une seule n'ajoute que du chrome. Les 4 sections partagent maintenant **une
seule** `.sift-ui-card-soft` (id `sift-reglages-list`), séparées par un filet
horizontal (`.sift-settings-list-row`, bordure `--color-border-tertiary`
0.5px sur toutes les lignes sauf la première).

| État | Sélecteur | Valeur |
|---|---|---|
| Boîte unique | `.sift-settings-list` sur `.sift-ui-card-soft` | fond `var(--color-background-secondary)`, bordure `var(--color-border-tertiary)` — une seule fois pour les 4 sections |
| Ligne (section) | `.sift-settings-list-row` | pas de fond/bordure propre — délimitée par un filet `border-top` sauf la première |
| Bouton (ex. "Changer…") | `.sift-settings-btn` | fond `var(--color-surface-raised)` |
| Bouton hover | `.sift-settings-btn:hover` | `filter:brightness(0.95)` |
| Lien "Oublier" | `.sift-settings-forget` | `color: var(--color-text-quaternary)` |
| Lien "Oublier" hover | `.sift-settings-forget:hover` | `color: var(--color-text-secondary)` |

**Structure DOM** : `renderReglagesLive()` construit un **wrapper unique**
`<div id="sift-reglages-live">` (règle 2026-07-04, inchangée) contenant
maintenant un second wrapper `<div id="sift-reglages-list" class="sift-settings-list sift-ui-card-soft sift-ui-card-soft-pad">`,
qui porte les 4 sections (`sift-reglages-discogs`/`-bibliotheque`/`-apparence`/
`-usb`, chacune `.sift-settings-list-row`). **Toute nouvelle section doit
s'ajouter à l'intérieur de `list`**, pas comme sibling direct de `wrap` ou de
`#content` — sinon elle redevient une carte isolée et le bug de duplication
2026-07-04 se reproduit sur un autre wrapper.

## Zone de dépôt drag OS — `.sift-dz-on` (`chrome.ts` `ensureDropStyle`/`setDropActive`)

Overlay de dépôt affiché **pendant un drag OS seulement** (jamais au repos —
`setDropActive` pose/retire `.sift-dz-on`). Style injecté une fois
(`ensureDropStyle`, un `<style>` partagé par les 3 zones). Chaque zone montre son
propre texte via `::after{content:attr(data-dz)}`.

| Élément | Valeur |
|---|---|
| Contour | `outline:1.5px dashed var(--color-text-info)` + `outline-offset:-4px` (affordance drop conventionnelle, gardée) |
| Voile `::after` | `background:var(--overlay-drop)` + `color:var(--color-text-info)`, centré |
| Zones cibles | `#filfoot` (→ nouvelle destination), `#ql` (→ file audio), `#sift-sources` (→ dossier surveillé) ; fallback `#content` |

✅ **Corrigé 2026-07-05** (chantier unification drop↔rail, grill-me) — le voile
était `rgba(20,20,24,.55)` **codé en dur, sombre, ignorant le thème clair chaud
actuel**. Remplacé par le token thème-aware `--overlay-drop`
(`styles.css`, `:root` + les 2 blocs sombres : clair `rgba(214,209,202,.93)`,
sombre `rgba(60,60,57,.93)` = base + ~10% tint info, à 93 % d'opacité). Le drop
adopte ainsi le langage info du rail (bordure+texte étaient **déjà** en
`--color-text-info`). Décisions grill-me : dashed gardé, même info pour les 3
zones, mouvement (pulse Destination au drop) **reporté**. Découvrabilité au repos
non ajoutée (drop reste drag-only, choix acté). Vérifié live par CDP :
`--overlay-drop` résout bien dans la vraie app Tauri.

## Lien rebuy Beatport — `.sift-rebuy-btn` (`styles.css:489`, `filing.ts` `refreshRebuyLink()`)

| État | Valeur |
|---|---|
| Absent | `.sift-rebuy` vide → `:empty{margin-bottom:0}`, aucun gap |
| Présent | `<button>` texte+icône, `background:var(--color-background-warning)` + `color:var(--color-text-warning)` + bordure `--color-border-tertiary`, `border-radius:var(--border-radius-md)`, pleine largeur |

Créé 2026-07-05. Gating strict : affiché **seulement** quand
`state.track.verdict === "fake"` **ET** `state.identified` (identité Discogs
appliquée) — chercher un nom de fichier brut est inutile. Container create-once
`.sift-rebuy` (après les genres dans `renderEditor`), rempli par
`refreshRebuyLink()` sur open / renderEditor / identify frais. Ouvre
`beatport.com/search?q=artiste+titre` via `openUrl` (commande Rust `open_url`,
http(s) uniquement, pas de whitelist domaine). Teinte ambre volontaire (cohérent
« le danger fusionne dans l'ambre »), pas de side-stripe.

## CTA « Revoir N morceaux → » — Accueil (`home-sources.ts` `listColumnHtml()`)

Bouton pill dans l'en-tête de la colonne Sources, affiché **seulement quand**
`pending_count` cumulé sur toutes les sources > 0.
`background:var(--color-background-success)` + `color:var(--color-text-success)` +
`border-radius:var(--border-radius-pill)` — vert « prêt à revoir ». Clic →
dispatch un clic sur `[data-view="revue"]` (le pont Accueil→Revue). Créé
2026-07-05.

## Page Rekordbox — `renderRekordboxLive()` (`sift-live.ts`, `data-view="rkb"`)

Écran dédié (audit UI 2026-07-05, annotation « rekordbox = fonction d'export,
ce n'est pas le but ») remplaçant l'ancien comportement one-click nav → toast.
Déplacé depuis Bibliothèque (`rekordboxCardHtml()` n'y vit plus). Nav :
groupe renommé « Export » → « Intégrations », item Rekordbox passé de
`.nv-export` (puce ambrée, opacité .55) à `.nv` plein avec icône `ti-disc` —
même traitement que Bibliothèque/Journal. « Clé USB » reste `.nv-export`
inchangé (son propre brainstorm est à venir).

| État | Condition | Rendu |
|---|---|---|
| Non lié | `linked=false` | `empty-state.ts` (étendu ce chantier avec `actionHtml?`) : titre + note + bouton `data-bib="rkblink"` |
| Lié, sain | `linked=true, error=null` | Carte : chemin + compteurs, boutons « Réexporter maintenant » (`data-sift="rkbreexport"`) + « Changer de XML lié » |
| Lié, erreur | `linked=true, error≠null` | Carte : message illisible/corrompu, pas de bouton réexport (backend refuse déjà l'export) |
| Drift détecté | `drift_detected=true` | **Nouveau** — bannière `.sift-dup-banner` (fond `--color-background-warning`), **orthogonale** aux 3 états ci-dessus (peut s'afficher au-dessus de sain OU erreur, pas un `if/else if` à 4 branches). Signal backend existant depuis FIX-7, jusqu'ici invisible sauf en log serveur. |

`.sift-dup-banner-where` est conçu pour un chemin de fichier tronqué
(`nowrap`+`ellipsis`) — la bannière drift porte une phrase complète (tout le
message d'un warning auparavant invisible), donc override inline
`white-space:normal;overflow:visible;text-overflow:clip` sur cette instance
précise (trouvé en revue finale, corrigé avant merge).

Design/plan : `docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md`,
`docs/superpowers/plans/2026-07-05-rekordbox-integration-page.md`. Construit
via subagent-driven-development (4 tâches, chacune approuvée + revue finale
de branche "Ready to merge"). `tsc --noEmit` clean après chaque tâche ;
vérification `tauri dev` par Antoine restante (code gated `inTauri`).

### Section réparations master.db (M8 Tier 1) — `masterdbRepairsSectionHtml()`

Ajoutée sous la carte de statut, **indépendante** de la bannière `drift_detected`
ci-dessus (signal XML existant — les deux ne sont jamais fusionnés en un seul
message, cf. spec). Visible seulement si `status.linked` et au moins une ligne
`pending`/`ambiguous` existe (sinon section absente, même règle que la bannière).

| Groupe | Condition | Rendu |
|---|---|---|
| Ambiguës (affichées en premier) | `status="ambiguous"` | Chemin avant→après + liste de boutons « Choisir cette piste — {chemin ou ID brut} » (`data-sift="mdbresolve"`) + « Ignorer » |
| Prêtes (pending) | `status="pending"` | Checkbox (`.sift-batch-ck`) + chemin avant→après + « Ignorer » ; barre « Appliquer la sélection (N) » sous la liste si ≥1 coché |
| Erreur d'application | ligne restée `pending` après un `apply_repairs` en échec | Message d'erreur humanisé en petit sous le chemin (état transitoire en mémoire, `mdbErrorById`, pas de colonne DB) |

Sélection (`mdbRepairSel`) **module-level, persistante entre rendus** (comme
`batchSel`, `sift-live.ts:271`) — refiltrée contre les lignes encore
présentes à chaque rendu, jamais réinitialisée en bloc. `confirmAction()`
obligatoire avant tout `apply_repairs` (jamais `window.confirm()`).

Design/plan : `docs/superpowers/specs/2026-07-06-m8-tier1-ui-screen-design.md`,
`docs/superpowers/plans/2026-07-06-m8-tier1-ui-screen.md`. Construit via
subagent-driven-development dans un worktree isolé (`dj-assistant-m8-tier1-ui`,
branche `m8-tier1-ui-screen`) — 4 tâches, revue finale (Opus) "Ready to merge",
mergé dans `m6a-discogs`. 276 tests Rust + `tsc --noEmit` clean ; vérification
`tauri dev` par Antoine restante.

### Section doublons de playlist (M8 Tier 2) — `playlistDuplicatesSectionHtml()`

Ajoutée sous la section réparations Tier 1 ci-dessus (même page Rekordbox),
**indépendante** — les deux sections coexistent, jamais fusionnées. Contrairement
à Tier 1, aucune persistance DB : scanné à la demande à chaque rendu
(`rekordboxMasterdbScanPlaylistDuplicates`, lecture seule), le résultat vit en
mémoire (`lastScannedDuplicateGroups`) pour que le clic référence le bon groupe.
Visible seulement si le scan retourne au moins un groupe (sinon section absente,
même règle show-nothing-when-empty que les autres sections Rekordbox).

| État | Condition | Rendu |
|---|---|---|
| Ligne de groupe | un groupe scanné | Nom de playlist (ou `Playlist {id}` si non résolu) + nom de fichier de piste (ou `Piste {id}`) + « N doublon(s) » + bouton « Dédupliquer » (`data-sift="mdbdedup"`), texte seul, pas de multi-sélection |
| Erreur de dédup | dédup échouée pour ce groupe | Message d'erreur humanisé en petit sous la ligne (état transitoire en mémoire, `mdbDedupErrorByKey`, clé `playlistId::contentId`, pas de colonne DB) |

Enrichissement backend display-only (`playlist_name`/`track_path`, ajoutés à
`PlaylistDuplicateGroupDto` après le câblage IPC de base) — jamais requis par
`dedup_playlist_group`, qui ignore ces champs (`From` inverse inchangé).
`confirmAction()` obligatoire avant tout `dedup_playlist_group` (jamais
`window.confirm()`), même pattern que Tier 1.

Design/plan : `docs/superpowers/plans/2026-07-08-m8-tier2-ui-screen.md`
(enrichissement backend), `docs/superpowers/plans/2026-07-08-m8-tier2-ipc-wiring.md`
(commandes IPC de base), `docs/superpowers/plans/2026-07-08-m8-tier2-playlist-dedup-rust.md`
(moteur). Construit via subagent-driven-development sur `m6a-discogs` directement
(pas de worktree isolé cette fois) — revues finales (Opus pour le moteur/IPC
d'écriture) "ready to merge" à chaque étape. `tsc --noEmit` clean ; vérification
`tauri dev` par Antoine restante (code gated `inTauri`).

## Écran Revue — zones repliables Diagnostic/Métadonnées (2026-07-05)

Refonte de `#mid` : la zone Diagnostic (`report-view.ts`, spectre + mesures)
et la zone Métadonnées (`filing.ts::renderEditor`, ex-« Identification ·
Discogs ») partagent maintenant un même mécanisme de disclosure — repliées
par défaut, badge de statut visible dans l'en-tête replié, caché déplié.

| État | Condition | Rendu |
|---|---|---|
| Badge qualité (Diagnostic) | zone repliée | `LOSSLESS` / `MP3 ≈ X kbps` dans l'en-tête, ton success/danger/warning selon `qualityChipTone(r)` |
| Badge CDJ (Métadonnées) | zone repliée | `CDJ compatible`/`CDJ incompatible`, calculé depuis `report.tags_cdj_ok` |
| Zone dépliée | clic sur l'en-tête | badge caché, corps affiché (`.sift-zone-toggle-body-open`) |
| Tag-warn | `!tags_cdj_ok` | bandeau explicite nommant Artiste+Titre (pas un « tags non écrits » générique) + bouton Appliquer les tags |
| CTA Discogs | `c.artist && c.title` | `.sift-id-btn-neutral` (« Rechercher à nouveau ») au lieu du gold plein — le gold reste réservé à « rien identifié » |
| Sélection candidat | choix appliqué | flash bref sur `.sift-identified-line` (`.sift-identified-flash`), PAS un état permanent — la liste de candidats est remplacée par cette ligne, aucun `.sift-cand` ne survit à la sélection |

**Correction importante trouvée en cours de chantier** : `tags_cdj_ok`
(`tags.rs:73-76`) n'est PAS un signal de qualité audio — c'est littéralement
« Artiste+Titre déjà gravés dans les tags du fichier ». Le badge CDJ vit
donc désormais avec son critère et son fix (Métadonnées), pas avec le
diagnostic audio — retour en arrière volontaire par rapport à la décision
FIX-4 de `report-view.ts` (qui l'avait sorti vers les chips Preuves comme
différenciateur produit). En creusant `Sift.dc.html` pour la reconciliation
maquette, la maquette Claude Design portait déjà CDJ+ID3 dans Identification
depuis le début — FIX-4 avait donc dévié du design original, pas l'inverse.

Design/plan : `docs/superpowers/specs/2026-07-05-revue-screen-redesign-design.md`,
`docs/superpowers/plans/2026-07-05-revue-screen-redesign.md`. Prototype HTML
autonome itéré avant l'écriture du spec (jetable, jamais un livrable).
Construit via subagent-driven-development (4 tâches + revue finale « Ready to
merge with fixes », 3 minor fixés directement : docstring périmé, nom de
fonction obsolète en commentaire, CSS `.sift-highlight-flash` jamais câblée
— morte par décision, pas un oubli). `app.js` et `Sift.dc.html` réactualisés
dans la foulée (voir Historique ci-dessous) ; `tauri dev` restant à vérifier
par Antoine (code gated `inTauri`).

## `.sift-applytags-btn` — bouton Appliquer, header Genres (2026-07-09)

Déplacé du bas de carte (barre pleine largeur) vers le header "Genres"
(`.sift-genres-header`, `filing.ts::renderEditor`) — bouton compact,
`justify-content:space-between` avec le libellé "Genres". Reste dans le DOM
même quand rien à appliquer (`hidden`, pas omis du markup) : `onIdentityApplied`
doit pouvoir l'unhide + déclencher l'auto-apply sans un `renderEditor()` complet.

| État | Condition | Rendu |
|---|---|---|
| Caché | `!c.artist \|\| !c.title` (track pas identifiée) | `hidden` — `.sift-applytags-btn:not([hidden])` porte tout le style visuel, sinon un `display` d'auteur battrait silencieusement `[hidden]{display:none}` (même piège que `.sift-player-cover`, voir plus bas) |
| Idle, activable | `tagFieldDiffs().any === true` | fond/bordure pleins, texte `--color-text-secondary` (inline, `setApplyIdle`) |
| Idle, grisé | `tagFieldDiffs().any === false` | **PAS** `opacity` globale (le fond se noyait vers celui de la carte, illisible) — bg/border restent pleins, seul le texte passe `--color-text-tertiary` (inline, `refreshDiscrepancy`). `tagFieldDiffs` compare aussi `version` (fusionné dans le titre, cohérent avec l'écriture ID3 réelle) — éditer seulement la version dégrise correctement désormais |
| Appliqué | après succès `doApplyTags` | texte "Annuler", `btn.dataset.applied="1"` — `refreshDiscrepancy` ne touche jamais ce bouton dans cet état |

Auto-apply : identifier un titre Discogs déclenche `doApplyTags` automatiquement
(`onIdentityApplied`), plus besoin d'un second clic manuel. Badge CDJ
post-apply dérivé d'une vraie relecture du fichier (`trackFileTags`), pas
assumé depuis le succès de l'écriture — un échec d'écriture silencieux
n'affiche plus "CDJ compatible" à tort.

## `.sift-zone-toggle` (Diagnostic/Métadonnées) — accordéon exclusif + animation (2026-07-09)

Diagnostic audio et Métadonnées sont maintenant un accordéon exclusif (réf.
shadcn Accordion) : ouvrir l'un ferme l'autre. Coordination entre
`report-view.ts` et `filing.ts` (deux modules distincts, pas d'ancêtre commun
disponible) via un événement `document`-level `sift:accordion-open`, écouté
une seule fois au chargement du module (singleton ES) pour ne jamais
accumuler de listener sur les réouvertures de piste.

| État | Sélecteur | Rendu |
|---|---|---|
| Hover | `.sift-zone-toggle:hover .sift-zone-toggle-label` | texte-seul highlight (`--color-text-primary`), **pas** de case qui se superpose — `.sift-zone-toggle:hover{background:none}` réaffirmé explicitement (sinon le `button:hover` générique bat silencieusement la règle de base, même piège que `.sift-play-btn`, déjà documenté CLAUDE.md) |
| Bordure du cadre au survol | `.sift-spectro-box:has(.sift-zone-toggle:hover)`, idem `.sift-fil-editor.sift-fil-editor-margin` | `border-color` passe à `--color-border-secondary` — `:has()` cible l'ancêtre depuis l'état du bouton descendant |
| Ouverture/fermeture | grid `0fr`→`1fr` (même trick que Diagnostic avait déjà) | Métadonnées utilisait avant `display:none/block` sans transition — uniformisé. Padding sur un 3e wrapper imbriqué (`.sift-zone-toggle-body-pad`), jamais sur l'item que le track grid mesure directement : `overflow:hidden` ne zéro que la contribution de CONTENU au minimum automatique d'un track, jamais le padding porté par l'item lui-même — mis dessus deux fois par erreur (`#sift-meta-body` puis `.sift-zone-toggle-body-inner`), plancher resté coincé à 8px puis 16px au lieu de 0 |

## Spectrogramme — légende incrustée + réticule interactif (2026-07-09)

Remplace la ligne pointillée statique de cutoff (`report-view.ts::drawSpectrogram`)
par une légende permanente + un réticule au survol. Design :
`docs/superpowers/specs/2026-07-09-spectrogram-hover-crosshair-design.md`.
Plan : `docs/superpowers/plans/2026-07-09-spectrogram-hover-crosshair.md`.

| Élément | État | Rendu |
|---|---|---|
| Légende fréquence (haut-gauche) | permanent, dessinée une fois sur `.sift-spectro-canvas` | 3 paliers proportionnels à `nyquist` (jamais des kHz fixes), texte contour sombre+remplissage clair (`drawOutlinedText`) — lisible quelle que soit la couleur du spectrogramme sous le texte |
| Légende dB (haut-droit) | permanent | 6 paliers dérivés de `SPECTRO_GAIN_DB`/`SPECTRO_RANGE_DB` (0 à -100 dBFS), texte seul — pas de barre dégradée (testée en mockup, jugée peu claire) |
| Réticule | survol souris, `.sift-spectro-overlay` (2e canvas transparent superposé) | ligne horizontale+verticale pleine (pas pointillée), couleur claire fixe `rgba(255,255,255,0.85)` — **pas** un token thème-aware (`--color-text-secondary` s'assombrit en thème clair alors que le canvas reste toujours noir, trouvé en revue finale : réticule illisible en thème clair, le défaut de Sift) |
| Étiquette réticule | survol | pill sombre, `"{mm:ss} · {kHz} · {dB}"`, lus depuis `sg.mag_db` (même donnée que le pixel colorié) |
| Repos | `mouseleave` | overlay entièrement effacé, rien ne reste affiché — tout se découvre au survol |

Souris uniquement, pas d'équivalent clavier (canvas garde son `role="img"`/
`aria-label` statique). Construit via subagent-driven-development (3 tâches +
1 commit correctif post-revue-finale). Un finding hors-scope accepté sans
réécriture d'historique : le commit de la Tâche 3 (`ff1dc19`) embarque aussi
un mécanisme d'accordéon exclusif Diagnostic/Métadonnées développé plus tôt
dans la même session — voir `.superpowers/sdd/task-3-report.md` (gitignoré,
scratch de session) pour le détail.

## `.lk` / `.lk-icon` — bouton minimal, deux usages jamais mélanger (2026-07-07)

`.lk` (`styles.css`) est une boîte fixe 22×22px, centrée, sans padding —
conçue pour un **bouton icône seule** (lien Discogs, Identifier, Restaurer/
Corbeille dans Écartés). Elle était réutilisée par erreur pour des boutons à
**texte** ("Réexporter maintenant", "Changer de XML lié", "Lier un fichier
XML Rekordbox", "Résoudre") — le label se retrouvait compressé dans la boîte
22px et débordait en se chevauchant avec le contenu voisin (bug réel trouvé
via capture d'écran par Antoine, page Rekordbox non liée). Corrigé : `.lk`
renommée `.lk-icon` (mêmes propriétés), utilisée seulement sur les 4 vrais
boutons icône-seule ; tous les boutons texte retombent sur le reset `button{}`
de base (bordure, padding, hover — déjà correct partout ailleurs dans l'app).
**Règle à retenir** : `.lk-icon` = icône seule, taille fixe, jamais de texte
dedans ; un bouton avec label texte n'a besoin d'aucune classe particulière,
`button{}` suffit.

## Pastille segmentée — `.sift-seg`/`.sift-seg-opt`, composant unique (2026-07-08)

4 implémentations différentes coexistaient pour le même job ("choisir une
option parmi peu, exclusif") : Apparence (Réglages, déjà la bonne
référence) ; Format USB (FAT32/exFAT, réutilisait `.sift-seg-opt` pour la
pastille mais sans la piste encaissée — pastilles "à nu") ; Détail/Lot
(file d'attente Revue, **réimplémenté en styles inline** dans `sift-live.ts`,
dupliquant tout le composant en CSS-in-JS) ; Dossiers/Genres (Bibliothèque,
utilisait `.chip`/`.chip.on` — la grammaire filtre/tag, pas la grammaire de
choix exclusif). Unifiés en un seul composant :

| Élément | Classe | Rôle |
|---|---|---|
| Piste | `.sift-seg` | fond `--color-track`, radius 7px, padding 2px — encaisse les options |
| Option | `.sift-seg-opt` | `<span>` (texte seul) ou `<button>` (icône+label) ; `.on` = fond `--color-surface-raised` |

Sites : Apparence (Réglages), Format USB (`usb-format-modal.ts`), Détail/Lot
(`#sift-revseg`, `sift-live.ts` `ensureReviewSeg()`), Dossiers/Genres
(Bibliothèque, `sift-live.ts`), Session/Historique (Journal, `journal.ts`
`headerHtml()` — 6ᵉ site trouvé dans une 2ᵉ passe, `.jrnl-mode`/
`.jrnl-mode-btn`). `#sift-revseg` garde une règle CSS propre
(`align-self:center;margin-bottom:10px`, positionnement dans `#qcol`) en plus
de `.sift-seg` — seul le positionnement reste spécifique au site, jamais le
style de piste/pastille. `white-space:nowrap` ajouté à `.sift-seg-opt` pour
les libellés longs du Journal ("Session courante"/"Tout l'historique").
`.jrnl-qmode`/`.jrnl-qmode-btn` (CSS mort, 0 consommateur trouvé, à ne pas
confondre avec `.jrnl-mode`/`.jrnl-mode-btn` — vraiment utilisées, elles)
supprimé dans le même geste.

**Thumb glissant — Détail/Lot seulement (2026-07-08)** : le crossfade
couleur/fond par bouton (`.sift-seg-opt.on`, transition 150ms) ne montrait
pas clairement un déplacement d'un état à l'autre. Ajouté `.sift-seg-thumb`,
un élément unique positionné en absolu (`transform:translateX()` +
`width`, transition 180ms) qui glisse physiquement vers le bouton
sélectionné — mesuré via `offsetLeft`/`offsetWidth` dans `ensureReviewSeg()`
à chaque toggle. Porte le fond/bordure/ombre (`--shadow-panel-subtle`,
seule pastille du composant à avoir une ombre — voir grammaire de carte
"Flottante" plus haut, exception assumée ici pour l'effet de profondeur du
thumb) ; `.sift-seg-thumbed .sift-seg-opt.on{background:none;border:none}`
annule le style "boîte" par-bouton pour ne pas dupliquer visuellement le
thumb. **Réservé à Détail/Lot** : c'est le seul des 6 sites où les boutons
persistent entre les changements d'état (mutation `classList` en place,
pas de reconstruction `innerHTML`) — un thumb sur les 5 autres sites
n'aurait rien à glisser, ils reconstruisent leur contenu (et donc perdent
toute mesure de position) à chaque changement.

**Format (MP3/AIFF/WAV) migré vers `.sift-seg`, thumb ajouté au rail Détail
uniquement (2026-07-08)** : 2 sites trouvés, tous deux en `.chip`/`.chip.on`
(pas `.sift-seg-opt`) — rail Détail (`filing.ts` `renderFoot()`, id
`#sift-fmt-seg`) et rail batch (`sift-live.ts`, `formatBlock`). Rail Détail :
même chirurgie que Détail/Lot — `renderFoot()` appelait un rebuild complet
sur chaque clic de format (`state.target` puis `renderFoot(...)` à nouveau),
détruisant les chips à chaque fois ; converti en mutation `classList` en
place (`positionFmtThumb()`, même mesure `offsetLeft`/`offsetWidth`).
`.sift-chip-disabled` (opacity/cursor) reste un modifier générique, réutilisé
tel quel sur `.sift-seg-opt` pour AIFF/WAV désactivés en mode lossy (aucun
`data-fil`, jamais `.on`, thumb ignore l'option — `onEl` reste `null`).
**Rail batch non thumbé, volontairement** : son clic (`renderBatchRail(...)`)
reconstruit tout le rail batch pour d'autres raisons (compteurs de
sélection), pas seulement le format — isoler ça en mutation en place
demanderait une restructuration plus large, hors scope de cette demande ;
converti en `.sift-seg`/`.sift-seg-opt` pour la cohérence visuelle
uniquement, garde son crossfade par bouton. `.sift-fmt-chips` (CSS,
0 consommateur après migration) supprimé.

**Bug de contraste sombre trouvé et corrigé** : `--color-track` et
`--color-surface-raised` valaient la **même couleur exacte** en sombre
(`#46453F`) — la pastille sélectionnée (fond `surface-raised`) était
invisible sur sa piste (fond `track`), seule la couleur du texte la
distinguait. En clair les deux tokens sont bien distincts. Vérifié que
`--color-track` n'a que 2 consommateurs (`.sift-slider-rail`, `.sift-seg`)
avant de changer sa valeur globale — nouvelle valeur sombre `#34332E`,
distincte de `surface-raised`. `.sift-seg-opt.on:hover` ajouté explicitement
(au lieu de compter sur l'ordre des règles, `:hover`/`.on` ayant la même
spécificité) pour que la pastille sélectionnée garde son fond au survol.

**Sweep élargi à tous les éléments sélectionnables/survolables (même
session)** : `.fld` (lignes dossier/genre Bibliothèque + lignes de bin
filing) n'avait **aucun hover** — même bug que `.chip` corrigé le
2026-07-03 ("cliquable sans retour visuel"), corrigé avec `.fld.on:hover`
explicite en prime. `.lr.cur:hover` ajouté explicitement (même fragilité
de spécificité que `.sift-seg-opt`). `.sift-bgrp-box`/`.sift-src-swatch`
vérifiés sans bug — logique d'anneau de sélection différente, pas de fond
à harmoniser.

**Hover texte-seul + transition animée (2026-07-08, retour utilisateur)** :
`.sift-seg-opt:hover` ne pose plus de fond (`--color-row-active`) — juste
un changement de couleur de texte (`--color-text-primary`), plus proche du
hover de Claude ("le texte qui highlight, pas une case qui se superpose").
`transition:background .15s ease,color .15s ease` ajoutée. Piège trouvé en
l'implémentant : une transition CSS n'anime que si l'élément **persiste**
entre les deux états — `ensureReviewSeg()` (Détail/Lot) reconstruisait les
2 boutons via `innerHTML` à chaque changement, donc rien à animer malgré la
transition posée. Corrigé : les boutons ne sont créés qu'une fois, les
appels suivants font juste `classList.toggle("on", ...)` dessus. Apparence
faisait déjà ça (mutation en place) donc anime aussi. Format USB/Dossiers-
Genres/Session-Historique **ne changent pas** — ils reconstruisent tout un
bloc de contenu dépendant (avertissement exFAT, liste de facette, lignes de
session), pas juste la pastille ; la reconstruction y est légitime, pas un
bug, et animer la pastille seule demanderait une restructuration plus
profonde pour un gain faible (contrôles peu re-cliqués en boucle).

## Grammaire de carte — 2 rôles, jamais 3 (2026-07-08)

Suite à la vérification de la règle Apple HIG "Boxes"
(developer.apple.com/design/human-interface-guidelines/boxes) : un groupe de
contenu utilise une **bordure ou un fond teinté**, jamais une ombre — l'ombre
signale une vraie élévation en z (quelque chose qui flotte AU-DESSUS d'autre
chose), pas du contenu inline. Avant cette passe, 3 traitements coexistaient
sans règle (ombre seule, bordure seule, les deux) ; ramené à 2 rôles :

| Rôle | Classes | Sites |
|---|---|---|
| **Groupée** (bordure ou fond teinté, jamais d'ombre) | `.sift-ui-card`, `.sift-ui-card-soft` | Spectrogramme (`.sift-spectro-box`), rail d'action (`.sift-action-rail`), carte lecteur (`.sift-player-row`), éditeur filing (`.sift-fil-editor-margin`), colonne queue (`#qcol`), colonne queue Accueil (`#homequeue`), Réglages, Bibliothèque, Journal (`.jrnl-insp-card`, bordure corrigée 1px→0.5px) |
| **Flottante** (bordure + ombre, réservée aux vraies superpositions) | `.sift-report-overlay-card` | Modales (confirmation, formatage USB) — seul site qui garde une ombre |

**Harmonisation famille "queue" (2026-07-08)** : `#qcol` avait perdu sa
bordure lors d'une passe antérieure ("ajoute un cadre style pastille sans
bordure", fond teinté seul) tandis que `#homequeue` gardait la sienne, hors
scope de cette passe à l'époque — deux traitements divergents pour le même
rôle. Réunifiés : les 6 sites de la famille "queue"
(`.sift-spectro-box`/`.sift-action-rail`/`.sift-player-row`/
`.sift-fil-editor-margin`/`#qcol`/`#homequeue`) portent maintenant tous
`background:var(--color-background-queue)` + `border:0.5px solid
var(--color-border-tertiary)`, sans exception. `#qcol`/`#homequeue` partagent
désormais une seule règle CSS au lieu de deux déclarations séparées.

Une boîte n'entoure jamais un seul élément isolé (voir Cartes Réglages
ci-dessus) — un groupe implique plusieurs éléments liés, sinon c'est du
chrome sans fonction.

Contraste sombre atténué en même temps : `--color-border-tertiary` en sombre
`rgba(255,255,255,.12)` → `.09`, aligné sur la proportion du clair (`.09`
côté noir) — les bordures/filets fins étaient proportionnellement plus
marqués en sombre qu'en clair.

---

## Tokens globaux — adaptation tweakcn "ZFlow" (2026-07-08)

Suite au chantier audit-référence (Évaluation 19, `ressources-externes.md`) :
Antoine a demandé une adaptation intelligente du thème tweakcn "ZFlow" — technique
empruntée, valeurs propres à Sift, jamais un remplacement en bloc.

| Token | Avant | Après | Emprunt |
|---|---|---|---|
| `--shadow-panel-subtle`/`-toast`/`-overlay` | 1 couche `rgba(0,0,0,X)` | 2 couches (contact serré + diffusion large) | Technique ZFlow, couleurs/valeurs de base gardées |
| `--tracking-{normal,wide,wider,widest}` | littéraux `.01/.03/.05/.06em` dispersés sur 15 sites | tokens câblés sur les 14 occurrences qui recoupaient exactement (`.04/.08/.09/.1em`, un seul site chacun, laissés en littéral — même règle que l'audit radius 2026-07-03) | Concept d'échelle de tracking (ZFlow `tracking-*`), valeurs 100% Sift |
| `--border-radius-{sm,md,lg,pill}` | 4 valeurs indépendantes (4/6/10/999px) | dérivées par `calc()` d'une base unique `--border-radius-base` | Technique (base unique + `calc()`), deltas internes (base−6/base−4) gardés de Sift |
| `--border-radius-base` | — (n'existait pas) | `14px` (était `10px`/lg) | Valeur relevée sur demande explicite d'Antoine — plus arrondi |
| Couleurs `--color-*`/`--overlay-*`/`--color-hue-*` | hex/rgba | **mêmes couleurs**, reconverties en `oklch()` (script sRGB→OKLab→OKLCH, précis, pas à l'œil) | Notation seulement — zéro changement de teinte perçue |
| Police, palette de couleurs (teintes), échelle radius originale | — | **non touchés** | Contrediraient la palette Apple system colors (06/07), Outfit (marque) — décisions déjà validées, pas de gap trouvé |

Un bug de conversion trouvé et corrigé en cours de route : le script de
conversion OKLCH a d'abord altéré un commentaire de prose (`rgba(255,255,255,...)`
dans un texte explicatif, pas du CSS réel) — le regex alpha `[\d.]+` matchait
aussi une suite de points seuls. Repéré via `git diff` avant de continuer,
corrigé (`styles.css`, commentaire section "Neutral overlay tints").

Vérifié : `npx tsc --noEmit` clean, valeurs OKLCH parseées et résolues
correctement via un check navigateur (`getComputedStyle`, bascule clair/sombre,
`calc()` du radius résolu à 10px pour `md` comme attendu). Vérification
visuelle finale dans `tauri dev` par Antoine.

---

## Écran Accueil — audit référence canonique (2026-07-08)

Task 1 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.
Référence consultée : registre officiel shadcn (`new-york-v4`, MCP `shadcn`).

| Élément | Verdict | Détail |
|---|---|---|
| Scrollbar auto-hide | Conforme | Comparé à shadcn Scroll Area — écart (auto-hide vs toujours visible) volontaire, annoté par Antoine |
| Badge statut (`sm.color`→`sm.tone`) | **Corrigé** | Passé de fond neutre + texte teinté à fond réellement teinté par état (`sift-home-status-badge-{success,danger,info,neutral}`), réf. shadcn Badge "Custom Colors" |
| CTA "Revoir N →" / "+ Ajouter un dossier" | **Corrigé** | Fuite de hover : `button:hover{background:gris}` générique gagnait sur le fond inline teinté — classes dédiées (`sift-home-cta-revue`/`-add`) réaffirment le fond au survol |
| Checkbox "Surveiller ce dossier" | **Corrigé** | Aucune coche visible à l'état coché (ambigu), pas de clavier, `<div>` non focusable — coche `ti-check` ajoutée + `role="checkbox"`/`aria-checked` + Enter/Espace, réf. shadcn Checkbox |
| Nav rail (`.nv`) + lignes sources (`homerow`) | **Corrigé** | `<div>` sans `tabindex` ni `role` — accessibles au clavier maintenant (`installNavKeyboard()`, `chrome.ts`), réf. shadcn Sidebar. `app.js` (routage clic réel, non gated `inTauri` — voir `main.ts:6`) non modifié, le support clavier vient en supplément |
| Breadcrumb (`Accueil › {source}`) | **Corrigé** | `<div>` texte → `<nav aria-label="breadcrumb">` + `aria-current="page"`, réf. shadcn Breadcrumb — zéro changement visuel |
| Badge "With Spinner" | Différé | Pas de signal backend "scan en cours" sur `Source` (`shared/contracts.ts`) — primitive notée pour Task 2 (Revue, analyse/filing) et Task 4 (Journal, revert), où un vrai état async existe |

Vérifié : `npx tsc --noEmit` clean après chaque édit. Vérification visuelle
(clavier, hover, badge) dans `tauri dev` par Antoine.

---

## Écran Revue — audit référence canonique (2026-07-08/09)

Task 2 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.
Référence consultée : registre officiel shadcn (MCP `shadcn`).

| Élément | Verdict | Détail |
|---|---|---|
| `zoneToggleHtml` (Diagnostic/Métadonnées) | Conforme | `aria-expanded` déjà correct, réf. shadcn Collapsible |
| Badges verdict (`.sift-vchip`/`.sift-chip-badge`) | Conforme | Déjà le pattern Custom Colors (fond teinté), réf. shadcn Badge |
| Candidats Discogs (`sift-cand`) | Conforme | Vrais `<button>` + `<details>/<summary>` natif, accessible par défaut |
| Chips genre (`sift-genre-chip`) | Conforme | Display-only (pas cliquable), `<span>` correct |
| Sliders Volume/Tempo (`report-view.ts`) | **Corrigé** | Zéro `role="slider"`/`aria-valuenow` avant fix — drag-only, aucun clavier. Ajout `role="slider"` + `aria-valuemin/max/now` (tenus à jour en live) + flèches clavier (Volume ±5%, Tempo ±1%, Home/End), réf. shadcn Slider (Radix) |
| Toggle Key-lock | **Corrigé** | `<button>` déjà focusable mais sans `aria-pressed` — ajouté, synchronisé dans `refreshKey()` |
| Canvas spectrogramme | **Corrigé** | `role="img"` + `aria-label="Spectrogramme audio"` ajoutés (mineur) |
| Arbre de destination (`.fld`, `filing.ts`) | **Corrigé** | Même motif qu'Accueil : `<div data-fil="bin">` sans clavier — `tabindex`/`role="button"` ajoutés, `installNavKeyboard()` (chrome.ts) étendu pour couvrir `[data-fil="bin"]` |
| Overlay de confirmation (`confirm-modal.ts`) | **Corrigé** | Ni `role="alertdialog"`/`aria-modal`, ni focus déplacé à l'ouverture, ni Escape — seul le clic sur le fond annulait. Utilisée avant toute action destructive (règle CLAUDE.md anti-`window.confirm()`), donc corrigée en priorité : les 3 ajoutés, réf. shadcn Alert Dialog |
| Barre de progression (`.sift-pz-fill`, `progress-zone.ts`) | **Corrigé** | Aucun `role="progressbar"`/`aria-valuenow` — ajoutés, `aria-valuenow` mis à jour dans le fast-path de tick (pas seulement à la création de la ligne), réf. shadcn Progress |

Vérifié : `npx tsc --noEmit` clean après chaque édit. Vérification visuelle
(clavier sliders/arbre/modale, lecteur, spectrogramme) dans `tauri dev` par
Antoine restante.

---

## Écran Écartés — audit référence canonique (2026-07-09)

Task 3 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.
Écran compact, peu de composants — la plupart déjà conformes.

| Élément | Verdict | Détail |
|---|---|---|
| Boutons icône Restaurer/Corbeille (`.lk-icon`) | Conforme | Vrais `<button>`, `title`/`aria-label` déjà présents |
| Bouton Restaurer (corbeille) | Conforme | Texte visible + `title`, déjà focusable |
| Bouton Copier / Purger | Conforme | Vrais `<button>` |
| Chips raison (`sift-vchip`) / pills compteurs | Conforme | Display-only, `<span>` correct |
| Liens boutique (`ecStoreLinks`) | **Corrigé** | C'étaient des `<a data-ec="store">` **sans `href`** — non focusables, aucune activation clavier possible. Convertis en `<button>` (le handler délégué `sift-live.ts:2088` est agnostique du tag, `[data-ec]` générique) — cohérent avec le bouton "Copié" juste à côté |

Vérifié : `npx tsc --noEmit` clean. Vérification visuelle (clavier sur les
liens boutique) dans `tauri dev` par Antoine restante.

---

## Écran Journal — audit référence canonique (2026-07-09)

Task 4 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.
**Aucune divergence trouvée** — écran déjà conforme sur toute la ligne :
`<details>/<summary>` natif pour les catégories (FILÉS/JETÉS/REJETÉS,
accessible par défaut), vrais `<button>` partout (revert par ligne,
mass-revert, mode Session/Historique — déjà `.sift-seg` unifié le
2026-07-08), toasts déjà `aria-live="polite"`/`"assertive"`.

---

## Écran Bibliothèque — audit référence canonique (2026-07-09)

Task 5 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.

| Élément | Verdict | Détail |
|---|---|---|
| Facettes Dossiers/Genres (`.fld`, `data-bib="pick"`) | **Corrigé** | Même motif que partout ailleurs — `tabindex`/`role="button"` ajoutés, clavier via `installNavKeyboard()` étendu |
| Segmented Dossiers/Genres (`data-bib="facet"`) | **Corrigé** | `<span>` → `<button>` — incohérent avec le reste de l'app où `.sift-seg-opt` est toujours un vrai bouton |
| Chips filtre qualité (`.chip`, `qual`/`dupscan`) | **Corrigé** | `<span>` → `<button>` — `.chip` avait déjà ses propres `border`/`padding`/hover réaffirmé, zéro changement visuel attendu |
| Ligne de piste (`.lr`, `data-bib="row"`) | **Corrigé** | Ligne cliquable (ouvre le détail) sans `tabindex`/`role` — ajoutés. **Piège trouvé et corrigé avant application** : la ligne contient un vrai `<button>` (lecture) imbriqué — sans garde, Entrée sur ce bouton aurait aussi déclenché le clic de la ligne parente (double action : lire + ouvrir/fermer le détail). `installNavKeyboard()` ignore désormais tout `keydown` dont la cible est déjà un élément natif interactif (`button`/`a`/`input`/`select`/`textarea`) — protège rétroactivement Accueil/Revue aussi |
| Recherche (`#bibq`) + 5 champs éditeur (`library-detail.ts`) | **Corrigé** | Placeholder seul (pas une vraie étiquette accessible) — `aria-label` ajouté sur les 6, réf. shadcn Field |
| Boutons icône lien/identifier (`.lk-icon`) | Conforme | Déjà de vrais `<button>` avec `aria-label` |

Vérifié : `npx tsc --noEmit` clean. Vérification visuelle (clavier facettes/
lignes/chips, double-déclenchement sur le bouton lecture) dans `tauri dev`
par Antoine restante.

---

## Écrans Réglages + Rekordbox + Clé USB — audit référence canonique (2026-07-09)

Task 6 du chantier `docs/superpowers/changes/2026-07-08-ui-reference-audit/`.

| Élément | Verdict | Détail |
|---|---|---|
| Segmented Apparence (`data-theme-choice`) | **Corrigé (G1)** | `<span>` → `<button>` — incohérence habituelle |
| Mojibake USB ("amovibles�", "d�tect�") | **Corrigé** | Trouvé en passant (pas un audit-ref à proprement parler) — encodage cassé sur 2 messages d'état de `renderUsbList()`, restaurés (« … » et « détecté ») |
| Jeton Discogs, boutons dossier racine/USB | Conforme | Vrais `<button>`, toggle œil avec `aria-label` synchronisé |
| Carte statut Rekordbox + bannière drift | Conforme | Boutons réels, structure `Card`/`Alert` déjà correcte |
| Ligne sélection réparations master.db (`.bx-row`, `data-sift="mdbpick"`) | **Corrigé (G3)** | Ligne-checkbox (case interne `tabindex="-1"` volontaire) sans clavier — `tabindex`/`role="checkbox"`/`aria-checked` ajoutés, clavier via `installNavKeyboard()` étendu. Bouton "Ignorer" imbriqué déjà protégé par la garde anti-double-déclenchement (B1) |
| Boutons candidats/dédup/apply (`mdbresolve`, `mdbdismiss`, `mdbdedup`, `mdbapply`) | Conforme | Vrais `<button>` |
| Modale formatage USB (`usb-format-modal.ts`) | **Corrigé (G2)** | La seule action vraiment irréversible de toute l'app — n'avait **aucune** sémantique modale (pire que R5/confirm-modal.ts). Ajout `role="alertdialog"`/`aria-modal` + Escape (désactivé pendant `busy`, pour ne pas interrompre un formatage en cours) + segmented FAT32/exFAT `<span>`→`<button>`. Fuite corrigée au passage : le listener `keydown` global n'était retiré que sur Escape — consolidé en une seule fonction `close()` appelée aussi par Annuler et le succès du formatage |

Vérifié : `npx tsc --noEmit` clean. Vérification visuelle (clavier ligne
master.db, Escape modale USB pendant/hors formatage, segmented) dans
`tauri dev` par Antoine restante.

---

## Historique des corrections

**2026-07-05 (pochette réellement cassée + sélection multi Alt+Clic)** :
signalée via l'outil d'annotation, corrigée après reproduction en direct par
CDP (voir section Pochette/cover ci-dessus pour le détail). En parallèle,
l'outil d'annotation lui-même a gagné la sélection multi-éléments (répéter
Alt+Clic accumule au lieu de remplacer) pour porter le contexte de plusieurs
zones dans une seule note.

**2026-07-05 (refonte écran Revue + réconciliation des 2 maquettes)** : voir
section dédiée ci-dessus. `app.js` réactualisé et vérifié en direct
(preview_*, partage `frontend/styles.css` — mêmes classes réelles
réutilisées). `Sift.dc.html` réactualisé (nouvel état `metaOpen`, pattern
`openChip` suivi) mais **non vérifié par rendu** — ce format propriétaire a
besoin de React+ReactDOM injectés (l'éditeur Claude Design le fait, pas un
navigateur nu).

**2026-07-05 (chantier 3 prompts : CTA Accueil, lien rebuy, unification
drop↔rail)** : ajout du CTA « Revoir N → » (Accueil), du lien rebuy Beatport
(Revue, gated fake+identifié), et tokenisation du voile de dépôt
(`--overlay-drop`, remplace un `rgba` sombre codé en dur). 3 nouvelles entrées
composant ci-dessus. `tsc --noEmit` clean, vérifié live par CDP (vraie app
Tauri, token `--overlay-drop` résout). Audit `/impeccable audit filing.ts` :
15/20, mes ajouts propres (0 finding détecteur), findings a11y chips/arbre
pré-existants non traités (chantier `harden` séparé).

**2026-07-03, passe 1 (audit design-system, 6 bugs)** : `.sift-id-btn` (3e
teinte + dark), carte verdict (tokens), `.chip` (hover), sliders (hover/drag),
pochette (`alt`), `.cbx` (suppression code mort).

**2026-07-03, passe 2 (`/impeccable audit`, 4 findings)** : bordure latérale
`.sift-filed-banner`, `aria-label` titlebar (`chrome.ts`), transitions
`width`/`left`/`right` → `transform` (`.sift-pz-fill`, `.tog::after`), ombres
portées tokenisées.

**2026-07-03, passe 3 (`/design-system audit`)** : correction de dérive de
ligne (`.sift-pz-fill` 133-134 → 135-136, décalé par un ajout antérieur) ;
échelle hauteur (`--h-32`/`--h-44` supprimés — 0 lecteur —, `--h-36`/`--h-40`
câblés sur `.sift-play-btn`/`.jrnl-insp-revert`) ; échelle radius (`sm`/`pill`
ajoutés, câblés sur 10 sites où le littéral correspondait exactement) ;
`--text-hero` renommé `--text-2xl` (rôle "hero"/track-title jamais tenu,
seul usage réel = icône de repli `library-detail.ts:57`).

Vérification : `npx tsc --noEmit` clean après chaque passe. Composants CSS
purs (non gated `inTauri`) vérifiés par inspection de style calculé via
`preview_eval`. `chrome.ts` (gated) reste à confirmer visuellement dans
`tauri dev` — changement d'attribut seul, régression improbable mais non vue.

**Reste ouvert, priorité basse** : `.sift-time-elapsed` non tokenisé (mineur,
voir section ci-dessus).

**2026-07-06 (rollout palette Apple system colors, 11 tâches)** : danger et
info séparés en vraies teintes rouge/bleu (au lieu de partager l'ambre) ; 5
teintes catégorielles ajoutées (chips de genre, points de source) ; nav
(items + badges) recolorée ; bouton Identifier replié dans info (la 3ᵉ teinte
dorée documentée ci-dessus, section "Bouton Identifier", n'est donc plus
d'actualité — l'exception est levée, plus de 3ᵉ teinte du tout) ; couleur
« elapsed » de la waveform déplacée vers info (`--color-waveform-elapsed`,
`var(--color-text-info)`) ; 2 popovers (Destination, candidats Discogs) ont
gagné un fond flouté. Rationale complet, palette et mapping teinte-par-teinte :
`docs/superpowers/specs/2026-07-06-apple-system-colors-palette-design.md` —
non répété ici.

Vérification de cette passe (tâche finale du plan, sweep seulement) :
`npx tsc --noEmit` clean ; `cargo clippy --all-targets -- -D warnings` clean ;
`cargo test` 261/269 verts, les 8 échecs sont tous
`RekordboxRunning`/message équivalent — Rekordbox tournait réellement sur la
machine au moment du run (garde-fou process de M8 qui fonctionne comme prévu),
sans rapport avec le rollout couleurs ; grep sweep confirme `color-accent-identify`
et les anciens hex danger/ambre partagés (`#8f6318`/`#f2c274`) absents de
`frontend/`/`src-tauri/`.

**Trouvailles mineures non corrigées dans cette tâche (sweep documentaire
seulement, triage laissé à la revue finale de branche)** : un commentaire près
de `.nv-export-dot` (`styles.css`, section "Export (Rekordbox/Clé USB)") décrit
encore Rekordbox comme "pas construit"/point seul, périmé depuis que Rekordbox
a son propre item de nav avec icône colorée (tâche 7) ; un commentaire près de
`--color-waveform-elapsed` prétend encore que "le canvas reste sombre quel que
soit le thème, donc pas de variante sombre", plus exact depuis que ce token
est thème-aware (`var(--color-text-info)`, tâche 9 — voir juste au-dessus).

**2026-07-07 (M8 Tier 1 écran UI + bug `.lk`)** : section réparations
`master.db` livrée sur la page Rekordbox (voir plus haut). Bug réel trouvé
par capture d'écran (Antoine) sur la page Rekordbox non liée : `.lk` (bouton
icône 22×22 fixe) réutilisée pour des boutons texte, labels compressés et
qui se chevauchent avec le texte voisin. Corrigé : `.lk` → `.lk-icon` (4
vrais boutons icône-seule), boutons texte retombent sur `button{}` (voir
entrée dédiée ci-dessus).

**2026-07-10 (audit cohérence palette + interactions, `styles.css` + 8
fichiers frontend)** : demande initiale de vérif deltas de contraste, élargie
en 3 passes successives (retour utilisateur à chaque étape) :

1. **Contraste badges/chips** — les 8 tokens `--color-background-{info,
   danger,success,warning}` + `--color-hue-{indigo,purple,pink,teal}-bg`
   étaient en alpha sur fond variable ; mesuré jusqu'à 3.37:1 (échoue AA
   4.5:1) sur les cartes les plus sombres. Passés en couleurs pleines, même
   teinte, résolus à ~5:1 partout (clair + sombre).
2. **Pastille segmentée `--color-track` en sombre** — plus claire que son
   environnement (32.04% entre bg-primary 27.57% et bg-tertiary 31.64%) au
   lieu du neutre le plus sombre comme en clair. 3 itérations avec retour
   utilisateur (32.04%→22.5%→25%, puis unifié sur `var(--color-background-
   primary)` pour ne plus avoir de valeur séparée à retuner).
3. **Cohérence teinte/chroma des gris sombres** — 3 clusters de hue
   distincts (92°/99°/107°) au lieu d'une seule direction comme en clair ;
   unifiés sur H=77.5° (la teinte dominante du clair), chroma resserrée.
4. **3 couleurs codées en dur retrouvées** (violaient la règle "tokens
   obligatoires") : `.sift-wave-hover` (blanc fixe), `.sift-kbd-hint-id`
   (noir fixe, illisible en sombre — 1.38:1 mesuré), `--color-text-on-accent`
   (jamais défini, fallback `#fff` caché).
5. **Champs éditables incohérents** — `.sift-editor-input` (Revue/
   Bibliothèque) utilisait un fond plus CLAIR que sa carte (flotte) au lieu
   du renfoncement du champ Jeton Discogs (fond plus sombre) ; unifiés sur
   `--color-background-primary` partout. Bug de spécificité trouvé au passage
   : le champ Jeton avait son style inline dupliqué, empêchant le focus de
   s'appliquer — migré vers la classe partagée.
6. **Focus des inputs texte** — l'outline générique offset (2px + 1px offset)
   jugée trop dure au clic ; remplacée par un simple changement de couleur de
   bordure (pas de box-shadow ajouté — un premier essai avec halo a été jugé
   "2 bordures").
7. **Audit suite ("check tout")** : `::selection` totalement absent (bleu
   navigateur non thémé) → ajouté. Checkboxes natives ne matchaient AUCUNE
   règle focus (ni générique ni celle des inputs) — au moins une vraie case
   (`filing.ts`, toggle "Sur place") tombait sur l'outline navigateur brut ;
   règle dédiée ajoutée (1.5px, plus fine que le générique). 10 widgets de
   type checkbox recensés au total (6 natifs + 4 `role="checkbox"` custom) ;
   les boutons désactivés (4 patterns différents dans le fichier) vérifiés un
   par un, tous lisibles.
8. **Renommage terminologie "Ranger"→"Convertir"** (retour utilisateur,
   "englobe tout ce que fait le bouton") — 20 chaînes utilisateur dans 8
   fichiers frontend ; identifiants internes (`doRanger`, `data-fil="ranger"`,
   `.sift-ranger-btn`) volontairement inchangés.

2 régressions introduites puis trouvées par le même audit de cohérence avant
tout commit : `--overlay-wave-hover` posé seulement dans les 2 blocs sombres
(oublié en clair au moment de sa création) ; diff systématique des noms de
tokens entre les 3 blocs de thème confirmant qu'aucune autre asymétrie ne
subsiste. Tout vérifié en direct sur le vrai process Tauri (CDP, port 9222,
`Emulation.setFocusEmulationEnabled` pour que `:focus-visible` matche sous
automatisation) dans les deux thèmes, pas seulement lu dans le code.
