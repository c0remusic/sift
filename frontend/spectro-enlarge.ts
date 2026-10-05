// La vue agrandie du spectrogramme (#72) : par-dessus l'app, sur le patron `.sift-report-overlay`
// des confirmations. La grille est CALCULÉE à la taille du cadre en pixels physiques (Rust,
// max-pool dans les deux axes, jamais plus que la source), puis la figure REMPLIT le cadre : à 1:1
// quand la source suffit, étirée quand elle compte moins de colonnes ou de bandes que le cadre n'a
// de pixels. Spec : `docs/ui-specs/revue.md` § Décision — 2026-09-29, amendée le 2026-10-05.
import type { AnalysisReport, SpectrogramGrid } from "../shared/contracts";
import { analyzePath } from "./ipc";
import { T } from "./i18n/spectro-enlarge";
import { axisTicks, gridSeconds, mmss, paintSpectrogramExact, wireSpectroHover } from "./spectro-canvas";

const OVERLAY_ID = "sift-spectro-xl";
/** Pas des graduations, du plus fin au plus large. En Hz et en secondes. */
const HZ_STEPS = [1000, 2000, 4000, 5000, 10000] as const;
const SEC_STEPS = [5, 10, 15, 30, 60, 120, 300] as const;
/** Écart minimal entre deux graduations, en px CSS : une étiquette « 20 kHz » ou « 4:00 » et
 *  de l'air autour. */
const Y_GAP_PX = 32;
const X_GAP_PX = 64;
/** Délai avant de recalculer la grille après un redimensionnement : un glissement de bord émet
 *  un `resize` par image, et chaque recalcul redécode le fichier. */
const RESIZE_SETTLE_MS = 250;

/** La vue ouverte, s'il y en a une : la rouvrir referme d'abord la précédente, écouteurs compris. */
let closeCurrent: (() => void) | null = null;

/** Ce que la vue demande au reste de l'app. Par défaut la vraie commande et le `body` ; la story
 *  passe une grille synthétique et son propre conteneur, puisque Storybook n'a pas Tauri. */
export interface EnlargeDeps {
  fetchGrid: (path: string, grid: SpectrogramGrid) => Promise<AnalysisReport>;
  mount: (overlay: HTMLElement) => void;
}

const DEFAULT_DEPS: EnlargeDeps = {
  fetchGrid: (path, grid) => analyzePath(path, true, false, grid),
  mount: (overlay) => document.body.append(overlay),
};

/** Ouvre la vue sur la piste `path`. `returnFocus` reprend le focus à la fermeture — le bouton
 *  « Agrandir », qui porte le chemin clavier. */
