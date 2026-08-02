# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Repo à worktree unique : **`C:\dev\sift`**. Le dev se fait **directement sur `main`**
> (app non publiée, pas de branche de release à protéger) — pas de branche de chantier
> par défaut. L'écart de branche **ne se note pas, il se mesure** — un nombre écrit ici
> est faux dès le commit suivant : `git rev-list --left-right --count main...<branche>`.

## Quoi

App desktop **Tauri v2** (Windows + macOS), gratuite, de prépa de musique pour DJ :
analyse (détection de faux lossless au spectrogramme), dédoublonnage, identification
Discogs, rangement, export Rekordbox (XML + écriture directe `master.db`), formatage
clé USB. Principe : « déplacer = encoder + ranger ».

État des jalons (M0→M8, tous livrés) : `README.md`.
Glossaire de domaine : `CONTEXT.md` — le lire avant tout travail qui manipule le
vocabulaire métier.

## Stack

Tauri v2 (Rust, crate lib = **`sift_lib`**) · frontend **Vite + TypeScript vanilla,
sans framework** · **Symphonia** (décodage analyse, in-process) + **FFmpeg sidecar**
bundlé (encodage) · **SQLite** (`rusqlite`, bundled) · `rustfft` · `lofty` ·
`rusty-chromaprint` · `ureq` · `wavesurfer.js` v7 (lecture/waveform) · `fatfs`
(écriture FAT32 au-delà du plafond de 32 Go de Windows — **MIT**, choisi contre
`fat32format` qui est GPL, incompatible avec une distribution commerciale).

Les patterns React (hooks/stores/providers) **ne s'appliquent pas ici**, et une
migration de framework est explicitement écartée.

**Toolchain Rust : `rust-toolchain.toml` à la RACINE** (pas dans `src-tauri/`) épingle
le canal `1.96.0`. `src-tauri/Cargo.toml:9` déclare encore `rust-version = "1.77.2"` —
ce chiffre n'est **plus vérifié par rien** (ni CI, ni job dédié) depuis l'épinglage.
Ne pas le traiter comme une contrainte tant qu'un build réel ne l'a pas rétabli.

## Commandes

Windows : npm passe par `cmd /c "npm …"` si le shell direct pose problème.

