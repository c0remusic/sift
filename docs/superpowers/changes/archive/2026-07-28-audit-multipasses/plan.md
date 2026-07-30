> **CHANTIER CLOS — livré le 2026-07-30**, et archivé sous `changes/archive/` pour cette
> raison. Les quatre vagues décrites plus bas sont implémentées et committées. Tout ce
> document est rédigé **au futur** parce que c'est le plan tel qu'il a été validé : ne pas
> le relire comme une liste de travail à faire. Il est gardé pour la traçabilité des
> DÉCISIONS — surtout les rejets, qui disent pourquoi un refactor n'a pas été fait.
>
> **Périmètre exact, mesuré le 2026-07-30** (`git rev-list --count`) : la plage
> `9cc604a..a8c9955` contient **24** commits, dont **4** viennent d'une session parallèle
> et ne relèvent pas de ce plan (`0a95399`, `71d6f85`, `dc47139`, `1116248`). Soit **20**
> commits d'audit dans la plage, **21** avec `9cc604a` lui-même (la Vague 0, exclue par
> le `..`). Une première rédaction de cet encadré annonçait « 17 commits, 9cc604a..a8c9955 »
> — chiffre non mesuré, et faux deux fois : il sous-comptait mes commits et passait sous
> silence que la plage en contient d'autres.
>
> **Deux corrections à la Vue d'ensemble ci-dessous, faites après coup :**
>
> 1. Sa prémisse fondatrice — « la CI ne lance ni `cargo test`, ni `clippy`, ni `tsc` » —
>    était vraie au moment de l'audit (2026-07-28) et **ne l'est plus** : la Vague 0 a créé
>    `.github/workflows/test.yml`, qui lance les trois. Le diagnostic « projet sans
>    exécuteur » décrit l'état d'AVANT, pas l'état actuel.
> 2. Le décompte « 22 retenues en plein » est **faux, c'est 23** (23 + 8 + 17 = 48 ;
>    22 + 8 + 17 = 47, pour 48 entrées annoncées dans la même phrase). Recompté sur le
>    tableau lui-même. C'est la troisième version de ce chiffre : la première rédaction
>    annonçait « 24 sur 44 », la deuxième « 22 » en se présentant déjà comme un
>    recomptage. Le texte d'origine est laissé tel quel plus bas, cet encadré le corrige.
>
> **Sept écarts entre le plan et l'exécution**, documentés dans les messages de commit
> concernés : SDP-5 annoncé « 1 ligne » était une perte de données (`e3c4255`) ; SYS-3
> portait sur `tracks.format`, colonne qu'aucun code de production n'écrit (`76e474e`) ;
> SIMP-5 comptait 34 classes mortes aux lignes 1424-1467, c'est 37 aux lignes 1440-1483 et
> 1424 est du code vivant (`36cd4d6`) ; D-1(e) n'a pas sorti wavesurfer du bundle
> contrairement à ce qu'il annonçait (`36cd4d6`) ; deux des trois « routages morts » de
> `CLAUDE.md` ne le sont pas (`13f7d74`) ; SYS-5 n'a archivé qu'un des deux documents
> visés, avec sa raison (`13f7d74`) ; et la Vague 0 §1 plaçait le job CI dans
> `build.yml`, alors que l'exécution a créé un workflow séparé `test.yml` — les
> déclencheurs `on:` étant au niveau du workflow et non du job (`9cc604a`).
>
> **Arbitrages produit : trois sur six sont TRANCHÉS** (par Antoine, le 2026-07-30) et la
> section finale ne les a pas mis à jour. `filename_template` (point 2) → finir la feature
> dans Réglages ; `rekordbox-spike-helper.ps1` (point 3) → documenté dans `CLAUDE.md`
> § Outils de dev annexes, c'est fait ; le routage UI de `CLAUDE.md:344` → les deux MCP
> `shadcn`/`ui-thing` réactivés dans `settings.local.json`, c'est fait. Restent ouverts :
> le statut d'`app.js` (point 4), SYS-6 Rekordbox ×3 (point 5), et un runner de test
> frontend.

# Vue d ensemble

