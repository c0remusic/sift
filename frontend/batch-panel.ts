// Revue batch mode panel — selection, group rendering, two-click confirm, batch filing rail.
// Extracted from sift-live.ts (Phase 1, tranche 1c). Reads currentItems/reviewMode/verdictDot
// from queue-panel.ts (leaf-to-leaf import, one direction only — queue-panel.ts never imports
// from here). sift-live.ts's setReviewMode (cross-panel orchestrator, kept there since tranche
// 1b) imports renderBatch + the batch destination state from here for its "batch" branch.
import { openFilingInto, TARGET_LABEL } from "./filing";
import {
  renderBinsForBatch,
  ensureDestPopoverAutoClose,
  setBinPickInert,
  toggleDestPopover,
  repositionDestPopoverIfOpen,
} from "./filing-bins";
import { fileBatch, fileCancel, rejectBatch } from "./ipc";
import { requireEl, esc } from "./dom";
import type { QueueItem, BatchResult, FileProgress, Target } from "../shared/contracts";
import { FILE_IN_PLACE, EXTERNAL_DEST_PREFIX, MAX_ANALYSIS_ATTEMPTS } from "../shared/contracts";
import {
  setTask,
  clearTask,
  mountProgressZone,
  homeProgressZone,
} from "./progress-zone";
import {
  startBatchTracklist,
  updateBatchTracklist,
  finishBatchTracklist,
  clearBatchTracklist,
} from "./batch-tracklist";
import { currentItems, reviewMode, verdictDot, prefetchNextAfter, enterDetailMode } from "./queue-panel";

/** Human label for the batch destination (resolves the in-place sentinel to its prose). */
const IN_PLACE_LABEL = "Dossier source de chaque morceau";

// Above this many tracks, Ranger requires a second confirming click first (same threshold as the
// Journal's mass-revert) — a batch run has no recap screen, so it's the only guard before
// moving+encoding a very large selection in one click (audit UI/UX 2026-07-03, fix 3).
// A real two-click arm/confirm cycle IN THE RAIL, not window.confirm(): a live test found a
// synthetic click ran straight through confirm() in this Tauri webview (no dialog, no block),
// filing ~265 real tracks before Stop could catch up — a native dialog is not a trustworthy
// guard here regardless of the cause, so the guard must be the app's own UI.
const BATCH_CONFIRM_THRESHOLD = 10;
/** How long the armed state survives without a second click. SINGLE source of truth: read by the
 *  auto-disarm `setTimeout` below AND by the inline `animation-duration` of the drain bar in
 *  actionButtonHtml. Two copies of this number would let the bar finish draining while the button
 *  is still armed (or the reverse), which is worse than no bar at all. */
const BATCH_CONFIRM_ARM_MS = 5000;
let batchConfirmArmed: { fileN: number; fakeN: number; at: number } | null = null;
let batchConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const batchSel = new Set<number>();
// Auto-fill the ticks to "all ready" ONCE, on the first batch render that has ready items. Without
// this guard renderBatch re-filled whenever batchSel hit 0, which silently undid "Aucun (clear)".
let batchSelInit = false;
// Fakes ticked for DISCARD (never filed — Sift never ranges a fake lossless). Kept separate from
// batchSel (fileables → File) so the rail action button can be adaptive (File n / Discard n / both).
const batchFakeSel = new Set<number>();
// Per-group collapse (Prêts/À vérifier/En analyse). Reintroduced 2026-07-02 on explicit request —
// a prior pass removed this because it wasn't in the maquette, but that was written for
// reasonably-sized batches; with thousands of "Prêts" rows the fixed DOM order (ready → fake →
// pending) buries the other two groups thousands of rows down, making them unreachable in
// practice. Collapsing "Prêts" solves that without reordering the groups. Default: all expanded.
const batchCollapsed = new Set<"file" | "fake" | "readonly">();
// Progressive-disclosure cap per group (Task 3b). "Prêts" can reach thousands (see the collapse
// note above); mounting them all is the batch board's version of the queue's black-screen freeze.
// The group's collapsible structure (headers, tri-state, per-group empty states) makes true
// scroll-windowing invasive, so instead each group renders at most BATCH_GROUP_PAGE rows and a
// "afficher les N suivants" control bumps its cap (same progressive-disclosure grammar already used
// for the queue's "+ N traités" and Écartés' hover-revealed links). Selection state is unaffected —
// it lives entirely in the Sets, never in the mounted DOM, so a select-all still covers rows below
// the cap. Caps reset when leaving batch mode (setReviewMode).
export const BATCH_GROUP_PAGE = 200;
export const batchGroupCap: Record<"file" | "fake" | "readonly", number> = {
  file: BATCH_GROUP_PAGE,
  fake: BATCH_GROUP_PAGE,
  readonly: BATCH_GROUP_PAGE,
};
// Batch "file in place" toggle (FILE_IN_PLACE). Kept apart from batchBin so the picked folder is
// remembered while in-place is on. Effective destination = batchInPlace ? FILE_IN_PLACE : batchBin.
export let batchInPlace = false;
// Format de sortie du rail LOSSLESS uniquement. Le rail lossy n'a pas de choix: y demander AIFF ou
// WAV serait de l'upscale, que le backend refuse (`filing.rs`, `guard_no_upscale`).
//
// Il y avait ici UN sélecteur global, dont le commentaire affirmait l'inverse du backend — « a
// lossy-sourced file can still be asked for AIFF/WAV here ». Il ne le pouvait pas: le lot partait,
// chaque MP3 rebondissait en `needs_validation`, et le récap affichait une coche verte avec
// `0 filed`. Sur une sélection de 250 MP3, l'utilisateur voyait « c'est fait » et rien n'avait
// bougé. Audit 2026-07-28, PP-1; forme tranchée par Antoine (deux sélecteurs, un par rail).
let batchLosslessFormat: Target = "aiff_16_44";
// The ordered ids submitted to the currently-running batch — drives the per-track tracklist (the
// nth `file:progress.done` maps to batchTrackIds[n]). Set at submit, used at file:done.
let batchTrackIds: number[] = [];
// Destination bin chosen in the batch folder tree (forward-slash rel; "" = library root). Kept
// across renders so the choice doesn't reset while triaging.
export let batchBin = "";

/** Répartit la sélection courante par rail SOURCE, pour n'afficher que les sélecteurs qui
 *  s'appliquent réellement et pour n'imposer une cible qu'au rail qui en a une.
 *
 *  `unknown` et `null` (piste pas encore analysée) comptent avec le lossy à l'affichage — c'est le
 *  groupe « pas de choix » — mais au moment de filer, aucune cible ne leur est envoyée : le backend
 *  la dérive lui-même du rail réel (`encode::target_for`). Forcer `mp3_320` ici dégraderait un
 *  lossless dont le rail n'a pas encore été déterminé. */
function batchSelectionByRail(): { lossless: number; lossy: number } {
  let lossless = 0;
  let lossy = 0;
  for (const it of currentItems) {
    if (!batchSel.has(it.id)) continue;
    if (it.rail === "lossless") lossless += 1;
    else lossy += 1;
  }
  return { lossless, lossy };
}

