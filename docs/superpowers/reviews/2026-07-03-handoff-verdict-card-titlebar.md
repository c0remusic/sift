# Handoff — Verdict Card & Titlebar

> Generated via `/design-handoff`. Two targets, chosen 2026-07-03: the verdict
> card (existing component, formalized from real code) and the custom titlebar
> (existing Windows-only implementation + the not-yet-started cross-platform
> gap). Source of truth for both: the actual `.ts`/`.css` files, not
> `Sift.dc.html` or `app.js` (see `docs/design-system-states.md` for why).

---

## Handoff Spec: Verdict Card

### Overview
The core of Sift's signature feature (faux-lossless detection). Shown at the
top of the Revue screen after analysis completes. Tells the DJ, in one glance,
whether a file is safe to file as-is, needs re-sourcing, or needs manual
review — plus the computed final filename. Rendered by
`verdictCardHtml()` in [report-view.ts:258](../frontend/report-view.ts:258).

### Layout
Single-row flex card, no responsive breakpoints (desktop app, fixed-ish
window). Two zones split by `margin-left:auto` on the right column:
- Left (`flex:1`): icon + status label, stacked above nothing else (chips live
  in a separate sibling block, see below).
- Right (`flex:none;max-width:46%`): "Nom final" label + computed filename,
  right-aligned, truncated with ellipsis if too long.

### Design Tokens Used
| Token | Value (light) | Usage |
|-------|-------|-------|
| `--color-background-success` | `rgba(76,123,87,.14)` | Card background, verdict = `ok` |
| `--color-background-danger` | `rgba(176,122,40,.14)` | Card background, verdict = `fake` (amber, not red — see palette note below) |
| `--color-background-warning` | `rgba(176,122,40,.14)` | Card background, verdict = `grey` |
| `--color-text-success` | `#3f6d4c` | Icon + label color, verdict = `ok` |
| `--color-text-danger` | `#8f6318` | Icon + label color, verdict = `fake` |
| `--color-text-warning` | `#8f6318` | Icon + label color, verdict = `grey` |
| `--color-text-tertiary` | `#8A857D` | "Nom final" caption label |
| `--font-mono` | (mono stack) | Final filename, `11.5px` |
| `--border-radius-lg` | `10px` | Card corners |

**Palette note**: `danger` and `warning` are the *same* amber
(`--color-text-danger` === `--color-text-warning` === `#8f6318`) — a
deliberate 2026-07 decision, not a bug. Sift's palette has exactly two
semantic hues (green = ok, amber = doubt/error); there is no third "true red"
state. Do not introduce one when implementing.

### Components
| Component | Variant | Notes |
|-----------|---------|-------|
| `.sift-verdict-card` | `ok` / `fake` / `grey` | Background set via inline `style`, not a CSS class per variant — color comes from a JS map (`report-view.ts:259-263`), not CSS |
| `.sift-vchip` (in sibling `.sift-evidence` block) | `success` / `neutral` / `danger` / `warning` | LOSSLESS + CDJ-compat chips, rendered by `evidenceChipsHtml()`, appended to later by `filing.ts` (MATCH%, UNIQUE/DUPLICATE) |

### States and Interactions
| Element | State | Behavior |
|---------|-------|----------|
| Card | `verdict: "ok"` | Green tint, ✓ icon (`ti-circle-check`), label "Prêt à ranger" |
| Card | `verdict: "fake"` | Amber tint, ⚠ icon (`ti-alert-triangle`), label "Sur-encodé — à re-sourcer" |
| Card | `verdict: "grey"` | Amber tint, ? icon (`ti-help-circle`), label "À vérifier d'abord" |
| Card | none (static, no hover/focus) | Purely informational, not interactive — no click target on the card itself |
| Final name | overflow | Truncates with `text-overflow:ellipsis`, no wrap, no tooltip on truncation (gap — see Edge Cases) |

There is no loading or empty state for the verdict card itself — it only
renders once `AnalysisReport` data exists; the caller shows a separate
skeleton/waveform-loading state upstream (see [report-view.ts:341](../frontend/report-view.ts:341) comment
on structure).

### Responsive Behavior
Not applicable — Sift is a fixed-shell desktop app (Tauri), no breakpoints
defined for this card. If the window is narrowed enough that `max-width:46%`
on the filename column starts fighting the left column, `flex-wrap:wrap` is
set on `.sift-verdict-card`, so the filename column drops to its own line
rather than clipping the label.

### Edge Cases
- **Very long final filename**: truncates silently with ellipsis, no
  `title=""` attribute for a hover tooltip — a real gap if a DJ needs to read
  the full name (worth a follow-up: add `title` bound to the same string).
- **Missing/errored analysis** (`r.codec_error` set): handled *outside* this
  card, in a separate `.sift-codec-error` block below the spectrogram
  ([report-view.ts:337](../frontend/report-view.ts:337)) — the verdict card
  still renders with whatever partial verdict was computed.
- **Verdict `grey`**: intentionally ambiguous framing ("à vérifier d'abord")
  rather than a hard pass/fail — the product decided not to force a binary
  call when confidence is low.

