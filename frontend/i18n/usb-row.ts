// Entrée de disque de la colonne de l'écran Clé USB (`usb-row.ts`) : le nom donné à un disque non
// monté, qui n'a pas de lettre, et le mot affiché à la place de la capacité quand le lecteur est
// vide. Vocabulaire : `docs/design-system/content.md` § Locale `en`.
import { dict } from "../i18n";

const fr = {
  /** Disque sans lettre, désigné par son numéro physique (`\\.\PHYSICALDRIVE2` → « Disque 2 »). */
  disque: (n: string) => `Disque ${n}`,
  vide: "vide",
};

const en: typeof fr = {
  disque: (n) => `Disk ${n}`,
  vide: "empty",
};

export const D = { fr, en };
export const T = dict(D);
