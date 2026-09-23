// Vecteurs du classement de `lint:tokens` sur les propriétés d'espacement et de taille.
//
// Ce qu'ils tiennent : la frontière entre « littéral qui contourne un token de l'échelle » et
// « valeur hors grille », et surtout le trou qu'elle a fermé le 2026-09-23 — un px d'espacement
// était accepté dès qu'il coïncidait avec la valeur de N'IMPORTE QUEL token (un rayon, une
// ombre, une taille de texte). 97 littéraux passaient ainsi, dont `gap:8px`, accepté au nom
// même du token qu'il contourne.
import { describe, expect, it } from "vitest";
import { classifyPx, fullProp, parseTokens, SPACING_PROP_RE } from "../scripts/lint-tokens-spacing.mjs";

// Une échelle et des tokens réduits, mais de la même forme que styles.css.
const SPACE = new Map<number, string>([
  [4, "--space-4"],
  [6, "--space-6"],
  [8, "--space-8"],
  [12, "--space-12"],
]);
const TOKENS = new Map<number, string>([
  ...SPACE,
  [2, "--shadow-panel-subtle"],
  [5, "--border-radius-sm"],
  [7, "--border-radius-md"],
  [10, "--text-3xs"],
  [36, "--toolbar-h"],
]);

const cat = (prop: string, px: number) => classifyPx(prop, px, SPACE, TOKENS)?.category ?? null;

describe("espacement : la seule source légitime est l'échelle --space-*", () => {
  it("un littéral SUR l'échelle contourne un token qui existe", () => {
    expect(classifyPx("gap", 8, SPACE, TOKENS)).toEqual({
      category: "space-literal",
      suggestion: "var(--space-8)",
    });
    expect(cat("padding", 12)).toBe("space-literal");
    expect(cat("margin", 4)).toBe("space-literal");
  });

  it("un littéral négatif sur l'échelle se convertit par calc()", () => {
    expect(classifyPx("margin", -4, SPACE, TOKENS)?.suggestion).toBe("calc(-1 * var(--space-4))");
  });

  it("un px qui coïncide avec un AUTRE token reste hors grille — le trou fermé", () => {
    expect(cat("gap", 5)).toBe("px-spacing"); // --border-radius-sm
    expect(cat("padding", 7)).toBe("px-spacing"); // --border-radius-md
    expect(cat("margin", 2)).toBe("px-spacing"); // une ombre
    expect(cat("padding", 10)).toBe("px-spacing"); // --text-3xs
  });

  it("zéro n'a pas besoin de token", () => {
    expect(cat("margin", 0)).toBeNull();
    expect(cat("gap", 0)).toBeNull();
  });
});

describe("taille : règle inchangée, toute valeur de token reste acceptée", () => {
  it("une taille égale à un token n'est pas un finding", () => {
    expect(cat("width", 5)).toBeNull();
    expect(cat("height", 36)).toBeNull();
    expect(cat("height", 8)).toBeNull();
  });

  it("une taille hors de tout token en est un", () => {
    expect(classifyPx("width", 440, SPACE, TOKENS)).toEqual({
      category: "px-spacing",
      suggestion: "no matching token — new value",
    });
    expect(classifyPx("height", 37, SPACE, TOKENS)?.suggestion).toBe("--toolbar-h (off by 1px)");
  });
});

describe("la valeur s'arrête au guillemet d'un attribut style", () => {
  const decls = (text: string) =>
    [...text.matchAll(SPACING_PROP_RE)].map((m) => `${m[1]}${m[2] ?? ""}=${m[3]}`);

  it("n'avale pas le markup suivant jusqu'au prochain point-virgule", () => {
    // Forme réelle de queue-panel.ts : un gap en fin d'attribut, puis une autre balise.
    const src = '`<div style="gap:2px">` + `<span style="font-size:12px;width:8px">`';
    expect(decls(src)).toEqual(["gap=2px", "width=8px"]);
  });

  it("garde la déclaration DERNIÈRE de son bloc CSS (issue #29)", () => {
    expect(decls(".a{padding:4px 8px}")).toEqual(["padding=4px 8px"]);
    expect(decls(".a{gap:4px;margin-top:6px}")).toEqual(["gap=4px", "margin-top=6px"]);
  });

  it("s'arrête au `$` d'une interpolation au lieu d'échouer en entier", () => {
    // Forme réelle de bibliotheque-view.ts : un style qui se complète par un ternaire.
    const src = '`<div style="gap:8px;padding:4px 0${keep ? "" : ";opacity:.6"}">`';
    expect(decls(src)).toEqual(["gap=8px", "padding=4px 0"]);
  });

  it("voit une valeur de clé d'objet entre guillemets", () => {
    expect(decls("Object.assign(el.style, { padding: '8px' });")).toEqual(["padding=8px"]);
    expect(decls('({ margin: "0 8px" })')).toEqual(["margin=0 8px"]);
  });
});

describe("le nom affiché est celui de la propriété entière", () => {
  const props = (text: string) => [...text.matchAll(SPACING_PROP_RE)].map((m) => fullProp(text, m));

  it("min-, max-, line-, row- ne sont pas perdus", () => {
    expect(props(".a{min-width:64px;max-height:340px;line-height:18px;row-gap:4px;width:8px}")).toEqual([
      "min-width",
      "max-height",
      "line-height",
      "row-gap",
      "width",
    ]);
  });
});

describe("les tokens se lisent dans les trois blocs :root, et nulle part ailleurs", () => {
  const CSS = [
    "/* un commentaire qui cite --text-xs:33px en prose */",
    ":root{--space-4:4px;--h-40:40px;--text-base:13px}",
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--shadow-a:0 3px 9px x}}',
    ':root[data-theme="dark"]{--radius-z:11px}',
    ".sift-jrnl{--jrnl-col-time:44px}",
    ".sift-lib-colhead--dropbefore::before{--dropbefore:41px}",
  ].join("\n");

  it("retient chaque valeur des trois blocs, échelle d'espacement comprise", () => {
    const { spaceScale, tokenPx, blocks } = parseTokens(CSS);
    expect(blocks).toBe(3);
    expect([...spaceScale]).toEqual([[4, "--space-4"]]);
    expect([...tokenPx.keys()].sort((a, b) => a - b)).toEqual([3, 4, 9, 11, 13, 40]);
  });

  it("ignore une propriété LOCALE de règle et le texte d'un commentaire", () => {
    const { tokenPx } = parseTokens(CSS);
    for (const px of [33, 41, 44]) expect(tokenPx.has(px)).toBe(false);
  });
});
