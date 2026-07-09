# Sift — CLAUDE.md

> Worktree **`dj-assistant-m6a`** (branche `m6a-discogs`, **dev actif**). L'autre
> worktree `../dj-assistant` = branche `main` (base stable). Même repo Git.
> Contexte projet complet : la skill **`sift`** le charge.

## Quoi
App desktop **Tauri v2** (Win+Mac), gratuite, de prépa de musique pour DJ : analyse
(détection faux lossless), dédoublonnage, identification, rangement.
Principe : « déplacer = encoder + ranger ».

## Vision de travail — studio design-to-code 1:1
La maquette n'est pas une étape avant le produit : **l'app réelle est la surface
de design**. Toute évolution visuelle/UX se fait directement dans le code de
production (`frontend/*.ts` + `styles.css`), visible immédiatement via HMR dans
la fenêtre `tauri dev` — jamais dans une maquette parallèle à resynchroniser
(`app.js` et `Sift.dc.html` sont des artefacts d'exploration figés, pas des
livrables — **mais `app.js` s'exécute réellement dans Tauri** aussi, importé
sans garde `inTauri` par `main.ts:6` ; il gère notamment le routage de clic
nav réel via `e.target.closest('[data-view]')`, découvert le 2026-07-09 en
ajoutant le support clavier — voir `installNavKeyboard()`, chrome.ts. Aucune
modification prévue dessus pour autant, juste ne pas supposer qu'il est
inerte en prod). Corollaires :
- **Ordre de réflexion** : besoin utilisateur → parcours → UX → UI → perf →
  code. Jamais l'inverse.
- **Sources de vérité design** : `frontend/styles.css` (`:root`, canonique
  unique des tokens depuis token-sync v3) + `docs/design-system-states.md`.
  Ne jamais créer de fichier de thème/design-system parallèle.
- **Stack assumé** : vanilla TS sans framework — les patterns React
  (hooks/stores/providers) ne s'appliquent pas ici, et une migration de
  framework est explicitement écartée (Évaluation 3, ressources-externes).
- Vérification, routage skills, conventions CSS : sections dédiées plus bas
  (Vérification UI, Outillage, Front — CSS) — règles non dupliquées ici.

## Stack
Tauri v2 (Rust) · frontend Vite vanilla · **Symphonia** (décode analyse) + FFmpeg sidecar
bundlé (encode) · SQLite (`rusqlite`) · `rustfft` · `lofty` · `rusty-chromaprint` · `ureq`.
Lib = `sift_lib`. MSRV Rust 1.77.2.

## Commandes (Windows — npm via `cmd /c "npm …"`)
- Dev : `npm run tauri dev` (Vite 5173 + backend Rust)
- Build installeurs : `npm run tauri build` → `src-tauri/target/release/bundle/`
- Tests Rust : `cargo test --manifest-path src-tauri/Cargo.toml`
  ⚠️ `src-tauri/fixtures/*` (audio .flac/.wav utilisés par `analysis::decode::tests`)
  est **gitignoré** — un nouveau worktree (ex. `dj-assistant-m7-usb`) ne les a pas
  et les tests decode échouent en `file not found`, pas un vrai bug. Copier les
  fichiers depuis un worktree qui les a déjà (`dj-assistant-m6a/src-tauri/fixtures/`).
- Lint : `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Type-check front : `npx tsc --noEmit`

## Outillage (skills/agent/plugin — déjà câblés, personnalisés Sift)
> `ecc` scopé OFF sur Sift depuis 2026-07-01 (`.claude/settings.local.json`, coût
> tokens ~250 skills pour un usage jamais confirmé ici) — toute référence `ecc:*`
> ci-dessous est indisponible ; utiliser le fallback indiqué.

- **rust-best-practices** (skill) → tout code Rust écrit/revu.
- **error-handling-patterns** (skill) → erreurs Rust/Tauri (`Result` + serde IPC, fail-fast ; retry réservé à Discogs/AcoustID).
- **release-skills** (skill) → release : bumper les **3** fichiers de version en synchro
  (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`), depuis `main`.
