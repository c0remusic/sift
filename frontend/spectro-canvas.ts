// Le dessin du spectrogramme : carte de couleurs, légende, réticule au survol. Sorti tel quel de
// `report-view.ts` (#72) pour que la vue agrandie (`spectro-enlarge.ts`) le partage avec le
// Diagnostic de la zone D sans import croisé entre les deux.
import type { AnalysisReport } from "../shared/contracts";

export const mmss = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** La cellule de la grille (0..n-1) sous le pixel `i` d'un axe de `size` pixels. En ENTIERS :
 *  `Math.floor((i / size) * n)` en flottant rend parfois i − 1 quand `size == n` (1/49 × 49 =
 *  0,999…), et la vue agrandie, peinte à une cellule par pixel, dupliquait une colonne sur ~20 et en
 *  perdait autant — 55 sur 1 200 (relecture de #72). Le produit entier `i * n` reste exact bien
 *  au-delà des tailles en jeu. */
export function cellOf(i: number, size: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor((i * n) / size)));
}

/** La durée que la grille couvre réellement : ce qui a été DÉCODÉ, pas ce que l'en-tête annonce.
 *  Les deux divergent justement sur les fichiers que Sift doit montrer (un Xing qui ment, un
 *  téléchargement interrompu dont l'en-tête dit 0 s). Rust rend `sec_per_frame` exact
 *  (`spectrum.rs`, `sec_per_frame × frames` = durée couverte). */
export function gridSeconds(sg: AnalysisReport["spectrogram"]): number {
  return sg.frames * sg.sec_per_frame;
}

/** Graduations d'un axe de 0 à `max` (unités de la donnée : Hz, secondes), posé sur `px` pixels :
 *  le plus petit pas de `steps` qui laisse au moins `minGapPx` entre deux graduations, sinon le
 *  plus grand. Rend les valeurs, de 0 à `max` inclus quand il tombe juste. La vue agrandie (#72)
 *  en tire ses axes kHz et mm:ss ; pure, pour être tenue par Vitest. */
export function axisTicks(max: number, px: number, minGapPx: number, steps: readonly number[]): number[] {
  if (!(max > 0) || !(px > 0) || steps.length === 0) return [];
  const step = steps.find((s) => (s / max) * px >= minGapPx) ?? steps[steps.length - 1];
  const out: number[] = [];
  for (let i = 0; i * step <= max; i++) out.push(i * step);
  return out;
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
  const f = cellOf(x, w, sg.frames);
  const b = cellOf(h - 1 - y, h, sg.bins);
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
  k: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // `k` pixels de stockage par px CSS : le devicePixelRatio, partout depuis le 2026-10-05 (l'overlay
  // a sa propre résolution, `wireSpectroHover`). Tout se dessine en px CSS, pour que l'étiquette ait
  // la taille du texte de l'app partout — sans cela elle tombait à 11/dpr px dans la vue agrandie.
  ctx.setTransform(k, 0, 0, k, 0, 0);
  w /= k;
  h /= k;
  x /= k;
  y /= k;
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Câble le survol souris du spectrogramme : mousemove dessine le réticule sur l'overlay
 *  (jamais sur le canvas de base, jamais la boucle pixel-par-pixel), mouseleave l'efface
 *  entièrement (rien ne reste affiché au repos — tout se découvre au survol). Appelée une
 *  fois par drawSpectrogram() réussi (wireSpectrogram), après que `base` a sa taille finale
 *  (mesurée/appliquée par drawSpectrogram — voir son `measuredW`). */
export function wireSpectroHover(base: HTMLCanvasElement, overlay: HTMLCanvasElement, r: AnalysisReport) {
  const octx = overlay.getContext("2d");
  if (!octx) return;
  // L'espace de la RECHERCHE (quelle cellule de la grille sous le pointeur) : le bitmap de base.
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
  // Temps de la grille, pas de l'en-tête : voir `gridSeconds`.
  const seconds = gridSeconds(sg);

  base.addEventListener("mousemove", (e) => {
    const rect = base.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * w);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * h);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const { freqHz, dbfs, timeSec } = spectroPointAt(sg, w, h, x, y, seconds);
    // L'espace du DESSIN, lui, est celui de l'overlay : sa boîte CSS × devicePixelRatio, relue à
    // chaque mouvement (la taille CSS peut changer). Calqué sur le bitmap de base jusqu'au
    // 2026-10-05, il étirait le réticule dès que la figure agrandie remplit son cadre : une source
    // courte de 270 × 150 dans un cadre de 760 × 380 rendait l'étiquette illisible, et l'écrasait
    // quand les échelles horizontale et verticale diffèrent (revue adverse du 2026-10-05).
    const orect = overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ow = Math.max(1, Math.round(orect.width * dpr));
    const oh = Math.max(1, Math.round(orect.height * dpr));
    if (overlay.width !== ow) overlay.width = ow;
    if (overlay.height !== oh) overlay.height = oh;
    const ox = (e.clientX - orect.left) * dpr;
    const oy = (e.clientY - orect.top) * dpr;
    drawSpectroCrosshair(octx, ow, oh, ox, oy, freqHz, dbfs, timeSec, color, scrim, dpr);
  });
  base.addEventListener("mouseleave", () => octx.clearRect(0, 0, overlay.width, overlay.height));
}

export function drawSpectrogram(canvas: HTMLCanvasElement, r: AnalysisReport) {
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
  paintGrid(ctx, w, h, sg);
  const nyquist = sg.bins * sg.hz_per_bin;
  drawSpectroLegend(ctx, w, h, nyquist);
}

/** La vue agrandie (#72) : la grille peinte à 1:1, une colonne par pixel physique, une bande par
 *  ligne. La grille a été CALCULÉE à la taille du canevas (Rust, max-pool), donc rien n'est ni
 *  étiré ni jeté ici. Pas de légende incrustée : la vue porte ses axes en HTML, à la taille du
 *  texte de l'app plutôt qu'à celle d'un pixel physique. */
export function paintSpectrogramExact(canvas: HTMLCanvasElement, sg: AnalysisReport["spectrogram"]) {
  const ctx = canvas.getContext("2d");
  if (!ctx || sg.frames === 0 || sg.bins === 0) return;
  canvas.width = sg.frames;
  canvas.height = sg.bins;
  paintGrid(ctx, sg.frames, sg.bins, sg);
}

/** Peint `sg` sur `w` × `h` pixels au plus proche voisin. Aux dimensions de la grille, c'est une
 *  copie exacte : un pixel par cellule. */
function paintGrid(ctx: CanvasRenderingContext2D, w: number, h: number, sg: AnalysisReport["spectrogram"]) {
  const img = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const f = cellOf(x, w, sg.frames);
    for (let y = 0; y < h; y++) {
      const b = cellOf(h - 1 - y, h, sg.bins);
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
}
