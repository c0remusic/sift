// La bannière de mise à jour (`updater.ts`) : annonce de la version disponible, ses deux boutons, et
// les états du téléchargement jusqu'au redémarrage.
//
// Le numéro de version et le message d'échec viennent de l'extérieur (plugin updater, GitHub) : ils
// arrivent ici tels que le site les passait — échappés par `esc()` pour l'annonce rendue en
// `innerHTML`, bruts pour l'échec, posé par `textContent`.
import { dict } from "../i18n";

const fr = {
  disponible: (version: string) => `Mise à jour ${version} disponible.`,
  installer: "Installer et redémarrer",
  plusTard: "Plus tard",
  telechargement: "Téléchargement…",
  redemarrage: "Installation terminée, redémarrage...",
  echec: (erreur: string) => `Échec de la mise à jour : ${erreur}`,
};

const en: typeof fr = {
  disponible: (version) => `Update ${version} available.`,
  installer: "Install and restart",
  plusTard: "Later",
  telechargement: "Downloading…",
  redemarrage: "Installation complete, restarting…",
  echec: (erreur) => `Update failed: ${erreur}`,
};

export const D = { fr, en };
export const T = dict(D);