```bash
npm ci && npm run fetch-ffmpeg   # bootstrap (ffmpeg → src-tauri/binaries/, gitignoré)
                                 # macOS : COMPILE ffmpeg depuis les sources (LGPL), plusieurs
                                 # minutes — aucun build LGPL statique n'est publié
npm run tauri dev                # dev : Vite 5173 + backend Rust
npm run dev                      # frontend seul (navigateur) — voir la mise en garde §Vérification UI
npm run build                    # → dist/
npm run tauri build              # installeurs → src-tauri/target/release/bundle/
npm run lint:tokens              # couleurs/z-index/spacing en dur qui contournent un token
npm run storybook                # doc visuelle des états UI (port 6006), stories = frontend/*.stories.ts

npx tsc --noEmit                                                            # type-check front
cargo test --manifest-path src-tauri/Cargo.toml                             # tests Rust
cargo test --manifest-path src-tauri/Cargo.toml <nom_du_test>               # un seul test
cargo test --manifest-path src-tauri/Cargo.toml --release -- --ignored --nocapture   # benchmarks volume
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

⚠️ **`src-tauri/fixtures/*` est gitignoré.** Un checkout frais (clone ou worktree) ne
les a pas, et les tests `analysis::decode` échouent en *file not found* — ce n'est pas
un vrai bug. Régénérer : `node scripts/make-fixtures.mjs`. Les deux anchors
authentiques facultatives (`src-tauri/fixtures/README.md`) restent manuelles ; les
tests de caractérisation les sautent quand elles sont absentes.

⚠️ **Ne pas lancer `cargo test`/`clippy` pendant qu'un `tauri dev` compile** : ils se
disputent le lock du `target/` (attente, ou corruption du cache incrémental).
`scripts/cargo-isolated.sh` lance `cargo` avec un `CARGO_TARGET_DIR` isolé.

Storybook est le **miroir vivant** de `docs/design-system-states.md` : documenter un
nouvel état veut dire ajouter sa story, pas seulement étendre le markdown.

Scripts hors binaire de prod : `.claude/scripts/cdp.cjs` (§Vérification UI) ·
`scripts/rekordbox-spike-helper.ps1` (§Méthode) · `scripts/decrypt-masterdb-debug.py`
(décrypte une copie de `master.db` en SQLite clair pour inspection ad-hoc — port Python
de `rekordbox_masterdb.rs`, dépend de PyCryptodome).

## Définition de fini

Deux gardiens, à connaître avant de dire « terminé » :

- **`.claude/verify.sh`** — `tsc --noEmit` + `lint:tokens` + `cargo check` borné à
  25 s (abandonné sans échec au-delà : une gate de fin de tour doit être rapide ou
  muette). ⚠️ **Plus déclenchée par rien** : le hook Stop global a été supprimé par
  le reset vanilla de `~/.claude` du 2026-07-31 (commit `6f6c132`, sauvegarde au tag
  `pre-reset-vanilla`). Le script est intact — le lancer à la main. Le seul hook
  encore actif sur ce dépôt est celui d'`impeccable` (`.claude/settings.local.json`).
- **`.github/workflows/test.yml`** — sur **toute** branche et toute PR (Windows) :
  `tsc --noEmit` → `cargo fmt --check` → `clippy -D warnings` → `cargo test`. Ordre
  délibéré, du moins cher au plus cher. Le job régénère fixtures + ffmpeg d'abord.

`build.yml` (installeurs non signés Win+Mac) et `release.yml` ne se déclenchent que sur
`main` / tags — ils ne sont pas un filet de branche.

## Architecture — ce qui ne se voit pas dans un seul fichier

### La frontière IPC est un miroir manuel, pinné par des tests

`shared/contracts.ts` reflète à la main les structs serde de `src-tauri/src/ipc*.rs`.
Ce n'est pas une génération : les deux côtés se maintiennent dans le même geste.

Des **tests Rust tiennent le contrat** — ils destructurent exhaustivement (sans `..`),
donc l'ajout d'un champ Rust casse la compilation du test tant que `contracts.ts` n'a
pas suivi (`analysis/mod.rs::spectrogram_shape_matches_contracts_ts`,
`analysis_report_shape_matches_contracts_ts`). Ils **ne détectent pas** un désaccord de
*type* avec le miroir TS, seulement un champ manquant.

Des **sentinelles littérales** doivent rester identiques des deux côtés (voir les
commentaires de `shared/contracts.ts`, qui nomment le test Rust qui les épingle) :
`FILE_IN_PLACE` · `EXTERNAL_DEST_PREFIX` · `FILE_GONE` (sa rupture **supprime une ligne
en base**) · `DRIVE_VANISHED` / `IDENTITY_MISMATCH` / `ELEVATION_DECLINED` /
`EJECT_BUSY` (formatage et éjection USB) ·
`DEFAULT_FILENAME_TEMPLATE`. Ne jamais réimplémenter le rendu de nom de fichier en TS :
appeler `previewFilename`.

Le spectrogramme voyage en **base85** (`frontend/b85.ts` ↔ `src-tauri/src/b85_bytes.rs`,
miroir exact du crate `base85` 2.0.0) pour éviter les ~3,7 caractères/octet de
`serde_json` sur un `Vec<u8>` de ~360 ko par piste.

### Le frontend a deux vies : `app.js` et les modules live

`frontend/main.ts` importe **`app.js` inconditionnellement** (maquette d'origine, qui
tourne donc réellement en prod — c'est elle qui route les clics nav via
`e.target.closest('[data-view]')`), puis n'installe le wiring live **que si Tauri est
présent** (`"__TAURI_INTERNALS__" in window` → `installLiveWiring()`).

Conséquence à ne jamais oublier : `sift-live.ts`, `filing*.ts`, `report-view.ts`,
`*-view.ts` — tout ce qui touche l'IPC — **ne s'exécutent jamais dans un navigateur
classique**. Une capture issue de `npm run dev` ne prouve rien sur ces fichiers.

`dev-inspector.ts` / `selftest.ts` sont chargés dynamiquement sous
`import.meta.env.DEV` (éliminés du build de prod). Côté Rust, `dev_locate.rs` /
`dev_annotate.rs` sont gardés par `cfg!(debug_assertions)`.

### Modules frontend, par écran

`main.ts` (boot) · `chrome.ts` (shell, nav rail, routing) · `home-sources.ts` (Accueil) ·
`report-view.ts` (Revue : son-d'abord, waveform, verdict) · `bibliotheque-view.ts` ·
`ecartes-view.ts` · `rekordbox-view.ts` · `reglages-view.ts` · `usb-view.ts` (Clé USB) ·
`library-detail.ts`.

`sift-live.ts` reste le **point d'entrée du wiring et le dispatch de clic centralisé**
pour la plupart des écrans. Un seul écart volontaire : `rekordbox-view.ts` porte son
propre `handleRekordboxAction`.

`filing.ts` n'est plus que l'orchestration résiduelle ; le reste vit dans
`filing-state.ts` (état `RevueState`), `filing-bins.ts` (arbre de destination),
`filing-identify.ts` (Discogs + éditeur + apply-tags), `filing-actions.ts`,
`filing-preview.ts`, `filing-toast.ts`. Les splits utilisent l'**injection de
dépendance** (`register*`/callback, ex. `registerOpenTrackPathGetter`,
`registerDestChangeHook`) pour casser les cycles d'import — jamais un import statique
retour.

Transverses : `ipc.ts` (wrappers IPC typés) · `errors.ts` (garantit le `console.error`
de la chaîne brute — pas de table code→message, délibérément) · `dom.ts` ·
`confirm-modal.ts` · `list-virtual.ts` · `queue-panel.ts` / `batch-panel.ts` /
`batch-tracklist.ts` (file Revue, mode Lot) · `journal.ts` (journal d'actions + revert) ·
`progress-zone.ts` · `theme.ts` · `updater.ts` · `usb-format-modal.ts` ·
`usb-row.ts` · `usage-chart.ts` (graphique d'occupation, Clé USB + Bibliothèque) ·
`empty-state.ts` · `library-views.ts` · `identify-shared.ts` · `genre-families.ts` ·
`styles.css`.

`dev-inspector.ts` + `dev-annotate.ts` forment l'outil d'annotation **Alt+Clic**
(dev-only) : cadre de sélection, localisation du source via `locate_source`, note libre
envoyée par `save_annotation` qui append `docs/annotations.jsonl`.

### Backend : synchrone, un Mutex, des migrations append-only

- **Aucun runtime async.** Ni `tokio` ni `async-std` dans l'arbre. La concurrence est un
  pool `std::thread::spawn` dimensionné sur `available_parallelism()`, coordonné par
  `Arc<(Mutex<Queue>, Condvar)>` (`worker.rs`). Ne pas proposer de patterns async.
- **SQLite = `Mutex<Connection>` derrière un Tauri `State`.** Utiliser
  `db::lock_conn(&conn)`, jamais `.lock().map_err(...)` à la main.
- **`db.rs::MIGRATIONS`** : index + 1 == version de schéma (`PRAGMA user_version`).
  **Ne jamais réordonner ni éditer une entrée livrée — uniquement ajouter.** Une
  colonne morte se commente, elle ne se `DROP` pas (une migration sur les bases
  utilisateurs pour zéro octet récupéré).
- **Erreurs : enums à la main** (`Display` manuel + `impl Error`), `Result<T, String>` à
  la frontière IPC. Le projet n'utilise **pas** `thiserror`/`anyhow` — c'est un choix,
  pas un défaut ; ne pas les introduire sans le signaler.
- **`unwrap()`/`expect()` hors `#[cfg(test)]` = interdit dur.**
- Un seul bloc `unsafe` (`lib.rs`, `DwmExtendFrameIntoClientArea`), avec son commentaire
  `// SAFETY:` — le préserver s'il est touché.

Détails et overrides d'audit Rust : **`.claude/rules/rust.md`** (chargé pour
`src-tauri/**`).

### Modules Rust, par domaine

`analysis/` (decode Symphonia · verdict · spectrum · peaks · phase · dynamics ·
structure · tags) · `metadata/` (discogs · cover) ·
`usb_format/` (windows · macos · fat32 · raw_volume · sector_io · privileged — `fat32` et
`sector_io` sont gatés `cfg(any(windows, test))` : macOS formate par `diskutil eraseDisk`,
qui ignore le plafond de 32 Go, donc le binaire macOS ne lie plus `fatfs` ; le bras `test`
garde leurs tests exécutables sur n'importe quelle machine) ·
`volume_usage.rs` (occupation par format) ·
`scanner.rs` / `watcher.rs` / `sources.rs` / `worker.rs` / `queue.rs` (ingestion) ·
`filing.rs` / `actions.rs` / `encode.rs` / `naming.rs` / `tagging.rs` (rangement) ·
`dedup.rs` / `fingerprint.rs` · `library.rs` / `ecartes.rs` / `genres.rs` ·
`rekordbox_xml.rs` / `rekordbox_masterdb.rs` / `rekordbox_repairs.rs` (M8 Tier 1/2/3) ·
`ipc.rs` + `ipc_filing.rs` / `ipc_identify.rs` / `ipc_library.rs` / `ipc_usb.rs` /
`ipc_usage.rs` ·
`db.rs` / `settings.rs` / `ffmpeg.rs`.

Test-only : `bench_dedup.rs` (coût unitaire de `fingerprint::similarity`, taux de survie du
pré-filtre de durée, `group_duplicates` bout à bout, empreinte RAM) ·
`bench_volume.rs` (mesure `list_filed`/`list_pending` à 15k/100k lignes,
`EXPLAIN QUERY PLAN`) — `--ignored`, jamais dans la suite normale.
`search_corpus.rs` / `search_terms.rs` : corpus de noms de fichiers **sales** tirés
d'une vraie bibliothèque, étalonné à la main. Chaque entrée est un motif verrouillé —
en ajouter un quand on rencontre un motif nouveau, **jamais en retirer un pour faire
passer un test**.

## Méthode

Détective (théorie → preuve → correctif), **fail fast**, **pas de fallback silencieux**,
changements chirurgicaux. Vérifier avant d'agir.

Garde-fous issus d'incidents réels :

- **Actions destructives/coûteuses** : jamais `window.confirm()`/`alert()`/`prompt()` —
  un clic synthétique en a déjà traversé un sans bloquer. Utiliser la confirmation
  in-app, armée et horodatée contre les doubles clics (`confirm-modal.ts`,
  `BATCH_CONFIRM_THRESHOLD` / `batchConfirmArmed`).
- **Systèmes live** : ne jamais écrire dans un vrai `master.db` Rekordbox sur la seule
  foi d'un rapport d'agent. Relire l'état indépendamment et vérifier le backup contre
  une référence propre juste avant l'écriture. Filet :
  `scripts/rekordbox-spike-helper.ps1` (`-Action backup|swap|restore|status`, chaque
  étape vérifiée par SHA256, refuse d'agir si Rekordbox tourne).
- **Tests réalistes** : un test qui seed un setting ou fichier de config doit passer par
  les mêmes validations et dispositions de fichiers que la production.
- **Debug UI** : après deux correctifs visuels infructueux, mesurer la vraie fenêtre
  `tauri dev` (CDP, ci-dessous) avant un troisième essai.

## Front — CSS et événements

Sources de vérité design : **`frontend/styles.css`** (`:root`, canonique unique des
tokens) + `docs/design-system-states.md`. Ne jamais créer de fichier de thème parallèle,
ni extraire une valeur d'une capture d'écran. ⚠️ `.interface-design/system.md` existe
encore sur le disque avec une **palette et une typo périmées** : ne jamais y puiser une
valeur. Les wireframes de feature vivent dans `docs/wireframes/<feature>.html`.

**Jamais de style ou de comportement UI sorti de la mémoire d'entraînement.** Avant tout
élément neuf sans exemple fourni, consulter une référence réelle et **citer laquelle** a
guidé la structure ou le comportement : micro-composants → MCP `shadcn`, MCP `ui-thing`,
puis 21st.dev ; décisions desktop → Apple HIG ; référence donnée par Antoine → la lire
telle quelle, sans extrapoler. Ces sources servent à étudier structure, variantes et
états : ne jamais les installer dans `package.json`, ni copier leur palette, ni déplacer
les tokens de `styles.css`.

- Toute édition de token doit rester cohérente dans `:root`, le bloc sombre système
  (`prefers-color-scheme`) **et** `:root[data-theme="dark"]` — et comparer les valeurs
  **résolues** des deux tokens dans les deux thèmes, pas seulement leurs noms.
- Renderer déclenché par un événement en rafale (progress, watcher, scroll, resize) :
  **créer les nœuds une fois, muter ensuite**. Jamais d'`innerHTML =` dans un handler
  appelé en boucle. Modèle : `progress-zone.ts`. En écrivant un handler, **nommer la
  fréquence supposée** de l'événement pour que le risque soit visible à la revue.
- Un `render*()` qui ajoute plusieurs blocs siblings à `#content` doit les envelopper
  dans **un seul wrapper** retiré/recréé en un point unique (modèle :
  `renderReglagesLive()`, wrapper `#sift-reglages-live`).
- Pas de `border-left`/`border-right` coloré comme accent : fond teinté existant.
- Un état confirmé **permanent** reste neutre ; ne colorer que sa transition, brièvement.
- Animer `transform`/`opacity`. Une transition n'anime rien si le render rebuild via
  `innerHTML` à chaque clic — vérifier le chemin de render d'abord.
- CTA à label descriptif : **texte seul**. Icône réservée à ce qui n'a pas d'équivalent
  textuel (spinner). `.lk-icon` est réservé aux boutons icône-seule 22×22.
- Un bouton qui redéfinit `background` doit le réaffirmer dans son `:hover` (sinon il
  perd face au `button:hover` générique).
- Toute règle auteur qui pose `display` bat `[hidden]` : garder `:not([hidden])` sur
  tout élément togglé par `hidden`.
- Avant qu'un `querySelector` dépende d'une classe, vérifier sa présence dans le markup
  réellement rendu — et **lire la règle CSS** avant de réutiliser un nom de classe
  générique.
- Tout élément rendu via `innerHTML` avec des données non fiables passe par `esc()`
  (`dom.ts`) — vérifier systématiquement à la création d'un nouveau fichier frontend :
  un XSS stocké réel a été livré par le seul fichier qui l'avait oublié.

Jargon anglais volontairement conservé dans l'UI (ne pas « corriger ») : LOSSLESS,
DUPLICATE, MATCH, CHECK MATCH, FAKE, kbps, kHz, MP3, AIFF, WAV.

## Vérification UI — l'app réelle, pas la maquette

**Défaut : Antoine regarde lui-même la fenêtre `tauri dev`** (HMR, retour instantané) —
ne pas driver l'app à sa place. `computer-use` est écarté par défaut.

Pour une inspection ponctuelle du code `inTauri` réel :
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` **au lancement de
la commande dev** expose un endpoint CDP standard sur la vraie fenêtre WebView2
(`.claude/scripts/cdp.cjs`). Deux règles :

- **Ne JAMAIS** poser ce port via `additionalBrowserArgs` dans `tauri.conf.json` : il
  s'appliquerait aux builds de prod distribués et écrase les arguments par défaut de wry.
- Le port est squattable par un projet Tauri voisin : vérifier que `document.title`
  (ou `curl http://127.0.0.1:<port>/json`) correspond bien à Sift avant de faire
  confiance à une session. Si non, changer de port — ne jamais tuer le process d'un
  autre projet.

## Dépendances et docs externes

Avant d'écrire du code touchant une librairie externe, récupérer sa doc à jour via
**Context7** — ne jamais se fier à la mémoire d'entraînement pour une signature, un nom
de feature ou une config de version. Si le lookup échoue, le dire (fail-fast) plutôt que
deviner.

Audit de versions : `cargo outdated` → classer chaque écart (patch/minor sûr ; **bump
majeur = STOP**, signaler sans toucher) → changelog réel pour les breaking changes qui
touchent nos call sites → `cargo update` **crate par crate**, build + test entre chaque.
Jamais un update global, jamais un pin de contournement.

Ajouter une dépendance frontend demande une validation humaine explicite (voir
l'en-tête de `frontend/b85.ts`).

## `docs/` — liste blanche depuis le 2026-07-31 (issue #5)

`.gitignore` ignore le **contenu** de `docs/` et ne ré-autorise que ce qui fait
autorité : `install-non-signe.md`, `design-system-states.md`, `ressources-externes.md`,
`design-system/`, `skills/`, et **chaque dossier de chantier** de `superpowers/changes/`
pris un par un. Plans de jalons, specs, revues, comptes rendus et `INDEX.json` restent
**sur cette machine** mais hors suivi git.

- Un nouveau document sous `docs/` est ignoré **par défaut** ; le publier demande
  d'ajouter sa négation au `.gitignore` dans le même geste. C'est voulu — la liste noire
  précédente laissait repasser tout fichier neuf. ⚠️ Vaut AUSSI pour un nouveau dossier
  sous `superpowers/changes/` : `.gitignore` ré-autorise le dossier `changes/` puis
  ré-ignore son contenu (`docs/superpowers/changes/*`), donc il faut une ligne
  `!docs/superpowers/changes/<date>-<slug>/` par chantier. Sans elle le dossier n'existe
  pas pour git, en silence — constaté le 2026-08-02.
- Les chemins `docs/superpowers/...` cités ici ou dans le code sont réels **localement**
  et introuvables dans un clone frais : ne pas les « réparer » en les supprimant, ne pas
  les citer à un lecteur externe.
- L'historique n'a pas été réécrit : tout reste récupérable par `git log --`.
- Un nouveau chantier ouvre **un seul dossier** `docs/superpowers/changes/<date>-<slug>/`
  contenant `design.md` / `plan.md` / `review.md` — pas `specs/` + `plans/` + `reviews/`
  à plat. Les fichiers antérieurs à la convention n'ont pas été migrés.

Deux références lourdes, **à lire à la demande via leur sommaire en tête de fichier**
(`Read offset=<L>`), jamais en entier : `docs/ressources-externes.md` (décisions
techniques ; section « Écarté » = tranché, « Différé » = pas assez de preuve, avec
trigger de réouverture — ne pas confondre) et `docs/design-system-states.md` (états
réels des composants, miroir des stories Storybook).

`docs/INDEX.json` (local, non versionné) catalogue chaque document — le lire quand on
cherche le statut d'un chantier, jamais l'importer (≈18 000 tokens). Il est **maintenu à
la main** : créer un document sous `docs/` veut dire y ajouter son entrée dans le même
geste, jamais en rattrapage différé.

## Release

**Écrire la section `## vX.Y.Z` de `CHANGELOG.md` d'abord.** `release.yml` l'extrait via
`scripts/changelog-section.mjs` et la passe en `releaseBody` ; le script sort en code 1 si
elle manque, donc la release **échoue** au lieu de publier des notes vides. Ce texte ne sert
pas qu'à la page GitHub : `tauri-action` le recopie dans le champ `notes` de `latest.json`,
que **chaque installation existante télécharge**. Éditer le corps d'une release après coup
change la page GitHub mais PAS `latest.json`, généré au build.

Synchroniser les versions de `package.json`, `src-tauri/Cargo.toml` et
`src-tauri/tauri.conf.json`, depuis `main`. Après `git tag vX.Y.Z && git push --tags`,
`release.yml` publie un **brouillon** (`releaseDraft: true`) : sans publication manuelle
sur GitHub, `/releases/latest/` ne résout jamais le brouillon et **l'auto-update ne
trouve rien, silencieusement, pour toujours**.

## Pointeurs

- `.claude/rules/context-packs.md` — packs de contexte par type de tâche.
- `.claude/rules/rust.md` — override projet pour tout travail sur `src-tauri/**`.
- `docs/skills/sift-ui-design-governance.md` — gouvernance des décisions UI (versionné).
- `.claude/learning-log.md` — incidents et leçons machine-locales.
- `AGENTS.md` — simple pointeur vers ce fichier (ne pas y dupliquer de contenu).
