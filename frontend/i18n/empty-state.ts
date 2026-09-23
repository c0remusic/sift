// État vide partagé (`empty-state.ts`) : le seul texte qu'il écrit lui-même, le lien de retour
// vers Revue. Titre et note viennent des écrans appelants, qui les traduisent chez eux.
import { dict } from "../i18n";

const fr = {
  openReview: "Ouvrir Revue",
};

const en: typeof fr = {
  openReview: "Open Review",
};

export const D = { fr, en };
export const T = dict(D);
