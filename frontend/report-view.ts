// Shared analysis-report view (Tauri only): verdict, signals, waveform, on-demand
// spectrogram. Can render inline into a container (Revue #mid pane) or as a modal
// (debug button on an arbitrary picked file). Queries are scoped to a root element so
// inline + modal can't clash on ids.
import { analyzePath } from "./ipc";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import type { AnalysisReport } from "../shared/contracts";
import { requireEl } from "./dom";

const PEAKS_WINDOW = 512; // must match analysis::PEAKS_WINDOW

// Single live player at a time — destroyed before any re-render so audio never lingers.
let currentWs: WaveSurfer | null = null;
function destroyPlayer() {
  if (currentWs) {
    try {
      currentWs.destroy();
    } catch {
      /* already gone */
    }
    currentWs = null;
  }
}

/** Toggle play/pause on the current report player (for the Space keyboard shortcut). */
export function togglePlay() {
  void currentWs?.playPause();
}

// One-time hover styling for the clickable time display (inline styles can't do :hover).
function ensureStyles() {
  if (document.getElementById("sift-report-style")) return;
  const st = document.createElement("style");
  st.id = "sift-report-style";
  st.textContent =
    ".sift-time:hover{color:var(--color-text-primary)!important}" +
    "@keyframes sift-spin{to{transform:rotate(360deg)}}" +
    ".sift-spin{display:inline-block;animation:sift-spin 1s linear infinite}";
  document.head.appendChild(st);
}

const mmss = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

/** The file's REAL quality (what the audio actually is), derived from the analysis — shown
 * next to what it was declared as. */
function realQuality(r: AnalysisReport): { label: string; bg: string; fg: string } {
  // Real quality of a transcode, expressed as the equivalent MP3 bitrate. FIX-11: r.est_kbps is
  // computed in Rust from the SAME table verdict() uses — no local recompute, no risk of the two
  // numbers drifting apart (they used to, with a shifted table).
  if (r.verdict === "fake") {
    return {
      label: `MP3 ≈ ${r.est_kbps} kbps`,
      bg: "var(--color-background-danger)",
      fg: "var(--color-text-danger)",
    };
  }
  if (r.verdict === "grey")
    return { label: `MP3 ≈ ${r.est_kbps} kbps — à vérifier`, bg: "var(--color-background-warning)", fg: "var(--color-text-warning)" };
  // genuine: describe the actual quality, not a yes/no
  const real =
    r.declared_rail === "lossless"
      ? "lossless · pleine bande"
      : r.declared_bitrate
        ? `${r.declared_bitrate} kbps réels`
        : "qualité authentique";
  return { label: real, bg: "var(--color-background-success)", fg: "var(--color-text-success)" };
}

function spectroCaption(v: AnalysisReport["verdict"]): string {
  if (v === "fake") return "coupure nette = transcodage probable";
  if (v === "grey") return "à vérifier visuellement";
  return "énergie pleine bande = encodage conforme";
}

/** Audacity's own spectrogram convention (manual.audacityteam.org/man/spectrogram_view.html,
 *  default Color scheme): black (silence) → blue → magenta → orange → white (loudest). Not a
 *  percentile/gamma guess (tried both, 2026-07-06) — Audacity's real model is a fixed Gain/Range:
 *  content within GAIN_DB of full scale reads as pure white; the color gradient covers the
 *  RANGE_DB span below that ceiling; everything quieter is black. `val` is the quantized dB
 *  magnitude from the backend (0 = -100 dBFS, 255 = 0 dBFS, ~0.39dB/step). Known caveat: a
 *  separate backend bug (spectrum.rs's dB conversion isn't normalized against a true full-scale
 *  reference, see docs/superpowers — tracked as its own task) currently pins an unrealistic
 *  fraction of bins at the literal ceiling regardless of this mapping; this colormap is the
 *  correct target shape for once that's fixed, not a workaround for it. */
const SPECTRO_STOPS: readonly [number, number, number][] = [
  [0, 0, 0],
  [20, 20, 110],
  [130, 20, 140],
  [230, 110, 40],
  [255, 255, 255],
];
const SPECTRO_GAIN_DB = 20; // content within this many dB of full scale reads as pure white
const SPECTRO_RANGE_DB = 80; // span of the color gradient below that ceiling
const SPECTRO_CEILING_RAW = 255 - (SPECTRO_GAIN_DB / 100) * 255;
const SPECTRO_FLOOR_RAW = SPECTRO_CEILING_RAW - (SPECTRO_RANGE_DB / 100) * 255;

function spectroColor(val: number): [number, number, number] {
  const n = SPECTRO_STOPS.length - 1;
  const clamped = Math.min(255, Math.max(0, val));
  const norm = Math.max(
    0,
    Math.min(1, (clamped - SPECTRO_FLOOR_RAW) / (SPECTRO_CEILING_RAW - SPECTRO_FLOOR_RAW)),
  );
  const pos = norm * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const t = pos - i;
  const [r0, g0, b0] = SPECTRO_STOPS[i];
  const [r1, g1, b1] = SPECTRO_STOPS[i + 1];
  return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
}

