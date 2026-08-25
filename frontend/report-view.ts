// Shared analysis-report view (Tauri only): verdict, signals, waveform, on-demand
// spectrogram. Can render inline into a container (Revue #mid pane) or as a modal
// (debug button on an arbitrary picked file). Queries are scoped to a root element so
// inline + modal can't clash on ids.
import { analyzePath } from "./ipc";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import type { AnalysisReport } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { durationText, hfDensityText, hfTopDensityText } from "./report-figures";

/** Fallback step, only for a report predating `peaks_step` (mirrors analysis::PEAKS_WINDOW and
 *  analysis::default_peaks_step). Never use it when the report carries its own step: the envelope
 *  is max-pooled above analysis::MAX_PEAKS points, so the real step is a multiple of this. */
const PEAKS_WINDOW_FALLBACK = 512;

// Volume = COPIE DIRECTE de l'export SVG du kit macOS Big Sur (Antoine 2026-08-25 : « tu as juste
// à copier les éléments des svg »). On inline ses éléments TELS QUELS — rect piste (blanc @10% +
// inner-shadow), rect remplissage, cercle pouce (+ drop-shadow), path haut-parleur barré — dans un
// viewBox 0 0 112 24 (piste large de 112 au lieu des 256 du kit ; tout le reste identique :
// hauteur 22, inset 1px, pouce r10, icône ancrée à x≈6). renderVolume ne touche QUE `width` du
// remplissage et `cx` du pouce. L'icône reste speaker.slash de l'export (le kit l'affiche à tous
// les niveaux — c'est le glyphe du contrôle, pas un indicateur d'état).
// SEUL ÉCART À LA COPIE (2026-08-25) : les trois ENCRES — remplissage, pouce, glyphe — ne sont plus
// des attributs de présentation en dur (blanc / blanc / #464646) mais des tokens, posés par
// .sift-vol-fill / .sift-vol-knob / .sift-volume-icon dans styles.css. Motif mesuré dans la vraie
// fenêtre : le remplissage blanc du kit ne vaut que 1,45:1 contre sa piste en thème CLAIR (12,67:1
// en sombre), sous le 3:1 que WCAG 1.4.11 demande à un composant d'interface — or c'est CE
// contraste-là qui dit le niveau. Géométrie, rayons et les deux filtres restent la copie exacte.
// Le rationale complet et le choix des tokens sont au-dessus de .sift-vol-fill (styles.css).
const SPK_SLASH =
  "M13.5728 12.0239V6.52393C13.5728 6.1748 13.3203 5.89014 12.9551 5.89014C12.7026 5.89014 12.5361 6.00293 12.2568 6.26074L10.0977 8.26416C10.0708 8.28564 10.0386 8.30713 10.0063 8.30713H9.84521L13.5728 12.0239ZM15.4258 15.9287C15.5869 16.0898 15.8555 16.0898 16.0112 15.9287C16.1724 15.7622 16.1724 15.5044 16.0112 15.3433L6.81592 6.14795C6.65479 5.98682 6.38623 5.98682 6.2251 6.14795C6.06396 6.30371 6.06396 6.57764 6.2251 6.7334L15.4258 15.9287ZM8.27148 12.8081H9.80225C9.85596 12.8081 9.89893 12.8242 9.93652 12.8564L12.2568 15.0264C12.5093 15.2627 12.7134 15.3647 12.9604 15.3647C13.2397 15.3647 13.4492 15.2251 13.5352 14.9189L7.41211 8.80127C7.25635 8.97852 7.17578 9.24707 7.17578 9.60693V11.6641C7.17578 12.4429 7.54102 12.8081 8.27148 12.8081Z";
// Filtres du kit, copiés depuis 100%.svg : inner-shadow de la piste, drop-shadow du pouce. Seule
// différence : la région du drop-shadow est élargie à toute la largeur (x0 w112) pour suivre le
// pouce mobile (le kit la fixait à la position 100%).
const VOL_DEFS =
  `<defs>` +
  `<filter id="sift-vol-inner" x="0" y="0" width="112" height="22" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"></feFlood><feBlend mode="normal" in="SourceGraphic" in2="bg" result="shape"></feBlend><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix><feMorphology radius="2" operator="erode" in="SourceAlpha" result="inner"></feMorphology><feOffset></feOffset><feGaussianBlur stdDeviation="2.5"></feGaussianBlur><feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"></feComposite><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"></feColorMatrix><feBlend mode="normal" in2="shape" result="inner"></feBlend></filter>` +
  `<filter id="sift-vol-drop" x="0" y="0" width="112" height="24" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"></feFlood><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix><feMorphology radius="1" operator="dilate" in="SourceAlpha" result="drop"></feMorphology><feOffset dy="1"></feOffset><feGaussianBlur stdDeviation="0.5"></feGaussianBlur><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"></feColorMatrix><feBlend mode="normal" in2="bg" result="drop"></feBlend><feBlend mode="normal" in="SourceGraphic" in2="drop" result="shape"></feBlend></filter>` +
  `</defs>`;

// Accordion behavior (shadcn Accordion reference, ui.shadcn.com/docs/components/base/accordion):
// Diagnostic and Métadonnées are exclusive — opening one closes the other. They're wired in two
// separate modules (this file + filing.ts) with no shared ancestor passed down, so coordination
// goes through a document-level event. The listener below is registered once at module load
// (ES modules are singletons) — it always calls the CURRENT instance's close fn, so re-opening a
// track (which rebuilds the DOM) never leaks a stale listener.
let closeSpectroZone: (() => void) | null = null;
document.addEventListener("sift:accordion-open", (e) => {
  if ((e as CustomEvent).detail?.zone !== "diagnostic") closeSpectroZone?.();
});

// Single live player at a time — destroyed before any re-render so audio never lingers.
let currentWs: WaveSurfer | null = null;
function destroyPlayer() {
  // NB : ne PAS déconnecter coverObserver ici — mountPlayer appelle destroyPlayer APRÈS que
  // fillVerdictLanding a créé l'observer, ce qui le tuerait avant qu'il voie le texte grandir. Il est
  // géré par sizeCoverToBody seul (déconnecte le précédent à chaque ouverture).
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
  st.textContent = ".sift-time:hover{color:var(--color-text-primary)!important}";
  document.head.appendChild(st);
}

const mmss = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

function spectroCaption(v: AnalysisReport["verdict"], containerMismatch: boolean): string {
  if (v === "fake" && containerMismatch) return "conteneur .flac mais contenu MP3 détecté — extension falsifiée";
  if (v === "fake") return "coupure nette = transcodage probable";
  if (v === "grey") return "à vérifier visuellement";
  return "énergie pleine bande = encodage conforme";
}

/** La LECTURE de l'image, en deux mots, pour la pastille de spectre du Diagnostic ouvert
 *  (spec `docs/ui-specs/revue.md` § Zone C, point 5 : « Pleine bande · 22 kHz »).
 *
 *  Chaque retour est un FRAGMENT VERBATIM de `spectroCaption` juste au-dessus, sur les mêmes
 *  entrées et les mêmes branches : rien n'est reformulé, aucun seuil neuf n'est introduit — la
 *  décision reste celle du backend (`verdict`), exactement comme pour la phrase longue. Celle-ci
 *  n'est d'ailleurs pas perdue : elle devient le `title` de la pastille.
 *
 *  Ce n'est PAS le verdict. Le verdict est dit une seule fois, dans la rangée de titre de
 *  l'en-tête (`fillVerdictLanding`), et ne se répète jamais ici — c'est la règle qui a fait
 *  retirer la ligne « Verdict » du Diagnostic le 2026-08-25. Ce qui est dit ici est ce que
 *  l'image MONTRE, la preuve à côté de laquelle elle est affichée. */
