// Résumé de sélection pour la zone C en mode Lot.
// Module pur — aucun accès DOM. Importé par batch-panel.ts.
import { MAX_ANALYSIS_ATTEMPTS, type QueueItem } from "../shared/contracts";
import { esc } from "./dom";

/** Une piste part-elle au rangement de lot ? **Seul discriminant, partagé avec l'action.**
 *
 *  ⚠️ Cette fonction existe parce que le compte et l'action avaient DIVERGÉ. Le bouton comptait
 *  `ok + grey` pendant que `handleBatchQueueAction("file")` rangeait `verdict !== "fake"` — donc
 *  aussi les pistes au verdict NUL, pas encore analysées (`contracts.ts:82`). Trois conséquences,
 *  mesurées le 2026-09-16 : une sélection de pistes non analysées désactivait le bouton alors que
 *  l'action les aurait rangées ; la modale de confirmation annonçait un autre nombre que le
 *  bouton ; et le clic droit de la file, lui, proposait « Ranger N » sur la sélection entière.
 *
 *  Ranger une piste non analysée est VOULU — `batch-panel.ts` l'écrit au-dessus de `runBatchFile` :
 *  « lossy, `unknown`, pas encore analysées … le backend dérive la cible depuis le rail ». C'était
 *  donc le compte qui mentait, pas l'action.
 *
 *  Deux sites appellent ceci, et c'est la seule protection contre une nouvelle divergence :
 *  le compte du bouton ci-dessous, et `fileIds` dans `batch-panel.ts`. Le côté Écarter est son
 *  miroir exact (`verdict === "fake"`), et n'a jamais dérivé — c'est ce qui prouve que l'écart
 *  était un oubli et non un arbitrage. Gelé par `test/selection-summary.test.ts`. */
export function estRangeableEnLot(it: QueueItem): boolean {
  return it.verdict !== "fake";
}

/** Construit le HTML du panneau de résumé de sélection.
 *  Rendu EN TÊTE du batch board quand la sélection est non vide.
 *  Les boutons portent data-sift="batchqueuefile" / "batchqueuediscard"
 *  pour le routing délégué de sift-live.ts.
 *  Classes de bouton : .sift-baction .sift-baction--primary / --quiet (grammaire batch existante). */
