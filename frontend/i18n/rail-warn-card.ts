// La carte « racine de bibliothèque non définie » du rail (`rail-warn-card.ts`) : son nom accessible
// et ses deux lignes visibles.
//
// ⚠️ `aria` part dans un attribut entre guillemets doubles : aucune de ses deux valeurs ne doit
// contenir `"`, `<` ou `>`. Le test `rail-warn-card.test.ts` le vérifie dans les deux langues.
import { dict } from "../i18n";

const fr = {
  aria: "Racine de bibliothèque non définie — ouvrir les Réglages pour la choisir",
  titre: "Racine non définie",
  action: "Choisir dans Réglages ›",
};

const en: typeof fr = {
  aria: "Library root not set — open Settings to choose one",
  titre: "Root not set",
  action: "Choose in Settings ›",
};

export const D = { fr, en };
export const T = dict(D);