Sift marche. Le code est au-dessus de la moyenne : les patrons corrects sont écrits, testés et commentés — puis pas appliqués au site suivant. Les 48 entrées ne décrivent pas un projet malade, elles décrivent un projet **sans exécuteur** : la CI ne lance ni `cargo test`, ni `clippy`, ni `tsc` (`build.yml` n exécute que `lint:tokens` et `tauri build`, `release.yml` que `npm ci` et `fetch-ffmpeg` — recompté sur disque le 2026-07-28), donc le seul gardien est un hook git non versionné. Tout le reste du rapport découle de là.

Les 3 vrais problèmes, dans l ordre où ils frappent le DJ :
1. **Perte de données silencieuse sur ses fichiers** — CR-1 (la purge à 30 jours efface les lignes `trash` vivantes : restauration morte, fichiers orphelins) et CR-3 (tags écrasés en place, ni rollback ni journal si le déplacement échoue). Vérifiés ligne à ligne. Ce sont les seuls findings où il perd quelque chose.
2. **L écran ment** — CC-2 (piste peinte « fait » alors que le thread est mort), PP-1 (250 MP3 rebondissent, coche verte, `0 filed`), CC-1 (« Aucun doublon » affiché sur un scan en échec), SIMP-1 (icônes CDN : hors ligne, en club, toute l iconographie devient du tofu), SJ-1 (waveform non lue quasi invisible en thème clair, qui est le défaut).
3. **Le verrou SQLite unique tenu pendant les E/S lourdes** — `library_stats` peut décoder toute la bibliothèque disque sous verrou. Le découpage correct est démontré 25 lignes plus haut dans le même fichier.

Sur les 48 entrées du tableau : **22 retenues en plein, 8 en partiel, 17 rejetées** (recompté sur le tableau lui-même — la première rédaction annonçait « 24 sur 44 », deux chiffres faux). Les gros refactors (Rekordbox ×3, `run_file_batch`, l état mutable front, les échelles typo) sont **rejetés** : effort L, risque moyen, zéro pour le DJ, sur du code qui tourne.

# Tableau de synthese

