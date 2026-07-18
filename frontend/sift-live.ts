// Live data wiring — ACTIVE ONLY inside the Tauri app. In a plain browser the hooks
// below are never installed, so app.js keeps its mockup (Vercel demo unaffected).
import {
  removeSource,
  onFileDone,
  onFileProgress,
  onQueueChanged,
  onAnalysisChanged,
  analysisProgress,
  setSourceWatched,
  setSourceColor,
  trashTrack,
  restoreTrack,
  requeueTrack,
  purgeTrash,
  openUrl,
  scanLibraryDuplicates,
  exportRekordboxXml,
  linkRekordboxXml,
  rekordboxStatus,
} from "./ipc";
import { installUndoShortcut, installFilingKeys } from "./filing";
import { refreshBinsForBatch } from "./filing-bins";
import { confirmAction } from "./confirm-modal";
// Views/chrome extracted from this god-module (audit P-3) — kept stateless, wired here.
import { renderEcartes } from "./ecartes-view";
import { renderHomeSources, pickAndAddFolder, dismissRootGate } from "./home-sources";
import { installDragDrop, injectLeanStyle, injectTitlebar, installScrollAutohide, installNavKeyboard } from "./chrome";
import { initTheme } from "./theme";
import { renderReglagesLive } from "./reglages-view";
import { requireEl, toast } from "./dom";
import type { LibrarySortState } from "./library-views";
import {
  bibState,
  bibDup,
  renderBiblioLive,
  openBiblioDetail,
  positionFacetThumb,
  positionViewModeThumb,
} from "./bibliotheque-view";
import { renderRekordboxLive, handleRekordboxAction } from "./rekordbox-view";
import {
  currentItems,
  setReviewModeRaw,
  enterDetailMode,
  ensureReviewSeg,
  registerBatchRenderer,
  renderQueue,
  updateRevueBadge,
  handleQueueItemClick,
  installQueueNavKeys,
} from "./queue-panel";
import {
  renderBatch,
  batchGroupCap,
  BATCH_GROUP_PAGE,
  batchBin,
  batchInPlace,
  onBatchBinPick,
  handleBatchAction,
  pushFileProgress,
  onFileStop,
  onFileBatchDone,
  registerRefreshHook,
  onBatchInPlaceChange,
} from "./batch-panel";
import { renderJournal } from "./journal";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";
import { setTask, clearTask, setCancelHandler } from "./progress-zone";

// Global progress zone — feed the "analyze" row from the EXISTING analysis poll/events (no engine
// rewrite). `analysis_progress` returns (done, total) over PENDING tracks; a track stays pending
// after it's analysed (until filed), so done==total is the RESTING state, not "busy". So we show
// the row only while done<total (actively analysing), then flash a brief 100% "done" before hiding.
let analyzeWasRunning = false;
let analyzeClearTimer: ReturnType<typeof setTimeout> | undefined;
async function pushAnalyzeProgress() {
  try {
    const p = await analysisProgress();
    if (p.total > 0 && p.done < p.total) {
      clearTimeout(analyzeClearTimer);
      analyzeWasRunning = true;
      setTask("analyze", { done: p.done, total: p.total, state: "running" });
    } else if (analyzeWasRunning) {
      // Reached done==total (or the queue drained): flash 100% then auto-hide the row.
      analyzeWasRunning = false;
      setTask("analyze", { done: p.total, total: p.total, state: "done" });
      clearTimeout(analyzeClearTimer);
      analyzeClearTimer = setTimeout(() => clearTask("analyze"), 1200);
    } else {
      clearTask("analyze");
    }
  } catch (e) {
    console.error("analysisProgress failed", e);
  }
}

/** Guards a single in-flight Rekordbox export run. */
let exportRunning = false;

/** Rekordbox export (real merge+rewrite via `export_rekordbox_xml`, called from the Rekordbox
 * page's "Réexporter maintenant" button — see renderRekordboxLive). The "Clé USB" nav item no
 * longer routes here (finding F5, audit-heuristique-visuel.md) — it now navigates straight to
 * the real "Formater une clé USB" card in Réglages instead of showing a dead-end explainer. */
