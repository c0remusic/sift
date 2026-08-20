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
import { listSources, setSourceWatched, rescanSource, removeSource, addSource, setSourceColor } from "./ipc";
import { open } from "@tauri-apps/plugin-dialog";
import type { Source } from "../shared/contracts";
import { resolveSourceColorKey, SOURCE_HUE_CYCLE } from "./source-color";
import { baseName, sourceEntryHtml } from "./rail-source-entry";
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

/** Échecs de scan par source. Rapatriés de `home-sources.ts` avec la suppression de l'écran
 *  Accueil : un scan tombé rend `pending_count = 0`, indiscernable d'un dossier réellement à jour.
 *  C'est le fait le plus vrai qu'on sache d'une source, donc il prime sur le compte. */
const scanFailures = new Map<number, string>();

/** Enregistre l'échec d'un scan et repeint le rail. Appelé par le wiring live. */
export function noteScanFailure(sourceId: number, reason: string): void {
  scanFailures.set(sourceId, reason);
  void renderRailSources();
}

/** Ouvre le sélecteur natif de répertoire et ajoute la source choisie.
 *
 *  Le mensonge type de l'inventaire A3 : le sélecteur se ferme, et la liste continue d'afficher
 *  « Aucun dossier surveillé » sur un dossier qu'on vient justement d'ajouter. Un écran vide et un
 *  écran cassé se ressemblent — d'où le toast sur l'échec. */
export async function pickAndAddFolder(onChange: () => void | Promise<void>): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  try {
    await addSource(dir);
    await onChange();
  } catch (e) {
    toast(humanizeError(e, `« ${baseName(dir)} » n'a pas pu être ajouté.`, "addSource"));
  }
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
      ? sources.map((s) => sourceEntryHtml(s, sources, s.id === active, scanFailures.get(s.id))).join("")
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

/** Infobulles des pastilles du menu — les clés techniques du cycle ne sont pas des mots d'UI. */
const SOURCE_HUE_LABELS: Record<string, string> = {
  indigo: "Indigo",
  purple: "Violet",
  pink: "Rose",
  teal: "Turquoise",
  yellow: "Jaune",
};

function sourceMenu(s: Source, x: number, y: number): void {
  // `ok` vide = succès silencieux : quand l'effet est déjà visible à l'écran (la pastille du rail
  // change sous le clic), un toast par-dessus est du bruit. L'échec, lui, se dit toujours.
  const after = async (p: Promise<unknown>, ok: string, ko: string, cmd: string) => {
    try {
      await p;
      if (ok) toast(ok);
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
      // Rangée de pastilles (patron Finder Tags), anneau sur la teinte RÉSOLUE — l'override si
      // posé, sinon la teinte du cycle. Poser l'override = `set_source_color(id, teinte)`.
      label: "Couleur",
      separated: true,
      swatches: {
        hues: SOURCE_HUE_CYCLE.map((k) => ({ key: k, label: SOURCE_HUE_LABELS[k] ?? k })),
        active: resolveSourceColorKey(sources, s),
        onPick: (key) =>
          void after(setSourceColor(s.id, key), "", "Impossible de changer la couleur", "set_source_color"),
      },
    },
    {
      // Retour au cycle : `set_source_color(id, null)`. Désactivée — pas retirée — quand aucun
      // override n'est posé : le menu garde les mêmes entrées aux mêmes positions (doctrine
      // du menu stable, patterns-macos.md § 8).
      label: "Couleur automatique",
      onPick: s.color_key
        ? () =>
            void after(
              setSourceColor(s.id, null),
              "",
              "Impossible de rétablir la couleur automatique",
              "set_source_color",
            )
        : undefined,
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
