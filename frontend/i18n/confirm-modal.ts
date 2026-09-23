// Les deux modales de `confirm-modal.ts` : la confirmation de lot du mode Lot (titre, récapitulatif
// prêtes / FAKE, ligne de destination, case « ne plus me demander », boutons), et les boutons par
// défaut de la confirmation générique — son message, lui, vient de l'appelant, déjà traduit chez lui.
//
// `FAKE` reste en anglais dans les DEUX langues : décompte de catégorie, tranché le 2026-09-23
// (`docs/design-system/content.md` § Langue). « Écarter » devient « Set aside », jamais « Discard ».
import { dict } from "../i18n";

const fr = {
  batchTitle: "Convertir la sélection ?",
  batchReady: (n: number) => `${n} prête${n > 1 ? "s" : ""} → Convertir`,
  batchFake: (n: number) => `${n} FAKE → Écarter`,
  batchDest: (dest: string, format: string) => `Destination · ${dest} · ${format}`,
  skipFuture: " Ne plus me demander (cette session)",
  cancel: "Annuler",
  convertN: (n: number) => `Convertir ${n}`,
  confirm: "Confirmer",
};

const en: typeof fr = {
  batchTitle: "Convert the selection?",
  batchReady: (n) => `${n} ready → Convert`,
  batchFake: (n) => `${n} FAKE → Set aside`,
  batchDest: (dest, format) => `Destination · ${dest} · ${format}`,
  skipFuture: " Don't ask me again (this session)",
  cancel: "Cancel",
  convertN: (n) => `Convert ${n}`,
  confirm: "Confirm",
};

export const D = { fr, en };
export const T = dict(D);
