// Réglages › Conversion (issue #71) : ce que chaque rangée PROPOSE, comment elle l'écrit, et le
// profil qui part au backend quand on clique. Sans DOM ni IPC — même motif que `popover-position.ts`
// et `report-figures.ts` : `reglages-view.ts` importe `./ipc` et le plugin de dialogue, que la suite
// Vitest (env Node, sans Tauri) ne sait pas charger. Ici il n'y a que des nombres et des chaînes, et
// c'est justement là que se loge le risque : une valeur mal listée est proposée à l'utilisateur puis
// refusée par le backend, un libellé mal composé annonce une fréquence que l'encodeur ne produira pas.
//
// Décision tranchée dans `docs/ui-specs/reglages.md` § Décision 2026-09-28 : valeurs EXACTES (même
// au-dessus de la source), un MP3 source déplacé tel quel, AAC / OGG / Opus convertis en MP3 aux
// valeurs réglées. Les défauts ne vivent PAS ici : c'est le backend qui les rend tant que rien n'est
// réglé (`get_encode_profile`), et ce module n'invente aucune valeur à sa place.
import type { EncodeProfile } from "../shared/contracts";
import { numLocale } from "./i18n";
import { T } from "./i18n/reglages-view";

export type EncodeField = keyof EncodeProfile;

/** Valeurs admises par rangée, dans l'ordre d'affichage du segmenté. Miroir de la liste que le
 *  backend valide (`set_encode_profile` → `ENCODE_PROFILE_INVALID: champ=valeur`) : une valeur
 *  absente d'ici n'est jamais proposée, une valeur absente de là-bas serait refusée, jamais
 *  corrigée. Pas de 96 kHz en MP3 : l'encodeur MP3 embarqué le refuse (mesuré, issue #71). */
const ENCODE_OPTIONS: Readonly<Record<EncodeField, readonly number[]>> = {
  mp3_kbps: [256, 320],
  mp3_rate: [44100, 48000],
  aiff_bits: [16, 24],
  aiff_rate: [44100, 48000, 96000],
  wav_bits: [16, 24],
  wav_rate: [44100, 48000, 96000],
};

/** Ordre des rangées de la spec : MP3, AIFF, WAV ; pour chacun la grandeur qui se choisit d'abord
 *  (débit ou profondeur), puis la fréquence. */
const ENCODE_FIELDS: readonly EncodeField[] = ["mp3_kbps", "mp3_rate", "aiff_bits", "aiff_rate", "wav_bits", "wav_rate"];

/** La fréquence que les CDJ d'avant 2016 ne lisent pas. La phrase qui le dit se pose sur chaque
 *  rangée qui la PROPOSE — dérivée de la liste, jamais d'une seconde liste de rangées à tenir. */
const HI_RES_HZ = 96000;

/** Une option de segmenté : sa valeur (celle qui part au backend), son libellé, et si elle est la
 *  valeur du profil. */
interface EncodeOption {
  value: number;
  label: string;
  on: boolean;
}

/** Une rangée de la grille de Réglages, prête à rendre. */
export interface EncodeRow {
  field: EncodeField;
  label: string;
  /** Phrase sous le libellé — `null` quand la rangée n'en a pas. */
  note: string | null;
  options: EncodeOption[];
}

/** « 44,1 kHz » en français, « 44.1 kHz » en anglais, « 48 kHz » sans décimale inutile. Même
 *  prudence d'arrondi que `report-figures.ts::formatSummaryParts` (`toFixed(1)` avant Intl), sans
 *  séparateur de milliers. */
function khz(hz: number): string {
  const v = Number((hz / 1000).toFixed(1)).toLocaleString(numLocale(), {
    maximumFractionDigits: 1,
    useGrouping: false,
  });
  return `${v} kHz`;
}

/** Libellé d'une option : l'unité dépend de la GRANDEUR du champ (débit, profondeur, fréquence). */
function optionLabel(field: EncodeField, v: number): string {
  if (field === "mp3_kbps") return `${v} kbps`;
  if (field === "aiff_bits" || field === "wav_bits") return T().encBits(v);
  return khz(v);
}

/** Les six rangées de la catégorie Conversion, pour le profil `p` tel que le backend l'a rendu.
 *
 *  Une valeur du profil absente de la liste n'allume AUCUNE option : la rangée montre alors qu'elle
 *  ne sait pas, plutôt que d'allumer la plus proche — ce serait afficher une valeur que la
 *  conversion n'emploiera pas. */
export function encodeRows(p: EncodeProfile): EncodeRow[] {
  const txt = T();
  return ENCODE_FIELDS.map((field) => {
    const values = ENCODE_OPTIONS[field];
    return {
      field,
      label: txt.encRows[field],
      note: values.includes(HI_RES_HZ) ? txt.encNoteHiRes : null,
      options: values.map((value) => ({ value, label: optionLabel(field, value), on: p[field] === value })),
    };
  });
}

/** Relit un clic : le champ et la valeur tels que le bouton les porte en `data-*`. Rend `null` pour
 *  tout ce qui n'est pas un champ connu ET une valeur de sa liste, écrite en chiffres seuls — jamais
 *  une valeur « rapprochée ». Un `null` ici est un défaut du markup, pas un choix de l'utilisateur. */
export function parseEncodeOption(
  field: string | undefined,
  raw: string | undefined,
): { field: EncodeField; value: number } | null {
  if (field === undefined || raw === undefined || !/^\d+$/.test(raw)) return null;
  if (!(ENCODE_FIELDS as readonly string[]).includes(field)) return null;
  const f = field as EncodeField;
  const value = Number(raw);
  if (!ENCODE_OPTIONS[f].includes(value)) return null;
  return { field: f, value };
}

/** Le profil ENTIER à envoyer au backend : `p` avec le seul champ `field` changé. `p` n'est pas
 *  touché — il reste le dernier profil confirmé, celui auquel on revient si l'écriture échoue. */
export function withEncodeValue(p: EncodeProfile, field: EncodeField, value: number): EncodeProfile {
  return { ...p, [field]: value };
}

/** Le format d'un lossy CONVERTI dans le mode Lot : « MP3 320 », « MP3 256 ». `null` — profil pas
 *  encore lu, ou lecture échouée — rend « MP3 » sans débit : jamais un débit supposé. */
export function mp3FormatLabel(kbps: number | null): string {
  return kbps === null ? "MP3" : `MP3 ${kbps}`;
}

/** Ce que le Lot annonce pour ses pistes lossy. Un MP3 source est DÉPLACÉ tel quel — c'est son
 *  extension qui en décide, comme `encode::is_conformant` côté backend —, seuls AAC / OGG / Opus sont
 *  convertis au débit réglé. Relecture de #71 : réglé à 256, le Lot annonçait « MP3 256 » pour des
 *  MP3 à 320 qui partaient tels quels, à 320. */
export function lossyFormatLabel(paths: readonly string[], kbps: number | null): string {
  const mp3 = paths.filter((p) => /\.mp3$/i.test(p)).length;
  const parts: string[] = [];
  if (mp3 > 0) parts.push(T().mp3AsIs);
  if (paths.length - mp3 > 0) parts.push(mp3FormatLabel(kbps));
  return parts.join(" + ");
}
