// Écran Doublons — le modèle, PUR : ni DOM ni IPC, chargeable par Vitest en env Node (même
// séparation que `rekordbox-ecart.ts` et `identify-candidates.ts`). Spec :
// `docs/ui-specs/doublons.md`, validée le 2026-10-05.
//
// Le plan est l'état de l'écran : pour chaque copie, gardée ou non. Il naît des cases cochées par
// la règle (`DupScreenCopy.keep`, calculé côté Rust) et ne change que par un geste de
// l'utilisateur. Rien ne part avant l'application, confirmée.
import type { DupScreenCopy, DupScreenGroup } from "../shared/contracts";
import { railFromExtension } from "./rails";

/** Pour chaque copie, gardée (`true`) ou non. */
export type Plan = Map<number, boolean>;

/** Les filtres du menu « Groupes » de la barre. */
export type GroupFilter = "all" | "identical" | "same_sound" | "same_name" | "to_check" | "rekordbox";

export const GROUP_FILTERS: readonly GroupFilter[] = [
  "all",
  "identical",
  "same_sound",
  "same_name",
  "to_check",
  "rekordbox",
];

/** Le plan initial : les cases cochées par la règle. */
export function initialPlan(groups: readonly DupScreenGroup[]): Plan {
  const plan: Plan = new Map();
  for (const g of groups) for (const c of g.copies) plan.set(c.id, c.keep);
  return plan;
}

/** Une copie absente ou tronquée ne se garde pas : sa case est désactivée (spec § Zone C). */
export function keepable(c: DupScreenCopy): boolean {
  return !c.missing && !c.truncated;
}

export function isKept(plan: Plan, c: DupScreenCopy): boolean {
  return keepable(c) && (plan.get(c.id) ?? c.keep);
}

export function rekordboxPlaylists(c: DupScreenCopy): number | null {
  return c.rekordbox.state === "present" ? c.rekordbox.playlists : null;
}

/** Ce que le plan ferait d'un groupe. */
interface GroupEffect {
  /** Les copies qui partiraient à la corbeille. Une copie absente ne part jamais. */
  toTrash: DupScreenCopy[];
  kept: number;
  bytes: number;
  /** Copies jouées par Rekordbox parmi celles qui partiraient, et leurs playlists. */
  rekordboxCopies: number;
  rekordboxPlaylists: number;
  /** Le groupe entre dans l'application : sa preuve l'autorise (ou l'utilisateur l'a tranché),
   *  et au moins une copie reste gardée — jamais un groupe vidé de toutes ses copies. */
  inPlan: boolean;
}

/** `touched` : les groupes que l'utilisateur a modifiés. Un groupe À vérifier n'entre dans
 *  l'application qu'une fois tranché à la main (spec § Interactions, « Geste de masse »). */
export function groupEffect(g: DupScreenGroup, plan: Plan, touched: ReadonlySet<number>): GroupEffect {
  const kept = g.copies.filter((c) => isKept(plan, c)).length;
  const toTrash = g.copies.filter((c) => !isKept(plan, c) && !c.missing);
  let bytes = 0;
  let rekordboxCopies = 0;
  let rekordboxPlaylistsTotal = 0;
  for (const c of toTrash) {
    bytes += c.size_bytes ?? 0;
    const p = rekordboxPlaylists(c);
    if (p != null) {
      rekordboxCopies += 1;
      rekordboxPlaylistsTotal += p;
    }
  }
  const inPlan = kept >= 1 && toTrash.length > 0 && (!g.to_check || touched.has(g.id));
  return { toTrash, kept, bytes, rekordboxCopies, rekordboxPlaylists: rekordboxPlaylistsTotal, inPlan };
}

/** Le total de l'application, sur les groupes donnés. `keepRekordbox` : la case de la
 *  confirmation « Garder aussi les copies que Rekordbox joue », cochée par défaut. */
interface PlanTotals {
  copies: DupScreenCopy[];
  bytes: number;
  groups: number;
  /** Copies jouées par Rekordbox que le plan enverrait, AVANT la case de la confirmation. */
  rekordboxCopies: number;
  /** Groupes À vérifier laissés hors du plan. */
  toCheckLeft: number;
}

export function planTotals(
  groups: readonly DupScreenGroup[],
  plan: Plan,
  touched: ReadonlySet<number>,
  keepRekordbox: boolean,
): PlanTotals {
  const copies: DupScreenCopy[] = [];
  let bytes = 0;
  let nGroups = 0;
  let rekordboxCopies = 0;
  let toCheckLeft = 0;
  for (const g of groups) {
    const e = groupEffect(g, plan, touched);
    if (!e.inPlan) {
      if (g.to_check && !touched.has(g.id)) toCheckLeft += 1;
      continue;
    }
    rekordboxCopies += e.rekordboxCopies;
    const sent = keepRekordbox ? e.toTrash.filter((c) => rekordboxPlaylists(c) == null) : e.toTrash;
    if (sent.length === 0) continue;
    nGroups += 1;
    for (const c of sent) {
      copies.push(c);
      bytes += c.size_bytes ?? 0;
    }
  }
  return { copies, bytes, groups: nGroups, rekordboxCopies, toCheckLeft };
}

