// Écran Doublons — le modèle, PUR : ni DOM ni IPC, chargeable par Vitest en env Node (même
// séparation que `rekordbox-ecart.ts` et `identify-candidates.ts`). Spec :
// `docs/ui-specs/doublons.md`, validée le 2026-10-05.
//
// Le plan est l'état de l'écran : pour chaque copie, gardée ou non. Il naît des cases cochées par
// la règle (`DupScreenCopy.keep`, calculé côté Rust) et ne change que par un geste de
// l'utilisateur. Rien ne part avant l'application, confirmée.
import type { DupScreenCopy, DupScreenGroup, RekordboxDoubt } from "../shared/contracts";
import { railFromExtension } from "./rails";

/** Vrai quand l'arrivée sur l'écran peut peindre les groupes en mémoire et les relire ensuite
 *  (#92). Un rendu qui suit un geste (`keepOpen`) veut la vérité d'abord, et une venue de Revue
 *  (`focus`) cherche une copie que la mémoire peut ignorer. */
export function peindreDeMemoire(e: {
  lu: boolean;
  monte: boolean;
  doux: boolean;
  suitUnGeste: boolean;
  focus: boolean;
}): boolean {
  return e.lu && !e.monte && !e.doux && !e.suitUnGeste && !e.focus;
}

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

/** Le plan initial : les copies gardées par la règle. Un groupe À vérifier garde TOUTES ses copies
 *  (spec § États, option B du 2026-10-30) : deux versions possibles, rien ne part par défaut. */
export function initialPlan(groups: readonly DupScreenGroup[]): Plan {
  const plan: Plan = new Map();
  for (const g of groups) for (const c of g.copies) plan.set(c.id, g.to_check ? c.keepable : c.keep);
  return plan;
}

/** Une copie absente, ou tronquée quand une autre est entière, ne se garde pas : sa case est
 *  désactivée (spec § Zone C). Le backend en décide (`DupScreenCopy.keepable`) : il voit le
 *  groupe entier, une copie seule ne dit pas si toutes les autres sont tronquées. */
export function keepable(c: DupScreenCopy): boolean {
  return c.keepable;
}

export function isKept(plan: Plan, c: DupScreenCopy): boolean {
  return keepable(c) && (plan.get(c.id) ?? c.keep);
}

export function rekordboxPlaylists(c: DupScreenCopy): number | null {
  return c.rekordbox.state === "present" ? c.rekordbox.playlists : null;
}





/** Les copies envoyées que Rekordbox n'a pas pu confirmer absentes (`unverified`) : la
 *  confirmation les annonce avec la raison — Rekordbox ouvert, ou XML d'export seul. Elles ne sont
 *  pas gardées d'office (décision d'Antoine, 2026-10-05) : l'avertissement laisse trancher. Toutes
 *  les copies d'une lecture partagent la même source, donc la même raison. `null` : rien à dire. */
