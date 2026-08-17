// Home "sources" screen (Tauri only). Two-column grammar matching the maquette
// (docs/archive/design_handoff_sift_refonte/Sift.dc.html:68-77 list rail, :594-633 inspector): a list
// of watched sources in the queue rail (#homequeue), and a detail inspector for the
// selected one (#homeinspector) — breadcrumb, "Dossier surveillé" card, watch toggle,
// bottom-bar "+ Ajouter un dossier". Extracted from sift-live.ts (audit P-3), rebuilt
// 2026-07-02 (docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md §1: the old single-column list was a
// confirmed structural gap vs the maquette).
import { listSources, addSource, removeSource, setSourceWatched, getSetting, rescanSource } from "./ipc";
import { open } from "@tauri-apps/plugin-dialog";
import type { Source } from "../shared/contracts";
import { esc } from "./dom";
import { confirmAction } from "./confirm-modal";
// Les quatre actions de cet écran (ajouter / surveiller / rescanner / retirer) échouaient en
// `console.error` seul — impasse A3 de l'inventaire des échecs silencieux (issue #15). Un toast
// est le seul porteur disponible ici : ces actions n'ont pas de zone de statut à elles, et le
// rail se repeint par-dessus toute erreur qu'on y écrirait.
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";

const LIBRARY_ROOT = "library_root"; // same setting key filing.ts gates the destination tree on

/** Selected source persists across re-renders (watcher/refresh events) by id, not index —
 * the list can reorder/shrink under us. */
let selectedSourceId: number | null = null;

// Dismissed for this session only (not persisted) — re-shown next app launch and immediately if
// the user clicks away then back with root still unset would be a nag; a session-scoped dismiss
// (not per-source) fixes the "same banner every source click" repetition found at the 2026-07-09
// audit without hiding a real blocker (rangement bloqué) permanently.
let rootGateDismissed = false;

export function dismissRootGate(): void {
  rootGateDismissed = true;
}

