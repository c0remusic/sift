// Écran Doublons — le markup de la table, PUR : ni IPC ni état de module. Ce que le rendu lit de
// l'écran (plan, groupes touchés, sources, copie ouverte) lui arrive en argument, pour que la
// story exécute le vrai rendu au lieu de le recopier (même motif que `journal.ts::rowHtml`,
// `rail-source-entry.ts`). Spec : `docs/ui-specs/doublons.md` § Zone C.
import type { DupScreenCopy, DupScreenGroup, Source } from "../shared/contracts";
import { esc } from "./dom";
import { formatGo } from "./usage-chart";
import { resolveSourceColorKey } from "./source-color";
import {
  differingFields,
  fileName,
  groupEffect,
  isKept,
  keepable,
  parentDir,
  rekordboxPlaylists,
  type DiffField,
  type DupRow,
  type Plan,
} from "./duplicates-model";
import { T } from "./i18n/duplicates-view";

/** Ce que le rendu d'une rangée lit de l'écran. */
export interface DupRowView {
  plan: Plan;
  touched: ReadonlySet<number>;
  sources: readonly Source[];
  openId: number | null;
}

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

export function fmtKhz(hz: number | null): string {
  if (hz == null) return "—";
  const t = T();
  const k = hz / 1000;
  return `${(Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)).replace(".", t.decimalSep)} ${t.unitKHz}`;
}

export function fmtKbps(kbps: number | null): string {
  return kbps == null ? "—" : `${kbps} ${T().unitKbps}`;
}

export function verdictView(v: string | null): { word: string; cls: string } {
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
      return dir.slice(root.length + 1).split(/[\\/]/).join(" › ");
    }
  }
  return dir.split(/[\\/]/).filter(Boolean).slice(-2).join(" › ");
}

