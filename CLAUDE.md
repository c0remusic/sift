# Sift — CLAUDE.md

> Repo à worktree unique : **`C:\dev\sift`**. Branche active : **`perf-mi-fixes`**,
> en avance sur `main`, qui n'a rien de son côté. Le dev repart de `main` pour un
> nouveau chantier.
> L'écart **ne se note pas, il se mesure** — un nombre écrit ici est faux dès le
> commit suivant, y compris celui qui le corrige (vécu le 2026-07-30 : « 51 »
> écrit, 52 une seconde plus tard). Commande :
> `git rev-list --left-right --count main...perf-mi-fixes`
> Le worktree `m6a-discogs` (M6a→M8) a été mergé dans `main` puis supprimé le
> 2026-07-18 — le dev repart désormais directement sur `main`. Même dépôt Git.
> Contexte projet complet : la skill **`sift`** le charge.

## Quoi
App desktop **Tauri v2** (Win+Mac), gratuite, de prépa de musique pour DJ : analyse
(détection faux lossless), dédoublonnage, identification, rangement.
Principe : « déplacer = encoder + ranger ».

## Langage partagé
Glossaire de domaine du projet : `CONTEXT.md` (racine). Le lire avant tout travail
qui manipule le vocabulaire métier ; le maintenir via le skill `interview`.

## Vision de travail — studio design-to-code 1:1
La maquette n'est pas une étape avant le produit : **l'app réelle est la surface
de design**. Toute évolution visuelle/UX se fait directement dans le code de
production (`frontend/*.ts` + `styles.css`), visible immédiatement via HMR dans
la fenêtre `tauri dev` — jamais dans une maquette parallèle à resynchroniser.
`app.js` reste un artefact d'exploration figé, mais **s'exécute réellement dans
Tauri**, importé
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

## Wireframe & tokens
Source de tokens canonique (à viser pour tout wireframe `interface-design`) :
`frontend/styles.css` (`:root` + override `:root[data-theme="dark"]` et media
`prefers-color-scheme:dark`, token-sync v3). _Éviter_ : `.interface-design/system.md`
(palette/typo périmées). Wireframes de feature → `docs/wireframes/<feature>.html`.

## Stack
Tauri v2 (Rust) · frontend Vite vanilla · **Symphonia** (décode analyse) + FFmpeg sidecar
bundlé (encode) · SQLite (`rusqlite`) · `rustfft` · `lofty` · `rusty-chromaprint` · `ureq`.
Lib = `sift_lib`. MSRV Rust **à re-mesurer** : `rust-toolchain.toml` épingle
1.96.0 depuis le 2026-07-28, donc plus personne ne compile à l'ancienne MSRV
déclarée (1.77.2) et rien ne la vérifie. Le chiffre ne sera rétabli qu'après un
build réel à la version visée.

## Commandes (Windows — npm via `cmd /c "npm …"`)
- Bootstrap : `npm ci` puis `npm run fetch-ffmpeg`
- Dev : `npm run tauri dev` (Vite 5173 + backend Rust)
- Build frontend : `npm run build` → `dist/`
- Build installeurs : `npm run tauri build` → `src-tauri/target/release/bundle/`
- Lint tokens design : `npm run lint:tokens` (détecte couleurs/z-index/spacing en dur qui contournent un token existant, `scripts/lint-tokens.mjs`)
- Storybook (doc visuelle des états UI, framework-agnostic `@storybook/html-vite` — pas de framework composant côté front) : `npm run storybook` (dev, port 6006) · `npm run build-storybook` (statique). Config `.storybook/`, stories `frontend/*.stories.ts`. Miroir vivant de `docs/design-system-states.md` (empty state, pattern erreur/warning, pastille segmentée) — ajouter une story quand on documente un nouvel état plutôt que d'étendre seulement le markdown.
- Tests Rust : `cargo test --manifest-path src-tauri/Cargo.toml`
  ⚠️ `src-tauri/fixtures/*` (audio .flac/.wav utilisés par `analysis::decode::tests`)
  est **gitignoré** — un checkout frais (nouveau clone ou worktree) ne les a pas
  et les tests decode échouent en `file not found`, pas un vrai bug. Les régénérer
  avec `node scripts/make-fixtures.mjs`; les deux anchors authentiques facultatives
  décrites dans `src-tauri/fixtures/README.md` restent à fournir manuellement.