/** Les DEUX blocs de format du rail Lot, un par rail source (décision Antoine du 2026-07-28,
 *  PLAN.md § arbitrages point 1). Le rail lossless a un vrai choix — descendre un lossless en MP3
 *  est légitime, ce n'est pas de l'upscale. Le rail lossy n'en a aucun et le dit en toutes lettres
 *  plutôt qu'en options grisées (variante A, choisie sur maquette contre la variante B).
 *
 *  Chaque groupe n'apparaît que si la sélection en contient : sur un lot 100 % MP3, aucun sélecteur
 *  AIFF/WAV ne s'affiche pour rien.
 *
 *  Extrait en fonction — et pas laissé en ligne dans `renderBatchRail` — parce que ces blocs
 *  dépendent de la SÉLECTION : ils doivent être recalculés par le chemin de tick unitaire
 *  (`updateBatchRailSelection`) autant que par la reconstruction complète du rail.
 *
 *  Markup de la pastille identique au rail Détail (`filing.ts` renderFoot) : `<button>` cliquable
 *  avec état `on` et thumb glissant, pas une piste de pilules sur mesure (audit 2026-07-05 puis
 *  2026-07-09). */
function formatBlocksHtml(): string {
  const { lossless: nLossless, lossy: nLossy } = batchSelectionByRail();
  const losslessBlock = nLossless
    ? `<div class="sift-rail-fmt-group"><span class="col-h">Lossless · ${nLossless}</span><div class="sift-seg sift-seg-thumbed" id="sift-batch-fmt-seg">` +
      `<div class="sift-seg-thumb"></div>` +
      (["mp3_320", "aiff_16_44", "wav_16_44"] as Target[])
        .map(
          (t) =>
            `<button class="sift-seg-opt${batchLosslessFormat === t ? " on" : ""}" data-sift="batchformat" data-t="${t}">${TARGET_LABEL[t]}</button>`,
        )
        .join("") +
      `</div></div>`
    : "";
  const lossyBlock = nLossy
    ? `<div class="sift-rail-fmt-group"><span class="col-h">Lossy · ${nLossy}</span>` +
      `<span style="font-size:var(--text-md);color:var(--color-text-secondary);white-space:nowrap;padding:var(--space-4) 0">${TARGET_LABEL["mp3_320"]} 320 <span style="color:var(--color-text-tertiary)">— seul format possible</span></span>` +
      `</div>`
    : "";
  return losslessBlock + lossyBlock;
}

/** The group-header tri-state checkbox glyph for a batch group (Prêts/À vérifier). Selection state
 * is read from the live Sets — reused by renderBatch's initial paint AND by mutateBatchTick's
 * targeted refresh, so both agree. "readonly" has no selection → empty string. */
function groupBoxHtml(kind: "file" | "fake" | "readonly", ids: number[]): string {
  const sel = kind === "file" ? batchSel : kind === "fake" ? batchFakeSel : null;
  if (!sel) return "";
  const n = ids.filter((id) => sel.has(id)).length;
  const st = ids.length === 0 || n === 0 ? "empty" : n === ids.length ? "full" : "partial";
  return st === "full"
    ? '<span class="sift-bgrp-box on"><i class="ti ti-check"></i></span>'
    : st === "partial"
      ? '<span class="sift-bgrp-box partial"><i class="ti ti-minus"></i></span>'
      : '<span class="sift-bgrp-box"></span>';
}

/** Targeted update after a single batch tick (Task 3a). Mutates ONLY: (1) the clicked row's
 * checkbox + highlight, (2) its group-header tri-state box, (3) the rail's selection count + action
 * button. Replaces the previous full renderBatch() on every checkbox click — that rebuilt every
 * group (thousands of rows in "Prêts") on a per-click event, the audit's worst frontend hotspot
 * (2026-07-05 P2). Structural changes (select-all, collapse, mode) still call renderBatch. */
function mutateBatchTick(kind: "file" | "fake", id: number, row: HTMLElement): void {
  const on = (kind === "file" ? batchSel : batchFakeSel).has(id);
  // Row: checkbox checked state + selected background (mirrors readyRow/fakeRow at build time).
  const cb = row.querySelector<HTMLInputElement>("input.sift-batch-ck");
  if (cb) cb.checked = on;
  row.setAttribute("aria-checked", String(on));
  row.style.background = on ? "var(--overlay-hover)" : "";
  // Group header tri-state box: rebuild just that one glyph from the live set.
  const ids =
    kind === "file"
      ? currentItems.filter((it) => it.verdict === "ok").map((it) => it.id)
      : currentItems.filter((it) => it.verdict === "fake").map((it) => it.id);
  const head = document.querySelector<HTMLElement>(`.sift-bgrp-head[data-grouphead="${kind}"]`);
  const oldBox = head?.querySelector(".sift-bgrp-box");
  if (oldBox) {
    const tmp = document.createElement("div");
    tmp.innerHTML = groupBoxHtml(kind, ids);
    const newBox = tmp.firstElementChild;
    if (newBox) oldBox.replaceWith(newBox);
  }
  // Rail: the only data-dependent pieces are the "N à ranger" count line and the action button.
  // Update them in place instead of renderBatchRail (which remounts the progress zone + dest tree).
  updateBatchRailSelection();
}

/** In-place refresh of the batch rail's selection count + action button after a tick — avoids the
 * full renderBatchRail rebuild (progress-zone remount, dest-tree re-render) on a mere selection
 * change. The count span + action slot are given stable hooks by renderBatchRail. */
function updateBatchRailSelection(): void {
  const count = document.getElementById("sift-batch-selcount");
  if (count) {
    const jeter = batchFakeSel.size ? ` · ${batchFakeSel.size} à jeter` : "";
    const reviewN = currentItems.filter((it) => it.verdict !== "ok").length;
    const exclus = reviewN
      ? ` · <span style="color:var(--color-text-tertiary)">${reviewN} exclus (en review)</span>`
      : "";
    count.innerHTML = `${batchSel.size} à convertir${jeter}${exclus}`;
  }
  const slot = document.querySelector(".sift-baction-slot");
  if (slot) slot.innerHTML = actionButtonHtml(batchRunning);
  // Les blocs de format dépendent EUX AUSSI de la sélection (compteur par rail, et présence même
  // du sélecteur lossless). Sans ce rafraîchissement, ce chemin de tick — le plus chaud, un clic
  // de case — laissait des compteurs faux, et surtout: cocher la première piste lossless d'un lot
  // ne faisait jamais apparaître son sélecteur, tandis que décocher la dernière le laissait
  // affiché sur une sélection qui n'en contenait plus. Trouvé par le crosscheck de la gate.
  const fmtHost = document.getElementById("sift-batch-fmt");
  if (fmtHost) {
    fmtHost.innerHTML = formatBlocksHtml();
    positionBatchFmtThumb();
  }
}

