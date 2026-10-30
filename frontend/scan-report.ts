// Ce que dit le toast à la fin d'un scan de dossier source (événement `scan:done`).
//
// Module SANS DOM ni IPC, testable en env Node (`test/scan-report.test.ts`). Avant le 2026-10-30, les
// comptes d'un scan n'allaient qu'au journal du backend : le toast disait « Rescan lancé », et rien
// ne disait jamais ce que le scan avait trouvé — d'où, entre autres, le « on sait plus où on est »
// d'Antoine après un rescan en plein tri.
import type { ScanDone } from "../shared/contracts";
import { T } from "./i18n/sift-live";

/** Le texte du toast, ou `null` quand il n'y a rien à dire : le scan de rattrapage de l'ouverture
 *  se tait s'il ne trouve rien (il tourne à chaque lancement), un « Rescanner » demandé répond
 *  toujours. */
export function scanDoneText(d: ScanDone): string | null {
  const L = T();
  const parts = [
    d.added > 0 ? L.scanAdded(d.added) : "",
    d.updated > 0 ? L.scanUpdated(d.updated) : "",
    d.removed > 0 ? L.scanRemoved(d.removed) : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!parts) return d.startup ? null : L.scanNothing;
  return d.startup ? L.scanAtStartup(parts) : L.scanDone(parts);
}
