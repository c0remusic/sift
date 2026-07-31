import type { Meta, StoryObj } from "@storybook/html-vite";
import type { RemovableDrive } from "./ipc";
import { usbRowHtml } from "./usb-row";

// Les trois états réels d'une ligne de l'écran Clé USB, rendus par la MÊME fonction que
// `renderUsbList()` (usb-view.ts) — pas une copie du markup, qui dériverait.
//
// Les deux derniers n'existaient pas avant le 2026-07-31 : l'énumération partait du volume
// logique, donc un disque sans volume monté ne pouvait pas apparaître du tout. C'est ce qui
// rendait l'écran inutilisable, une clé neuve ou RAW étant exactement ce qu'on vient formater.
const meta: Meta<RemovableDrive> = {
  title: "États de contenu/Ligne disque amovible",
  render: (args) => {
    const row = document.createElement("div");
    row.className = "sift-usb-row";
    row.innerHTML = usbRowHtml(args);
    return row;
  },
  argTypes: {
    label: { control: "text" },
    mount: { control: "text" },
    current_fs: { control: "text" },
    size_bytes: { control: "number" },
    has_media: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<RemovableDrive>;

/** Cas nominal : clé déjà formatée et montée. L'identifiant affiché est la lettre. */
export const Formatee: Story = {
  args: {
    id: "\\\\.\\PHYSICALDRIVE2",
    label: "Kingston DataTraveler USB Device",
    mount: "E:",
    size_bytes: 16_000_000_000,
    current_fs: "FAT32",
    has_media: true,
    identity: "USBSTOR\\X|SN123|16000000000|AAAA-1111",
  },
};

/** Clé neuve ou RAW : aucun volume monté, donc aucune lettre — l'identifiant retombe sur le
 * numéro de disque. Formatable, et c'est le point : cette ligne n'existait pas avant. */
export const NonFormatee: Story = {
  args: {
    id: "\\\\.\\PHYSICALDRIVE3",
    label: "SanDisk Ultra USB Device",
    mount: "",
    size_bytes: 32_000_000_000,
    current_fs: "non formaté",
    has_media: true,
    identity: "USBSTOR\\Y||32000000000|",
  },
};

/** Lecteur de cartes énuméré mais vide. Windows lui garde une lettre dans l'explorateur, d'où la
 * confusion « je vois bien un lecteur USB » — la ligne le dit et ne propose aucun bouton, puisque
 * `format_drive` refuserait de toute façon (`has_media: false`). */
export const SansMedia: Story = {
  args: {
    id: "\\\\.\\PHYSICALDRIVE2",
    label: "General STORAGE DEVICE USB Device",
    mount: "",
    size_bytes: 0,
    current_fs: "non formaté",
    has_media: false,
    identity: "USBSTOR\\DISK&VEN_GENERAL&PROD_STORAGE_DEVICE&REV_0009\\7&2615ADB3&0|+|0|",
  },
};