| ID | Titre | Note | Effort | Risque | Fichiers | Décision |
|---|---|---|---|---|---|---|
| CR-1 | Purge 30j supprime les lignes `trash` vivantes | A | S | faible | `actions.rs`, `ecartes.rs`, `lib.rs` | **RETENU** — V1, priorité 1 |
| CR-3 | Tags écrasés en place, ni rollback ni journal si le move échoue | A | S | faible | `filing.rs`, `ipc_filing.rs` | **RETENU** — V1 |
| CC-2 | Pas de `catch_unwind` en phase 2 du lot → piste peinte « fait » | A | S | faible | `ipc_filing.rs` | **RETENU** — V1 |
| SIMP-1 | Police Tabler depuis un CDN, aucun repli local | A | S | faible | `index.html`, `styles.css`, `package.json`, `tauri.conf.json` | **RETENU** — V1, meilleur ROI du rapport |
| PP-1 | Le Lot ignore le garde no-upscale, recap vert et mensonger | A | M | moyen | `batch-panel.ts`, `filing.rs` | **RETENU** — V1, fix technique tranché (voir arbitrage) |
| CC-1 | Scan de doublons en échec → « Aucun doublon dans toute la bibliothèque » | A | S | faible | `sift-live.ts`, `bibliotheque-view.ts` | **RETENU** — V1 |
| SJ-1 | `--overlay-bar` inexistant → waveform non lue blanche sur thème clair | A | S | faible | `report-view.ts`, `styles.css` | **RETENU** — V1 |
| SYS-1 | `Mutex<Connection>` tenu pendant les E/S lourdes, 6 commandes | A | L | moyen | `ipc_library.rs`, `library.rs`, `filing.rs`, `ipc.rs`… | **RETENU PARTIEL** — 3 sites sur 6 (`library_stats`, `commit_file`/master.db, `list_queue`). XML export, réparations master.db, `revert_batch` **rejetés** : opérations explicites, courtes, à déclencheur unique |
| SDP-1 | Table extension→rail dupliquée en TS, `.opus` manquant | ~~A~~ **B** | S | faible | `filing.ts` | **RETENU** — rétrogradé : `.opus` est quasi inexistant dans une bibliothèque DJ. Fix = suppression de la table, groupé avec PP-1 |
| SYS-4 | CI sans tests/clippy/tsc, lint-tokens à 83% de bruit, 0 test TS | B | M | faible | `.github/workflows/build.yml`, `lint-tokens.mjs`, `package.json` | **RETENU PARTIEL** — job CI (V0) + correctif linter (V3). **Vitest rejeté** : monter un runner front pour 0 test existant est un chantier, pas un correctif. Réouverture : première régression front en prod |
| SYS-2 | Aucune sentinelle stable à travers l IPC (20+ sites) | B | M | faible | `decode.rs`, `ipc.rs`, `contracts.ts`, `usb_format/` | **RETENU PARTIEL** — `FILE_GONE` seule (elle pilote un DELETE de ligne DB) + message USB honnête. Les 18 autres sites **rejetés** : le scénario suppose une reformulation future, pas un bug actuel |
| SYS-3 | La règle rail↔format a 4 implémentations | B | M | faible | `tags.rs`, `dedup.rs`, `library.rs`, `filing-preview.ts` | **RETENU PARTIEL** — 2 divergences réelles seulement : `alac` absent de `dedup.rs:51` et du SQL `library.rs`. Le refactor « une autorité » **rejeté** |
| SYS-7 | Erreurs de lock avalées sans log (~20 sites) | B | S | faible | `watcher.rs`, `worker.rs`, `ipc_filing.rs` | **RETENU PARTIEL** — ajout de `log::error!` sur `watcher.rs:33/119`, `worker.rs:202/218/227`, `ipc_filing.rs:717`. L élargissement de `db::lock_conn` **rejeté** |
| CC-4 | `rollback_fs` avale toutes ses erreurs sans un seul log | B | S | faible | `filing.rs` | **RETENU** — 3 lignes, c est le seul filet du chemin où un fichier disparaît |
| CC-5 | `expect()` sur le chemin de boot (`lib.rs:180`) | B | S | faible | `lib.rs` | **RETENU** — vérifié : la closure `setup` utilise déjà `?`. 3 lignes |
| SDP-5 | Recette d écriture de tags recopiée sur 3 sites, déjà divergée | B | L | moyen | `filing.rs`, `ipc_filing.rs`, `ipc_library.rs` | **RETENU PARTIEL** — seule la divergence `tag_title` (`ipc_library.rs:96`) est corrigée, 1 ligne. Le module `tag_write` **rejeté** |
| SYS-5 | Doc-rot : 11 documents actifs pointant vers des cibles mortes | B | M | faible | `INDEX.json`, `CLAUDE.md`, `.interface-design/`, `TECH_DEBT_AUDIT.md`… | **RETENU PARTIEL** — 3 archivages + les 3 routages morts de `CLAUDE.md`. Les checks mécaniques (INDEX.json, dedup ressources-externes) **rejetés** : bureaucratie |
| SIMP-4 | `cdp.cjs` : sélecteur interpolé non échappé, `click` cassé | B | S | faible | `.claude/scripts/cdp.cjs` | **RETENU** — 1 ligne, et c est l outil de preuve UI du projet → V0 |
| SJ-3 | `--space-6` n existe pas → padding du toast Journal à 0 | B | S | faible | `styles.css` | **RETENU** — vérifié : 2 usages, 0 déclaration |
| PP-11 | `usb-format-modal.ts` réimplémente `escapeHtml`, plus faible | B | S | faible | `usb-format-modal.ts`, `dom.ts` | **RETENU** — 1 import, supprime une fonction |
| SJ-4 | `outline:none` inline sur 2 champs de recherche | C | S | faible | `queue-panel.ts`, `bibliotheque-view.ts` | **RETENU** |
| CC-11 | Suppression de doublons : échec partiel affiché « tout a échoué » | C | S | faible | `sift-live.ts` | **RETENU** — action destructive rapportée faux |
| CR-9 | Cascade Discogs : une erreur réseau jette le meilleur résultat | C | S | faible | `discogs.rs` | **RETENU** — 4 lignes, chemin chaud du travail en cours |
| CR-8 | `group_duplicates` : `min_sim` perdu à la fusion de groupes | C | S | faible | `dedup.rs` | **RETENU** — champ publié qui ment ; à corriger AVANT de l afficher |
| CC-10 | `ipc_identify.rs` : aucun test sur `build_query` (code neuf) | C | S | faible | `ipc_identify.rs` | **RETENU** — V0 : c est le code de la branche courante |
| SJ-5 | Erreur d export renvoyant vers un écran sans la commande | C | S | faible | `sift-live.ts` | **RETENU** — 1 ligne |
| SJ-9 | Erreur backend brute déversée dans 9 toasts | C | M | faible | `filing-actions.ts`, `library-detail.ts`, `sift-live.ts`… | **RETENU** — mécanique, directement face utilisateur |
| SIMP-6 | `library-detail.ts` réimplémente `toast()` à l identique | C | S | faible | `library-detail.ts`, `filing-toast.ts` | **RETENU** — supprime 19 lignes + une garde défensive devenue inutile |
| CC-12 | Copie presse-papier : catch vide, « Copié » inconditionnel | C | S | faible | `sift-live.ts` | **RETENU** — 3 lignes |
| SIMP-5 | 34 classes CSS mortes (`.jrnl-insp-*`) | C | S | faible | `styles.css` | **RETENU** — suppression pure, vérifiable |
| D-1 | Résidus mesurés (5 items) | D | S | faible | `worker.rs`, `main.ts`, `discogs.rs`… | **RETENU PARTIEL** — seul (e) : gater `main.ts:37-42` sous `import.meta.env.DEV` (sort selftest + wavesurfer du bundle). (a)(b)(c)(d) **rejetés** : cosmétique |
| SYS-6 | Rekordbox : 3 familles clonées en Rust ET en TS | B | L | moyen | `rekordbox_repairs.rs`, `rekordbox-view.ts` | **REJETÉ** — refactorer 3 clones qui marchent sur la zone master.db chiffrée, pour zéro gain utilisateur, est exactement le risque à ne pas prendre. Réouverture : un 4e tier |
| SYS-8 | État mutable exporté sans mutateurs (42 + 24 écritures) | C | M | moyen | `filing-state.ts`, `filing.ts`, `bibliotheque-view.ts` | **REJETÉ** — le seul symptôme (`state.rail` oublié dans `clearPane`) est prouvé non exploitable. Réouverture : ajout d un 14e champ |
| CC-8 | `run_file_batch` : 255 lignes, 3 phases, 6 responsabilités | B | M | moyen | `ipc_filing.rs` | **REJETÉ** — les 3 correctifs qui la traversent (CC-2, PP-1, SYS-1) sont chacun locaux. Extraire d abord multiplierait leur risque |
| CA-5 | L invariant `reserved` fuit dans la signature du domaine | B | M | moyen | `filing.rs`, `ipc_filing.rs` | **REJETÉ** — YAGNI : aucun appelant de `plan_file` hors `ipc_filing.rs` n existe. Réouverture : le premier qui apparaît |
| SDP-11 | `openFilingInto` : 240 lignes, décomposition temporelle | C | M | moyen | `filing.ts` | **REJETÉ** — zéro impact utilisateur, risque moyen sur le parcours principal |
| SJ-6 | Aucun garde sur typo/motion/bordure (39 + 9 + 4 littéraux) | C | M | faible | `lint-tokens.mjs`, `styles.css` | **REJETÉ** — cohérence interne pure. Réouverture : passe design-system assumée |
| CC-14 | `reconcile` désigne 2 opérations sans rapport | C | S | faible | `scanner.rs` | **REJETÉ** — churn de nommage sur un crate qui marche |
| SDP-10 | `Query.attempts` : le vide signale 2 choses différentes | C | S | faible | `metadata/mod.rs`, `discogs.rs` | **REJETÉ** — exige <3 caractères alphanumériques partout. Réouverture : une recherche courte ramenant du bruit |
| SIMP-8 | `verdictCardHtml()` : fonction morte conservée en no-op | C | S | moyen | `report-view.ts` | **REJETÉ** — risque moyen (le spinner) pour zéro gain ; le piège est déjà documenté en commentaire |
| SIMP-7 | Table `custom_tags` créée en v1, jamais lue ni écrite | C | S | faible | `db.rs` | **REJETÉ** — une migration `DROP` sur les DB utilisateurs pour récupérer 0 octet. Un commentaire suffit |
| PP-14 | 8 constantes SQLCipher recopiées en Python | C | S | faible | `decrypt-masterdb-debug.py` | **REJETÉ** — outil de forensique sorti une fois par an ; le côté Rust a son test |
| CA-11 | 7 globales `window` non typées entre `app.js` et le live | D | M | moyen | `sift-live.ts`, `app.js` | **REJETÉ** — subordonné au gel d `app.js` (`CLAUDE.md:26-27`) |
| SIMP-12 | `filename_template` exposé par aucune UI | C | S | faible | `settings.rs`, `ipc_filing.rs` | **REJETÉ comme fix** → question produit, section arbitrages |
| SIMP-14 | `rekordbox-spike-helper.ps1` : destructif, non documenté | D | S | faible | `scripts/`, `CLAUDE.md` | **REJETÉ comme fix** → choix binaire, section arbitrages |
| REJ-1 | app.js : suppression de 69% du fichier | D | S | faible | `app.js` | **REJETÉ** (confirmé) — `CLAUDE.md:26-27` gèle le fichier |
| REJ-2 | Sweep d espacement sur une échelle « rétractée » | D | S | faible | `.interface-design/system.md` | **REJETÉ** (confirmé) — vérifié : `styles.css:81` déclare bien les 6 paliers |
| REJ-3 | `bibState` muté depuis `sift-live.ts` | D | S | faible | `bibliotheque-view.ts` | **REJETÉ** (confirmé) — dispatch centralisé, décision écrite `CLAUDE.md:169-172` |

