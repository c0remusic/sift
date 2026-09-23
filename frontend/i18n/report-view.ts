// Le rapport d'analyse partagé par Revue et Bibliothèque (`report-view.ts`) : mot de verdict de
// l'en-tête, légende clavier du pied de boîte, pochette, erreur de lecture, et tout le Diagnostic
// audio — pastille et légende du spectre, bascule du spectrogramme, groupes et rangées de mesures.
//
// Verdicts : table de `docs/design-system/content.md` § Locale `en` — FAUX → FAKE, VRAI → GENUINE,
// À VÉRIFIER → TO CHECK. « Écarter » devient « set aside », jamais « discard ».
//
// ⚠️ Les lectures du spectre (`caption*`) finissent dans un attribut `title` non échappé : aucune
// valeur n'y porte de guillemet droit ni de chevron. Les unités (Hz, kHz, dB, dBFS, ms, runs) et
// les noms de touches déjà anglais (SPACE, ENTER, BKSP) restent au site, ils n'ont pas de langue.
import { dict } from "../i18n";

const fr = {
  // Lecture longue du spectre — `title` de la pastille.
  captionMismatch: "conteneur .flac mais contenu MP3 détecté — extension falsifiée",
  captionFake: "coupure nette = transcodage probable",
  captionGrey: "à vérifier visuellement",
  captionOk: "énergie pleine bande = encodage conforme",
  // La même lecture, en deux mots — texte de la pastille et rangée « Mesuré ».
  readingMismatch: "Extension falsifiée",
  readingFake: "Coupure nette",
  readingGrey: "À vérifier visuellement",
  readingOk: "Pleine bande",
  // Mot de verdict de l'en-tête.
  verdictFake: "FAUX",
  verdictCheck: "À VÉRIFIER",
  verdictOk: "VRAI",
  // Légende clavier du pied de boîte.
  kbdListen: "écouter",
  kbdConvert: "convertir",
  kbdSetAside: "écarter",
  kbdUpDown: "HAUT/BAS",
  kbdNavigate: "naviguer",
  coverAlt: (name: string) => `Pochette — ${name}`,
  playbackFailed: "Lecture impossible — fichier illisible.",
  // Diagnostic audio.
  diagTitle: "Diagnostic audio",
  spectrogram: "Spectrogramme",
  spectrogramAria: "Spectrogramme audio",
  computing: "calcul…",
  computeFailed: "échec — réessayer",
  grpSpectrum: "Spectre",
  declared: "Déclaré",
  measured: "Mesuré",
  measuredValue: (reading: string, hz: string) => `${reading} · coupure ${hz} Hz`,
  hfDensity: "Densité de l'aigu",
  hfTopDensity: "Densité du haut",
  grpSignal: "Signal",
  samplePeak: "Pic d'échantillon",
  clipping: "Écrêtage",
  phaseCorrelation: "Corrélation de phase",
  dcOffset: "DC offset",
  grpShape: "Forme",
  silence: "Silence début / fin",
  channels: "Canaux · échantillonnage",
  grpIntegrity: "Intégrité",
  container: "Conteneur",
  containerOk: "conforme",
  containerBad: "non conforme",
  endOfFile: "Fin de fichier",
  truncated: "tronquée",
  complete: "complète",
  decodedDuration: "Durée décodée",
  codecError: (msg: string) => `erreur codec : ${msg}`,
};

const en: typeof fr = {
  captionMismatch: ".flac container but MP3 content detected — spoofed extension",
  captionFake: "sharp cutoff = likely transcode",
  captionGrey: "check visually",
  captionOk: "full-band energy = clean encoding",
  readingMismatch: "Spoofed extension",
  readingFake: "Sharp cutoff",
  readingGrey: "Check visually",
  readingOk: "Full band",
  verdictFake: "FAKE",
  verdictCheck: "TO CHECK",
  verdictOk: "GENUINE",
  kbdListen: "listen",
  kbdConvert: "convert",
  kbdSetAside: "set aside",
  kbdUpDown: "UP/DOWN",
  kbdNavigate: "navigate",
  coverAlt: (name) => `Cover — ${name}`,
  playbackFailed: "Can't play — the file is unreadable.",
  diagTitle: "Audio diagnostics",
  spectrogram: "Spectrogram",
  spectrogramAria: "Audio spectrogram",
  computing: "computing…",
  computeFailed: "failed — retry",
  grpSpectrum: "Spectrum",
  declared: "Declared",
  measured: "Measured",
  measuredValue: (reading, hz) => `${reading} · cutoff ${hz} Hz`,
  hfDensity: "Treble density",
  hfTopDensity: "Top-end density",
  grpSignal: "Signal",
  samplePeak: "Sample peak",
  clipping: "Clipping",
  phaseCorrelation: "Phase correlation",
  dcOffset: "DC offset",
  grpShape: "Shape",
  silence: "Silence start / end",
  channels: "Channels · sample rate",
  grpIntegrity: "Integrity",
  container: "Container",
  containerOk: "compliant",
  containerBad: "non-compliant",
  endOfFile: "End of file",
  truncated: "truncated",
  complete: "complete",
  decodedDuration: "Decoded duration",
  codecError: (msg) => `codec error: ${msg}`,
};

export const D = { fr, en };
export const T = dict(D);