function drawSpectrogram(canvas: HTMLCanvasElement, r: AnalysisReport) {
  const ctx = canvas.getContext("2d");
  const sg = r.spectrogram;
  if (!ctx || sg.frames === 0 || sg.bins === 0) return;
  // The canvas backing store was hardcoded to width="720" in the HTML while CSS stretches it to
  // 100% of its container (.sift-spectro-canvas) — most Revue panels render wider than 720px, so
  // the browser upscaled the low-res bitmap to fill the box, showing a blurry/pixelated "zoomed
  // in" spectrogram. Match the backing store to the real rendered width so 1 image px = 1 CSS px.
  const measuredW = Math.round(canvas.getBoundingClientRect().width);
  const w = measuredW > 0 ? measuredW : canvas.width;
  if (canvas.width !== w) canvas.width = w;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const f = Math.min(sg.frames - 1, Math.floor((x / w) * sg.frames));
    for (let y = 0; y < h; y++) {
      const b = Math.min(sg.bins - 1, Math.floor(((h - 1 - y) / h) * sg.bins));
      const val = sg.mag_db[f * sg.bins + b] || 0;
      const [cr, cg, cb] = spectroColor(val);
      const i = (y * w + x) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const nyquist = sg.bins * sg.hz_per_bin;
  if (r.cutoff_hz > 0 && nyquist > 0) {
    const y = h - (r.cutoff_hz / nyquist) * h;
    // Verdict-toned instead of a hardcoded alarm red: a cutoff sitting near Nyquist on a genuine
    // full-band file reads as the same "success" green used everywhere else in the app, while a
    // real lossy cliff (fake) still reads as danger — the line now carries meaning instead of
    // always looking like an alarm regardless of what it's actually reporting.
    const toneVar =
      r.verdict === "fake"
        ? "--color-text-danger"
        : r.verdict === "grey"
          ? "--color-text-warning"
          : "--color-text-success";
    const color = getComputedStyle(canvas).getPropertyValue(toneVar).trim() || "#ff5050";

    // Dashed, slightly transparent: reads as a reference/threshold annotation layered over the
    // data rather than a solid line competing with the actual spectrogram detail.
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();

    // Label on a dark pill background, not bare text: cutoff sits right where the loud high end
    // drops off, so bare colored text directly on the spectrogram was a real contrast risk.
    const label = `cutoff ${(r.cutoff_hz / 1000).toFixed(1)} kHz`;
    ctx.font = "11px monospace";
    const textW = ctx.measureText(label).width;
    const padX = 6;
    const padY = 4;
    const boxW = textW + padX * 2;
    const boxH = 11 + padY * 2;
    const boxX = 6;
    const boxY = y - 4 - boxH >= 2 ? y - 4 - boxH : y + 4;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, boxX + padX, boxY + boxH - padY - 2);
  }
}

function peaksCoverage(r: AnalysisReport): string {
  const sr = r.sample_rate || 44100;
  const covered = (r.peaks.length * PEAKS_WINDOW) / sr;
  const pct = r.duration_sec > 0 ? (covered / r.duration_sec) * 100 : 0;
  return `${r.peaks.length} pts ≈ ${covered.toFixed(1)}s / ${r.duration_sec.toFixed(1)}s (${pct.toFixed(0)}%)`;
}

export function row(label: string, value: string): string {
  return `<div class="sift-row"><span class="sift-row-label">${label}</span><span class="sift-row-value">${value}</span></div>`;
}

// ── HTML helpers ────────────────────────────────────────────────────────────

/** Keyboard-hint row for the bottom action rail (filing.ts), matching the board's `kbd` line —
 *  the maquette anchors these to the rail, not the scrollable detail content. */
export function keyboardHintsHtml(): string {
  const k = (key: string, what: string) => `<span><b>${key}</b> ${what}</span>`;
  return (
    `<div class="sift-kbd-hints">` +
    k("SPACE", "écouter") + k("ENTER", "ranger") + k("BKSP", "jeter") + k("HAUT/BAS", "naviguer") +
    `</div>`
  );
}

/** Single header, folded into the player card itself (2026-07-02: the standalone Hero above the
 *  player was pure duplication — same title/artist/path, twice). Cover (real art once identified,
 *  a minimalist vinyl placeholder via `.sift-cover-frame`'s CSS until then) + title + artist ·
 *  version + raw path, optionally a close button (`openReportModal`'s popup only). Keeps the
 *  shared `.sift-report-cover`/`.sift-report-name`/`.sift-report-sub` hooks that filing.ts writes
 *  into (cover src on identify, clean displayName on reconcile). */