export function unverifiedRekordbox(
  copies: readonly DupScreenCopy[],
): { count: number; reason: RekordboxDoubt } | null {
  let count = 0;
  let reason: RekordboxDoubt | null = null;
  for (const c of copies) {
    if (c.rekordbox.state !== "unverified") continue;
    count += 1;
    reason ??= c.rekordbox.reason;
  }
  return count > 0 && reason ? { count, reason } : null;
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



// ---------------------------------------------------------------------------
// Option B — file de tri (spec § Layout, 2026-10-30)
// ---------------------------------------------------------------------------

/** Ce que deviendra une copie si l'on valide le groupe : la rangée « Issue » de la grille, qui
 *  répond à « on GARDE ou on SUPPRIME ? ». `missing` et `truncated` ne se basculent pas. */
export type Issue = "kept" | "trash" | "missing" | "truncated";

export function copyIssue(c: DupScreenCopy, plan: Plan): Issue {
  if (c.missing) return "missing";
  if (!keepable(c)) return "truncated";
  return isKept(plan, c) ? "kept" : "trash";
}

/** Ce que ferait Entrée sur un groupe. Les numéros de copie sont ceux de la grille (1 = la
 *  première colonne, l'ordre de `g.copies`). */
interface GroupOutcome {
  kept: number[];
  trashed: number[];
  /** Les copies qui partiraient, dans l'ordre des colonnes. */
  trash: DupScreenCopy[];
  bytes: number;
  /** Les copies qui partiraient et que Rekordbox joue, avec leurs playlists. */
  rekordbox: { n: number; playlists: number }[];
}

export function groupOutcome(g: DupScreenGroup, plan: Plan): GroupOutcome {
  const out: GroupOutcome = { kept: [], trashed: [], trash: [], bytes: 0, rekordbox: [] };
  g.copies.forEach((c, i) => {
    const issue = copyIssue(c, plan);
    if (issue === "kept") out.kept.push(i + 1);
    if (issue !== "trash") return;
    out.trashed.push(i + 1);
    out.trash.push(c);
    out.bytes += c.size_bytes ?? 0;
    const p = rekordboxPlaylists(c);
    if (p != null) out.rekordbox.push({ n: i + 1, playlists: p });
  });
  return out;
}

/** Bascule une copie entre Gardée et Corbeille (clic sur sa cellule Issue, touche G). Refusée —
 *  plan inchangé, `false` — pour une copie qui ne se garde pas, et pour la DERNIÈRE copie gardée :
 *  un groupe ne se vide jamais de toutes ses copies. */
export function toggleIssue(g: DupScreenGroup, plan: Plan, copyId: number): boolean {
  const c = g.copies.find((x) => x.id === copyId);
  if (!c || !keepable(c)) return false;
  const kept = isKept(plan, c);
  if (kept && groupOutcome(g, plan).kept.length <= 1) return false;
  plan.set(c.id, !kept);
  return true;
}

/** La colonne sous le curseur à l'ouverture : la première copie gardée (la recommandée, `g.copies`
 *  venant meilleure d'abord), sinon la première. */
export function recommendedCopy(g: DupScreenGroup, plan: Plan): DupScreenCopy {
  return g.copies.find((c) => copyIssue(c, plan) === "kept") ?? g.copies[0];
}

/** Les formats d'un groupe, pour la seconde ligne de la file : « FLAC, MP3 », dans l'ordre où ils
 *  paraissent, sans doublon. */
export function groupFormats(g: DupScreenGroup): string {
  return [...new Set(g.copies.map((c) => c.format.toUpperCase()))].join(", ");
}

/** Le résumé du mode Lot (spec § Zone C en mode Lot). Un groupe À vérifier est EXCLU — pas de
 *  geste de masse sur une ressemblance. Les copies que Rekordbox joue sont comptées à part : la
 *  confirmation les garde d'office, case cochée. */
interface LotSummary {
  groups: number;
  copies: DupScreenCopy[];
  bytes: number;
  /** Groupes où une copie est à égalité avec la meilleure : la règle a tranché. */
  ties: number;
  rekordboxKept: number;
  excluded: number;
}

export function lotSummary(selected: readonly DupScreenGroup[], plan: Plan, keepRekordbox: boolean): LotSummary {
  const s: LotSummary = { groups: 0, copies: [], bytes: 0, ties: 0, rekordboxKept: 0, excluded: 0 };
  for (const g of selected) {
    if (g.to_check) {
      s.excluded += 1;
      continue;
    }
    const o = groupOutcome(g, plan);
    const sent = keepRekordbox ? o.trash.filter((c) => rekordboxPlaylists(c) == null) : o.trash;
    if (keepRekordbox) s.rekordboxKept += o.trash.length - sent.length;
    if (!sent.length) continue;
    s.groups += 1;
    if (g.copies.some((c) => c.tied_with_best)) s.ties += 1;
    for (const c of sent) {
      s.copies.push(c);
      s.bytes += c.size_bytes ?? 0;
    }
  }
  return s;
}
