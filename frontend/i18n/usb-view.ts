// L'écran Clé USB (`usb-view.ts`) : colonne des disques amovibles, barre (Actualiser), états vides
// et d'échec, tête du disque choisi, grille de faits, actions du disque et menu contextuel.
// Les messages d'éjection viennent de `usage-chart.ts::humanizeEject`, pas d'ici.
// Vocabulaire : `docs/design-system/content.md` § Locale `en`.
import { dict } from "../i18n";

const fr = {
  disquesAmovibles: "Disques amovibles",
  actualiser: "Actualiser",
  /** Suivi, au site, d'un `<br>` et de la chaîne brute de l'erreur. */
  listeImpossible: "Impossible de lister les disques amovibles.",
  aucunDisqueTitre: "Aucun disque amovible détecté",
  aucunDisqueNote:
    "Un lecteur de cartes vide garde sa lettre dans l'explorateur Windows sans qu'aucune clé ne " +
    "soit branchée — vérifie que la clé est bien enfoncée, puis Actualiser. Seuls les disques " +
    "amovibles sont proposés : aucun disque interne n'apparaît ici.",
  compte: (n: number) => `${n} disque${n > 1 ? "s" : ""}`,
  aucunMedia:
    "Aucun média inséré. Ce lecteur garde sa lettre dans l'explorateur " +
    "Windows même vide — insère une carte ou une clé, puis Actualiser.",
  disqueUsbExterne: "Disque USB externe",
  nonFormate: "non formaté",
  disqueAmovible: "Disque amovible",
  lecteurAmovible: "Lecteur amovible",
  aucunMediaInsere: "aucun média inséré",
  occupationEnCours: "Analyse de l'occupation…",
  /** Suivi, au site, d'un `<br>` et de la chaîne brute de l'erreur. */
  occupationIndisponible: "Occupation indisponible.",
  aucunVolume: "Aucun volume monté — rien à parcourir tant que le disque n'est pas formaté.",
  faits: {
    montage: "Point de montage",
    format: "Format",
    capacite: "Capacité",
    libre: "Libre",
    fichiers: "Fichiers",
    modele: "Modèle",
    peripherique: "Périphérique",
    sante: "Santé",
  },
  formater: "Formater…",
  ejecter: "Éjecter",
  ejection: "Éjection…",
  relire: "Relire le disque",
};

const en: typeof fr = {
  disquesAmovibles: "Removable drives",
  actualiser: "Refresh",
  listeImpossible: "Couldn't list the removable drives.",
  aucunDisqueTitre: "No removable drive detected",
  aucunDisqueNote:
    "An empty card reader keeps its letter in Windows Explorer even with no drive plugged in — " +
    "check that the drive is pushed all the way in, then Refresh. Only removable drives are " +
    "listed: no internal drive shows up here.",
  compte: (n) => `${n} drive${n === 1 ? "" : "s"}`,
  aucunMedia:
    "No media inserted. This reader keeps its letter in Windows Explorer even when empty — " +
    "insert a card or a drive, then Refresh.",
  disqueUsbExterne: "External USB drive",
  nonFormate: "unformatted",
  disqueAmovible: "Removable drive",
  lecteurAmovible: "Card reader",
  aucunMediaInsere: "no media inserted",
  occupationEnCours: "Reading disk usage…",
  occupationIndisponible: "Disk usage unavailable.",
  aucunVolume: "No volume mounted — nothing to scan until the drive is formatted.",
  faits: {
    montage: "Mount point",
    format: "Format",
    capacite: "Capacity",
    libre: "Free",
    fichiers: "Files",
    modele: "Model",
    peripherique: "Device",
    sante: "Health",
  },
  formater: "Format…",
  ejecter: "Eject",
  ejection: "Ejecting…",
  relire: "Rescan drive",
};

export const D = { fr, en };
export const T = dict(D);