- Lint : `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Type-check front : `npx tsc --noEmit`
- `scripts/cargo-isolated.sh` — lance `cargo` avec `CARGO_TARGET_DIR` isolé,
  évite de corrompre le cache incrémental d'un `tauri dev` concurrent (fan-out
  d'agents sur ce repo, cf. `.claude/rules/rust.md`).

## Outillage
Consulter `~/.claude/skills-view.md` (inventaire skills/agents) et
`.claude/rules/context-packs.md` (packs de contexte) avant toute tâche
substantielle. Overrides Sift :
- `ecc` est désactivé dans `.claude/settings.local.json`. Utiliser les fallbacks
  du registre, jamais une référence `ecc:*`.
- Rust : async/perf/unsafe ou
  review Rust spécialisée → **session principale + `.claude/rules/rust.md`** (module
  projet) ; audit/review → agent **`auditor`** (charge `rules/audit/rust.md` global
  + le module projet). Plus d'agent `rust-engineer` (rôle absorbé).
- Release : synchroniser les versions de `package.json`,
  `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json`, depuis `main`.
  Auto-update (2026-07-24, `docs/superpowers/changes/archive/2026-07-24-auto-update/design.md`) :
  après `git tag vX.Y.Z && git push --tags`, `release.yml` publie un
  **brouillon** de Release (`releaseDraft: true`) — Antoine doit le publier
  manuellement sur GitHub (Releases → Edit → Publish). Sans ce clic,
  `/releases/latest/` (l'endpoint dans `tauri.release.conf.json`) ne résout
  jamais un brouillon et l'auto-update ne trouve rien, silencieusement, pour
  toujours. Vérifié en conditions réelles sur `v0.0.1`/`v0.0.2`.
- UI existante : `impeccable`, puis `interface-design`. La palette/typo de
  `.interface-design/system.md` est périmée; l'app et `frontend/styles.css` priment.
- Nouveau chantier UI : `interface-design` ; ne pas régénérer les tokens existants.
- Review UI : `ui-review-before-merge` ; a11y/perf ponctuelle : `ui-ux-pro-max`
  (plugin actif, pas un dossier de `~/.claude/skills`).
- Ne jamais utiliser `design-taste-frontend` sur Sift.
- Gros refactor/nouvelle feature : `architect`. Refactor de `sift-live.ts` :
  `working-with-legacy-code` + `refactoring-patterns`, comportement couvert avant extraction.
- Délégation Codex : mission fermée, fichiers disjoints, commande de validation
  explicite et aucun Cargo concurrent avec `tauri dev`; détails dans le registre.

## Décisions techniques
`docs/ressources-externes.md` — **pas chargé automatiquement** (retiré du
`@import` le 2026-07-09 : le charger en entier gaspille du contexte). Utiliser
son sommaire en tête de fichier (ligne + gist par section/Évaluation) pour
cibler la bonne section via `Read offset=<L>`, plutôt que tout lire.

## États réels des composants (portage design→code)
`docs/design-system-states.md` — même règle, retiré du `@import` le 2026-07-09.
Sommaire en tête de fichier, cibler la section avant de lire.

## docs/ — liste blanche depuis le 2026-07-31 (issue #5)

`.gitignore` ignore le CONTENU de `docs/` et ne ré-autorise que ce qui fait
autorité : `install-non-signe.md` (lié depuis le README), `design-system-states.md`,
`ressources-externes.md`, `design-system/`, `skills/`, et le seul dossier
`superpowers/changes/` encore ouvert. Tout le reste — plans de jalons, specs,
revues, comptes rendus de session, captures, `INDEX.json` — reste **sur cette
machine** mais n'est plus suivi par git.

Conséquences, à connaître avant de citer un chemin sous `docs/` :
- Les références à `docs/superpowers/...` qui subsistent plus bas dans ce fichier
  restent valables ICI et introuvables dans un clone frais. Elles pointent des
  artefacts réels, non versionnés — ne pas les « réparer » en les supprimant, et
  ne pas les citer à un lecteur externe.
- L'historique git n'a pas été réécrit : tout reste récupérable par `git log --`.
- Un nouveau document sous `docs/` est ignoré PAR DÉFAUT. Pour en publier un, il
  faut ajouter sa négation au `.gitignore` dans le même geste — c'est voulu :
  la liste noire précédente laissait repasser tout fichier neuf, cause du problème.

## Index des documents docs/
`docs/INDEX.json` (local, non versionné) — À LIRE À LA DEMANDE (Read tool) quand tu cherches le statut
d'un chantier/plan spécifique, PAS importé automatiquement. L'import `@` qui
vivait ici collait tout le JSON dans le contexte de CHAQUE session, y compris
celles qui ne touchent jamais `docs/` : **71 378 octets mesurés le 2026-07-29**,
soit environ 18 000 tokens, et le fichier grossit à chaque doc ajouté —
recompter avant de citer ce chiffre. Retiré le 2026-07-29, même précédent que
`shaderlab/AGENTS.md:333`.

Catalogue de chaque document sous `docs/` (racine + `superpowers/*`), par
catégorie (`reference`/`specs`/`plans`/`reviews`) avec chemin/topic/résumé —
pour trouver un doc sans lister/grep `docs/`. Maintenu à la main : à chaque
nouveau document créé sous `docs/` (brainstorming/writing-plans/code-review
ou manuel), ajouter son entrée ici dans le même geste, pas en rattrapage
différé.

## Méthode
Détective (théorie → preuve → correctif), **fail fast**, **pas de fallback** silencieux,
changements chirurgicaux. Vérifier avant d'agir.

Garde-fous issus d'incidents réels, détails dans `docs/ressources-externes.md` :
- **Actions destructives/coûteuses** : jamais `window.confirm()`/`alert()`/
  `prompt()`. Utiliser une confirmation intégrée à l'app, armée et horodatée
  contre les doubles clics (voir `BATCH_CONFIRM_THRESHOLD` / `batchConfirmArmed`).
- **Systèmes live** : ne jamais écrire dans un vrai `master.db` Rekordbox sur la
  seule foi d'un rapport d'agent. Relire l'état indépendamment et vérifier le
  backup contre une référence propre juste avant l'écriture.
- **Tests réalistes** : un test qui seed un setting ou fichier de config doit
  passer par les mêmes validations et dispositions de fichiers que la production
  (voir `sift-m8-pioneer-dir-vs-linked-xml` et la section M8 du plan).
- **Debug UI** : après deux correctifs visuels/comportementaux infructueux,
  mesurer la vraie fenêtre `tauri dev` via CDP avant un troisième essai
  (`sift-cdp-webview2-verification`).

**Routage skills** : procédure complète (5 étapes) déjà posée dans
`~/.claude/CLAUDE.md` (RÈGLE IMPÉRATIVE, s'applique tous projets) — ne pas la
redupliquer ici. Spécifique à Sift : `docs/skills/sift-ui-design-governance.md`
pour le routage UI, `.claude/rules/rust.md` pour le routage Rust.

**Sizing / YAGNI+evidence / lisibilité** : mécaniques génériques dans
`~/.claude/CLAUDE.md` § Sizing (+ templates : skill `sizing-templates`, à invoquer) —
s'applique tous projets, voir
`docs/superpowers/specs/2026-07-08-agent-operating-model-design.md` pour le
détail de la décision) — classifier mini/normal/large avant tout fan-out
d'agents, gate de preuve avant d'inclure un item dans un artefact, checklist
lisibilité avant de livrer un `design.md`/`plan.md`. Sur Sift : veille/
décision = `docs/ressources-externes.md` (section "Écarté" = tranché ;
nouvelle section "Différé" = pas assez de preuve pour l'instant, avec
trigger de réouverture nommé — ne pas confondre les deux) ; packs de
contexte = `.claude/rules/context-packs.md`.
Nouveaux chantiers → `docs/superpowers/changes/<date>-<slug>/`
(`design.md`/`plan.md`/`review.md` dans un seul dossier) au lieu de
`specs/`+`plans/`+`reviews/` à plat — fichiers existants non migrés.

Ne pas recopier ici le catalogue du registre : si aucun verdict n'y correspond,
continuer sans inventer de skill.

## Structure frontend/ (état réel)
- `main.ts` — boot
- `app.js` — maquette navigateur (source de vérité UI initiale)
- `sift-live.ts` — point d'entrée wiring live (Tauri only) ; délègue aux modules ci-dessous
- `chrome.ts` — shell global (nav rail, routing écrans)
- `home-sources.ts` — écran Accueil (sources, watcher)
- `reglages-view.ts` — écran Réglages (Discogs, Bibliothèque, Apparence, Clé
  USB), extrait de `sift-live.ts` le 2026-07-09 (split god file)
- `bibliotheque-view.ts` — écran Bibliothèque (liste filée, facettes,
  doublons internes), extrait de `sift-live.ts` le 2026-07-09 (audit clean
  architecture) ; état `bibState`/`bibDup` exportés, mutés aussi depuis le
  handler de clic délégué de `sift-live.ts` (dispatch reste centralisé,
  comme `ecartes-view.ts`)
- `rekordbox-view.ts` — écran Rekordbox (statut lien XML, Tier 1/2/3
  master.db : réparations chemin, doublons playlist, synchro metadata),
  extrait de `sift-live.ts` le 2026-07-09. Depuis le 2026-07-13 (Phase 1
  tranche 1a), seul module dont le dispatch de clic (`handleRekordboxAction`,
  actions `rkbreexport`/`mdb*`/`mds*`/`mas*`) vit ici plutôt que dans le
  handler délégué de `sift-live.ts` — écart volontaire scopé à ce seul
  écran, `bibliotheque-view.ts`/`ecartes-view.ts` restent dispatch centralisé.
- `queue-panel.ts` — état + rendu file/sélection Revue (virtualisation,
  navigation clavier, recherche, bascule Détail/Lot), extrait de
  `sift-live.ts` le 2026-07-13 (Phase 1 tranche 1b)
- `batch-panel.ts` — état + rendu mode Lot (sélection, confirmation à deux
  clics, rail, filing par lot), extrait de `sift-live.ts` le 2026-07-13
  (Phase 1 tranche 1c)
- `ecartes-view.ts` — écran Écartés
- `report-view.ts` — écran Revue (son-d'abord, waveform, verdict)
- `filing.ts` — rail de classement, réduit à l'orchestration résiduelle après
  le split du 2026-07-20 (tech-debt audit F03, tranche 2 : 2150→538 lignes) :
  le sous-arbre de destination est dans `filing-bins.ts` (2026-07-15), le
  reste réparti dans les 5 fichiers `filing-*.ts` ci-dessous — voir
  `docs/superpowers/changes/archive/2026-07-20-filing-ts-split/design.md`.
- `filing-state.ts` — état partagé (`RevueState`), extrait de `filing.ts` le
  2026-07-20.
- `filing-toast.ts` — toast + `registerClearPaneHook`, extrait de `filing.ts`
  le 2026-07-20.
- `filing-preview.ts` — helpers nom/preview partagés, extrait de `filing.ts`
  le 2026-07-20.
- `filing-identify.ts` — identification Discogs + éditeur + apply-tags,
  extrait de `filing.ts` le 2026-07-20.
- `filing-actions.ts` — actions Ranger/Revert/Secondary, extrait de
  `filing.ts` le 2026-07-20.
- `filing-bins.ts` — arbre de destination (bacs, sélection, popover, mode
  batch), extrait de `filing.ts` le 2026-07-15 (Phase 1-style, injection de
  dépendance `registerOpenTrackPathGetter`/`registerDestChangeHook` pour
  éviter un cycle d'import statique avec `filing.ts`, même pattern que le
  split `sift-live.ts`)
- `confirm-modal.ts` — overlay de confirmation in-app partagé (remplace window.confirm())
- `batch-tracklist.ts` — tracklist batch (multi-sélection, barre de progression)
- `journal.ts` — journal d'actions post-batch (toasts, revert)
- `progress-zone.ts` — zone de progression encodage
- `library-detail.ts` — écran Bibliothèque (M6b)
- `library-views.ts` · `list-virtual.ts` — vues et virtualisation des listes Bibliothèque
- `identify-shared.ts` — UI partagée identification Discogs
- `genre-families.ts` — regroupement des genres
- `theme.ts` — mode sombre (prefers-color-scheme + override + persistance)
- `usb-format-modal.ts` — confirmation et progression du formatage USB
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
Fichiers plats (sauf `analysis/`, `metadata/` et `usb_format/`) :
- **`analysis/`** — `decode.rs` (Symphonia) · `mod.rs` · `dynamics.rs` · `peaks.rs` · `phase.rs` · `spectrum.rs` · `structure.rs` · `tags.rs` · `verdict.rs`
- **`metadata/`** — `mod.rs` · `discogs.rs` · `cover.rs`
- `lib.rs` · `main.rs` · `db.rs` · `settings.rs`
- `scanner.rs` · `watcher.rs` · `sources.rs` · `worker.rs` · `queue.rs`
- `filing.rs` · `actions.rs` · `encode.rs` · `naming.rs` · `tagging.rs`
- `dedup.rs` · `fingerprint.rs` · `ecartes.rs` · `library.rs` · `genres.rs`
- `ffmpeg.rs`
- `ipc.rs` · `ipc_filing.rs` · `ipc_identify.rs` · `ipc_library.rs` · `ipc_usb.rs`
- `rekordbox_xml.rs` · `rekordbox_masterdb.rs` — lecture/écriture Rekordbox
- `rekordbox_repairs.rs` — commandes IPC M8 Tier 1/2/3 (réparations chemin,
  dédup playlist, synchro metadata master.db), extrait de `ipc_library.rs`
  le 2026-07-09 (split god file)
- **`usb_format/`** — découverte, validation d'identité et formatage des supports USB
- `dev_locate.rs` · `dev_annotate.rs` — commandes dev-only (gated
  `cfg!(debug_assertions)`) pour l'outil d'annotation Alt+Clic : `locate_source`
  (grep source) et `save_annotation` (append `docs/annotations.jsonl`).
- `bench_volume.rs` — benchmark de volume (`#[cfg(test)] mod bench_volume`
  dans `lib.rs`, test-only, jamais dans le binaire de production) : mesure
  `list_filed`/`list_pending` à 15k/100k lignes synthétiques, `EXPLAIN QUERY
  PLAN`, proxy sérialisation JSON. Exécuté à la demande
  (`cargo test --release -- --ignored --nocapture`), jamais dans la suite
  normale. Voir `docs/superpowers/plans/2026-07-14-phase3-measurement-report.md`.

## Outils de dev annexes (`scripts/`, hors binaire de prod)
- `.claude/scripts/cdp.cjs` — inspecte la vraie fenêtre `tauri dev` via CDP
  (vérifie le code `inTauri` réel : eval/screenshot/click/open-track). Remplace
  l'ex-`scripts/cdp-inspect.mjs` (doublon, supprimé le 2026-07-20 — finding F15 de
  `docs/archive/TECH_DEBT_AUDIT.md`, archivé là le 2026-07-29).
- `scripts/decrypt-masterdb-debug.py` — décrypte une copie `master.db` Rekordbox
  en SQLite clair pour inspection ad-hoc (spike M8, port Python de
  `rekordbox_masterdb.rs`) ; dépend de PyCryptodome externe.
- `scripts/rekordbox-spike-helper.ps1` — **touche le VRAI dossier Pioneer.**
  `-Action backup|swap|restore|status` : sauvegarde le dossier réel, y bascule une
  copie de test, restaure — chaque étape vérifiée par SHA256, jamais sur parole.
  N'écrit jamais DANS `master.db`, il ne copie que des fichiers entiers ; toute
  mutation de contenu reste un script séparé, lancé sur la copie AVANT `swap`.
  Refuse `swap`/`restore` si Rekordbox tourne, même invariant que le moteur Rust.
  C'est le filet de tout futur spike sur la surface la plus risquée du projet —
  documenté ici plutôt que supprimé (tranché par Antoine le 2026-07-30, audit
  multi-passes SIMP-14). Avant de le lancer : relire l'état indépendamment et
  vérifier le backup contre une référence propre, cf. § Méthode « Systèmes live ».

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
tauri 2.11.3 (cli 2.11.4) · rusqlite 0.40 · symphonia 0.6.0 · rustfft 6.4.1 ·
lofty 0.24.0 · rusty-chromaprint 0.3.0 · notify-debouncer-full 0.7.0 · ureq 3.3.0
(cibles atteintes, référence pour le prochain audit `cargo outdated`).

Versions JS en usage (migration TypeScript 6 + Vite 5→8 faite le 2026-07-01,
4 commits, tsc + build + tauri dev verts) : typescript 6.0.3 · vite 8.1.5
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
  en un point unique. Modèle : `renderReglagesLive()` dans
  `frontend/reglages-view.ts`, wrapper unique `#sift-reglages-live`.

## Front — référence de design avant d'inventer (2026-07-08)

**Jamais de style/comportement UI "de mémoire d'entraînement" sans
traçabilité.** Avant tout nouvel élément sans exemple fourni, consulter une
référence réelle et citer laquelle a guidé la structure ou le comportement :
- micro-composants : `shadcn` MCP, `ui-thing` MCP, puis 21st.dev ;
- décisions desktop : Apple HIG ;
- référence fournie par Antoine : la lire directement, sans extrapoler.

Ces sources servent à étudier structure, variantes et états. Ne jamais les
installer dans `package.json`, copier leur palette, ni remplacer les tokens
canoniques de `frontend/styles.css`. Détails et sources écartées :
`docs/ressources-externes.md`, Évaluation 19.

## Front — CSS (conventions trouvées via audit Impeccable, 2026-07-03)
- Pas de `border-left`/`border-right` coloré comme accent sur une carte, ligne
  ou bannière. Utiliser un fond teinté existant.
- Animer `transform`/`opacity`, pas les propriétés qui recalculent le layout.
- Un état confirmé permanent reste neutre; colorer brièvement sa transition.
- CTA avec label descriptif : texte seul. Réserver l'icône aux informations
  sans équivalent textuel, comme un spinner.
- Un bouton qui redéfinit `background` doit le réaffirmer dans son `:hover`
  pour ne pas perdre face au `button:hover` générique.
- `.lk-icon` est réservé aux boutons icône-seule 22×22, jamais au texte.
- Comparer les valeurs résolues de deux tokens dans les thèmes clair et sombre.
- Toute édition de token doit rester cohérente dans `:root`, le bloc sombre
  système et `:root[data-theme="dark"]`.
- Avant qu'un `querySelector` dépende d'une classe CSS, vérifier sa présence
  dans le markup réellement rendu. Postmortems : `docs/ressources-externes.md`.

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

**Port squattable par un projet voisin (`.claude/learning-log.md` D8, reconfirmé
2026-07-24)** : sur cette machine, plusieurs projets Tauri/Vite peuvent tourner
en parallèle et se disputer un même port `--remote-debugging-port` fixe (9222
squatté 2 fois de suite un même soir, par un projet différent à chaque fois).
Avant de faire confiance à une session CDP (eval/screenshot), vérifier
`document.title` (ou `curl http://127.0.0.1:<port>/json` → `title`/`url`)
correspond bien à Sift — pas seulement qu'un endpoint répond. Si le titre ne
correspond pas, changer de port plutôt que router autour du conflit (ne jamais
tuer le process d'un autre projet pour libérer son port).
