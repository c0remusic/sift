// Chaque glyphe Tabler qu'un écran pose doit exister : dans la police installée
// (`@tabler/icons-webfont`, la feuille que `frontend/main.ts` importe), ou parmi les glyphes pleins
// que `frontend/styles.css` déclare lui-même (`.ti-fill-*`).
//
// Le raté qu'il garde : `report-view.ts` posait `ti-music-note` sur la pochette de Revue depuis le
// 2026-07-08 (7de7bf3). Ce nom n'existe pas dans Tabler 3.46.0 — la famille « music » y a `ti-music`
// et ses variantes (`-off`, `-bolt`…), pas de `-note`. Une classe inconnue ne lève aucune erreur :
// la pochette d'une piste sans image restait VIDE, en silence, et ni tsc, ni ESLint, ni aucun lint
// ne lit un nom de classe. Trouvé par l'agent de maquette de l'écran Doublons le 2026-10-05.
//
// Ce que le test lit : les attributs `class="…"` et les littéraux de chaîne `"ti-…"` de
// `frontend/**/*.ts` et d'`index.html`. Ce qu'il ne voit pas, et le dit : un nom construit à
// l'exécution (`ti-fill-${name}`, `class="ti ${o.icon}"`) — le littéral passé en argument, lui,
// est vu (`icon: "ti-copy"`). `frontend/app.js`, la démo navigateur, est hors champ.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function glyphesDefinis(): Set<string> {
  const vendeur = readFileSync(join(ROOT, "node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css"), "utf8");
  const depot = readFileSync(join(ROOT, "frontend/styles.css"), "utf8");
  const out = new Set<string>();
  for (const css of [vendeur, depot]) {
    for (const m of css.matchAll(/\.(ti-[a-z0-9-]+):before/g)) out.add(m[1]);
  }
  // La classe de FAMILLE des glyphes pleins du dépôt : elle pose la police, pas un glyphe.
  out.add("ti-fill");
  return out;
}

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiers(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Les glyphes posés par un source : `{ glyphe, ligne }`. Un nom qui contient `${` ou finit par
 *  un tiret est construit à l'exécution : hors de portée d'une lecture statique, donc ignoré. */
function glyphesPoses(texte: string): { glyphe: string; ligne: number }[] {
  const out: { glyphe: string; ligne: number }[] = [];
  const ligneDe = (i: number) => texte.slice(0, i).split("\n").length;
  for (const m of texte.matchAll(/class="([^"]*)"/g)) {
    for (const tok of m[1].split(/\s+/)) {
      if (tok.startsWith("ti-") && !tok.includes("${") && !tok.endsWith("-")) {
        out.push({ glyphe: tok, ligne: ligneDe(m.index ?? 0) });
      }
    }
  }
  for (const m of texte.matchAll(/["'](ti-[a-z0-9-]*[a-z0-9])["']/g)) {
    out.push({ glyphe: m[1], ligne: ligneDe(m.index ?? 0) });
  }
  return out;
}

describe("glyphes Tabler", () => {
  it("chaque glyphe posé par un écran existe dans la police installée ou dans styles.css", () => {
    const definis = glyphesDefinis();
    // Garde contre un test qui passerait à vide : une police lue, et des glyphes réellement trouvés.
    expect(definis.size).toBeGreaterThan(1000);
    const sources = [...fichiers(join(ROOT, "frontend")), join(ROOT, "index.html")];
    const poses: string[] = [];
    const inconnus: string[] = [];
    for (const f of sources) {
      for (const { glyphe, ligne } of glyphesPoses(readFileSync(f, "utf8"))) {
        poses.push(glyphe);
        if (!definis.has(glyphe)) inconnus.push(`${relative(ROOT, f)}:${ligne}  ${glyphe}`);
      }
    }
    expect(new Set(poses).size).toBeGreaterThan(20);
    expect(inconnus, inconnus.join("\n")).toEqual([]);
  });

  it("le détecteur voit un attribut class et un littéral, et saute un nom construit", () => {
    const src = [
      '`<i class="ti ti-music sift-cover-fallback"></i>`',
      'noticeBannerHtml({ icon: "ti-copy" });',
      "i.className = `ti-fill ti-fill-${name}`;",
      '`<i class="ti ${o.icon}"></i>`',
    ].join("\n");
    expect(glyphesPoses(src).map((g) => `${g.ligne}:${g.glyphe}`)).toEqual(["1:ti-music", "2:ti-copy"]);
  });
});