export function selectionSummaryHtml(selected: QueueItem[]): string {
  const n = selected.length;
  if (n === 0) {
    return `<div class="sift-bsel-empty">Sélectionne des pistes dans la file</div>`;
  }
  const ok    = selected.filter((it) => it.verdict === "ok").length;
  const fake  = selected.filter((it) => it.verdict === "fake").length;
  const grey  = selected.filter((it) => it.verdict === "grey").length;
  // Le verdict NUL recouvre deux populations, et c'est `analysis_attempts` qui les sépare — jamais
  // le verdict seul. Même discriminant que `queue-verdict-dot.ts::verdictDot`, qui peint la
  // seconde en pastille rouge titrée « analyse abandonnée » sur la ligne de file : les deux
  // surfaces du même écran doivent compter pareil.
  const sansVerdict = selected.filter((it) => it.verdict === null);
  const abandonnees = sansVerdict.filter((it) => it.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS).length;
  const other = sansVerdict.length - abandonnees;

  // Durée totale (si champs disponibles grâce au contrat S1)
  const withDur = selected.filter((it) => it.duration != null);
  const totalSec = withDur.reduce((s, it) => s + (it.duration ?? 0), 0);
  const durStr =
    totalSec > 0
      ? (() => {
          const h = Math.floor(totalSec / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = Math.floor(totalSec % 60);
          return h > 0
            ? `${h}h ${String(m).padStart(2, "0")}m`
            : `${m}m ${String(s).padStart(2, "0")}s`;
        })()
      : null;

  // Format dominant (si disponible)
  const fmts: Record<string, number> = {};
  for (const it of selected) {
    if (it.declared_fmt) fmts[it.declared_fmt] = (fmts[it.declared_fmt] ?? 0) + 1;
  }
  const fmtStr =
    Object.entries(fmts)
      .sort((a, b) => b[1] - a[1])
      .map(([f, c]) => `${c > 1 ? c + " " : ""}${esc(f.toUpperCase())}`)
      .join(" · ") || null;

  // « en cours » annonçait une PROGRESSION que rien ici ne mesure. `other` est le complément des
  // trois verdicts, donc exactement `verdict === null` — un nul qui recouvre DEUX populations que
  // l'écran distingue partout ailleurs : l'analyse EN ATTENTE et l'analyse ABANDONNÉE
  // (`analysis_attempts >= MAX_ANALYSIS_ATTEMPTS`), que `queue-verdict-dot.ts::verdictDot` peint
  // en anneau neutre pour la première, en pastille rouge « analyse abandonnée » pour la seconde.
  // Aucune des deux n'est en cours.
  //
  // Scindé le 2026-09-16, sur décision d'Antoine : un compte est devenu deux. Une analyse
  // abandonnée est un travail TERMINÉ en échec, pas un travail qui progresse, et la file le dit
  // déjà en rouge à deux pixels de là. La distinction ne se redérive JAMAIS du seul `verdict` — le
  // doc-comment de `needs_analysis` (`shared/contracts.ts`) l'écrit : « never re-derive this from
  // `verdict` alone ».
  //
  // Les deux pilules gardent la MÊME classe neutre `.other`. Peindre l'abandon en rouge serait
  // cohérent avec la pastille de la file, mais la couleur est une décision de surface et ce
  // fichier n'en prend pas : à trancher avec la skill `sift-macos-ui` si l'écart gêne.
  //
  // « N pistes non analysées », jamais « N non analysées » : l'accord porterait sur un nom absent
  // (retour d'Antoine 2026-09-06, même formulation que
  // `queue-panel.ts::ensureQueueReanalyzeAllButton`). Les trois autres pilules s'en passent parce
  // que leur mot est invariable.
  const sOther = other > 1 ? "s" : "";
  const sAband = abandonnees > 1 ? "s" : "";
  const verdictPills = [
    ok    > 0 ? `<span class="sift-bsel-pill ok">${ok} ok</span>` : "",
    fake  > 0 ? `<span class="sift-bsel-pill fake">${fake} faux</span>` : "",
    grey  > 0 ? `<span class="sift-bsel-pill grey">${grey} à vérifier</span>` : "",
    other > 0
      ? `<span class="sift-bsel-pill other">${other} piste${sOther} non analysée${sOther}</span>`
      : "",
    abandonnees > 0
      ? `<span class="sift-bsel-pill other">${abandonnees} analyse${sAband} abandonnée${sAband}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const fileN    = selected.filter(estRangeableEnLot).length;
  const discardN = fake;

  return (
    `<div class="sift-bsel">` +
    `<div class="sift-bsel-count">${n}<span class="sift-bsel-count-label">piste${n > 1 ? "s" : ""} sélectionnée${n > 1 ? "s" : ""}</span></div>` +
    (verdictPills ? `<div class="sift-bsel-pills">${verdictPills}</div>` : "") +
    (durStr || fmtStr
      ? `<div class="sift-bsel-meta">${[durStr, fmtStr].filter(Boolean).join(" · ")}</div>`
      : "") +
    `<div class="sift-bsel-actions">` +
    (fileN > 0
      ? `<button class="sift-baction sift-baction--primary" data-sift="batchqueuefile">Ranger ${fileN} piste${fileN > 1 ? "s" : ""}</button>`
      : `<button class="sift-baction sift-baction--primary" disabled>Ranger</button>`) +
    (discardN > 0
      ? `<button class="sift-baction sift-baction--quiet" data-sift="batchqueuediscard">Écarter ${discardN} faux</button>`
      : `<button class="sift-baction sift-baction--quiet" disabled>Écarter</button>`) +
    `</div>` +
    `</div>`
  );
}