export function openSpectroEnlarged(
  path: string,
  name: string,
  returnFocus: HTMLElement | null,
  deps: EnlargeDeps = DEFAULT_DEPS,
): void {
  closeCurrent?.();
  const t = T();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "sift-report-overlay";

  const card = document.createElement("div");
  card.className = "sift-report-overlay-card sift-spectro-xl";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", t.titre);

  const head = document.createElement("div");
  head.className = "sift-spectro-xl-head";
  const title = document.createElement("span");
  title.className = "sift-spectro-xl-title";
  title.textContent = t.titre;
  const nameEl = document.createElement("span");
  nameEl.className = "sift-spectro-xl-name";
  nameEl.textContent = name;
  nameEl.title = name;
  const count = document.createElement("span");
  count.className = "sift-spectro-xl-count";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sift-meta-ident-btn";
  closeBtn.textContent = t.fermer;
  head.append(title, nameEl, count, closeBtn);

  // Le tracé : une gouttière à gauche (kHz) et en bas (mm:ss), portée par le padding ; `area` est
  // la place que le canevas peut prendre, MESURÉE avant de demander la grille.
  const plot = document.createElement("div");
  plot.className = "sift-spectro-xl-plot";
  const area = document.createElement("div");
  area.className = "sift-spectro-xl-area";
  const stateEl = document.createElement("div");
  stateEl.className = "sift-spectro-xl-state";
  area.append(stateEl);
  plot.append(area);

  card.append(head, plot);
  overlay.append(card);
  deps.mount(overlay);

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    clearTimeout(resizeTimer);
    overlay.remove();
    closeCurrent = null;
    returnFocus?.focus();
  };
  closeCurrent = close;

  // En phase de CAPTURE, et rien ne passe derrière : les raccourcis de Revue (`filing.ts`) n'ont
  // pas de garde de modale, et Entrée y range la piste, ⌫ l'écarte. L'action par défaut reste — la
  // touche Entrée sur « Fermer » le clique encore.
  function onKey(e: KeyboardEvent) {
    // Détachée sans passer par `close` (conteneur retiré, story changée) : l'écouteur s'en va seul,
    // au lieu de confisquer le clavier de toute la fenêtre.
    if (!overlay.isConnected) {
      document.removeEventListener("keydown", onKey, true);
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const focusable = [...card.querySelectorAll<HTMLElement>("button")];
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (idx <= 0 ? focusable.length - 1 : idx - 1) : (idx + 1) % focusable.length;
      focusable[next]?.focus();
    }
  }
  document.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  // Clic HORS DU SPECTROGRAMME : le voile, mais aussi les gouttières d'axes autour de la figure.
  // La carte remplit le voile ; fermer seulement sur le voile
  // laissait un anneau de 24 px (relecture de #72, demande d'Antoine : « on peut pas cliquer en
  // dehors du cadre ? »). L'en-tête (Fermer) et l'état de calcul (Réessayer) gardent leurs clics.
  overlay.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (!t.closest(".sift-spectro-xl-figure, .sift-spectro-xl-head, .sift-spectro-xl-state")) close();
  });
  closeBtn.focus();

  // Chaque chargement porte un numéro : un résultat arrivé après un chargement plus récent (fenêtre
  // redimensionnée pendant le calcul) est ignoré au lieu de peindre la mauvaise taille.
  let generation = 0;
  const load = () => {
    const mine = ++generation;
    area.querySelector(".sift-spectro-xl-figure")?.remove();
    stateEl.hidden = false;
    stateEl.replaceChildren(t.calcul);
    count.textContent = "";
    // Mesurée ICI, la carte dans le flux : un conteneur `display:none` rendrait 0.
    const box = area.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const grid = { cols: Math.max(1, Math.floor(box.width * dpr)), bins: Math.max(1, Math.floor(box.height * dpr)) };
    deps.fetchGrid(path, grid).then(
      (r) => {
        if (!overlay.isConnected || mine !== generation) return; // fermée, ou dépassée
        show(r);
      },
      (e) => {
        if (!overlay.isConnected || mine !== generation) return;
        console.error("spectro-enlarge: analyze_path failed", e);
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "sift-meta-ident-btn";
        retry.textContent = t.reessayer;
        retry.addEventListener("click", load);
        stateEl.replaceChildren(t.echec, " ", retry);
        retry.focus();
      },
    );
  };

  const show = (r: AnalysisReport) => {
    const sg = r.spectrogram;
    // La figure prend TOUT le cadre (décision d'Antoine du 2026-10-05, sur capture plein écran :
    // « en plein écran ça s'affiche bizarrement » — une source de 2475 × 1024 restait collée en
    // haut à gauche d'un cadre de ~3390 × 1300, le reste vide). Jusque-là, le canevas rétrécissait
    // à la taille de la source pour ne jamais étirer une donnée (règle de #30). Le compte
    // « N × M mesurés » reste celui de la source : ce qui est étiré se dit, il ne se fait pas passer
    // pour mesuré. Le canevas garde sa résolution réelle, c'est le CSS qui le met à la taille.
    const box = area.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(box.width));
    const cssH = Math.max(1, Math.floor(box.height));
    const figure = document.createElement("div");
    figure.className = "sift-spectro-xl-figure";
    figure.style.width = `${cssW}px`;
    figure.style.height = `${cssH}px`;
    const base = document.createElement("canvas");
    base.className = "sift-spectro-canvas sift-spectro-xl-canvas";
    base.setAttribute("role", "img");
    base.setAttribute("aria-label", t.aria);
    base.style.width = `${cssW}px`;
    base.style.height = `${cssH}px`;
    const hover = document.createElement("canvas");
    hover.className = "sift-spectro-overlay";
    figure.append(base, hover, axes(sg.bins * sg.hz_per_bin, gridSeconds(sg), cssW, cssH));
    stateEl.hidden = true;
    area.append(figure);
    paintSpectrogramExact(base, sg);
    wireSpectroHover(base, hover, r);
    count.textContent = t.mesures(sg.frames, sg.bins);
  };

  // La grille est calculée pour une taille : la fenêtre change (redimensionnée, passée sur un
  // écran à une autre échelle, ce qui émet aussi `resize`), la grille se recalcule. Sinon la
  // figure débordait de la carte, ou cessait d'être peinte à 1:1.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(load, RESIZE_SETTLE_MS);
  }
  window.addEventListener("resize", onResize);

  load();
}

/** Les graduations en HTML autour du canevas : kHz à gauche, mm:ss en bas. Du texte de l'app, à
 *  sa taille, plutôt qu'une légende dessinée dans les pixels physiques du canevas. */
function axes(nyquistHz: number, durationSec: number, cssW: number, cssH: number): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const hz of axisTicks(nyquistHz, cssH, Y_GAP_PX, HZ_STEPS)) {
    const el = document.createElement("span");
    el.className = "sift-spectro-xl-tick is-y";
    el.style.top = `${cssH - (hz / nyquistHz) * cssH}px`;
    el.textContent = `${hz / 1000} kHz`;
    frag.append(el);
  }
  for (const s of axisTicks(durationSec, cssW, X_GAP_PX, SEC_STEPS)) {
    const el = document.createElement("span");
    el.className = "sift-spectro-xl-tick is-x";
    el.style.left = `${(s / durationSec) * cssW}px`;
    el.textContent = mmss(s);
    frag.append(el);
  }
  return frag;
}