function spectroBandReading(v: AnalysisReport["verdict"], containerMismatch: boolean): string {
  if (v === "fake" && containerMismatch) return "Extension falsifiée";
  if (v === "fake") return "Coupure nette";
  if (v === "grey") return "À vérifier visuellement";
  return "Pleine bande";
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

/** Le raw val (0..255) de sg.mag_db converti en dBFS réel (-100..0) — même domaine que
 *  spectroColor(), l'inverse de la quantification faite côté backend (spectrum.rs). */
function rawToDbfs(val: number): number {
  return (val / 255) * 100 - 100;
}

/** Fréquence + dB EXACTS au pixel (x,y) du canvas — dérivés de la MÊME donnée
 *  (sg.mag_db) et de la MÊME formule que celle qui colore ce pixel dans drawSpectrogram,
 *  jamais une valeur recalculée différemment qui pourrait diverger de ce qui est affiché.
 *  timeSec dérivé de `durationSec` (r.duration_sec) — même x/w que le calcul de frame,
 *  donc cohérent avec la position horizontale réelle du curseur sur le morceau. */
function spectroPointAt(
  sg: AnalysisReport["spectrogram"],
  w: number,
  h: number,
  x: number,
  y: number,
  durationSec: number,
): { freqHz: number; dbfs: number; timeSec: number } {
  const f = Math.min(sg.frames - 1, Math.max(0, Math.floor((x / w) * sg.frames)));
  const b = Math.min(sg.bins - 1, Math.max(0, Math.floor(((h - 1 - y) / h) * sg.bins)));
  // Aucun repli sur cet accès, ici comme dans drawSpectrogram : `f` et `b` sont bornés juste
  // au-dessus, donc l'index maximum vaut `frames*bins - 1`, et `assertSpectrogramLength`
  // (`ipc.ts`, au point de décodage) garantit que la grille est exactement de cette taille.
  // Le `|| 0` qui se trouvait là ne pouvait rattraper qu'une violation de cet invariant — et il
  // la peignait en 0, c'est-à-dire -100 dBFS, c'est-à-dire du silence : grille décalée, fin en
  // noir, aucune erreur nulle part. Il masquait aussi un vrai 0, donc même en relisant la valeur
  // on ne pouvait plus distinguer « lu » de « absent ».
  const val = sg.mag_db[f * sg.bins + b];
  // Fréquence dérivée du bin b lui-même (son centre), pas d'un ratio y/h calculé séparément
  // — garantit que la fréquence affichée correspond exactement au bin dont la dB est lue
  // juste au-dessus, plutôt que deux formules légèrement décalées d'1px (revue finale).
  const freqHz = (b + 0.5) * sg.hz_per_bin;
  const timeSec = (x / w) * durationSec;
  return { freqHz, dbfs: rawToDbfs(val), timeSec };
}

/** Légende permanente incrustée : paliers fréquence (haut-gauche) + dB (haut-droit), texte
 *  semi-transparent superposé sur l'image, coin par coin — jamais de barre dégradée de
 *  couleur (testée en mockup visuel avec Antoine, jugée peu claire une fois les paliers
 *  numériques ajoutés) ni d'axe temps permanent (chevauchait visuellement, redondant avec
 *  l'étiquette du réticule au survol — voir Task 3). Dessinée UNE FOIS sur le canvas DE
 *  BASE juste après putImageData, jamais redessinée au mousemove (contrairement au
 *  réticule, qui vit sur l'overlay). */
// Texte avec contour sombre + remplissage clair — lisible quelle que soit la couleur du
// spectrogramme sous le texte (blanc/orange en zone forte, noir en zone faible), contrairement
// à un simple fillStyle semi-transparent qui se noyait sur les zones claires (annotation : "le
// texte sur les côtés n'est pas assez lisible").
function drawOutlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillText(text, x, y);
}

function drawSpectroLegend(ctx: CanvasRenderingContext2D, w: number, h: number, nyquist: number) {
  ctx.save();
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  const padTop = 6;
  const padSide = 6;
  const colH = h - padTop * 2 - 20; // laisse la place au label d'unité en bas

  // Fréquence (haut-gauche) : 3 paliers proportionnels à nyquist (jamais des kHz fixes —
  // un fichier à sample rate différent change nyquist, la légende doit suivre).
  const freqTicks = [nyquist, nyquist / 2, 0];
  ctx.textAlign = "left";
  freqTicks.forEach((hz, i) => {
    const label = hz >= 1000 ? `${Math.round(hz / 1000)}k` : `${Math.round(hz)}`;
    const y = padTop + (i / (freqTicks.length - 1)) * colH;
    drawOutlinedText(ctx, label, padSide, y, 0.9);
  });
  drawOutlinedText(ctx, "Hz", padSide, h - 14, 0.7);

  // dB (haut-droit) : 6 paliers dérivés de SPECTRO_GAIN_DB/SPECTRO_RANGE_DB — 0 dBFS (plein
  // niveau) à -100 dBFS (silence), par pas de 20. Légende texte pure, PAS une position
  // spatiale sur le canvas (contrairement à l'axe fréquence : la dB colore un pixel, elle
  // n'a pas de rangée qui lui correspond) — répartie uniformément juste pour la lisibilité.
  const dbCeiling = 0;
  const dbFloor = -(SPECTRO_GAIN_DB + SPECTRO_RANGE_DB); // -100
  const dbStep = (dbCeiling - dbFloor) / 5; // 20
  const dbTicks = Array.from({ length: 6 }, (_, i) => Math.round(dbCeiling - i * dbStep));
  ctx.textAlign = "right";
  const dbRightX = w - padSide;
  dbTicks.forEach((db, i) => {
    const y = padTop + (i / (dbTicks.length - 1)) * colH;
    drawOutlinedText(ctx, String(db), dbRightX, y, 0.9);
  });
  drawOutlinedText(ctx, "dB", dbRightX, h - 14, 0.7);
  ctx.restore();
}

/** Réticule au survol : ligne horizontale (fréquence) + verticale (temps) qui se croisent
 *  sous le curseur, étiquette "{mm:ss} · {kHz} · {dB}" (annotation : "afficher aussi le
 *  temps") — dessiné sur l'OVERLAY, jamais sur le canvas
 *  de base. Ton neutre (pas verdict-toné : ce n'est plus le verdict qui s'affiche, contrai-
 *  rement à l'ancienne ligne de coupure). Même style de pill que l'ancienne étiquette
 *  cutoff (fond rgba(0,0,0,0.55), coins arrondis, 11px monospace), avec le même garde-fou
 *  anti-débordement en Y ; ajoute le même garde-fou en X (la pill peut aussi déborder à
 *  droite près du bord droit du canvas). */
function drawSpectroCrosshair(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  x: number,
  y: number,
  freqHz: number,
  dbfs: number,
  timeSec: number,
  color: string,
  scrim: string,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
  ctx.restore();

  const label = `${mmss(timeSec)} · ${(freqHz / 1000).toFixed(1)} kHz · ${dbfs.toFixed(1)} dB`;
  ctx.font = "11px monospace";
  const textW = ctx.measureText(label).width;
  const padX = 6;
  const padY = 4;
  const boxW = textW + padX * 2;
  const boxH = 11 + padY * 2;
  let boxX = x + 8;
  if (boxX + boxW > w - 2) boxX = x - 8 - boxW;
  const boxY = y - 4 - boxH >= 2 ? y - 4 - boxH : y + 4;
  ctx.fillStyle = scrim;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(label, boxX + padX, boxY + boxH - padY - 2);
}

/** Câble le survol souris du spectrogramme : mousemove dessine le réticule sur l'overlay
 *  (jamais sur le canvas de base, jamais la boucle pixel-par-pixel), mouseleave l'efface
 *  entièrement (rien ne reste affiché au repos — tout se découvre au survol). Appelée une
 *  fois par drawSpectrogram() réussi (wireSpectrogram), après que `base` a sa taille finale
 *  (mesurée/appliquée par drawSpectrogram — voir son `measuredW`). */
