# Docs Reorg + INDEX.json Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 11 stray `docs/` files + the `audit/` folder + `docs/plans/` into the existing `docs/superpowers/{specs,plans,reviews}/` convention, fix the resulting broken cross-references, and add a hand-maintained `docs/INDEX.json` (auto-loaded via CLAUDE.md) so Claude can find "which doc covers what" without grepping `docs/` every session.

**Architecture:** Pure file moves (`git mv`) plus targeted text substitutions — no code behavior changes. Four sequential tasks: (1) move + rename per the spec's mapping table, (2) repair the cross-references that pointed at the old paths, (3) write `docs/INDEX.json` cataloguing every doc under `docs/` (root + `superpowers/*`), (4) wire the index into `CLAUDE.md`.

**Tech Stack:** git, bash/grep/sed (Windows Git Bash), no build step involved — verification is `git status`/`grep`, not `tsc`/`cargo`.

## Global Constraints

- No content changes to any moved document — path only (spec section "Impact sur les références existantes" / "Hors scope").
- Do NOT touch already-committed content inside `docs/superpowers/{specs,plans,reviews}/` files that merely *mention* a path being moved (e.g. `docs/superpowers/plans/2026-07-02-revue-rail-layout-fix.md:18`, `docs/superpowers/plans/2026-07-03-m6b-lot5-audit-conformite.md:26/58/65`) — these are historical records of what was true when written; only fix references in "live" surfaces (code comments, README.md, `.interface-design/system.md`, `design_handoff_sift_refonte/README.md`) and cross-references *between the files being moved in this same plan*.
- `docs/INDEX.json` is hand-maintained, no generation script (spec decision 5, consistent with Évaluation 6 in `docs/ressources-externes.md` rejecting sync tooling for this volume).
- Exact destination paths and filenames are fixed by the spec's mapping table — do not improvise different names.

---

### Task 1: Move files into `docs/superpowers/{specs,plans,reviews}/`

**Files:**
- Move (via `git mv`): the 15 files listed below
- Remove: `audit/` and `docs/plans/` directories once empty

**Interfaces:**
- Consumes: nothing (pure filesystem operation)
- Produces: the destination paths below, consumed by Task 2 (reference fixes) and Task 3 (INDEX.json entries)

Moves to perform, exactly:

```bash
git mv audit/AUDIT-SIFT-PROMPT.md docs/superpowers/reviews/2026-06-30-audit-sift-prompt.md
git mv audit/RAPPORT-direction.md docs/superpowers/reviews/2026-06-25-rapport-direction-verdict.md
git mv audit/PLAN-SIFT.md docs/superpowers/plans/2026-06-28-plan-sift-implementation.md
git mv audit/DESIGN-REVIEW-2026-07-01.md docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md
git mv docs/brief-refonte-ui-2026-07-01.md docs/superpowers/specs/2026-07-01-brief-refonte-ui.md
git mv docs/session-handoff-2026-06-30.md docs/superpowers/reviews/2026-06-30-session-handoff.md
git mv docs/audit-fidelite-2026-07-02.md docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md
git mv docs/refonte-ui-plan.md docs/superpowers/plans/2026-07-02-refonte-ui-plan.md
git mv audit/RAPPORT-FINAL.md docs/superpowers/reviews/2026-07-02-rapport-final-audit-sift.md
git mv audit/PLAN-FIX-2026-07-02.md docs/superpowers/plans/2026-07-02-plan-fix-post-audit.md
git mv audit/HANDOFF-FIX1-2026-07-02.md docs/superpowers/reviews/2026-07-02-handoff-fix1-anti-upscale.md
git mv docs/audit-conformite-m6b-2026-07-03.md docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md
git mv docs/handoff-verdict-card-titlebar.md docs/superpowers/reviews/2026-07-03-handoff-verdict-card-titlebar.md
git mv audit/REVUE-UI-UX-2026-07-03.md docs/superpowers/reviews/2026-07-03-revue-ui-ux-parcours.md
git mv docs/plans/2026-06-12-m0-scaffolding.md docs/superpowers/plans/2026-06-12-m0-scaffolding.md
```

- [x] **Step 1: Run all 15 `git mv` commands above**

- [x] **Step 2: Remove the now-empty source directories**

