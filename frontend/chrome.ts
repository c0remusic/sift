// App chrome (Tauri only): custom titlebar, the "lean" stylesheet that hides the mockup's
// not-yet-real surfaces, scroll-thumb autohide, and OS drag-drop. Extracted from sift-live.ts
// (audit P-3) — self-contained UI shell, no shared app state; imports only Tauri + ipc + toast
// (the drop handler acknowledges what the backend actually imported, see reportImport below).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { importPaths } from "./ipc";
import { toast } from "./filing-toast";

// One-time style: while dragging, an existing zone gets an outline + an overlaid hint
// (::after with the zone's data-dz text). No permanent dashed box — the hint shows only
// during a drag, on the real folder/queue boxes, saving space.
function ensureDropStyle() {
  if (document.getElementById("sift-dz-style")) return;
  const s = document.createElement("style");
  s.id = "sift-dz-style";
  s.textContent =
    ".sift-dz-on{position:relative;outline:1.5px dashed var(--color-text-info);outline-offset:-4px;border-radius:var(--border-radius-md)}" +
    ".sift-dz-on::after{content:attr(data-dz);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;font-size:var(--text-sm);color:var(--color-text-info);background:var(--overlay-drop);border-radius:var(--border-radius-md);pointer-events:none;z-index:50}";
  document.head.appendChild(s);
}

// Existing boxes that double as drop targets, with the hint each shows while dragging.
// "#filfoot" is the action rail carrying the Destination button (the tree itself is a popover,
// hidden by default, so it can't be a reliable drop target) — a folder dropped on the rail
// registers as the new destination.
const DROP_ZONES: [string, string][] = [
  ["#filfoot", "Dépose un dossier ici — nouvelle destination"],
  ["#ql", "Dépose des fichiers audio ici"],
  ["#sift-sources", "Dépose un dossier à surveiller"],
];

/** Toggle the drag hint/outline on the relevant existing boxes. Falls back to #content
 * (e.g. Bibliothèque) when none of the named zones are on screen.
 * Idempotent by construction: "over" fires continuously while the pointer moves (dozens of
 * calls per second), so the wanted set is computed first and compared to what is already
 * marked — identical state returns without touching a single class. Only a real change
 * mutates the DOM, and it does so with plain class/attribute writes (the .sift-dz-on CSS has
 * no transition), so the hint still appears and disappears instantly. */
function setDropActive(on: boolean) {
  ensureDropStyle();
  const wanted: [HTMLElement, string][] = [];
  if (on) {
    const present = DROP_ZONES.filter(([sel]) => document.querySelector(sel));
    const targets: [string, string][] = present.length
      ? present
      : [["#content", "Dépose des fichiers (→ file d'attente) ou des dossiers (→ surveillés)"]];
    for (const [sel, label] of targets) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) wanted.push([el, label]);
    }
  }
  const current = document.querySelectorAll<HTMLElement>(".sift-dz-on");
  if (
    current.length === wanted.length &&
    wanted.every(([el, label]) => el.classList.contains("sift-dz-on") && el.dataset.dz === label)
  )
    return;
  current.forEach((el) => {
    el.classList.remove("sift-dz-on");
    el.removeAttribute("data-dz");
  });
  for (const [el, label] of wanted) {
    el.classList.add("sift-dz-on");
    el.dataset.dz = label;
  }
}

/** "dest" when the cursor is over the bins column (#fldz), else "source". Tauri 2 emits the
 * drop position already in logical (CSS) pixels — exactly what elementFromPoint expects, so
 * no devicePixelRatio correction (dividing here double-corrected on HiDPI/scaled displays). */
function dropModeAt(pos: { x: number; y: number }): "source" | "dest" {
  const el = document.elementFromPoint(pos.x, pos.y);
  return el && el.closest("#filfoot") ? "dest" : "source";
}

/** Acknowledge a drop with what the backend ACTUALLY took in — never p.paths.length, which
 * counts what was dropped, not what was imported: ipc.rs keeps a file only if scanner::is_audio
 * accepts it and add_loose_file really added it, and in "dest" mode a folder counts only when
 * LIBRARY_ROOT is set (otherwise folders_added stays 0 with no error). Five .txt files dropped
 * must read "rien d'importable", not "5 reçus". Wording follows the backend's own split:
 * morceaux (files) vs dossiers (folders), never a merged "éléments". */