// Global progress zone — feed the "file" row from the per-file filing events (sous-étape 2). Mirror
// of pushAnalyzeProgress, but here done/total arrive straight from the event (no poll). On
// done==total the row flashes 100% "done" then auto-hides after 1.2s, exactly like the analyze row.
let fileClearTimer: ReturnType<typeof setTimeout> | undefined;
let fileStopping = false;
// True from the moment a batch File/Discard launches until file:done (or discard completes) — drives
// the rail button between its adaptive state and "Stop".
let batchRunning = false;
let lastFileProgress: FileProgress | null = null;
export function pushFileProgress(p: FileProgress) {
  lastFileProgress = p;
  if (p.total <= 0) {
    clearTask("file");
    return;
  }
  if (p.done < p.total) {
    clearTimeout(fileClearTimer);
    setTask("file", { done: p.done, total: p.total, state: "running", stopping: fileStopping });
  } else {
    setTask("file", { done: p.total, total: p.total, state: "done" });
    clearTimeout(fileClearTimer);
    fileClearTimer = setTimeout(() => {
      clearTask("file");
      clearBatchTracklist();
      refreshBatchTracksPreview(); // in-place: bring the source-folder preview back after the run
    }, 1200);
  }
  updateBatchTracklist(p.done); // first `done` rows = done, the (done)-th = running, rest = waiting
}

/** Stop button on the global zone's Filing row → request a stop-net cancel (sous-étape 3). The
 * in-flight file finishes and no new one starts; nothing is rolled back. The row shows "Stopping…"
 * until `file:done` arrives (handled by onFileBatchDone). The first click already takes effect
 * (flag set, button removed), but the only feedback used to be the small "Stopping…" at the bottom
 * of the nav rail — far from where the user clicked. While a conversion encodes, the counter is
 * frozen, so the cancel looks ignored and the user re-clicks into the void. We also drop an
 * immediate note at #filfoot (where they clicked File) so the click visibly registers right there. */
export function onFileStop() {
  if (fileStopping) return;
  fileStopping = true;
  if (lastFileProgress) {
    setTask("file", {
      done: lastFileProgress.done,
      total: lastFileProgress.total,
      state: "running",
      stopping: true,
    });
  }
  // Local, immediate feedback next to the action — explains the unavoidable wait on the in-flight
  // file (its encode cannot be cut). Replaced by the run summary when `file:done` arrives.
  fileNote(
    '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md);vertical-align:-1px"></i> Stop requested — finishing the current file…',
  );
  void fileCancel();
}

/** Batch triage view (maquette "Mode Lot"): 3 flat groups by verdict — Prêts · lossless
 * (selectable → File), À vérifier · fake (selectable → Écarter, never filed — Sift ne range
 * jamais un fake lossless), En analyse (read-only, encore en cours d'analyse).
 *
 * DEUX sélecteurs de format, un par rail source (`formatBlocksHtml`). La version précédente en
 * avait un seul et affirmait ici qu'« a lossy-sourced file CAN be asked for AIFF/WAV here » : c'est
 * faux, le backend applique `guard_no_upscale` sur tous les chemins, et les MP3 rebondissaient en
 * `needs_validation`. La décision « maquette prime » du 2026-07-01 est donc REMPLACÉE sur ce point
 * par l'arbitrage d'Antoine du 2026-07-28 (PLAN.md § arbitrages point 1) ; seule la règle
 * fakes-jamais-filés survit de la décision d'origine.
 *
 * Every control is bound to a real command (`fileBatch` / `rejectBatch`); nothing is mocked. */
