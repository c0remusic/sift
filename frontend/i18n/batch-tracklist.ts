// La liste de progression d'un rangement en lot (`batch-tracklist.ts`) : l'en-tête de la liste et
// le libellé de la pastille d'état de chaque piste — en attente, en cours, faite, en échec.
import { dict } from "../i18n";

const fr = {
  head: "Batch",
  wait: "attend",
  run: "en cours",
  done: "fait",
  fail: "échec",
};

const en: typeof fr = {
  head: "Batch",
  wait: "waiting",
  run: "running",
  done: "done",
  fail: "failed",
};

export const D = { fr, en };
export const T = dict(D);