function sourceDot(c: DupScreenCopy, sources: readonly Source[]): string {
  const src = sources.find((s) => s.id === c.source_id);
  const key = src ? resolveSourceColorKey([...sources], src) : "";
  return `<span class="sift-rail-src-dot${key ? ` sift-rail-src-dot-${esc(key)}` : ""}" aria-hidden="true"></span>`;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function headHtml(): string {
  const t = T();
  const c = (label: string, cls = "") => `<span class="sift-lib-colhead${cls ? ` ${cls}` : ""}" role="columnheader">${label}</span>`;
  return (
    `<div class="sift-lib-thead sift-dups-row" role="row">` +
    c(t.colKeep) +
    c(t.colFile) +
    c(t.colProof) +
    c(t.colVerdict, "sift-lib-col-verdict") +
    c(t.colFormat) +
    c(t.colBitrate, "sift-dups-r") +
    c(t.colDuration, "sift-dups-dur") +
    c(t.colFolder) +
    c(t.colRekordbox) +
    `</div>`
  );
}

/** La nature d'un groupe, en tertiaire sur sa rangée : ce qui distingue ses copies. */
function natureText(g: DupScreenGroup, diff: Set<DiffField>): string {
  const t = T();
  const parts: string[] = [];
  if (g.to_check && g.duration_spread != null && g.duration_spread > 0) {
    parts.push(t.natureDurations(fmtDuration(g.duration_spread)));
  }
  if (diff.has("verdict") || diff.has("bitrate")) parts.push(t.natureQuality);
  else if (diff.has("format")) parts.push(t.natureContainer);
  if (g.copies.some((c) => c.truncated)) parts.push(t.natureTruncated);
  const stems = new Set(g.copies.map((c) => fileName(c.path).replace(/\.[^.]+$/, "").toLowerCase()));
  if (stems.size > 1) parts.push(t.natureName);
  if (diff.has("folder")) parts.push(t.natureFolder);
  return [t.copies(g.copies.length), parts.join(", ")].filter(Boolean).join(" · ");
}

export function groupEffectHtml(g: DupScreenGroup, v: DupRowView): string {
  const t = T();
  if (g.to_check && !v.touched.has(g.id)) return `<span class="sift-dups-effect sift-dups-warn">${t.effectToCheck}</span>`;
  const e = groupEffect(g, v.plan, v.touched);
  if (e.toTrash.length === 0 || !e.inPlan) return `<span class="sift-dups-effect">${t.effectNone(e.kept)}</span>`;
  const rkb =
    e.rekordboxCopies > 0 ? ` · <span class="sift-dups-warn">${t.effectRekordbox(e.rekordboxPlaylists)}</span>` : "";
  return `<span class="sift-dups-effect">${t.effectTrash(e.toTrash.length, fmtSize(e.bytes))}${rkb}</span>`;
}

/** La rangée d'en-tête d'un groupe : titre (la version jamais tronquée), preuve, nature, effet. */
export function groupRowHtml(g: DupScreenGroup, index: number, v: DupRowView): string {
  const diff = differingFields(g);
  const head = [g.artist, g.title].filter(Boolean).join(" — ");
  const version = g.version ? ` (${g.version})` : "";
  return (
    `<div class="lr sift-dups-row sift-dups-hd${index % 2 === 1 ? " alt" : ""}" data-dupgroup="${g.id}" role="presentation">` +
    `<span class="sift-dups-title"><span class="sift-dups-title-a">${esc(head)}</span><span class="sift-dups-title-b">${esc(version)}</span></span>` +
    `<span class="sift-dups-proof">${proofLabel(g.proof)}</span>` +
    `<span class="sift-dups-meta"><span class="sift-dups-nature">${esc(natureText(g, diff))}</span>${groupEffectHtml(g, v)}</span>` +
    `</div>`
  );
}

/** Coupe le nom pour une troncature AU MILIEU : la tête s'ellipse, la queue « (Version).ext »
 *  reste entière — la version distingue un remix. */
function splitFileName(name: string): [string, string] {
  const paren = name.lastIndexOf(" (");
  if (paren > 0) return [name.slice(0, paren), name.slice(paren)];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** La rangée d'une copie : case Garder, fichier, verdict (teinté s'il diffère dans le groupe),
 *  format, débit, durée, dossier, Rekordbox — encre primaire pour ce qui diffère. */
export function copyRowHtml(g: DupScreenGroup, c: DupScreenCopy, index: number, v: DupRowView): string {
  const t = T();
  const diff = differingFields(g);
  const ink = (f: DiffField) => (diff.has(f) ? "sift-dups-diff" : "sift-dups-same");
  const kept = isKept(v.plan, c);
  const name = fileName(c.path);
  const [head, tail] = splitFileName(name);
  const mark = c.missing
    ? `<span class="sift-dups-mark">${t.markMissing}</span>`
    : c.truncated
      ? `<span class="sift-dups-mark">${t.markTruncated}</span>`
      : "";
  const verdict = verdictView(c.verdict);
  const vcls = diff.has("verdict") ? verdict.cls : "sift-lib-v-none";
  const p = rekordboxPlaylists(c);
  const rkb =
    p != null
      ? `<span class="sift-dups-rkb${!kept ? " sift-dups-warn" : ""}"><i class="ti ti-disc" aria-hidden="true"></i>${t.playlists(p)}</span>`
      : `<span></span>`;
  const open = c.id === v.openId;
  const label = `${name}, ${verdict.word}, ${c.format.toUpperCase()}`;
  return (
    `<div class="lr sift-dups-row${open ? " cur" : ""}${index % 2 === 1 ? " alt" : ""}" data-dupcopy="${c.id}" data-dupgroup="${g.id}" role="option" aria-selected="${open}" aria-label="${esc(label)}">` +
    `<span class="sift-dups-keep"><input type="checkbox" class="sift-dups-ck" data-dupkeep="${c.id}"${kept ? " checked" : ""}${keepable(c) ? "" : " disabled"} aria-label="${esc(t.keepAria(name))}"></span>` +
    `<span class="sift-dups-file ${ink("file")}" title="${esc(c.path)}"><span class="sift-dups-file-a">${esc(head)}</span><span class="sift-dups-file-b">${esc(tail)}</span>${mark}</span>` +
    `<span></span>` +
    `<span class="sift-lib-col-verdict ${vcls}"><span class="sift-lib-verdict-dot" aria-hidden="true"></span>${verdict.word}</span>` +
    `<span class="${ink("format")}">${esc(c.format.toUpperCase())}</span>` +
    `<span class="sift-dups-num sift-dups-r ${ink("bitrate")}">${fmtKbps(c.bitrate)}</span>` +
    `<span class="sift-dups-dur ${ink("duration")}">${fmtDuration(c.duration)}</span>` +
    `<span class="sift-dups-where ${ink("folder")}" title="${esc(parentDir(c.path))}">${sourceDot(c, v.sources)}<span class="sift-dups-where-t">${esc(shortDir(c, v.sources))}</span></span>` +
    rkb +
    `</div>`
  );
}

export function dupRowHtml(row: DupRow, v: DupRowView): string {
  return row.kind === "group" ? groupRowHtml(row.group, row.index, v) : copyRowHtml(row.group, row.copy, row.index, v);
}

/** La légende clavier, au format de Revue (`report-view.ts::keyboardHintsHtml`). */
export function legendHtml(): string {
  const t = T();
  const k = (key: string, what: string) => `<span><b>${key}</b> ${what}</span>`;
  return (
    `<div class="sift-dups-foot"><div class="sift-kbd-hints">` +
    k(t.kbdUpDown, t.kbdMove) +
    k("SPACE", t.kbdListen) +
    k("ENTER", t.kbdKeepOnly) +
    k("BKSP", t.kbdDontKeep) +
    k("CTRL+ENTER", t.kbdApply) +
    k("CTRL+Z", t.kbdUndo) +
    `</div></div>`
  );
}