function reportImport(res: { files_added: number; folders_added: number }): void {
  const { files_added, folders_added } = res;
  if (!files_added && !folders_added) {
    toast("Rien d'importable dans ce dépôt");
    return;
  }
  const parts: string[] = [];
  if (files_added) parts.push(`${files_added} morceau${files_added > 1 ? "x" : ""}`);
  if (folders_added) parts.push(`${folders_added} dossier${folders_added > 1 ? "s" : ""}`);
  const plural = files_added + folders_added > 1 ? "s" : "";
  toast(`${parts.join(" et ")} ajouté${plural}`);
}

/** OS drag-drop: audio files → queue; folders → watched source, or a destination bin when
 * dropped on the "Où on va" column. */
export async function installDragDrop() {
  try {
    await getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "drop") {
        setDropActive(false);
        if (p.paths.length)
          void importPaths(p.paths, dropModeAt(p.position))
            .then(reportImport)
            .catch((e) => {
              console.error("import_paths failed", e);
              toast("Échec de l'import");
            });
      } else if (p.type === "enter" || p.type === "over") {
        setDropActive(true);
      } else {
        setDropActive(false);
      }
    });
  } catch (e) {
    console.error("drag-drop init failed", e);
  }
}

/** Lean Tauri UI: hide the mockup's not-yet-real surfaces (nav tabs + Revue toggles) so the
 * app shows only what actually works — Accueil (sources) and Revue (queue/report/filing).
 * Injected once; the demo (plain browser) never runs this, so its full mockup is untouched. */
export function injectLeanStyle() {
  if (document.getElementById("sift-lean-style")) return;
  const st = document.createElement("style");
  st.id = "sift-lean-style";
  st.textContent =
    // landing/demo copy in index.html: marketing pitch, demo disclaimer, feature cards row
    ".pitch,.sub,.frow{display:none!important}" +
    // Rekordbox/Clé USB nav items: both have real screens now — no longer hidden. Rekordbox since
    // 2026-07-02 (rekordbox-view.ts), Clé USB since 2026-07-31 (usb-view.ts).
    // Revue's batch mode + "traités" toggle ARE wired for real now (2026-07-08:
    // ensureReviewSeg()/ensureQueueDoneToggle() in sift-live.ts) — just under different DOM
    // (data-sift="reviewmode", #sift-qdone-toggle) than app.js's own mock attributes below, which
    // this rule hides since the mock's copy is otherwise never overwritten by the live render.
    '[data-act="revmode"],[data-act="togglequeue"]{display:none!important}' +
    // custom frameless titlebar (decorations are off in tauri.conf — Tauri only). Two REAL DOM
    // zones (not a linear-gradient background trick, which can show a soft sub-pixel seam): the
    // left zone is the nav rail's own width/tone (152px, matching .sb below it) so the titlebar
    // reads as a continuation of the nav column, the right zone is the content tone. The vertical
    // border between them is the same border-right the nav rail uses, so the line runs unbroken
    // from the titlebar straight into .sb (no horizontal line is added anywhere in this bar).
    "#sift-titlebar{height:30px;flex:none;display:flex;align-items:stretch;" +
    "background:var(--color-background-primary);-webkit-user-select:none;user-select:none}" +
    "#sift-tb-left{width:152px;flex:none;display:flex;align-items:center;" +
    "background:var(--color-background-tertiary);border-right:0.5px solid var(--color-border-tertiary)}" +
    "#sift-tb-right{flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between}" +
    "#sift-tb-title{padding-left:13px;font-size:var(--text-sm);letter-spacing:.04em;color:var(--color-text-tertiary);" +
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}" +
    "#sift-tb-controls{display:flex;height:100%}" +
    ".sift-win{width:44px;height:100%;display:flex;align-items:center;justify-content:center;border:none;" +
    "background:transparent;color:var(--color-text-tertiary);cursor:pointer;border-radius:0;padding:0}" +
    ".sift-win:hover{background:var(--color-background-secondary);color:var(--color-text-primary)}" +
    ".sift-win-close:hover{background:#e81123;color:#fff}.sift-win i{font-size:15px}" +
    // macOS: 3 small round traffic lights on the left instead of square right-aligned buttons.
    // Reuses the same buttons/click-wiring; only placement (markup order) and this styling differ.
    // The controls move into the left (nav-tone) zone, the title stays alone in the right zone.
    ".sift-tb-mac #sift-tb-left{justify-content:flex-start;gap:8px;padding-left:12px}" +
    ".sift-tb-mac #sift-tb-right{justify-content:flex-start}" +
    ".sift-tb-mac #sift-tb-title{padding-left:12px}" +
    ".sift-tb-mac .sift-win{width:12px;height:12px;border-radius:50%;color:transparent;font-size:0}" +
    ".sift-tb-mac .sift-win:hover{color:inherit;font-size:8px}" +
    '.sift-tb-mac .sift-win[data-win="close"]{background:var(--color-text-danger)}' +
    '.sift-tb-mac .sift-win[data-win="min"]{background:var(--color-text-warning)}' +
    '.sift-tb-mac .sift-win[data-win="max"]{background:var(--color-text-success)}' +
    ".sift-tb-mac .sift-win-close:hover{background:var(--color-text-danger)}" +
    // make room for the 30px bar: shrink the app shell so nothing is clipped
    "#pa{height:calc(100vh - 30px)!important}";
  document.head.appendChild(st);
}

