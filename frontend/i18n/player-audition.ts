// La rangée d'audition du lecteur de Revue (`player-audition.ts`) : infobulles et libellés
// accessibles du bouton lecture, du slider de progression, du temps cliquable et du volume.
//
// Aucune valeur ne porte de guillemet droit ni de chevron : toutes finissent dans un attribut
// `title` / `aria-label` du markup statique.
import { dict } from "../i18n";

const fr = {
  playPause: "Lecture / pause (espace)",
  position: "Position de lecture",
  timeToggle: "Temps écoulé / restant — cliquer pour basculer",
  mute: "Couper / rétablir le son",
  volume: "Volume",
};

const en: typeof fr = {
  playPause: "Play / pause (Space)",
  position: "Playback position",
  timeToggle: "Elapsed / remaining time — click to switch",
  mute: "Mute / unmute",
  volume: "Volume",
};

export const D = { fr, en };
export const T = dict(D);
