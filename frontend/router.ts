// Real view router (Tauri only) — étape 1 de DESIGN.md § 17.
//
// Jusqu'ici c'était `frontend/app.js`, la maquette d'origine, qui routait l'app RÉELLE :
// `main.ts` l'importait sans condition, elle tenait l'état de vue, le clic sur `[data-view]`,
// le titre accessible, les deux coquilles (Revue, Accueil) et le redimensionnement de la file —
// et appelait les vues live par huit globales `window.__sift*`. Six de ses sept renderers de
// démo étaient neutralisés par un garde `!('__TAURI_INTERNALS__' in window)` répété six fois,
// et le septième (`renderBatch`) était mort, masqué par une règle CSS de `chrome.ts`.
//
// Ce module reprend EXACTEMENT ce que la maquette fournissait au chemin de production, et rien
// d'autre : mêmes coquilles, mêmes identifiants, mêmes bornes de redimensionnement, même clé de
// stockage. Aucun changement visible — c'est un préalable, pas une refonte. Les étapes 2 et 3
// (barre unifiée, shell à trois zones) construisent dessus.
//
// `app.js` n'est plus chargée que hors Tauri (`main.ts`), où elle redevient ce qu'elle est : une
// démo navigateur. Ses gardes `inTauri` y sont désormais toujours faux, donc elle rend enfin sa
// maquette complète au lieu de coquilles vides, et ses appels `window.__sift*` ne trouvent rien —
// ce qui est correct : le wiring live n'existe pas dans un navigateur.
import { requireEl } from "./dom";
import { renderHomeSources } from "./home-sources";
import { renderQueue } from "./queue-panel";
import { renderEcartes } from "./ecartes-view";
import { renderReglagesLive } from "./reglages-view";
import { renderBiblioLive } from "./bibliotheque-view";
import { renderJournal, paintJournal } from "./journal";
import { renderRekordboxLive } from "./rekordbox-view";
import { renderUsbLive } from "./usb-view";

export type ViewId = "home" | "revue" | "ecarts" | "journal" | "biblio" | "rkb" | "cle" | "reglages";

const VIEWS: readonly ViewId[] = ["home", "revue", "ecarts", "journal", "biblio", "rkb", "cle", "reglages"];

function isViewId(v: string | undefined): v is ViewId {
  return !!v && (VIEWS as readonly string[]).includes(v);
}

let currentView: ViewId = "home";

/** La vue affichée. Lue par le futur titre de barre unifiée (étape 2) — et par les tests. */
export function activeView(): ViewId {
  return currentView;
}

// ---------------------------------------------------------------------------
// Largeur de la colonne file (#qcol, Revue)
//
// Redimensionnée à la souris, persistée entre rendus ET entre sessions : la coquille de Revue est
// reconstruite à chaque passage sur l'écran, donc la largeur doit être relue depuis le stockage à
// chaque montage, jamais gardée dans une variable vivante. Bornes et clé identiques à celles de
// la maquette — les changer invaliderait la largeur déjà enregistrée chez l'utilisateur.
// ---------------------------------------------------------------------------
const QCOL_MIN = 220;
const QCOL_MAX = 480;
const QCOL_DEFAULT = 272; // miroir de --pane-w (DESIGN.md § 10, D-2)
const QCOL_KEY = "sift-qcol-w";

function qcolWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(QCOL_KEY) ?? "", 10);
    if (v >= QCOL_MIN && v <= QCOL_MAX) return v;
  } catch {
    // localStorage indisponible (mode privé, quota) : le défaut suffit, ce n'est pas une erreur.
  }
  return QCOL_DEFAULT;
}