# Vagues d execution

## Vague 0 — filet de securite

Rien ici ne change le comportement de l app. Tout ici existe pour que la vague 1 soit vérifiable.

1. **Job CI `test`** dans `.github/workflows/build.yml`, sans `needs:` — `npx tsc --noEmit`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Vérifié : aucun des deux workflows ne lance aujourd hui l un des trois. C est le prérequis de tout le reste : sans lui, les vagues 1-3 ne sont validées que par un hook git non versionné.
2. **Test de non-régression CR-1** : `purge_spares_a_live_trash_row`, sur le modèle exact de `purge_spares_an_action_pinned_by_a_pending_masterdb_repair` (`actions.rs:2954-3204`). Doit être **rouge avant le fix de la vague 1**.
3. **Test de non-régression CC-2** : un job dont `execute_file` panique doit ressortir en `needs_validation`, jamais absent des deux listes.
4. **CC-10** — `#[cfg(test)] mod tests` sur `ipc_identify::build_query` (4 cas : tags propres, tags sales, version seulement dans le nom, stem/folder vides). Fonction pure, aucun runtime Tauri. C est le code de la branche courante et il n a rien.
5. **SIMP-4** — `cdp.cjs:118` : `return "NOT FOUND: " + ${JSON.stringify(selector)};`. Sans ça, la preuve visuelle de SJ-1/SJ-3 n est pas outillée.
6. **Capture avant/après** de l écran Revue (waveform, thème clair) et du toast Journal, via `cdp.cjs` réparé — référence pour SJ-1 et SJ-3.