```bash
rmdir audit docs/plans
```

- [x] **Step 3: Verify the moves**

Run: `git status --short`
Expected: 15 lines starting with `R ` (renames), nothing under `audit/` or `docs/plans/` remaining, no unexpected modifications.

Run: `ls audit docs/plans 2>&1`
Expected: `No such file or directory` for both (or PowerShell equivalent "Cannot find path").

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: move audit/ + stray docs/ files into docs/superpowers convention

Consolidates 15 dated one-off reports (audits, plans, handoffs) that
lived loose under docs/ or in the parallel audit/ folder into the
existing docs/superpowers/{specs,plans,reviews}/ convention. No
content changes, path only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix cross-references to moved files

**Files:**
- Modify: `frontend/filing.ts` (4 comment references)
- Modify: `frontend/home-sources.ts` (1 comment reference)
- Modify: `frontend/library-detail.ts` (1 comment reference)
- Modify: `frontend/report-view.ts` (2 comment references)
- Modify: `frontend/sift-live.ts` (2 comment references)
- Modify: `README.md` (1 link)
- Modify: `.interface-design/system.md` (1 reference)
- Modify: `design_handoff_sift_refonte/README.md` (1 reference)
- Modify: `docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md` (2 self-references to another moved file — this is fixing a reference *between two files moved in Task 1*, not rewriting independent history, so it's in scope)

**Interfaces:**
- Consumes: destination paths from Task 1
- Produces: nothing consumed by later tasks — this task is self-contained

- [x] **Step 1: Apply the exact substitutions**

`frontend/filing.ts` — 4 occurrences (lines 777, 1283, 1500, 1592 before this edit; line numbers may shift after Task 1 since no code changed, they should still match):

```bash
sed -i \
  -e 's#docs/audit-fidelite-2026-07-02\.md#docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md#g' \
  -e 's#audit/HANDOFF-FIX1-2026-07-02\.md#docs/superpowers/reviews/2026-07-02-handoff-fix1-anti-upscale.md#g' \
  -e 's#docs/refonte-ui-plan\.md#docs/superpowers/plans/2026-07-02-refonte-ui-plan.md#g' \
  frontend/filing.ts
```

`frontend/home-sources.ts`, `frontend/library-detail.ts`, `frontend/report-view.ts`, `frontend/sift-live.ts` — same two patterns apply across all four (each file only contains a subset, `sed` is a no-op where a pattern doesn't match):

```bash
sed -i \
  -e 's#docs/audit-fidelite-2026-07-02\.md#docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md#g' \
  -e 's#docs/refonte-ui-plan\.md#docs/superpowers/plans/2026-07-02-refonte-ui-plan.md#g' \
  frontend/home-sources.ts frontend/library-detail.ts frontend/report-view.ts frontend/sift-live.ts
```

`README.md` line 28 — link text and href both change:

```bash
sed -i \
  's#\[`docs/plans/2026-06-12-m0-scaffolding\.md`\](docs/plans/2026-06-12-m0-scaffolding\.md)#[`docs/superpowers/plans/2026-06-12-m0-scaffolding.md`](docs/superpowers/plans/2026-06-12-m0-scaffolding.md)#' \
  README.md
```

`.interface-design/system.md` line 8:

```bash
sed -i 's#docs/brief-refonte-ui-2026-07-01\.md#docs/superpowers/specs/2026-07-01-brief-refonte-ui.md#' .interface-design/system.md
```

`design_handoff_sift_refonte/README.md` line 169:

```bash
sed -i 's#docs/brief-refonte-ui-2026-07-01\.md#docs/superpowers/specs/2026-07-01-brief-refonte-ui.md#' design_handoff_sift_refonte/README.md
```

`docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md` (post-move path) — 2 self-references to the other moved file:

```bash
sed -i 's#docs/audit-fidelite-2026-07-02\.md#2026-07-02-audit-fidelite-ecran-par-ecran.md#g' \
  docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md
```

- [x] **Step 2: Verify no stale references remain in the live surfaces touched above**

Run:
```bash
grep -rn -e "audit/AUDIT-SIFT-PROMPT" -e "audit/DESIGN-REVIEW" -e "audit/HANDOFF-FIX1" \
  -e "audit/PLAN-FIX" -e "audit/PLAN-SIFT" -e "audit/RAPPORT-FINAL" -e "audit/RAPPORT-direction" \
  -e "audit/REVUE-UI-UX" -e "docs/brief-refonte-ui" -e "docs/refonte-ui-plan" \
  -e "docs/audit-conformite-m6b" -e "docs/audit-fidelite" -e "docs/handoff-verdict-card-titlebar" \
  -e "docs/session-handoff-2026-06-30" -e "docs/plans/2026-06-12-m0-scaffolding" \
  frontend/ README.md .interface-design/ design_handoff_sift_refonte/README.md \
  docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md
```
Expected: no output (empty).

Known, intentional exceptions (do NOT touch, do NOT expect them to disappear from a repo-wide grep): `docs/superpowers/plans/2026-07-02-revue-rail-layout-fix.md:18` and `docs/superpowers/plans/2026-07-03-m6b-lot5-audit-conformite.md:26,58,65` — historical plan content describing paths as they were when those plans were written and executed.

- [x] **Step 3: Commit**

```bash
git add frontend/filing.ts frontend/home-sources.ts frontend/library-detail.ts \
  frontend/report-view.ts frontend/sift-live.ts README.md .interface-design/system.md \
  design_handoff_sift_refonte/README.md docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md
git commit -m "docs: repair cross-references broken by docs/ reorg

Updates code comments and top-level docs that pointed at the old
audit/ and loose docs/ paths moved in the previous commit. Historical
superpowers/plans content describing paths as they were when written
is left untouched on purpose.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Create `docs/INDEX.json`

**Files:**
- Create: `docs/INDEX.json`

**Interfaces:**
- Consumes: final paths from Task 1
- Produces: `docs/INDEX.json`, consumed by Task 4 (CLAUDE.md `@import`)

- [x] **Step 1: Write the file**

```json
{
  "reference": [
    {"path": "docs/ressources-externes.md", "topic": "veille technique & décisions libs", "summary": "Veille outils/libs par jalon (M2-M8), évaluations spikes (Symphonia, chromaprint, master.db read/write), décisions d'architecture datées."},
    {"path": "docs/design-system-states.md", "topic": "états visuels réels par composant", "summary": "Catalogue des états (hover/actif/disabled...) de chaque composant CSS/TS réel — source de vérité pour tout portage design→code ; system.md périmé sur palette/typo."},
    {"path": "docs/skills-registre.md", "topic": "registre skills/agents/plugins", "summary": "Verdict par domaine (Rust, UI/design, revue de code...) sur quelle skill invoquer sur Sift, tenu à jour à la main."},
    {"path": "docs/plan-implementation.md", "topic": "plan d'implémentation actif", "summary": "Plan d'implémentation Sift par jalons M0-M8, mis à jour en continu (fichier actif, pas figé)."},
    {"path": "docs/brand-logo-direction.md", "topic": "direction logo & marque", "summary": "Direction logo validée (carrés ambre/vert en point du i, Outfit Bold) — production reportée."},
    {"path": "docs/chat-project-instructions.md", "topic": "instructions Claude Chat", "summary": "Miroir de CLAUDE.md pour les sessions Claude Chat (hors Claude Code) sur le projet Sift."}
  ],
  "specs": [
    {"path": "docs/superpowers/specs/2026-06-12-m1-watcher-queue-design.md", "date": "2026-06-12", "topic": "M1 watcher + file à traiter", "summary": "Design M1 (watcher + file à traiter), source de vérité fonctionnelle plan-implementation.md."},
    {"path": "docs/superpowers/specs/2026-06-12-m2a-analysis-engine-design.md", "date": "2026-06-12", "topic": "M2a moteur d'analyse", "summary": "Design du moteur d'analyse audio pur Rust (détection faux-lossless)."},
    {"path": "docs/superpowers/specs/2026-06-12-m2b-analysis-worker-design.md", "date": "2026-06-12", "topic": "M2b worker d'analyse", "summary": "Design du worker d'analyse en fond + cache DB, suite de M2a."},
    {"path": "docs/superpowers/specs/2026-06-12-m4-filing-loop-design.md", "date": "2026-06-12", "topic": "M4 filing loop", "summary": "Design de la boucle de rangement (encode+tag+file+trash+undo)."},
    {"path": "docs/superpowers/specs/2026-06-13-m5-dedup-design.md", "date": "2026-06-13", "topic": "M5 déduplication", "summary": "Design de la déduplication par empreinte acoustique (Chromaprint)."},
    {"path": "docs/superpowers/specs/2026-06-14-m6a-discogs-identification-design.md", "date": "2026-06-14", "topic": "M6a identification Discogs", "summary": "Design de l'identification Discogs (matching titre/année, renommage)."},
    {"path": "docs/superpowers/specs/2026-06-14-next-steps-brainstorm.md", "date": "2026-06-14", "topic": "cadrage pré-brainstorm", "summary": "Note de cadrage rédigée entre deux sessions — pas une spec — point de départ pour le brainstorm suivant après M6a."},
    {"path": "docs/superpowers/specs/2026-06-24-m6b-library-design.md", "date": "2026-06-24", "topic": "M6b onglet Bibliothèque", "summary": "Design de l'onglet Bibliothèque, périmètre basé sur app.js amélioré."},
    {"path": "docs/superpowers/specs/2026-07-01-brief-refonte-ui.md", "date": "2026-07-01", "topic": "brief refonte UI", "summary": "Brief refonte UI (layout à zones fixes, direction visuelle) à construire dans Claude Design."},
    {"path": "docs/superpowers/specs/2026-07-03-m7-rekordbox-xml-export-design.md", "date": "2026-07-03", "topic": "M7 export XML Rekordbox", "summary": "Design export XML Rekordbox + suivi playlists (bricks 1+2 fusionnées)."},
    {"path": "docs/superpowers/specs/2026-07-03-m7-usb-format-design.md", "date": "2026-07-03", "topic": "M7 formater clé USB", "summary": "Design de l'utilitaire Formater la clé USB."},
    {"path": "docs/superpowers/specs/2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md", "date": "2026-07-03", "topic": "lecteur SQLCipher master.db", "summary": "Design du lecteur SQLCipher pur Rust pour master.db Rekordbox, exploratoire hors M7."},
    {"path": "docs/superpowers/specs/2026-07-03-titlebar-os-detection-design.md", "date": "2026-07-03", "topic": "titlebar détection OS", "summary": "Design titlebar : détection OS + 2 gaps résiduels."},
    {"path": "docs/superpowers/specs/2026-07-04-docs-reorg-and-index-design.md", "date": "2026-07-04", "topic": "réorg docs + index JSON", "summary": "Design de cette réorganisation docs/audit + index JSON (méta, ce document)."},
    {"path": "docs/superpowers/specs/2026-07-04-review-fixes-design.md", "date": "2026-07-04", "topic": "3 fixes revue Steve Jobs", "summary": "Design des 3 fixes retenus après la revue Steve Jobs (verdict NOT DONE 7/10)."}
  ],
  "plans": [
    {"path": "docs/superpowers/plans/2026-06-12-m0-scaffolding.md", "date": "2026-06-12", "topic": "M0 scaffolding", "summary": "Plan M0 : scaffolding Tauri v2 + FFmpeg sidecar + SQLite + IPC typé."},
    {"path": "docs/superpowers/plans/2026-06-12-m1-watcher-queue.md", "date": "2026-06-12", "topic": "M1 watcher + file à traiter", "summary": "Plan M1 : watcher + file à traiter."},
    {"path": "docs/superpowers/plans/2026-06-12-m2a-analysis-engine.md", "date": "2026-06-12", "topic": "M2a moteur d'analyse", "summary": "Plan M2a : moteur d'analyse audio pur Rust."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-1-naming.md", "date": "2026-06-12", "topic": "M4-1 naming", "summary": "Plan M4-1 : naming & réconciliation."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-2-encode-tagging.md", "date": "2026-06-12", "topic": "M4-2 encode/tagging", "summary": "Plan M4-2 : encoder + tagging."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-3a-migration-settings-library.md", "date": "2026-06-12", "topic": "M4-3a migration/settings/library", "summary": "Plan M4-3a : migration DB v4 + settings + library (bins)."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-3b-actions-undo.md", "date": "2026-06-12", "topic": "M4-3b actions/undo", "summary": "Plan M4-3b : moteur actions/undo."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-3c-filing.md", "date": "2026-06-12", "topic": "M4-3c filing", "summary": "Plan M4-3c : orchestration du rangement (filing)."},
    {"path": "docs/superpowers/plans/2026-06-12-m4-4b-revue-live.md", "date": "2026-06-12", "topic": "M4-4b revue live", "summary": "Plan M4-4b : UI live de rangement dans l'écran Revue."},
    {"path": "docs/superpowers/plans/2026-06-13-m4b-ecartes.md", "date": "2026-06-13", "topic": "M4b Écartés", "summary": "Plan M4b : onglet Écartés (re-sourcer / corbeille)."},
    {"path": "docs/superpowers/plans/2026-06-14-m6a-discogs-identification.md", "date": "2026-06-14", "topic": "M6a identification Discogs", "summary": "Plan M6a : identification Discogs."},
    {"path": "docs/superpowers/plans/2026-06-24-m6b-lot1-parcourir.md", "date": "2026-06-24", "topic": "M6b Lot 1 parcourir", "summary": "Plan M6b Lot 1 : parcourir la bibliothèque."},
    {"path": "docs/superpowers/plans/2026-06-28-plan-sift-implementation.md", "date": "2026-06-28", "topic": "plan consolidé (périmé)", "summary": "Plan consolidé post RAPPORT-direction (25/06) — périmé, remplacé par plan-fix-post-audit (07-02)."},
    {"path": "docs/superpowers/plans/2026-06-29-batch-convergence-progress-journal.md", "date": "2026-06-29", "topic": "batch progress + journal", "summary": "Plan : progression par piste + journal d'actions en mode batch."},
    {"path": "docs/superpowers/plans/2026-06-29-batch-detail-convergence-reskin.md", "date": "2026-06-29", "topic": "batch↔détail reskin", "summary": "Plan : convergence visuelle Batch↔Détail (re-skin)."},
    {"path": "docs/superpowers/plans/2026-06-29-batch-reskin-iteration-2.md", "date": "2026-06-29", "topic": "batch reskin itération 2", "summary": "Plan : re-skin batch itération 2 (explorateur dossier, checkbox, preview nom)."},
    {"path": "docs/superpowers/plans/2026-06-29-batch-reskin-iteration-3.md", "date": "2026-06-29", "topic": "batch reskin itération 3", "summary": "Plan : re-skin batch itération 3, front pur."},
    {"path": "docs/superpowers/plans/2026-06-29-journal-actions.md", "date": "2026-06-29", "topic": "journal d'actions", "summary": "Plan : journal d'actions post-batch (toasts, revert)."},
    {"path": "docs/superpowers/plans/2026-07-02-plan-fix-post-audit.md", "date": "2026-07-02", "topic": "plan de correction post-audit", "summary": "Plan de correction séquencé, consolide RAPPORT-FINAL + PASS-0..9, remplace PLAN-SIFT.md."},
    {"path": "docs/superpowers/plans/2026-07-02-refonte-ui-plan.md", "date": "2026-07-02", "topic": "refonte UI, décisions actées", "summary": "Plan refonte UI : comparaison design_handoff_sift_refonte vs code réel, décisions actées 2026-07-02."},
    {"path": "docs/superpowers/plans/2026-07-02-revue-rail-layout-fix.md", "date": "2026-07-02", "topic": "rail Revue, fix de fidélité", "summary": "Plan (terminé) : rail Revue + ligne de queue + carte Identification, fix de fidélité."},
    {"path": "docs/superpowers/plans/2026-07-03-m6b-lot3-doublons.md", "date": "2026-07-03", "topic": "M6b Lot 3 doublons", "summary": "Plan M6b Lot 3 : doublons internes (Bibliothèque)."},
    {"path": "docs/superpowers/plans/2026-07-03-m6b-lot4-dashboard.md", "date": "2026-07-03", "topic": "M6b Lot 4 dashboard", "summary": "Plan M6b Lot 4 : dashboard Bibliothèque."},
    {"path": "docs/superpowers/plans/2026-07-03-m6b-lot5-audit-conformite.md", "date": "2026-07-03", "topic": "M6b Lot 5 audit conformité", "summary": "Plan M6b Lot 5 : audit de conformité maquette↔code."},
    {"path": "docs/superpowers/plans/2026-07-03-m7-rekordbox-xml-export.md", "date": "2026-07-03", "topic": "M7 export XML Rekordbox", "summary": "Plan M7 : export XML Rekordbox + suivi playlists."},
    {"path": "docs/superpowers/plans/2026-07-03-m7-usb-format.md", "date": "2026-07-03", "topic": "M7 formater clé USB", "summary": "Plan M7 : formater la clé USB."},
    {"path": "docs/superpowers/plans/2026-07-03-rekordbox-masterdb-sqlcipher-reader.md", "date": "2026-07-03", "topic": "lecteur SQLCipher master.db", "summary": "Plan : lecteur SQLCipher pur Rust master.db Rekordbox."},
    {"path": "docs/superpowers/plans/2026-07-03-titlebar-os-detection.md", "date": "2026-07-03", "topic": "titlebar détection OS", "summary": "Plan : titlebar détection OS + gaps résiduels."},
    {"path": "docs/superpowers/plans/2026-07-04-m8-masterdb-write-spike.md", "date": "2026-07-04", "topic": "M8 spike écriture master.db", "summary": "Plan : spike d'écriture master.db (validation avant code de prod)."},
    {"path": "docs/superpowers/plans/2026-07-04-review-fixes.md", "date": "2026-07-04", "topic": "fixes revue (queue/erreur/confirm)", "summary": "Plan : 3 fixes issus de la revue (virtualisation queue, bannière erreur lecture, overlay confirmation)."},
    {"path": "docs/superpowers/plans/2026-07-04-docs-reorg-and-index.md", "date": "2026-07-04", "topic": "réorg docs + index JSON", "summary": "Plan d'implémentation de cette réorganisation docs/audit + index JSON (méta, ce document)."}
  ],
  "reviews": [
    {"path": "docs/superpowers/reviews/2026-06-12-m4-review.md", "date": "2026-06-12", "topic": "revue multi-agent M4", "summary": "Revue multi-agent M4 (sécurité/archi/correctness) sur toute la boucle filing."},
    {"path": "docs/superpowers/reviews/2026-06-13-full-audit.md", "date": "2026-06-13", "topic": "audit complet code+UX", "summary": "Audit complet code+UX (3 agents revue + heuristiques Krug/Nielsen)."},
    {"path": "docs/superpowers/reviews/2026-06-14-m6a-audit.md", "date": "2026-06-14", "topic": "audit M6a code+UI/UX", "summary": "Audit M6a : code (clean-code/release-it/software-design) + UI/UX en parallèle."},
    {"path": "docs/superpowers/reviews/2026-06-25-rapport-direction-verdict.md", "date": "2026-06-25", "topic": "verdict de direction", "summary": "Verdict de direction : recadrage sur l'état réel du projet (M0-M6a livrés, pas M2 à faire), proposition chiffrée."},
    {"path": "docs/superpowers/reviews/2026-06-30-audit-sift-prompt.md", "date": "2026-06-30", "topic": "mission d'audit pré-commercialisation", "summary": "Mission/prompt d'audit complet pré-commercialisation (règles absolues, méthode détective)."},
    {"path": "docs/superpowers/reviews/2026-06-30-session-handoff.md", "date": "2026-06-30", "topic": "handoff de session", "summary": "État à la coupure du 30/06 : code committé jusqu'au re-skin batch+Journal+Trash centralisé."},
    {"path": "docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md", "date": "2026-07-01", "topic": "revue reskin écran Revue", "summary": "Revue du reskin écran Revue vs brief-refonte-ui + Sift.dc.html."},
    {"path": "docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md", "date": "2026-07-02", "topic": "audit fidélité écran par écran", "summary": "Audit de fidélité écran par écran : écarts trouvés malgré un plan refonte-ui déclaré clos."},
    {"path": "docs/superpowers/reviews/2026-07-02-rapport-final-audit-sift.md", "date": "2026-07-02", "topic": "rapport final audit pré-commercialisation", "summary": "Synthèse des 9 passes d'audit pré-commercialisation, notes /10 sévères."},
    {"path": "docs/superpowers/reviews/2026-07-02-handoff-fix1-anti-upscale.md", "date": "2026-07-02", "topic": "handoff FIX-1 anti-upscale", "summary": "Handoff FIX-1 (garde-fou anti-upscale) : backend fini/validé, frontend restant + suite du plan-fix."},
    {"path": "docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md", "date": "2026-07-03", "topic": "audit conformité M6b Lot 5", "summary": "Audit conformité maquette↔code M6b Lot 5, croisé avec design-system-states + audit-fidélité."},
    {"path": "docs/superpowers/reviews/2026-07-03-handoff-verdict-card-titlebar.md", "date": "2026-07-03", "topic": "handoff verdict card + titlebar", "summary": "Handoff verdict card + titlebar (générés via /design-handoff), source de vérité = code réel."},
    {"path": "docs/superpowers/reviews/2026-07-03-revue-ui-ux-parcours.md", "date": "2026-07-03", "topic": "revue UI/UX parcours réel", "summary": "Revue UI/UX de l'app réelle (6 écrans, dark+clair, mode détail/lot)."}
  ]
}
```

- [x] **Step 2: Validate it's well-formed JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/INDEX.json','utf8')); console.log('OK')"`
Expected: `OK`

- [x] **Step 3: Cross-check every path in the index actually exists**

Run (Git Bash):
```bash
node -e "
const idx = JSON.parse(require('fs').readFileSync('docs/INDEX.json','utf8'));
const fs = require('fs');
let missing = [];
for (const cat of Object.keys(idx)) {
  for (const entry of idx[cat]) {
    if (!fs.existsSync(entry.path)) missing.push(entry.path);
  }
}
console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'ALL PATHS EXIST');
"
```
Expected: `ALL PATHS EXIST`

- [x] **Step 4: Commit**

```bash
git add docs/INDEX.json
git commit -m "docs: add docs/INDEX.json catalog of every doc under docs/

Hand-maintained index (path/type/topic/summary), no generation
tooling — same discipline as MEMORY.md. Scoped to docs/ only, does
not duplicate the frontend/src-tauri file listings already in
CLAUDE.md prose.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire `docs/INDEX.json` into CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `docs/INDEX.json` from Task 3
- Produces: nothing further

- [x] **Step 1: Add the `@import` and a maintenance note**

Find this block in `CLAUDE.md`:

```markdown
## Décisions techniques
@docs/ressources-externes.md

## États réels des composants (portage design→code)
@docs/design-system-states.md
```

Replace with:

```markdown
## Décisions techniques
@docs/ressources-externes.md

## États réels des composants (portage design→code)
@docs/design-system-states.md

## Index des documents docs/
@docs/INDEX.json

Catalogue de chaque document sous `docs/` (racine + `superpowers/*`), par
catégorie (`reference`/`specs`/`plans`/`reviews`) avec chemin/topic/résumé —
pour trouver un doc sans lister/grep `docs/`. Maintenu à la main : à chaque
nouveau document créé sous `docs/` (brainstorming/writing-plans/code-review
ou manuel), ajouter son entrée ici dans le même geste, pas en rattrapage
différé.
```

- [x] **Step 2: Verify the edit**

Run: `grep -n "docs/INDEX.json" CLAUDE.md`
Expected: two matches (the `@import` line and the mention in the note).

- [x] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: load docs/INDEX.json automatically via CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [x] Run `git log --oneline -5` — expect 4 new commits from this plan, one per task, in order.
- [x] Run `git status --short` — expect clean (nothing uncommitted).
- [x] Re-run the Task 2 Step 2 grep — expect empty output (no stale references in live surfaces).

## Status: complete (2026-07-04)

Executed via subagent-driven-development, 4 tasks + 1 whole-branch review
fix. Commits: `979457a` (move, 1 fix round for commit scope), `45e6d2d`
(reference repair), `af4843f` (INDEX.json), `a05a3f5` (CLAUDE.md wiring),
`4243812` (final-review fix: dropped a dangling INDEX.json entry for
`docs/chat-project-instructions.md`, an untracked pre-existing file out of
scope for this plan). `tsc --noEmit` clean. Pushed to `origin/m6a-discogs`,
tracked by existing PR #1.