export function renderBatch() {
  const mid = requireEl("#mid", "renderBatch");
  const ready = currentItems.filter((it) => it.verdict === "ok");
  const fakes = currentItems.filter((it) => it.verdict === "fake");
  const pending = currentItems.filter((it) => it.verdict !== "ok" && it.verdict !== "fake");
  // Prune ticks to the live ready set; default to all-ready selected ONCE (first render with ready
  // items). Guarded by batchSelInit so an explicit "Aucun (clear)" (batchSel→0) is NOT re-filled.
  const readyIds = new Set(ready.map((it) => it.id));
  for (const id of [...batchSel]) if (!readyIds.has(id)) batchSel.delete(id);
  if (!batchSelInit && ready.length) {
    batchSelInit = true;
    for (const it of ready) batchSel.add(it.id);
  }

  // BEFORE (file name) + AFTER (Discogs artist — title once identified). When not yet identified
  // only the filename shows; identifying it (Identify all) reveals the clean name above the file.
  //
  // CONTRASTE — paire connue, laissée EN L'ÉTAT sciemment, pas oubliée. Le `opacity:.55` sur le mot
  // « was » de la 2e ligne est le SEUL reste d'opacité de cette fonction, et il échoue AA dans les
  // DEUX thèmes: 2,28:1 en clair, 3,63:1 en sombre (--color-text-tertiary sur
  // --color-background-primary, le fond de `.pa` styles.css:265 ; compositing sRGB gamma 8 bits,
  // le modèle du navigateur). Le retrait de l'opacité de ligne dans pendingRow ci-dessous a DÉPLACÉ
  // cette paire — elle valait 1,60:1 / 2,17:1 sous .6 × .55 = .33 effectif — sans la faire passer.
  // Non corrigée ici parce que ce n'est pas une décision de px: le même idiome vit à
  // rekordbox-view.ts:233, donc trancher revient à décider ce qu'EST ce libellé — un texte
  // informatif soumis au 1.4.3, ou une vraie atténuation portée par un token comme le reste de la
  // ligne. Accord de surface d'abord, chiffre ensuite (CLAUDE.md § Front, « Concept avant
  // chiffres »), et dans le même geste que rekordbox-view.ts pour que les deux ne divergent pas.
  const nameCell = (it: QueueItem, dim = false) => {
    const after = it.artist && it.title ? `${it.artist} — ${it.title}` : null;
    const before = it.filename || it.path;
    const topColor = after
      ? "var(--color-text-primary)"
      : dim
        ? "var(--color-text-secondary)"
        : "var(--color-text-primary)";
    return (
      `<div style="flex:1;min-width:0">` +
      `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md);color:${topColor}">${esc(
        after ?? before,
      )}</div>` +
      (after
        ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono);margin-top:1px"><span style="opacity:.55">was</span> ${esc(
            before,
          )}</div>`
        : "") +
      `</div>`
    );
  };
  const readyRow = (it: QueueItem) => {
    const on = batchSel.has(it.id);
    return (
      // Audit-ref (Lot, 2026-07-24) : même correctif clavier que master.db Rekordbox
      // (rekordbox-view.ts, data-sift="mdbpick") — tabindex/role/aria-checked sur la ligne, clavier
      // générique via installNavKeyboard() (chrome.ts).
      `<div class="bx-row" data-sift="batchpick" data-id="${it.id}" tabindex="0" role="checkbox" aria-checked="${on}" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-xs);font-weight:600;letter-spacing:.03em;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUPLICATE</span>'
        : "") +
      `</div>`
    );
  };
  // Read-only "En analyse" rows — no checkbox, matches the maquette's inert third group.
  const pendingRow = (it: QueueItem) => {
    // "analyse…" for a track genuinely still in the pipeline; "échec" for one the worker has given
    // up on (terminally failed decode) so it isn't mislabelled as forever-in-progress — recovery is
    // the same "Ouvrir en Détail" button below (which re-runs analysis on the real open).
    const label =
      it.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS
        ? "échec"
        : it.verdict === "grey"
          ? "CHECK"
          : "analyse…";
    return (
      // PAS d'opacité sur la ligne. Elle portait `opacity:.6`, qui estompait aussi le badge DUP et
      // le mot d'état.
      // MODÈLE DE MESURE, valable pour tous les ratios de ce bloc: compositing sRGB gamma sur 8 bits
      // — celui du navigateur — sur --color-background-primary (fond de `.pa`, styles.css:265). Un
      // compositing en lumière linéaire donne d'autres nombres (2,18 et 1,96 pour les deux premiers
      // ci-dessous) ; c'est le mauvais modèle pour du CSS `opacity`, ne pas le rejouer.
      // Sous .6, en thème clair: DUP tombait à 2,75:1 et « analyse… / CHECK / échec » à 2,49:1, très
      // loin du seuil AA de 4,5:1 — alors que « échec » est précisément l'information qu'on n'a pas
      // le droit d'estomper (une piste dont l'analyse a échoué doit se voir MIEUX que les autres,
      // pas moins bien). À pleine opacité les mêmes paires mesurent 6,21:1 et 5,49:1 en clair,
      // 4,98:1 et 8,49:1 en sombre — AA dans les deux thèmes.
      // Ce qui porte l'atténuation, exactement: la LIGNE DE TITRE de `nameCell(it, true)`, par un
      // TOKEN (--color-text-secondary au lieu de --color-text-primary: 5,69:1 en clair, 8,95:1 en
      // sombre — ratio dépendant du token, qui a bougé le 2026-08-05, cf. styles.css:196). Deux
      // restrictions à ne pas gommer: (1) cette ligne n'est atténuée que TANT QUE la piste n'est pas
      // identifiée — dès qu'un couple artiste/titre existe, `topColor` repasse à
      // --color-text-primary et le titre n'est plus atténué du tout ; (2) `nameCell` n'est PAS purgé
      // d'opacité, le mot « was » de sa 2e ligne garde un `opacity:.55` qui échoue AA dans les deux
      // thèmes (paire connue et ouverte, mesurée dans le commentaire de nameCell ci-dessus).
      // Pourquoi un TOKEN plutôt qu'une opacité sur ce texte — la raison est STRUCTURELLE, ce n'est
      // PAS un argument de contraste. La contrefactuelle réelle est une opacité sur
      // --color-text-primary (c'est lui que le token remplace, cf. `topColor`), et elle passe AA:
      // dès ~.71 en clair (.70 → 4,47:1, échec ; .71 → 4,56:1, passe) et dès ~.50 en sombre. À .71
      // l'atténuation se voit franchement, et le résultat est même PLUS atténué que la version
      // token (4,56:1 contre 5,69:1). Ce qui départage les deux: une opacité estompe TOUT le
      // sous-arbre — précisément ce que faisait l'`opacity:.6` retiré ci-dessus, badge DUP et mot
      // d'état compris — là où un token ne touche que l'encre de la ligne visée. Ne pas réécrire
      // ceci en « aucune opacité ne passe AA »: ce seuil-là (~.89 en clair) porte sur une opacité
      // appliquée à --color-text-SECONDARY, c'est-à-dire « puis-je assombrir ENCORE le token déjà
      // atténué ? » — une autre question que le choix de conception.
      // Le reste de l'inertie du groupe est déjà porté par la structure: pas de case à cocher, pas
      // de fond de SÉLECTION (readyRow/fakeRow portent --overlay-hover dès qu'ils sont cochés, et
      // batchSelInit les coche tous au premier rendu), pas de border-radius, pas de
      // cursor/tabindex/role, pas de classe .bx-row donc pas son margin-top inter-lignes
      // (styles.css:718), en-tête « En analyse ». Aucun survol là-dedans: .bx-row n'a AUCUNE règle
      // :hover — le fond que portent les lignes cochées est un état de sélection, pas un survol.
      `<div style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8)">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-xs);font-weight:600;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUP</span>'
        : "") +
      `<span style="flex:none;font-size:var(--text-xs);color:var(--color-text-tertiary)">${label}</span>` +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:var(--space-4) var(--space-8);color:var(--color-text-info)">Ouvrir en Détail</button>` +
      `</div>`
    );
  };

  // Fakes are selectable to DISCARD (their own tick set), never to file.
  const fakeRow = (it: QueueItem) => {
    const on = batchFakeSel.has(it.id);
    return (
      // Audit-ref (Lot, 2026-07-24) : voir readyRow ci-dessus, même correctif clavier.
      `<div class="bx-row" data-sift="batchpickfake" data-id="${it.id}" tabindex="0" role="checkbox" aria-checked="${on}" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      '<span style="flex:none;font-size:var(--text-xs);font-weight:600;letter-spacing:.03em;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-danger);color:var(--color-text-danger)">FAKE</span>' +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:var(--space-4) var(--space-8);color:var(--color-text-info)">Ouvrir en Détail</button>` +
      `</div>`
    );
  };

  // A group header row: tri-state checkbox + dot + label + count, mirroring the maquette's
  // `groupDefs` (label already reads "Prêts · lossless" / "À vérifier · fake" / "En analyse" —
  // the count is appended separately so it stays JetBrains Mono like every other counter).
  const groupHead = (
    kind: "file" | "fake" | "readonly",
    dotColor: string,
    label: string,
    ids: number[],
  ) => {
    const sel = kind === "file" ? batchSel : kind === "fake" ? batchFakeSel : null;
    const box = groupBoxHtml(kind, ids);
    const clickable = sel ? ` data-sift="batchgroup" data-kind="${kind}" style="cursor:pointer"` : "";
    const collapsed = batchCollapsed.has(kind);
    const caret =
      `<span data-sift="batchcollapse" data-kind="${kind}" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;cursor:pointer;transform:rotate(${
        collapsed ? "0deg" : "90deg"
      });transition:transform .12s"><i class="ti ti-chevron-right" style="font-size:var(--text-xs);color:var(--color-text-tertiary)"></i></span>`;
    // data-grouphead lets mutateBatchTick (Task 3a) find and refresh just this header's tri-state
    // box after a single tick, instead of re-rendering the whole batch board.
    return (
      `<div class="sift-bgrp-head" data-grouphead="${kind}"${clickable}>` +
      caret +
      box +
      `<span style="width:var(--space-4);height:var(--space-4);border-radius:999px;background:${dotColor};flex:none"></span>` +
      `<span class="col-h">${esc(label)} · ${ids.length}</span>` +
      `</div>`
    );
  };

  // Render a group's rows capped at batchGroupCap[kind] (Task 3b), with a "afficher les N suivants"
  // control when there are more. Collapsed → nothing. The cap bounds DOM size on huge groups
  // ("Prêts" can be thousands) without windowing the collapsible structure.
  const cappedBody = <T extends QueueItem>(
    kind: "file" | "fake" | "readonly",
    list: T[],
    rowFn: (it: T) => string,
  ): string => {
    if (batchCollapsed.has(kind)) return "";
    const cap = batchGroupCap[kind];
    const shown = list.slice(0, cap);
    let html = shown.map(rowFn).join("");
    const remaining = list.length - shown.length;
    if (remaining > 0) {
      const next = Math.min(remaining, BATCH_GROUP_PAGE);
      html +=
        `<button data-sift="batchmore" data-kind="${kind}" style="width:100%;margin-top:var(--space-4);padding:var(--space-8);font-size:var(--text-sm);color:var(--color-text-info);cursor:pointer;background:transparent;border:none;text-align:center">Afficher les ${next} suivants (${remaining} restants)</button>`;
    }
    return html;
  };

  // No center action bar: the destination + adaptive File/Discard/Stop button now live solely in the
  // right rail (renderBatchRail), mirroring the Detail screen's CTA-in-the-rail grammar.
  mid.innerHTML =
    `<div style="display:flex;flex-direction:column;height:100%;min-height:0">` +
    `<div style="flex:1;min-height:0;overflow-y:auto;padding-right:2px">` +
    (ready.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("file", "var(--color-text-success)", "Prêts · lossless", ready.map((it) => it.id)) +
        cappedBody("file", ready, readyRow) +
        `</div>`
      : '<div class="col-h">Prêts · lossless · 0</div><div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:4px 9px 14px">Rien à convertir pour l’instant.</div>') +
    (fakes.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("fake", "var(--color-text-warning)", "À vérifier · fake", fakes.map((it) => it.id)) +
        cappedBody("fake", fakes, fakeRow) +
        `</div>`
      : "") +
    (pending.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("readonly", "var(--color-text-tertiary)", "En analyse", pending.map((it) => it.id)) +
        cappedBody("readonly", pending, pendingRow) +
        `</div>`
      : "") +
    `</div></div>`;

  renderBatchRail(fakes.length + pending.length);
}


