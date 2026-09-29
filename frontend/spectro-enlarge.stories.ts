import type { Meta, StoryObj } from "@storybook/html-vite";
import type { AnalysisReport, SpectrogramGrid } from "../shared/contracts";
import { openSpectroEnlarged, type EnlargeDeps } from "./spectro-enlarge";

// La vue agrandie du spectrogramme (#72), cataloguée dans `design-system-states.md` § « Vue
// agrandie du spectrogramme ». Ces stories EXÉCUTENT la vraie vue (`openSpectroEnlarged`) ; seule
// la grille est synthétique, Storybook n'ayant pas Tauri. Elle a la forme d'un faux lossless : un
// mur net à 16 kHz, et des transitoires d'une colonne, ceux que le max-pool garde.

const DUREE = 312;

function grilleSynthetique(grid: SpectrogramGrid): AnalysisReport {
  const frames = Math.min(grid.cols, 3358);
  const bins = Math.min(grid.bins, 1024);
  const hzPerBin = 22050 / bins;
  const mag = new Uint8Array(frames * bins);
  for (let f = 0; f < frames; f++) {
    const transitoire = f % 97 === 0;
    for (let b = 0; b < bins; b++) {
      const hz = b * hzPerBin;
      const niveau = hz > 16000 ? 20 : 150 - (hz / 16000) * 60 + (transitoire ? 60 : 0) + ((f * 7 + b * 13) % 23);
      mag[f * bins + b] = Math.max(0, Math.min(255, Math.round(niveau)));
    }
  }
  // Seuls `path`, `duration_sec` et `spectrogram` sont lus par la vue.
  return {
    path: "C:/Musique/House/Larry Heard - Can You Feel It.flac",
    duration_sec: DUREE,
    spectrogram: { frames, bins, hz_per_bin: hzPerBin, sec_per_frame: DUREE / frames, mag_db: mag },
  } as AnalysisReport;
}

function ouvrir(fetchGrid: EnlargeDeps["fetchGrid"]): HTMLElement {
  const host = document.createElement("div");
  openSpectroEnlarged("C:/Musique/House/Larry Heard - Can You Feel It.flac", "Larry Heard - Can You Feel It.flac", null, {
    fetchGrid,
    mount: (overlay) => host.append(overlay),
  });
  return host;
}

const meta: Meta = { title: "Revue/Spectrogramme agrandi" };
export default meta;
type Story = StoryObj;

export const Vue: Story = {
  name: "Vue (grille à la taille du canevas)",
  render: () => ouvrir((_path, grid) => Promise.resolve(grilleSynthetique(grid))),
};

export const Calcul: Story = {
  name: "Calcul en cours",
  render: () => ouvrir(() => new Promise<AnalysisReport>(() => {})),
};

export const Echec: Story = {
  name: "Échec du calcul",
  render: () => ouvrir(() => Promise.reject(new Error("decode failed"))),
};
