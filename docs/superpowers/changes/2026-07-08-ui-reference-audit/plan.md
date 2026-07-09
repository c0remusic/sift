# Audit UI contre références canoniques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (exécution inline recommandée ici : chaque tâche contient un gate de
> décision avec Antoine que des subagents ne peuvent pas tenir). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comparer chaque composant UI existant de Sift à sa référence
canonique (shadcn/ui, ui-thing, coss, Apple HIG), corriger les divergences
approuvées par Antoine, écran par écran.

**Architecture:** Aucun changement d'architecture — corrections chirurgicales
dans `frontend/styles.css` et les modules `frontend/*.ts` de chaque écran.
Chaque écran = une tâche livrable indépendamment, validée avant la suivante.

**Tech Stack:** vanilla TS + tokens CSS (`styles.css`), MCP `shadcn`
(`mcp__shadcn__*`), MCP `ui-thing` (`mcp__ui-thing__*`), skills
`coss`/`coss-particles`, WebFetch pour Apple HIG et 21st.dev.

## Global Constraints

- Jamais de dépendance installée depuis les références (`package.json` et
  `Cargo.toml` intacts) — lecture + portage manuel uniquement (CLAUDE.md,
  "Front — référence de design avant d'inventer").
- Chaque divergence est présentée à Antoine (tableau avant/après + source
  citée) **avant** application — jamais de correction silencieuse.
- Tokens obligatoires : toute valeur corrigée passe par les tokens
  `--color-*`/`--space-*`/`--text-*` existants de `styles.css:root` ; pas de
  littéral inline, pas de nouveau fichier de thème.
- Conventions CSS de CLAUDE.md inchangées (pas de side-stripe, animer
  `transform`/`opacity` seulement, réaffirmer `background` dans les `:hover`
  custom, comparer les valeurs résolues clair/sombre des paires de tokens).
- `npx tsc --noEmit` clean après chaque écran ; vérification visuelle finale
  par Antoine dans `tauri dev` (jamais le preview navigateur pour du code
  `inTauri` ; CDP port 9222 pour une mesure ponctuelle).
- Ne pas lancer `cargo test`/`clippy` (aucun code Rust touché, et un
  `tauri dev` peut tourner — mémoire `avoid-concurrent-cargo-tauri-dev`).
- Commits : lister les fichiers exacts, jamais `git add -A` (mémoire
  `feedback-plan-commit-steps-no-add-a`).
- `docs/design-system-states.md` : chaque entrée auditée gagne une ligne
  `Référence : <source> (audit 2026-07-08+)` — y compris verdict "conforme,
  rien à changer".

## Méthode commune (référencée par chaque tâche comme « les étapes A-F »)

Chaque tâche écran déroule exactement ceci :

- **A. Inventaire** — lister les éléments réellement rendus par l'écran en
  lisant son module `frontend/*.ts` et les sections correspondantes de
  `docs/design-system-states.md`. Sortie : liste élément → classe CSS →
  fichier:ligne.
- **B. Consultation des références** — pour chaque élément, interroger dans
  l'ordre : `mcp__shadcn__search_items_in_registries` puis
  `mcp__shadcn__view_items_in_registries` (structure/états du composant
  équivalent) ; `mcp__ui-thing__get-component` en complément (surtout Scroll
  Area, Sidebar, composants absents de shadcn) ; skill `coss` si les deux
  premiers ne couvrent pas ; WebFetch Apple HIG pour toute question
  macro (matériaux, élévation, couleur système). Un élément sans équivalent
  externe (waveform, spectrogramme, vinyle) est marqué « design
  propriétaire assumé » — on n'invente pas de référence.
