// Le lancement animé, côté page (variante C′, issue #90).
//
// `lancement_natif.rs` montre le mark fixe dès le clic sur l'icône. Cette page peint la même pose
// (`#sift-lancement`, `index.html`), demande le relais, puis joue le rangement : l'ambre se redresse
// et glisse sous le vert, tout le dessin se décale pour que le vert finisse au centre, et « Sift »
// apparaît. Si l'app tarde, seul l'ambre ressort et se range de nouveau : le logo ne disparaît
// jamais. L'app prête, le geste en cours finit, puis le fondu.
import { invoke } from "@tauri-apps/api/core";

/** Durée d'un geste : le rangement du prototype au ralenti ×2, tranché le 2026-11-05 contre le ×4
 *  pour tenir « utilisable en moins de 2 s ». Hors échelle `--duration-*`, comme tout ce geste. */
const GESTE_MS = 600;
const PAUSE_MS = 600;
const FONDU_MS = 300;
const NOM_RETARD_MS = 300;
const NOM_MS = 300;
/** Sans signal de l'app, le lancement s'efface quand même : il ne bloque jamais l'écran. */
const GARDE_MS = 8000;

/** L'ambre posé pile sur le vert, et le décalage qui centre le vert (`brand/mark.svg`). */
const RANGE = "translate(174.5px,174.5px) rotate(16deg)";
const CENTRE = "translate(-98.5px,-98.5px)";

let signaler: () => void = () => {};
const pretP = new Promise<void>((resolve) => {
  signaler = resolve;
});
let prete = false;

/** L'app a de quoi montrer. Sans effet si le lancement est déjà fini. */
export function appPrete(): void {
  prete = true;
  signaler();
}

function attendre(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jouer(el: Element, kf: Keyframe[], ms: number, easing: string, delay = 0): Animation {
  return el.animate(kf, { duration: ms, delay, easing, fill: "both" });
}

async function deroule(racine: HTMLElement): Promise<void> {
  const ambre = racine.querySelector(".sift-lance-ambre");
  const tout = racine.querySelector(".sift-lance-tout");
  const nom = racine.querySelector(".sift-lance-nom");
  if (!ambre || !tout || !nom) throw new Error("lancement : markup incomplet");
  const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim();

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await pretP;
    return;
  }
  const finis = (...a: Animation[]) => Promise.all(a.map((x) => x.finished));
  await finis(
    jouer(ambre, [{ transform: "none" }, { transform: RANGE }], GESTE_MS, easing),
    jouer(tout, [{ transform: "none" }, { transform: CENTRE }], GESTE_MS, easing),
    jouer(nom, [{ opacity: 0 }, { opacity: 1 }], NOM_MS, easing, NOM_RETARD_MS),
  );
  while (!prete) {
    await Promise.race([attendre(PAUSE_MS), pretP]);
    if (prete) return;
    await finis(jouer(ambre, [{ transform: RANGE }, { transform: "none" }], GESTE_MS, easing));
    await finis(jouer(ambre, [{ transform: "none" }, { transform: RANGE }], GESTE_MS, easing));
  }
}

/** À appeler une fois, avant le câblage de l'app. */
export async function lancerLancement(): Promise<void> {
  const racine = document.getElementById("sift-lancement");
  if (!racine) throw new Error("lancement : #sift-lancement absent");
  setTimeout(appPrete, GARDE_MS);
  try {
    await invoke("lancement_peint");
    await deroule(racine);
  } catch (e) {
    console.error("lancement interrompu", e);
  }
  // L'app répond dès le début du fondu : le voile ne retient plus aucun clic.
  racine.style.pointerEvents = "none";
  const fondu = racine.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FONDU_MS, fill: "both" });
  await fondu.finished;
  racine.remove();
}
