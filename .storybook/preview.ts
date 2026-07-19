import type { Preview } from "@storybook/html-vite";

// Load the real app stylesheet so every story renders with Sift's actual tokens
// (frontend/styles.css:6-9 documents the color-meaning rule this system depends on).
import "../frontend/styles.css";

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