function baseName(path: string): string {
  const norm = path.replace(/[/\\]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

const SOURCE_HUE_CYCLE = ["indigo", "purple", "pink", "teal", "yellow"] as const;

/** Libellés FR des 5 teintes catégorielles — aucune table équivalente trouvée
 *  ailleurs dans le fichier ni dans docs/design-system/content.md, table locale. */
const SOURCE_HUE_LABEL_FR: Record<(typeof SOURCE_HUE_CYCLE)[number], string> = {
  indigo: "indigo",
  purple: "violet",
  pink: "rose",
  teal: "sarcelle",
  yellow: "jaune",
};

/** A source's identity color: its manual override if set, otherwise the hue
 *  at its position in add-order (id ascending, matching how `sources::list`
 *  already orders rows), cycling through the 5 categorical hues. */
function resolveSourceColorKey(sources: Source[], source: Source): string {
  if (source.color_key) return source.color_key;
  const sorted = [...sources].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex((s) => s.id === source.id);
  return SOURCE_HUE_CYCLE[idx % SOURCE_HUE_CYCLE.length];
}

type StatusTone = "success" | "danger" | "info" | "neutral";

interface StatusMeta {
  label: string;
  color: string;
  tone: StatusTone;
}

/** `tone` drives the badge background in inspectorHtml (audit-ref, réf. shadcn Badge "Custom
 * Colors" : fond teinté par état plutôt que fond neutre + texte teinté seul). `color` reste
 * utilisé tel quel pour le point de statut de rowHtml (pas un badge, juste une puce). */
/** Sources dont le dernier scan a échoué, par id, avec la raison — alimenté par l'événement
 *  `scan:failed` (voir `installScanFailureWatch`). Vidé pour une source dès qu'un scan réussit,
 *  ce qui se voit à son `pending_count` qui repart ou, plus sûrement, au rescan explicite.
 *
 *  Impasse A4 (issue #15) : sans cette table, un scan qui n'a jamais tourné laissait la source à
 *  `pending_count = 0`, indiscernable d'un dossier réellement à jour — et peint en vert. */
const scanFailures = new Map<number, string>();

/** Enregistre l'échec d'un scan et repeint. Appelé par le wiring live au boot. */
export function noteScanFailure(sourceId: number, reason: string): void {
  scanFailures.set(sourceId, reason);
  void renderHomeSources();
}

function statusMeta(s: Source): StatusMeta {
  if (!s.accessible) return { label: "Inaccessible", color: "var(--color-text-danger)", tone: "danger" };
  // AVANT le test de `pending_count` : un scan tombé peut très bien laisser des pistes en attente
  // d'un passage précédent, et afficher « 3 nouveaux » masquerait le fait que la liste n'est plus
  // tenue à jour. L'échec est la chose la plus vraie qu'on sache de cette source.
  if (scanFailures.has(s.id))
    return { label: "Scan en échec", color: "var(--color-text-danger)", tone: "danger" };
  if (s.pending_count > 0) return { label: `${s.pending_count} nouveau${s.pending_count > 1 ? "x" : ""}`, color: "var(--color-text-info)", tone: "info" };
  if (!s.watched) return { label: "En pause", color: "var(--color-text-tertiary)", tone: "neutral" };
  return { label: "À jour", color: "var(--color-text-success)", tone: "success" };
}

function rowHtml(s: Source, active: boolean, allSources: Source[]): string {
  const sm = statusMeta(s);
  const hue = resolveSourceColorKey(allSources, s);
  return (
    `<div class="qi${active ? " cur" : ""}" data-sift="homerow" data-id="${s.id}" tabindex="0" role="button" aria-pressed="${active}" style="flex-direction:column;align-items:stretch;gap:3px;height:auto;padding:8px 9px">` +
    `<span style="display:flex;align-items:center;gap:6px;font-size:var(--text-lg);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
    `<span class="sift-src-dot sift-src-dot-${hue}" aria-hidden="true"></span>${esc(baseName(s.path))}</span>` +
    `<span style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);color:${sm.color}"><span style="width:5px;height:5px;border-radius:999px;background:${sm.color};flex:none"></span>${esc(sm.label)}</span>` +
    `</div>`
  );
}

function listColumnHtml(sources: Source[]): string {
  // Total morceaux prêts à revoir, toutes sources confondues — le pont Accueil→Revue : quand il
  // y en a, un CTA compteur mène droit à la Revue (sinon rien, l'Accueil reste un écran de config).
  const pending = sources.reduce((n, s) => n + s.pending_count, 0);
  const revueCta = pending
    ? `<button data-sift="gotorevue" class="sift-home-cta-revue" style="display:inline-flex;align-items:center;gap:6px;background:var(--color-background-success);color:var(--color-text-success);font-weight:600;font-size:var(--text-sm);padding:5px 12px;border-radius:var(--border-radius-pill)">Revoir ${pending} morceau${pending > 1 ? "x" : ""} <i class="ti ti-arrow-right" style="font-size:var(--text-base);vertical-align:-2px"></i></button>`
    : "";
  const header =
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px 11px">` +
    `<span style="font-size:var(--text-lg);font-weight:600">Sources <span style="font-family:var(--font-mono);font-weight:400;font-size:var(--text-sm);color:var(--color-text-tertiary)">${sources.length}</span></span>` +
    revueCta +
    `</div>`;
  // Compact inline hint, not the shared emptyStateHtml() component — that one is scaled for a
  // whole dead-end screen (title+note, full height); here the header ("Sources") and the "+
  // Ajouter un dossier" bar stay visible and functional around it, a different scale of "empty".
  // The hint text points at that bar explicitly (audit UX 2026-07-10: a bare sentence with no
  // guidance, even though the action is right below) rather than switching to the bigger component.
  const rows = sources.length
    ? sources.map((s) => rowHtml(s, s.id === selectedSourceId, sources)).join("")
    : `<div class="sift-list-empty-hint">Aucun dossier surveillé — ajoute-en un ci-dessous.</div>`;
  const bottomBar =
    `<div style="flex:none;border-top:0.5px solid var(--color-border-tertiary);margin-top:8px;padding-top:8px">` +
    `<button data-sift="addsrc" class="sift-home-cta-add" style="width:100%;background:var(--color-background-info);color:var(--color-text-info);font-weight:600"><i class="ti ti-plus" style="font-size:var(--text-base);vertical-align:-2px"></i> Ajouter un dossier</button>` +
    `</div>`;
  return header + `<div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px">${rows}</div>` + bottomBar;
}

/** Texte d'attente de la colonne détail quand rien n'est sélectionné. Partagé avec le
 *  placeholder de chargement (renderHomeSources) : sur une liste vide, listSources() résolu
 *  repeint la même ligne (au bandeau racine près), donc pas de saut de contenu. */
const INSPECTOR_HINT_NO_SELECTION = "Sélectionne un dossier surveillé pour voir son détail.";

/** Colonne détail réduite à une ligne d'aide — pas de sélection, chargement en cours, ou échec
 *  du chargement. `hint` et `lead` sont des littéraux de ce module (jamais de donnée utilisateur),
 *  et l'enveloppe est celle du détail complet pour que #homeinspector — la colonne large,
 *  `.sift-inspector{flex:1}` (styles.css:343), sans fond ni bordure — ne soit jamais un canevas nu. */
function inspectorHintHtml(hint: string, lead = ""): string {
  return (
    `<div class="sift-screen-stack" style="flex:1;overflow-y:auto;padding:20px 30px">` +
    lead +
    `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">${hint}</div>` +
    `</div>`
  );
}

function inspectorHtml(selected: Source | null, root: string | null, allSources: Source[]): string {
  const rootGateHtml = root || rootGateDismissed
    ? ""
    : '<div class="sift-ui-card-soft sift-ui-card-soft-pad sift-home-warning">' +
      '<i class="ti ti-alert-triangle" style="font-size:var(--text-lg);flex:none"></i>' +
      "<span><strong>Racine de bibliothèque non définie</strong> — les dossiers surveillés restent scannés, mais la conversion sera bloquée tant qu'aucune racine n'est choisie. " +
      '<button data-sift="gotoreglages" style="color:var(--color-text-warning);text-decoration:underline;padding:0;font:inherit"><i class="ti ti-arrow-right"></i> Ouvrir Réglages</button></span>' +
      '<button data-sift="dismiss-rootgate" class="lk-icon" title="Masquer pour cette session" aria-label="Masquer ce message pour cette session" style="flex:none;background:none;border:none;color:var(--color-text-warning);cursor:pointer;padding:0 0 0 8px"><i class="ti ti-x"></i></button></div>';

  if (!selected) {
    return inspectorHintHtml(INSPECTOR_HINT_NO_SELECTION, rootGateHtml);
  }

  const sm = statusMeta(selected);
  const name = esc(baseName(selected.path));
  const watchOn = selected.watched;

  return (
    `<div class="sift-screen-stack" style="flex:1;overflow-y:auto;padding:20px 30px">` +
    `<nav aria-label="breadcrumb" style="font-size:var(--text-sm);color:var(--color-text-tertiary);margin-bottom:20px">Accueil <span aria-hidden="true" style="color:var(--color-text-tertiary);margin:0 3px">›</span> <span aria-current="page" style="color:var(--color-text-primary)">${name}</span></nav>` +
    rootGateHtml +
    `<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">` +
    `<div style="font-size:var(--text-xl);font-weight:600">${name}</div>` +
    `<span class="sift-home-status-badge sift-home-status-badge-${sm.tone}">${esc(sm.label)}</span>` +
    `</div>` +
    `<div class="sift-ui-card-soft sift-ui-card-soft-pad sift-home-source-path">` +
    `<div style="font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--color-text-tertiary);margin-bottom:6px">Dossier surveillé</div>` +
    `<div class="sift-home-source-path-value">${esc(selected.path)}</div>` +
    (selected.accessible
      ? ""
      : `<div style="margin-top:8px;font-size:var(--text-sm);color:var(--color-text-danger)"><i class="ti ti-alert-triangle" style="vertical-align:-1px"></i> Dossier inaccessible.</div>`) +
    `</div>` +
    `<div class="sift-ui-card-toolbar">` +
    `<span style="font-size:var(--text-sm);color:var(--color-text-tertiary)">Couleur</span>` +
    SOURCE_HUE_CYCLE.map((hue) => {
      const on = resolveSourceColorKey(allSources, selected) === hue;
      const label = SOURCE_HUE_LABEL_FR[hue];
      return `<button data-sift="setsrccolor" data-id="${selected.id}" data-hue="${hue}" title="Couleur ${label}" aria-label="Couleur ${label}" aria-pressed="${on}" class="sift-src-swatch sift-src-swatch-${hue}${on ? " on" : ""}"></button>`;
    }).join("") +
    `</div>` +
    `<div class="sift-ui-card-actions">` +
    `<div data-sift="togglewatch" data-id="${selected.id}" data-watched="${watchOn ? "1" : "0"}" tabindex="0" role="checkbox" aria-checked="${watchOn}" class="sift-home-watch-toggle sift-ui-card-actions-main">` +
    `<span class="sift-home-watch-toggle-box"><i class="ti ti-check" aria-hidden="true"></i></span>` +
    `Surveiller ce dossier</div>` +
    `<button data-sift="rescansrc" data-id="${selected.id}"><i class="ti ti-refresh" style="font-size:var(--text-md);vertical-align:-2px"></i> Rescanner</button>` +
    `<button data-sift="rmsrc" data-id="${selected.id}" style="color:var(--color-text-danger)"><i class="ti ti-trash" style="font-size:var(--text-md);vertical-align:-2px"></i> Retirer</button>` +
    `</div>` +
    `</div>`
  );
}

/** Replaces the Home shell's two columns (#homequeue list rail, #homeinspector detail)
 * with the real watched sources + selection detail + library-root warning. */
export async function renderHomeSources() {
  // Auto-guard (mirror of renderQueue's `if (!ql) return`): the shell only exists while the
  // Home view is mounted — no-op cleanly instead of throwing, so a blind refresh() from any
  // view skips Home safely.
  const queueCol = document.querySelector<HTMLElement>("#homequeue");
  const inspectorCol = document.querySelector<HTMLElement>("#homeinspector");
  if (!queueCol || !inspectorCol) return;

  // Accueil est le premier écran peint (app.js:22 : `var view="home"`) et app.js:106 recrée les
  // deux colonnes VIDES à chaque passage sur Accueil — sans signal, les deux restent littéralement
  // vides le temps du round-trip listSources(), et l'absence de contenu se lit comme une panne
  // (Apple HIG § Loading : « Show something as soon as possible »). Même « Chargement… » que
  // renderQueue() (queue-panel.ts) sur le rail jumeau #ql, et côté #homeinspector la ligne d'aide
  // « pas de sélection » plutôt qu'un second spinner (deux animations simultanées pour un seul
  // chargement) : la colonne large porte un texte, pas un canevas nu.
  //
  // Le marqueur du garde couvre le contenu réellement peint (la barre « + Ajouter un dossier »,
  // toujours présente dans listColumnHtml, liste vide comprise) ET le placeholder lui-même —
  // équivalent du `!ql.childElementCount` de renderQueue (queue-panel.ts:422), où le placeholder
  // compte aussi comme contenu. Sans ce second marqueur, deux renderHomeSources() concurrents
  // pendant le round-trip (onQueueChanged, debounce 150 ms → refresh() → renderHomeSources() en
  // premier, sift-live.ts:513-517 et :164-165 ; scanner.rs pingue tous les 25 fichiers nets)
  // réécriraient le même markup, donc un nouveau <i class="sift-spin"> et une animation CSS
  // repartie à 0 deg — le spinner saccaderait pendant un scan de dossier. La carte d'erreur
  // ci-dessous ne porte exprès aucun des deux marqueurs : son « Réessayer » doit pouvoir
  // réafficher le spinner.
  //
  // Sans ce garde, chaque re-render — clic de ligne ([data-sift="homerow"]), bascule Surveiller
  // ([data-sift="togglewatch"]), retrait ([data-sift="rmsrc"]), et le refresh() déclenché par les
  // événements backend (sift-live.ts:165, seule voie par laquelle « Rescanner » repeint) —
  // blanchirait la liste avant de la repeindre alors que des données valides sont déjà à l'écran.
  //
  // La variante « peindre depuis le cache » de renderQueue (queue-panel.ts:377) ne s'applique PAS
  // ici : ce module ne garde aucune copie de `sources` en mémoire (seul selectedSourceId survit
  // aux re-renders), il n'y a donc rien à repeindre instantanément au retour sur Accueil.
  const alreadyRendered = !!queueCol.querySelector('[data-sift="addsrc"], [data-sift="srcloading"]');
  if (!alreadyRendered) {
    queueCol.innerHTML =
      '<div data-sift="srcloading" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);color:var(--color-text-tertiary);font-size:var(--text-md)">' +
      '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md)"></i> Chargement…</div>';
    inspectorCol.innerHTML = inspectorHintHtml(INSPECTOR_HINT_NO_SELECTION);
  }

  let sources: Source[] = [];
  try {
    sources = await listSources();
  } catch (e) {
    console.error("listSources failed", e);
    // Sortir sec laisserait le placeholder ci-dessus tourner indéfiniment : un spinner permanent
    // est un échec silencieux. Même carte d'erreur + « Réessayer » que renderEcartes()
    // (ecartes-view.ts), à la largeur du rail. L'inspecteur reçoit une ligne d'aide et non une
    // seconde carte rouge : l'échec et son action de reprise se disent une fois, dans le rail,
    // mais la colonne large ne peut pas rester muette pour toujours sur ce chemin.
    inspectorCol.innerHTML = inspectorHintHtml(
      "Détail indisponible : la liste des dossiers surveillés n'a pas pu être chargée.",
    );
    queueCol.innerHTML =
      '<div class="sift-ui-card-soft sift-ui-card-soft-pad" style="color:var(--color-text-danger)">' +
      "Impossible de charger les dossiers surveillés. Vérifie la connexion à la base et réessaie." +
      '<div style="margin-top:var(--space-8)"><button data-sift="retrysrc" style="font-size:var(--text-xs);color:var(--color-text-info)">Réessayer</button></div>' +
      "</div>";
    queueCol
      .querySelector<HTMLButtonElement>('[data-sift="retrysrc"]')
      ?.addEventListener("click", () => void renderHomeSources());
    return;
  }
  let root: string | null = null;
  try {
    root = await getSetting(LIBRARY_ROOT);
  } catch (e) {
    console.error("getSetting(library_root) failed", e);
  }

  if (selectedSourceId == null || !sources.some((s) => s.id === selectedSourceId)) {
    selectedSourceId = sources[0]?.id ?? null;
  }
  const selected = sources.find((s) => s.id === selectedSourceId) ?? null;

  queueCol.innerHTML = listColumnHtml(sources);
  inspectorCol.innerHTML = inspectorHtml(selected, root, sources);

  queueCol.querySelectorAll<HTMLElement>('[data-sift="homerow"]').forEach((row) => {
    row.addEventListener("click", () => {
      selectedSourceId = Number(row.dataset.id);
      void renderHomeSources();
    });
  });
  queueCol.querySelector('[data-sift="addsrc"]')?.addEventListener("click", () => {
    void pickAndAddFolder(renderHomeSources);
  });
  queueCol.querySelector('[data-sift="gotorevue"]')?.addEventListener("click", () => {
    document
      .querySelector('[data-view="revue"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  inspectorCol.querySelector('[data-sift="gotoreglages"]')?.addEventListener("click", () => {
    document
      .querySelector('[data-view="reglages"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const watchToggle = inspectorCol.querySelector<HTMLElement>('[data-sift="togglewatch"]');
  // Audit-ref C2 (Accueil, 2026-07-08) : role="checkbox" attend Enter/Espace, pas juste le clic —
  // installNavKeyboard (chrome.ts) ne couvre que [data-view]/homerow, pas cet élément.
  watchToggle?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    watchToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  watchToggle?.addEventListener("click", async (e) => {
    const el = e.currentTarget as HTMLElement;
    const id = Number(el.dataset.id);
    const next = el.dataset.watched !== "1";
    try {
      await setSourceWatched(id, next);
      await renderHomeSources();
    } catch (err) {
      toast(
        humanizeError(
          err,
          next
            ? "La surveillance n'a pas pu être activée sur ce dossier."
            : "La surveillance n'a pas pu être désactivée sur ce dossier.",
          "setSourceWatched",
        ),
      );
    }
  });
  inspectorCol.querySelector('[data-sift="rescansrc"]')?.addEventListener("click", async (e) => {
    const el = e.currentTarget as HTMLElement;
    const id = Number(el.dataset.id);
    // Optimiste : on retire l'échec AVANT de relancer, pour que la pastille rouge parte
    // immédiatement. Si le scan retombe, `scan:failed` la remet — c'est le backend qui a le
    // dernier mot, jamais cette ligne.
    scanFailures.delete(id);
    try {
      await rescanSource(id);
      await renderHomeSources();
    } catch (err) {
      toast(humanizeError(err, "Le rescan de ce dossier n'a pas démarré.", "rescanSource"));
    }
  });
  inspectorCol.querySelector('[data-sift="rmsrc"]')?.addEventListener("click", async (e) => {
    const el = e.currentTarget as HTMLElement;
    const id = Number(el.dataset.id);
    const ok = await confirmAction("Retirer ce dossier surveillé ?", "Retirer");
    if (!ok) return;
    try {
      await removeSource(id);
      if (selectedSourceId === id) selectedSourceId = null;
      await renderHomeSources();
    } catch (err) {
      // Le pire des quatre : la confirmation destructive a été ACCEPTÉE, la modale s'est fermée,
      // et la ligne est toujours là. Sans ce toast l'utilisateur lit ça comme « le clic n'a pas
      // pris » et recommence.
      toast(humanizeError(err, "Ce dossier surveillé n'a pas pu être retiré.", "removeSource"));
    }
  });
}

/** Open the OS folder picker, add the chosen folder as a watched source, then `onChange`
 * (the caller's refresh). Kept out of sift-live so the picker has no app-state dependency. */
export async function pickAndAddFolder(onChange: () => void | Promise<void>) {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir === "string") {
    try {
      const added = await addSource(dir);
      selectedSourceId = added.id;
      await onChange();
    } catch (e) {
      // Le mensonge type de l'inventaire A3 : le sélecteur se ferme, et la liste continue
      // d'afficher « Aucun dossier surveillé — ajoute-en un ci-dessous. » sur un dossier qu'on
      // vient justement d'ajouter. Un écran vide et un écran cassé se ressemblent.
      toast(humanizeError(e, `« ${baseName(dir)} » n'a pas pu être ajouté.`, "addSource"));
    }
  }
}