/** The destination actually passed to the filer (FILE_IN_PLACE sentinel, or the picked folder rel). */
function batchDest(): string {
  return batchInPlace ? FILE_IN_PLACE : batchBin;
}
/** Human label for the batch destination — shown in the rail récap + name preview. */
function batchDestLabel(): string {
  if (batchInPlace) return IN_PLACE_LABEL;
  if (batchBin.startsWith(EXTERNAL_DEST_PREFIX)) {
    const abs = batchBin.slice(EXTERNAL_DEST_PREFIX.length);
    return abs.split(/[\\/]/).filter(Boolean).pop() || abs;
  }
  return batchBin || "Racine de bibliothèque";
}
/** A folder click in the #fldz tree (batch pick mode) -> set batchBin, drop in-place, re-render. */
export function onBatchBinPick(rel: string): void {
  batchBin = rel;
  batchInPlace = false; // choosing a folder turns off "file in place"
  const fldz = document.getElementById("fldz");
  if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
}
/** Ensure the batch destination UI around #fldz: the tree is in batch pick mode. The "file in
 *  place" checkbox itself now renders as part of renderBins's own output (filing.ts) — same
 *  markup/attribute for both modes — so there's nothing left to create here, only the inert
 *  (greyed) state to keep in sync on every rail rebuild. */
function ensureBatchDestUI(): void {
  const fldz = document.getElementById("fldz");
  if (!fldz) return;
  // In-place GREYS the tree (visible but inert) — never hides it; the tree only picks a real folder.
  // ensureBatchDestUI runs on EVERY renderBatchRail (incl. run start and the post-run refresh), so
  // syncing binPick.inert here makes it the single source of truth: a later renderBins (queue refresh
  // during/after a run) re-asserts the SAME state via its own .sift-fldz-tree opacity logic.
  setBinPickInert(batchInPlace);
  fldz.style.display = ""; // belt-and-suspenders: a greyed tree must stay laid out, not collapse
  const treeWrap = fldz.querySelector<HTMLElement>(".sift-fldz-tree");
  if (treeWrap) {
    treeWrap.style.opacity = batchInPlace ? ".4" : "1";
    treeWrap.style.pointerEvents = batchInPlace ? "none" : "auto";
  }
}

/** The single rail action button. Adaptive before a run (Convertir / Discarder / both / disabled),
 *  "Stop" during one. `running` swaps to the Stop affordance (wired to onFileStop).
 *  Verb was "Ranger" (not "Filer") to match the Détail rail's verb — one action, one name (audit
 *  UI/UX 2026-07-03, fix 2). Changed to "Convertir" (2026-07-10, retour utilisateur: more explicit
 *  about what the button does) — the Détail-rail/batch-rail pair still shares one verb, see
 *  filing.ts's refreshRangerButton (internal name kept, only the displayed word changed). */
