// Le résumé de sélection du mode Lot (`selection-summary.ts`) : invite de sélection vide, compte de
// pistes sélectionnées, pilules de verdict, boutons Convertir / Écarter.
//
// Pluriels : le français accorde à partir de 2 (`n > 1`), l'anglais dès que n ≠ 1. Le compte vaut
// au moins 1 ici — une sélection vide rend l'invite, pas un compte — mais chaque fonction reste
// juste à 0. « Écarter N faux » ne s'accorde pas (`faux` est invariable), mais l'anglais y lit le
// NOM `fake`, qui prend un `s` : « Set aside 2 fakes ».
import { dict } from "../i18n";

const fr = {
  empty: "Sélectionne des pistes dans la file",
  ok: (n: number) => `${n} ok`,
  fake: (n: number) => `${n} faux`,
  grey: (n: number) => `${n} à vérifier`,
  notAnalysed: (n: number) => `${n} piste${n > 1 ? "s" : ""} non analysée${n > 1 ? "s" : ""}`,
  abandoned: (n: number) => `${n} analyse${n > 1 ? "s" : ""} abandonnée${n > 1 ? "s" : ""}`,
  selectedLabel: (n: number) => `piste${n > 1 ? "s" : ""} sélectionnée${n > 1 ? "s" : ""}`,
  convertN: (n: number) => `Convertir ${n} piste${n > 1 ? "s" : ""}`,
  convert: "Convertir",
  setAsideN: (n: number) => `Écarter ${n} faux`,
  setAside: "Écarter",
};

const en: typeof fr = {
  empty: "Select tracks in the queue",
  ok: (n) => `${n} ok`,
  fake: (n) => `${n} fake`,
  grey: (n) => `${n} to check`,
  notAnalysed: (n) => `${n} track${n === 1 ? "" : "s"} not analyzed`,
  abandoned: (n) => `${n} abandoned analys${n === 1 ? "is" : "es"}`,
  selectedLabel: (n) => `track${n === 1 ? "" : "s"} selected`,
  convertN: (n) => `Convert ${n} track${n === 1 ? "" : "s"}`,
  convert: "Convert",
  setAsideN: (n) => `Set aside ${n} fake${n === 1 ? "" : "s"}`,
  setAside: "Set aside",
};

export const D = { fr, en };
export const T = dict(D);
