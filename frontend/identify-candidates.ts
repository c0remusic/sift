// La mémoire des candidats Discogs d'une piste, le temps de la session (#68). Sans DOM ni IPC —
// testable en env Node, comme `popover-position.ts` et `view-epoch.ts`.
//
// Décision du 2026-09-29 (docs/ui-specs/revue.md § « changer de release sans ré-identifier ») : la
// ligne de la release choisie devient le contrôle qui rouvre la liste DÉJÀ connue, la release
// appliquée en sélection, sans requête réseau. Jusque-là, changer de release voulait dire
// re-cliquer Ré-identifier : jusqu'à 13 requêtes Discogs, et le premier candidat resélectionné au
// lieu de celui qu'on avait appliqué. Après un redémarrage la liste n'est plus connue, et la ligne
// redevient inerte.
//
// Partagée par Revue et la Bibliothèque : une piste y garde le même id, rangée ou non.
import type { Candidate } from "./ipc";

interface CandidateSession {
  list: Candidate[];
  /** La release appliquée depuis cette liste (ou depuis la précédente), `null` avant tout choix. */
  appliedId: string | null;
  /** La version affichée au moment de la recherche : elle sert quand le titre Discogs n'en porte
   *  pas. Prise AVANT le premier choix, elle reste celle du fichier quand on passe d'une release à
   *  une autre — la version d'une release A ne se recopie pas sur la release B. */
  fallbackVersion: string | null;
}

const sessions = new Map<number, CandidateSession>();

/** Une nouvelle recherche remplace la liste. La release appliquée, elle, reste la même tant qu'on
 *  n'en choisit pas une autre : elle est déjà dans la base et dans le fichier. */
export function rememberCandidates(
  trackId: number,
  list: Candidate[],
  fallbackVersion: string | null,
): CandidateSession {
  const s: CandidateSession = {
    list,
    appliedId: sessions.get(trackId)?.appliedId ?? null,
    fallbackVersion,
  };
  sessions.set(trackId, s);
  return s;
}

export function candidatesFor(trackId: number): CandidateSession | null {
  return sessions.get(trackId) ?? null;
}

/** `releaseId` vient d'être appliquée, ou `null` : un « Rétablir » a rendu la piste à sa release
 *  d'avant, que la liste ne connaît peut-être pas. */
export function markApplied(trackId: number, releaseId: string | null): void {
  const s = sessions.get(trackId);
  if (s) s.appliedId = releaseId;
}

/** L'indice de la release appliquée dans la liste, `-1` si elle n'y est pas. */
export function appliedIndex(s: CandidateSession): number {
  return s.appliedId == null ? -1 : s.list.findIndex((c) => c.release_id === s.appliedId);
}

/** Combien d'AUTRES releases la ligne choisie propose. Zéro : la ligne reste inerte. */
export function otherCount(s: CandidateSession | null): number {
  if (!s) return 0;
  return s.list.length - (appliedIndex(s) >= 0 ? 1 : 0);
}

/** Capitalise la première lettre de chaque mot (« original mix » → « Original Mix ») et laisse le
 *  reste tel quel, pour que les capitales et sigles (« 2WFU Dub ») survivent. */
export const titleCase = (s: string): string =>
  s.replace(/(^|[\s(/-])([\p{L}\p{N}])/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** Le titre et la version que Revue affiche pour un candidat : la parenthèse finale du titre
 *  Discogs devient la version, sinon `fallbackVersion`. `apply_release` grave exactement ça, pour
 *  que l'écran, le fichier et la base disent la même chose. Une parenthèse seule (« (Untitled) »)
 *  reste le titre : il n'y a rien avant elle. */
export function shownTitle(c: Candidate, fallbackVersion: string | null): { title: string; version: string | null } {
  const m = c.title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const split = m && m[1].trim() ? m : null;
  const title = split ? split[1].trim() : c.title.trim();
  const raw = (split ? split[2].trim() : null) || fallbackVersion?.trim() || null;
  return { title, version: raw ? titleCase(raw) : null };
}
