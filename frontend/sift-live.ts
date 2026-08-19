// Live data wiring — ACTIVE ONLY inside the Tauri app. In a plain browser the hooks
// below are never installed, so app.js keeps its mockup (Vercel demo unaffected).
import {
  onFileDone,
  onFileProgress,
  onQueueChanged,
  onScanFailed,
  onAnalysisChanged,
  analysisProgress,
  setSourceColor,
  trashTrack,
  restoreTrack,
  requeueTrack,
  purgeTrash,
  openUrl,
  exportRekordboxXml,
  linkRekordboxXml,
  rekordboxStatus,
  reanalyzeTracks,
} from "./ipc";
import { installUndoShortcut, installFilingKeys } from "./filing";
import { refreshBinsForBatch } from "./filing-bins";
import { confirmAction } from "./confirm-modal";
// Views/chrome extracted from this god-module (audit P-3) — kept stateless, wired here.
import { renderEcartes } from "./ecartes-view";
import { renderHomeSources, dismissRootGate, noteScanFailure } from "./home-sources";
import { installDragDrop, injectLeanStyle, injectTitlebar, installScrollAutohide, installNavKeyboard } from "./chrome";
import { initTheme } from "./theme";
import { requireEl } from "./dom";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import type { LibrarySortState } from "./library-views";
import {
  bibState,
  bibDup,
  loadDuplicates,
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
  beginReanalyze,
  endReanalyze,
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
 * longer routes here (finding F5, audit-heuristique-visuel.md) — it has its own screen since
 * 2026-07-31 (`usb-view.ts`). */
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
        ? // La commande de liaison (`rkblink`) vit sur l'écran Rekordbox, pas dans la
          // Bibliothèque : le message renvoyait vers un écran où elle n'est pas. Le libellé est
          // celui de l'item de navigation (`index.html`, `<span>Rekordbox</span>`) — pas
          // « Mettre à jour Rekordbox », qui n'est qu'un bouton de la carte de stats d'Accueil.
          "Aucun XML Rekordbox lié — relie un fichier depuis l'écran Rekordbox"
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
  // Les huit globales `window.__sift*` ont disparu avec la maquette (etape 1, DESIGN.md § 17) :
  // `router.ts` appelle les renderers de vue directement, par import. app.js etait leur unique
  // appelant, et elle ne tourne plus dans Tauri.
  injectLeanStyle();
  void injectTitlebar();
  void initTheme();
  installUndoShortcut();
  installFilingKeys();
  installQueueNavKeys();
  installScrollAutohide();
  installNavKeyboard();
  void installDragDrop();

  // Nav "Clé USB" (`data-view="cle"`) needs no special handling: app.js's own router renders the
  // screen and `window.__siftCle` above swaps in the live content. It used to be intercepted here
  // in the capture phase and redirected to Réglages, where the format card then lived — the nav
  // item lit up "Réglages" and landed on a page about something else. Both the interception and the
  // card moved out on 2026-07-31 (`usb-view.ts`).

  /** Retry analysis for a single stuck-unanalysed track. The in-flight spinner is driven through
   *  queue-panel's shared reanalyzingIds state (begin/endReanalyze), NOT by mutating the clicked
   *  button node — the queue rail is rebuilt via innerHTML on the backend's queue:changed, so a
   *  spinner written onto the node would strand on a detached element while the fresh row looked
   *  idle (review-caught). Rendering from state survives the rebuild. */
  async function reanalyzeTrack(id: number): Promise<void> {
    beginReanalyze([id]);
    try {
      await reanalyzeTracks([id]);
      toast("Réanalyse relancée");
    } catch (e) {
      toast(humanizeError(e, "Échec de la réanalyse — réessaie", "reanalyze_tracks"));
    } finally {
      endReanalyze([id]);
    }
  }

  requireEl("#pa", "installLiveWiring").addEventListener("click", (e) => {
    // Reanalyze-this-track button on an unanalysed queue row — checked BEFORE the .qi row-open
    // branch below (the button lives inside a .qi row) so clicking it never also opens the track.
    const reanalyzeBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-reanalyze]");
    if (reanalyzeBtn) {
      e.stopPropagation();
      const id = Number(reanalyzeBtn.dataset.reanalyze);
      if (id) void reanalyzeTrack(id);
      return;
    }
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
        // « Copié » était peint AVANT que l'écriture ne réussisse, et le `catch` était vide : un
        // refus du presse-papier (permission, focus perdu) affichait quand même la coche, et
        // l'utilisateur collait l'ancien contenu sans savoir pourquoi. La coche attend maintenant
        // le `.then()`, et l'échec le dit.
        const prev = ec.innerHTML;
        void navigator.clipboard
          .writeText(ec.dataset.q || "")
          .then(() => {
            // Le nœud peut avoir été détaché entre le clic et la résolution : toute action
            // Écartés (corbeille, restauration) et tout changement d'écran reconstruisent
            // `#content` par `innerHTML`. Écrire dedans partirait dans le vide en silence.
            if (!ec.isConnected) return;
            ec.innerHTML =
              '<i class="ti ti-check" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copié';
            setTimeout(() => {
              if (ec.isConnected) ec.innerHTML = prev;
            }, 1200);
          })
          .catch((err: unknown) => {
            console.error("clipboard writeText failed", err);
            toast("Copie impossible — le presse-papier a refusé");
          });
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
            .then((res) => {
              // Files that resisted deletion (typically held open by another program) keep
              // their track in the bin. Staying silent would read as "the purge worked and
              // some tracks came back" — the one reading the user cannot act on.
              if (res.failed.length) {
                const s = res.failed.length > 1 ? "s" : "";
                toast(
                  `${res.purged} supprimé${res.purged > 1 ? "s" : ""} — ${res.failed.length} fichier${s} impossible${s} à supprimer (ouvert dans un autre programme ?)`,
                );
              }
              return renderEcartes();
            })
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
          bibState.filter.q = undefined;
          bibState.filter.folder = undefined;
          bibState.filter.genre = undefined;
          bibState.filter.artist = undefined;
        } else if (stat === "lossless" || stat === "mp3") {
          bibState.filter.quality = stat;
          bibState.filter.verdict = undefined;
        } else if (stat === "duplicates") {
          bibDup.shown = !bibDup.shown;
          // Relance aussi apres une erreur : sans `|| bibDup.error`, un scan echoue laissait
          // l'ecran bloque sur son message, le chip ne rejouant jamais rien.
          if (bibDup.shown && (bibDup.groups === null || bibDup.error)) {
            loadDuplicates();
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
            // Impasse A16 (issue #15) : cette branche testait `status.error`, que
            // `link_rekordbox_xml_inner` construit TOUJOURS à `None` — il échoue en `Err` avant de
            // renvoyer quoi que ce soit. Elle était donc inatteignable, et la seule chose qu'elle
            // pouvait dire vivait déjà dans le `catch`. Retirée plutôt que réparée : un succès qui
            // porterait une erreur n'existe pas dans ce contrat.
            toast(
              `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderRekordboxLive();
          } catch (e) {
            // Seconde moitié d'A16 : trois erreurs backend distinctes — fichier illisible
            // (`ipc_library.rs`, « lecture impossible »), XML invalide (`rekordbox_xml.rs`), et
            // échec d'écriture du réglage — devenaient un seul « Liaison échouée » qui ne disait à
            // l'utilisateur ni ce qui n'allait pas, ni s'il devait choisir un autre fichier. Les
            // messages backend sont déjà en français et déjà précis : les afficher suffit, sans
            // table de correspondance.
            toast(humanizeError(e, `Liaison du XML Rekordbox échouée : ${String(e)}`, "link_rekordbox_xml"));
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
        if (bibDup.shown && (bibDup.groups === null || bibDup.error)) {
          loadDuplicates();
        } else {
          void renderBiblioLive();
        }
      } else if (act === "dupretry") {
        // Bouton du bloc d'erreur : relance sans rebasculer l'affichage.
        loadDuplicates();
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
          // `Promise.all` rejette au PREMIER échec : sur 5 doublons dont un seul refuse, les 4
          // autres partaient bien à la corbeille et l'écran annonçait « impossible d'envoyer les
          // doublons », en gardant le groupe intact. L'utilisateur relançait donc une suppression
          // sur des pistes déjà supprimées, qui échoue à `trash_file_fs` — impasse.
          //
          // `renderBiblioLive()` ne RESCANNE PAS les doublons : il repeint la section depuis
          // `bibDup.groups` en mémoire. Rafraîchir ne suffit donc pas — il faut retirer du groupe
          // les membres réellement supprimés, sinon ils restent listés avec leur bouton et la
          // boucle recommence. Un groupe qui retombe sous deux membres n'est plus un groupe.
          void Promise.allSettled(losers.map((id) => trashTrack(id)))
            .then((results) => {
              const groups = bibDup.groups || [];
              const failedIds = new Set(
                losers.filter((_, i) => results[i]?.status === "rejected"),
              );
              if (failedIds.size === 0) {
                bibDup.groups = groups.filter((_, i) => i !== idx);
                return renderBiblioLive();
              }
              results.forEach((r, i) => {
                if (r.status === "rejected") {
                  console.error(`dupresolve: trashTrack(${losers[i]}) failed`, r.reason);
                }
              });
              const g = groups[idx];
              if (g) {
                g.members = g.members.filter((m) => m.recommend_keep || failedIds.has(m.id));
                if (g.members.length < 2) bibDup.groups = groups.filter((_, i) => i !== idx);
              }
              const done = losers.length - failedIds.size;
              toast(
                done === 0
                  ? "Aucun doublon n'a pu être envoyé à la corbeille"
                  : `${done} doublon${done > 1 ? "s" : ""} envoyé${done > 1 ? "s" : ""} à la corbeille, ${failedIds.size} en échec`,
              );
              return renderBiblioLive();
            })
            .catch((e: unknown) => {
              console.error("dupresolve: refresh failed", e);
              toast("Échec : impossible de rafraîchir la liste");
            });
        });
      }
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sift]");
    if (!el) return;
    const act = el.dataset.sift;
    if (act === "setsrccolor") {
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
  // Impasse A4 (issue #15) : un scan de dossier surveillé qui n'a pas tourné laissait sa source
  // en « À jour » vert, indiscernable d'un dossier réellement à jour. La raison arrive en toast
  // (dite une fois, en toutes lettres) et l'état persiste sur la pastille de la source.
  // Fréquence : au plus un par ajout ou rescan de dossier — jamais en rafale, contrairement à
  // `queue:changed` juste au-dessus, qui est debouncé pour cette raison.
  void onScanFailed((sourceId, reason) => {
    noteScanFailure(sourceId, reason);
    toast(`Le scan du dossier surveillé a échoué : ${reason}`);
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

