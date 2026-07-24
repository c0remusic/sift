# Learning-log — store projet Sift (leçons durables)

> **Écrivain : `wrap-up` UNIQUEMENT.** **Lecteur : le hook `SessionStart`
> UNIQUEMENT** (injecte ce fichier quand le repo courant est Sift).
>
> **Frontière avec `.remember/`** : deux fonctions, pas deux mécanismes
> concurrents. `.remember/` = continuité de session (now/recent, transport).
> `learning-log.md` = leçons durables propres à ce projet. Les règles de
> méthode GLOBALES vivent dans `~/.claude/instinct-log.md`, pas ici.

## Format des 3 tiers

- **Corrections** — règles confirmées, sans expiration (projet).
- **Instincts** — hypothèses scorées 0.3→0.9, appliquées ≥0.7 ; un score ne bouge
  que via wrap-up, un cran à la fois, avec preuve datée.
- **Découvertes** — faits datés, TTL 6 mois, audit anti-bloat.

---

## Corrections

### C1 — Revérifier une découverte d'audit contre le couplage réel avant d'exécuter un fix (2026-07-15)
Un finding d'audit de dette écrit depuis une lecture partielle/par sections peut
surévaluer la séparabilité. Avant d'exécuter (pas juste re-rapporter) un split de
god-file ou un nettoyage knip/dead-code : relire le fichier cible EN ENTIER et
tracer quel état/fonctions sont réellement partagés à travers les frontières
proposées — grep chaque champ d'un objet d'état partagé pour son usage hors de sa
section « home », pas juste survoler les en-têtes. Et re-lancer l'outil statique
(knip, etc.) juste avant de déclarer une passe « terminée » : un repeat-run
attrape les instances que la première sortie listait en brut sans les transformer
en findings. (Origine : Sift `filing.ts` 2150L décrit comme « 5 responsabilités
séparables » — en réalité un seul contrôleur partageant `RevueState`, une seule
des 5 vraiment séparable. Absorbé depuis `~/.claude/skills/learned/`.)