### Animation / Motion
None — the card is static once rendered. No transition on verdict-tint change
(a verdict, once computed, doesn't change live in front of the user).

### Accessibility Notes
- Icon (`<i class="ti ...">`) has no `aria-label`/`aria-hidden` — it's
  decorative alongside the adjacent text label, so it should be
  `aria-hidden="true"` (currently unmarked — minor gap, icon font glyphs are
  otherwise exposed to screen readers as arbitrary Unicode).
- Color is not the only signal: icon shape differs per verdict (check vs.
  triangle vs. question mark) — passes the "don't rely on color alone" check.
- No keyboard interaction needed (non-interactive card).

---

## Handoff Spec: Custom Titlebar

### Overview
Frameless-window titlebar (native decorations off via
`"decorations": false` in `tauri.conf.json:21`), replaced with a custom HTML
bar so the app can own its full chrome. **Current state (verified against
code, 2026-07-03): Windows-style implementation exists and works** — `min`/
`max`/`close` buttons on the right ([chrome.ts:112-137](../frontend/chrome.ts:112)).
**Not implemented**: macOS traffic-light variant and OS-based control
placement — `tauri-plugin-os` is not in `Cargo.toml` or `package.json`
(verified via grep). This spec covers finishing the cross-platform gap.

### Layout
- Bar: `height:30px`, full width, flex row, `justify-content:space-between`.
- Left: `#sift-tb-title` ("Sift"), `padding-left:13px`.
- Right (Windows) / Left (macOS target): `#sift-tb-controls`, each button
  `44px × 30px` (100% bar height).
- App shell (`#pa`) is shrunk by `calc(100vh - 30px)` to avoid clipping under
  the bar (`chrome.ts:108`).

### Design Tokens Used
| Token | Value | Usage |
|-------|-------|-------|
| `--color-background-tertiary` | `#EDE9E2` (light) | Titlebar background |
| `--color-text-tertiary` | `#8A857D` | Title text + idle button icon color |
| `--color-background-secondary` | `#F1EDE7` | Button hover background (min/max, not close) |
| `--text-sm` | (size token) | Title text size |

**Not tokenized (flag for the OS-detection work)**: the close button's hover
state is a hardcoded `#e81123` (Windows' own red) at
[chrome.ts:106](../frontend/chrome.ts:106) — this is a legitimate exception
(matches Windows OS convention exactly, must NOT be swapped for the app's
green/amber palette), but on macOS the equivalent hover convention is
different (traffic-light dot fills in, doesn't need a background swap) — the
close-hover rule must be OS-conditional, not shared.

### Components
| Component | Variant | Props | Notes |
|-----------|---------|-------|-------|
| `.sift-win` button | `min` / `max` / `close` | `data-win` attribute drives the click handler (`chrome.ts:131-134`) | Icons via Tabler (`ti-minus`/`ti-square`/`ti-x`) |
| `#sift-titlebar` | — | `data-tauri-drag-region` | Whole bar + title span are drag regions; buttons are excluded automatically (interactive elements inside a drag region don't inherit it) |

**To add for macOS**: a control-set variant with 3 colored dots (traffic
lights), positioned left instead of right, using `tauri-plugin-os` to detect
`platform() === "macos"` at bar-injection time and branch the DOM/class
applied to `#sift-tb-controls`.

### States and Interactions
| Element | State | Behavior |
|---------|-------|----------|
| `.sift-win` (min/max) | Hover | `background: var(--color-background-secondary)`, icon color → `--color-text-primary` |
| `.sift-win-close` | Hover | `background:#e81123` (Windows red), icon → white — **OS-specific, do not reuse for macOS** |
| `.sift-win` | Click `min` | `getCurrentWindow().minimize()` |
| `.sift-win` | Click `max` | `getCurrentWindow().toggleMaximize()` (no visual maximize/restore icon swap currently — same square icon regardless of window state, a gap) |
| `.sift-win` | Click `close` | `getCurrentWindow().close()` |
| Bar / title | Drag | Moves the window (`data-tauri-drag-region`) |

### Responsive Behavior
Fixed 30px height regardless of window size — no breakpoints. Button count
and layout don't change with window width.

### Edge Cases
- **Window already maximized**: the `max` button icon stays `ti-square`
  (doesn't switch to a "restore" glyph) — should be addressed alongside the
  OS work since macOS traffic lights have their own maximize semantics
  (zoom, not maximize) that differ from Windows.
- **Very narrow window**: title text has no truncation rule
  (`white-space`/`text-overflow` unset on `#sift-tb-title`) — long window
  titles (currently just the static string "Sift", so not exercised today,
  but a future dynamic title would overflow into the controls).

### Animation / Motion
None currently. No transition on button hover backgrounds (instant swap).

### Accessibility Notes
- All 3 buttons already have both `title` and `aria-label` (fixed
  2026-07-03, see `docs/design-system-states.md` titlebar entry) — no gap
  here.
- Icons (`<i class="ti ...">`) inside the buttons are redundant with the
  `aria-label` on the parent button — should be `aria-hidden="true"` to avoid
  double-announcing (same minor gap pattern as the verdict card icon above).
- No documented keyboard path to trigger minimize/maximize/close (OS-native
  shortcuts like Win+Down still work at the OS level since window management
  itself is real, but there's no in-app keyboard handler) — likely fine since
  OS shortcuts already cover this, just noting it's unverified.

### Implementation Notes for the Cross-Platform Gap
1. Add `tauri-plugin-os` (Rust crate + JS binding) — its **only** job here is
   `platform()` detection, per the existing decision in
   `docs/ressources-externes.md` ("Titlebar custom" section).
2. Branch `injectTitlebar()` ([chrome.ts:114](../frontend/chrome.ts:114)) on
   platform: macOS → 3-dot control set, positioned before the title (left
   side); Windows (and presumably Linux, unverified) → keep current
   right-side implementation unchanged.
3. Keep `decorations:false` and the `data-tauri-drag-region` wiring — those
   don't change per-OS.
4. This is a real chantier per CLAUDE.md ("prévu, pas démarré") — route
   through `design-flow` or `impeccable` per the project's UI routing rules
   before implementing, not ad-hoc.