/** Bascule le title/aria-label du bouton "Agrandir" selon l'état maximisé courant — l'icône
 * reste volontairement identique (ti-square) dans les deux états. */
function syncMaxButton(btn: HTMLElement, maximized: boolean): void {
  const label = maximized ? "Restaurer" : "Agrandir";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

/** Inject the custom window titlebar (the native one is off via decorations:false) and wire
 * its minimise / maximise / close buttons. The bar + its title are drag regions. macOS gets
 * traffic lights on the left (sift-tb-mac class); everyone else keeps today's right-aligned
 * layout — same markup order, so the non-mac branch renders byte-identical to before. */
export async function injectTitlebar(): Promise<void> {
  if (document.getElementById("sift-titlebar")) return;

  let isMac = false;
  try {
    isMac = platform() === "macos";
  } catch (e) {
    console.error("platform() failed, defaulting to the Windows titlebar layout", e);
  }

  const bar = document.createElement("div");
  bar.id = "sift-titlebar";
  if (isMac) bar.classList.add("sift-tb-mac");
  bar.setAttribute("data-tauri-drag-region", "");
  const title = '<span id="sift-tb-title" data-tauri-drag-region title="Sift">Sift</span>';
  const controls =
    '<div id="sift-tb-controls">' +
    '<button class="sift-win" data-win="min" title="Réduire" aria-label="Réduire"><i class="ti ti-minus"></i></button>' +
    '<button class="sift-win" data-win="max" title="Agrandir" aria-label="Agrandir"><i class="ti ti-square"></i></button>' +
    '<button class="sift-win sift-win-close" data-win="close" title="Fermer" aria-label="Fermer"><i class="ti ti-x"></i></button>' +
    "</div>";
  // Two real zones (left = nav width/tone, right = content tone — see injectLeanStyle's CSS
  // comment for why this is DOM, not a gradient). Windows: title + controls both live in the
  // right zone (space-between keeps today's layout, just shifted right by 152px). macOS: the
  // traffic-light controls move into the left zone, the title stays alone in the right zone.
  const left = `<div id="sift-tb-left" data-tauri-drag-region>${isMac ? controls : ""}</div>`;
  const right = `<div id="sift-tb-right" data-tauri-drag-region>${title}${isMac ? "" : controls}</div>`;
  bar.innerHTML = left + right;
  document.body.insertBefore(bar, document.body.firstChild);

  const w = getCurrentWindow();
  // On Windows 11, an undecorated window gets its shadow enabled by default, which draws as a
  // 1px light border with rounded corners around the whole window (annotation: "il semble y
  // avoir un cadre ou une bordure le long de la fenetre") — this app already draws its own
  // rounded/transparent frame via body:has(#sift-titlebar), so the native shadow is redundant.
  // `void` sur cette promesse a masqué le défaut pendant tout ce temps : la permission
  // `core:window:allow-set-shadow` manquait de `capabilities/default.json`, l'appel était rejeté
  // à CHAQUE démarrage, et le rejet non géré ne se lisait que dans le log de `tauri dev`. Le
  // correctif ci-dessus n'avait donc jamais pris effet — la bordure était toujours là. Permission
  // ajoutée le 2026-08-05 ; l'échec est désormais bruyant, conformément au « pas de fallback
  // silencieux » du projet.
  w.setShadow(false).catch((e: unknown) => {
    console.error("setShadow(false) refusé — la bordure native restera visible :", e);
  });
  const maxBtn = bar.querySelector<HTMLElement>('[data-win="max"]');

  bar.querySelectorAll<HTMLElement>(".sift-win").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.win;
      if (act === "min") void w.minimize();
      else if (act === "max") void w.toggleMaximize();
      else if (act === "close") void w.close();
    }),
  );

  if (maxBtn) {
    try {
      syncMaxButton(maxBtn, await w.isMaximized());
      await w.onResized(() => {
        void w.isMaximized().then((m) => syncMaxButton(maxBtn, m));
      });
    } catch (e) {
      console.error("maximize-state sync failed, keeping the default Agrandir icon", e);
    }
  }
}