function installQueueResize(qcol: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = qcol.getBoundingClientRect().width;
    handle.classList.add("sift-qresize--active");
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(QCOL_MIN, Math.min(QCOL_MAX, startW + (ev.clientX - startX)));
      qcol.style.width = `${w}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      handle.classList.remove("sift-qresize--active");
      try {
        localStorage.setItem(QCOL_KEY, String(parseInt(qcol.style.width, 10)));
      } catch {
        // Même raison que ci-dessus : ne pas casser un redimensionnement pour un stockage refusé.
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ---------------------------------------------------------------------------
// Coquilles
//
// Chacune ne pose que la structure que la vue live exige, puis lui rend la main. Les identifiants
// sont contractuels : `queue-panel.ts` exige `#qcol`, `filing*.ts` exigent `#mid`, `#filfoot` et
// `#fldz`, `home-sources.ts` exige `#homequeue` et `#homeinspector`. Les changer casse un
// `requireEl` au montage — fail-fast, mais au montage seulement.
//
// `.h1` est également contractuel : `reglages-view.ts:36` et `usb-view.ts:35` parcourent les
// enfants de `#content`, gardent le premier `.h1` et masquent le reste.
// ---------------------------------------------------------------------------

/** Écran qui défile d'un bloc (Bibliothèque, Écartés, Journal, Rekordbox, Clé USB, Réglages).
 *  Reprend `block()` de la maquette — étape 3 le remplacera par le shell à trois zones. */
function blockShell(content: HTMLElement, title: string): void {
  content.style.display = "block";
  content.style.flexDirection = "";
  content.style.overflowY = "auto";
  content.innerHTML = title ? `<div class="h1">${title}</div>` : "";
}

function homeShell(content: HTMLElement): void {
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.overflowY = "auto";
  content.innerHTML =
    `<div class="home-body">` +
    `<div class="queue" id="homequeue" style="width:${QCOL_DEFAULT}px"></div>` +
    `<div class="sift-inspector" id="homeinspector"></div>` +
    `</div>`;
}

function revueShell(content: HTMLElement): void {
  content.style.display = "flex";
  content.style.flexDirection = "";
  content.style.overflowY = "";
  content.innerHTML =
    `<div class="sift-revue-row">` +
    `<div class="queue" id="qcol" style="width:${qcolWidth()}px">` +
    `<span class="col-h">File</span>` +
    `<div id="ql"></div>` +
    `</div>` +
    `<div class="sift-qresize" title="Redimensionner la file"></div>` +
    `<div class="sift-inspector" id="rvinspector">` +
    `<div class="mid" id="mid"></div>` +
    `<div class="sift-action-rail" id="filfoot"></div>` +
    `<div class="sift-dest-popover" id="fldz" hidden></div>` +
    `</div></div>`;
  const qcol = requireEl<HTMLElement>("#qcol", "revueShell");
  const handle = requireEl<HTMLElement>(".sift-qresize", "revueShell");
  installQueueResize(qcol, handle);
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/** Le libellé du rail EST le nom humain de la vue : le relire plutôt que maintenir une table
 *  vue → titre, qui divergerait au premier renommage. Le premier `<span>` porte le libellé ; le
 *  second, sur Revue, est le badge de compte. */
function syncNav(view: ViewId): void {
  const nav = requireEl<HTMLElement>("#nav", "syncNav");
  const viewTitle = document.getElementById("sift-view-title");
  nav.querySelectorAll<HTMLElement>(".nv").forEach((n) => {
    const on = n.dataset.view === view;
    n.classList.toggle("on", on);
    if (!on || !viewTitle) return;
    const label = n.querySelector("span");
    if (label) viewTitle.textContent = label.textContent;
  });
}

export function render(): void {
  const content = requireEl<HTMLElement>("#content", "render");
  syncNav(currentView);

  switch (currentView) {
    case "home":
      homeShell(content);
      void renderHomeSources();
      return;
    case "revue":
      revueShell(content);
      void renderQueue();
      return;
    case "biblio":
      blockShell(content, "");
      void renderBiblioLive();
      return;
    case "ecarts":
      blockShell(content, "");
      void renderEcartes();
      return;
    case "journal":
      blockShell(content, "");
      paintJournal(() => renderJournal(), "renderJournal");
      return;
    case "rkb":
      blockShell(content, "");
      void renderRekordboxLive();
      return;
    case "cle":
      // `usb-view.ts` garde le premier `.h1` et masque le reste : le titre lui appartient.
      blockShell(content, "Clé USB");
      renderUsbLive();
      return;
    case "reglages":
      // Même contrat que Clé USB (`reglages-view.ts:36`).
      blockShell(content, "Réglages");
      void renderReglagesLive();
      return;
  }
}

/** Navigue vers `view` et rend. Exportée pour les liens inter-écrans (l'état vide de Bibliothèque
 *  renvoie vers Revue, la porte de racine manquante vers Réglages) — jusqu'ici ces liens
 *  passaient par un `[data-view]` synthétique cliqué à travers le routeur de la maquette. */
export function goTo(view: ViewId): void {
  currentView = view;
  render();
}

/** Câble le routage et pose la première vue. Un seul écouteur, délégué sur `#pa` : chaque élément
 *  porteur d'un `data-view` navigue, où qu'il soit dans l'arbre (rail, état vide, bandeau). */
export function installRouter(): void {
  requireEl<HTMLElement>("#pa", "installRouter").addEventListener("click", (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-view]");
    if (!el) return;
    const v = el.dataset.view;
    if (!isViewId(v) || v === currentView) return;
    goTo(v);
  });
  render();
}
