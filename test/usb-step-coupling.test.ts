// La première étape du formatage USB existe en DEUX exemplaires : le front la pose avant le premier
// sondage (`i18n/usb-format-modal.ts`, `etapeAutorisation`), le backend l'écrit dans le fichier
// d'étape (`ipc_usb.rs`, `usb_format/windows.rs`). La fenêtre garde son libellé tant que le sondage
// rend la MÊME chaîne (`if (s === step) return;`) : si les deux divergent, le libellé bascule au
// premier sondage. Ce test lit les sources Rust et exige les deux langues, mot pour mot.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { D } from "../frontend/i18n/usb-format-modal";

const RUST = ["src-tauri/src/ipc_usb.rs", "src-tauri/src/usb_format/windows.rs"];

describe("étape d'autorisation : front et backend disent la même chose", () => {
  for (const f of RUST) {
    it(`${f} écrit l'étape dans les deux langues du dictionnaire`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toContain(`"${D.fr.etapeAutorisation}"`);
      expect(src).toContain(`"${D.en.etapeAutorisation}"`);
    });
  }
});