async function runNavExport(): Promise<void> {
  if (exportRunning) return; // one export run at a time
  exportRunning = true;
  setTask("export", { done: 0, total: 1, state: "running" });
  try {
    const status = await exportRekordboxXml();
    setTask("export", { done: 1, total: 1, state: "done" });
    setTimeout(() => clearTask("export"), 1200);
    toast(
      `${status.track_count} pistes dans ${status.playlist_count} playlists Rekordbox — réimporte le XML dans Rekordbox pour resynchroniser.`,
    );
  } catch (e) {
    console.error("export_rekordbox_xml failed", e);
    setTask("export", { done: 0, total: 1, state: "error" });
    const msg = e instanceof Error ? e.message : String(e);
    toast(
      msg.includes("aucun XML")
        ? "Aucun XML Rekordbox lié — relie un fichier depuis la Bibliothèque"
        : `Export Rekordbox échoué : ${msg}`,
    );
  } finally {
    exportRunning = false;
  }
}

/** Switch between detail and batch review. On entering batch the #fldz tree becomes the destination
 * explorer (batch pick mode); on leaving we restore the per-track filing pane. Its "detail" branch
 * lives in queue-panel.ts as enterDetailMode() (queue-owned code only) — this function keeps the
 * "batch" branch, which touches batch-owned state (batchGroupCap, renderBatch) that queue-panel.ts
 * must never import (see the tranche 1b plan's Architecture section: a static import cycle would
 * otherwise result). batchGroupCap/BATCH_GROUP_PAGE/renderBatch/batchBin/onBatchBinPick now come
 * from batch-panel.ts (Phase 1, tranche 1c) instead of being local references. */
function setReviewMode(m: "detail" | "batch") {
  if (m === "batch") {
    setReviewModeRaw("batch");
    ensureReviewSeg();
    const fldz = requireEl("#fldz", "setReviewMode");
    // Fresh entry into batch mode starts each group at one page (Task 3b) — a prior session's
    // expanded caps shouldn't silently carry over and re-mount thousands of rows on re-entry.
    batchGroupCap.file = BATCH_GROUP_PAGE;
    batchGroupCap.fake = BATCH_GROUP_PAGE;
    batchGroupCap.readonly = BATCH_GROUP_PAGE;
    renderBatch();
    // Drive the #fldz tree in batch pick mode (loads bins, clicks set batchBin via onBatchBinPick).
    void refreshBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  } else {
    enterDetailMode();
  }
}

async function refresh() {
  await renderHomeSources();
  await renderQueue();
  updateRevueBadge(currentItems.length);
}