**Validation :** le job CI passe au vert sur un push, et les tests 2 et 3 sont **rouges** (`cargo test purge_spares_a_live_trash_row` → FAILED). Un test de vague 0 qui passe déjà est un test qui ne prouve rien.
**Rollback :** branche `audit/v0-filet` depuis `6cd7003`. Aucune modification de code de production dans cette vague — un `git checkout 6cd7003 -- src-tauri/src frontend/` suffit.

## Vague 1 — A

Ordre imposé par la dépendance : les fixes 1-3 partagent `filing.rs`/`ipc_filing.rs`.

1. **CR-1** — étendre `PINNED_ACTION_IDS` (`actions.rs:869`) avec `SELECT a.id FROM actions a JOIN tracks t ON t.id=a.track_id WHERE a.type='trash' AND a.undone=0 AND t.status='trash'`. Même raisonnement que pour les opérations master.db vivantes.
2. **CR-3** — dans `execute_file` branche conformante (`filing.rs:521-553`), le `?` de `move_cross_disk_safe` (ligne 548) devient une capture qui appelle `rollback_fs(&log)` avant de retourner. Le log porte déjà le snapshot `tag_edit`. Corriger les deux commentaires `ipc_filing.rs:632/855` qui affirment l invariant faux.
3. **CC-2** — `catch_unwind(AssertUnwindSafe(...))` autour de `filing::execute_file` (`ipc_filing.rs:771`), copie conforme de `ipc_filing.rs:437-448`. Le `Phase2Outcome` part quand même. Logger le cas `queue.lock()` empoisonné au lieu de sortir muet.
4. **PP-1 + SDP-1** (même passage, front) — **deux sélecteurs par rail** (décision Antoine du 2026-07-28, section arbitrages point 1) : rail lossless = pastille `MP3`/`AIFF`/`WAV` défaut AIFF ; rail lossy = texte `MP3 320 — seul format possible`, sans pastille. Chaque groupe porte son compte. `batchFormat` (`batch-panel.ts:84`) devient une cible par rail ; le rail lossy n émet aucun `batchformat`. Supprimer — pas corriger — le commentaire `batch-panel.ts:80-83` qui affirme l inverse du backend. Supprimer la table extension→rail de `filing.ts:463-467`, alimenter `state.rail` depuis `report?.declared_rail` (déjà en portée `filing.ts:350`). Recap en français, cause nommée.
5. **CC-1** — `error: string | null` sur `bibDup`, posé dans les deux `catch` (`sift-live.ts:321` et `:423`), bloc d erreur + Réessayer dans `bibliotheque-view.ts:243-251`. Extraire le bloc dupliqué en un `loadDuplicates()`.
6. **SIMP-1** — `@tabler/icons-webfont` en dépendance, import depuis `main.ts` comme les `@fontsource`, `@font-face` de `styles.css:1487` sur l asset local, puis **retirer `cdn.jsdelivr.net` de `style-src` et `font-src`** dans `tauri.conf.json`.
7. **SJ-1** — redéclarer `--overlay-bar` dans les 3 blocs de thème de `styles.css`, retirer le repli littéral `rgba(255,255,255,.35)` de `report-view.ts:748`.
8. **SYS-1, site 1 uniquement** — `ipc_library::library_stats` (`ipc_library.rs:189`) : sortir `duplicate_count_cached` du verrou, ou le rendre non bloquant. Le patron est déjà écrit 25 lignes plus haut (`ipc_library.rs:163-181`).

