// Ligne de source du rail — une erreur ici est silencieuse (mauvaise classe d'état, aucune
// exception), périmètre exact de la suite Vitest. Deux choses gelées :
// 1. la PRÉCÉDENCE des états (rail.md § États) : l'échec prime sur la suspension — « jamais
//    atténuée » — et la suspension ne se rend que sans échec ;
// 2. l'échappement : chemin et motif d'échec traversent `esc()` avant l'attribut `title`.
import { describe, expect, it } from "vitest";
import { baseName, sourceEntryHtml } from "../frontend/rail-source-entry";
import type { Source } from "../shared/contracts";

function src(over: Partial<Source> = {}): Source {
  return {
    id: 1,
    path: "C:\\music\\incoming",
    pending_count: 0,
    accessible: true,
    watched: true,
    color_key: null,
    ...over,
  };
}

describe("sourceEntryHtml — états", () => {
  it("source saine et surveillée : ni --error ni --suspended", () => {
    const html = sourceEntryHtml(src(), [src()], false, undefined);
    expect(html).not.toContain("sift-rail-src--error");
    expect(html).not.toContain("sift-rail-src--suspended");
  });

  it("surveillance suspendue : classe --suspended et motif dans le title", () => {
    const s = src({ watched: false });
    const html = sourceEntryHtml(s, [s], false, undefined);
    expect(html).toContain("sift-rail-src--suspended");
    expect(html).toContain("surveillance suspendue");
  });

  it("l'échec de scan PRIME sur la suspension — jamais atténuée (rail.md § États)", () => {
    const s = src({ watched: false });
    const html = sourceEntryHtml(s, [s], false, "verrou");
    expect(html).toContain("sift-rail-src--error");
    expect(html).not.toContain("sift-rail-src--suspended");
    expect(html).toContain("scan en échec");
  });

  it("le dossier inaccessible PRIME sur la suspension, même sans échec de scan", () => {
    const s = src({ watched: false, accessible: false });
    const html = sourceEntryHtml(s, [s], false, undefined);
    expect(html).toContain("sift-rail-src--error");
    expect(html).not.toContain("sift-rail-src--suspended");
    expect(html).toContain("dossier inaccessible");
  });

  it("suspendue garde sa teinte : la pastille identifie, l'état ne la vide que par CSS", () => {
    const s = src({ watched: false });
    const html = sourceEntryHtml(s, [s], false, undefined);
    expect(html).toMatch(/sift-rail-src-dot-(indigo|purple|pink|teal|yellow)/);
  });
});

describe("sourceEntryHtml — échappement", () => {
  it("échappe le motif d'échec dans le title", () => {
    const s = src();
    const html = sourceEntryHtml(s, [s], false, `<img src=x onerror=alert(1)>`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("échappe le nom de dossier affiché", () => {
    const s = src({ path: `C:\\music\\<b>"pièges"</b>` });
    const html = sourceEntryHtml(s, [s], false, undefined);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&quot;pièges&quot;");
  });
});

describe("baseName", () => {
  it("prend le dernier segment, séparateurs Windows et POSIX confondus", () => {
    expect(baseName("C:\\music\\incoming")).toBe("incoming");
    expect(baseName("/home/dj/promos/")).toBe("promos");
    expect(baseName("solo")).toBe("solo");
  });
});
