// Entrée de disque de l'écran Clé USB (`usb-row.ts`) — le nom d'un disque sans lettre et le mot
// « vide » d'un lecteur sans média. Une erreur ici est silencieuse : un libellé resté français en
// anglais, ou l'inverse, ne lève rien. Deux langues gelées, et l'échappement du nom de disque.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import type { RemovableDrive } from "../frontend/ipc";
import { driveDisplayName, usbEntryHtml } from "../frontend/usb-row";

function drive(over: Partial<RemovableDrive> = {}): RemovableDrive {
  return {
    id: "\\\\.\\PHYSICALDRIVE2",
    label: "SanDisk Ultra",
    mount: "",
    size_bytes: 64_000_000_000,
    free_bytes: 0,
    current_fs: "",
    volume_name: "",
    health: "",
    has_media: true,
    identity: "opaque",
    ...over,
  };
}

afterEach(() => setCurrentLang("fr"));

describe("driveDisplayName", () => {
  it("la lettre d'abord quand le disque est monté", () => {
    expect(driveDisplayName(drive({ mount: "E:" }))).toBe("E:");
  });

  it("sans lettre, le numéro du disque physique — français", () => {
    expect(driveDisplayName(drive())).toBe("Disque 2");
    expect(driveDisplayName(drive({ id: "/dev/disk4" }))).toBe("Disque 4");
  });

  it("sans lettre, le numéro du disque physique — anglais", () => {
    setCurrentLang("en");
    expect(driveDisplayName(drive())).toBe("Disk 2");
    expect(driveDisplayName(drive({ id: "/dev/disk4" }))).toBe("Disk 4");
  });

  it("identifiant non reconnu : rendu tel quel, dans les deux langues", () => {
    expect(driveDisplayName(drive({ id: "opaque-id" }))).toBe("opaque-id");
    setCurrentLang("en");
    expect(driveDisplayName(drive({ id: "opaque-id" }))).toBe("opaque-id");
  });
});

describe("usbEntryHtml", () => {
  it("lecteur sans média : « vide » en français", () => {
    const html = usbEntryHtml(drive({ has_media: false }), false);
    expect(html).toContain('<span class="rkb-entry-count">vide</span>');
    expect(html).toContain("Disque 2");
  });

  it("lecteur sans média : « empty » en anglais", () => {
    setCurrentLang("en");
    const html = usbEntryHtml(drive({ has_media: false }), false);
    expect(html).toContain('<span class="rkb-entry-count">empty</span>');
    expect(html).toContain("Disk 2");
  });

  it("le nom affiché traverse esc()", () => {
    const html = usbEntryHtml(drive({ mount: "<b>E:</b>" }), true);
    expect(html).not.toContain("<b>E:</b>");
    expect(html).toContain("&lt;b&gt;E:&lt;/b&gt;");
  });
});