- **C. Tableau de divergences** — colonnes : élément · état · valeur
  actuelle (fichier:ligne) · référence (valeur/comportement + source
  citée) · verdict proposé (conserver / corriger). Les entrées « conforme »
  apparaissent aussi (preuve que l'élément a été vérifié).
- **D. Gate Antoine** — présenter le tableau, attendre ses choix. Seules
  les lignes approuvées passent en correction.
- **E. Application + vérif** — appliquer les corrections approuvées
  (styles.css + module écran), `npx tsc --noEmit` clean, demander à Antoine
  de vérifier dans `tauri dev` (CDP si mesure nécessaire). Itérer jusqu'à
  validation visuelle.
- **F. Doc + commit** — mettre à jour `docs/design-system-states.md`
  (lignes Référence), committer les fichiers exacts touchés :
  `git add frontend/styles.css frontend/<module-écran>.ts docs/design-system-states.md`
  (ajuster à la liste réelle), message
  `style(audit-ref): écran <nom> aligné sur références canoniques`.

---

### Task 1: Écran Accueil (+ primitives globales exercées en premier ici)

**Files:**
- Modify: `frontend/styles.css` (sections scrollbar :97-107, nav `.nv`
  :106-116, `#homequeue`, CTA pill, `.sift-dz-on`)
- Modify: `frontend/home-sources.ts`
- Modify (si divergence titlebar) : `frontend/chrome.ts`
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: verdicts sur les primitives partagées (scrollbar, nav rail,
  titlebar, empty-state) — les tâches suivantes NE ré-auditent PAS ces
  primitives, elles réutilisent le verdict de cette tâche.

Périmètre d'inventaire attendu (à confirmer à l'étape A) : scrollbar
globale (première vraie cible — c'est le cas d'école de l'Évaluation 19,
référence : `Scroll Area` shadcn + ui-thing), nav rail `.nv`/badges
(référence : `Sidebar` shadcn/ui-thing), titlebar custom (référence : HIG
window chrome — macro, ne rouvrir que sur divergence claire), colonne
`#homequeue` + lignes sources + swatches `.sift-src-swatch` (références :
`Card`, `Item`, `Avatar`), CTA « Revoir N → » (référence : `Button` variant
pill/badge), zone de dépôt `.sift-dz-on` (référence : patterns drag-drop
HIG déjà actés — vérifier seulement les états), composant `empty-state.ts`
(référence : `Empty` shadcn).

- [x] **Étape A** — inventaire (méthode commune).
- [x] **Étape B** — consultation références (méthode commune).
- [x] **Étape C** — tableau de divergences (méthode commune).
- [x] **Étape D** — gate Antoine (méthode commune).
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev` (méthode commune).
- [x] **Étape F** — doc + commit (méthode commune) :

```bash
git add frontend/styles.css frontend/home-sources.ts docs/design-system-states.md
git commit -m "style(audit-ref): écran Accueil + primitives globales alignés sur références canoniques"
```

**Fait, commit `1373080`** (2026-07-08) — inclut aussi une adaptation du thème
tweakcn "ZFlow" demandée en cours de tâche (ombres 2 couches, échelle
tracking, radius `calc()`-dérivé base 14px, couleurs reconverties en OKLCH),
documentée séparément dans `docs/design-system-states.md` ("Tokens globaux —
adaptation tweakcn ZFlow"). Badge "With Spinner" différé à Task 2/4 (pas de
signal backend "en cours" sur Accueil).

### Task 2: Écran Revue

**Files:**
- Modify: `frontend/styles.css`
- Modify: `frontend/report-view.ts`, `frontend/filing.ts`,
  `frontend/sift-live.ts` (segmented Détail/Lot), `frontend/confirm-modal.ts`,
  `frontend/progress-zone.ts` (selon divergences)
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: verdicts primitives globales de Task 1 (scrollbar, nav — ne pas
  ré-auditer).
- Produces: verdicts sur les familles réutilisées ailleurs : lignes de
  liste `.qi` (Journal/Bibliothèque s'y comparent), `.sift-seg` (déjà
  unifié le 2026-07-08 — vérifier contre `Tabs`/`Toggle Group` shadcn),
  boutons de rail texte-seul, popover, chips.

Périmètre d'inventaire attendu : lignes `.qi` + recherche queue
(références : `Item`, `Input`, `Command`), segmented `.sift-seg` + thumb
(références : `Tabs` / `Toggle Group`), carte lecteur (cover `Avatar`/
`Aspect Ratio`, bouton play `Button` icon, sliders volume/tempo `Slider` —
comparer les états hover/drag), zones repliables Diagnostic/Métadonnées
(références : `Collapsible`/`Accordion`, badges `Badge`), carte verdict
(`Alert` + couleurs système HIG actées — macro), waveform/spectrogramme
(« design propriétaire assumé »), rail filing (`Button` variants,
`Popover` pour Destination, chips genre `Badge`/`Toggle Group`, lien rebuy
`Button` variant warning), candidats `.sift-cand` (`Command`/liste de
résultats), overlay de confirmation `confirm-modal.ts` (`Alert Dialog`),
zone de progression (`Progress`).

- [x] **Étape A** — inventaire.
- [x] **Étape B** — consultation références.
- [x] **Étape C** — tableau de divergences.
- [x] **Étape D** — gate Antoine.
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev`.
- [x] **Étape F** — doc + commit :