- **rust-engineer** (agent) → Rust pointu (async/perf/unsafe) ET fallback review/build
  Rust en général tant qu'`ecc` est off (pas de `ecc:rust-reviewer`/`ecc:rust-build-resolver` ici).
- **rust-analyzer-lsp** (plugin) → connecteur LSP `.rs` (rustup component, pas une skill).
- **Codex MCP** (`mcp__codex__codex`) → délégation de patchs Rust/TS fermés et bien
  scopés (erreur de build précise, refactor local d'un fichier) — règle générique et
  format de mission dans `~/.claude/CLAUDE.md` (Outillage universel). Sur Sift,
  toujours fournir la commande de validation adaptée (`cargo test --manifest-path
  src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
  -- -D warnings`, ou `npx tsc --noEmit`) et rappeler l'interdiction `cargo test`/`clippy`
  pendant un `tauri dev` actif (corrompt le cache incrémental, voir mémoire
  `avoid-concurrent-cargo-tauri-dev`). Toujours ajouter une ligne explicite dans
  le prompt de mission indiquant de sauter `docs/skills-registre.md`/tout
  `SKILL.md` — `AGENTS.md` porte la même règle de routage skills que ce fichier,
  et Codex la suit sinon, gonflant le coût en tokens pour rien sur une mission
  déjà scopée (voir `docs/ressources-externes.md`, Évaluation 16).
- Revue de code générale (hors Rust) : `code-review` natif (`/code-review`) au lieu de
  `ecc:code-reviewer`, indisponible sur Sift.
- a11y/WCAG : `ui-ux-pro-max` (Quick Reference) au lieu de `ecc:a11y-architect`,
  indisponible sur Sift.

### Outillage global additionnel (installé niveau utilisateur, dispo partout)

#### UI / Design — ordre de priorité strict
- **impeccable** (plugin) → priorité n°1 pour retouche/polish d'un écran existant.
  Register `product` (PRODUCT.md créé 30/06). `/impeccable critique|audit|polish …`.
- **interface-design** (skill) → priorité n°2 retouche. `.interface-design/system.md`
  est **PÉRIMÉ sur la palette/direction visuelle** depuis 2026-07-01 (dark
  "table du digger" remplacé par le clair gris chaud actuel, vert/ambre seulement)
  — ne pas s'y fier pour les couleurs. **Périmé aussi sur la typo** (audit
  `/design-system` 2026-07-03) : sa spec "track title 30/600" ne correspond à
  aucun layout actuel — vérifié, `--text-hero` (ex-token pour ce rôle) n'était
  utilisé nulle part comme titre, renommé `--text-2xl`. Espacement/radius/hauteur
  restent valides comme échelle déclarée, mais leur couverture réelle (quels
  tokens sont effectivement câblés vs juste déclarés) doit se vérifier au
  grep, pas se supposer. Source de vérité réelle = `frontend/styles.css`
  (`:root`) + `docs/design-system-states.md`.
- **design-flow** (skill) → priorité n°1 pour un **nouveau chantier UI** (nouveau
  screen, refonte significative). Orchestre en séquence : `grill-me` → `design-brief`
  → `information-architecture` → `design-tokens` → `brief-to-tasks` → `frontend-design`
  → `design-review`. Les 7 steps sont aussi invocables seules.
  ⚠️ NE PAS invoquer `design-tokens` sans vérifier `styles.css` — tokens déjà posés.
- **design-review** (skill) → audit post-implémentation systématique.
- **ui-ux-pro-max** (plugin) → Quick Reference (a11y/perf) ponctuelle UNIQUEMENT.
- **design-taste-frontend** → NE JAMAIS invoquer sur Sift (landing pages/marketing).
- **stitch-generate-design** / **enhance-prompt** / **stitch-loop** → exploration de
  directions visuelles via Google Stitch (génère HTML). Porter en vanilla TS manuellement.
  MCP `stitch` supprimé (down/inutilisable, 2026-07-01) — utiliser la skill web directement.
  `stitch::react-components` / `shadcn-ui` / `remotion` = hors scope Sift.

