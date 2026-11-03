// Écran Doublons — le markup, PUR : ni IPC ni état de module. Ce que le rendu lit de l'écran (plan,
// sources, curseur) lui arrive en argument, pour que la story exécute le vrai rendu au lieu de le
// recopier (même motif que `journal.ts::rowHtml`, `rail-source-entry.ts`). Spec :
// `docs/ui-specs/doublons.md` § Layout — option B, file de tri, décidée le 2026-10-30.
import type { DupScreenCopy, DupScreenGroup, QueueItem, Source } from "../shared/contracts";
import { esc } from "./dom";
import { formatGo } from "./usage-chart";
import { verdictDot } from "./queue-verdict-dot";
import {
  copyIssue,
  differingFields,
  fileName,
  groupFormats,
  groupOutcome,
  parentDir,
  recommendedCopy,
  rekordboxPlaylists,
  ruleReason,
  type DiffField,
  type Issue,
  type Plan,
} from "./duplicates-model";
import { T } from "./i18n/duplicates-view";

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return formatGo(bytes);
  const t = T();
  return `${(bytes / 1_000_000).toFixed(1).replace(".", t.decimalSep)} ${t.unitMo}`;
}

function fmtKhz(hz: number | null): string {
  if (hz == null) return "—";
  const t = T();
  const k = hz / 1000;
  return `${(Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)).replace(".", t.decimalSep)} ${t.unitKHz}`;
}

function fmtKbps(kbps: number | null): string {
  return kbps == null ? "—" : `${kbps} ${T().unitKbps}`;
}

function verdictView(v: string | null): { word: string; cls: string } {
  const t = T();
  if (v === "ok") return { word: t.verdictOk, cls: "sift-lib-v-ok" };
  if (v === "fake") return { word: t.verdictFake, cls: "sift-lib-v-fake" };
  if (v === "grey") return { word: t.verdictGrey, cls: "sift-lib-v-check" };
  return { word: "—", cls: "sift-lib-v-none" };
}

function proofLabel(p: DupScreenGroup["proof"]): string {
  const t = T();
  return p === "identical" ? t.proofIdentical : p === "same_sound" ? t.proofSameSound : t.proofSameName;
}

/** Le dossier court d'une copie : chemin relatif à sa source quand il y est, sinon les deux
 *  derniers segments. Le chemin complet reste dans le `title`. */
export function shortDir(c: DupScreenCopy, sources: readonly Source[]): string {
  const dir = parentDir(c.path);
  const src = sources.find((s) => s.id === c.source_id);
  if (src) {
    const root = src.path.replace(/[\\/]+$/, "");
    const low = dir.toLowerCase();
    const rootLow = root.toLowerCase();
    if (low === rootLow) return fileName(root);
    if (low.startsWith(rootLow + "\\") || low.startsWith(rootLow + "/")) {
      return [fileName(root), ...dir.slice(root.length + 1).split(/[\\/]/)].join(" › ");
    }
  }
  return dir.split(/[\\/]/).filter(Boolean).slice(-2).join(" › ");
}