export function installLiveWiring() {
  registerBatchRenderer(renderBatch);
  registerRefreshHook(refresh);
  window.__siftHome = renderHomeSources;
  window.__siftQueue = renderQueue;
  window.__siftEcarts = renderEcartes;
  window.__siftReglages = () => void renderReglagesLive();
  window.__siftBiblio = () => void renderBiblioLive();
  window.__siftJournal = () => void renderJournal();
  window.__siftRkb = () => void renderRekordboxLive();
  injectLeanStyle();
  void injectTitlebar();
  void initTheme();
  installUndoShortcut();
  installFilingKeys();
  installQueueNavKeys();
  installScrollAutohide();
  installNavKeyboard();
  void installDragDrop();

  // Nav "Clé USB" has no screen of its own — the real "Formater une clé USB" card lives inside
  // Réglages (reglages-view.ts, #sift-reglages-usb). Capture phase so this runs BEFORE app.js's
  // own bubble-phase `#pa` listener (registered first, at import time) can switch `view` to its
  // mock screen; stopPropagation() during capture halts that path. Instead of the previous
  // dead-end explainer toast (finding F5, audit-heuristique-visuel.md), redirect the click to the
  // real Réglages nav item so app.js's normal router takes over, then scroll the USB card into
  // view once it's rendered.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>('[data-view="cle"]');
      if (!exp) return;
      e.stopPropagation();
      const reglagesNav = document.querySelector<HTMLElement>('[data-view="reglages"]');
      reglagesNav?.click();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById("sift-reglages-usb")?.scrollIntoView({ block: "start" });
        });
      });
    },
    { capture: true },
  );

  requireEl("#pa", "installLiveWiring").addEventListener("click", (e) => {
    // queue item → open the live filing pane (report + editor + actions) in #mid
    const qi = (e.target as HTMLElement).closest<HTMLElement>(".qi[data-id]");
    if (qi?.dataset.id) {
      handleQueueItemClick(qi, e);
      return;
    }
    // Écartés actions (copy query / send-to-bin / restore / empty bin)
    const ec = (e.target as HTMLElement).closest<HTMLElement>("[data-ec]");
    if (ec) {
      e.stopPropagation();
      const act = ec.dataset.ec;
      const id = Number(ec.dataset.id);
      if (act === "copy-query") {
        void navigator.clipboard.writeText(ec.dataset.q || "").catch(() => {});
        const prev = ec.innerHTML;
        ec.innerHTML = '<i class="ti ti-check" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copié';
        setTimeout(() => {
          ec.innerHTML = prev;
        }, 1200);
      } else if (act === "trash") {
        void trashTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("trash failed", err);
            toast("Échec : impossible d'envoyer à la corbeille");
          });
      } else if (act === "restore") {
        void restoreTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("restore failed", err);
            toast("Échec : restauration impossible");
          });
      } else if (act === "requeue") {
        void requeueTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("requeue failed", err);
            toast("Échec : remise en file impossible");
          });
      } else if (act === "purge") {
        void confirmAction(
          "Purger définitivement la corbeille ? Cette action est irréversible.",
          "Purger",
        ).then((ok) => {
          if (!ok) return;
          void purgeTrash()
            .then(renderEcartes)
            .catch((err) => {
              console.error("purge failed", err);
              toast("Échec : purge de la corbeille impossible");
            });
        });
      } else if (act === "store") {
        void openUrl(decodeURIComponent(ec.dataset.url || "")).catch((err) =>
          console.error("open_url failed", err),
        );
      }
      return;
    }
    // Bibliothèque actions (quality chips / facet toggle / folder|genre pick / Discogs link / play)
    const bibEl = (e.target as HTMLElement).closest<HTMLElement>("[data-bib]");
    if (bibEl) {
      const act = bibEl.dataset.bib;
      if (act === "stat") {
        const stat = bibEl.dataset.stat;
        if (stat === "all") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = undefined;
        } else if (stat === "lossless" || stat === "mp3") {
          bibState.filter.quality = stat;
          bibState.filter.verdict = undefined;
        } else if (stat === "duplicates") {
          bibDup.shown = !bibDup.shown;
          if (bibDup.shown && bibDup.groups === null) {
            bibDup.loading = true;
            void renderBiblioLive();
            void scanLibraryDuplicates()
              .then((groups) => {
                bibDup.groups = groups;
              })
              .catch((e) => {
                console.error("scan_library_duplicates failed", e);
                bibDup.groups = [];
              })
              .finally(() => {
                bibDup.loading = false;
                void renderBiblioLive();
              });
            return;
          }
        } else if (stat === "fake") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = "fake";
        }
        void renderBiblioLive();
        return;
      } else if (act === "rkblink") {
        void (async () => {
          try {
            let defaultPath: string | undefined;
            try {
              const current = await rekordboxStatus();
              if (current.path) defaultPath = await dirname(current.path);
            } catch (e) {
              console.error("rekordbox_status failed (defaultPath lookup)", e);
            }
            const chosen = await openFolderDialog({
              multiple: false,
              directory: false,
              defaultPath,
              filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
            });
            if (!chosen || Array.isArray(chosen)) return;
            const status = await linkRekordboxXml(chosen);
            toast(
              status.error
                ? "XML Rekordbox illisible — relie un autre fichier"
                : `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderRekordboxLive();
          } catch (e) {
            console.error("link_rekordbox_xml failed", e);
            toast("Liaison du XML Rekordbox échouée");
          }
        })();
        return;
      } else if (act === "qual") {
        const q = bibEl.dataset.q;
        bibState.filter.quality = q === "all" ? undefined : (q as "lossless" | "mp3");
        // "Tous" doit réellement tout montrer — sans ce reset, un filtre verdict=fake posé via le
        // stat-card "À re-sourcer" restait actif indéfiniment (cul-de-sac trouvé à l'audit 2026-07-09).
        if (q === "all") bibState.filter.verdict = undefined;
        void renderBiblioLive();
      } else if (act === "facet") {
        bibState.facet = bibEl.dataset.f === "genre" ? "genre" : "folder";
        // Toggle in place first (existing node, animates) — renderBiblioLive() is async (IPC),
        // so the browser paints this before the rebuild overwrites the DOM.
        document
          .querySelectorAll<HTMLElement>("#sift-bib-facet-seg [data-bib='facet']")
          .forEach((b) => b.classList.toggle("on", b.dataset.f === bibState.facet));
        positionFacetThumb();
        void renderBiblioLive();
      } else if (act === "viewmode") {
        bibState.viewMode = bibEl.dataset.mode === "grid" ? "grid" : "table";
        document
          .querySelectorAll<HTMLElement>("#sift-bib-viewmode-seg [data-bib='viewmode']")
          .forEach((b) => b.classList.toggle("on", b.dataset.mode === bibState.viewMode));
        positionViewModeThumb();
        void renderBiblioLive();
      } else if (act === "sort") {
        const field = bibEl.dataset.field as LibrarySortState["field"];
        bibState.sort =
          bibState.sort.field === field
            ? { field, dir: bibState.sort.dir === "asc" ? "desc" : "asc" }
            : { field, dir: "asc" };
        void renderBiblioLive();
      } else if (act === "pick") {
        const key = bibEl.dataset.key as "folder" | "genre" | "artist";
        const val = bibEl.dataset.val;
        // toggle off if re-clicking the active facet value
        const cur =
          key === "folder" ? bibState.filter.folder : key === "genre" ? bibState.filter.genre : bibState.filter.artist;
        const next = cur === val ? undefined : val;
        bibState.filter.folder = key === "folder" ? next : undefined;
        bibState.filter.genre = key === "genre" ? next : undefined;
        bibState.filter.artist = key === "artist" ? next : undefined;
        void renderBiblioLive();
      } else if (act === "link") {
        const rid = bibEl.dataset.rid;
        if (rid) void openUrl(`https://www.discogs.com/release/${rid}`);
      } else if (act === "play" || act === "row" || act === "identify" || act === "tile") {
        // Open the unified detail/edit panel (report + inline editor + identify + actions).
        openBiblioDetail(Number(bibEl.dataset.id));
      } else if (act === "dupscan") {
        bibDup.shown = !bibDup.shown;
        if (bibDup.shown && bibDup.groups === null) {
          bibDup.loading = true;
          void renderBiblioLive();
          void scanLibraryDuplicates()
            .then((groups) => {
              bibDup.groups = groups;
            })
            .catch((e) => {
              console.error("scan_library_duplicates failed", e);
              bibDup.groups = [];
            })
            .finally(() => {
              bibDup.loading = false;
              void renderBiblioLive();
            });
        } else {
          void renderBiblioLive();
        }
      } else if (act === "dupresolve") {
        const idx = Number(bibEl.dataset.idx);
        const group = bibDup.groups?.[idx];
        if (!group) return;
        const losers = group.members.filter((m) => !m.recommend_keep).map((m) => m.id);
        void confirmAction(
          `Envoyer ${losers.length} doublon${losers.length > 1 ? "s" : ""} à la corbeille ? Le morceau recommandé est conservé.`,
          "Envoyer à la corbeille",
        ).then((ok) => {
          if (!ok) return;
          void Promise.all(losers.map((id) => trashTrack(id)))
            .then(() => {
              bibDup.groups = (bibDup.groups || []).filter((_, i) => i !== idx);
              return renderBiblioLive();
            })
            .catch((e) => {
              console.error("dupresolve failed", e);
              toast("Échec : impossible d'envoyer les doublons à la corbeille");
            });
        });
      }
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sift]");
    if (!el) return;
    const act = el.dataset.sift;
    if (act === "addsrc") {
      e.stopPropagation();
      void pickAndAddFolder(refresh);
    } else if (act === "rmsrc") {
      e.stopPropagation();
      void removeSource(Number(el.dataset.id)).then(refresh);
    } else if (act === "togglewatch") {
      e.stopPropagation();
      void setSourceWatched(
        Number(el.dataset.id),
        el.dataset.watched !== "1",
      ).then(refresh);
    } else if (act === "setsrccolor") {
      e.stopPropagation();
      const hue = el.dataset.hue ?? null;
      void setSourceColor(Number(el.dataset.id), hue).then(refresh);
    } else if (act === "dismiss-rootgate") {
      e.stopPropagation();
      dismissRootGate();
      void refresh();
    } else if (act === "reviewmode") {
      e.stopPropagation();
      setReviewMode(el.dataset.m === "batch" ? "batch" : "detail");
    } else if (handleBatchAction(el, act ?? "", e)) {
      // handled — see batch-panel.ts
    } else if (handleRekordboxAction(el, act ?? "", e, () => void runNavExport())) {
      // handled — see rekordbox-view.ts
    }
  });

  // "File in place" checkbox (under the #fldz tree, batch mode) — a checkbox, so it needs change.
  requireEl("#pa", "installLiveWiring").addEventListener("change", (e) => {
    const ip = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-sift="inplace"]');
    if (ip) onBatchInPlaceChange(ip.checked);
  });

  // queue:changed fires per burst source (watcher debounce window) AND periodically during a
  // large folder scan (scanner.rs emits it every 25 net-changed files) — debounce the redraw
  // the same way onAnalysisChanged does below, so a fast burst of pings coalesces into one.
  let queueChangeTimer: ReturnType<typeof setTimeout> | undefined;
  void onQueueChanged(() => {
    clearTimeout(queueChangeTimer);
    queueChangeTimer = setTimeout(() => void refresh(), 150);
  });
  void onFileDone(onFileBatchDone);
  void onFileProgress(pushFileProgress);
  // Stop button on the global zone's "file" row → stop-net cancel of the running filing batch.
  setCancelHandler("file", onFileStop);

  // Analysis pings can arrive several times per second — debounce the queue redraw.
  let t: ReturnType<typeof setTimeout> | undefined;
  // Throttle the progress-zone IPC+render: coalesce bursts to one RAF per frame (~16 ms).
  // Events are never dropped — only renders are coalesced. A trailing 350 ms timeout
  // guarantees a final render once pings stop (catches the done==total transition).
  let pendingAnalyzeRender = false;
  let analyzeTrailTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleAnalyzeRender() {
    // Reset the trailing timer on every event so it fires only after silence.
    clearTimeout(analyzeTrailTimer);
    analyzeTrailTimer = setTimeout(() => void pushAnalyzeProgress(), 350);
    if (pendingAnalyzeRender) return;
    pendingAnalyzeRender = true;
    requestAnimationFrame(() => {
      pendingAnalyzeRender = false;
      void pushAnalyzeProgress();
    });
  }
  void onAnalysisChanged(() => {
    // A report may have changed (re-analysed / replaced file) → drop the in-session cache so
    // the next open re-fetches from the DB (the source of truth) instead of serving it stale.
    void import("./report-view").then((m) => m.clearReportCache());
    // Throttle progress-zone update: IPC + DOM render at most once per RAF frame (~16 ms),
    // not once per event (can be dozens per second during a 4000-track analysis burst).
    scheduleAnalyzeRender();
    clearTimeout(t);
    // touchDetail=false: redraw the queue list only; never re-open the open track (that aborts
    // the player's audio load).
    t = setTimeout(() => void renderQueue(false), 300);
  });

  // Catch an analysis already in flight when the app opens (events only fire on each item after).
  void pushAnalyzeProgress();
  void refresh();
}

declare global {
  interface Window {
    __siftHome?: () => void;
    __siftQueue?: () => void;
    __siftEcarts?: () => void;
    __siftReglages?: () => void;
    __siftBiblio?: () => void;
    __siftJournal?: () => void;
    __siftRkb?: () => void;
  }
}