#### Backend / méthode
- **architect** (agent) → design d'archi avant gros refactor / nouvelle feature.
- **tech-debt-audit** (skill, `/tech-debt-audit`) → audit de dette sur tout le repo (Rust + TS).
- **working-with-legacy-code** / **refactoring-patterns** → pour D3 (split de
  sift-live.ts, ~942 lignes) : couvrir le god file de tests avant de le découper.

## Décisions techniques
`docs/ressources-externes.md` — **pas chargé automatiquement** (retiré du
`@import` le 2026-07-09, le fichier a grossi à 119 Ko : le charger en entier à
chaque session gaspillait du contexte pour rien la plupart du temps). Utiliser
son sommaire en tête de fichier (ligne + gist par section/Évaluation) pour
cibler la bonne section via `Read offset=<L>`, plutôt que tout lire.

## États réels des composants (portage design→code)
`docs/design-system-states.md` — même règle, retiré du `@import` le 2026-07-09
(64 Ko). Sommaire en tête de fichier, cibler la section avant de lire.

## Index des documents docs/
@docs/INDEX.json

Catalogue de chaque document sous `docs/` (racine + `superpowers/*`), par
catégorie (`reference`/`specs`/`plans`/`reviews`) avec chemin/topic/résumé —
pour trouver un doc sans lister/grep `docs/`. Maintenu à la main : à chaque
nouveau document créé sous `docs/` (brainstorming/writing-plans/code-review
ou manuel), ajouter son entrée ici dans le même geste, pas en rattrapage
différé.

## Méthode
Détective (théorie → preuve → correctif), **fail fast**, **pas de fallback** silencieux,
changements chirurgicaux. Vérifier avant d'agir.