/** Le dossier parent d'une copie, séparateurs Windows et POSIX confondus. */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/** Les champs comparés d'une copie à l'autre (encre de différence, spec § Zone C). */
export type DiffField = "verdict" | "format" | "bitrate" | "duration" | "folder" | "file";

function fieldValue(c: DupScreenCopy, f: DiffField): string {
  switch (f) {
    case "verdict":
      return c.verdict ?? "";
    case "format":
      return c.format;
    case "bitrate":
      return String(c.bitrate ?? "");
    case "duration":
      // À la seconde affichée (m:ss) : deux durées qui s'affichent pareil ne « diffèrent » pas.
      return c.duration == null ? "" : String(Math.round(c.duration));
    case "folder":
      return parentDir(c.path).toLowerCase();
    case "file":
      return fileName(c.path).toLowerCase();
  }
}

/** Les champs dont la valeur diffère d'une copie à l'autre dans le groupe : encre primaire.
 *  Les autres, identiques partout, passent en tertiaire — une paire .aif / .aiff se lit d'un coup
 *  d'œil, seuls Format et Dossier restent allumés. */
export function differingFields(g: DupScreenGroup): Set<DiffField> {
  const out = new Set<DiffField>();
  const fields: DiffField[] = ["verdict", "format", "bitrate", "duration", "folder", "file"];
  for (const f of fields) {
    const values = new Set(g.copies.map((c) => fieldValue(c, f)));
    if (values.size > 1) out.add(f);
  }
  return out;
}

/** La copie contre laquelle l'inspecteur compare `openedId` (spec § Zone D) : la première copie
 *  gardée, dans l'ordre de la règle ; et si c'est la gardée qu'on ouvre, la meilleure des autres
 *  (tranché sur wireframe le 2026-10-05). `null` si le groupe n'a pas d'autre copie. */
export function compareTarget(g: DupScreenGroup, openedId: number, plan: Plan): DupScreenCopy | null {
  const opened = g.copies.find((c) => c.id === openedId);
  if (!opened) return null;
  if (!isKept(plan, opened)) {
    const kept = g.copies.find((c) => c.id !== openedId && isKept(plan, c));
    if (kept) return kept;
  }
  return g.copies.find((c) => c.id !== openedId) ?? null;
}

/** « Préférer ce dossier » : dans chaque groupe où une copie de `dir` est à égalité de qualité
 *  avec la meilleure, c'est elle qui est gardée, et les autres copies à égalité sont décochées —
 *  sauf celles que Rekordbox joue, gardées d'office. Rend le plan modifié et le nombre de groupes
 *  recochés. Ne touche ni un groupe où la copie du dossier est moins bonne, ni les autres, ni un
 *  groupe À vérifier : celui-là se tranche à la main (spec § Ce qui forme un groupe), un geste de
 *  masse ne le fait pas entrer dans le plan. */
export function preferFolder(
  groups: readonly DupScreenGroup[],
  plan: Plan,
  dir: string,
): { plan: Plan; changed: number[] } {
  const next: Plan = new Map(plan);
  const changed: number[] = [];
  const target = dir.toLowerCase();
  for (const g of groups) {
    if (g.to_check) continue;
    const pick = g.copies.find(
      (c) => c.tied_with_best && keepable(c) && parentDir(c.path).toLowerCase() === target,
    );
    if (!pick) continue;
    let modified = false;
    for (const c of g.copies) {
      if (!c.tied_with_best || !keepable(c)) continue;
      const want = c.id === pick.id || rekordboxPlaylists(c) != null;
      if ((next.get(c.id) ?? c.keep) !== want) {
        next.set(c.id, want);
        modified = true;
      }
    }
    if (modified) changed.push(g.id);
  }
  return { plan: next, changed };
}

/** Le plan rebasé sur des groupes relus (rafraîchissement doux, retour d'une application) : une
 *  copie que l'utilisateur a tranchée (`decided`) garde sa case ; tout le reste repart de la
 *  règle. Rend aussi les groupes touchés — ceux qui gardent une copie tranchée — et les copies
 *  tranchées encore présentes. Indexé par COPIE, jamais par groupe : l'id d'un groupe est son plus
 *  petit id de piste, qui change dès que cette copie part. Indexé par groupe, un groupe dont la
 *  copie de plus petit id venait d'être envoyée perdait ses cases, et une seconde copie gardée à
 *  la main repassait « à la corbeille » (revue du 2026-10-05). */
export function rebasePlan(
  next: readonly DupScreenGroup[],
  plan: Plan,
  decided: ReadonlySet<number>,
): { plan: Plan; touched: Set<number>; decided: Set<number> } {
  const fresh = initialPlan(next);
  const touched = new Set<number>();
  const stillDecided = new Set<number>();
  for (const g of next) {
    for (const c of g.copies) {
      if (!decided.has(c.id)) continue;
      stillDecided.add(c.id);
      touched.add(g.id);
      const v = plan.get(c.id);
      if (v !== undefined) fresh.set(c.id, v);
    }
  }
  return { plan: fresh, touched, decided: stillDecided };
}