**Validation :**
- `cargo test` — les deux tests de la vague 0 passent au vert (c est la preuve du fix, pas une affirmation).
- `npx tsc --noEmit` + `cargo clippy --all-targets -- -D warnings` propres.
- SIMP-1 : **couper le réseau**, lancer le build packagé, vérifier que le CSP ne contient plus `jsdelivr` et que les icônes de la barre de titre s affichent. Un CSP redevenu `'self'` seul EST la preuve.
- SJ-1 : capture de l écran Revue en thème clair comparée à la référence vague 0.
- PP-1 : lot de MP3 réels → tous rangés en MP3, `N filed`, `0 need validation`.
- SYS-1 : ouvrir Bibliothèque sur une base à `fingerprint` vide pendant qu une analyse tourne — la file continue d avancer.

**Rollback :** un commit par finding, pathspec explicite (`git commit -m "..." -- <fichiers>`). Branche `audit/v1-correctness` depuis la tête de vague 0. Le point de retour sûr est `6cd7003`. Timeout Bash ≥ 360000 ms sur chaque commit (hook `verify-gate`).

## Vague 2 — B structurels

Groupés par fichier chaud : **un seul passage par fichier**.

**Zone Rust — journal & filesystem** (`filing.rs`, `ipc_filing.rs`, `actions.rs`)
- CC-4 : `rollback_fs` (`filing.rs:596-620`) — chaque `let _ =` devient `if let Err(e) = ... { log::error!(...) }`.
- SDP-5 (partiel) : aligner `ipc_library.rs:96` sur `naming::tag_title` — 1 ligne, divergence réelle sur ce qui part vers Rekordbox.
- SYS-7 (partiel) : `ipc_filing.rs:717` — logger la variante de `FilingError` avant `needs_validation.push`. C est ce qui rend le rebond de lot diagnosticable.

**Zone Rust — boot & threads** (`lib.rs`, `watcher.rs`, `worker.rs`)
- CC-5 : les 3 `expect()` de `lib.rs:178/180/189` deviennent `?` avec contexte français. La closure `setup` utilise déjà `?` ligne 154 — vérifié.
- SYS-7 (partiel) : `log::error!` sur `watcher.rs:33`, `:119`, `worker.rs:202/218/227`.

**Zone Rust — rails & dedup** (`dedup.rs`, `library.rs`)
- SYS-3 (partiel) : ajouter `alac` à `is_lossless_fmt` (`dedup.rs:51`) et aux deux clauses SQL `library.rs:150` / `:206`. Un fichier ALAC est aujourd hui compté comme non-lossless sur le tableau de bord.
- SYS-1 sites 2 et 3 : résoudre l index master.db **une fois par lot** hors verrou et l injecter dans `commit_file` (le patron existe : `xml_repair_sink`, `filing.rs:637-643`) ; sortir le recalcul des clés de nom de `list_queue` du verrou.

