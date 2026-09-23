// Le routeur (`router.ts`) : les deux textes de la coquille de Revue qu'il pose lui-même — le nom
// accessible de la liste de la file et l'infobulle de sa poignée de redimensionnement. Les titres
// d'écran, eux, sont relus dans le rail, donc traduits par `shell.ts`.
import { dict } from "../i18n";

const fr = {
  queueAria: "File de revue",
  queueResize: "Redimensionner la file",
};

const en: typeof fr = {
  queueAria: "Review queue",
  queueResize: "Resize the queue",
};

export const D = { fr, en };
export const T = dict(D);
