// Le motif d'un formatage refusé, en mots — sans DOM ni IPC, donc testable en env Node
// (`test/usb-format-error.test.ts`). Extrait de `usb-format-modal.ts` le 2026-09-23 : le nom du
// disque y était échappé une première fois ici, puis une seconde au rendu (`esc(lastError)`), et
// un nom portant une apostrophe s'affichait « Clé d&#39;Antoine ».
import { DRIVE_VANISHED, ELEVATION_DECLINED, IDENTITY_MISMATCH } from "../shared/contracts";
import { T } from "./i18n/usb-format-modal";

/** `text` est du TEXTE BRUT : l'appelant l'échappe une seule fois, au rendu. `fatal` coupe le chemin
 * de reprise : les deux sentinelles du garde anti-course disent que le disque n'est plus celui que
 * l'utilisateur a confirmé, et inviter à relancer un formatage irréversible serait le pire message
 * possible. La seule sortie sûre est de refermer et de repartir d'une liste fraîche. */
export function humanizeFormatError(raw: string, displayName: string): { text: string; fatal: boolean } {
  const t = T();
  if (raw.includes(IDENTITY_MISMATCH)) return { text: t.errIdentite(displayName), fatal: true };
  if (raw.includes(DRIVE_VANISHED)) return { text: t.errDebranche, fatal: true };
  if (raw.includes(ELEVATION_DECLINED)) return { text: t.errElevation, fatal: false };
  if (/access|denied|permission/i.test(raw)) return { text: t.errAcces, fatal: false };
  if (/not found|no such|introuvable/i.test(raw)) return { text: t.errIntrouvable, fatal: false };
  return { text: t.errEchec, fatal: false };
}