/** « Artiste — Titre (Version) », le nom d'un groupe dans la file. */
function groupName(g: DupScreenGroup): string {
  return [g.artist, g.title].filter(Boolean).join(" — ") + (g.version ? ` (${g.version})` : "");
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

interface QueueRowState {
  active: boolean;
  /** Mode Lot : la case est posée, cochée ou non. `null` hors du mode Lot. */
  checked: boolean | null;
}

/** La pastille de verdict d'une copie, collée au titre : le rendu de la file de Revue, tel quel. */
function dotHtml(c: DupScreenCopy): string {
  return verdictDot({ verdict: c.verdict as QueueItem["verdict"], analysis_attempts: 0 });
}

/** Une ligne de groupe, 46 px comme `.qi` (spec § Colonne de file). */
export function queueRowHtml(g: DupScreenGroup, s: QueueRowState): string {
  const t = T();
  const sub =
    g.to_check
      ? `<span class="sift-dups-warn">${t.durationsDiffer}</span>`
      : `${t.copies(g.copies.length)} · ${proofLabel(g.proof).toLowerCase()} · ${esc(groupFormats(g))}`;
  const rkb = g.copies.some((c) => rekordboxPlaylists(c) != null)
    ? `<i class="ti ti-disc sift-dupq-rkb" title="${t.filterRekordbox}" aria-hidden="true"></i>`
    : "";
  return (
    `<div class="qi${s.active ? " cur" : ""}" id="dqi-${g.id}" role="option" aria-selected="${s.active}" data-dupgroup="${g.id}">` +
    (s.checked == null ? "" : `<input type="checkbox" class="qi-ck" data-dupspick="${g.id}" tabindex="-1"${s.checked ? " checked" : ""}>`) +
    `<div class="sift-dupq-body">` +
    `<div class="sift-dupq-line"><span class="sift-dupq-title">${esc(groupName(g))}</span>${g.copies.map(dotHtml).join("")}</div>` +
    `<div class="qi-sub">${sub}</div>` +
    `</div>` +
    rkb +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Grille du groupe ouvert
// ---------------------------------------------------------------------------

const DIFF_LABEL: Record<DiffField, () => string> = {
  verdict: () => T().diffVerdict,
  format: () => T().diffFormat,
  bitrate: () => T().diffBitrate,
  duration: () => T().diffDuration,
  folder: () => T().diffFolder,
  file: () => T().diffFile,
};

/** La ligne sous l'en-tête du lecteur : ce qui diffère d'une copie à l'autre, puis la preuve. */
export function groupFactsHtml(g: DupScreenGroup): string {
  const t = T();
  const diff = [...differingFields(g)].map((f) => DIFF_LABEL[f]());
  const best = g.links.reduce<number | null>(
    (m, l) => (l.kind === "same_sound" && l.similarity != null ? Math.max(m ?? 0, l.similarity) : m),
    null,
  );
  const proof =
    g.proof === "same_sound" && best != null
      ? t.proofPrint(best.toFixed(2).replace(".", t.decimalSep))
      : proofLabel(g.proof);
  return (
    `<div class="sift-dupb-facts">` +
    `<span class="sift-dupb-diff">${diff.length ? esc(t.differBy(diff.join(", "))) : t.differNothing}</span>` +
    `<span class="sift-dupb-proof">${esc(proof)}</span>` +
    `</div>`
  );
}

/** Pourquoi la règle recommande cette copie, en quelques mots (tête de colonne). */
function recommendedWhy(g: DupScreenGroup, kept: DupScreenCopy): string {
  const t = T();
  const other = g.copies.find((c) => c.id !== kept.id);
  if (!other) return "";
  const parts: string[] = [];
  const reason = ruleReason(g, kept, other);
  if (reason === "verdict" || reason === "verdict_grey") parts.push(verdictView(kept.verdict).word);
  else if (reason === "lossless") parts.push(t.whyShortLossless);
  else if (reason === "bitrate") parts.push(t.whyShortBitrate);
  else if (reason === "rate") parts.push(t.whyShortRate);
  else if (reason === "aiff") parts.push(".aiff");
  else if (reason === "truncated") parts.push(t.whyShortWhole);
  else if (reason === "tie") parts.push(t.whyShortOldest);
  if (rekordboxPlaylists(kept) != null) parts.push(t.whyShortRekordbox);
  return parts.join(", ");
}

function issueCellHtml(c: DupScreenCopy, issue: Issue): string {
  const t = T();
  switch (issue) {
    case "kept":
      return `<button type="button" class="sift-dupb-issue sift-dupb-issue--kept" data-dupsissue="${c.id}"><i class="ti ti-check" aria-hidden="true"></i>${t.issueKept}</button>`;
    case "trash":
      return `<button type="button" class="sift-dupb-issue sift-dupb-issue--trash" data-dupsissue="${c.id}"><i class="ti ti-trash" aria-hidden="true"></i>${t.issueTrash}</button>`;
    case "missing":
      return `<span class="sift-dupb-issue sift-dupb-issue--off">${t.issueMissing}</span>`;
    case "truncated":
      return `<span class="sift-dupb-issue sift-dupb-issue--off">${t.issueTruncated}</span>`;
  }
}

/** La grille de comparaison : une colonne d'étiquettes fixe, puis une colonne par copie, numérotée.
 *  Au-delà de 3 copies, les colonnes gardent leur largeur et la grille défile (décision 2 du
 *  2026-10-30). Encre de différence de l'hybride : ce qui diffère en primaire, l'identique en
 *  tertiaire. La colonne sous le curseur porte le fond de sélection. */
export function gridHtml(g: DupScreenGroup, plan: Plan, cursorId: number, sources: readonly Source[]): string {
  const t = T();
  const diff = differingFields(g);
  const ink = (f: DiffField | null) => (f == null || diff.has(f) ? "sift-dups-diff" : "sift-dups-same");
  const sizes = new Set(g.copies.map((c) => c.size_bytes));
  const rec = recommendedCopy(g, plan);
  const cols = g.copies.length;
  const cell = (c: DupScreenCopy, cls: string, body: string) =>
    `<div class="sift-dupb-cell${c.id === cursorId ? " cur" : ""} ${cls}" data-dupscol="${c.id}">${body}</div>`;
  const label = (text: string) => `<div class="sift-dupb-label">${text}</div>`;
  const line = (text: string, body: (c: DupScreenCopy) => [string, string]) =>
    label(text) + g.copies.map((c) => { const [cls, b] = body(c); return cell(c, cls, b); }).join("");

  const head =
    `<div class="sift-dupb-label"></div>` +
    g.copies
      .map((c, i) => {
        const status = c.status === "filed" ? t.stateFiled : t.statePending;
        return cell(
          c,
          "sift-dupb-head",
          `<div class="sift-dupb-where" title="${esc(c.path)}"><span class="sift-dupb-n">${i + 1}</span><span class="sift-dupb-dir">${esc(shortDir(c, sources))}</span></div>` +
            `<div class="sift-dupb-file ${ink("file")}" title="${esc(c.path)}">${esc(fileName(c.path))}</div>` +
            `<div class="sift-dupb-state">${status}</div>` +
            (c.id === rec.id && cols > 1
              ? `<div class="sift-dupb-rec"><b>${t.recommended}</b>${(() => { const w = recommendedWhy(g, c); return w ? ` — ${esc(w)}` : ""; })()}</div>`
              : ""),
        );
      })
      .join("");

  const rows =
    line(t.rowVerdict, (c) => {
      const v = verdictView(c.verdict);
      return [diff.has("verdict") ? v.cls : "sift-lib-v-none", `<span class="sift-lib-verdict-dot" aria-hidden="true"></span>${v.word}`];
    }) +
    line(t.rowCutoff, (c) => [ink(null), fmtKhz(c.cutoff_hz)]) +
    line(t.rowFormat, (c) => [
      diff.has("format") || diff.has("bitrate") ? "sift-dups-diff" : "sift-dups-same",
      `${esc(c.format.toUpperCase())} · ${fmtKbps(c.bitrate)} · ${fmtKhz(c.sample_rate)}`,
    ]) +
    line(t.rowDuration, (c) => [`sift-dupb-mono ${ink("duration")}`, fmtDuration(c.duration)]) +
    line(t.rowSize, (c) => [
      `sift-dupb-mono ${sizes.size > 1 ? "sift-dups-diff" : "sift-dups-same"}`,
      c.size_bytes == null ? "—" : fmtSize(c.size_bytes),
    ]) +
    line(t.rowIdent, (c) => [ink(null), c.discogs_release_id ? t.identified(c.year) : "—"]) +
    line(t.rowRekordbox, (c) => {
      const p = rekordboxPlaylists(c);
      if (p != null) return ["sift-dups-diff", `<i class="ti ti-disc" aria-hidden="true"></i>${t.playlists(p)}`];
      if (c.rekordbox.state === "unverified") return ["sift-dups-same", t.rekordboxUnverifiedShort];
      return ["sift-dups-same", "—"];
    }) +
    line(t.rowIssue, (c) => ["sift-dupb-issue-cell", issueCellHtml(c, copyIssue(c, plan))]);

  return (
    `<div class="sift-dupb-scroll"><div class="sift-dupb-grid" style="--dupb-cols:${cols}" role="grid" aria-label="${esc(t.gridAria)}">` +
    head +
    rows +
    `</div></div>`
  );
}

/** La phrase de conséquence, juste au-dessus de la légende : ce que fera Entrée. Un groupe où
 *  rien ne part (À vérifier, ou tout gardé) le dit ; une copie qui part et que Rekordbox joue
 *  ajoute sa ligne d'avertissement. */
export function consequenceHtml(g: DupScreenGroup, plan: Plan): string {
  const t = T();
  const o = groupOutcome(g, plan);
  let main: string;
  if (g.to_check && o.trashed.length === 0) main = t.consequenceToCheck(fmtDuration(g.duration_spread));
  else if (o.trashed.length === 0) main = t.consequenceKeepAll;
  else main = t.consequence(o.kept, o.trashed, fmtSize(o.bytes));
  const rkb = o.rekordbox.length
    ? `<div class="sift-dupb-consequence sift-dups-warn">${esc(t.consequenceRekordbox(o.rekordbox))}</div>`
    : "";
  return `<div class="sift-dupb-consequence">${esc(main)}</div>${rkb}`;
}

/** Libellé du bouton primaire : il GARDE, il n'est pas destructif (spec § Zone C, planche B). */
export function keepButtonLabel(g: DupScreenGroup, plan: Plan): string {
  const t = T();
  const o = groupOutcome(g, plan);
  return o.trashed.length === 0 ? t.keepAllButton : t.keepButton(o.kept);
}

/** La légende clavier, au format de Revue (`report-view.ts::keyboardHintsHtml`). */
export function legendHtml(): string {
  const t = T();
  const k = (key: string, what: string) => `<span><b>${key}</b> ${what}</span>`;
  return (
    `<div class="sift-kbd-hints">` +
    k("SPACE", t.kbdListen) +
    k(t.kbdLeftRight, t.kbdCopy) +
    k("G", t.kbdToggle) +
    k("ENTER", t.kbdKeep) +
    k("BKSP", t.kbdTrashNow) +
    k("N", t.kbdNotDups) +
    k(t.kbdUpDown, t.kbdGroup) +
    `</div>`
  );
}
