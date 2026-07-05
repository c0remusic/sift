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
> Numéros de ligne vérifiés à jour le 2026-07-03 (après les fixes de cette
> session) — `styles.css` bouge vite, revérifier au grep si un doute.

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

## Cartes Réglages — `.sift-settings-card` (`styles.css:536-549`, structure `sift-live.ts` `renderReglagesLive()`)

| État | Sélecteur | Valeur |
|---|---|---|
| Carte | `.sift-settings-card` | fond `var(--color-background-secondary)`, bordure `var(--color-border-tertiary)` |
| Bouton (ex. "Changer…") | `.sift-settings-btn` | fond `var(--color-surface-raised)` |
| Bouton hover | `.sift-settings-btn:hover` | `filter:brightness(0.95)` |
| Lien "Oublier" | `.sift-settings-forget` | `color: var(--color-text-quaternary)` |
| Lien "Oublier" hover | `.sift-settings-forget:hover` | `color: var(--color-text-secondary)` |

**Structure DOM (corrigée 2026-07-04)** : `renderReglagesLive()` construit
plusieurs cartes (`Discogs` id `sift-reglages-discogs`, `Bibliothèque` id
`sift-reglages-bibliotheque`, `Apparence` id `sift-reglages-apparence`, et
tout futur ajout — ex. clé USB, M7) à l'intérieur d'un **wrapper unique**
`<div id="sift-reglages-live">`, retiré/recréé en un point avant chaque
re-render. Avant ce fix, chaque carte était un sibling direct de `#content`
et seule la 1ʳᵉ (Discogs) était nettoyée — un second appel (ex. via
"Changer…"/"Oublier" sur le dossier racine) dupliquait Bibliothèque/Apparence
et leurs listeners. **Toute nouvelle carte doit s'ajouter à l'intérieur de ce
wrapper**, pas comme sibling direct de `#content` — sinon le bug se
reproduit.

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

---

## Historique des corrections

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