### C2 — Un champ dérivé qui mirrore une condition backend doit tracer TOUS les écrivains des colonnes concernées, pas seulement le lecteur principal (2026-07-20, saga `needs_analysis`)
En exposant `QueueItem.needs_analysis` (frontend) pour refléter « ce morceau a
besoin d'une action d'analyse », la condition SQL a été calée sur
`worker::select_pending` (le lecteur principal du pool d'analyse) sans tracer
les AUTRES écrivains des mêmes colonnes. Résultat : 3 rounds de
`codex-crosscheck` pour trouver, dans l'ordre, que (1) `verdict === null` côté
frontend divergeait déjà de `select_pending`, (2) la condition alignée sur
`select_pending` ratait `persist_failure` (qui pose `analyzed_at`/
`report_json` sans jamais toucher `verdict`, donc invisible du côté lecteur),
(3) même après avoir ajouté `verdict IS NULL` en secours, `persist_failure`
lui-même ne nettoyait pas un `verdict` hérité d'un succès antérieur — la vraie
cause racine, à corriger dans l'écrivain, pas dans la condition de lecture.
Pattern répété : deviner/étendre la condition de lecture à chaque nouveau
finding, au lieu de d'abord lister tous les writers des colonnes en jeu.
**How to apply** : avant de figer une condition SQL/dérivée qui expose un
statut calculé, `grep` TOUS les sites qui écrivent chaque colonne impliquée
(pas seulement le chemin heureux) — succès, échec, remise en pending,
contenu changé — et vérifier que l'invariant tenu par le lecteur (ex.
« verdict non-NULL ⟺ analyse actuelle réussie ») est réellement maintenu par
CHAQUE écrivain, pas supposé. Complète C1 (qui porte sur la séparabilité
d'un état partagé) : ici la portée est spécifiquement « qui écrit cette
colonne, et l'invariant tient-il après chacun ».

---

## Instincts (score 0.3→0.9, appliqués ≥0.7)

_(vide)_

---

## Découvertes (datées, TTL 6 mois)

### D7 — An author CSS rule's own `display:block` silently defeats the `[hidden]` attribute — always pair a conditionally-hidden element's class with an explicit `[hidden]{display:none}` (2026-07-20, live bug report)
`.sift-qdone-toggle{display:block;...}` (queue-panel.ts's "Non analysés
uniquement" toggle) kept rendering with the count at 0 even though
`el.hidden = unanalyzedCount === 0` was setting the DOM attribute correctly
— confirmed live via `.claude/scripts/cdp.cjs` (`getComputedStyle(...).display`
was `"block"`, not `"none"`, with `el.hidden === true`). Root cause: the
browser's default `[hidden]{display:none}` is a low-specificity UA rule: any
author class selector that sets `display` explicitly (as this one did, to
force `display:block` over the button-reset elsewhere) wins over it. **How
to apply**: any element toggled via the `hidden` DOM property/attribute that
also has an author rule setting `display` needs an explicit
`.the-class[hidden]{display:none}` override alongside it — don't assume
`el.hidden = true` is visually sufficient just because the JS state is
correct; verify `getComputedStyle(el).display`, not just `el.hidden`, when
debugging a "should be hidden but isn't" report.

### D8 — Two concurrent `tauri dev`/Vite sessions across different Sift-family/sibling projects can squat the same `--remote-debugging-port` — always confirm the CDP target's `title`/`url` before trusting it, and prefer a project-dedicated port (2026-07-20)
Launched `tauri dev` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-
debugging-port=9222` (the port `CLAUDE.md`'s own documented convention
suggests) while another concurrent session (`shaderlab`, a sibling project,
Vite on port 1420) also had a WebView2/browser instance bound to 9222 —
`.claude/scripts/cdp.cjs eval "document.title"` silently returned
`"shaderlab"` instead of erroring, and several `eval` calls happily ran
against the wrong app's DOM before the mismatch was noticed (empty results
misread as "the queue is empty" rather than "wrong window"). Separately,
`sift.exe` itself died silently at some point mid-session (crash or closed)
while the `tauri dev`/cargo watcher kept running, and CDP still connected —
to a stale target list — with no obvious signal. **How to apply**: (1)
before trusting any `cdp.cjs`/CDP result, check `curl -s
http://localhost:<port>/json | ...` for `title`/`url` matching the expected
app, not just that SOME page target exists; (2) if results look
suspicious (empty when data is expected), check `tasklist | grep -i
<app>.exe` for the actual process before assuming the port is fine; (3)
prefer a project-specific port (e.g. 9223 for Sift, not the shared/default
9222) when multiple dev sessions may be running concurrently on the same
machine, to reduce collision risk in the first place.

### D5 — `.gitignore`'s directory-level `!` negation doesn't un-ignore NEW files under an ignored parent — only already-tracked files escape (2026-07-20)
`.claude/` is blanket-ignored with `!.claude/rules/` (+`/**`) as the sole
documented exception; `rules/*.md` appeared "not ignored" via `git
check-ignore` only because those specific files were already tracked (added
once via `git add -f`, presumably during an earlier session). Adding an
identical `!.claude/scripts/` (+`/**`) exception for `.claude/scripts/cdp.cjs`
did NOT make the brand-new file addable without `-f` — `git check-ignore`
confirmed it still matched the base `.claude/` pattern. This is a documented
Git limitation (can't re-include a file whose parent directory is excluded,
even with a directory-level negation, unless the file is already tracked).
**How to apply**: any NEW file under a nominally-"excepted" subfolder of a
blanket-ignored directory (`.claude/scripts/`, `.claude/rules/`) needs an
explicit `git add -f` — the negation pattern alone will silently fail to
stage it (`git add` errors "ignored by one of your .gitignore files", easy
to miss if scripted). Documented inline in `.gitignore` itself (2026-07-20).

### D6 — `TECH_DEBT_AUDIT.md`'s "Top 5"/"Quick wins" summary sections can silently contradict a finding's own detailed cell — read the full row before acting on the summary (2026-07-20)
F03's "Top 5" line ("cheapest time to act is before it grows further")
contradicted its own detailed cell, written after a full read of the file,
which explicitly recorded "left as-is pending a concrete pain point... no
frontend test suite as a safety net". A design + implementation plan for the
`filing.ts` split were built entirely from the summary framing, without
re-reading the detailed cell first — caught only 3 commits into the plan by
codex-crosscheck's HAUTE finding, not by this agent's own review. Reconciled
2026-07-20 (F03 row now says "Resolved", summary/detail no longer disagree).
**How to apply**: this file's "Executive summary"/"Top 5"/"Quick wins"
sections are compressed restatements written at audit time — they can drift
from a finding's own detailed cell if that cell was revised later (as F03's
was, 2026-07-15) without the summary being touched. Before launching
non-trivial work off a Top-5/Quick-wins line, read the finding's full table
row first, not just the compressed pointer to it.

### D-lint-tokens-styles-css-scope — `frontend/styles.css` mélange déclarations de tokens ET ~262 règles de composants dans le même fichier — tout outil de lint doit scanner le fichier, pas l'exclure (2026-07-19)
`scripts/lint-tokens.mjs` (créé cette session) excluait initialement tout
`styles.css` du scan pour éviter qu'un token ne se flague lui-même
(`--color-text-primary:oklch(...)` matche la regex couleur). Ça a aussi
supprimé la détection sur les ~1250 lignes de règles de composants du MÊME
fichier, ratant la majorité de la dérive réelle (69 findings au lieu de 267
une fois corrigé). Fix : neutraliser (blank out, même longueur/lignes) les
seuls blocs `:root{...}`/`:root[data-theme="dark"]{...}` avant de scanner,
au lieu d'exclure le fichier entier. Trouvé via `codex-crosscheck` (finding
HAUTE), pas par relecture manuelle — à vérifier en premier sur tout futur
outil de lint touchant ce fichier.