/** Repli pour la recherche : minuscules, accents retirés. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesFilter(g: DupScreenGroup, filter: GroupFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "identical":
    case "same_sound":
    case "same_name":
      return g.proof === filter;
    case "to_check":
      return g.to_check;
    case "rekordbox":
      return g.copies.some((c) => rekordboxPlaylists(c) != null);
  }
}

/** Les groupes visibles : filtre du menu « Groupes », puis recherche dans les noms (artiste,
 *  titre, version, fichiers), sans casse ni accents. */
export function visibleGroups(
  groups: readonly DupScreenGroup[],
  filter: GroupFilter,
  query: string,
): DupScreenGroup[] {
  const q = fold(query.trim());
  return groups.filter((g) => {
    if (!matchesFilter(g, filter)) return false;
    if (!q) return true;
    const hay = fold([g.artist ?? "", g.title, g.version ?? "", ...g.copies.map((c) => fileName(c.path))].join(" "));
    return hay.includes(q);
  });
}

export function filterCounts(groups: readonly DupScreenGroup[]): Record<GroupFilter, number> {
  const counts = {} as Record<GroupFilter, number>;
  for (const f of GROUP_FILTERS) counts[f] = groups.filter((g) => matchesFilter(g, f)).length;
  return counts;
}

/** Une rangée de la table virtualisée : l'en-tête d'un groupe, ou une de ses copies. Toutes font
 *  la même hauteur (spec § Zone C : une seule hauteur pour la liste virtualisée). */
export type DupRow =
  | { kind: "group"; group: DupScreenGroup; index: number }
  | { kind: "copy"; group: DupScreenGroup; copy: DupScreenCopy; index: number };

/** Les rangées, en-tête puis copies, avec un index CONTINU — la zébrure suit l'index, en-têtes
 *  compris (spec § Zone C, « fonds alternés par index continu »). */
export function flattenRows(groups: readonly DupScreenGroup[]): DupRow[] {
  const rows: DupRow[] = [];
  for (const g of groups) {
    rows.push({ kind: "group", group: g, index: rows.length });
    for (const c of g.copies) rows.push({ kind: "copy", group: g, copy: c, index: rows.length });
  }
  return rows;
}

/** Ce qui fait garder `kept` plutôt que `other`, pour la phrase de l'inspecteur. Suit l'ordre de
 *  la règle (`doublons.rs::qualite`, puis les départages) ; `user` et `rekordbox` disent qu'une
 *  copie est gardée par un geste ou par Rekordbox, et non parce que la règle l'a choisie. */
type RuleReason =
  | "missing"
  | "truncated"
  | "verdict"
  | "verdict_grey"
  | "lossless"
  | "bitrate"
  | "rate"
  | "aiff"
  | "tie"
  | "user"
  | "rekordbox";

function verdictRank(v: string | null): number {
  if (v === "ok") return 3;
  if (v === "grey") return 2;
  if (v === "fake") return 0;
  return 1;
}

export function ruleReason(g: DupScreenGroup, kept: DupScreenCopy, other: DupScreenCopy): RuleReason {
  const best = g.copies[0];
  if (kept.id !== best?.id) {
    if (!kept.keep) return "user";
    if (kept.rekordbox.state === "present") return "rekordbox";
  }
  if (other.missing && !kept.missing) return "missing";
  if (other.truncated && !kept.truncated) return "truncated";
  const vk = verdictRank(kept.verdict);
  const vo = verdictRank(other.verdict);
  if (vk !== vo) return other.verdict === "grey" ? "verdict_grey" : "verdict";
  const lk = railFromExtension(kept.path) === "lossless";
  const lo = railFromExtension(other.path) === "lossless";
  if (lk !== lo) return "lossless";
  if (!lk && !lo && (kept.bitrate ?? -1) !== (other.bitrate ?? -1)) return "bitrate";
  if ((kept.sample_rate ?? 0) !== (other.sample_rate ?? 0)) return "rate";
  if ((kept.format === "aif") !== (other.format === "aif")) return "aiff";
  return "tie";
}

/** Les totaux du résumé de repos (zone D). */
interface RestSummary {
  groups: number;
  extraCopies: number;
  inPlan: number;
  bytes: number;
  identical: number;
  sameSound: number;
  sameName: number;
  toCheck: number;
  withRekordbox: number;
}

export function restSummary(
  groups: readonly DupScreenGroup[],
  plan: Plan,
  touched: ReadonlySet<number>,
): RestSummary {
  const counts = filterCounts(groups);
  const totals = planTotals(groups, plan, touched, true);
  const extraCopies = groups.reduce((n, g) => n + g.copies.filter((c) => !c.missing).length - 1, 0);
  return {
    groups: groups.length,
    extraCopies: Math.max(0, extraCopies),
    inPlan: totals.copies.length,
    bytes: totals.bytes,
    identical: counts.identical,
    sameSound: counts.same_sound,
    sameName: counts.same_name,
    toCheck: counts.to_check,
    withRekordbox: counts.rekordbox,
  };
}
