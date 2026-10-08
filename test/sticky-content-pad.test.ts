// Tout élément `position:sticky` de `frontend/styles.css` doit tirer son décalage de `--content-pad`,
// le padding de `#content`, la zone qui défile.
//
// Le raté qu'il garde : un élément collant colle au bord INTÉRIEUR du padding de son conteneur de
// défilement. Avec `top:0`, l'en-tête des tables restait 24 px sous le bord de `#content`, et les
// rangées défilaient VISIBLES dans cette bande, au-dessus de lui — et sous la légende collante de
// Doublons. Mesuré le 2026-10-08 dans la vraie fenêtre, Doublons défilé de 1 200 px : en-tête à
// 72 px pour un bord à 48, une rangée au-dessus ; légende à 805 pour un bord à 829, deux rangées
// dessous. Le commentaire de `.sift-lib-thead` décrivait le repère depuis août sans que la bande
// soit vue : seule une règle exécutable empêche un cinquième élément collant de la rouvrir.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "frontend/styles.css"), "utf8");

/** Les règles qui posent `position:sticky` : sélecteur et déclarations, commentaires retirés. */
function reglesCollantes(css: string): { selecteur: string; corps: string }[] {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selecteur: string; corps: string }[] = [];
  for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/position\s*:\s*sticky/.test(m[2])) out.push({ selecteur: m[1].trim(), corps: m[2] });
  }
  return out;
}

describe("éléments collants de la zone qui défile", () => {
  it("chacun se décale du padding de #content, en haut comme en bas", () => {
    const regles = reglesCollantes(CSS);
    // Garde contre un test qui passerait à vide : les quatre collants connus au 2026-10-08.
    expect(regles.length).toBeGreaterThanOrEqual(4);
    const fautifs = regles.filter(({ corps }) => {
      const decalages = [...corps.matchAll(/(?:^|;)\s*(top|bottom)\s*:\s*([^;]+)/g)];
      return decalages.length === 0 || decalages.some((d) => !/var\(--content-pad\b/.test(d[2]));
    });
    expect(fautifs.map((r) => r.selecteur)).toEqual([]);
  });

  it("#content déclare --content-pad et s'en sert pour son padding", () => {
    const content = CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/#content\s*\{([^{}]*)\}/);
    expect(content?.[1]).toMatch(/--content-pad\s*:/);
    expect(content?.[1]).toMatch(/padding\s*:\s*var\(--content-pad\)/);
  });

  it("le détecteur voit un collant à top:0 et en accepte un décalé", () => {
    const css = ".a{position:sticky;top:0}.b{position:sticky;bottom:calc(-1 * var(--content-pad, 0px))}";
    expect(reglesCollantes(css).map((r) => r.selecteur)).toEqual([".a", ".b"]);
  });
});
