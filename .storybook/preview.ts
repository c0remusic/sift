import type { Preview } from "@storybook/html-vite";

// Load the real app stylesheet so every story renders with Sift's actual tokens
// (frontend/styles.css:6-9 documents the color-meaning rule this system depends on).
import "../frontend/styles.css";

// Les mêmes fontes que la vraie fenêtre, dans le même ordre que `frontend/main.ts:18-36` — sans
// elles, Storybook peint les tokens justes dans une fonte de repli, et cesse d'être un miroir là
// où ça compte : les largeurs de colonnes du Journal sont DÉRIVÉES du texte mesuré en Outfit 12px
// et JetBrains Mono 12px (voir le commentaire de `.jrnl-wrap`), et toute icône `.ti` d'une story
// (chevron de groupe, bouton lecture, vignette de repli) est un carré vide sans la webfont Tabler.
// ⚠️ NE PAS importer `tabler-icons-filled.min.css` : elle redéfinit `.ti` (voir main.ts:28-35).
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "sift-light",
      values: [
        { name: "sift-light", value: "#F7F4EE" },
        { name: "sift-dark", value: "#211F1B" },
      ],
    },
  },
};

export default preview;
