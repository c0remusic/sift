// Section « Sources » du rail — fusion 1 de DESIGN.md § 15, étape 4 de § 17.
//
// L'écran Accueil ne montrait qu'une chose : les dossiers surveillés et leur état de scan. Dans
// Finder, une source n'est pas un écran — c'est une entrée de sidebar. Un écran entier pour lister
// des sources est un détour : on y va pour en ajouter une, puis on en repart.
//
// Les dossiers deviennent donc une section du rail, et cliquer l'un d'eux FILTRE Revue sur ses
// fichiers — le rail devient le sélecteur de provenance, exactement comme la sidebar de Finder.
// Les actions par source (surveillance, rescan, retrait) passent au clic droit, où vivent les
// actions secondaires partout ailleurs depuis l'étape 5.
import { listSources, setSourceWatched, rescanSource, removeSource } from "./ipc";
import type { Source } from "../shared/contracts";
import { esc } from "./dom";
import { pickAndAddFolder } from "./home-sources";
import { setQueueSourceFilter, activeQueueSource, renderQueue } from "./queue-panel";
import { goTo } from "./router";
import { openContextMenu } from "./context-menu";
import { confirmAction } from "./confirm-modal";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";

const SECTION_ID = "sift-rail-sources";

/** Dernier état chargé. Gardé pour que le menu contextuel puisse lire la source cliquée sans
 *  relancer un aller-retour IPC entre le clic droit et l'affichage du menu. */
let sources: Source[] = [];

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

/** Une entrée de source. Même grammaire que les autres entrées du rail (`.nv`) : la section
 *  Sources n'est pas un composant à part, c'est le rail avec un contenu de plus. La pastille de
 *  couleur est un accent CATÉGORIEL — elle identifie la source ailleurs dans l'app, elle ne porte
 *  aucun état (DESIGN.md § 4). */
function sourceEntryHtml(s: Source, active: boolean): string {
  const hue = s.color_key ? ` sift-src-swatch-${esc(s.color_key)}` : "";
  const count = s.pending_count > 0 ? `<span class="nav-badge">${s.pending_count}</span>` : "";
  const warn = s.accessible ? "" : ` sift-rail-src--error`;
  const title = s.accessible ? s.path : `${s.path} — dossier inaccessible`;
  return (
    `<div class="nv sift-rail-src${active ? " on" : ""}${warn}" data-src="${s.id}" tabindex="0" role="button" title="${esc(title)}">` +
    `<span class="sift-rail-src-dot${hue}" aria-hidden="true"></span>` +
    `<span>${esc(baseName(s.path))}</span>${count}</div>`
  );
}

/** (Re)peint la section. `innerHTML` sur la section entière et non par ligne : le rail se repeint
 *  au plus une fois par ajout, rescan ou changement de file — jamais en rafale, contrairement à la
 *  progression d'analyse. La règle « créer une fois, muter ensuite » vise les handlers en boucle,
 *  pas un rendu ponctuel. */
export async function renderRailSources(): Promise<void> {
  const host = document.getElementById(SECTION_ID);
  if (!host) return;
  try {
    sources = await listSources();
  } catch (e) {
    console.error("listSources failed", e);
    // Échec de lecture : on le DIT plutôt que de rendre une section vide, qui se lirait « aucun
    // dossier surveillé » — une absence de réponse n'est pas un zéro.
    host.innerHTML =
      `<div class="nv-grp">Sources</div>` +
      `<div class="sift-rail-src-msg sift-rail-src--error">Liste indisponible</div>`;
    return;
  }
  const active = activeQueueSource();
  host.innerHTML =
    `<div class="nv-grp">Sources</div>` +
    (sources.length
      ? sources.map((s) => sourceEntryHtml(s, s.id === active)).join("")
      : `<div class="sift-rail-src-msg">Aucun dossier surveillé</div>`) +
    `<button class="nv sift-rail-src-add" data-src-add="1" type="button">` +
    `<i class="ti ti-plus" aria-hidden="true"></i><span>Ajouter un dossier</span></button>`;
}

/** Clic sur une source : filtre Revue et y va. Re-cliquer la source active lève le filtre —
 *  même bascule que les facettes de Bibliothèque, pour que « annuler » soit le même geste
 *  qu'« appliquer » partout dans l'app. */
function pickSource(id: number): void {
  setQueueSourceFilter(activeQueueSource() === id ? null : id);
  goTo("revue");
  void renderRailSources();
}

function sourceMenu(s: Source, x: number, y: number): void {
  const after = async (p: Promise<unknown>, ok: string, ko: string, cmd: string) => {
    try {
      await p;
      toast(ok);
    } catch (e) {
      toast(humanizeError(e, ko, cmd));
    }
    await renderRailSources();
    void renderQueue(false);
  };
  openContextMenu(x, y, [
    {
      label: s.watched ? "Suspendre la surveillance" : "Reprendre la surveillance",
      onPick: () =>
        void after(
          setSourceWatched(s.id, !s.watched),
          s.watched ? "Surveillance suspendue" : "Surveillance reprise",
          "Impossible de changer la surveillance",
          "set_source_watched",
        ),
    },
    {
      label: "Rescanner",
      onPick: () => void after(rescanSource(s.id), "Rescan lancé", "Rescan impossible", "rescan_source"),
    },
    {
      // Désactivée, PAS omise. `openUrl` refuse côté Rust tout schéma autre que `http(s)://`, donc
      // aucun chemin local n'y passe : l'entrée demande une commande IPC qui n'existe pas encore.
      // Grisée, elle dit qu'elle n'existe pas ; omise, elle aurait laissé croire qu'on l'a oubliée.
      label: "Ouvrir l'emplacement",
      separated: true,
      onPick: undefined,
    },
    {
      label: "Retirer de la surveillance",
      danger: true,
      separated: true,
      onPick: () => {
        void (async () => {
          const ok = await confirmAction(
            `Retirer « ${baseName(s.path)} » des dossiers surveillés ? Les fichiers ne sont pas touchés.`,
            "Retirer",
          );
          if (!ok) return;
          if (activeQueueSource() === s.id) setQueueSourceFilter(null);
          await after(removeSource(s.id), "Dossier retiré", "Retrait impossible", "remove_source");
        })();
      },
    },
  ]);
}

/** Câble la section. Un seul écouteur délégué sur le rail plutôt qu'un par ligne : la section est
 *  reconstruite à chaque changement, et des écouteurs par ligne partiraient avec elle à chaque
 *  fois — donc seraient réattachés à chaque fois, ce qui est le motif d'une fuite. */
export function installRailSources(): void {
  const nav = document.getElementById("nav");
  if (!nav) return;

  nav.addEventListener("click", (e) => {
    const add = (e.target as HTMLElement).closest<HTMLElement>("[data-src-add]");
    if (add) {
      e.stopPropagation();
      void pickAndAddFolder(async () => {
        await renderRailSources();
        void renderQueue(false);
      });
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-src]");
    if (row?.dataset.src) {
      e.stopPropagation();
      pickSource(Number(row.dataset.src));
    }
  });

  nav.addEventListener("contextmenu", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-src]");
    if (!row?.dataset.src) return;
    e.preventDefault();
    const s = sources.find((x) => x.id === Number(row.dataset.src));
    if (s) sourceMenu(s, e.clientX, e.clientY);
  });

  void renderRailSources();
}