```bash
git add frontend/styles.css frontend/report-view.ts frontend/filing.ts docs/design-system-states.md
git commit -m "style(audit-ref): écran Revue aligné sur références canoniques"
```

**Fait, commit `a52832f`** (2026-07-08/09) — sliders (role/aria/clavier),
key-lock (aria-pressed), canvas spectrogramme (aria-label), arbre de
destination (clavier via installNavKeyboard étendu), overlay de confirmation
(alertdialog/focus/Escape — priorisé, gate anti-destructif), barre de
progression (progressbar/aria-valuenow). Vérification visuelle finale
(`tauri dev`) par Antoine restante.

### Task 3: Écran Écartés

**Files:**
- Modify: `frontend/styles.css`, `frontend/ecartes-view.ts`
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: verdicts lignes de liste et boutons icône (`.lk-icon`) de
  Tasks 1-2.
- Produces: verdict `.lk-icon` (Restaurer/Corbeille) réutilisé par
  Bibliothèque (lien Discogs).

Périmètre d'inventaire attendu : lignes écartées (référence : `Item` +
verdict `.qi` de Task 2), boutons icône `.lk-icon` (référence : `Button`
variant ghost/icon — vérifier taille 22×22 vs référence), sections
re-sourcer/corbeille (`Card` grammaire Boxes actée — macro), empty-state
(verdict Task 1).

- [x] **Étape A** — inventaire.
- [x] **Étape B** — consultation références.
- [x] **Étape C** — tableau de divergences.
- [x] **Étape D** — gate Antoine.
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev`.
- [x] **Étape F** — doc + commit :

```bash
git add frontend/styles.css frontend/ecartes-view.ts docs/design-system-states.md
git commit -m "style(audit-ref): écran Écartés aligné sur références canoniques"
```

**Fait, commit `63f348e`** (2026-07-09) — liens boutique `<a>` sans `href`
convertis en `<button>` (E1). Reste de l'écran déjà conforme. Vérification
visuelle finale (`tauri dev`) par Antoine restante.

### Task 4: Écran Journal

**Files:**
- Modify: `frontend/styles.css`, `frontend/journal.ts`
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: verdicts `.qi`/lignes (Task 2), `.sift-seg` (Task 2).
- Produces: verdict toasts (`.sift-toast`) — primitive partagée exercée à
  fond ici (référence : `Toast`/`Sonner` shadcn).

Périmètre d'inventaire attendu : lignes `.jrnl-qrow` (comparer au verdict
`.qi`), seg Session/Historique `.jrnl-mode` (verdict `.sift-seg` de
Task 2), badges catégorie `.jrnl-cat-badge` (`Badge`), inspecteur
`.jrnl-insp-card` + bouton revert (`Card` + `Button`), toasts + revert
(`Toast`/`Sonner` — états, durée, position).

- [x] **Étape A** — inventaire.
- [x] **Étape B** — consultation références.
- [x] **Étape C** — tableau de divergences.
- [x] **Étape D** — gate Antoine.
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev`.
- [x] **Étape F** — doc + commit :

```bash
git add frontend/styles.css frontend/journal.ts docs/design-system-states.md
git commit -m "style(audit-ref): écran Journal aligné sur références canoniques"
```

**Fait, commit `13de053`** (2026-07-09) — aucune divergence trouvée, écran
déjà conforme.

### Task 5: Écran Bibliothèque

**Files:**
- Modify: `frontend/styles.css`, `frontend/library-detail.ts`,
  `frontend/sift-live.ts` (facettes Dossiers/Genres)
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: verdicts lignes (Task 2), `.lk-icon` (Task 3), chips (Task 2).
- Produces: verdict dashboard/stats (si Charts shadcn pertinent — noté pour
  un chantier futur, pas d'implémentation de chart ici).

Périmètre d'inventaire attendu : lignes `.fld` dossiers/genres (référence :
`Sidebar`/tree + verdict hover 2026-07-08), chips `.chip` filtres
(`Badge`/`Toggle Group`), détail piste `library-detail.ts` (cover frame,
bouton « Voir la release », lien Discogs `.lk-icon`), section doublons,
dashboard Lot 4 (comparaison structurelle avec `Chart`/stat tiles shadcn —
verdict « noter pour futur », pas de refonte ici).