### D1 — `cargo test` en LNK2001/LNK2019 après un `tauri dev` interrompu = cache incrémental corrompu, pas un bug de code (2026-07-17)
Plusieurs lancements avortés de `npm run tauri dev` (échecs de wrapping
PowerShell/cmd via l'outil Bash, process tués en cours de build) ont laissé
`src-tauri/target/debug/` dans un état où `cargo test --manifest-path
src-tauri/Cargo.toml` échouait avec des dizaines de `error LNK2001/LNK2019:
symbole externe non résolu anon.<hash>.llvm.<hash>` sur des symboles sans
rapport avec le diff en cours (`tauri_runtime_wry`, `PathResolver`, `menu
plugin`...). `cargo clippy` restait vert entre-temps (la compilation-check
seule ne linke pas le binaire de test) — signal que ce n'était pas le code.
Fix : `cargo clean --manifest-path src-tauri/Cargo.toml -p sift` (le nom du
package, PAS `sift_lib` — vérifier `name =` dans `Cargo.toml` si erreur
« package ID specification did not match »), pas un `cargo clean` complet.
A libéré/reconstruit ~10 Go ; `cargo test` est repassé vert (385 tests) sans
aucune modification de source. Symptôme à reconnaître directement la
prochaine fois plutôt que de suspecter le diff.

### D2 — Après la migration Desktop→`C:\dev\`, échec de build sur chemin Desktop périmé figé dans `target/` = `cargo clean` COMPLET requis, `-p sift` ne suffit PAS (2026-07-18)
Distinct de [D1] (contraire sur le fix). Sur `_worktrees/sift-m6a-discogs`
(worktree déplacé de `C:\Users\LEETJ\Desktop\dj-assistant-m6a` vers
`C:\dev\_worktrees\`), `cargo clippy`/`cargo test` échouaient (exit 101) sur
`failed to read plugin permissions: failed to read file
'\\?\C:\Users\LEETJ\Desktop\dj-assistant-m6a\src-tauri\target\debug\build\tauri-<hash>\out\permissions\...\app_hide.toml'`
— un chemin absolu de l'ANCIEN emplacement Desktop figé dans le build-script
de la crate `tauri`. `cargo clean -p sift` (fix de D1) n'a PAS suffi : le
chemin périmé vit dans `target/debug/build/tauri-<hash>/` (package `tauri`,
pas `sift`), que `-p sift` ne nettoie pas. Confirmé que la fuite n'était que
dans `target/` (2396 fichiers), rien dans les fichiers trackés (`git grep`
vide). Fix : `cargo clean --manifest-path src-tauri/Cargo.toml` COMPLET (a
purgé ~12 Go/11793 fichiers) puis rebuild total (~3 min clippy, ~5 min test)
→ vert (385 tests). Règle de tri : LNK2019 sur symboles hors-diff avec clippy
vert = D1 (`-p sift`) ; chemin absolu d'un ANCIEN emplacement dans l'erreur
d'un build-script = D2 (`cargo clean` complet). Regarder le message d'erreur
avant de choisir le clean.

### D3 — Un refactor Rust qui rend un wrapper `pub` mort en prod se résout par SUPPRESSION, pas `#[allow(dead_code)]` (2026-07-18, plan progressive-scan-queue)
Précédent posé deux fois dans la même session : `scan_dir()` (Task 1→2, une
fois `reconcile` réécrite pour consommer `walk_audio_files` directement) puis
`reconcile()` (Task 2→3, une fois `spawn_scan` réécrit pour appeler
`reconcile_with_progress` directement) sont tous deux devenus des wrappers
publics sans appelant hors tests, rejetés par `clippy -D warnings`
(dead_code). Le projet interdit `#[allow]` sans accord explicite (`.claude/rules/rust.md`) :
dans les deux cas, vérifié par `grep`/`git grep` qu'aucun appelant réel ne
subsistait, supprimé la fonction, redirigé les tests vers la nouvelle
fonction `_with_progress`/paresseuse. **How to apply** : sur un refactor qui
rend un ancien wrapper public inutile en prod, vérifier l'absence
d'appelants réels (grep sur `src-tauri/src` ET `frontend/`) puis SUPPRIMER —
ne pas garder de pass-through mort ni introduire `#[allow(dead_code)]`.

### D4 — `cargo-audit` était absent de la machine ; installé le 2026-07-19, 2 CVE high trouvées et fixées (quick-xml 0.37→0.41)
`cargo audit` (crates.io RUSTSEC) n'avait jamais tourné sur ce repo faute
d'outil installé (`cargo install cargo-audit --locked`, ~1min). Première
exécution : 2 vulnérabilités DoS high-severity (RUSTSEC-2026-0194/0195,
quick-xml <0.41, utilisé par `rekordbox_xml.rs`) + 18 warnings unmaintained/
unsound pré-existants sur les bindings GTK3 Linux transitifs (tao/wry) —
warnings seulement, pas d'action, hors scope Windows/Mac. Piège rencontré au
fix : `Attribute::unescape_value()` déprécié en `normalized_value()`, mais la
signature exacte à la version pinnée (0.41.0) prend un paramètre
`XmlVersion` (`normalized_value(quick_xml::XmlVersion::Implicit1_0)`) alors
que la doc Context7 consultée montrait une signature sans paramètre (doc
plus récente que la version réellement installée) — l'erreur de compilation
(`E0061`) a révélé l'écart, pas la doc elle-même. **How to apply** : après
tout bump 0.x avec dépréciation, compiler avant de faire confiance à la
signature vue dans une doc externe — la doc peut décrire une version
ultérieure à celle réellement résolue par `cargo update -p <crate>`.
`cargo-audit` maintenant disponible localement : à relancer périodiquement
(pas automatisé, aucun CI/hook ne l'appelle).

### D9 — Une constante partagée à travers la frontière Rust↔TS a sa source canonique dans la couche qui l'APPLIQUE en logique, pas celle qui la documente (2026-07-23, fix queue MAX_ANALYSIS_ATTEMPTS)
En posant le seuil d'échec terminal `MAX_ANALYSIS_ATTEMPTS`, réflexe d'en
faire un `pub const` Rust « source unique » + un miroir dans
`shared/contracts.ts`. Mais le backend n'applique JAMAIS le seuil (il ne fait
qu'incrémenter `analysis_attempts`) — la règle « au-delà de N, la piste sort
du compteur » est purement frontend. Résultat : `clippy -D warnings` a rejeté
le const Rust en `dead_code` (le commit était bloqué par le hook pre-commit).
Fix : retirer le const Rust, garder la définition canonique dans
`contracts.ts` (la couche qui s'en sert), et les commentaires Rust/migration
pointent vers elle en texte. **How to apply** : avant de dupliquer une
constante des deux côtés de l'IPC, demander QUELLE couche l'utilise en
logique (pas juste en commentaire) — la constante vit là, l'autre côté y
réfère par nom. Un `pub const` Rust consommé seulement par du TS est du
dead-code que le gate clippy bloquera. Cf. [[D3]] (même gate clippy dead_code,
angle wrapper mort) et [[C2]] (autre facette de la frontière backend↔dérivé).

### D10 — Chaîne de release auto-update Tauri : 3 pièges qui coûtent chacun un cycle CI complet (2026-07-24, première vérification bout-en-bout v0.0.1→v0.0.2)
Première exécution réelle de `release.yml` (tag → build+sign+publish). Trois
échecs distincts, chacun n'apparaissant qu'en fin de build (~9 min de compil
avant l'étape de signature/publication) :
1. **BOM UTF-8 injecté par PowerShell dans le secret de signature.**
   `Get-Content -Raw "clé" | gh secret set TAURI_SIGNING_PRIVATE_KEY` préfixe
   la valeur d'un BOM (`0xEF 0xBB 0xBF`) → `tauri-action` échoue à la
   signature : `failed to decode base64 secret key: Invalid symbol 239,
   offset 0` (239 = `0xEF`). Fix : `$k = [IO.File]::ReadAllText("$HOME\.tauri\sift-updater.key"); gh secret set TAURI_SIGNING_PRIVATE_KEY -R c0remusic/sift --body $k`
   (`ReadAllText` décode l'UTF-8 sans BOM ; `--body` évite le ré-encodage du
   pipeline). Le build entier réussit AVANT ce point — l'installeur est
   fabriqué puis jeté, donc le symptôme visible est « release à 0 asset »,
   pas une erreur de build.
2. **`gh release edit/delete <nom>` résout par TAG, pas par titre.** Après le
   premier run raté, deux releases partageaient le tag `v0.0.1` (le draft
   `Sift v0.0.1` de tauri-action + une pre-release parasite `0.0.1` à 0
   asset). `gh release delete "0.0.1"` → `release not found`. Il faut viser
   par ID via l'API : `gh api repos/<o>/<r>/releases --jq '.[] | {id,name,draft}'`
   puis `gh api -X DELETE .../releases/<id>` / `-X PATCH .../releases/<id> -F draft=false -F make_latest=true`.
3. **GitHub refuse un 2e release publié sur un tag qui en a déjà un.** PATCH
   draft→false sur le draft échoue en `422 already_exists / field tag_name`
   tant que la pre-release parasite occupe le même tag → supprimer le
   parasite AVANT de publier le draft. **How to apply** : pour un release
   signé Tauri, poser le secret via `[IO.File]::ReadAllText`+`--body` (jamais
   `Get-Content -Raw |`), et si un run rate en laissant des releases
   dupliquées sur un tag, nettoyer par ID d'abord, publier ensuite. La
   suppression de release est bloquée par le classifieur auto-mode (destructif)
   → la déléguer à Antoine avec la commande ID exacte. Cf. [[D4]] (autre piège
   « la doc externe décrit une version postérieure à celle réellement
   résolue » — ici tauri-action `@action-v1.0.0`).

### D11 — NSIS « Error opening file for writing » sans process Sift actif = pas un verrou : install per-machine vs ancien per-user (2026-07-24)
Pendant l'install de `Sift_0.0.1_x64-setup.exe`, dialogue Abort/Retry/Ignore
`Error opening file for writing: C:\Program Files\sift\sift.exe`. Réflexe :
« une app tourne et tient l'exe ». Vérifié `Get-CimInstance Win32_Process`
filtré sur `sift.exe`/chemin `Program Files\sift` → **aucun process**. Cause
réelle : l'ancien install vivait en per-user (`%LOCALAPPDATA%\Sift`, ne
contient plus qu'un `uninstall.exe` périmé) ; le build CI est per-machine
(`C:\Program Files\sift`, requiert élévation UAC), et l'écriture de l'exe non
signé y échoue soit par défaut d'élévation, soit par mise en quarantaine
antivirus (SmartScreen l'avait déjà flaggé). **How to apply** : sur un
`Error opening file for writing` d'installeur, prouver l'absence de verrou
par `Get-CimInstance Win32_Process` (filtre nom ET chemin) AVANT de dire « une
app tourne » — si rien ne tourne, la cause est écriture (élévation/AV), pas
lock ; relancer l'installeur avec « Oui » à l'UAC, sinon exclusion Defender
sur le dossier cible. Cf. mémoire [[scope-process-cleanup-to-known-pids]].

### D12 — Un plugin Tauri dont la config n'existe que dans un override release-only fait planter `tauri dev` s'il est enregistré sans condition (2026-07-24, Task 1 auto-update)
`tauri.release.conf.json` (isolé exprès de `tauri.conf.json` de base, voir
`docs/superpowers/changes/archive/2026-07-24-auto-update/design.md`) porte
`plugins.updater.pubkey`/`endpoints` — jamais
fusionné pendant `tauri dev` ni un build de routine. Task 1 a enregistré
`tauri_plugin_updater::Builder::new().build()` sans condition sur le
`Builder`, à côté des autres plugins (`dialog`/`window-state`/`os`) — vérifié
par `cargo test`/`clippy`/`tsc`/un vrai `npm run tauri build`, tous verts.
Aucune de ces commandes n'exerce le chemin réel où le plugin panique :
`tauri dev` (pas de config updater → le plugin échoue à l'enregistrement).
Personne (agent ni moi) n'a lancé `tauri dev` pendant les 5 tâches — le gap
n'est sorti qu'après coup, corrigé en gating l'enregistrement dans la branche
`else` du `cfg!(debug_assertions)` déjà utilisée pour `tauri-plugin-log`
(même pattern, `lib.rs:80-92`). **How to apply** : quand un plugin dépend
d'une config qui n'existe que dans un override `--config` release-only,
son enregistrement au `Builder` doit être gated par le MÊME `cfg!(debug_assertions)`
que la config elle-même — et la checklist de vérification d'une tâche qui
touche l'enregistrement de plugins Tauri doit inclure un vrai `tauri dev`
lancé au moins une fois, pas seulement `cargo test`/`clippy`/`tsc`/build de
prod (aucun des quatre n'exerce le code path `tauri dev`-only). Cf. [[D10]]
(même chantier, autre facette : la config release elle-même, pas
l'enregistrement du plugin).

**CORRIGÉ par [[D13]] (2026-07-24, même soirée)** : le "How to apply"
ci-dessus est FAUX et a lui-même causé un cycle de blocage verify-gate —
`cfg!(debug_assertions)` ne voit pas si `--config tauri.release.conf.json`
a été passé (c'est un flag CLI runtime, `npm run tauri build` compile en
release SANS lui). Gater sur debug_assertions déplace juste le crash de
`tauri dev` vers tout build release qui n'a pas la config. Lire D13 pour
le vrai mécanisme (classification de l'erreur par son message, pas par
le profil de compilation).

### D13 — `cfg!(debug_assertions)` ne peut jamais distinguer une condition tranchée par un flag CLI runtime (`--config`) ; corrige [[D12]] (2026-07-24, 3 cycles verify-gate la même soirée)
En réappliquant le fix de D12 (updater plugin, `tauri dev` cassé au tout
début de cette session), gater sur `cfg!(debug_assertions)` a semblé
marcher (`tauri dev` redémarre, plus de crash) — mais `.github/workflows/
build.yml` (`npm run tauri build`, CI, installeurs non signés uploadés)
compile en profil RELEASE sans jamais passer `--config
src-tauri/tauri.release.conf.json` (seul `release.yml:56` le passe). Le
gate déplaçait donc le crash de `tauri dev` (visible immédiatement) vers
CE build release non signé (visible seulement par l'utilisateur final) —
verify-gate CRITIQUE a bloqué avant que ça n'atterrisse. Root cause :
`cfg!()` est une info de COMPILATION ; « est-ce que `--config` a été
passé » est une info RUNTIME de la CLI tauri, invisible à Rust. Aucun
`cfg!()` ne peut jamais l'encoder correctement, quelle que soit la
variante essayée.

Vrai fix (2 itérations supplémentaires, 2 autres blocages verify-gate) :
ne plus utiliser `?` pour propager l'échec d'enregistrement d'un plugin
optionnel (`app.handle().plugin(...)` dans `.setup()`, PAS le `Builder`
en chaîne — lui ne peut pas gérer un Result du tout). Classifier l'erreur
par son MESSAGE (`is_missing_updater_config`, `lib.rs`) : ne tolérer QUE
la phrase exacte et contiguë que produit tauri quand toute la clé config
est absente ("'plugins.updater' within your Tauri configuration: invalid
type: null, expected struct Config") — PAS deux `.contains()`
indépendants (1ère tentative de classifieur : matchait aussi un
sous-champ null dans une config par ailleurs présente sur un build
release SIGNÉ, avalant une vraie mauvaise config en silence — attrapé
par le même verify-gate). Tout ce qui ne matche pas cette phrase exacte
reste fail-fast (`return Err`, crash `setup()`) — c'est la garantie que
rien d'inattendu ne se fait avaler.

**How to apply** : avant de gater un comportement sur `cfg!(debug_assertions)`
(ou toute autre condition de compilation), lister explicitement TOUS les
profils de build/exécution réels du projet (ici : `tauri dev`, `npm run
tauri build` CI non signé, `--config tauri.release.conf.json` signé) et
vérifier que la condition choisie les distingue TOUS correctement — un
flag passé sur la ligne de commande (`--config`, `--features`, etc.)
n'est PAS visible via `cfg!()` sauf s'il est explicitement propagé en
variable d'env/feature au build. Si le vrai signal n'est disponible qu'à
l'exécution (ex. le contenu effectif de la config chargée, ou l'échec/
succès réel d'une opération), classifier l'ÉCHEC lui-même plutôt que
deviner une condition de compilation — et tester le classifieur contre un
cas adversarial qui a la même FORME que le cas attendu mais ne devrait
PAS matcher (pas seulement le happy path), sinon le premier passage
échoue au crosscheck comme ici (2 fois de suite sur ce point précis).

### D14 — `scripts/lint-tokens.mjs` a un mode ratchet (2026-07-24) ; `.claude/worktrees/` doit toujours être exclu d'un scan repo-wide
`npm run lint:tokens` tournait déjà en CI mais en `continue-on-error: true`
depuis sa création (jamais bloquant) — ~540 findings pré-existants
s'accumulaient sans alerte. Ajouté un mode `--write-baseline` +
comparaison automatique (`scripts/lint-tokens-baseline.json`, committé) :
le job CI dédié `lint-tokens` (`build.yml`, séparé du job `build` pour ne
jamais bloquer la production d'installeurs) échoue seulement si le compte
par catégorie AUGMENTE. Piège trouvé en écrivant la baseline la première
fois : `.claude/worktrees/<nom>/` (copie complète de `frontend/`, créée
par l'isolation native des sous-agents en écriture) n'était pas exclu du
scan → compte ~2x le réel si un worktree traînait au moment du calcul.
`.claude` ajouté à `EXCLUDE_DIRS` — tout futur outil qui scanne l'arbre du
repo entier (`find`, un linter maison, un script d'audit) doit exclure
`.claude` par défaut, pas seulement `node_modules`/`dist`/`.git`/`target`.
Baseline actuelle au 2026-07-24 : 122 couleurs, 3 z-index, 120 px-spacing.
