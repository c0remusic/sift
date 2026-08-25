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
import { slideSegThumb } from "./seg-thumb";

export const BAR_SEARCH_ID = "sift-bar-search-input";

function slot(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Emplacement des actions contextuelles de la vue (2 à 3 au maximum). */
export function barActions(): HTMLElement | null {
  return slot("sift-tb-actions");
}

/** Emplacement d'action du BORD DROIT, juste avant la recherche et les contrôles de fenêtre. À ne
 *  pas confondre avec `barActions`, qui suit le titre : une action que la spec place à droite (la
 *  sélection multiple de Revue, patron toolbar de Photos) n'a rien à faire collée au titre, où elle
 *  se lit comme un ornement de celui-ci. */
export function barActionsRight(): HTMLElement | null {
  return slot("sift-tb-actions-right");
}

/** Emplacement de la recherche, toujours à droite. */
export function barSearch(): HTMLElement | null {
  return slot("sift-tb-search");
}

/** Remplit l'emplacement des actions. Écrase — c'est voulu : les actions sont dérivées de l'état
 *  de la vue et se recalculent à chaque rendu, contrairement au champ de recherche.
 *
 *  Corollaire à ne pas perdre : appelée APRÈS `mountBarSegmented` sur le même hôte, elle détruit le
 *  segmenté qui venait d'y être monté — les deux ne se partagent pas un écran. */
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

// ---------------------------------------------------------------------------
// Contrôle segmenté de la barre — un MODE DE VUE, pas une action
// ---------------------------------------------------------------------------

export interface BarSegOption {
  /** Identifiant rendu dans `data-barseg` et repassé à `onPick`. */
  id: string;
  /** Libellé visible. */
  label: string;
}

export interface BarSegmentedOptions {
  /** `id` du nœud segmenté, pour le retrouver d'un rendu à l'autre. */
  id: string;
  options: readonly BarSegOption[];
  /** Option active. */
  active: string;
  /** Libellé accessible du groupe. */
  ariaLabel: string;
  /** Appelé au clic sur une option INACTIVE, avec son `id`. */
  onPick: (id: string) => void;
}

/** Positionne le pouce depuis le bouton qui porte `.on`. Séparé du montage pour être rejouable :
 *  le pouce se déplace au clic, AVANT le rendu asynchrone qui suivra — sinon il n'y a rien à
 *  animer (`CLAUDE.md` § Front : une transition n'anime rien si le render reconstruit le nœud).
 *  Le placement lui-même est celui de `seg-thumb.ts`, partagé par les six segmentés de l'app. */
function paintBarSegmented(seg: HTMLElement, active: string): void {
  seg.querySelectorAll<HTMLElement>("[data-barseg]").forEach((b) => {
    const on = b.dataset.barseg === active;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  slideSegThumb(seg, "[data-barseg].on");
}

/** Monte (ou réutilise) un contrôle segmenté dans l'emplacement d'actions de la barre.
 *
 *  Même discipline que `mountBarSearch` — créer une fois, muter ensuite — et pour une raison
 *  visible à l'écran plutôt que par principe : le pouce de `.sift-seg-thumbed` glisse par
 *  `transform`, donc il lui faut un nœud qui SURVIT au changement d'état. `mountBarActions`
 *  réécrit l'emplacement à chaque appel ; un segmenté monté par là ne glisse jamais, il
 *  réapparaît déjà en place. Leçon héritée du segmenté Détail / Lot de Revue
 *  (`queue-panel.ts::ensureReviewSeg`, retiré le 2026-08-25 avec le segmenté lui-même) : elle vaut
 *  toujours pour les segmentés qui restent, seul son exemple d'origine a disparu du dépôt.
 *
 *  `router.ts::clearBarSlots()` vide l'emplacement à chaque changement d'écran : le nœud est donc
 *  recréé au retour sur la vue, ce qui est correct — c'est un remontage, pas un re-rendu. */
export function mountBarSegmented(opts: BarSegmentedOptions): void {
  const host = barActions();
  if (!host) return;

  let seg = document.getElementById(opts.id);
  if (!seg || !host.contains(seg)) {
    host.innerHTML =
      `<div class="sift-seg sift-seg-thumbed" id="${esc(opts.id)}" role="group" ` +
      `aria-label="${esc(opts.ariaLabel)}">` +
      `<div class="sift-seg-thumb"></div>` +
      opts.options
        .map(
          (o) =>
            `<button type="button" class="sift-seg-opt" data-barseg="${esc(o.id)}">${esc(o.label)}</button>`,
        )
        .join("") +
      `</div>`;
    seg = document.getElementById(opts.id);
    if (!seg) return;
  }

  // Un seul gestionnaire vivant à la fois, stocké sur le nœud : le précédent capture l'ancien
  // `active` et le rejouerait. Même motif que `mountBarSearch`, même raison.
  const holder = seg as HTMLElement & { _siftOnSegPick?: (e: Event) => void };
  if (holder._siftOnSegPick) seg.removeEventListener("click", holder._siftOnSegPick);
  const segEl = seg;
  const handler = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-barseg]");
    const picked = btn?.dataset.barseg;
    if (!picked || picked === opts.active) return;
    // Le pouce bouge tout de suite, sur les nœuds existants ; le rendu qui suit est asynchrone
    // (aller-retour IPC), le navigateur a donc le temps de peindre le déplacement.
    paintBarSegmented(segEl, picked);
    opts.onPick(picked);
  };
  holder._siftOnSegPick = handler;
  seg.addEventListener("click", handler);

  // Repeindre SEULEMENT si le montage ne dit pas déjà `opts.active`. Le chemin normal est un clic :
  // le gestionnaire ci-dessus a déjà déplacé le pouce, puis le rendu de la vue rappelle cette
  // fonction avec cette même option — repeindre à l'identique reforcerait une seconde mise en page
  // (`offsetWidth`/`offsetLeft` lisent la géométrie, donc synchronisent le layout) pour le même
  // pixel. Au premier montage il n'y a aucun `.on`, la comparaison échoue, et le pouce est placé.
  const mounted = seg.querySelector<HTMLElement>("[data-barseg].on")?.dataset.barseg;
  if (mounted !== opts.active) paintBarSegmented(seg, opts.active);
}

// ---------------------------------------------------------------------------
// Icône de sélection (Revue) — le commutateur du mode Lot
//
// `docs/ui-specs/revue.md` § Zone A : icône SEULE avec infobulle, patron *toolbar* Photos macOS ;
// armée, elle prend la teinte d'accent. Elle remplace le segmenté Détail / Lot qui vivait en tête
// de la colonne file, retiré le 2026-08-25 (« plus besoin du picker Lot ») : depuis ce retrait
// elle est le SEUL commutateur du mode Lot de l'app. Ne pas réintroduire d'onglet de mode.
//
// Le clic n'est PAS câblé ici. Le bouton porte `data-sift="reviewmode"`, l'action que le dispatch
// de clic de `sift-live.ts` sert déjà — même attribut, même `setReviewMode`, aucune logique
// dupliquée. Ce dispatch est enraciné sur `document` et non sur `#pa`, donc il voit bien la barre
// unifiée, qui vit hors de `#pa` (voir son commentaire de racine). `data-m` porte le mode CIBLE,
// c'est-à-dire l'inverse de l'état courant : c'est ce qui fait d'un commutateur à deux positions
// un simple bouton d'action du point de vue du dispatch, qui n'a alors rien à savoir de l'état.
// ---------------------------------------------------------------------------

export const BAR_BATCH_ID = "sift-bar-batch";

/** Monte (ou repeint) l'icône de sélection dans l'emplacement d'actions de la barre.
 *
 *  Même discipline que `mountBarSearch` — créer une fois, muter ensuite. La raison n'est ici ni le
 *  focus ni un pouce qui glisse mais l'infobulle : un nœud recréé sous le curseur emporte
 *  l'infobulle native que le survol venait d'ouvrir, et le survol ne la rouvre pas sans un nouveau
 *  mouvement de souris.
 *
 *  `router.ts::clearBarSlots()` vide l'emplacement à chaque rendu de vue : l'appelant doit donc
 *  rappeler cette fonction au rendu de Revue — voir `syncBarBatchToggle` (`sift-live.ts`), qui est
 *  le seul appelant et porte la mécanique de remontage.
 *
 *  Aucun `esc()` : le markup ci-dessous n'interpole que des littéraux de ce fichier, et les deux
 *  seules valeurs variables (l'infobulle, `data-m`) passent par `title`/`setAttribute`/`dataset`,
 *  qui ne parsent pas de HTML. */
export function mountBarBatchToggle(armed: boolean): void {
  const host = barActionsRight();
  if (!host) return;

  let btn = document.getElementById(BAR_BATCH_ID) as HTMLButtonElement | null;
  if (!btn || !host.contains(btn)) {
    host.innerHTML =
      `<button type="button" id="${BAR_BATCH_ID}" class="sift-bar-icon" data-sift="reviewmode">` +
      `<i class="ti ti-checkbox" aria-hidden="true"></i>` +
      `</button>`;
    btn = document.getElementById(BAR_BATCH_ID) as HTMLButtonElement | null;
    if (!btn) return;
  }

  // L'infobulle est obligatoire (le bouton n'a aucun libellé visible) et elle dit l'ACTION du
  // clic, pas l'état affiché : c'est ce que fait le « Sélectionner » de Photos, qui devient
  // « Terminé » une fois le mode armé. `aria-pressed`, lui, dit bien l'état — les deux sont
  // complémentaires et ne doivent pas se recopier.
  const label = armed ? "Quitter le mode Lot" : "Sélectionner plusieurs pistes";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", armed ? "true" : "false");
  btn.dataset.m = armed ? "detail" : "batch";
  btn.classList.toggle("on", armed);
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
// retour (`CLAUDE.md` § Modules frontend). `toolbar.ts` n'importe que des modules FEUILLES
// (`./dom`, `./seg-thumb`), donc il est en dessous de tout le monde.
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

// ---------------------------------------------------------------------------
// Porte de premier réglage — racine de bibliothèque
// ---------------------------------------------------------------------------

/** Masquée pour la session, jamais persistée : la porte doit revenir au prochain démarrage tant
 *  que la racine manque. Un « ne plus afficher » durable cacherait un blocage réel. */
let gateDismissed = false;

/** Ferme la porte pour cette session. */
export function dismissRootGateBanner(): void {
  gateDismissed = true;
  const el = document.getElementById("sift-gate");
  if (el) el.hidden = true;
}

/** Peint (ou retire) le bandeau de racine manquante.
 *
 *  `root` vient du magasin de réglages ; une valeur vide vaut absente. L'appelant relit le réglage
 *  plutôt que le module, pour que la porte se ferme dès que Réglages en pose une, sans attendre un
 *  changement d'écran. */
export function renderRootGate(root: string | null): void {
  const el = document.getElementById("sift-gate");
  if (!el) return;
  if (root || gateDismissed) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML =
    `<i class="ti ti-alert-triangle" aria-hidden="true"></i>` +
    `<span><strong>Racine de bibliothèque non définie</strong> — les dossiers surveillés restent ` +
    `scannés, mais la conversion sera bloquée tant qu'aucune racine n'est choisie.</span>` +
    `<button data-view="reglages" class="sift-gate-cta" type="button">Ouvrir Réglages</button>` +
    `<button data-gate="dismiss" class="lk-icon" type="button" title="Masquer pour cette session" ` +
    `aria-label="Masquer ce message pour cette session"><i class="ti ti-x"></i></button>`;
}