function wireSpectroHover(base: HTMLCanvasElement, overlay: HTMLCanvasElement, r: AnalysisReport) {
  const octx = overlay.getContext("2d");
  if (!octx) return;
  overlay.width = base.width;
  overlay.height = base.height;
  const w = base.width;
  const h = base.height;
  const sg = r.spectrogram;
  // Couleur claire fixe, pas un token thème-aware : le canvas reste toujours noir quel que
  // soit le thème de l'app (.sift-spectro-canvas, styles.css), donc --color-text-secondary
  // (qui s'assombrit en thème clair, le défaut de Sift) rendait le réticule et son étiquette
  // quasi illisibles — même raisonnement déjà appliqué à drawSpectroLegend (revue finale).
  const color = "rgba(255,255,255,0.85)";
  // Read once here (mount time), not per mousemove — --overlay-scrim is theme-invariant (declared
  // only in :root, never overridden in dark mode) so there is nothing to re-read on theme switch
  // either. Same discipline as `color` above: no recomputable work inside the hot handler below.
  const scrim = getComputedStyle(document.documentElement).getPropertyValue("--overlay-scrim").trim() || "rgba(0,0,0,.55)";

  base.addEventListener("mousemove", (e) => {
    const rect = base.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * w);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * h);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const { freqHz, dbfs, timeSec } = spectroPointAt(sg, w, h, x, y, r.duration_sec);
    drawSpectroCrosshair(octx, w, h, x, y, freqHz, dbfs, timeSec, color, scrim);
  });
  base.addEventListener("mouseleave", () => octx.clearRect(0, 0, w, h));
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
      // Sans repli — voir spectroPointAt pour l'invariant qui rend cet accès toujours défini.
      const val = sg.mag_db[f * sg.bins + b];
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
  drawSpectroLegend(ctx, w, h, nyquist);
}

function peaksCoverage(r: AnalysisReport): string {
  const sr = r.sample_rate || 44100;
  // The step comes from the report, never from the constant: above analysis::MAX_PEAKS the
  // backend max-pools the envelope, so one point can stand for several thousand samples. Using
  // 512 there would claim a fraction of the real coverage and read as a truncated analysis.
  const step = r.peaks_step || PEAKS_WINDOW_FALLBACK;
  const covered = (r.peaks.length * step) / sr;
  const pct = r.duration_sec > 0 ? (covered / r.duration_sec) * 100 : 0;
  return `${r.peaks.length} pts ≈ ${covered.toFixed(1)}s / ${r.duration_sec.toFixed(1)}s (${pct.toFixed(0)}%)`;
}

// mono=false for a categorical word (e.g. the verdict "ok"/"fake"/"grey") rather than a numeric
// reading (Hz, dBTP, %, runs) — .sift-row-value's monospace treatment fits digits/units, but reads
// as an odd mismatch on plain text (annotation: "j'aime bien le texte de verdict mais celui de ok
// pas fan"). Default stays mono so every other numeric row call site is unaffected.
// ⚠️ Plus AUCUN appelant ne passe `false` depuis le 2026-08-25 : la ligne « Verdict » — le seul
// mot catégoriel du Diagnostic — a été retirée, le verdict n'étant dit qu'une fois, dans l'en-tête.
// L'opt-out est gardé parce que sa règle CSS (`.sift-row-value-plain`) existe toujours ; les deux
// se retirent ensemble ou pas du tout, sinon il reste une règle inerte (mode de défaillance déjà
// documenté sur `.sift-spectro-box`, styles.css).
/** Une ligne de mesure sur les DEUX colonnes de la grille. Pour celles qui portent une référence
 *  en plus de leur valeur : mesuré dans la vraie fenêtre, « Densité de l'aigu » cassait libellé et
 *  valeur sur deux lignes chacun dans une demi-colonne. */
export function rowWide(label: string, value: string): string {
  return `<div class="sift-row sift-row-wide"><span class="sift-row-label">${label}</span><span class="sift-row-value">${value}</span></div>`;
}

export function row(label: string, value: string, mono = true): string {
  const valueCls = mono ? "sift-row-value" : "sift-row-value sift-row-value-plain";
  return `<div class="sift-row"><span class="sift-row-label">${label}</span><span class="${valueCls}">${value}</span></div>`;
}

// ── HTML helpers ────────────────────────────────────────────────────────────

/** Keyboard-hint row for the bottom action rail (filing.ts), matching the board's `kbd` line —
 *  the maquette anchors these to the rail, not the scrollable detail content. */
export function keyboardHintsHtml(): string {
  const k = (key: string, what: string) => `<span><b>${key}</b> ${what}</span>`;
  return (
    `<div class="sift-kbd-hints">` +
    k("SPACE", "écouter") + k("ENTER", "convertir") + k("BKSP", "écarter") + k("HAUT/BAS", "naviguer") +
    `</div>`
  );
}

/** Chemin d'origine en PATH CONTROL (wireframe fix 10 ; HIG « Path controls » / `NSPathControl`,
 *  la barre de chemin du Finder) : des SEGMENTS séparés par un chevron, plus une chaîne collée.
 *  Hiérarchie par l'encre, posée en CSS : intermédiaires en secondaire, dernier segment — le nom
 *  de fichier — en primaire.
 *
 *  Troncature : on garde les 2 DERNIERS segments (ex-`shortPath`, replié ici avec sa raison).
 *  L'ellipse CSS coupe par la droite, donc laisser le chemin entier au `text-overflow` mangeait
 *  justement le nom de fichier, la seule part du chemin qui vaut d'être lue (audit UI/UX
 *  2026-07-03, fix 7). La spec (`docs/ui-specs/revue.md` § Zone C, point 1) veut à terme une
 *  troncature PAR LE MILIEU (premier + dernier segments) : elle demande de mesurer la place
 *  réellement disponible, ce que ce rendu-chaîne ne fait pas — non implémenté ici, pas oublié.
 *  Le chemin complet reste dans le `title`.
 *
 *  `esc()` sur CHAQUE segment : ce sont des noms de dossiers et de fichiers utilisateur. */
function pathControlHtml(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const shown = parts.length > 2 ? parts.slice(-2) : parts;
  const sep = `<i class="ti ti-chevron-right sift-player-path-sep" aria-hidden="true"></i>`;
  // Le segment élidé est un segment comme un autre dans la série (« … › dossier › fichier »),
  // exactement la barre de chemin tronquée du Finder — pas un préfixe collé au premier nom.
  const head = shown.length < parts.length ? [`<span class="sift-player-path-seg is-elided">…</span>`] : [];
  const segs = shown.map(
    (seg, i) =>
      `<span class="sift-player-path-seg${i === shown.length - 1 ? " is-leaf" : ""}">${esc(seg)}</span>`,
  );
  return (
    `<div class="sift-player-path" title="${esc(path)}">` +
    head.concat(segs).join(sep) +
    `</div>`
  );
}

interface PlayerHeaderOptions {
  deferText?: boolean;
  title?: string;
  subtitle?: string;
  showAnalysisFailure?: boolean;
  /** Called with the raw error message when analyzePath fails, in addition to (not instead of)
   *  the inline "Échec de l'analyse" rendering below — lets a caller react to a specific failure
   *  (e.g. filing.ts detecting decode.rs's "file no longer exists" message to clear a stale pane)
   *  without changing this function's own return value/behavior for callers that don't pass it. */
  onAnalysisError?: (message: string) => void;
}