- [x] **Étape A** — inventaire.
- [x] **Étape B** — consultation références.
- [x] **Étape C** — tableau de divergences.
- [x] **Étape D** — gate Antoine.
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev`.
- [x] **Étape F** — doc + commit :

```bash
git add frontend/styles.css frontend/library-detail.ts frontend/sift-live.ts docs/design-system-states.md
git commit -m "style(audit-ref): écran Bibliothèque aligné sur références canoniques"
```

**Fait, commit `13de053`** (2026-07-09) — facettes/ligne (clavier),
segmented+chips (span→button), 6 champs (aria-label). Piège trouvé :
`.lr` imbrique un vrai bouton lecture — garde anti-double-déclenchement
ajoutée dans `installNavKeyboard()`. Dashboard/Charts noté hors scope
(chantier futur).

### Task 6: Écrans Réglages + Rekordbox + Clé USB (reste)

**Files:**
- Modify: `frontend/styles.css`, `frontend/sift-live.ts` (Réglages,
  Rekordbox), `frontend/usb-format-modal.ts`, `frontend/theme.ts` (si
  divergence toggle)
- Modify: `docs/design-system-states.md`

**Interfaces:**
- Consumes: tous les verdicts précédents (cartes, boutons, seg, badges,
  toasts, modal).
- Produces: clôture du catalogue — toutes les entrées de
  `design-system-states.md` portent une ligne Référence.

Périmètre d'inventaire attendu : Réglages — liste à filets
`.sift-settings-list` (grammaire Boxes actée — macro), toggle `.tog`
(référence : `Switch` shadcn — états hover/focus/disabled jamais déclarés,
divergence probable), seg Apparence (verdict Task 2), boutons
`.sift-settings-btn` + lien « Oublier » (`Button` variants). Rekordbox —
carte statut + bannière drift `.sift-dup-banner` (`Alert`), section
réparations (checkbox `.sift-batch-ck` → `Checkbox`, boutons Résoudre/
Ignorer → `Button`). Clé USB — modal formatage (`Dialog`/`Alert Dialog`),
seg FAT32/exFAT (verdict Task 2).

- [x] **Étape A** — inventaire.
- [x] **Étape B** — consultation références.
- [x] **Étape C** — tableau de divergences.
- [x] **Étape D** — gate Antoine.
- [x] **Étape E** — application + `npx tsc --noEmit` + validation `tauri dev`.
- [x] **Étape F** — doc + commit :

```bash
git add frontend/styles.css frontend/sift-live.ts frontend/usb-format-modal.ts docs/design-system-states.md
git commit -m "style(audit-ref): Réglages/Rekordbox/Clé USB alignés sur références canoniques"
```

**Fait, commit `b047966`** (2026-07-09) — segmented Apparence (span→button),
mojibake USB corrigé en passant, ligne master.db (clavier), modale
formatage USB (alertdialog/Escape/fuite listener corrigée — action la plus
critique de toute l'app, traitée en priorité).

### Task 7: Clôture du chantier

**Files:**
- Modify: `docs/INDEX.json` (entrées design.md/plan.md de ce chantier)
- Modify: `docs/design-system-states.md` (note d'en-tête : catalogue
  intégralement référencé)

**Interfaces:**
- Consumes: Tasks 1-6 terminées.
- Produces: chantier archivable (`docs/superpowers/changes/archive/`) à la
  prochaine session wrap-up.

- [x] **Étape 1** — vérifié différemment que prévu : le format réellement
  produit est une section « ## Écran X — audit référence canonique » par
  écran (table de verdicts), pas une ligne « Référence : » par entrée de
  composant comme envisagé au moment d'écrire ce plan — confirmé par
  `grep -n "^## Écran\|^## Tokens"` : les 8 écrans + le chantier tokens
  ZFlow y figurent tous.
- [x] **Étape 2** — entrées INDEX.json ajoutées (specs + plans).
- [x] **Étape 3** — commit final : voir commit qui suit celui-ci.

**Chantier terminé** (2026-07-08/09) — 8 écrans audités, ~25 divergences
trouvées et corrigées (dont 2 vraies actions destructrices priorisées :
overlay de confirmation R5 et modale de formatage USB G2), 2 fuites
mémoire corrigées en passant (listener USB, mojibake), une garde
anti-double-déclenchement clavier ajoutée à `installNavKeyboard()`
(protège rétroactivement toutes les lignes à bouton imbriqué). Vérification
visuelle finale par Antoine dans `tauri dev` restante sur l'ensemble.
