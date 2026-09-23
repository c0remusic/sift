// i18n.ts — la langue de l'interface, et le seul mécanisme par lequel un texte affiché la suit.
//
// Feuille SANS DOM et sans IPC, même motif que `popover-position.ts` : Vitest l'exécute en env
// Node. Ce qui touche la base et le document — lire le réglage au démarrage, l'enregistrer, traduire
// la coquille d'`index.html` — vit dans `lang-boot.ts`.
//
// FORME D'UN DICTIONNAIRE. Un fichier par module sous `frontend/i18n/`, qui déclare ses deux
// langues et les passe à `dict()` :
//
//   const fr = { convertir: "Convertir", doublons: (n: number) => `${n} doublon${n > 1 ? "s" : ""}` };
//   const en: typeof fr = { convertir: "Convert", doublons: (n) => `${n} duplicate${n > 1 ? "s" : ""}` };
//   export const T = dict({ fr, en });
//
// L'annotation `typeof fr` est la gate de parité : une clé anglaise manquante, en trop ou d'une
// autre signature casse `tsc --noEmit`, donc `verify.sh`. Aucun test à maintenir pour ça.
//
// ⚠️ LE TEXTE SE LIT À L'APPEL, JAMAIS AU CHARGEMENT. `T()` rend le dictionnaire de la langue
// COURANTE ; un module qui ferait `const LABEL = T().x` à sa racine figerait la langue d'avant
// `initLang()` — le français, puisque les imports s'évaluent avant le démarrage. Écrire `T().x`
// dans la fonction qui rend.
//
// ⚠️ ÉCHAPPEMENT : une fonction de dictionnaire reçoit ses valeurs TELLES QUE le gabarit d'origine
// les interpolait. Si le site écrivait `${esc(nom)}`, il écrit maintenant `T().f(esc(nom))` — l'appel
// à `esc()` reste au site, là où la revue de sécurité le cherche (`CLAUDE.md` § Front).

export type Lang = "fr" | "en";
export type LangChoice = "auto" | Lang;

/** Clé du réglage persisté (`settings` en base), même magasin que `ui_theme`. */
export const LANG_SETTING = "ui_lang";

let current: Lang = "fr";

/** La langue en vigueur. Français tant que `initLang()` n'a pas tranché. */
export function lang(): Lang {
  return current;
}

/** Fixée une fois, au démarrage (`lang-boot.ts`). Un changement de langue recharge la fenêtre
 *  plutôt que de rappeler cette fonction : chaque écran rend alors dans la nouvelle langue, sans
 *  qu'aucun ait à savoir se re-rendre. */
export function setCurrentLang(l: Lang): void {
  current = l;
}

/** Lit la valeur persistée. Tout ce qui n'est pas `fr` ou `en` — absent, vide, valeur inconnue —
 *  vaut `auto` : c'est le défaut, pas une erreur. */
export function parseLangChoice(v: string | null | undefined): LangChoice {
  return v === "fr" || v === "en" ? v : "auto";
}

/** `auto` suit la langue du système (`navigator.language`, que WebView2 et WKWebView tirent de
 *  l'OS) : français si elle commence par `fr`, anglais pour TOUTE autre langue — un DJ allemand
 *  lit plus volontiers l'anglais que le français. */
export function resolveLang(choice: LangChoice, systemLang: string | null | undefined): Lang {
  if (choice === "fr" || choice === "en") return choice;
  return (systemLang ?? "").trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** Rend un accesseur du dictionnaire de la langue courante. Voir l'en-tête pour la forme. */
export function dict<D>(d: { fr: D; en: D }): () => D {
  return () => d[current];
}

/** Locale BCP 47 pour `toLocaleString` / `Intl` : `44 100` en français, `44,100` en anglais. */
export function numLocale(): string {
  return current === "fr" ? "fr-FR" : "en-US";
}
