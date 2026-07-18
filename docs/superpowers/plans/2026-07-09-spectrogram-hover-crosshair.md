# Spectrogramme réticule interactif — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la ligne pointillée statique de cutoff du spectrogramme (Diagnostic
audio, écran Revue) par un réticule interactif qui suit la souris (fréquence + dB exacts
sous le curseur), et ajouter une légende permanente incrustée (paliers fréquence + dB).

**Architecture:** Un second `<canvas>` transparent (`.sift-spectro-overlay`) superposé au
canvas existant (`.sift-spectro-canvas`), dans un wrapper `position:relative`. Le canvas
de base garde son rôle actuel (peindre l'image + la légende, une fois) ; l'overlay ne
dessine que le réticule, redessiné à chaque `mousemove` — jamais la boucle coûteuse de
peinture pixel par pixel.

**Tech Stack:** TypeScript vanilla (`frontend/report-view.ts`), Canvas 2D API, CSS
(`frontend/styles.css`). Pas de framework, pas de runner de test unitaire côté frontend
(`package.json` n'en a pas) — vérification via `npx tsc --noEmit` + inspection live contre
la vraie app `tauri dev` par CDP (port 9222, voir CLAUDE.md section "Vérification UI").

## Global Constraints

- Spec source : `docs/superpowers/specs/2026-07-09-spectrogram-hover-crosshair-design.md`
  — toute divergence avec ce plan doit se résoudre en faveur de la spec.
- Fréquence/dB affichées doivent utiliser les MÊMES sources de données que le pixel
  colorié (`sg.mag_db`, `sg.hz_per_bin`, `sg.bins`) — jamais une valeur recalculée
  différemment qui pourrait diverger.
- Paliers dB dérivés de `SPECTRO_GAIN_DB`/`SPECTRO_RANGE_DB` (constantes existantes,
  `report-view.ts:114-115`), jamais des littéraux indépendants.
- Souris uniquement — pas d'équivalent clavier, canvas garde `role="img"`/`aria-label`
  statique.
- `report-view.ts` s'exécute uniquement dans `tauri dev` (`inTauri`) — jamais vérifiable
  via `preview_*`/navigateur nu (maquette `app.js` n'a pas ce code). Vérification par CDP
  contre la vraie fenêtre, port 9222 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  au lancement de `tauri dev`).
- Ne JAMAIS lancer `cargo build`/`test`/`clippy` pendant que `tauri dev` tourne (corrompt
  son cache incrémental — CLAUDE.md, mémoire `avoid-concurrent-cargo-tauri-dev`). Ce plan
  ne touche que du TypeScript/CSS, aucun impact Rust — non applicable ici, mais si un
  worker exécute par erreur une commande cargo, il doit s'arrêter et vérifier l'état de
  `tauri dev` avant de continuer.

---

## File Structure

- **Modify: `frontend/report-view.ts`**
  - `spectroAndTagsHtml()` (ligne ~419-460) : markup, ajoute le wrapper + canvas overlay.
  - `drawSpectrogram()` (ligne ~134-207) : retire le bloc ligne de coupure, ajoute l'appel
    à la légende.
  - Nouvelles fonctions module-scope : `rawToDbfs`, `spectroPointAt`,
    `drawSpectroLegend`, `drawSpectroCrosshair`, `wireSpectroHover`.
  - `wireSpectrogram()` (ligne ~857-907) : appelle `wireSpectroHover()` après un
    `drawSpectrogram()` réussi.
- **Modify: `frontend/styles.css`**
  - `.sift-spectro-canvas` (ligne ~902) : retire `margin` (déplacé sur le wrapper).
  - Nouvelles règles : `.sift-spectro-canvas-wrap`, `.sift-spectro-overlay`.

Pas de nouveau fichier — extension ciblée d'un fichier existant déjà bien délimité
(`report-view.ts` est déjà scindé par responsabilité : lecture/dessin spectrogramme dans
une poignée de fonctions module-scope contiguës).

---

### Task 1 : Structure DOM + CSS (wrapper + canvas overlay, aucun comportement encore)

**Files:**
- Modify: `frontend/report-view.ts:423-453` (`spectroAndTagsHtml`)
- Modify: `frontend/styles.css:902` (`.sift-spectro-canvas`)

**Interfaces:**
- Produces: markup `.sift-spectro-canvas-wrap > .sift-spectro-canvas + .sift-spectro-overlay`,
  consommé par Task 2 (légende, dessinée sur `.sift-spectro-canvas`) et Task 3 (réticule,
  dessiné sur `.sift-spectro-overlay`).

- [ ] **Step 1 : Ajoute le wrapper + canvas overlay dans le markup**

Dans `frontend/report-view.ts`, remplace la ligne du canvas (ligne 437) :

```ts
    `<canvas class="sift-sg sift-spectro-canvas" width="720" height="180" role="img" aria-label="Spectrogramme audio"></canvas>` +
```

par :

```ts
    `<div class="sift-spectro-canvas-wrap">` +
    `<canvas class="sift-sg sift-spectro-canvas" width="720" height="180" role="img" aria-label="Spectrogramme audio"></canvas>` +
    // Canvas transparent superposé — ne dessine QUE le réticule au survol (wireSpectroHover),
    // jamais l'image du spectrogramme elle-même. Séparé du canvas de base pour la perf :
    // un mousemove ne doit jamais redéclencher la boucle pixel-par-pixel de drawSpectrogram.
    `<canvas class="sift-spectro-overlay" width="720" height="180"></canvas>` +
    `</div>` +
```

- [ ] **Step 2 : Ajoute les règles CSS du wrapper + overlay, retire le margin du canvas de base**

Dans `frontend/styles.css`, la ligne actuelle (~902) :

```css
.sift-spectro-canvas{width:calc(100% - 36px);margin:0 18px;display:block;background:#000;border-radius:var(--border-radius-md);border:0.5px solid var(--color-border-tertiary)}
```

devient (le `margin:0 18px` déménage sur le wrapper, qui porte aussi le `position:relative`
nécessaire à l'overlay ; l'overlay reprend exactement les mêmes dimensions/radius que le
canvas de base et laisse passer les événements souris vers lui, `pointer-events:none`) :

```css
.sift-spectro-canvas-wrap{position:relative;margin:0 18px}
.sift-spectro-canvas{width:100%;display:block;background:#000;border-radius:var(--border-radius-md);border:0.5px solid var(--color-border-tertiary)}
.sift-spectro-overlay{position:absolute;inset:0;width:100%;height:100%;border-radius:var(--border-radius-md);pointer-events:none}
```

- [ ] **Step 3 : Vérifie que ça compile**

Run: `npx tsc --noEmit` (depuis la racine du repo)
Expected: `TypeScript: No errors found`

- [ ] **Step 4 : Vérifie visuellement contre la vraie app (CDP)**

`tauri dev` doit déjà tourner (voir CLAUDE.md, "Vérification UI — app réelle"). Récupère
l'URL WebSocket CDP :

```bash
curl -s http://localhost:9222/json
```

Écris un script Node jetable (`.cdp-check.cjs`, scratchpad — supprimé en fin de tâche) qui
ouvre le WebSocket, exécute `Runtime.evaluate` avec :

```js
(() => {
  const wrap = document.querySelector('.sift-spectro-canvas-wrap');
  const base = document.querySelector('.sift-spectro-canvas');
  const overlay = document.querySelector('.sift-spectro-overlay');
  if (!wrap || !base || !overlay) return 'MISSING: ' + JSON.stringify({wrap: !!wrap, base: !!base, overlay: !!overlay});
  const br = base.getBoundingClientRect();
  const or = overlay.getBoundingClientRect();
  return JSON.stringify({ baseRect: br, overlayRect: or, sameRect: Math.abs(br.x-or.x)<1 && Math.abs(br.width-or.width)<1 });
})()
```

(Naviguer vers l'écran Revue et ouvrir le zone "Diagnostic audio" d'un morceau analysé au
préalable, sinon `.sift-spectro-canvas-wrap` n'existe pas encore dans le DOM — le zoom
Diagnostic est un accordéon fermé par défaut, voir `wireSpectrogram`.)

Expected: `sameRect: true` — l'overlay épouse exactement le canvas de base, le spectrogramme
a le même rendu visuel qu'avant (l'overlay est transparent, rien ne change encore à l'œil).

- [ ] **Step 5 : Commit**

```bash
git add frontend/report-view.ts frontend/styles.css
git commit -m "feat(spectro): ajoute le canvas overlay pour le futur réticule interactif"
```

---

### Task 2 : Légende permanente incrustée (fréquence + dB), retire la ligne de coupure statique

**Files:**
- Modify: `frontend/report-view.ts:134-207` (`drawSpectrogram`)

**Interfaces:**
- Consumes : `.sift-spectro-canvas-wrap`/`.sift-spectro-canvas` (Task 1).
- Produces : `drawSpectroLegend(ctx, w, h, nyquist)`, appelée depuis `drawSpectrogram()`.
  Task 3 réutilise le même calcul de `nyquist` (déjà présent dans `drawSpectrogram`) via
  `spectroPointAt`, pas directement `drawSpectroLegend`.

- [ ] **Step 1 : Ajoute `drawSpectroLegend` (nouvelle fonction, avant `drawSpectrogram`)**

Dans `frontend/report-view.ts`, juste avant `function drawSpectrogram(...)` (ligne 134) :

```ts
/** Légende permanente incrustée : paliers fréquence (haut-gauche) + dB (haut-droit), texte
 *  semi-transparent superposé sur l'image, coin par coin — jamais de barre dégradée de
 *  couleur (testée en mockup visuel avec Antoine, jugée peu claire une fois les paliers
 *  numériques ajoutés) ni d'axe temps permanent (chevauchait visuellement, redondant avec
 *  l'étiquette du réticule au survol — voir Task 3). Dessinée UNE FOIS sur le canvas DE
 *  BASE juste après putImageData, jamais redessinée au mousemove (contrairement au
 *  réticule, qui vit sur l'overlay). */
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
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "left";
  freqTicks.forEach((hz, i) => {
    const label = hz >= 1000 ? `${Math.round(hz / 1000)}k` : `${Math.round(hz)}`;
    const y = padTop + (i / (freqTicks.length - 1)) * colH;
    ctx.fillText(label, padSide, y);
  });
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText("Hz", padSide, h - 14);

  // dB (haut-droit) : 6 paliers dérivés de SPECTRO_GAIN_DB/SPECTRO_RANGE_DB — 0 dBFS (plein
  // niveau) à -100 dBFS (silence), par pas de 20. Légende texte pure, PAS une position
  // spatiale sur le canvas (contrairement à l'axe fréquence : la dB colore un pixel, elle
  // n'a pas de rangée qui lui correspond) — répartie uniformément juste pour la lisibilité.
  const dbCeiling = 0;
  const dbFloor = -(SPECTRO_GAIN_DB + SPECTRO_RANGE_DB); // -100
  const dbStep = (dbCeiling - dbFloor) / 5; // 20
  const dbTicks = Array.from({ length: 6 }, (_, i) => Math.round(dbCeiling - i * dbStep));
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "right";
  const dbRightX = w - padSide;
  dbTicks.forEach((db, i) => {
    const y = padTop + (i / (dbTicks.length - 1)) * colH;
    ctx.fillText(String(db), dbRightX, y);
  });
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText("dB", dbRightX, h - 14);
  ctx.restore();
}
```

- [ ] **Step 2 : Remplace le bloc ligne de coupure par l'appel à la légende**

Dans `drawSpectrogram()`, la ligne 161 (`const nyquist = ...`) reste — elle sert encore.
Remplace tout le bloc `if (r.cutoff_hz > 0 && nyquist > 0) { ... }` (lignes 162-206) par :

```ts
  const nyquist = sg.bins * sg.hz_per_bin;
  drawSpectroLegend(ctx, w, h, nyquist);
```

Vérifie qu'aucune autre référence à `r.cutoff_hz`, `r.verdict` (dans `drawSpectrogram`
spécifiquement — `r.verdict` est utilisé ailleurs dans le fichier, pas touché) ne reste
orpheline dans cette fonction après la suppression.

- [ ] **Step 3 : Vérifie que ça compile**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 4 : Vérifie visuellement contre la vraie app (CDP)**

Ouvre un morceau, déplie Diagnostic audio (déclenche `drawSpectrogram`). Script CDP :

```js
(() => {
  const c = document.querySelector('.sift-spectro-canvas');
  if (!c) return 'no canvas';
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, 8).data; // bande du haut, coins gauche/droit
  // Coin gauche (légende fréquence) : au moins un pixel non-noir dans les ~20 premiers px
  let leftHasText = false, rightHasText = false;
  for (let x = 0; x < 24; x++) for (let y = 0; y < 8; y++) {
    const i = (y * c.width + x) * 4;
    if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 30) leftHasText = true;
  }
  for (let x = c.width - 30; x < c.width; x++) for (let y = 0; y < 8; y++) {
    const i = (y * c.width + x) * 4;
    if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 30) rightHasText = true;
  }
  return JSON.stringify({ leftHasText, rightHasText, canvasSize: {w: c.width, h: c.height} });
})()
```

Expected: `leftHasText: true, rightHasText: true` — du texte semi-transparent est bien peint
dans les deux coins supérieurs (légende fréquence à gauche, dB à droite). Complète avec une
capture d'écran (`Page.captureScreenshot`) pour confirmer visuellement que l'ancienne ligne
pointillée de coupure a disparu et que les paliers texte sont lisibles.

- [ ] **Step 5 : Commit**

```bash
git add frontend/report-view.ts
git commit -m "feat(spectro): légende incrustée fréquence+dB, retire la ligne de coupure statique"
```

---

### Task 3 : Réticule interactif au survol (fréquence + dB exacts)

**Files:**
- Modify: `frontend/report-view.ts:134-207` (ajouts avant `drawSpectrogram`)
- Modify: `frontend/report-view.ts:857-907` (`wireSpectrogram`)

**Interfaces:**
- Consumes : `.sift-spectro-overlay` (Task 1), `SPECTRO_GAIN_DB`/`SPECTRO_RANGE_DB`
  (constantes existantes, `report-view.ts:114-115`), `sg.mag_db`/`sg.bins`/`sg.hz_per_bin`/
  `sg.frames` (`AnalysisReport["spectrogram"]`, `shared/contracts.ts:66-70`).
- Produces : `wireSpectroHover(base, overlay, r)`, appelée depuis `wireSpectrogram()`.

- [ ] **Step 1 : Ajoute `rawToDbfs` + `spectroPointAt` (juste après `spectroColor`, avant `drawSpectroLegend`)**

```ts
/** Le raw val (0..255) de sg.mag_db converti en dBFS réel (-100..0) — même domaine que
 *  spectroColor(), l'inverse de la quantification faite côté backend (spectrum.rs). */
function rawToDbfs(val: number): number {
  return (val / 255) * 100 - 100;
}

/** Fréquence + dB EXACTS au pixel (x,y) du canvas — dérivés de la MÊME donnée
 *  (sg.mag_db) et de la MÊME formule que celle qui colore ce pixel dans drawSpectrogram,
 *  jamais une valeur recalculée différemment qui pourrait diverger de ce qui est affiché. */
function spectroPointAt(
  sg: AnalysisReport["spectrogram"],
  w: number,
  h: number,
  x: number,
  y: number,
): { freqHz: number; dbfs: number } {
  const nyquist = sg.bins * sg.hz_per_bin;
  const f = Math.min(sg.frames - 1, Math.max(0, Math.floor((x / w) * sg.frames)));
  const b = Math.min(sg.bins - 1, Math.max(0, Math.floor(((h - 1 - y) / h) * sg.bins)));
  const val = sg.mag_db[f * sg.bins + b] || 0;
  const freqHz = nyquist > 0 ? ((h - y) / h) * nyquist : 0;
  return { freqHz, dbfs: rawToDbfs(val) };
}
```

- [ ] **Step 2 : Ajoute `drawSpectroCrosshair` (juste après `drawSpectroLegend`)**

```ts
/** Réticule au survol : ligne horizontale (fréquence) + verticale (temps) qui se croisent
 *  sous le curseur, étiquette "{kHz} · {dB}" — dessiné sur l'OVERLAY, jamais sur le canvas
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
  color: string,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
  ctx.restore();

  const label = `${(freqHz / 1000).toFixed(1)} kHz · ${dbfs.toFixed(1)} dB`;
  ctx.font = "11px monospace";
  const textW = ctx.measureText(label).width;
  const padX = 6;
  const padY = 4;
  const boxW = textW + padX * 2;
  const boxH = 11 + padY * 2;
  let boxX = x + 8;
  if (boxX + boxW > w - 2) boxX = x - 8 - boxW;
  const boxY = y - 4 - boxH >= 2 ? y - 4 - boxH : y + 4;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(label, boxX + padX, boxY + boxH - padY - 2);
}
```

- [ ] **Step 3 : Ajoute `wireSpectroHover` (juste après `drawSpectroCrosshair`, avant `peaksCoverage`)**

```ts
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
  const color = getComputedStyle(base).getPropertyValue("--color-text-secondary").trim() || "#ccc";

  base.addEventListener("mousemove", (e) => {
    const rect = base.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * w);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * h);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const { freqHz, dbfs } = spectroPointAt(sg, w, h, x, y);
    drawSpectroCrosshair(octx, w, h, x, y, freqHz, dbfs, color);
  });
  base.addEventListener("mouseleave", () => octx.clearRect(0, 0, w, h));
}
```

- [ ] **Step 4 : Appelle `wireSpectroHover` depuis `wireSpectrogram`**

Dans `wireSpectrogram()` (ligne ~859), ajoute la récupération de l'overlay au même endroit
que les autres éléments :

```ts
function wireSpectrogram(root: HTMLElement, r: AnalysisReport) {
  const sg = root.querySelector<HTMLCanvasElement>(".sift-sg");
  const overlay = root.querySelector<HTMLCanvasElement>(".sift-spectro-overlay");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  const qualityBadge = root.querySelector<HTMLElement>("#sift-quality-badge");
  if (!sg || !overlay || !toggle || !body || !caret || !hint) return;
```

Puis, dans le bloc `if (!loaded) { ... }`, juste après `drawSpectrogram(sg, full);` :

```ts
        drawSpectrogram(sg, full);
        wireSpectroHover(sg, overlay, full);
        loaded = true;
```

- [ ] **Step 5 : Vérifie que ça compile**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 6 : Vérifie le comportement au survol contre la vraie app (CDP)**

Ouvre un morceau, déplie Diagnostic audio. Script CDP qui simule un `mousemove` réel sur
le canvas de base (pas un simple `dispatchEvent` synthétique sans coordonnées — il faut de
vraies `clientX`/`clientY`) et vérifie que l'overlay a bien peint quelque chose :

```js
(() => {
  const base = document.querySelector('.sift-spectro-canvas');
  const overlay = document.querySelector('.sift-spectro-overlay');
  if (!base || !overlay) return 'missing canvas';
  const rect = base.getBoundingClientRect();
  const ev = new MouseEvent('mousemove', {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
  });
  base.dispatchEvent(ev);
  const ctx = overlay.getContext('2d');
  const data = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
  let painted = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { painted = true; break; } // canal alpha
  return JSON.stringify({ painted, overlaySize: { w: overlay.width, h: overlay.height } });
})()
```

Expected: `painted: true` — l'overlay contient des pixels non-transparents après le
mousemove (le réticule a bien été dessiné). Vérifie ensuite le `mouseleave` :

```js
(() => {
  const base = document.querySelector('.sift-spectro-canvas');
  const overlay = document.querySelector('.sift-spectro-overlay');
  base.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  const ctx = overlay.getContext('2d');
  const data = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
  let painted = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { painted = true; break; }
  return JSON.stringify({ painted });
})()
```

Expected: `painted: false` — l'overlay est bien effacé après `mouseleave`.

Complète avec une capture d'écran (`Page.captureScreenshot`) pendant un `mousemove` actif
(pas juste la vérification pixel programmatique) pour confirmer que le réticule ET son
étiquette "X kHz · Y dB" sont lisibles et bien positionnés, y compris près des bords du
canvas (teste un point proche du bord droit pour vérifier le garde-fou anti-débordement en
X ajouté à l'étape 2).

- [ ] **Step 7 : Commit**

```bash
git add frontend/report-view.ts
git commit -m "feat(spectro): réticule interactif au survol (fréquence+dB exacts)"
```

---

## Self-Review

**Couverture spec** :
- §1 "Remplace entièrement" → Task 2 Step 2 retire le bloc cutoff en entier. ✓
- §2 "Réticule complet (horizontale+verticale)" → Task 3 Step 2, `drawSpectroCrosshair`
  dessine les deux lignes. ✓
- §3 "Fréquence + dB, lues depuis sg.mag_db" → Task 3 Step 1, `spectroPointAt` lit
  directement `sg.mag_db`. ✓
- §4 "Souris uniquement" → aucun ajout clavier dans tout le plan, `aria-label` du canvas de
  base non touché. ✓
- §5 "Légende incrustée, pas de barre dégradée, pas d'axe temps" → Task 2, `drawSpectroLegend`
  ne dessine que du texte, aucun axe temps. ✓
- Architecture "second canvas overlay pour la perf" → Task 1 crée le wrapper+overlay,
  Task 3 confirme qu'aucun mousemove ne touche `drawSpectrogram`/la boucle pixel. ✓
- "Rendu du réticule" (pill, garde-fou débordement) → Task 3 Step 2 reprend le même style
  que l'ancienne étiquette cutoff, ajoute le garde-fou X en plus du Y existant. ✓
- Hors scope (pas clavier, pas de changement à `row("Coupure",...)`, pas de pin au clic) —
  aucune tâche du plan n'y touche. ✓

**Placeholders** : aucun "TBD"/"TODO" — tout le code est complet dans chaque step.

**Cohérence des types/noms** : `spectroPointAt` retourne `{ freqHz, dbfs }`, utilisé tel
quel dans `wireSpectroHover` (Task 3 Step 3) et `drawSpectroCrosshair` (Task 3 Step 2, mêmes
noms de paramètres `freqHz`/`dbfs`). `drawSpectroLegend(ctx, w, h, nyquist)` signature
cohérente entre sa définition (Task 2 Step 1) et son appel (Task 2 Step 2). `wireSpectroHover(base, overlay, r)` cohérent entre définition (Task 3 Step 3) et appel (Task 3 Step 4).
