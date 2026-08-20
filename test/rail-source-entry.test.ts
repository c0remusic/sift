// Ligne de source du rail — une erreur ici est silencieuse (mauvaise classe d'état, aucune
// exception), périmètre exact de la suite Vitest. Deux choses gelées :
// 1. la PRÉCÉDENCE des états (rail.md § États) : l'échec prime sur la suspension — « jamais
//    atténuée » — et la suspension ne se rend que sans échec ;
// 2. l'échappement : chemin et motif d'échec traversent `esc()` avant l'attribut `title`.
import { describe, expect, it } from "vitest";
import { baseName, railRowState, railShapeKey, sourceEntryHtml } from "../frontend/rail-source-entry";
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

  it("échappe un color_key adverse : la base ne contraint PAS les 5 valeurs (audit 2026-08-20)", () => {
    // `set_source_color` (ipc.rs) écrit la valeur telle quelle — aucune validation, aucun CHECK
    // SQL. Le seul verrou est le menu du frontend, donc ce champ se traite comme non fiable.
    const s = src({ color_key: `"><script>x</script>` });
    const html = sourceEntryHtml(s, [s], false, undefined);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
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

// Le rail se met a jour EN PLACE pendant un scan (issue #42) : `rail-sources.ts` garde ses noeuds
// et n'ecrit que des valeurs. Les trois contrats ci-dessous sont ce dont ce chemin depend, et
// chacun casse en SILENCE — pas d'exception, juste un rail qui ment.
describe("railRowState — contrat du chemin mutation", () => {
  it("rend du texte BRUT, jamais pre-echappe : le chemin mutation ecrit des proprietes DOM", () => {
    // `textContent`/`title`/`className` ne parsent rien. Pre-echapper ici afficherait « &lt;b&gt; »
    // a l'ecran, dans le rail, en clair. C'est l'inverse exact du bug d'echappement habituel — et
    // c'est pourquoi ce test regarde `not.toContain("&")` la ou les autres exigent des entites.
    // Dernier segment SANS `/` : `baseName` decoupe sur les deux separateurs, donc un `</b>` dans
    // le nom couperait le libelle et masquerait ce qu'on mesure ici.
    const s = src({ path: `C:\\music\\<b>"pièges"` });
    const r = railRowState(s, [s], false, `<img src=x>`);
    expect(r.label).toBe(`<b>"pièges"`);
    expect(r.label).not.toContain("&lt;");
    expect(r.title).toContain(`<img src=x>`);
    expect(r.title).not.toContain("&lt;");
  });

  it("le badge est une chaine VIDE a zero, jamais absent — sinon la ligne n'est plus mutable", () => {
    // Un span toujours present se met a jour par `textContent`. S'il disparaissait a zero, passer
    // de 0 a 1 exigerait de CREER un noeud, donc de reconstruire — ce que tout ce chemin evite.
    // `.nav-badge:empty` (styles.css) replie la pastille, comme pour le badge de Revue.
    expect(railRowState(src({ pending_count: 0 }), [src()], false, undefined).badge).toBe("");
    expect(railRowState(src({ pending_count: 12 }), [src()], false, undefined).badge).toBe("12");
  });

  it("le marqueur actif vit dans rowClass, avec la grammaire .nv du rail", () => {
    const s = src();
    expect(railRowState(s, [s], true, undefined).rowClass).toBe("nv sift-rail-src on");
    expect(railRowState(s, [s], false, undefined).rowClass).toBe("nv sift-rail-src");
  });

  it("dotClass porte la classe de base ET la teinte : le chemin mutation ecrase className entier", () => {
    // `dot.className = r.dotClass` remplace tout. Si `dotClass` oubliait `sift-rail-src-dot`, la
    // pastille perdrait sa taille et sa forme au premier tick de scan, pas au rendu initial.
    const r = railRowState(src(), [src()], false, undefined);
    expect(r.dotClass).toMatch(/^sift-rail-src-dot sift-rail-src-dot-(indigo|purple|pink|teal|yellow)$/);
  });
});

describe("sourceEntryHtml — structure exigee par le chemin mutation", () => {
  it("emet TOUJOURS les trois enfants, dans l'ordre pastille → libelle → badge", () => {
    // `rail-sources.ts` marche `firstElementChild` → `nextElementSibling` → `nextElementSibling`.
    // Cet ordre est un contrat entre deux fichiers, invisible depuis chacun d'eux pris seul.
    const s = src({ pending_count: 0 });
    const html = sourceEntryHtml(s, [s], false, undefined);
    const children = html.match(/<span[^>]*>/g) ?? [];
    expect(children).toHaveLength(3);
    expect(children[0]).toContain("sift-rail-src-dot");
    expect(children[1]).toBe("<span>");
    expect(children[2]).toContain("nav-badge");
  });

  it("le badge est present meme a zero en attente", () => {
    const s = src({ pending_count: 0 });
    expect(sourceEntryHtml(s, [s], false, undefined)).toContain('<span class="nav-badge"></span>');
  });
});

describe("railShapeKey — ce qu'une mise a jour en place ne rattrape PAS", () => {
  const a = src({ id: 1, path: "C:\\a" });
  const b = src({ id: 2, path: "C:\\b" });

  it("ignore tout ce que la mutation sait ecrire — sinon le scan reconstruirait a chaque tick", () => {
    // C'est LE test du correctif : pendant un scan, `pending_count` avance en permanence. S'il
    // entrait dans la cle, la forme changerait a chaque tick et on reconstruirait le rail 6 fois
    // par seconde — le bug d'origine, reintroduit par la porte de derriere.
    const base = railShapeKey([a, b]);
    expect(railShapeKey([{ ...a, pending_count: 999 }, b])).toBe(base);
    expect(railShapeKey([{ ...a, watched: false }, b])).toBe(base);
    expect(railShapeKey([{ ...a, accessible: false }, b])).toBe(base);
    expect(railShapeKey([{ ...a, color_key: "teal" }, b])).toBe(base);
  });

  it("change des qu'il faut creer, retirer ou deplacer un noeud", () => {
    const base = railShapeKey([a, b]);
    expect(railShapeKey([a])).not.toBe(base); // retrait
    expect(railShapeKey([a, b, src({ id: 3 })])).not.toBe(base); // ajout
    expect(railShapeKey([b, a])).not.toBe(base); // reordonnancement
  });

  it("une liste vide a sa propre cle : la section montre alors un message, pas des lignes", () => {
    expect(railShapeKey([])).toBe("");
    expect(railShapeKey([])).not.toBe(railShapeKey([a]));
  });
});

describe("baseName", () => {
  it("prend le dernier segment, séparateurs Windows et POSIX confondus", () => {
    expect(baseName("C:\\music\\incoming")).toBe("incoming");
    expect(baseName("/home/dj/promos/")).toBe("promos");
    expect(baseName("solo")).toBe("solo");
  });
});