/** Audit-ref C3 (Accueil, 2026-07-08, réf. shadcn Sidebar) : `.nv`/`[data-view]` sont des `<div>`
 * cliquables sans équivalent clavier — `app.js` (importé sans garde `inTauri`, main.ts:6) gère déjà
 * le clic réel (`e.target.closest('[data-view]')`) mais n'écoute que "click". Complète en Enter/
 * Espace sans toucher app.js (figé) : redispatche un clic synthétique sur l'élément focus. Couvre
 * aussi les lignes `.qi[data-sift="homerow"]` (home-sources.ts), l'arbre de destination
 * `[data-fil="bin"]` (audit-ref R4, Revue, filing.ts) et les facettes/lignes Bibliothèque
 * `[data-bib="pick"]`/`[data-bib="row"]` (audit-ref B1) et la ligne de sélection réparations
 * master.db `[data-sift="mdbpick"]` (audit-ref G3, Rekordbox) — mêmes `tabindex`+`role` posés côté
 * markup, un seul point de câblage clavier générique pour toute nouvelle ligne de ce type. Étendu le
 * 2026-07-24 (audit UX/accessibilité) aux lignes de sélection Lot `[data-sift="batchpick"]`/
 * `[data-sift="batchpickfake"]` (batch-panel.ts), même défaut que mdbpick avant son fix. */
export function installNavKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    // .lr (audit-ref B1) nests a real <button> (lecture) — if THAT has focus, its own native Enter/
    // Space handling must fire alone; closest() would otherwise also match the ancestor row and
    // double-fire (play the track AND toggle the detail panel from one keypress).
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(target?.tagName ?? "")) return;
    const el = target?.closest<HTMLElement>(
      '[data-view][tabindex],[data-sift="homerow"][tabindex],[data-fil="bin"][tabindex],[data-bib="pick"][tabindex],[data-bib="row"][tabindex],[data-sift="mdbpick"][tabindex],[data-bib="tile"][tabindex],[data-sift="batchpick"][tabindex],[data-sift="batchpickfake"][tabindex]',
    );
    if (!el) return;
    e.preventDefault();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Reveal a scroll area's thumb while it scrolls, then hide it ~700ms after it stops (the
 * CSS keeps it hidden at rest). Capture-phase so it catches scrolling on any inner element. */
export function installScrollAutohide() {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      el.classList.add("sift-scrolling");
      const prev = timers.get(el);
      if (prev) clearTimeout(prev);
      timers.set(
        el,
        setTimeout(() => el.classList.remove("sift-scrolling"), 700),
      );
    },
    true,
  );
}