function actionButtonHtml(running: boolean): string {
  if (running) {
    return '<button data-sift="batchstop" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Stop</button>';
  }
  const fileN = batchSel.size;
  const fakeN = batchFakeSel.size;
  if (fileN === 0 && fakeN === 0)
    return '<button class="sift-baction" disabled style="background:var(--color-background-info);color:var(--color-text-info);opacity:.5;pointer-events:none">Convertir (0)</button>';
  // Second-click confirm for large batches (see BATCH_CONFIRM_THRESHOLD) — armed only for the
  // exact selection it was requested for, so ticking/unticking a track after arming falls back
  // to asking again instead of silently confirming a changed selection. The button looks like a
  // plain Convertir button until the first click arms it (the click handler re-renders this as the
  // danger "Confirmer" state below) — a distinct button for the actual destructive click, not a
  // permanent scary button sitting there before the user has done anything.
  const armed =
    !!batchConfirmArmed && batchConfirmArmed.fileN === fileN && batchConfirmArmed.fakeN === fakeN;
  if (armed) {
    // The auto-disarm was silent until now: the button just reverted mid-reach. A 2px rail drains
    // under it for exactly the remaining window.
    // Indexed on the DEADLINE, never on this node's birth — a negative animation-delay of however
    // long the arming already lasted. This rail is rebuilt from several places while armed (every
    // selection tick goes through updateBatchRailSelection), and a bar restarted at 0 on each
    // rebuild would promise 5 more seconds that the timer will not honour.
    // Both numbers come from BATCH_CONFIRM_ARM_MS, the same constant the setTimeout reads.
    // NOT the 400ms double-click floor: that guard is logic, evaluated once at click time against
    // batchConfirmArmed.at, and it has no business being mirrored into a DOM that gets rebuilt.
    const elapsed = Date.now() - batchConfirmArmed!.at;
    const drain =
      `<span class="sift-baction-arm" style="animation-duration:${BATCH_CONFIRM_ARM_MS}ms;animation-delay:${-elapsed}ms"></span>`;
    // Explicit exit alongside the auto-disarm (batchConfirmTimer) — audit UX 2026-07-24 :
    // no way to back out of the armed state before the second click except waiting it out. Reuses
    // the exact same reset (see "batchcancelconfirm" in the click handler below).
    return (
      `<button data-sift="batchaction" class="sift-baction sift-baction-armed" style="background:var(--color-background-danger);color:var(--color-text-danger)">Confirmer — convertir ${fileN} ?${drain}</button>` +
      `<button data-sift="batchcancelconfirm" class="sift-baction-cancel" style="background:none;border:none;color:var(--color-text-tertiary);font-size:var(--text-xs);padding:0 var(--space-8);cursor:pointer">Annuler</button>`
    );
  }
  if (fakeN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Convertir (${fileN})</button>`;
  if (fileN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Écarter (${fakeN})</button>`;
  return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Convertir (${fileN}) · Écarter (${fakeN})</button>`;
}

/** Positions the batch Format thumb from whichever button currently carries `.on`. Called both
 * right after a full rebuild (fresh node — just places it) and, deferred by a frame, right after a
 * format click (see the "batchformat" handler) so the move is what actually animates. */
function positionBatchFmtThumb(): void {
  const seg = document.getElementById("sift-batch-fmt-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-sift='batchformat'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Right-rail summary for batch mode (board's SELECTION / DESTINATION / WILL ENCODE / EXCLUDED).
 * Replaces the filing footer + hides the folder tree while batching. */
function renderBatchRail(reviewN: number) {
  const foot = requireEl("#filfoot", "renderBatchRail");
  requireEl("#fldz", "renderBatchRail"); // fail-fast: asserts the popover host exists
  ensureBatchDestUI();
  // Preserve the LIVE run's progress list across this wholesale rebuild (renderBatch rebuilds the rail
  // on every selection change). Not while idle — the choice-time preview is rebuilt fresh below.
  const keepTracks = batchRunning ? foot.querySelector("#sift-batch-tracks") : null;
  const keepNote = foot.querySelector("[data-file-note]");
  // The progress zone may live in THIS rail from a prior render; park it back in its nav home before the
  // innerHTML wipe (which would destroy the node + its live rowCache), then re-mount into the fresh slot.
  if (foot.querySelector("#sift-progress-zone")) homeProgressZone();
  // Destination button in BOTH modes: a real folder (tree mode) or the in-place RULE label
  // ("Dossier source de chaque morceau") — batchDestLabel() resolves which. In-place states the rule
  // once here instead of listing each track's folder. Clickable — opens the #fldz popover (batch's
  // own rail doesn't go through filing.ts's renderFoot, so it wires the same toggle itself).
  const destBlock = `<button data-fil="destbtn" class="sift-dest-btn"><span class="sift-dest-btn-label">Destination</span><span class="sift-fil-bin">${esc(
    batchDestLabel(),
  )}</span><i class="ti ti-chevron-down sift-dest-btn-caret"></i></button>`;
  // "Excluded" is folded into Selection as a discreet (tertiary) suffix — no separate block.
  const jeter = batchFakeSel.size ? ` · ${batchFakeSel.size} à jeter` : "";
  const exclus = reviewN
    ? ` · <span style="color:var(--color-text-tertiary)">${reviewN} exclus (en review)</span>`
    : "";
  // Enveloppe stable : son CONTENU est recalculé aussi par `updateBatchRailSelection` (chemin de
  // tick), pas seulement par cette reconstruction complète du rail.
  const formatBlock = `<div id="sift-batch-fmt" style="display:contents">${formatBlocksHtml()}</div>`;
  // Rail order (one row, matching the Detail rail): Destination → Format → spacer → Selection
  // count → action, all on the first line — then progress/tracks (each flex-basis:100%, empty/
  // invisible while idle) wrap below since they come AFTER the action button in DOM order
  // (audit 2026-07-05, annotation: "même style et logique que dans détail, tout sur une ligne").
  // "Final name" motif dropped — redundant with Selection + the per-track list once a run
  // starts (see batchNameMotifHtml removal, Task 3).
  foot.innerHTML =
    destBlock +
    formatBlock +
    `<div class="sift-rail-spacer"></div>` +
    `<span id="sift-batch-selcount" style="font-size:var(--text-sm);color:var(--color-text-secondary);white-space:nowrap">${
      batchSel.size
    } à convertir${jeter}${exclus}</span>` +
    `<div class="sift-baction-slot">${actionButtonHtml(batchRunning)}</div>` +
    `<div id="sift-batch-progress" style="flex-basis:100%"></div>` +
    `<div id="sift-batch-tracks" style="flex-basis:100%"></div>`;
  if (keepNote) foot.insertAdjacentElement("afterbegin", keepNote);
  if (keepTracks) foot.querySelector("#sift-batch-tracks")!.replaceWith(keepTracks);
  else refreshBatchTracksPreview(); // idle → keep the per-track list empty (it is a run-only artifact)
  foot.querySelector('[data-fil="destbtn"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDestPopover();
  });
  ensureDestPopoverAutoClose();
  // Move the single progress zone into the rail (batch). setTask/clearTask keep driving the same node,
  // so Filing X/N + Analysing render here with no duplicated logic. Detail restores it via setReviewMode.
  mountProgressZone(requireEl("#sift-batch-progress", "renderBatchRail progress slot"));
  repositionDestPopoverIfOpen(); // the destbtn above was just rebuilt — keep an open popover glued to it
  positionBatchFmtThumb(); // fresh node post-rebuild — no prior transform, just place it
}

/** Launch background filing of every ticked (green) track into the chosen bin, then return — the
 * work runs off the main thread, so the UI stays responsive and analysis can keep running. A
 * spinner note is shown; the per-run summary AND the view refresh arrive later via the `file:done`
 * event (see `onFileBatchDone`). Filed tracks leave the queue, so the refresh prunes them from the
 * ticked set automatically. */
async function runBatchFile() {
  const ids = [...batchSel];
  if (ids.length === 0) return;
  fileStopping = false;
  lastFileProgress = null;
  // Flip the rail button to Stop and (re)build the rail so the progress slot exists before mounting.
  batchRunning = true;
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
  // Mount the per-track list (ordered like the submitted ids) before launching — the first row
  // shows "running" immediately; file:progress/file:done drive the rest. No backend event needed.
  batchTrackIds = ids;
  startBatchTracklist(ensureBatchTracklistHost(), ids.map(batchTrackItem));
  fileNote(
    '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md);vertical-align:-1px"></i> Conversion en arrière-plan…',
  );
  // FIX-7: show 0/N in the global progress zone immediately at the click, same instant signal the
  // per-track tracklist above already gets — don't wait for the first file:progress event.
  setTask("file", { done: 0, total: ids.length, state: "running" });
  // Cible imposée UNIQUEMENT aux pistes de rail lossless. Tout le reste — lossy, `unknown`, et
  // pistes pas encore analysées — est volontairement ABSENT de la table: `ipc_filing::file_batch`
  // documente que « absent ids fall back to the auto target derived from the source rail
  // (encode::target_for) ». C'est ce qui rend l'upscale impossible par construction plutôt que
  // refusé après coup, et ce qui évite de dégrader en MP3 un lossless dont le rail est encore
  // `unknown`. Audit 2026-07-28, PP-1.
  const railById = new Map(currentItems.map((it) => [it.id, it.rail]));
  const targets: Record<number, Target> = {};
  for (const id of ids) {
    if (railById.get(id) === "lossless") targets[id] = batchLosslessFormat;
  }
  try {
    // Resolves as soon as the background task STARTS; the summary comes via file:done.
    await fileBatch(ids, batchDest(), targets);
  } catch (err) {
    // Launch-time rejections only (NoLibraryRoot, or the task couldn't start).
    const code = String(err);
    // Humanized fallback (audit UX/accessibilité 2026-07-24) — only NoLibraryRoot is a known,
    // actionable case; any other code falls back to a generic message instead of the raw error
    // (kept in console.error below), same pattern as filing-identify.ts's doApplyTags/doUndoApply.
    fileNote(
      code.includes("NoLibraryRoot")
        ? "Aucune racine de bibliothèque configurée — à définir dans Réglages."
        : "Échec du lancement de la conversion — réessaie",
      "var(--color-text-danger)",
    );
    console.error("file_batch launch failed", err);
  }
}

/** Display name for a batch row: the queue item's artist — title, else its filename/path. */
function batchTrackName(id: number): string {
  const it = currentItems.find((q) => q.id === id);
  if (!it) return `#${id}`;
  return [it.artist, it.title].filter(Boolean).join(" — ") || it.filename || it.path;
}

/** A per-track list item (id + display name). In-place mode no longer attaches a source-folder
 *  suffix: the récap states the RULE once ("Dossier source de chaque morceau"), so the per-track
 *  list stays identical to normal mode (name + status pill, no per-file path inventory). */
function batchTrackItem(id: number): { id: number; name: string } {
  return { id, name: batchTrackName(id) };
}

/** At choice time the per-track list is NOT shown in either mode: dumping the (up to ~1752) selected
 *  filenames row-by-row only duplicates the "N à filer" count and the "Final name" motif, drowning the
 *  récap. The list is a RUN artifact — startBatchTracklist mounts it live when filing begins. So here we
 *  just keep #sift-batch-tracks empty. No-op during a run (the live list owns the container). */
function refreshBatchTracksPreview(): void {
  if (reviewMode !== "batch" || batchRunning) return;
  const host = document.getElementById("sift-batch-tracks");
  if (!host) return;
  host.innerHTML = "";
}

/** Stable container for the per-track list, mounted in the right rail (#filfoot) under the batch
 *  récap and above the action button, so all batch progress lives next to the controls that drive it. */
function ensureBatchTracklistHost(): HTMLElement {
  let el = document.getElementById("sift-batch-tracks");
  if (!el) {
    // The rail slot (renderBatchRail's #sift-batch-tracks div) isn't mounted yet — create a detached
    // node and append it to the rail; renderBatchRail preserves it (keepTracks) on its next rebuild.
    el = document.createElement("div");
    el.id = "sift-batch-tracks";
    document.getElementById("filfoot")?.appendChild(el);
  }
  return el;
}

/** Insert/replace a transient note at the top of the batch rail (#filfoot), if it is on screen. */
function fileNote(html: string, color = "var(--color-text-secondary)") {
  const foot = document.getElementById("filfoot");
  if (!foot) return;
  foot.querySelector("[data-file-note]")?.remove();
  foot.insertAdjacentHTML(
    "afterbegin",
    `<div data-file-note style="font-size:var(--text-sm);color:${color};margin-bottom:10px">${html}</div>`,
  );
}

let refreshHook: (() => Promise<void>) | null = null;

/** Registers sift-live.ts's refresh() (renderRailSources + renderQueue + updateRevueBadge) so
 *  onFileBatchDone/runBatchDiscard can trigger a full view refresh after filing without a static
 *  import back to sift-live.ts (mirrors registerBatchRenderer in queue-panel.ts, opposite
 *  direction: this module calls OUT to the orchestrator instead of being called INTO). */
export function registerRefreshHook(fn: () => Promise<void>): void {
  refreshHook = fn;
}

/** End-of-(background-)filing handler, fired by the `file:done` event. Refreshes the view (as the
 * end-of-batch queue:changed used to) then shows the run summary — but only if the batch rail is
 * still on screen, since the user may have navigated away while the batch ran. */
export async function onFileBatchDone(res: BatchResult) {
  fileStopping = false;
  batchRunning = false; // the later refresh() repaints the rail button back to its adaptive state
  // Final per-track reconcile: filed ids = done, needs_validation ids = failed. A cancelled run only
  // processed the first `lastFileProgress.done` ids; the rest never started (left at waiting).
  const processed = res.cancelled ? batchTrackIds.slice(0, lastFileProgress?.done ?? 0) : batchTrackIds;
  const failed = new Set(res.needs_validation);
  finishBatchTracklist(processed.filter((id) => !failed.has(id)), res.needs_validation);
  if (res.cancelled) {
    // Stop-net end: no 100% done-flash came from progress (done<total). Flash the partial then hide.
    clearTimeout(fileClearTimer);
    const lp = lastFileProgress;
    if (lp) {
      setTask("file", { done: lp.done, total: lp.total, state: "done" });
      fileClearTimer = setTimeout(() => {
        clearTask("file");
        clearBatchTracklist();
        refreshBatchTracksPreview();
      }, 1200);
    } else {
      clearTask("file");
      clearBatchTracklist();
      refreshBatchTracksPreview();
    }
  }
  // Récap en français, et surtout: le TON suit le résultat. Avant, tout finissait sur une coche
  // verte en couleur succès — y compris « 0 filed · 250 need validation », c'est-à-dire un lot
  // entièrement rebondi affiché comme une réussite. C'est ce qui rendait le bug PP-1 invisible.
  // Audit 2026-07-28.
  const nKo = res.needs_validation.length;
  const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);
  const base = nKo
    ? `${res.filed} ${plural(res.filed, "rangée", "rangées")} · ${nKo} ${plural(nKo, "à vérifier", "à vérifier")}`
    : `${res.filed} ${plural(res.filed, "piste rangée", "pistes rangées")}`;
  const tone =
    res.filed === 0 && nKo
      ? { icon: "ti-alert-triangle", color: "var(--color-text-danger)" }
      : nKo
        ? { icon: "ti-alert-triangle", color: "var(--color-text-warning)" }
        : { icon: "ti-check", color: "var(--color-text-success)" };
  // Refresh the view, then post the run summary at #filfoot — after refresh so it survives
  // renderBatch's wholesale rail rebuild (renderBatchRail sets #filfoot.innerHTML). refresh() no
  // longer throws on an unmounted view (each renderer no-ops when its root is absent), so the
  // earlier try/finally guard around it is no longer needed.
  await refreshHook?.();
  fileNote(
    `<i class="ti ${tone.icon}" style="font-size:var(--text-md);vertical-align:-1px"></i> ${
      res.cancelled ? `Conversion interrompue · ${base}` : base
    }`,
    tone.color,
  );
}