/** Single header, folded into the player card itself (2026-07-02: the standalone Hero above the
 *  player was pure duplication — same title/artist/path, twice). Cover (real art once identified,
 *  a minimalist vinyl placeholder via `.sift-cover-frame`'s CSS until then) + title + verdict ·
 *  artiste · version · chemin en path control, optionally a close button (`openReportModal`'s
 *  popup only). Keeps the shared `.sift-report-cover`/`.sift-report-name`/`.sift-report-sub` hooks
 *  that filing.ts writes into (cover src on identify, clean displayName on reconcile).
 *  (Ce bloc décrivait déjà cette fonction ; il était posé au-dessus de l'ex-`shortPath`, deux
 *  définitions plus haut — remis sur son sujet le 2026-08-25.) */
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
    // Le verdict est AU NIVEAU DU TITRE, à droite (wireframe « Poste de décision » § 05, patron
    // Mail : le statut en haut à droite du message) — d'où cette rangée qui les tient tous les
    // deux. Il était la 3e de quatre lignes empilées, alignée à gauche entre l'artiste et le
    // chemin (en-tête B, 2026-08-21) : c'est le PLACEMENT qui a changé, pas son rendu.
    `<div class="sift-player-title-row">` +
    `<div class="sift-report-name sift-player-name${pendingCls}">${esc(name)}</div>` +
    // Vide dans la coque initiale ; rempli par fillVerdictLanding (point + mot teintés + format
    // réel) quand l'analyse résout. Le slot doit donc EXISTER ici, peint ou non.
    `<div class="sift-player-verdict"></div>` +
    `</div>` +
    `<div class="sift-report-sub sift-player-sub${pendingCls}">${esc(opts.subtitle ?? "")}</div>` +
    pathControlHtml(path) +
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
    // Survol : ligne fine + bulle mm:ss à la cible (patron QuickTime), en plus du ghost fill.
    `<div class="sift-wave-hoverline" hidden></div>` +
    `<div class="sift-wave-hovertime" hidden></div>` +
    // Pouce de lecture — le knob du slider Apple (kit § 04 / slider de zoom de Photos : piste fine +
    // pastille blanche ronde à bordure et ombre légères). La waveform tient lieu de piste ; le pouce
    // marque la tête de lecture. Caché tant que la durée n'est pas connue (updateTime le positionne).
    `<div class="sift-wave-playhead" hidden></div>` +
    `</div>` +
    // Temps À CÔTÉ de l'onde (retour Antoine : plus overlay dans la forme d'onde). Un seul, cliquable.
    `<span class="sift-time" role="button" tabindex="0" title="Temps écoulé / restant — cliquer pour basculer">0:00</span>` +
    // Volume intégré dans la rangée de transport (façon Apple Music) — plus de bloc « contrôles »
    // séparé. Tempo & key-lock (l'« Écoute avancée ») retirés : le pitch DJ n'est pas voulu sur cet
    // écran de décision (Antoine 2026-08-21), et la HIG ne justifie un contrôle audio custom que pour
    // une commande absente du système. L'icône de volume reste (contrôle standard, cohérent).
    // Volume = SVG du kit inliné tel quel (COPIE, cf. SPK_SLASH/VOL_DEFS). Le <svg> EST le slider
    // (role="slider", drag + clavier ; audit-ref R1 2026-07-08). Clic sur le haut-parleur = mute.
    // renderVolume ne pilote que `width` du remplissage et `cx` du pouce ; les trois encres
    // (remplissage, pouce, glyphe) viennent de styles.css, seul écart assumé à la copie du kit —
    // voir le commentaire de SPK_SLASH en tête de fichier. La piste, elle, garde le blanc @10 % du
    // kit dans les deux thèmes : c'est le remplissage qui s'inverse, pas elle.
    // Les attributs `width`/`cx` de départ valent le plein volume sous la géométrie de renderVolume
    // (fillW = 110 et cx = 101 à pct = 1) — les changer sans elle désaccorderait la première frame.
    `<svg class="sift-volume" viewBox="0 0 112 24" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">` +
    `<title>Volume — cliquer pour couper</title>` +
    `<g filter="url(#sift-vol-inner)"><rect width="112" height="22" rx="11" fill="white" fill-opacity="0.1"></rect></g>` +
    `<rect class="sift-vol-fill" x="1" y="1" width="110" height="20" rx="10"></rect>` +
    `<g filter="url(#sift-vol-drop)"><circle class="sift-vol-knob" cx="101" cy="11" r="10"></circle></g>` +
    `<path class="sift-volume-icon" d="${SPK_SLASH}"></path>` +
    VOL_DEFS +
    `</svg>` +
    `</div>` +
    `<div class="sift-player-error" hidden></div>`
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

/** A verdict-panel chip: `success` = green-tinted (LOSSLESS), `neutral` = white@.06 (MATCH/UNIQUE). */
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
    `<span><span class="${carCls}">▸</span><span class="sift-zone-toggle-label">${opts.label}</span></span>` +
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
/** The promoted verdict — the "landing block" that sits high, right under the track header
 *  (spec `docs/ui-specs/revue.md` § Zone C, direction « verdict promu », validée le 2026-08-21).
 *  It is said ONCE, here: the tone-coded badge that used to sit on the Diagnostic disclosure
 *  header was the duplicate this replaces (the pill removed 2026-07-06 was another). NO surface —
 *  #8/#23 forbid a content surface in the middle of Revue — so it renders the same categorical
 *  pastille as the library table (`DESIGN.md` § 16), scaled up: a filled dot that inherits the
 *  tone `currentColor` plus the verdict word.
 *
 *  Mirrors `library-views.ts::verdictView` — LOSSLESS demands the TWO facts (verdict `ok` AND a
 *  lossless rail), and it reuses the library's own `.sift-lib-v-*` tone classes so the two signals
 *  cannot drift apart. `declared_rail` is the rail directly here (AnalysisReport carries it;
 *  LibraryTrack instead derives it from the written format). */
function verdictWordTone(r: AnalysisReport): { word: string; cls: string } {
  if (r.verdict === "fake") return { word: "FAKE", cls: "sift-lib-v-fake" };
  if (r.verdict === "grey") return { word: "À VÉRIFIER", cls: "sift-lib-v-check" };
  if (r.verdict !== "ok") return { word: "—", cls: "sift-lib-v-none" };
  return r.declared_rail === "lossless"
    ? { word: "LOSSLESS", cls: "sift-lib-v-ok" }
    : { word: "AUTHENTIQUE", cls: "sift-lib-v-ok" };
}

/** Résumé de format pour la ligne d'état du verdict : format déclaré + la mesure la plus parlante —
 *  kbps pour un fichier lossy (c'est ce qui définit sa qualité), sinon la fréquence d'échantillonnage
 *  en kHz. Uniquement des données réelles (declared_format / declared_bitrate / sample_rate), pas de
 *  profondeur de bits inventée. */
function formatSummary(r: AnalysisReport): string {
  const parts: string[] = [];
  if (r.declared_format) parts.push(r.declared_format.toUpperCase());
  const khz = r.sample_rate ? `${(r.sample_rate / 1000).toFixed(1).replace(".", ",")} kHz` : "";
  // Lossless : la fréquence d'échantillonnage définit la qualité (le « débit » PCM est trompeur —
  // 1411 kbps pour un simple 16/44). Lossy : c'est le débit qui compte.
  if (r.declared_rail === "lossless") {
    if (khz) parts.push(khz);
  } else if (r.declared_bitrate) {
    parts.push(`${r.declared_bitrate} kbps`);
  } else if (khz) {
    parts.push(khz);
  }
  return parts.join(" · ");
}

/** Fill the verdict slot (`.sift-player-verdict`, rendered empty by playerHeaderHtml dans la rangée
 *  de titre, à droite du nom — wireframe § 05, patron Mail). Point + mot teintés par la classe
 *  `.sift-lib-v-*` de la table (§ 16, via currentColor), suivis du format réel en encre secondaire.
 *  Slot-fill : la coque du header est peinte avant que l'analyse résolve, puis le verdict s'y
 *  dépose — c'est pourquoi ce slot ne se crée PAS ici. */