/** Last 2 segments of a path ("…\parent\file.aiff"), so the ellipsis truncation (CSS
 *  text-overflow, which cuts from the right) never hides the filename — the one part of the
 *  raw path actually worth reading. Full path stays available via the title tooltip
 *  (audit UI/UX 2026-07-03, fix 7). */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…${parts.slice(-2).join("/")}` : path;
}

interface PlayerHeaderOptions {
  deferText?: boolean;
  title?: string;
  subtitle?: string;
  showAnalysisFailure?: boolean;
}

function playerHeaderHtml(name: string, path: string, closeBtn: boolean, opts: PlayerHeaderOptions = {}): string {
  const pendingCls = opts.deferText ? " sift-report-text-pending" : "";
  return (
    `<div class="sift-player-header">` +
    `<div class="sift-cover-frame">` +
    // Abstract note glyph, not a literal vinyl (annotation: "l'icone fait trop redondant avec le
    // bouton play... un délire plus minimaliste vectoriel"). Two adjacent circular shapes (the
    // play button + a drawn vinyl disc) read as duplicated; a plain icon sidesteps that entirely.
    `<i class="ti ti-music-note sift-cover-fallback" aria-hidden="true"></i>` +
    `<img class="sift-report-cover sift-player-cover" hidden alt="Pochette — ${esc(name)}">` +
    `</div>` +
    `<div class="sift-player-header-body">` +
    `<div class="sift-report-name sift-player-name${pendingCls}">${esc(name)}</div>` +
    `<div class="sift-report-sub sift-player-sub${pendingCls}">${esc(opts.subtitle ?? "")}</div>` +
    `<div class="sift-player-path" title="${esc(path)}">${esc(shortPath(path))}</div>` +
    `</div>` +
    (closeBtn ? `<button class="sift-close sift-report-close">fermer</button>` : "") +
    `</div>`
  );
}

function playerRowHtml(name: string, path: string, closeBtn = false, headerOpts: PlayerHeaderOptions = {}): string {
  return (
    `<div class="sift-player-row">` +
    playerHeaderHtml(name, path, closeBtn, headerOpts) +
    `<div class="sift-player-audition">` +
    `<button class="sift-play sift-play-btn" title="Lecture / pause (espace)" aria-label="Lecture / pause (espace)"><i class="ti ti-player-play"></i></button>` +
    `<div class="sift-wave-wrap is-paused">` +
    `<div class="sift-wave sift-player-wave"></div>` +
    `<div class="sift-wave-hover"></div>` +
    `<span class="sift-time-elapsed">0:00</span>` +
    `<span class="sift-time-total">0:00</span>` +
    `</div>` +
    `</div>` +
    `<div class="sift-player-error" hidden></div>` +
    `<div class="sift-player-controls">` +
    // Collapsed to an icon at rest, expands on hover (annotation: "le bouton de volume qui
    // collapse et qui s'ouvre seulement en hover") — width-transition + overflow:hidden in CSS,
    // the icon is a separate absolutely-positioned element that fades out once expanded.
    // "Volume" label dropped (annotation: "tu peux enlever le texte Volume et grossir l'icone") —
    // the icon alone is the trigger/identity now.
    `<div class="sift-slider-block sift-volume-block">` +
    // ti-volume-2 swapped for the plainer ti-volume (annotation: "pas fan de l'icone de volume") —
    // a simpler speaker glyph, no sound-wave arcs, consistent with the flat/abstract direction
    // already taken for the cover fallback.
    `<i class="ti ti-volume sift-volume-icon" title="Volume" aria-label="Volume"></i>` +
    `<div class="sift-slider-track sift-volume-track">` +
    `<div class="sift-slider-rail"></div>` +
    `<div class="sift-slider-fill sift-volume-fill"></div>` +
    `<div class="sift-slider-thumb sift-volume-thumb"></div>` +
    `</div></div>` +
    `<div class="sift-player-spacer"></div>` +
    `<div class="sift-key-block" title="Key-lock : le tempo ne change pas la tonalité (off = varispeed)">` +
    `<span class="sift-slider-label">Key-lock</span>` +
    `<button class="sift-key sift-key-btn">ON</button>` +
    `</div>` +
    `<div class="sift-slider-block">` +
    `<span class="sift-slider-label">Tempo<span class="sift-tempo-out">0%</span></span>` +
    `<div class="sift-slider-track sift-tempo-track" title="Tempo — double-clic = réinitialiser">` +
    `<div class="sift-slider-rail"></div>` +
    `<div class="sift-slider-fill sift-tempo-fill"></div>` +
    `<div class="sift-slider-thumb sift-tempo-thumb"></div>` +
    `</div></div>` +
    `</div></div>`
  );
}

type ChipTone = "success" | "neutral" | "danger" | "warning";

function toneCss(tone: ChipTone): string {
  return tone === "success"
    ? "background:var(--color-background-success);color:var(--color-text-success)"
    : tone === "danger"
      ? "background:var(--color-background-danger);color:var(--color-text-danger)"
      : tone === "warning"
        ? "background:var(--color-background-warning);color:var(--color-text-warning)"
        : "background:var(--overlay-selected);color:var(--color-text-secondary)";
}

/** A verdict-panel chip: `success` = green-tinted (LOSSLESS), `neutral` = white@.06 (MATCH/UNIQUE),
 *  matching the Penpot `badge-*` shapes (see .interface-design/penpot-detail-spec.md). */
export function vchipHtml(label: string, tone: ChipTone): string {
  return `<span class="sift-vchip" style="${toneCss(tone)}">${esc(label)}</span>`;
}

/** Shared zone-toggle header (Métadonnées in filing.ts, Preuve/spectre below) — one markup shape
 *  so the two disclosures can't quietly drift again. Audit 2026-07-05 found the Preuve toggle's
 *  own label wrapper (flex gap + a literal leading space) added spacing on top of
 *  `.sift-zone-toggle-car`'s margin that the Métadonnées toggle didn't have, and its badge reused
 *  `.sift-vchip` (inline-flex + letter-spacing) instead of the plain `.sift-chip-badge` box the
 *  CDJ badge uses — same class name, different box model. */
export function zoneToggleHtml(opts: {
  label: string;
  badgeId: string;
  toggleId?: string;
  toggleExtraClass?: string;
  caretExtraClass?: string;
  hintExtraClass?: string;
  badgeLabel?: string;
  badgeTone?: ChipTone;
  badgeHidden?: boolean;
}): string {
  const toggleCls = opts.toggleExtraClass
    ? `sift-zone-toggle ${opts.toggleExtraClass}`
    : "sift-zone-toggle";
  const carCls = opts.caretExtraClass
    ? `sift-zone-toggle-car ${opts.caretExtraClass}`
    : "sift-zone-toggle-car";
  const hintCls = opts.hintExtraClass
    ? `sift-zone-toggle-hint ${opts.hintExtraClass}`
    : "sift-zone-toggle-hint";
  const badgeHidden = opts.badgeHidden ?? true;
  const badgeStyle = opts.badgeTone ? ` style="${toneCss(opts.badgeTone)}"` : "";
  // No "afficher"/"masquer" text: the caret already rotates on toggle and the button carries
  // aria-expanded, so that was pure redundancy (user feedback 2026-07-06). The hint span itself
  // stays, empty by default — Preuve's version still needs it for transient "calcul…"/"échec —
  // réessayer" text while the spectrogram is being computed (wireSpectrogram in this file), which
  // has no other UI feedback path. Métadonnées never sets it, so it just stays empty there.
  return (
    `<button class="${toggleCls}"${opts.toggleId ? ` id="${opts.toggleId}"` : ""} aria-expanded="false">` +
    // Confirmed by annotation (2nd round — see docs/superpowers/specs, continuous-surface
    // redesign): a permanent pill around the label, not just the generic button:hover rect that
    // only appeared transiently on hover. This is the label's own pill, distinct from the
    // conclusion's status pill (.sift-verdict-pill) — both are legitimate "bulles", just for
    // different things (section identity vs. status).
    `<span><span class="${carCls}">▸</span><span class="sift-zone-toggle-pill">${opts.label}</span></span>` +
    `<span class="sift-zone-toggle-right">` +
    `<span class="sift-chip-badge" id="${opts.badgeId}"${badgeStyle}${badgeHidden ? " hidden" : ""}>${esc(opts.badgeLabel ?? "")}</span>` +
    `<span class="${hintCls}"></span>` +
    `</span>` +
    `</button>`
  );
}

/** ACTUAL verdict panel: the CONCLUSION, a single status "bulle" (pill) — sitting on the
 *  inspector's own continuous surface, no full-bleed tinted panel anymore (2026-07-06 redesign;
 *  superseded the tinted-panel treatment). Nom final moved OUT of here entirely, into the rail
 *  (filing.ts renderFoot, .sift-rail-final-group). This ONLY reflects the audio verdict now — an
 *  earlier "À finaliser" state (verdict ok but no destination chosen yet) was tried and reverted
 *  (annotation: "on ne comprend pas ce qui reste à finaliser ? Redondant ?") — the pill alone
 *  couldn't explain WHAT needed finalizing, and it duplicated the Destination button's own
 *  "Choisir…" CTA, which is the actual, self-explanatory place that signal belongs. */
// Removed entirely (annotation: "supprime ça en fait") — the verdict pill (Prêt à ranger/À
// vérifier d'abord/Sur-encodé) duplicated the tone-coded quality badge already shown in the
// Diagnostic audio disclosure header (qualityChipTone/spectroAndTagsHtml below), same pattern as
// the earlier removals of the confidence badge and CHECK MATCH this session. `verdictContainer`
// (`.sift-fil-verdict`) still exists and is still used for the "Analyse en cours…"/error states
// elsewhere in this file — only the success-path HTML this function used to build is gone; kept
// as a no-op (not deleted outright) so those call sites don't need touching.
export function verdictCardHtml(_r: AnalysisReport): string {
  return "";
}

/** Quality label + tone for the spectral-disclosure header badge (verdict-derived: LOSSLESS,
 *  "MP3 ≈ X kbps", etc.) — single source consumed by spectroAndTagsHtml() below. */
function qualityChipTone(r: AnalysisReport): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
  const rq = realQuality(r);
  if (r.verdict === "ok" && r.declared_rail === "lossless") return { label: "LOSSLESS", tone: "success" };
  return { label: rq.label, tone: r.verdict === "fake" ? "danger" : r.verdict === "grey" ? "warning" : "neutral" };
}

function spectroAndTagsHtml(r: AnalysisReport): string {
  const yn = (b: boolean) => (b ? "oui" : "non");
  const { label: qualityLabel, tone: qualityTone } = qualityChipTone(r);
  return (
    `<div class="sift-spectro-box">` +
    zoneToggleHtml({
      label: "Diagnostic audio",
      badgeId: "sift-quality-badge",
      toggleExtraClass: "sift-sg-toggle sift-spectro-toggle",
      caretExtraClass: "sift-sg-caret sift-spectro-caret",
      hintExtraClass: "sift-sg-hint sift-spectro-hint",
      badgeLabel: qualityLabel,
      badgeTone: qualityTone,
      badgeHidden: false,
    }) +
    `<div class="sift-sg-body sift-spectro-body">` +
    `<div class="sift-spectro-body-inner">` +
    `<div class="sift-spectro-declared">Déclaré <span class="pill">${esc(r.declared_format)}</span> ${r.declared_rail}${r.declared_bitrate ? " · " + r.declared_bitrate + " kbps" : ""} · coupure ${fmt(r.cutoff_hz, 0)} Hz — ${spectroCaption(r.verdict)}</div>` +
    `<canvas class="sift-sg sift-spectro-canvas" width="720" height="180"></canvas>` +
    `<div class="sift-spectro-rows">` +
    row("Verdict", r.verdict) +
    row("Coupure", fmt(r.cutoff_hz, 0) + " Hz") +
    row("Durée", fmt(r.duration_sec, 1) + " s") +
    row("Canaux", String(r.channels) + (r.dual_mono ? " (dual-mono)" : "")) +
    row("True-peak", fmt(r.true_peak_dbtp, 2) + " dBTP") +
    row("DC offset", fmt(r.dc_offset, 5)) +
    row("Écrêtage", r.clip_runs + " runs / " + fmt(r.clip_pct, 2) + "%") +
    row("Corrélation de phase", fmt(r.phase_correlation, 3)) +
    row("Silence début", r.silence_head_ms + " ms") +
    row("Silence fin", r.silence_tail_ms + " ms") +
    row("Tronqué", yn(r.truncated)) +
    row("Conteneur OK", yn(r.container_ok)) +
    row("Fréquence d'échantillonnage", r.sample_rate + " Hz") +
    row("Pics (couverture)", peaksCoverage(r)) +
    `</div></div></div></div>` +
    // Tags CDJ OK / Version ID3 moved to the Identification card (filing.ts, alongside Label/
    // Année/Genre) — Pochette dropped entirely (redondant avec la pochette déjà visible dans le
    // hero). Nothing meaningful was left in the old "Tags" box, so it's gone too; codec_error is
    // its own standalone diagnostic, not tied to those three fields.
    (r.codec_error ? `<div class="sift-codec-error">erreur codec : ${esc(r.codec_error)}</div>` : "")
  );
}

/** Report HTML minus the verdict conclusion (name + player row + spectrogram/tags). The verdict
 *  is rendered separately, after Identification, by the caller (see `verdictContainer` on
 *  `openReportInto`/`renderReportInto`) — it's the CONCLUSION and must come last, right above
 *  the action rail, matching the maquette. `openReportModal` (no Identification card) appends
 *  `verdictCardHtml` itself, right after this. */
function reportHtml(r: AnalysisReport, closeBtn: boolean, headerOpts: PlayerHeaderOptions = {}): string {
  const name = headerOpts.title ?? (r.path.split(/[\\/]/).pop() || r.path);
  return (
    playerRowHtml(name, r.path, closeBtn, headerOpts) +
    spectroAndTagsHtml(r)
  );
}

/** Wrap a decoded AudioBuffer as an in-memory 16-bit PCM WAV blob (lossless container swap;
 * AIFF and WAV are both PCM). The player no longer uses this (it streams via the media
 * element); kept for selftest.ts, which exercises the decode → WAV → wavesurfer chain. */
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const blockAlign = numCh * 2;
  const dataLen = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, dataLen, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Resolve a URL the webview's media element can play directly: the file itself for the
 * formats Chromium decodes natively (mp3/wav/flac/m4a/ogg), or the backend's cached WAV
 * transcode for AIFF (`playback_url`, mtime-guarded temp file, re-encoded only when stale).
 * The old path here fetched the WHOLE file into an ArrayBuffer, decoded it fully with Web
 * Audio, then re-encoded a 40-80MB WAV blob sample-by-sample in JS — for every format, on
 * every cache-miss open. The media element streams instead; with pre-computed peaks passed
 * to `ws.load` there is nothing left to decode up-front. */
async function playableUrl(path: string): Promise<string> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "aif" || ext === "aiff") return invoke<string>("playback_url", { path });
  return path;
}

/** Point the player's media element at the track (streaming, no up-front decode). `peaks`/
 * `duration` (from the Rust analysis report) let wavesurfer render without decoding audio;
 * without them (fresh, never-analyzed track) wavesurfer decodes for display itself.
 * Each await yields the event loop; the user may switch tracks meanwhile, which destroys
 * this ws and creates a new currentWs — bail so we never load into a destroyed instance. */
async function loadAudio(ws: WaveSurfer, path: string, peaks?: number[], duration?: number): Promise<void> {
  try {
    const src = await playableUrl(path);
    if (ws !== currentWs) return;
    await ws.load(convertFileSrc(src), peaks?.length ? [peaks] : undefined, duration || undefined);
  } catch (e) {
    if (ws !== currentWs) return; // AbortError from a track switch mid-load: expected, silent
    console.error("audio load failed", e);
  }
}

/** Warm everything the NEXT track's open needs, so queue navigation feels instant: the
 * analysis report (verdict + peaks — a DB hit when the worker already analyzed it) and,
 * for AIFF, the backend's transcoded WAV. Failures are silent by design: a prefetch must
 * never surface UI errors — the real open retries and reports. Called from the queue-open
 * sites at most once per user track-switch (not a burst event). */
export function prefetchTrack(path: string): void {
  if (!reportCache.has(path)) {
    void analyzePath(path, false)
      .then((r) => reportCache.set(path, r))
      .catch(() => {});
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "aif" || ext === "aiff") void invoke<string>("playback_url", { path }).catch(() => {});
}

/** Mounts a wavesurfer player on the report's player row. Tempo uses the browser's native
 * time-stretch (`preservesPitch`) for key-lock — adequate for the ±8% DJ nudge; SoundTouch.js
 * was evaluated and skipped (would require re-architecting playback to Web Audio for marginal
 * gain at this range). See docs/ressources-externes.md.
 * `peaks` and `duration` (from the Rust analysis report) render the waveform instantly AND
 * spare wavesurfer its own display decode; audio streams via the media element (loadAudio). */
async function mountPlayer(root: HTMLElement, path: string, peaks?: number[], duration?: number) {
  const container = requireEl<HTMLElement>(".sift-wave", "mountPlayer", root);
  const playBtn = root.querySelector<HTMLButtonElement>(".sift-play");
  const tempoOut = root.querySelector<HTMLElement>(".sift-tempo-out");
  const volumeTrack = root.querySelector<HTMLElement>(".sift-volume-track");
  const volumeFill = root.querySelector<HTMLElement>(".sift-volume-fill");
  const volumeThumb = root.querySelector<HTMLElement>(".sift-volume-thumb");
  const tempoTrack = root.querySelector<HTMLElement>(".sift-tempo-track");
  const tempoFill = root.querySelector<HTMLElement>(".sift-tempo-fill");
  const tempoThumb = root.querySelector<HTMLElement>(".sift-tempo-thumb");
  const errorEl = root.querySelector<HTMLElement>(".sift-player-error");

  ensureStyles();
  destroyPlayer();
  // WaveSurfer draws to canvas, so it needs resolved color strings, not var(--x) references —
  // same read-at-mount pattern already used for the spectrogram cutoff line (drawSpectrogram
  // below). --overlay-bar is the theme-aware "translucent bar" token (used for .qi.cur's accent
  // bar) — a semantic fit for the unplayed wave bars, and theme-aware unlike the old hardcoded
  // rgba(255,255,255,.35) (annotation: "aligne la couleur de la waveform sur notre color system"
  // — that literal only worked by accident in dark mode, invisible in light). Progress keeps
  // --color-waveform-elapsed, the dedicated (theme-fixed by design) waveform accent token.
  const cs = getComputedStyle(root);
  const waveColor = cs.getPropertyValue("--overlay-bar").trim() || "rgba(255,255,255,.35)";
  const progressColor = cs.getPropertyValue("--color-waveform-elapsed").trim() || "#ff5500";
  const ws = WaveSurfer.create({
    container,
    height: 58, // bumped from 46 (continuous-surface redesign, 2026-07-06) — larger hero waveform
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    cursorWidth: 0,
    waveColor,
    progressColor,
    normalize: true,
    peaks: peaks?.length ? [peaks] : undefined,
    duration: duration || undefined,
  });
  currentWs = ws;
  void loadAudio(ws, path, peaks, duration);

  const setIcon = (name: string) => {
    const i = playBtn?.querySelector("i");
    if (i) i.className = `ti ti-${name}`;
  };
  const keyEl = root.querySelector<HTMLButtonElement>(".sift-key");
  let keyLock = true; // DJ default: tempo doesn't move the pitch (browser time-stretch)
  let tempoValue = 0; // -8..8, drives both playback rate and the custom slider visuals
  const applyRate = () => ws.setPlaybackRate(1 + tempoValue / 100, keyLock);
  const refreshKey = () => {
    if (!keyEl) return;
    keyEl.textContent = keyLock ? "ON" : "OFF";
    keyEl.style.background = keyLock ? "var(--color-background-info)" : "transparent";
    keyEl.style.color = keyLock ? "var(--color-text-info)" : "var(--color-text-tertiary)";
    keyEl.style.borderColor = keyLock ? "var(--color-border-info)" : "var(--color-border-tertiary)";
  };
  keyEl?.addEventListener("click", () => {
    keyLock = !keyLock;
    refreshKey();
    applyRate();
  });
  refreshKey();

  // Custom sliders (never native <input type=range> — see DESIGN.md): drag anywhere on the
  // track, thumb/fill follow the mouse until release. Volume fills from the left; tempo fills
  // from the centre (0 = neutral), matching the pitch-fader convention.
  const dragSlider = (track: HTMLElement, onMove: (pct: number) => void) => {
    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      onMove(Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))));
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      track.classList.add("dragging");
      track.setPointerCapture(e.pointerId);
      update(e.clientX);
      const onPointerMove = (ev: PointerEvent) => update(ev.clientX);
      const stopDragging = (ev: PointerEvent) => {
        track.classList.remove("dragging");
        if (track.hasPointerCapture(ev.pointerId)) track.releasePointerCapture(ev.pointerId);
        track.removeEventListener("pointermove", onPointerMove);
        track.removeEventListener("pointerup", stopDragging);
        track.removeEventListener("pointercancel", stopDragging);
      };
      track.addEventListener("pointermove", onPointerMove);
      track.addEventListener("pointerup", stopDragging);
      track.addEventListener("pointercancel", stopDragging);
    });
  };

  const renderVolume = (pct: number) => {
    if (volumeFill) volumeFill.style.width = `${pct * 100}%`;
    if (volumeThumb) volumeThumb.style.left = `${pct * 100}%`;
  };
  renderVolume(1); // WaveSurfer's own default (full volume)
  if (volumeTrack) {
    dragSlider(volumeTrack, (pct) => {
      ws.setVolume(pct);
      renderVolume(pct);
    });
  }

  let tempoRateFrame: number | null = null;
  const scheduleTempoRate = () => {
    if (tempoRateFrame != null) return;
    tempoRateFrame = window.requestAnimationFrame(() => {
      tempoRateFrame = null;
      applyRate();
    });
  };

  const renderTempo = (syncAudio = true) => {
    const pct = ((tempoValue + 8) / 16) * 100;
    if (tempoFill) {
      const left = Math.min(pct, 50);
      tempoFill.style.left = `${left}%`;
      tempoFill.style.width = `${Math.abs(pct - 50)}%`;
    }
    if (tempoThumb) tempoThumb.style.left = `${pct}%`;
    if (tempoOut) tempoOut.textContent = `${tempoValue > 0 ? "+" : ""}${Math.round(tempoValue)}%`;
    if (syncAudio) scheduleTempoRate();
  };
  renderTempo();
  if (tempoTrack) {
    dragSlider(tempoTrack, (pct) => {
      // Rounding tempoValue to the nearest whole percent on every mousemove (annotation: "encore
      // sticky") snapped the thumb across one of only 17 fixed positions instead of following the
      // cursor, unlike the volume slider's continuous ws.setVolume(pct) — that discreteness is what
      // read as "sticky"/notchy. Keep the underlying value continuous (smooth drag, smooth pitch
      // change); only the displayed "%" text rounds, in renderTempo above.
      tempoValue = Math.max(-8, Math.min(8, -8 + pct * 16));
      renderTempo();
    });
    tempoTrack.addEventListener("dblclick", () => {
      tempoValue = 0;
      renderTempo(false);
      applyRate();
    });
  }
  // SoundCloud-style: elapsed (left) + remaining (right) shown at once, overlaid on the waveform
  // itself — no elapsed/remaining toggle needed since both are always visible together. The
  // right side counts DOWN (duration - elapsed), not a static total, so it actually ticks.
  const timeElapsedEl = root.querySelector<HTMLElement>(".sift-time-elapsed");
  const timeTotalEl = root.querySelector<HTMLElement>(".sift-time-total");
  const updateTime = () => {
    if (timeElapsedEl) timeElapsedEl.textContent = mmss(ws.getCurrentTime());
    if (timeTotalEl) timeTotalEl.textContent = `-${mmss(Math.max(0, ws.getDuration() - ws.getCurrentTime()))}`;
  };
  ws.on("ready", () => {
    applyRate();
    updateTime();
    if (errorEl) errorEl.hidden = true;
  });
  ws.on("timeupdate", updateTime);

  // Waveform dims a touch while paused (and re-lights on hover, so scrubbing/seeking a paused
  // track still reads clearly) — `.is-paused` starts set in the HTML (nothing is playing yet).
  const waveWrapEl = root.querySelector<HTMLElement>(".sift-wave-wrap");
  ws.on("play", () => {
    setIcon("player-pause");
    waveWrapEl?.classList.remove("is-paused");
  });
  ws.on("pause", () => {
    setIcon("player-play");
    waveWrapEl?.classList.add("is-paused");
  });
  ws.on("finish", () => {
    setIcon("player-play");
    waveWrapEl?.classList.add("is-paused");
  });

  // Hover-scrub preview: recolor the waveform's own bars from the start up to the cursor (no
  // extra rectangle/line drawn on top) — dimmer than the actual orange playhead fill. WaveSurfer
  // renders into a shadow-DOM canvas (bars opaque, gaps transparent); `waveHoverEl` is a plain
  // absolutely-positioned div, alpha-masked to a live snapshot of that same canvas so only the
  // bar pixels — not the gaps between them — pick up the tint as its width tracks the cursor.
  const waveHoverEl = root.querySelector<HTMLElement>(".sift-wave-hover");
  const findWaveCanvas = (): HTMLCanvasElement | null =>
    container.querySelector<HTMLElement>(":scope > div")?.shadowRoot?.querySelector("canvas") ?? null;
  const updateWaveMask = () => {
    if (!waveHoverEl) return;
    const canvas = findWaveCanvas();
    if (!canvas) return;
    try {
      // The live bars are drawn translucent (waveColor ~.35 alpha) — used as-is that would mask
      // the overlay down to a near-invisible tint. Binarize instead: any pixel the bars touch at
      // all becomes fully opaque in the mask, so the overlay reads at its own full strength on
      // every bar pixel and stays at zero everywhere in the gaps between them.
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const mctx = maskCanvas.getContext("2d");
      if (!mctx) return;
      mctx.drawImage(canvas, 0, 0);
      const img = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) d[i] = 255;
      mctx.putImageData(img, 0, 0);
      const url = `url(${maskCanvas.toDataURL()})`;
      const rect = canvas.getBoundingClientRect();
      const size = `${rect.width}px ${rect.height}px`;
      for (const prop of ["mask", "-webkit-mask"]) {
        waveHoverEl.style.setProperty(`${prop}-image`, url);
        waveHoverEl.style.setProperty(`${prop}-repeat`, "no-repeat");
        waveHoverEl.style.setProperty(`${prop}-size`, size);
        waveHoverEl.style.setProperty(`${prop}-position`, "0 0");
      }
      // WaveSurfer rounds its rendered canvas down to a whole number of bar+gap units, so it's
      // often a few pixels narrower than `.sift-wave-wrap` itself — a static `left:6px`/`right:6px`
      // on the pills would then float past the wave's real edges. Anchor them to the canvas's
      // own measured edges instead, so they track it exactly regardless of that rounding.
      if (waveWrapEl) {
        const wrapRect = waveWrapEl.getBoundingClientRect();
        if (timeElapsedEl) timeElapsedEl.style.left = `${Math.round(rect.left - wrapRect.left) + 6}px`;
        if (timeTotalEl) timeTotalEl.style.right = `${Math.round(wrapRect.right - rect.right) + 6}px`;
      }
    } catch {
      // getImageData/toDataURL can throw on a tainted canvas — hover preview just stays unmasked.
    }
  };
  ws.on("redrawcomplete", updateWaveMask);
  if (waveHoverEl) {
    container.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      waveHoverEl.style.width = `${pct * 100}%`;
    });
    container.addEventListener("mouseleave", () => {
      waveHoverEl.style.width = "0";
    });
  }
  ws.on("error", (e) => {
    console.error("wavesurfer error", e);
    // route to the Rust log so it shows in the dev console (webview console isn't readable here)
    void invoke("report_smoke", { ok: false, detail: `wavesurfer ${path}: ${String(e)}` });
    // Audio loads via loadAudio (native media element, AIFF pre-transcoded backend-side),
    // so there's nothing further to retry here — just surface the error.
    if (errorEl) {
      errorEl.textContent = "Lecture impossible — fichier illisible.";
      errorEl.hidden = false;
    }
  });
  playBtn?.addEventListener("click", () => void ws.playPause());
}

/** Wires the spectrogram toggle inside `root` (extracted so it can be called
 * independently of player mounting — used after async analysis fill-in). */
function wireSpectrogram(root: HTMLElement, r: AnalysisReport) {
  const sg = root.querySelector<HTMLCanvasElement>(".sift-sg");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  const qualityBadge = root.querySelector<HTMLElement>("#sift-quality-badge");
  if (!sg || !toggle || !body || !caret || !hint) return;

  let open = false, loaded = false, busy = false;
  toggle.addEventListener("click", async () => {
    if (busy) return;
    if (open) {
      open = false;
      body.classList.remove("is-open");
      caret.style.transform = "";
      return;
    }
    if (!loaded) {
      busy = true;
      hint.textContent = "calcul…";
      try {
        const full = r.spectrogram.frames > 0 ? r : await analyzePath(r.path, true);
        drawSpectrogram(sg, full);
        loaded = true;
      } catch (e) {
        console.error("spectrogram analyze failed", e);
        hint.textContent = "échec — réessayer";
        busy = false;
        return;
      }
      busy = false;
      hint.textContent = ""; // clear the transient "calcul…" now that it's loaded
    }
    open = true;
    caret.style.transform = "rotate(90deg)";
    body.classList.add("is-open");
  });
}

/** Wires the player + spectrogram toggle inside `root` (scoped — no global ids). */
function wireReport(root: HTMLElement, r: AnalysisReport) {
  mountPlayer(root, r.path, r.peaks, r.duration_sec);
  wireSpectrogram(root, r);
}

/** Renders the report INLINE into `container` (e.g. the Revue #mid pane). `verdictContainer`,
 *  when given, gets the verdict conclusion card instead of `container` — see `openReportInto`. */
export function renderReportInto(
  container: HTMLElement,
  r: AnalysisReport,
  verdictContainer?: HTMLElement,
  headerOpts: PlayerHeaderOptions = {},
) {
  container.innerHTML = `<div class="sift-report-scroll">${reportHtml(r, false, headerOpts)}</div>`;
  if (verdictContainer) verdictContainer.innerHTML = verdictCardHtml(r);
  wireReport(container, r);
}

// In-session report cache (path → report). Backend already caches in the DB; this skips even
// the IPC round-trip + loading spinner on revisits, so switching back to a track is instant.
const reportCache = new Map<string, AnalysisReport>();

/** Drops the in-session cache so the next open re-fetches from the backend (DB is the source
 *  of truth). Call when analysis results may have changed (e.g. the `analysis:changed` event)
 *  so a re-analysed or replaced file isn't served stale. */
export function clearReportCache(path?: string) {
  if (path) reportCache.delete(path);
  else reportCache.clear();
  // No decoded-audio cache to drop anymore: the player streams the file (or the backend's
  // mtime-guarded AIFF transcode), so a replaced file is never replayed stale from JS memory.
}

// Monotonic token: the latest openReportInto call wins. A slow analyse that resolves after the
// user already switched tracks must not overwrite the newer content in the shared container.
let openSeq = 0;

/** Loads (no spectrogram) and renders inline into `container`. Instant when cached.
 *
 * The player is mounted IMMEDIATELY from the path alone, before analysis completes.
 * This eliminates the "player never mounts" race: the old design awaited analyzePath
 * before mounting, and a background event bumping openSeq during that await caused the
 * seq-guard to abort the whole render (player included). Now the seq-guard only aborts
 * the analysis fill-in — the player is already running and stays untouched. */
export async function openReportInto(
  container: HTMLElement,
  path: string,
  verdictContainer?: HTMLElement,
  headerOpts: PlayerHeaderOptions = {},
): Promise<AnalysisReport | null> {
  destroyPlayer();
  ensureStyles();
  const seq = ++openSeq;

  const cached = reportCache.get(path);
  if (cached) {
    renderReportInto(container, cached, verdictContainer, headerOpts);
    return cached;
  }

  const name = headerOpts.title ?? (path.split(/[\\/]/).pop() || path);

  // Fire analysis IPC immediately. For already-analyzed tracks the DB round-trip takes ~20ms.
  const analysisPromise = analyzePath(path, false);

  // Render the player shell. Son-first order: player (header+audition) → proof (Preuves). The
  // verdict conclusion goes LAST, above the action rail — in `verdictContainer` when the caller
  // supplies one (filing.ts/library-detail.ts, both of which insert Identification between here
  // and their own verdict slot), else in a `.sift-verdict-stub` kept inside this same scroll
  // (openReportModal, which has no Identification card of its own). Filled in later (seq-guarded).
  const verdictHost = () => verdictContainer ?? container.querySelector<HTMLElement>(".sift-verdict-stub");
  container.innerHTML =
    `<div class="sift-report-scroll">` +
    playerRowHtml(name, path, false, headerOpts) +
    `<div class="sift-analysis-body" hidden></div>` +
    (verdictContainer ? "" : `<div class="sift-verdict-stub"></div>`) +
    `</div>`;

  // Race the analysis against a short timeout. For already-analyzed tracks (DB cache hit)
  // we win the race and can pass peaks to WaveSurfer.create() — which renders the waveform
  // instantly from the pre-computed data. For fresh tracks the timeout fires first and we
  // mount without peaks so audio starts loading while analysis runs in the background.
  // 300ms (not 20-80ms): the DB hit itself is fast, but the full invoke round-trip (IPC
  // dispatch + JSON (de)serialization of the report incl. the peaks array) regularly exceeds
  // 80ms in a `tauri dev` debug build, which was tripping the timeout — and showing the
  // "Analyse en cours…" stub — for tracks that were in fact already analyzed.
  const earlyResult = await Promise.race([
    analysisPromise.catch((): null => null),
    new Promise<null>((res) => setTimeout(() => res(null), 300)),
  ]) as AnalysisReport | null;

  if (seq !== openSeq) return null;

  if (earlyResult) {
    reportCache.set(path, earlyResult);
    // Pass peaks to the constructor — the only path that renders the waveform immediately.
    void mountPlayer(container, path, earlyResult.peaks, earlyResult.duration_sec || undefined);
    const verdictEl = verdictHost();
    const bodyEl = container.querySelector<HTMLElement>(".sift-analysis-body");
    if (verdictEl) verdictEl.innerHTML = verdictCardHtml(earlyResult);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(earlyResult);
      bodyEl.hidden = false;
      wireSpectrogram(container, earlyResult);
    }
    return earlyResult;
  }

  // Timeout fired — this is a genuinely fresh track (no DB cache to hit), so the wait is
  // real. Only now does the loader text get shown.
  const pendingEl = verdictHost();
  if (pendingEl) {
    pendingEl.innerHTML = `<i class="ti ti-loader-2 sift-spin"></i>Analyse en cours…`;
  }
  void mountPlayer(container, path);

  try {
    const r = await analysisPromise;
    reportCache.set(path, r);
    if (seq !== openSeq) return null;
    const verdictEl = verdictHost();
    const bodyEl = container.querySelector<HTMLElement>(".sift-analysis-body");
    if (verdictEl) verdictEl.innerHTML = verdictCardHtml(r);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(r);
      bodyEl.hidden = false;
      wireSpectrogram(container, r);
    }
    return r;
  } catch (e) {
    console.error("analyze_path failed", e);
    if (seq !== openSeq) return null;
    const verdictEl = verdictHost();
    if (verdictEl && headerOpts.showAnalysisFailure !== false) {
      verdictEl.innerHTML =
        `<div class="sift-analysis-fail">Échec de l'analyse : ${esc(String(e))}</div>`;
    }
    return null;
  }
}

