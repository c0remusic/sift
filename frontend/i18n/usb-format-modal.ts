// La sheet de formatage de l'écran Clé USB (`usb-format-modal.ts`) : titre, avertissements,
// choix du système de fichiers, nom du volume, bouton armé/confirmé, note de progression et
// messages d'échec écrits par le front.
//
// ⚠️ Les étapes affichées pendant le formatage (`formatStep`) viennent du BACKEND, déjà dans la
// langue de l'interface (`crate::tr!`) ; leurs marqueurs de fin sont `STEP_DONE` et
// `STEP_FAILED_PREFIX` de `shared/contracts.ts`, neutres depuis le 2026-09-23 (ils valaient
// « Terminé » et « Échec »). Seule l'étape posée par le front avant le premier sondage
// (`etapeAutorisation`) vit ici.
// Vocabulaire : `docs/design-system/content.md` § Locale `en`.
import { dict } from "../i18n";

const fr = {
  /** Titre de la sheet ET son `aria-label` : le site passe le nom échappé au premier, brut au second. */
  titre: (nom: string) => `Formater ${nom}`,
  disqueAmovible: "Disque amovible",
  tailleEtFormat: (taille: string, fs: string) => `${taille} Go · actuellement ${fs}`,
  avertissement:
    "Cette action efface tout le contenu du disque, " +
    "de façon irréversible. Vérifie que c'est bien la bonne clé avant de continuer.",
  fat32Recommande: "FAT32 (recommandé)",
  avertissementExfat:
    "exFAT n'est pas garanti compatible avec tous " +
    "les CDJ/contrôleurs DJ. FAT32 reste le choix le plus sûr pour un usage club.",
  avertissementElevation:
    "Windows ne sait pas créer un FAT32 au-delà de " +
    "32 Go ; Sift l'écrit lui-même. Une autorisation administrateur sera demandée — c'est " +
    "ce qui permet d'écrire directement sur le disque.",
  nomVolume: "Nom du volume",
  annuler: "Annuler",
  formatageEnCours: "Formatage en cours…",
  confirmerArme: "Confirmer — tout sera effacé",
  formater: "Formater…",
  noteProgression: "Une autorisation Windows va apparaître — accepte-la. Ne débranche pas le disque.",
  /** ⚠️ Couplé au backend : le module garde l'étape tant que `formatStep()` rend la MÊME chaîne
   * (`if (s === step) return;`). Le premier `write_step` du backend (`ipc_usb.rs`,
   * `usb_format/windows.rs`) écrit ce texte-là, dans les deux langues : ses deux valeurs doivent
   * rester identiques à celles-ci, sinon le libellé bascule une seconde fois au premier sondage. */
  etapeAutorisation: "Autorisation Windows demandée…",
  errIdentite: (nom: string) =>
    "Ce n'est plus le même disque : un autre volume répond maintenant à " +
    nom +
    ". Rien n'a été formaté. Ferme cette fenêtre et resélectionne le disque dans la liste.",
  errDebranche:
    "Le disque a été débranché avant que le formatage ne commence. Rien n'a été " +
    "formaté. Rebranche-le et resélectionne-le dans la liste.",
  errElevation:
    "Windows demande une autorisation administrateur pour formater un disque, et " +
    "elle a été refusée. Rien n'a été formaté — relance et accepte l'invite.",
  errAcces: "Accès refusé — ferme tout programme utilisant ce disque et réessaie.",
  errIntrouvable: "Disque introuvable — a-t-il été débranché pendant le formatage ?",
  errEchec: "Échec du formatage. Vérifie que le disque est bien branché et réessaie.",
};

const en: typeof fr = {
  titre: (nom) => `Format ${nom}`,
  disqueAmovible: "Removable drive",
  tailleEtFormat: (taille, fs) => `${taille} GB · currently ${fs}`,
  avertissement:
    "This action erases everything on the drive, and it can't be undone. " +
    "Check that this is the right drive before you continue.",
  fat32Recommande: "FAT32 (recommended)",
  avertissementExfat:
    "exFAT isn't guaranteed to work on every CDJ or DJ controller. " +
    "FAT32 remains the safest choice for club use.",
  avertissementElevation:
    "Windows can't create a FAT32 volume larger than 32 GB; Sift writes it itself. " +
    "Windows will ask you for administrator permission — that's what lets Sift write " +
    "directly to the drive.",
  nomVolume: "Volume name",
  annuler: "Cancel",
  formatageEnCours: "Formatting…",
  confirmerArme: "Confirm — this erases everything",
  formater: "Format…",
  noteProgression: "A Windows permission prompt will appear — accept it. Don't unplug the drive.",
  etapeAutorisation: "Asking Windows for permission…",
  errIdentite: (nom) =>
    "This is no longer the same drive: another volume is now at " +
    nom +
    ". Nothing was formatted. Close this window and select the drive again in the list.",
  errDebranche:
    "The drive was unplugged before formatting started. Nothing was formatted. " +
    "Plug it back in and select it again in the list.",
  errElevation:
    "Windows needs administrator permission to format a drive, and you declined it. " +
    "Nothing was formatted — start again and accept the prompt.",
  errAcces: "Access denied — close any program using this drive and try again.",
  errIntrouvable: "Drive not found — was it unplugged during formatting?",
  errEchec: "Formatting failed. Check that the drive is plugged in and try again.",
};

export const D = { fr, en };
export const T = dict(D);