function fillVerdictLanding(root: HTMLElement, r: AnalysisReport): void {
  const slot = root.querySelector<HTMLElement>(".sift-player-verdict");
  if (!slot) return;
  const { word, cls } = verdictWordTone(r);
  const fmtInfo = formatSummary(r);
  slot.className = `sift-player-verdict ${cls}`;
  slot.innerHTML =
    `<span class="sift-player-verdict-dot" aria-hidden="true"></span>` +
    `<span class="sift-player-verdict-word">${esc(word)}</span>` +
    (fmtInfo ? `<span class="sift-player-verdict-fmt">· ${esc(fmtInfo)}</span>` : "");
  // La pochette prend la hauteur du bloc texte (en-tête B, Antoine 2026-08-21 ; mesure JS
  // CONFIRMÉE le 2026-08-25 contre la piste « pochette fixe 56px » de la spec). Le pur CSS
  // (aspect-ratio:1 + align-self:stretch) rendait une largeur nulle dans ce contexte flex, mesuré
  // via CDP — d'où la mesure JS, au point unique où la hauteur finale est connue.
  // ⚠️ Le verdict n'AJOUTE PLUS sa ligne depuis qu'il est passé dans la rangée de titre : le bloc
  // texte est descendu de 4 lignes à 3, donc la pochette est plus petite qu'avant. C'est voulu, la
  // pochette suit le texte. La mesure reste appelée ici parce que la pose du verdict peut encore
  // faire varier la hauteur de la rangée de titre (retour à la ligne dans une colonne étroite).
  sizeCoverToBody(root);
}

let coverObserver: ResizeObserver | null = null;
/** La pochette (carrée) prend la hauteur du bloc texte de l'en-tête (en-tête B, Antoine 2026-08-21).
 *  Un ResizeObserver la garde synchrone quel que soit le moment où cette hauteur se stabilise :
 *  chargement d'Outfit (police système d'abord, mesuré 81→100px), pose du verdict, mise à jour tardive
 *  du nom par updateHeaderName. Le pur CSS (aspect-ratio:1 + align-self:stretch) rendait une largeur
 *  nulle dans ce contexte flex, et une mesure ponctuelle rate le reflow tardif. Un seul observer à la
 *  fois — reconnecté à chaque ouverture, déconnecté par destroyPlayer. */
function sizeCoverToBody(root: HTMLElement): void {
  coverObserver?.disconnect();
  coverObserver = null;
  const body = root.querySelector<HTMLElement>(".sift-player-header-body");
  const cover = root.querySelector<HTMLElement>(".sift-cover-frame");
  if (!body || !cover) return;
  const apply = () => {
    const s = `${body.offsetHeight}px`;
    cover.style.width = s;
    cover.style.height = s;
  };
  apply();
  if ("ResizeObserver" in window) {
    coverObserver = new ResizeObserver(apply);
    coverObserver.observe(body);
  }
}

