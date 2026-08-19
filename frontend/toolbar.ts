// Emplacements de la barre unifiée — étape 2 de DESIGN.md § 17.
//
// La barre porte, dans cet ordre : titre de la vue · actions contextuelles · espaceur ·
// recherche · boutons de fenêtre. Les deux emplacements du milieu sont vides par défaut ; une
// vue y monte ce qui lui appartient, et `router.ts` les vide à chaque changement d'écran.
//
// Pourquoi un module plutôt qu'un `innerHTML` par vue : la recherche est le SEUL contrôle de
// l'app dont le contenu est frappé au clavier pendant que son écran se re-rend. Tant qu'elle
// vivait dans `#content` (`bibliotheque-view.ts`), chaque frappe déclenchait un rebuild par
// `innerHTML` qui détruisait le champ et son focus. Sortie dans la barre, elle n'est plus dans
// l'arbre que le rendu écrase — mais il faut encore garantir qu'un remontage ne la recrée pas
// sous les doigts. D'où la discipline ci-dessous : créer une fois, muter ensuite.
import { esc } from "./dom";

export const BAR_SEARCH_ID = "sift-bar-search-input";

function slot(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Emplacement des actions contextuelles de la vue (2 à 3 au maximum). */
export function barActions(): HTMLElement | null {
  return slot("sift-tb-actions");
}

/** Emplacement de la recherche, toujours à droite. */
export function barSearch(): HTMLElement | null {
  return slot("sift-tb-search");
}

/** Remplit l'emplacement des actions. Écrase — c'est voulu : les actions sont dérivées de l'état
 *  de la vue et se recalculent à chaque rendu, contrairement au champ de recherche. */
export function mountBarActions(html: string): void {
  const host = barActions();
  if (host) host.innerHTML = html;
}

export interface BarSearchOptions {
  /** Texte du placeholder. */
  placeholder: string;
  /** Libellé accessible — jamais le placeholder seul. */
  ariaLabel: string;
  /** Valeur courante, poussée dans le champ SEULEMENT si elle en diffère. */
  value: string;
  /** Appelé à chaque frappe, avec la valeur brute. */
  onInput: (value: string) => void;
}

/** Monte (ou réutilise) le champ de recherche de la barre.
 *
 *  Créé une seule fois : un remontage recréerait le nœud, donc perdrait le focus et le curseur
 *  au milieu d'une frappe. Les appels suivants ne font que remettre à jour le gestionnaire et la
 *  valeur — et la valeur, uniquement si elle diffère de ce qui est affiché, sinon la position du
 *  curseur saute à la fin à chaque re-rendu de l'écran. */
export function mountBarSearch(opts: BarSearchOptions): HTMLInputElement | null {
  const host = barSearch();
  if (!host) return null;

  let input = document.getElementById(BAR_SEARCH_ID) as HTMLInputElement | null;
  if (!input) {
    host.innerHTML =
      `<div class="sift-bar-search">` +
      `<i class="ti ti-search" aria-hidden="true"></i>` +
      `<input id="${BAR_SEARCH_ID}" type="search" placeholder="${esc(opts.placeholder)}" ` +
      `aria-label="${esc(opts.ariaLabel)}">` +
      `</div>`;
    input = document.getElementById(BAR_SEARCH_ID) as HTMLInputElement | null;
    if (!input) return null;
  } else {
    input.placeholder = opts.placeholder;
    input.setAttribute("aria-label", opts.ariaLabel);
  }

  if (input.value !== opts.value) input.value = opts.value;

  // Un seul gestionnaire vivant à la fois : le précédent capture l'ancien `onInput` (donc l'ancien
  // état de la vue) et le rejouerait en plus du nouveau. Stocké sur le nœud plutôt que dans un
  // module-level, parce que le nœud peut disparaître avec l'emplacement au changement d'écran.
  const holder = input as HTMLInputElement & { _siftOnInput?: (e: Event) => void };
  if (holder._siftOnInput) input.removeEventListener("input", holder._siftOnInput);
  const handler = () => opts.onInput(input.value);
  holder._siftOnInput = handler;
  input.addEventListener("input", handler);

  return input;
}

/** Place le focus dans la recherche de la barre. Rend `false` quand la vue courante n'en monte
 *  aucune — l'appelant (le raccourci ⌘/Ctrl+F) peut alors ne rien faire plutôt que d'échouer en
 *  silence sur un `?.` qui ressemble à un succès. */
export function focusBarSearch(): boolean {
  const input = document.getElementById(BAR_SEARCH_ID) as HTMLInputElement | null;
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

// ---------------------------------------------------------------------------
// Zone D — l'inspecteur (DESIGN.md § 14)
//
// Ici et non dans `router.ts` pour une raison de cycle, pas de rangement : les vues ouvrent et
// referment la zone D, et `router.ts` importe les vues. Une vue qui importerait le routeur en
// retour fermerait la boucle. Même règle que les splits de `filing*.ts` — jamais d'import statique
// retour (`CLAUDE.md` § Modules frontend). `toolbar.ts` n'importe que `./dom`, donc il est en
// dessous de tout le monde.
// ---------------------------------------------------------------------------

/** Ouvre la zone D et rend son hôte, ou `null` si le shell n'en a pas. */
export function openAside(): HTMLElement | null {
  const aside = document.getElementById("sift-aside");
  if (!aside) return null;
  aside.hidden = false;
  return aside;
}

/** Referme et vide la zone D. Appelée à chaque changement d'écran par `router.ts` : un inspecteur
 *  laissé ouvert montrerait le détail d'une sélection qui n'est plus à l'écran. */
export function closeAside(): void {
  const aside = document.getElementById("sift-aside");
  if (!aside) return;
  aside.hidden = true;
  aside.textContent = "";
}
