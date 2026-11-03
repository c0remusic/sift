// Découpe une étape de formatage USB non terminale (`formatStep`) en texte et pourcentage — sans DOM
// ni IPC, donc testable en env Node (`test/usb-format-step.test.ts`). Les marqueurs terminaux
// (`STEP_DONE`, `STEP_FAILED_PREFIX`) restent reconnus par `usb-format-modal.ts`, avant cet appel.
import { STEP_PROGRESS_PREFIX } from "../shared/contracts";

interface FormatStep {
  text: string;
  /** 0 à 100, ou `null` quand l'étape ne connaît pas son total — la barre ne s'affiche alors pas. */
  pct: number | null;
}

/** `PCT:<n>|<texte>` (Rust `privileged::progress_line`) ou un texte nu. Coupe au PREMIER `|` : le
 * texte, rédigé par le backend, peut en contenir un. Un préfixe dont le nombre est illisible rend
 * la ligne entière en texte plutôt que d'inventer un pourcentage. */
export function parseFormatStep(raw: string): FormatStep {
  if (!raw.startsWith(STEP_PROGRESS_PREFIX)) return { text: raw, pct: null };
  const m = /^(\d{1,3})\|/.exec(raw.slice(STEP_PROGRESS_PREFIX.length));
  const n = m ? Number(m[1]) : NaN;
  // `\d` et non `Number()` seul : `Number("")` vaut 0, et « PCT:|x » passerait pour 0 %.
  if (!m || n > 100) return { text: raw, pct: null };
  return { text: raw.slice(STEP_PROGRESS_PREFIX.length + m[0].length), pct: n };
}