function spectroAndTagsHtml(r: AnalysisReport): string {
  const yn = (b: boolean) => (b ? "oui" : "non");
  return (
    `<div class="sift-spectro-box">` +
    zoneToggleHtml({
      label: "Diagnostic audio",
      // No verdict badge on this header anymore: the verdict is said ONCE, in the promoted
      // landing block above (spec revue.md § Zone C, 2026-08-21). The badge span stays (hidden by
      // default) so the shared zoneToggle markup is unchanged; only the hint span is still used
      // here, for wireSpectrogram's transient "calcul…"/"échec" text.
      badgeId: "sift-quality-badge",
      toggleExtraClass: "sift-sg-toggle sift-spectro-toggle",
      caretExtraClass: "sift-sg-caret sift-spectro-caret",
      hintExtraClass: "sift-sg-hint sift-spectro-hint",
    }) +
    `<div class="sift-sg-body sift-spectro-body">` +
    `<div class="sift-spectro-body-inner">` +
    // Le spectrogramme d'ABORD, et seul en haut du panneau : c'est la preuve du verdict, et la
    // prose qui le précédait la repoussait sous le pli (wireframe « Poste de décision » § 06,
    // fix 5 ; spec `docs/ui-specs/revue.md` § Zone C, point 5). La ligne
    // `.sift-spectro-declared` qui vivait ici — « Déclaré <format> <rail> · coupure N Hz — … » —
    // est retirée le 2026-08-25 : le format déclaré est déjà dit par `formatSummary` dans
    // l'en-tête de piste, et la coupure descend aux Détails techniques avec les autres mesures.
    `<div class="sift-spectro-canvas-wrap">` +
    `<canvas class="sift-sg sift-spectro-canvas" width="720" height="180" role="img" aria-label="Spectrogramme audio"></canvas>` +
    // Canvas transparent superposé — ne dessine QUE le réticule au survol (wireSpectroHover),
    // jamais l'image du spectrogramme elle-même. Séparé du canvas de base pour la perf :
    // un mousemove ne doit jamais redéclencher la boucle pixel-par-pixel de drawSpectrogram.
    `<canvas class="sift-spectro-overlay" width="720" height="180"></canvas>` +
    `</div>` +
    // DEUX pastilles compactes sous l'image, et deux seulement : le format, et la lecture du
    // spectre. Tout ce qui se chiffre est aux Détails techniques. La pastille de spectre porte la
    // coupure ARRONDIE au kHz — la lecture, pas la mesure ; le hertz exact reste une ligne
    // là-dessous. `.pill` est la pastille générique du dépôt (styles.css), réutilisée telle
    // quelle. Format absent = pas de pastille vide : `formatSummary` se garde déjà pareil.
    `<div class="sift-spectro-pills">` +
    (r.declared_format ? `<span class="pill">${esc(r.declared_format.toUpperCase())}</span>` : "") +
    `<span class="pill" title="${spectroCaption(r.verdict, r.container_mismatch)}">` +
    `${spectroBandReading(r.verdict, r.container_mismatch)} · ${fmt(r.cutoff_hz / 1000, 0)} kHz</span>` +
    `</div>` +
    // Non-technical users open "Diagnostic audio" to understand a verdict, not to read raw
    // engineering measurements — the spectrogram plus the two pills above answer that; every
    // FIGURE (true-peak, DC offset, écrêtage, corrélation de phase…) is jargon with no
    // vulgarization, so it sits behind a second, nested disclosure (audit finding #5,
    // 2026-07-10). Native <details> — no new JS wiring needed, doesn't touch wireSpectrogram's
    // querySelector-based toggle for the OUTER "Diagnostic audio" panel.
    // ⚠️ Depuis le 2026-08-25, coupure / densité de l'aigu / durée ont REJOINT ce disclosure : le
    // panneau ouvert ne montrait plus la preuve, il montrait un tableau. Aucun de ces textes n'est
    // reformulé au passage — hfDensityText et durationText sont appelés à l'identique.
    `<details class="sift-spectro-tech">` +
    `<summary class="sift-spectro-tech-summary">Détails techniques</summary>` +
    `<div class="sift-spectro-rows">` +
    // Coupure et durée en tête, appariées sur la grille à deux colonnes ; les deux mesures de
    // densité les suivent, chacune sur toute la largeur (rowWide — elles portent leur référence
    // en plus de leur valeur). Absentes des rapports d'avant leur mise en place : `null` veut dire
    // « pas mesuré », jamais zéro, donc la ligne ne se rend pas du tout.
    row("Coupure", fmt(r.cutoff_hz, 0) + " Hz") +
    row("Durée", durationText(r.duration_sec, r.decoded_duration_sec, fmt)) +
    (r.hf_flatness_db != null ? rowWide("Densité de l'aigu", hfDensityText(r.hf_flatness_db, fmt)) : "") +
    // Seconde bande de platitude, APRÈS celle du dessus et jamais avant : sa référence ne s'appuie
    // que sur 20 fichiers contre 44, et la faire lire en premier noierait celle qui porte la mesure
    // la mieux étayée. Elle reste indispensable : c'est la SEULE qui voit Opus. (L'ordre est tout
    // ce qui reste de cette précaution — les deux vivent dans le même disclosure depuis que les
    // lignes principales ont disparu, 2026-08-25.)
    (r.hf_flatness_top_db != null
      ? rowWide("Densité du haut du spectre", hfTopDensityText(r.hf_flatness_top_db, fmt))
      : "") +
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
    `</div></details></div></div>` +
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
 * to `ws.load` there is nothing left to decode up-front.
 *
 * Every format now round-trips through `playback_url`, AIFF or not: the `asset:` scope starts
 * empty, so that command is also what grants the webview read access to this one file. Returning
 * `path` directly here would yield a URL the webview is forbidden to fetch. The extra IPC costs
 * one round-trip per track opened — nothing next to loading the audio itself. */
async function playableUrl(path: string): Promise<string> {
  return invoke<string>("playback_url", { path });
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
  const volumeTrack = root.querySelector<SVGSVGElement>(".sift-volume");
  const volumeIcon = root.querySelector<SVGElement>(".sift-volume-icon");
  const volumeFill = root.querySelector<SVGElement>(".sift-vol-fill");
  const volumeKnob = root.querySelector<SVGElement>(".sift-vol-knob");
  const errorEl = root.querySelector<HTMLElement>(".sift-player-error");

  ensureStyles();
  destroyPlayer();
  // WaveSurfer draws to canvas, so it needs resolved color strings, not var(--x) references —
  // same read-at-mount pattern already used for the spectrogram cutoff line (drawSpectrogram
  // below). --overlay-bar is the token for the UNPLAYED wave bars.
  //
  // La portion JOUÉE prend l'ACCENT DU DÉPÔT (--color-accent-fill → --color-hue-blue-solid), et
  // plus --color-waveform-elapsed (2026-08-25). Ce dernier n'est pas un accent : il résout en
  // var(--color-text-info), une ENCRE, qui vaut oklch(79,21 % 0,0789 242) en thème sombre — un bleu
  // si pâle et si peu chromé qu'il se lit comme du blanc cassé sur les barres, donc un lecteur SANS
  // accent une fois le thème sombre actif. --color-accent-fill, lui, EST le systemBlue dans les
  // deux thèmes (60,28 % / 62,43 % de clarté, chroma ≈ 0,21) : l'accent tient des deux côtés.
  // ⚠️ --color-waveform-elapsed (styles.css) perd ici son DERNIER consommateur — token désormais
  // mort, à retirer par le geste qui a le droit d'éditer :root (hors périmètre de cette lane).
  //
  // Jusqu'au 2026-07-28 (audit SJ-1), --overlay-bar n'était déclaré NULLE PART : getPropertyValue
  // rendait "" et un repli littéral blanc à 35 % d'opacité prenait la main à chaque montage — sur
  // un thème dont la base est claire, donc une waveform quasi invisible par défaut. Le commentaire
  // d'origine affirmait par ailleurs que le token servait à la barre d'accent de .qi.cur, ce qui
  // était faux (cette règle utilise --color-row-active).
  //
  // Le repli silencieux est remplacé par un repli BRUYANT : un token absent est un bug de
  // feuille de style, il doit se voir en console au lieu de se déguiser en couleur plausible
  // (CLAUDE.md : fail fast, pas de fallback silencieux).
  const cs = getComputedStyle(root);
  const token = (name: string, fallback: string): string => {
    const v = cs.getPropertyValue(name).trim();
    if (!v) {
      console.error(`[report-view] token CSS ${name} introuvable — repli ${fallback}`);
      return fallback;
    }
    return v;
  };
  const waveColor = token("--overlay-bar", "rgba(0,0,0,.32)");
  // Le repli reste cette orange criarde À DESSEIN : elle n'appartient à aucune palette du dépôt,
  // donc si le token disparaît le lecteur le CRIE à l'écran en plus du console.error ci-dessus.
  const progressColor = token("--color-accent-fill", "#ff5500");
  const ws = WaveSurfer.create({
    container,
    height: 40, // aminci (58→40) pour lire comme un slider Apple avec texture de waveform, pas un
                // gros bloc (Antoine 2026-08-21) — la piste porte le pouce rond (.sift-wave-playhead)
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
  // Géométrie de la capsule, en unités du viewBox du kit (0 0 112 24). UNE seule source pour le
  // rendu ET pour le drag : les deux se déduisaient de constantes séparées, et c'est exactement ce
  // qui les avait désaccordés (voir dragSlider ci-dessous). VOL_TRAVEL est la course RÉELLE du
  // centre du pouce, pas la largeur de la piste — un pouce de rayon 10 ne peut jamais sortir de la
  // capsule, donc son centre vit dans [11, 101] et non dans [0, 112].
  const VOL_VB_W = 112; // largeur du viewBox
  const VOL_INSET = 1; // marge du remplissage dans la piste (kit)
  const VOL_KNOB_R = 10; // rayon du pouce (kit)
  const VOL_CX_MIN = VOL_INSET + VOL_KNOB_R; // 11 — pouce à fond à gauche
  const VOL_CX_MAX = VOL_VB_W - VOL_INSET - VOL_KNOB_R; // 101 — pouce à fond à droite
  const VOL_TRAVEL = VOL_CX_MAX - VOL_CX_MIN; // 90

  // Slider custom (jamais un <input type=range> natif — voir DESIGN.md) : on empoigne n'importe où
  // sur la capsule, pouce et remplissage suivent le pointeur jusqu'au relâchement. Le tempo, qui
  // remplissait depuis le centre, a été retiré de cet écran (spec Revue, Zone C, point 3) — il ne
  // reste que le volume, qui remplit depuis la gauche.
  // ⚠️ La conversion pixels → valeur passe par la COURSE DU POUCE, pas par la largeur de la piste.
  // Jusqu'au 2026-08-25 elle mappait 0..112 px sur 0..1 alors que le pouce ne parcourt que 11..101 :
  // le pouce traînait jusqu'à 11 px derrière le pointeur (recalculé : pointeur à x = 101, pouce à
  // cx = 90,2), et le geste n'atteignait 100 % qu'au tout dernier pixel de la capsule, alors que le
  // pouce butait déjà à droite onze pixels plus tôt. Avec la course, cx vaut exactement le x du
  // pointeur partout dans [11, 101] — c'est la définition de « le pouce suit le pointeur ».
  const dragSlider = (track: SVGSVGElement, onMove: (pct: number) => void) => {
    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      // Le SVG est rendu 1:1 (112 px pour un viewBox de 112), mais on repasse par la largeur mesurée
      // pour rester juste si la feuille de style change un jour la taille rendue.
      const vbX = ((clientX - rect.left) / Math.max(1, rect.width)) * VOL_VB_W;
      onMove(Math.max(0, Math.min(1, (vbX - VOL_CX_MIN) / VOL_TRAVEL)));
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // Le haut-parleur vit DANS la capsule (mute au clic) : un pointerdown dessus ne doit pas armer
      // un drag de volume ni sauter la valeur — son propre handler de clic gère le mute.
      if ((e.target as Element).closest?.(".sift-volume-icon")) return;
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
    // On ne pilote QUE les deux éléments SVG qui bougent (kit) : la largeur du rect de remplissage
    // et le cx du cercle-pouce. Reste identique au kit.
    // Le POUCE mène, le remplissage suit : dans le kit le pouce EST le bout arrondi du remplissage
    // (même encre, il n'existe que pour porter l'ombre), donc son bord droit et celui du remplissage
    // sont le même trait.
    // ⚠️ Jusqu'au 2026-08-25 c'était l'inverse — `fillW = Math.max(20, pct * 110)` puis
    // `cx = 1 + fillW - 10`. Le clamp gelait DEUX choses à la fois : le pouce restait à cx = 11 tant
    // que pct < 0,182, soit 18 % de course sans le moindre mouvement à l'œil, et un mute
    // visuellement identique à un volume faible. Le plancher de 20 n'a pas disparu, il a changé de
    // nature : il est maintenant la CONSÉQUENCE de la course (à pct = 0 le remplissage vaut
    // exactement le diamètre du pouce), donc le glyphe du haut-parleur reste posé sur le
    // remplissage à tous les niveaux — sa raison d'être — sans plus écraser le bas de course.
    const cx = VOL_CX_MIN + pct * VOL_TRAVEL;
    const fillW = cx + VOL_KNOB_R - VOL_INSET; // 20 à pct = 0, 110 à pct = 1
    volumeFill?.setAttribute("width", String(fillW));
    volumeKnob?.setAttribute("cx", String(cx));
    volumeTrack?.setAttribute("aria-valuenow", String(Math.round(pct * 100))); // audit-ref R1
  };
  renderVolume(1); // WaveSurfer's own default (full volume)
  if (volumeTrack) {
    dragSlider(volumeTrack, (pct) => {
      ws.setVolume(pct);
      renderVolume(pct);
    });
    // Audit-ref R1 (Revue, 2026-07-08, réf. shadcn Slider) : flèches gauche/droite ±5%, Home/End
    // aux bornes — même granularité que le drag existant (continu), pas de pas caché supplémentaire.
    volumeTrack.addEventListener("keydown", (e) => {
      const cur = ws.getVolume();
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.max(0, cur - 0.05);
        ws.setVolume(next);
        renderVolume(next);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.min(1, cur + 0.05);
        ws.setVolume(next);
        renderVolume(next);
      } else if (e.key === "Home") {
        e.preventDefault();
        ws.setVolume(0);
        renderVolume(0);
      } else if (e.key === "End") {
        e.preventDefault();
        ws.setVolume(1);
        renderVolume(1);
      }
    });
  }
  if (volumeIcon) {
    // Clic sur le haut-parleur = mute / démute (kit § 14). Mémorise le dernier volume non nul.
    let lastVolume = 1;
    volumeIcon.addEventListener("click", () => {
      const cur = ws.getVolume();
      if (cur > 0) {
        lastVolume = cur;
        ws.setVolume(0);
        renderVolume(0);
      } else {
        const restore = lastVolume > 0 ? lastVolume : 1;
        ws.setVolume(restore);
        renderVolume(restore);
      }
    });
  }

  // Un seul temps affiché, cliquable (patron Musique/Podcasts — jamais les deux à la fois). Le clic
  // (ou Entrée/Espace au clavier) bascule écoulé ↔ restant ; le restant décompte (durée - écoulé).
  const timeEl = root.querySelector<HTMLElement>(".sift-time");
  const playheadEl = root.querySelector<HTMLElement>(".sift-wave-playhead");
  let showRemaining = false;
  const updateTime = () => {
    const cur = ws.getCurrentTime();
    const dur = ws.getDuration();
    if (timeEl) timeEl.textContent = showRemaining ? `-${mmss(Math.max(0, dur - cur))}` : mmss(cur);
    // Pouce Apple à la tête de lecture (kit § 04). Révélé dès que la durée est connue.
    if (playheadEl && dur > 0) {
      playheadEl.hidden = false;
      playheadEl.style.left = `${Math.min(100, (cur / dur) * 100)}%`;
    }
  };
  if (timeEl) {
    const toggleTime = () => {
      showRemaining = !showRemaining;
      updateTime();
    };
    timeEl.addEventListener("click", toggleTime);
    timeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleTime();
      }
    });
  }
  ws.on("ready", () => {
    updateTime();
    if (errorEl) errorEl.hidden = true;
    // Resync the icon on the REAL state. The button is clickable from the moment mountPlayer
    // returns, but `loadAudio` finishes later: a click in that window calls playPause() on an
    // empty media, WaveSurfer emits `play` (icon → pause), then `ws.load()` substitutes the
    // media without ever emitting `pause` — leaving the icon inverted for the rest of the track.
    // Nothing else corrects it: setIcon is driven only by play/pause/finish.
    syncPlayIcon();
  });
  ws.on("timeupdate", updateTime);

  // Waveform dims a touch while paused (and re-lights on hover, so scrubbing/seeking a paused
  // track still reads clearly) — `.is-paused` starts set in the HTML (nothing is playing yet).
  const waveWrapEl = root.querySelector<HTMLElement>(".sift-wave-wrap");
  /** Puts the button and the waveform back in step with what the player is ACTUALLY doing.
   *  Used on `ready`, where the two can legitimately have drifted apart (see there). */
  function syncPlayIcon(): void {
    const playing = ws.isPlaying();
    setIcon(playing ? "player-pause" : "player-play");
    waveWrapEl?.classList.toggle("is-paused", !playing);
  }
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
    // Fin de piste : stop + playhead ramené à 0, pas d'auto-avance (la zone C ne se recompose pas
    // sous l'utilisateur, patron Musique piste isolée). Un Espace relit du début.
    ws.setTime(0);
    updateTime();
  });

  // Hover-scrub preview: recolor the waveform's own bars from the start up to the cursor — dimmer
  // than the actual orange playhead fill — plus a thin cursor line and a mm:ss time bubble at the
  // cursor (QuickTime pattern, added 2026-08-24). WaveSurfer
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
    } catch {
      // getImageData/toDataURL can throw on a tainted canvas — hover preview just stays unmasked.
    }
  };
  ws.on("redrawcomplete", updateWaveMask);
  if (waveHoverEl) {
    const hoverLine = root.querySelector<HTMLElement>(".sift-wave-hoverline");
    const hoverTime = root.querySelector<HTMLElement>(".sift-wave-hovertime");
    container.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      waveHoverEl.style.width = `${pct * 100}%`;
      // Ligne + bulle mm:ss à la cible (patron QuickTime) : le ghost dit la zone, la ligne + l'heure
      // le point exact. Nœuds créés une fois, mutés ici (mousemove = rafale, jamais innerHTML=).
      const leftPct = `${pct * 100}%`;
      if (hoverLine) {
        hoverLine.hidden = false;
        hoverLine.style.left = leftPct;
      }
      if (hoverTime) {
        hoverTime.hidden = false;
        hoverTime.style.left = leftPct;
        hoverTime.textContent = mmss(pct * ws.getDuration());
      }
    });
    container.addEventListener("mouseleave", () => {
      waveHoverEl.style.width = "0";
      if (hoverLine) hoverLine.hidden = true;
      if (hoverTime) hoverTime.hidden = true;
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
  const overlay = root.querySelector<HTMLCanvasElement>(".sift-spectro-overlay");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  if (!sg || !overlay || !toggle || !body || !caret || !hint) return;

  let open = false, loaded = false, busy = false;
  const close = () => {
    if (!open) return;
    open = false;
    body.classList.remove("is-open");
    caret.style.transform = "";
    toggle.setAttribute("aria-expanded", "false");
  };
  closeSpectroZone = close; // this instance is now the one "sift:accordion-open" can close

  toggle.addEventListener("click", async () => {
    if (busy) return;
    if (open) {
      close();
      return;
    }
    if (!loaded) {
      busy = true;
      hint.textContent = "calcul…";
      try {
        const full = r.spectrogram.frames > 0 ? r : await analyzePath(r.path, true);
        drawSpectrogram(sg, full);
        wireSpectroHover(sg, overlay, full);
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
    // Exclusive accordion (shadcn Accordion reference): opening this closes Métadonnées.
    document.dispatchEvent(new CustomEvent("sift:accordion-open", { detail: { zone: "diagnostic" } }));
    open = true;
    caret.style.transform = "rotate(90deg)";
    toggle.setAttribute("aria-expanded", "true");
    body.classList.add("is-open");
  });
}

/** Wires the player + spectrogram toggle inside `root` (scoped — no global ids). */
function wireReport(root: HTMLElement, r: AnalysisReport) {
  mountPlayer(root, r.path, r.peaks, r.duration_sec);
  wireSpectrogram(root, r);
}

/** Renders the report INLINE into `container` (e.g. the Revue #mid pane). `verdictContainer`,
 *  when given, gets the verdict conclusion card instead of `container` — see `openReportInto`.
 *  `diagContainer`, when given, gets the Diagnostic (spectrogramme + mesures) instead of leaving
 *  it right under the player — see `openReportInto` for why. */
export function renderReportInto(
  container: HTMLElement,
  r: AnalysisReport,
  verdictContainer?: HTMLElement,
  headerOpts: PlayerHeaderOptions = {},
  diagContainer?: HTMLElement,
) {
  const name = headerOpts.title ?? (r.path.split(/[\\/]/).pop() || r.path);
  container.innerHTML =
    `<div class="sift-report-scroll">` +
    (diagContainer ? playerRowHtml(name, r.path, false, headerOpts) : reportHtml(r, false, headerOpts)) +
    `</div>`;
  // Même enveloppe `.sift-analysis-body` que le chemin asynchrone d'openReportInto : sans elle, le
  // Diagnostic n'aurait pas la même structure selon qu'on ouvre une piste pour la première fois
  // (analyse) ou qu'on y revient (cache de session) — et la première règle CSS posée sur ce slot
  // ne s'appliquerait qu'à un cas sur deux, en silence.
  if (diagContainer) diagContainer.innerHTML = `<div class="sift-analysis-body">${spectroAndTagsHtml(r)}</div>`;
  fillVerdictLanding(container, r);
  // verdictContainer (the low .sift-fil-verdict slot, after Identification) now only carries the
  // transient "Analyse en cours…"/error states — clear it on the success path.
  if (verdictContainer) verdictContainer.innerHTML = "";
  mountPlayer(container, r.path, r.peaks, r.duration_sec);
  // Le spectrogramme se câble sur SON hôte : ses nœuds sont partis avec lui quand le Diagnostic
  // vit sous les Métadonnées (wireSpectrogram ne lit que des `.sift-spectro-*`/`.sift-sg-*`,
  // aucune dépendance au lecteur — vérifié à la scission, 2026-08-25).
  wireSpectrogram(diagContainer ?? container, r);
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
  diagContainer?: HTMLElement,
): Promise<AnalysisReport | null> {
  destroyPlayer();
  ensureStyles();
  const seq = ++openSeq;

  const cached = reportCache.get(path);
  if (cached) {
    renderReportInto(container, cached, verdictContainer, headerOpts, diagContainer);
    return cached;
  }

  const name = headerOpts.title ?? (path.split(/[\\/]/).pop() || path);

  // Fire analysis IPC immediately. For already-analyzed tracks the DB round-trip takes ~20ms.
  // allowForget=true: this is the real user-open path (its failure drives filing.ts's gone-file
  // recovery via onAnalysisError below), the one place a confirmed-gone row may be dropped.
  const analysisPromise = analyzePath(path, false, true);

  // Render the player shell. Son-first order: player (header+audition) → proof (Preuves). The
  // verdict conclusion goes LAST, above the action rail — in `verdictContainer` when the caller
  // supplies one (filing.ts/library-detail.ts, both of which insert Identification between here
  // and their own verdict slot), else in a `.sift-verdict-stub` kept inside this same scroll
  // (openReportModal, which has no Identification card of its own). Filled in later (seq-guarded).
  const verdictHost = () => verdictContainer ?? container.querySelector<HTMLElement>(".sift-verdict-stub");
  // Le Diagnostic descend SOUS les Métadonnées quand l'appelant fournit `diagContainer` (Revue,
  // wireframe § 06 fix 4 : « on identifie plus souvent qu'on n'inspecte », patron inspecteur qui
  // met les détails techniques en fin de volet). Le corps d'analyse est déjà un slot rempli plus
  // tard — il change seulement d'hôte, aucun autre chemin ne bouge. Sans `diagContainer`
  // (openReportModal, library-detail) il reste dans le scroll du rapport, comme avant.
  const bodyHost = diagContainer ?? container;
  container.innerHTML =
    `<div class="sift-report-scroll">` +
    playerRowHtml(name, path, false, headerOpts) +
    (diagContainer ? "" : `<div class="sift-analysis-body" hidden></div>`) +
    (verdictContainer ? "" : `<div class="sift-verdict-stub"></div>`) +
    `</div>`;
  if (diagContainer) diagContainer.innerHTML = `<div class="sift-analysis-body" hidden></div>`;

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
    const bodyEl = bodyHost.querySelector<HTMLElement>(".sift-analysis-body");
    if (verdictEl) verdictEl.innerHTML = "";
    fillVerdictLanding(container, earlyResult);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(earlyResult);
      bodyEl.hidden = false;
      wireSpectrogram(bodyHost, earlyResult);
    }
    return earlyResult;
  }

  // Timeout fired — this is a genuinely fresh track (no DB cache to hit), so the wait is
  // real. Only now does the loader text get shown.
  const pendingEl = verdictHost();
  if (pendingEl) {
    // Squelette STATIQUE (DESIGN §6 : la donnée ne s'anime jamais ; jamais un spinner nu) : une barre
    // placeholder à la place du verdict, le temps que l'analyse résolve. Pas de .sift-spin ici.
    pendingEl.innerHTML = `<span class="sift-skel" style="width:6em;height:var(--space-16)"></span>`;
  }
  void mountPlayer(container, path);

  try {
    const r = await analysisPromise;
    reportCache.set(path, r);
    if (seq !== openSeq) return null;
    const verdictEl = verdictHost();
    const bodyEl = bodyHost.querySelector<HTMLElement>(".sift-analysis-body");
    if (verdictEl) verdictEl.innerHTML = "";
    fillVerdictLanding(container, r);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(r);
      bodyEl.hidden = false;
      wireSpectrogram(bodyHost, r);
    }
    return r;
  } catch (e) {
    console.error("analyze_path failed", e);
    if (seq !== openSeq) return null;
    headerOpts.onAnalysisError?.(String(e));
    const verdictEl = verdictHost();
    if (verdictEl && headerOpts.showAnalysisFailure !== false) {
      // decode.rs's open_format already humanizes the common failure (file moved/deleted) into
      // French prose meant for display (see analysis/decode.rs) — the generic "Réessaie" this
      // replaced (audit UX/accessibilité 2026-07-24) silently dropped that message. Show the
      // backend text directly, same pattern as filing-identify.ts/library-detail.ts's error cards.
      verdictEl.innerHTML = `<div class="sift-analysis-fail">${esc(String(e))}</div>`;
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
    card.innerHTML = reportHtml(r, true);
    fillVerdictLanding(card, r);
    ov.innerHTML = "";
    ov.appendChild(card);
    card.querySelector(".sift-close")?.addEventListener("click", () => {
      destroyPlayer();
      ov.remove();
    });
    wireReport(card, r);
  } catch (e) {
    console.error("analyze_path failed", e);
    // Same fix as openReportInto above: show the backend's (often already-humanized) message.
    ov.innerHTML = `<div class="sift-report-overlay-card sift-report-overlay-error">${esc(String(e))}</div>`;
  }
}