**Zone IPC — sentinelle FILE_GONE**
- SYS-2 (partiel) : déclarer `FILE_GONE` dans `shared/contracts.ts`, l importer côté TS (`filing.ts:354`), l utiliser côté Rust (`decode.rs:36`, `ipc.rs:324`), et étendre le bloc `include_str!` de `filing.rs:1996-2014` d un test. C est la seule sentinelle dont la rupture **supprime une ligne de la base**.
- SYS-2 (partiel) : `usb-format-modal.ts:165-179` traite `IDENTITY_MISMATCH` et `DRIVE_VANISHED` distinctement — ne jamais inviter à réessayer un formatage sur un disque que le backend vient de déclarer différent.

**Zone CSS & front**
- SJ-3 : `var(--space-6)` → `var(--space-8)` dans `styles.css:733` et `:735`.
- PP-11 : `import { esc } from "./dom"` dans `usb-format-modal.ts`, supprimer `escapeHtml`.

**Zone docs (SYS-5 partiel, aucun code touché)**
- Archiver `.interface-design/system.md` et `TECH_DEBT_AUDIT.md` hors du path de scan.
- Trancher les 3 routages morts de `CLAUDE.md` : skill `sift-ui-design-governance` non installée, MCP `shadcn`/`ui-thing` désactivés dans `settings.local.json`, skill `coss` inexistante. Un routage qui ne résout rien produit exactement ce qu il voulait empêcher.

**Validation :** `cargo test` + `cargo clippy -D warnings` + `npx tsc --noEmit` verts. Nouveau test `include_str!` sur `FILE_GONE` présent et vert. Pour SYS-1 sites 2-3 : chronométrer un lot de 20 pistes avant/après (le PRD pose 50 ms sur la boucle de rangement). Pour les docs : `ls .interface-design/system.md` doit échouer à la racine scannée.
**Rollback :** une branche par zone, mergées séquentiellement. Chaque zone est indépendante — l échec d une n annule pas les autres.

## Vague 3 — C et D retenus

Tous petits, tous indépendants, aucun ne touche un fichier de la vague 2 sauf `sift-live.ts` (à faire en un seul passage).

- **`sift-live.ts`, passage unique** : CC-11 (`Promise.allSettled` + message honnête + `renderBiblioLive()` dans tous les cas), CC-12 (repeint dans le `.then()`, `catch` non vide), SJ-5 (message d export pointant vers Intégrations > Rekordbox, avec action de navigation).
- **SJ-9** : `humanizeError(raw)` partagé sur le modèle `usb-format-modal.ts:169-178`, les 9 sites routés dessus, `String(e)` reste en `console.error`.
- **SJ-4** : retirer `outline:none` des styles inline de `queue-panel.ts:637` et `bibliotheque-view.ts:262`, laisser jouer `styles.css:497`.
- **SIMP-6** : supprimer le `toast()` privé de `library-detail.ts:33-51`, importer celui de `filing-toast`, retirer la garde `dataset.owner` devenue inutile.
- **CR-8** : fusionner les minimums au moment du `union` dans `dedup.rs` — à faire **avant** que le champ `similarity` soit un jour affiché.
- **CR-9** : `discogs.rs:447` — sur `Err`, logger et `break` la cascade pour tomber dans le `match best` final.
- **SIMP-5** : supprimer `styles.css:1424-1467` + les 8 règles orphelines isolées.
- **D-1 (e)** : déplacer `main.ts:37-42` dans le `if (import.meta.env.DEV)` de la ligne 45 — sort selftest et wavesurfer du bundle expédié.
- **SYS-4 (b)** : stripper les commentaires CSS avant `TOKEN_BLOCK_RE` (`lint-tokens.mjs:99`), élargir le sélecteur à `:root:not([data-theme="light"])`, **vérifier que le match compte 3 blocs**, régénérer la baseline.

**Validation :** `cargo test`, `npx tsc --noEmit`, `npm run lint:tokens` (doit passer de ~122 findings couleur à ~10 après le correctif du linter — si le compte ne s effondre pas, le correctif n a pas marché). Capture du toast Journal (SJ-3 déjà fait en V2) et de l écran Bibliothèque. `npm run build` puis vérifier que `wavesurfer` n est plus dans le chunk de production.
**Rollback :** un commit par item, tous réversibles isolément. Aucun ne modifie une structure de données ni le schéma.

