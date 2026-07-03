# Sift — Catalogue d'états des composants réels

> Source de vérité pour le portage design→code : liste, composant par composant,
> tous les états visuels **tels qu'ils existent déjà dans le vrai code**
> (`frontend/styles.css` + les fichiers `.ts` qui les rendent — jamais `app.js`,
> la maquette navigateur jetable, ni `Sift.dc.html`, qui a son propre vocabulaire
> de tokens et sa propre logique). Alimenté au fur et à mesure d'un audit
> composant-par-composant (méthode : cataloguer un à la fois, vérifier, avant de
> continuer — voir la conversation qui a lancé ce fichier, 2026-07-03).
>
> Usage : avant de porter un nouveau design, vérifier ici si le composant existe
> déjà et quels états il a réellement, plutôt que de re-déduire toute la logique
> depuis `Sift.dc.html`. Avant de déclarer un portage "fini", cocher chaque état
> listé contre une preuve fraîche (voir `sift-audit-fidelite-methode` en mémoire).
>
> `.interface-design/system.md` reste la source pour direction/ressenti/layout ;
> ce fichier est le complément état-par-état, plus étroit et plus à jour sur les
> valeurs exactes.

## Ligne de queue — `.qi` (`styles.css:130-135`)

| État | Sélecteur | Valeur (clair) | Valeur (sombre) |
|---|---|---|---|
| Normal | `.qi` | `color: var(--color-text-secondary)` (#5C554E) | #C9C2B7 |
| Hover | `.qi:hover` | `background: var(--color-row-active)` (#F3EFE9) | #413F38 |
| Sélectionnée | `.qi.cur` | `background: var(--color-row-active)` + `color: var(--color-text-primary)` + `font-weight:500` + liseré gauche `box-shadow:inset 2px 0 0 var(--overlay-bar)` | idem, overlay-bar sombre |
| Terminée | `.qi.done` | `color: var(--color-text-tertiary)` | #9C968D |

RAS — 4 états déclarés explicitement, cohérents.

## Item de navigation — `.nv` (`styles.css:93-103`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.nv` | `color: var(--color-text-tertiary)` |
| Hover | `.nv:hover` | `background: var(--color-nav-active)` |
| Actif | `.nv.on` | `background: var(--color-nav-active)` + `color: var(--color-text-primary)` + `font-weight:500` |
| Export (variante) | `.nv-export` / `:hover` | `opacity:.55` → `.85` |

RAS.

## Bouton d'action principal — `.sift-ranger-btn` (`styles.css:157`, `filing.ts:924`)

| État | Source | Valeur |
|---|---|---|
| Normal | `.sift-ranger-btn` | `background: var(--color-background-info)`, `color: var(--color-text-info)` |
| Hover | **hérité de `button:hover`** générique (`styles.css:203`), pas déclaré sur la classe | `background: var(--color-background-secondary)` |
| Disabled | **hérité de `button:disabled`** générique | `opacity:.4` |
| Focus | **hérité de `:focus-visible`** générique | outline 2px `var(--color-text-info)` |

⚠️ **À savoir avant tout portage** : aucun état au-delà du repos n'est déclaré sur
la classe elle-même — tout vient de la cascade sur l'élément `<button>` natif.
Un futur design montrant un hover différent du gris générique serait un vrai
changement à faire, pas un oubli à "ajouter".

## Chip/tag — `.chip` (`styles.css:189`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.chip` | `color: var(--color-text-secondary)`, bordure `var(--color-border-tertiary)` |
| Sélectionné | `.chip.on` | `background: var(--color-background-info)`, `color: var(--color-text-info)` |
| Disabled | `.sift-chip-disabled` (classe séparée, `styles.css:431`) | `opacity:.4;cursor:not-allowed` |
| **Hover** | ❌ **aucune règle** | — |

🔴 **TROU RÉEL (pas un héritage caché comme le bouton)** : `.chip` est rendu en
`<span>` (formats MP3/AIFF/WAV du rail de classement `filing.ts`, facettes
qualité/genre de la Bibliothèque `sift-live.ts`), donc n'hérite d'aucun style
`button`. Cliquable (`cursor:pointer`) mais **zéro retour visuel au survol**.
**Pas encore corrigé** — noté ici en attendant, voir décision de priorité.

## Case à cocher — `.cbx` (`styles.css:195-196`)

⚠️ **CODE MORT côté vraie app** — grep confirme aucun usage dans `sift-live.ts`,
`batch-tracklist.ts`, ou tout autre fichier réel ; seulement dans `app.js` (la
maquette navigateur jetable). Si un futur design montre une case à cocher, ne
pas supposer qu'elle existe déjà dans le vrai code — elle est à construire.

## Segmented control — `.sift-seg-opt` (`styles.css:529-531`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-seg-opt` | `color: var(--color-text-secondary)` |
| Hover | `.sift-seg-opt:hover` | `background: var(--color-row-active)` |
| Actif | `.sift-seg-opt.on` | `background: var(--color-surface-raised)` + `color: var(--color-text-primary)` |

RAS.

## Ligne de journal — `.jrnl-qrow` (`styles.css:548-558`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.jrnl-qrow` | — |
| Hover | `.jrnl-qrow:hover` | `background: var(--color-row-active)` |
| Sélectionnée | `.jrnl-qrow.on` | `background: var(--color-row-active)` + liseré gauche `.jrnl-qrow-bar{opacity:1}` (0 au repos) |

RAS — même famille visuelle que `.qi`, cohérent.

## Toggle switch — `.tog` (`styles.css:190`)

| État | Sélecteur | Valeur |
|---|---|---|
| On (défaut) | `.tog` | `background: var(--color-text-info)`, curseur à droite |
| Off | `.tog.off` | `background: var(--color-border-secondary)`, curseur à gauche |

Pas de hover/focus/disabled déclarés — à vérifier si c'est un manque ou un choix (composant discret, faible priorité).

## 🔴 Carte verdict — `.sift-verdict-card` (`styles.css:374`, `report-view.ts:258-270`) — PRIORITAIRE

Le cœur du produit (détection faux-lossless). Contrairement à tous les composants
ci-dessus, **la couleur de fond n'est pas en CSS** — elle est calculée en JS et
injectée en style inline :

```ts
const map = {
  ok:   [..., "var(--color-text-success)", "rgba(91,192,140,.2)"],
  fake: [..., "var(--color-text-danger)",  "rgba(226,104,94,.16)"],
  grey: [..., "var(--color-text-warning)", "rgba(221,166,63,.16)"],
} as const;
```

**Incohérence trouvée** : `styles.css` (commentaire ligne 9-10) documente une
décision explicite — *"--color-text-danger/--color-text-warning pointent tous
deux vers l'ambre... l'ancien 'danger' rouge fusionne avec 'doute'"* — donc plus
aucun rouge dans la palette. Mais le fond de la carte verdict pour `fake` (LE
verdict le plus important de l'app : fichier détecté faux-lossless) utilise
`rgba(226,104,94,.16)`, qui **est un rouge**, pas l'ambre attendu. Le texte (`fg`)
utilise bien le token ambre `var(--color-text-danger)`, mais le fond ne
correspond à aucun token de `styles.css` — ni `--color-background-danger`
(rgba(176,122,40,.14), ambre) ni `--color-background-warning` (même valeur). Les
trois valeurs `panelBg` (`ok`/`fake`/`grey`) sont des rgba à la main, différentes
des tokens `--color-background-success/danger/warning` déjà définis dans
`styles.css` pour le même usage.

**Pas encore corrigé** — c'est la trouvaille la plus significative de cet audit
(composant signature, contradiction avec une décision de palette déjà actée).
À traiter en priorité une fois l'audit terminé, ou avant si tu préfères.

---

## Ligne candidat (identification) — `.sift-cand` (`styles.css:215-219`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-cand` | bordure `var(--color-border-tertiary)` |
| Hover | `.sift-cand:hover` | bordure `var(--color-border-secondary)` uniquement — **pas de `background`** |
| Erreur | `.sift-cands-error` (posée en JS) | `color: var(--color-text-warning)` |

Pas un bug — juste noté : le hover ici est délibérément discret (bordure seule,
pas de fond), cohérent avec une liste de résultats de recherche. Différent
pattern des lignes `.qi`/`.jrnl-qrow` (fond au survol), à garder en tête pour ne
pas "corriger" par erreur vers l'uniformité lors d'un futur portage.

## Bouton Destination — `.sift-dest-btn` (`styles.css:148`, `filing.ts:917`)

Même famille que `.sift-ranger-btn` — vrai `<button>`, hérite hover/disabled/focus
du sélecteur générique. RAS.

## Sliders (volume, tempo) — `.sift-slider-*` (`styles.css:363-369`)

| État | Sélecteur | Valeur |
|---|---|---|
| Normal | `.sift-slider-thumb`/`-track`/`-fill` | statique, curseur `pointer` sur la track |
| Hover / actif (en train de glisser) | ❌ **aucune règle** | — |

🔴 **TROU** : le curseur (thumb) du volume et du tempo ne réagit visuellement ni
au survol ni pendant le drag — aucune classe d'état (`:hover`, `.dragging`, etc.)
n'existe. Pour un composant qu'on manipule activement à la souris, l'absence de
feedback est un vrai manque, pas un choix délibéré comme `.sift-cand`.

## Pochette / cover — `.sift-cover-frame` (`styles.css:345`, `report-view.ts:190-191`)

`<img class="sift-report-cover sift-player-cover" hidden alt="">` — **`alt=""`
en dur** sur une image de contenu réel (la pochette de l'album), pas une image
décorative. `alt=""` est correct pour du décoratif, pas pour une pochette qui
porte de l'information (identifie visuellement le morceau). Devrait être
`alt="Pochette — {artiste} – {titre}"` ou similaire, rempli dynamiquement.

## Boutons icon-only (lecture, lien Discogs) — vérifiés, RAS

`sift-play-btn` (`report-view.ts:208`) a `title` + `aria-label`. Lien Discogs
icon-only dans la Bibliothèque (`sift-live.ts:1139`) a `aria-label="Page
Discogs"`. Le bouton "Voir la release" (`library-detail.ts:70`) a du texte
visible, pas besoin d'`aria-label`. Le souci a11y noté historiquement dans
`docs/` (icon-only sans label) semble déjà corrigé sur ces trois — pas de
nouvelle action ici, juste confirmation par preuve.

## Barre de progression — `.pbar`/`.pfill` et `.sift-pz-fill` — RAS

`.sift-pz-row.error .sift-pz-fill` bascule vers `var(--color-text-danger)` en
cas d'erreur — cohérent avec les tokens, pas de valeur en dur ici contrairement
à la carte verdict.

## Popover Destination — `.sift-dest-popover` — RAS (scope limité)

Seul état géré en CSS : `[hidden]` (fermé). Pas de transition d'ouverture ni
d'état focus-trap dédié, mais rien qui contredise un token ou une décision
actée — pas classé bug, juste minimal.

---

## 🔴 Bouton Identifier — `.sift-id-btn` (`styles.css:225-227`) — 3e teinte non documentée

```css
/* [C1] Identifier primary button: gold fill, stands out as the first action */
.sift-id-btn{background:#FFdc82;border-color:rgba(0,0,0,.12);color:#1d1c1a;...}
.sift-id-btn:hover{background:#f0cc6a}
```

Même famille de problème que la carte verdict, mais plus direct : le
commentaire d'en-tête du fichier (`styles.css:6-7`) dit explicitement
*"Color = meaning only: green (ok/lossless), amber (doute/pending/erreur) —
PAS de 3e teinte, PAS d'accent décoratif."* Ce bouton est un **doré/jaune**,
une vraie 3e teinte, en dur, sans token — et **sans variante sombre du tout**
(aucune règle dans les blocs `@media (prefers-color-scheme:dark)` ni
`[data-theme="dark"]`). En mode sombre, il garde exactement les mêmes couleurs
qu'en mode clair, sans qu'on sache si c'est voulu ou oublié.

## Autres couleurs non tokenisées (audit complémentaire "tokens pour toutes les fonctions ?")

- `.sift-time-elapsed{color:#ff5500}` (`styles.css:360`) — orange en dur,
  horodatage sur la waveform, aucun token, aucune variante sombre.
- Overlays waveform/spectrogramme (`rgba(255,255,255,.6)`, fond `#000`,
  badges temps `rgba(0,0,0,.55)`) — **probablement volontaire** : ce canvas
  reste toujours sombre indépendamment du thème de l'app, comme un lecteur
  audio pro. Pas classé bug, juste noté pour ne pas le "corriger" à tort.
- Ombres portées (`.sift-toast`, `.sift-report-overlay-card`) — `rgba(0,0,0,
  .4/.5/.6)` en dur, faible priorité, discret dans les deux thèmes.
- `.tog::after`/`.cbx.on{color:#fff}` — blanc en dur sur pastille colorée,
  mineur.

---

## ✅ Bugs trouvés — corrigés (2026-07-03)

1. **✅ `.sift-id-btn` — 3e teinte non documentée, sans variante sombre** —
   tokenisé (`--color-accent-identify`/`-hover`/`-text`/`-border`), variante
   sombre ajoutée dans les deux blocs (`@media` + `[data-theme="dark"]`).
   Gardé comme exception documentée à la règle "2 couleurs sémantiques" (CTA
   de l'identification, pas un statut) plutôt que remplacé.
2. **✅ Carte verdict hors-tokens** — les 3 `panelBg` (`ok`/`fake`/`grey`)
   remplacés par `var(--color-background-success/danger/warning)`.
3. **✅ `.chip` sans hover** — `.chip:hover{background:var(--color-background-secondary)}`
   ajouté, + `.chip.on:hover` pour ne pas écraser l'état sélectionné.
4. **✅ Sliders sans état hover/drag** — `.sift-slider-track:hover` fait
   grossir le curseur (scale 1.15), `.dragging` (classe posée en JS au
   mousedown/mouseup dans `dragSlider()`, `report-view.ts`) l'agrandit plus
   (scale 1.3) + halo `box-shadow`.
5. **✅ `alt=""` sur la pochette** — `alt="Pochette — {nom du morceau}"`.
6. **✅ `.cbx` mort** — supprimé de `styles.css`.

Vérification : `npx tsc --noEmit` clean. **Reste à vérifier visuellement dans
`tauri dev`** (règle CLAUDE.md : ces fichiers ne s'exécutent pas dans le
navigateur/mockup) — hover chip, hover/drag sliders, bouton Identifier en
sombre, carte verdict fake.

Priorité suggérée : #1 et #2 (contredisent une règle déjà écrite dans le
fichier, composants importants) > #3 et #4 (vrais trous de feedback) > #5
(a11y mineur) > #6 (nettoyage).
