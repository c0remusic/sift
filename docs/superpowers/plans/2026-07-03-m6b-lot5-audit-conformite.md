# M6b Lot 5 — Audit de conformité maquette↔code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a written gap list comparing the already-built real screens (Accueil, Revue-détail, Écartés, Bibliothèque) against their mockup counterparts in `frontend/app.js`, so any real divergence can be triaged and fixed later. This task produces a document, not application code.

**Architecture:** Read `frontend/app.js`'s `renderHome`, `renderRevue`/detail rendering, `renderEcarts`, and `renderBiblio` functions (the frozen browser mockup — never edited, source of visual intent) side by side with the real implementations (`frontend/home-sources.ts`, `frontend/report-view.ts`, `frontend/ecartes-view.ts`, `frontend/sift-live.ts` + `frontend/library-detail.ts`). List every real divergence (missing control, different data shown, different action) — not cosmetic differences already logged as intentional in `docs/design-system-states.md`.

**Tech Stack:** Read-only code audit + Markdown doc. No Rust/TS changes.

## Global Constraints

- Do not edit `frontend/app.js`, `frontend/home-sources.ts`, `frontend/report-view.ts`, `frontend/ecartes-view.ts`, `frontend/sift-live.ts`, or `frontend/library-detail.ts` — this is a read-only audit. If a genuine bug is found, list it in the output doc; do not fix it inline (that risks colliding with the Lot 3/Lot 4 branches also in flight).
- Cross-check every claimed gap against `docs/design-system-states.md` first — several "differences" (e.g. dark waveform/spectrogram staying visually fixed regardless of theme) are already documented as intentional, not gaps.
- Cross-check also against the 2026-07-03 "audit-fidélité" session already logged in memory (`sift-audit-fidelite-methode`) for Accueil/Revue — do not re-report what was already fixed there; focus on what's still open plus the Bibliothèque screen (never audited this way before, since it postdates that session).
- Method: cite a concrete line/function in `app.js` AND the real file for every claim (per `sift-audit-fidelite-methode`: never declare "conforme" or "gap" without citing a line).

---

### Task 1: Produce the gap-list document

**Files:**
- Read: `frontend/app.js` (functions `renderHome`, `renderRevue` or equivalent detail render, `renderEcarts`, `renderBiblio`)
- Read: `frontend/home-sources.ts`, `frontend/report-view.ts`, `frontend/ecartes-view.ts`, `frontend/sift-live.ts` (Bibliothèque section, `renderBiblioLive` + the `#pa` `data-bib` handlers), `frontend/library-detail.ts`
- Read: `docs/design-system-states.md`, `docs/superpowers/specs/2026-06-24-m6b-library-design.md`
- Create: `docs/audit-conformite-m6b-2026-07-03.md`

**Interfaces:**
- Consumes: nothing from other tasks (this plan has one task).
- Produces: a Markdown report file. No code interfaces.

- [ ] **Step 1: Read the four mockup functions in `app.js`**

Find each with:
```bash
grep -n "function renderHome\|function renderRevue\|function renderEcarts\|function renderBiblio" frontend/app.js
```
Read each function fully (from its `function` line to its closing brace) to build a list of every control, data field, and action it shows.

- [ ] **Step 2: Read the corresponding real implementation for each screen**

For each of the four screens, read the real render function end-to-end:
- Accueil → `frontend/home-sources.ts` (main render function)
- Revue détail → `frontend/report-view.ts` (main render/open functions)
- Écartés → `frontend/ecartes-view.ts` (main render function)
- Bibliothèque → `frontend/sift-live.ts` `renderBiblioLive` (~line 1098) + `frontend/library-detail.ts` (detail/edit panel)

- [ ] **Step 3: Diff each screen and classify every difference**

For each screen, produce a table: `Élément maquette (app.js:LINE) | Réel (file.ts:LINE) | Statut`. Statut is one of:
- `Conforme` — present and behaviorally equivalent (may be visually improved, per the project's "mockup-first, improve" principle — that is not a gap).
- `Amélioré` — real code does strictly more/better than the mockup (e.g. real waveform vs. fake mockup bars) — not a gap, note it as context.
- `Écart` — the mockup shows/does something the real screen does not, with no design decision on record explaining the removal. This is the only category that goes into the final gap list.
- `Déjà documenté` — matches something already listed in `docs/design-system-states.md` or the 2026-07-03 audit-fidélité memory as an intentional/known state — cite the exact doc line, skip it.

- [ ] **Step 4: Write the report**

Create `docs/audit-conformite-m6b-2026-07-03.md` with one section per screen (Accueil, Revue-détail, Écartés, Bibliothèque), each containing the diff table from Step 3, followed by a top-level "Écarts à corriger" section listing only the `Écart`-classified rows, each with a one-line suggested fix and its file:line.

If a screen has zero `Écart` rows, say so explicitly ("Aucun écart réel trouvé — voir table ci-dessus pour Conforme/Amélioré/Déjà documenté") rather than omitting the section.

- [ ] **Step 5: Commit**

```bash
git add docs/audit-conformite-m6b-2026-07-03.md
git commit -m "docs(m6b): audit de conformité maquette/code (Accueil/Revue/Écartés/Bibliothèque)"
```