**Jamais `window.confirm()`/`alert()`/`prompt()` comme garde-fou avant une action
destructive/coûteuse** (rangement de masse, suppression, écrasement) : vérifié le
2026-07-03 que `window.confirm()` peut ne pas bloquer un clic (notamment via un
outil d'automatisation) dans ce Tauri/WebView2 — un clic a traversé la boîte de
dialogue sans qu'elle s'affiche, déclenchant un vrai rangement de masse avant
qu'un Stop reprenne la main. Construire la confirmation dans l'UI de l'app
elle-même (ex. cycle armé/confirmé à deux clics, horodaté pour rejeter un
double-clic/évènement dupliqué — voir `sift-live.ts` : `BATCH_CONFIRM_THRESHOLD`
/ `batchConfirmArmed`).

**Jamais une écriture sur un système live (ex. `master.db` Rekordbox réel) sur
la seule foi d'un rapport d'agent d'arrière-plan** : relire l'état
indépendamment avant d'autoriser, et vérifier qu'un backup pris juste avant
est réellement propre (comparé à une référence connue) — pas juste "un `cp` a
été fait". Un agent d'arrière-plan issu d'une chaîne de délégation en cascade
a rapporté un fichier de test "stable" alors qu'il avait dérivé, et le backup
pris juste avant un swap sur le vrai `master.db` s'est révélé déjà contaminé
par une session antérieure jamais restaurée (voir Évaluation 14,
`docs/ressources-externes.md`).

**Après 2 tentatives de correctif visuel/comportemental restées en échec**
("toujours pas", "pareil") — mesurer en direct avant un 3e essai, pas deviner
plus fort la même chose. Pour Sift : CDP contre la vraie fenêtre `tauri dev`
(computed styles/rects via `Runtime.evaluate`, ou histogramme exact de pixels
via `getImageData` pour un bug de canvas/couleur) — voir mémoire
`sift-cdp-webview2-verification`. Constaté deux fois dans la même session
2026-07-06 (taille de deux toggles Revue, puis colormap du spectrogramme) :
deviner un correctif CSS/couleur sans mesurer d'abord a fait perdre plusieurs
rounds d'aller-retour, alors qu'une seule mesure directe a réglé chaque fois
le vrai problème du premier coup.

**Routage skills** : procédure complète (5 étapes) déjà posée dans
`~/.claude/CLAUDE.md` (RÈGLE IMPÉRATIVE, s'applique tous projets) — ne pas la
redupliquer ici. Spécifique à Sift : consulter `docs/skills-registre.md` (pas
un registre générique) pour le verdict par domaine.

**Sizing / YAGNI+evidence / lisibilité** : mécaniques génériques posées dans
`~/.claude/agent-operating-model.md` (s'applique tous projets, voir
`docs/superpowers/specs/2026-07-08-agent-operating-model-design.md` pour le
détail de la décision) — classifier mini/normal/large avant tout fan-out
d'agents, gate de preuve avant d'inclure un item dans un artefact, checklist
lisibilité avant de livrer un `design.md`/`plan.md`. Sur Sift : veille/
décision = `docs/ressources-externes.md` (section "Écarté" = tranché ;
nouvelle section "Différé" = pas assez de preuve pour l'instant, avec
trigger de réouverture nommé — ne pas confondre les deux) ; packs de
contexte = `docs/skills-registre.md`, section "Packs de contexte (sizing)".
Nouveaux chantiers → `docs/superpowers/changes/<date>-<slug>/`
(`design.md`/`plan.md`/`review.md` dans un seul dossier) au lieu de
`specs/`+`plans/`+`reviews/` à plat — fichiers existants non migrés.

Exemples de routage (non exhaustif, voir le registre complet) :
- Rust/backend → `rust-best-practices`, `error-handling-patterns`, `rust-engineer`.
- UI/design retouche/polish ou nouveau chantier → voir priorités et
  orchestration détaillées dans `Outillage → UI / Design` ci-dessus. JAMAIS
  `design-taste-frontend` / `redesign-existing-projects` / `gpt-taste` /
  `top-design` sur Sift.
- Exploration direction visuelle (prototype rapide) → `enhance-prompt` puis
  `stitch-generate-design` (génère HTML Stitch), puis porter en vanilla TS.
- Review post-implémentation → `design-review`.
- Refactor/legacy (ex: D3, split de sift-live.ts) → `working-with-legacy-code`,
  `refactoring-patterns`, `clean-code`, `software-design-philosophy`.
- Audit de dette → `tech-debt-audit` (manuel `/tech-debt-audit`).
- Planification d'une tâche non-triviale → `superpowers` (writing-plans, etc.) ou
  `feature-dev` (manuel `/feature-dev`) pour une feature précise avec questions
  de clarification.

## Structure frontend/ (état réel)
- `main.ts` — boot
- `app.js` — maquette navigateur (source de vérité UI initiale)
- `sift-live.ts` — point d'entrée wiring live (Tauri only) ; délègue aux modules ci-dessous
- `chrome.ts` — shell global (nav rail, routing écrans)
- `home-sources.ts` — écran Accueil (sources, watcher)
- `ecartes-view.ts` — écran Écartés
- `report-view.ts` — écran Revue (son-d'abord, waveform, verdict)
- `filing.ts` — rail de classement (destination, format, actions filer/écarter)
- `confirm-modal.ts` — overlay de confirmation in-app partagé (remplace window.confirm())
- `batch-tracklist.ts` — tracklist batch (multi-sélection, barre de progression)
- `journal.ts` — journal d'actions post-batch (toasts, revert)
- `progress-zone.ts` — zone de progression encodage
- `library-detail.ts` — écran Bibliothèque (M6b)
- `identify-shared.ts` — UI partagée identification Discogs
- `theme.ts` — mode sombre (prefers-color-scheme + override + persistance)
- `empty-state.ts` — composant partagé état vide (titre, note, lien retour)
- `dom.ts` — helpers DOM partagés
- `ipc.ts` — wrappers IPC Tauri typés
- `selftest.ts` — smoke tests IPC au démarrage
- `dev-inspector.ts` — outil dev-only (Alt+Clic) : cadre de sélection +
  localisation source + panneau d'annotation (note libre → envoi). Chargé
  seulement si `import.meta.env.DEV` (`main.ts`).
- `dev-annotate.ts` — dev-only : capture de contexte (styles calculés,
  ancêtres/frères, écran actif, localisation code) pour une annotation, envoyée
  via `save_annotation` → `docs/annotations.jsonl`. Voir la section Outillage.
- `styles.css` — tokens CSS + composants

## Structure src-tauri/src/ (état réel)
Fichiers plats (pas de sous-dossiers sauf `analysis/` et `metadata/`) :
- **`analysis/`** — `decode.rs` (Symphonia) · `mod.rs` · `dynamics.rs` · `peaks.rs` · `phase.rs` · `spectrum.rs` · `structure.rs` · `tags.rs` · `verdict.rs`
- **`metadata/`** — `mod.rs` · `discogs.rs` · `cover.rs`
- `lib.rs` · `main.rs` · `db.rs` · `settings.rs`
- `scanner.rs` · `watcher.rs` · `sources.rs` · `worker.rs` · `queue.rs`
- `filing.rs` · `actions.rs` · `encode.rs` · `naming.rs` · `tagging.rs`
- `dedup.rs` · `fingerprint.rs` · `ecartes.rs` · `library.rs` · `genres.rs`
- `ffmpeg.rs`
- `ipc.rs` · `ipc_filing.rs` · `ipc_identify.rs` · `ipc_library.rs`
- `dev_locate.rs` · `dev_annotate.rs` — commandes dev-only (gated
  `cfg!(debug_assertions)`) pour l'outil d'annotation Alt+Clic : `locate_source`
  (grep source) et `save_annotation` (append `docs/annotations.jsonl`).

## Audit des dépendances (versions à jour)

Vérifie que toutes les dépendances du projet sont à jour, sans rien casser et
sans update aveugle.

Méthode :
1. `cargo outdated` pour lister les crates en retard (installe-le si absent :
   `cargo install cargo-outdated`).
2. Classe chaque écart : patch/minor sans breaking → update sûr ; bump majeur
   (ex: ureq 2.x→3.x, symphonia 0.5→0.6) → STOP, signale sans toucher.
3. Pour tout bump majeur, changelog à jour via Context7 ou le repo, résume les
   breaking changes qui touchent réellement nos call sites — pas une liste générique.
4. `cargo update` crate par crate, chirurgicalement — jamais un update global.

Versions en usage (migration majeure faite le 2026-07-01, build + 173 tests verts) :
tauri 2.11.3 · rusqlite 0.40.1 · symphonia 0.6.0 · rustfft 6.4.1 ·
lofty 0.24.0 · rusty-chromaprint 0.3.0 · notify-debouncer-full 0.7.0 · ureq 3.3.0
(cibles atteintes, référence pour le prochain audit `cargo outdated`).

Versions JS en usage (migration TypeScript 6 + Vite 5→8 faite le 2026-07-01,
4 commits, tsc + build + tauri dev verts) : typescript 6.0.3 · vite 8.1.2
Méthode : un palier majeur = `npm i -D <pkg>@<major>` + Context7 (breaking changes
filtrés à notre config réelle) + validation build/dev + commit dédié.

Règles :
- fail-fast : si une crate ne build plus après update, pas de fallback ni de pin
  de contournement — remonte l'erreur exacte (fichier:ligne).
- surgical : un seul changement de version par étape, build + test entre chaque.
- ne jamais update une dep "parce qu'elle est en retard" sans validation préalable
  du risque de migration.

## Documentation lookups (Context7)

Avant d'écrire ou de modifier du code touchant une librairie externe, récupère sa
doc à jour via Context7 — ne jamais se fier à la mémoire d'entraînement pour une
API, une signature, un nom de feature ou une config de version.

Déclenche un lookup Context7 automatiquement, sans qu'on le demande, dès que :
- introduction/configuration d'une librairie (Tauri v2, rusqlite, Symphonia,
  rustfft, lofty, rusty-chromaprint, ureq, Vite, ou toute crate/package Ableton/Max)
- demande de setup, config ou exemple d'usage
- API dont la signature exacte ou le comportement de version compte
- erreur de build venant d'un mauvais usage d'API plausiblement périmé

Méthode :
1. Si l'ID n'est pas donné, le résoudre avec resolve-library-id.
2. En tâche longue avec contexte déjà chargé, spawn l'agent docs-researcher au lieu
   d'appeler l'outil inline — contexte séparé, ne sature pas.
3. Si le lookup échoue ou que la librairie n'est pas indexée, le dire explicitement
   (fail-fast) — ne pas deviner une API depuis la mémoire.

IDs connus (à confirmer à la résolution, ne pas inventer) :
/tauri-apps/tauri · /rusqlite/rusqlite · /algesten/ureq

## Front — événements répétés
- Renderer déclenché par un événement en rafale (progress, watcher, scroll, resize) :
  **créer les nœuds une fois, muter ensuite**. Jamais d'`innerHTML =` dans un handler
  appelé en boucle (sature le thread UI → feedback noyé, bug invisible à la lecture).
- En écrivant un handler sur événement, **nommer la fréquence supposée** de l'événement,
  pour que le risque de saturation soit visible à la revue, pas découvert au runtime.
- Bon exemple déjà en place : `progress-zone.ts` compare l'état précédent/nouveau et
  n'écrit que les deux valeurs qui bougent (pas de reconstruction DOM) sur l'événement
  de progression encodage — modèle à suivre pour tout futur handler à haute fréquence.
- Un `render*()` qui ajoute **plusieurs blocs siblings** à `#content` (ex.
  plusieurs cartes) doit les envelopper dans **un seul wrapper** retiré/recréé
  en un point unique — jamais un `document.getElementById(id)?.remove()` par
  bloc. Bug réel trouvé le 2026-07-04 dans `renderReglagesLive()`
  (`sift-live.ts`) : seul le 1er bloc (Discogs) était nettoyé au re-render,
  Bibliothèque/Apparence dupliquaient carte + listeners à chaque appel
  (`sift-live.ts:995`/`1007`, déclenché par "Changer…"/"Oublier"). Corrigé en
  enveloppant les cartes dans un `wrap` unique (`id="sift-reglages-live"`).

## Front — référence de design avant d'inventer (2026-07-08)

**Jamais de style/comportement UI "de mémoire d'entraînement" sans traçabilité**
quand aucune référence n'est donnée. Root-causé le 2026-07-08 (voir
`docs/ressources-externes.md`, Évaluation 19) : la scrollbar de Sift
(`styles.css:97-107`, commit `a3d4ed9`) n'a aucune source citée — produite
comme une moyenne statistique de patterns vus à l'entraînement, jamais
vérifiée contre une vraie référence. Même mécanisme derrière les
divergences audit-après-coup (segmented control réimplémenté 4 fois avant
unification, `.lk` mal réutilisée pour du texte).

**Règle** : avant tout nouvel élément UI sans exemple donné par Antoine,
consulter activement un des pools de référence ci-dessous (outil dédié si
installé, sinon WebFetch) plutôt que générer sans vérifier. Si Antoine
fournit lui-même un lien/repo précis, le lire directement (WebFetch) plutôt
que deviner depuis sa description verbale — c'est la même règle appliquée à
une référence qu'il fournit.

- **Micro-composant** (comment un toggle/popover/scrollbar se comporte à
  l'état hover/focus/disabled) :
  - [ui.shadcn.com](https://ui.shadcn.com/) (référence principale, la mieux
    documentée par composant) — **MCP `shadcn` installé** (`.mcp.json`,
    2026-07-08), l'utiliser en priorité (search/get_item/install_command)
    plutôt que WebFetch quand disponible.
  - [uithing.com/components](https://uithing.com/components) (Vue, 96
    composants — Scroll Area/Sidebar utiles) — **MCP `ui-thing` installé**
    (`.mcp.json`), idem, priorité sur WebFetch.
  - [coss.com/ui](https://coss.com/ui) (React/Base UI, 492 composants) —
    **skills `coss`/`coss-particles` installées** (`.agents/skills/`,
    gitignoré, à réinstaller par worktree via `npx skills add
    cosscom/coss`) — invoquer la skill plutôt que WebFetch.
  - [21st.dev](https://21st.dev/) (catalogue communautaire, plusieurs
    variantes par composant) — pas d'outil dédié, WebFetch direct.
- **Macro-décision desktop** (matériaux/vibrancy, élévation, couleur
  système) : [Apple HIG](https://developer.apple.com/design/human-interface-guidelines)
  — déjà la source des décisions actées (grammaire de carte Boxes,
  couleurs système, titlebar), pas d'outil dédié, WebFetch direct.

**Jamais installées comme dépendance** — ces sources sont lues et portées à
la main en vanilla TS/CSS avec les tokens déjà en place dans `styles.css`,
jamais ajoutées à `package.json`. Ne PAS copier la palette/l'échelle par
défaut de shadcn en bloc (elle-même se présente comme un point de départ à
recolorer, pas une direction assumée) — Sift a déjà sa propre palette
validée (Apple system colors, 2026-07-06) ; seule la **structure**
(props/variants/états documentés) a de la valeur à porter, pas les valeurs
littérales, sauf pour un composant que Sift n'a encore jamais construit (là,
partir du chiffre shadcn comme brouillon est acceptable).

Sites tiers non officiels/payants écartés (vérifiés, voir Évaluation 19) :
`shadcn.io` (Pro 19$/mois, CLI-only), `shadcndesign.com` (kit Figma payant,
pipeline Claude Design déjà abandonné), ports Flutter de shadcn (hors
scope, Flutter écarté en Évaluation 19).

## Front — CSS (conventions trouvées via audit Impeccable, 2026-07-03)
- **Jamais de `border-left`/`border-right` coloré comme accent** (side-stripe) sur
  carte/ligne/bannière — ban explicite Impeccable, tell reconnaissable d'UI générée
  par IA. Utiliser un fond teinté (déjà le pattern `--color-background-*`) à la place.
- **Animer `transform`/`opacity`, jamais `width`/`height`/`left`/`right`/`padding`/
  `margin`** — ces propriétés déclenchent un recalcul de layout à chaque frame.
  Barre de progression → `transform:scaleX()` + `transform-origin`, pas `width`.
  Curseur qui se déplace → `transform:translateX()`, pas `left`/`right`.
- **Un état confirmé/permanent reste neutre ; seule la transition qui y mène est
  colorée/animée.** Vu 3 fois en session (badge CDJ, sélection de candidat
  Discogs, CTA Discogs) : un aplat vert/doré permanent une fois l'action faite
  lit comme trop appuyé. Un flash bref (~0.6-0.7s) au moment de la confirmation,
  puis retour à un état neutre (`--overlay-selected`, `--color-surface-raised`)
  est le bon pattern — pas une couleur sémantique qui reste allumée
  indéfiniment pour signaler "c'est fait".
- **Boutons de rail/CTA (Ranger, Jeter, Confirmer, Enregistrer, Supprimer…) :
  texte seul, jamais d'icône décorative à côté d'un label déjà descriptif**
  (retour utilisateur 2026-07-06). L'icône n'ajoute rien quand le texte dit
  déjà l'action — réservé aux cas où le glyphe porte une info sans équivalent
  textuel (ex. spinner de chargement). Ne pas confondre avec la règle
  icon-only de `ressources-externes.md` (celle-là interdit l'inverse : une
  icône SANS aucun texte).
- **Un composant bouton qui redéfinit `background` doit le réaffirmer dans
  son propre `:hover`** — sinon le `button:hover{background:...}` générique
  (spécificité élément+pseudo-classe) bat la règle de base de la classe custom
  (spécificité classe seule) dès que la souris survole, même si la classe
  custom a sa propre règle `:hover` pour une AUTRE propriété (ex. `filter`).
  Bug réel trouvé le 2026-07-06 : `.sift-play-btn:hover{filter:...}` ne
  touchait pas `background`, donc le bouton lecture redevenait silencieusement
  la couleur de sa propre carte au survol (disparition visuelle). Toujours
  réaffirmer explicitement toute propriété de base qu'un `:hover` custom ne
  doit PAS perdre face au `button:hover` générique.
- **`.lk-icon` = bouton icône-seule (22×22 fixe, centré), jamais de texte
  dedans.** Bug réel trouvé le 2026-07-07 (capture d'écran, page Rekordbox
  non liée) : `.lk` (nom d'origine) était réutilisée pour des boutons texte
  ("Réexporter maintenant", "Lier un fichier XML Rekordbox"…), compressant le
  label dans la boîte fixe et le faisant déborder/chevaucher le contenu
  voisin. Renommée `.lk-icon`, réservée aux 4 vrais boutons icône (lien
  Discogs, Identifier, Restaurer/Corbeille Écartés). Un bouton avec label
  texte n'a besoin d'aucune classe — le reset `button{}` de base (bordure,
  padding, hover) suffit déjà.
- **Avant d'utiliser 2 tokens de couleur ensemble pour distinguer un état
  (ex. fond de piste vs fond d'élément sélectionné), vérifier qu'ils ne
  résolvent pas à la même valeur en sombre.** Les deux peuvent être bien
  distincts en clair et identiques en sombre sans que ça saute aux yeux à la
  lecture du CSS — comparer les VALEURS résolues des deux blocs `:root`, pas
  juste supposer que des noms de tokens différents impliquent des couleurs
  différentes. Bug réel trouvé le 2026-07-08 : `--color-track` et
  `--color-surface-raised` valaient exactement `#46453F` en sombre (bien
  distincts en clair), rendant une pastille sélectionnée invisible sur sa
  propre piste.

## Vérification UI — app réelle, pas la maquette navigateur

`sift-live.ts` / `filing.ts` / `report-view.ts` / `ecartes-view.ts` /
`library-detail.ts` (et globalement tout ce qui touche l'IPC Tauri) ne
s'exécutent QUE dans le vrai shell Tauri (`main.ts` : `if (inTauri) {
installLiveWiring(); ... }`, testé via `__TAURI_INTERNALS__`). Le serveur vite
dev ouvert dans un navigateur classique (`preview_start`/`preview_*`) ne fait
tourner que la maquette statique `app.js` — ces fichiers n'y sont jamais
exercés, quelles que soient les captures qui en sortent.

**Défaut : Antoine regarde lui-même la fenêtre `tauri dev` (HMR, retour
instantané, zéro coût)** — ne pas driver l'app à sa place. `computer-use` est
écarté par défaut (coût token, décision confirmée le 2026-07-03, voir mémoire
`prefer-ask-user-to-test-over-computeruse`) ; un screenshot ponctuel via
`claude-in-chrome` reste acceptable pour un point précis, jamais une session
interactive complète. Les outils `preview_*` restent valables seulement pour
ce qui est strictement dans la maquette (ex. une chaîne statique de `app.js`)
— vérifier si le code touché est dans un bloc `if (inTauri)` avant de faire
confiance à une vérification par preview navigateur.

**Alternative validée (2026-07-05, voir `docs/ressources-externes.md`
Évaluation 11)** : `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
au lancement de `tauri dev` expose un endpoint CDP standard sur la vraie
fenêtre WebView2 — Claude peut alors inspecter/screenshot le code `inTauri`
réel par WebSocket (Node natif, zéro dépendance), sans `computer-use` ni
`claude-in-chrome`. Reste ponctuel (2-3 appels ciblés), jamais une session
interactive complète — le défaut reste qu'Antoine regarde sa fenêtre. **Ne
JAMAIS** poser ce port via l'option de config `additionalBrowserArgs` de
`tauri.conf.json` : elle s'appliquerait aussi aux builds de prod distribués
(fuite du port de debug) et écrase les arguments par défaut de wry sans
qu'on les refournisse — toujours passer par la variable d'environnement au
lancement de la commande dev.