# Ce qu Antoine doit trancher lui-meme

1. ~~**Le mode Lot doit-il garder un contrôle de format manuel ?**~~ — **TRANCHÉ le 2026-07-28 par Antoine.**

   Ni (a) « plus de sélecteur du tout », ni (b) « un sélecteur global avec grisage » : **deux sélecteurs séparés, un par rail**, une troisième option qu aucune des deux passes n avait posée et qui est meilleure que les deux. Le contrôle est conservé là où il existe réellement, et l upscale devient impossible PAR CONSTRUCTION puisque AIFF/WAV ne sont plus proposables au rail lossy.

   Forme retenue (maquette montrée et validée, tokens réels de `frontend/styles.css`) :
   - **Rail lossless** — pastille `.sift-seg` à trois options `MP3` / `AIFF` / `WAV`, défaut AIFF. Descendre un lossless en MP3 est légitime, ce n est pas de l upscale.
   - **Rail lossy** — **pas de pastille**. Texte seul : `MP3 320 — seul format possible`. Variante A choisie contre la variante B (options refusées affichées éteintes) : le rail reste compact, aucune option morte à l écran.

   Chaque groupe porte son compte (`Lossless · 12`, `Lossy · 250`). Conséquence assumée du choix de A : la règle no-upscale n est jamais montrée à l écran, donc l utilisateur ne saura pas qu il aurait pu vouloir autre chose. C est un choix, pas un oubli.

   Conséquence sur l implémentation de PP-1 (vague 1) : `batchFormat: Target` (`batch-panel.ts:84`) devient une cible par rail, et le rail lossy n a pas de handler `batchformat`. Le commentaire `batch-panel.ts:80-83`, qui affirme l inverse du backend, est supprimé et non corrigé.

2. **`filename_template` (SIMP-12) : au périmètre V1 ou pas ?** Le moteur de template existe côté Rust, aucune UI ne l expose, la valeur est toujours `DEFAULT_TEMPLATE`. Soit c est une feature à moitié câblée à finir dans Réglages, soit on inline le défaut et on supprime la clé. L état actuel — un moteur qui ne rendra jamais qu une valeur — est le seul à exclure.

3. **`scripts/rekordbox-spike-helper.ps1` (SIMP-14) : filet ou déchet ?** 158 lignes qui touchent le dossier Pioneer réel, référencées nulle part, absentes de l inventaire `CLAUDE.md`. Soit tu l ajoutes à § Outils de dev annexes parce que c est ta bouée pour tout futur spike master.db (la surface la plus risquée du projet), soit tu le supprimes. Outil destructif non documenté = le seul état à ne pas garder.

4. **Le statut d `app.js` et de la démo web** (REJ-1, CA-11, `README.md:124-129`). Tant que `CLAUDE.md:26-27` gèle le fichier, deux findings restent bloqués. Le geste minimal si tu lèves le gel : charger la maquette en import dynamique hors Tauri, ce qui sort 54 Ko du bundle desktop sans rien supprimer. Ce n est pas une décision technique, c est une décision sur ce que la démo web doit encore être.

5. **SYS-6 (Rekordbox ×3) : je l ai rejeté, pas enterré.** ~500 lignes triplées en Rust et ~160 en TS, messages d erreur compris. Aujourd hui c est du code qui marche sur la zone la plus dangereuse de l app — le refactorer maintenant, c est risquer master.db pour zéro gain DJ. Mais si un 4e tier de réparation arrive, la triplication devient une quadruplication et il faudra payer. C est ta décision de roadmap, pas la mienne.

**Ce que je n ai pas fait :** aucune compilation, aucun `cargo test`, aucun `tauri dev`, aucune vérification visuelle — un `tauri dev` tourne peut-être en parallèle et l interdit était explicite. Tous les jugements de rendu (SJ-*) restent déduits du CSS et du TS lus sur disque. J ai rouvert et cité ligne à ligne les preuves de **tous les A** plus `watcher.rs:33`, `lib.rs:178-190`, `ipc_filing.rs:710-722`, `dedup.rs:143-268`, `.github/workflows/*.yml` et les `scripts` de `package.json`. Les preuves des B/C/D non recoupées ici sont relayées telles que fournies par la passe Ralph, avec leur ID d origine.