const OVERLAY_ID = "sift-report-overlay";

/** Modal version, for the debug button (a file not in the queue). */
export async function openReportModal(path: string) {
  destroyPlayer();
  ensureStyles();
  document.getElementById(OVERLAY_ID)?.remove();
  const ov = document.createElement("div");
  ov.id = OVERLAY_ID;
  ov.className = "sift-report-overlay";
  ov.addEventListener("click", (e) => {
    if (e.target === ov) {
      destroyPlayer();
      ov.remove();
    }
  });
  document.body.appendChild(ov);
  const name = path.split(/[\\/]/).pop() || path;
  ov.innerHTML = `<div class="sift-report-overlay-card sift-report-overlay-loading"><i class="ti ti-loader-2 sift-spin"></i>Analyse de <strong>${esc(name)}</strong>…</div>`;
  try {
    const r = await analyzePath(path, false);
    const card = document.createElement("div");
    card.className = "sift-report-overlay-card sift-report-overlay-modal";
    card.innerHTML = reportHtml(r, true) + verdictCardHtml(r);
    ov.innerHTML = "";
    ov.appendChild(card);
    card.querySelector(".sift-close")?.addEventListener("click", () => {
      destroyPlayer();
      ov.remove();
    });
    wireReport(card, r);
  } catch (e) {
    console.error("analyze_path failed", e);
    ov.innerHTML = `<div class="sift-report-overlay-card sift-report-overlay-error">Échec de l'analyse : ${esc(String(e))}</div>`;
  }
}
