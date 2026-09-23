// Ligne de source du rail (`rail-source-entry.ts`) : badge du dossier sans audio reconnu et
// infobulles d'état (inaccessible, scan en échec, vide, surveillance suspendue).
//
// Les fonctions reçoivent le chemin et le motif BRUTS, comme le gabarit d'origine : `railRowState`
// rend du texte brut pour le chemin mutation, et `sourceEntryHtml` échappe au site, sur la valeur
// entière. Aucun `esc()` ici, aucun guillemet droit non plus — la valeur finit dans un `title`.
import { dict } from "../i18n";

const fr = {
  badgeEmpty: "0 audio",
  inaccessible: (path: string) => `${path} — dossier inaccessible`,
  scanFailed: (path: string, failure: string) => `${path} — scan en échec : ${failure}`,
  noAudio: (path: string) => `${path} — aucun fichier audio reconnu`,
  suspended: (path: string) => `${path} — surveillance suspendue`,
};

const en: typeof fr = {
  badgeEmpty: "0 audio",
  inaccessible: (path) => `${path} — folder inaccessible`,
  scanFailed: (path, failure) => `${path} — scan failed: ${failure}`,
  noAudio: (path) => `${path} — no recognized audio file`,
  suspended: (path) => `${path} — watching paused`,
};

export const D = { fr, en };
export const T = dict(D);