/** Send every ticked track to Écartés for re-sourcing (backend emits queue:changed → redraw). */
async function runBatchDiscard() {
  const ids = [...batchFakeSel];
  if (ids.length === 0) return;
  batchRunning = true;
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
  try {
    await rejectBatch(ids);
    batchFakeSel.clear();
  } catch (err) {
    console.error("reject_batch failed", err);
    fileNote("Échec de l'écartement — réessaie", "var(--color-text-danger)");
  } finally {
    batchRunning = false;
    await refreshHook?.();
  }
}

/** Routes the batch mode's delegated clicks (selection, group toggles, format, confirm-to-file,
 *  stop) — the batchpick/batchgroup/batchcollapse/batchpickfake/batchmore/batchformat/batchopen/
 *  batchaction/batchstop data-sift actions. Extracted from sift-live.ts's installLiveWiring click
 *  handler (Phase 1, tranche 1c) — same split as handleRekordboxAction (1a) and the queue click
 *  handler (1b). Returns true if it handled `act`, false otherwise. */
export function handleBatchAction(el: HTMLElement, act: string, e: MouseEvent): boolean {
  if (act === "batchpick") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (batchSel.has(id)) batchSel.delete(id);
    else batchSel.add(id);
    // Targeted mutation of the clicked row + its group header + rail counts (Task 3a) — NOT a full
    // renderBatch (which rebuilt every group on each tick, the audit's worst UI hotspot). `el` is
    // the .bx-row (it carries data-sift="batchpick").
    mutateBatchTick("file", id, el);
  } else if (act === "batchgroup") {
    // Group-header tri-state toggle (maquette `onToggleAll`) — "file" selects/clears every
    // ready row, "fake" every fake row. Empty/partial → select all; full → clear.
    e.stopPropagation();
    const kind = el.dataset.kind === "fake" ? "fake" : "file";
    const ids =
      kind === "fake"
        ? currentItems.filter((it) => it.verdict === "fake").map((it) => it.id)
        : currentItems.filter((it) => it.verdict === "ok").map((it) => it.id);
    const sel = kind === "fake" ? batchFakeSel : batchSel;
    const full = ids.length > 0 && ids.every((id) => sel.has(id));
    for (const id of ids) if (full) sel.delete(id);
      else sel.add(id);
    renderBatch();
  } else if (act === "batchcollapse") {
    // Group-header caret — toggles that group's row list, independent from the tri-state
    // select-all box (its own data-sift, resolved by closest() before the parent's).
    e.stopPropagation();
    const kind = el.dataset.kind === "fake" ? "fake" : el.dataset.kind === "readonly" ? "readonly" : "file";
    if (batchCollapsed.has(kind)) batchCollapsed.delete(kind);
    else batchCollapsed.add(kind);
    renderBatch();
  } else if (act === "batchpickfake") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (batchFakeSel.has(id)) batchFakeSel.delete(id);
    else batchFakeSel.add(id);
    // Same targeted mutation as batchpick, on the fake-discard set (Task 3a).
    mutateBatchTick("fake", id, el);
  } else if (act === "batchmore") {
    // Progressive disclosure (Task 3b): bump this group's render cap by one page, re-render. A
    // structural change (more rows mounted) → full renderBatch is correct here, not a tick.
    e.stopPropagation();
    const kind =
      el.dataset.kind === "fake" ? "fake" : el.dataset.kind === "readonly" ? "readonly" : "file";
    batchGroupCap[kind] += BATCH_GROUP_PAGE;
    renderBatch();
  } else if (act === "batchformat") {
    e.stopPropagation();
    batchLosslessFormat = el.dataset.t as Target;
    // Toggle + reposition in place first, then let a frame paint before renderBatchRail()
    // rebuilds the whole rail synchronously (not async like Journal/Bibliothèque — nothing to
    // await here — so without this rAF the toggle and the rebuild land in the same tick and
    // there is nothing to animate FROM).
    document
      .querySelectorAll<HTMLElement>("#sift-batch-fmt-seg [data-sift='batchformat']")
      .forEach((b) => b.classList.toggle("on", b.dataset.t === batchLosslessFormat));
    positionBatchFmtThumb();
    requestAnimationFrame(() => {
      renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
    });
  } else if (act === "batchopen") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const item = currentItems.find((it) => it.id === id);
    enterDetailMode();
    const mid = requireEl("#mid", "batchopen");
    if (item && mid) {
      void openFilingInto(mid, item);
      prefetchNextAfter(item.id);
    }
  } else if (act === "batchcancelconfirm") {
    // Explicit disarm (audit UX 2026-07-24) — same reset as the silent 5s auto-disarm timeout above
    // (batchConfirmTimer), just triggered by a click instead of a wait.
    e.stopPropagation();
    clearTimeout(batchConfirmTimer);
    batchConfirmArmed = null;
    renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
  } else if (act === "batchaction") {
    e.stopPropagation();
    const fileN = batchSel.size;
    const fakeN = batchFakeSel.size;
    const armed =
      !!batchConfirmArmed &&
      batchConfirmArmed.fileN === fileN &&
      batchConfirmArmed.fakeN === fakeN;
    if (fileN > BATCH_CONFIRM_THRESHOLD && !(armed && Date.now() - batchConfirmArmed!.at >= 400)) {
      // Arm (or re-arm): re-render as the danger "Confirmer" button, don't file yet. The 400ms
      // floor on the confirming click rejects an accidental doubleclick/duplicate-event landing
      // on the same spot right after arming — the exact failure mode that filed ~265 real
      // tracks during this fix's own verification (audit UI/UX 2026-07-03, fix 3 incident).
      // Auto-disarms after BATCH_CONFIRM_ARM_MS of no second click — the same constant the drain
      // bar in actionButtonHtml animates over, so what the user sees is what the timer enforces.
      clearTimeout(batchConfirmTimer);
      batchConfirmArmed = { fileN, fakeN, at: Date.now() };
      batchConfirmTimer = setTimeout(() => {
        batchConfirmArmed = null;
        renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
      }, BATCH_CONFIRM_ARM_MS);
      renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
      return true;
    }
    clearTimeout(batchConfirmTimer);
    batchConfirmArmed = null;
    // Adaptive dispatch. Combined (both ticked): file runs with its progress UI (Stop follows it);
    // discard fires in parallel as a fast fire-and-forget — IDs captured before clear.
    if (batchSel.size && batchFakeSel.size) {
      const discardIds = [...batchFakeSel];
      batchFakeSel.clear();
      void runBatchFile();
      void rejectBatch(discardIds).catch((err: unknown) => {
        console.error("reject_batch (combined) failed", err);
        for (const id of discardIds) batchFakeSel.add(id);
        fileNote("Échec de l'écartement — réessaie", "var(--color-text-danger)");
      });
    } else if (batchSel.size) {
      void runBatchFile();
    } else if (batchFakeSel.size) {
      void runBatchDiscard();
    }
  } else if (act === "batchstop") {
    e.stopPropagation();
    onFileStop();
  } else {
    return false;
  }
  return true;
}

/** Handles the "file in place" checkbox change (batch mode's #fldz destination toggle) — extracted
 *  from installLiveWiring's dedicated change listener (Phase 1, tranche 1c) so batchInPlace stays
 *  mutated only inside this module. */
export function onBatchInPlaceChange(checked: boolean): void {
  batchInPlace = checked;
  const fldz = document.getElementById("fldz");
  if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
}
