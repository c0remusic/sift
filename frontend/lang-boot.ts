// lang-boot.ts — ce qui fixe la langue au démarrage et la change depuis Réglages : la part de
// `i18n.ts` qui touche la base (réglage `ui_lang`), le backend (`set_ui_lang`) et le document.
//
// Même partage que `theme.ts` pour le thème, à une différence près : un thème s'applique à chaud
// par un attribut, une langue non — chaque écran a déjà rendu ses textes. Changer de langue
// ENREGISTRE puis RECHARGE la fenêtre, et chaque écran rend alors dans la nouvelle langue sans
// avoir à savoir se re-rendre. Le backend garde son état (file d'analyse, base) à travers le
// rechargement ; seul un son en cours de lecture s'arrête.
import { getSetting, setSetting, setUiLang } from "./ipc";
import { LANG_SETTING, lang, parseLangChoice, resolveLang, setCurrentLang, type LangChoice } from "./i18n";
import { T as shell, type ShellKey } from "./i18n/shell";

/** Remplace les textes de la coquille d'`index.html` par ceux de la langue courante. */
function applyShell(): void {
  const s = shell();
  document.title = s.docTitle;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n as ShellKey;
    if (k in s) el.textContent = s[k];
    else console.error(`lang-boot: data-i18n="${k}" absente de i18n/shell.ts`);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const k = el.dataset.i18nTitle as ShellKey;
    if (k in s) el.title = s[k];
    else console.error(`lang-boot: data-i18n-title="${k}" absente de i18n/shell.ts`);
  });
}

/** Lit le choix persisté, tranche la langue, traduit la coquille, prévient le backend. À appeler
 *  AVANT le câblage des écrans (`main.ts`) : tout texte rendu plus tôt le serait en français.
 *
 *  Ne rejette jamais. Un réglage illisible laisse `auto` ; un backend qui refuse la langue laisse
 *  ses messages en français — l'interface reste utilisable dans les deux cas, et l'échec part en
 *  console avec sa chaîne brute. */
export async function initLang(): Promise<LangChoice> {
  let choice: LangChoice = "auto";
  try {
    choice = parseLangChoice(await getSetting(LANG_SETTING));
  } catch (e) {
    console.error(`getSetting(${LANG_SETTING}) failed`, e);
  }
  setCurrentLang(resolveLang(choice, navigator.language));
  document.documentElement.lang = lang();
  applyShell();
  try {
    await setUiLang(lang());
  } catch (e) {
    console.error("set_ui_lang failed — les messages du backend restent en français", e);
  }
  return choice;
}

const VIEW_AFTER_RELOAD = "sift:view-after-reload";

/** La vue à rouvrir après un rechargement de changement de langue, lue UNE fois puis effacée —
 *  `router.ts::installRouter` l'appelle. Sans elle, choisir « English » dans Réglages renverrait
 *  sur Revue, et l'utilisateur ne verrait pas le contrôle qu'il vient d'actionner. `null` si
 *  rien n'a été confié, ou si le stockage de session est indisponible. */
export function takeViewAfterReload(): string | null {
  try {
    const v = sessionStorage.getItem(VIEW_AFTER_RELOAD);
    sessionStorage.removeItem(VIEW_AFTER_RELOAD);
    return v;
  } catch {
    return null;
  }
}

/** Enregistre un nouveau choix puis recharge la fenêtre sur `returnTo`. Rend l'échec
 *  d'ENREGISTREMENT à l'appelant, sans recharger : recharger après un échec rendrait l'ancienne
 *  langue, et le clic paraîtrait n'avoir rien fait (même raisonnement que `theme.ts::setTheme`,
 *  impasse A21). */
export async function setLang(
  choice: LangChoice,
  returnTo: string,
): Promise<{ persisted: false; error: unknown } | never> {
  try {
    await setSetting(LANG_SETTING, choice);
  } catch (e) {
    return { persisted: false, error: e };
  }
  try {
    sessionStorage.setItem(VIEW_AFTER_RELOAD, returnTo);
  } catch {
    // Stockage de session indisponible : le rechargement rouvrira la vue par défaut. La langue,
    // elle, est bien enregistrée — rien à signaler.
  }
  location.reload();
  // `reload()` ne rend pas la main de façon utile : la page part. Promesse jamais résolue plutôt
  // qu'un retour que personne ne lirait.
  return new Promise<never>(() => {});
}
