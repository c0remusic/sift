// Le résumé de sélection du mode Lot (`selection-summary.ts`) : invite de sélection vide, compte de
// pistes sélectionnées, pilules de verdict, boutons Convertir / Écarter / Corbeille.
//
// Pluriels : le français accorde à partir de 2 (`n > 1`), l'anglais dès que n ≠ 1. Le compte vaut
// au moins 1 ici — une sélection vide rend l'invite, pas un compte — mais chaque fonction reste
// juste à 0. Écarter et Corbeille comptent TOUTE la sélection depuis le 2026-10-30 : « Écarter N
// faux » ne visait que les faux.
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
  setAsideN: (n: number) => `Écarter ${n} piste${n > 1 ? "s" : ""}`,
  trashN: (n: number) => `Envoyer ${n} piste${n > 1 ? "s" : ""} à la corbeille`,
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
  setAsideN: (n) => `Set aside ${n} track${n === 1 ? "" : "s"}`,
  trashN: (n) => `Move ${n} track${n === 1 ? "" : "s"} to Trash`,
};

export const D = { fr, en };
export const T = dict(D);
