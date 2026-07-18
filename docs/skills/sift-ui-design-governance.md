# Sift UI Design Governance Skill

> Source suivie par Git pour la skill locale
> `.agents/skills/sift-ui-design-governance/SKILL.md`. `.agents/` est ignore par
> Git, donc ce fichier conserve le contenu canonique cote repo.

```yaml
name: sift-ui-design-governance
description: Enforce Sift-specific UI/UX, design-system, theme, layout, and user-flow governance. Use for any Sift task that designs, implements, audits, polishes, or reviews UI in the real Tauri app; changes frontend/styles.css, frontend/*.ts rendering, docs/mockups, visual hierarchy, spacing, colors, dark/light theme, navigation, Revue flow, "A finaliser", Diagnostic audio, Metadonnees, or final verification after UI work.
```

## Purpose

Use this skill to keep Sift UI work aligned with the real product architecture:
user need -> journey -> UX -> UI -> performance -> code.

This skill is a process guardrail. It does not replace the design system docs.
It tells Codex which Sift sources to read, which decisions to preserve, and what
must be true before a UI task is considered done.

## First Reads

Before acting, read only the relevant parts:

1. `~/.claude/skills-view.md` for skill/agent inventory, `.claude/rules/context-packs.md` for task-scoped packs.
2. `docs/design-system/governance.md` for Sift UI process and verification.
3. `docs/design-system/foundations.md` for product/user intent.
4. `docs/design-system/components.md` and `docs/design-system/patterns.md` for
   the touched surface.
5. `docs/design-system/tokens.md` plus `frontend/styles.css` for theme/tokens.
6. `docs/design-system-states.md` for existing component states.
7. The real rendering files, usually `frontend/report-view.ts`,
   `frontend/filing.ts`, `frontend/chrome.ts`, and `frontend/styles.css`.

Do not use `docs/mockups/` as source of truth. Mockups are exploration only.

## Routing

Preserve the Sift routing model:

- Retouch/polish existing UI: use `impeccable`, then `interface-design`.
- Post-implementation design audit: use `design-review` when available.
- New significant UI chantier: use `design-flow` when available.
- Quick pre-code exploration of a direction: `enhance-prompt` ->
  `stitch-generate-design` -> look at the result -> if satisfying,
  `stitch-extract-static-html` and hand-port to vanilla TS/existing tokens.
- Accessibility/perf quick reference: use `ui-ux-pro-max` only for the relevant
  quick-reference parts.
- Refactor/legacy UI code: use `working-with-legacy-code`,
  `refactoring-patterns`, and `clean-code` when available.
- Never invoke `design-taste-frontend` on Sift (marketing/landing scope, out
  of scope for this dense desktop product).

If a listed skill is unavailable, say so briefly and continue from the project
docs. Never invent a parallel process.

## Workflow

1. State the user decision the UI must support.
2. Map the current real implementation and DOM/CSS contracts before editing.
3. Preserve existing product contracts, especially:
   - the real app is the design surface;
   - `frontend/styles.css` is the token source of truth;
   - `#filfoot` and `#fldz` remain siblings of `.mid` in Revue;
   - Tauri-only UI must be verified in the real app, not a browser mockup.
4. Make the smallest production-code change that improves the user journey.
5. Remove decorative structure before adding new structure.
6. Verify and update documentation when behavior, components, tokens, or patterns
   changed.

## Sift UI Rules

- Favor continuous surfaces over card stacks.
- Use panels only for real structural or floating surfaces.
- Keep Diagnostic audio above Metadonnees in the Revue decision flow unless a
  fresh product reason says otherwise.
- Keep Destination visible in "A finaliser"; it answers where the track goes.
- Show Nom final after Format, because Format changes the extension.
- Do not duplicate warnings across sections.
- Do not color neutral categories like "Signal" and "Conteneur" as warnings.
- Do not use permanent saturated success color for an already-confirmed state.
- Do not use `window.confirm()`, `alert()`, or `prompt()` for destructive or
  costly actions.
- Do not add side-stripe accent borders.
- Animate `transform` or `opacity`, not layout properties.

## Done Checklist

Before final response on a UI/design task:

1. The implementation matches the real app architecture, not only a mockup.
2. The user flow is explicit: what decision became easier?
3. Tokens come from `frontend/styles.css`; no parallel theme was created.
4. Existing component states were preserved or intentionally updated.
5. Layout spacing is coherent by category: screen, section, group, row, value.
6. Color communicates state, not decoration.
7. Keyboard/action rail contracts still make sense.
8. `npx tsc --noEmit` was run if TypeScript changed, or the skipped verification
   is stated.
9. `docs/design-system-*`, `docs/design-system/`, or `docs/INDEX.json` were
   updated if the design system changed.

