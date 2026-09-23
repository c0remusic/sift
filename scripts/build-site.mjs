// Le site Vercel (https://sift-music.vercel.app) est le build Vite de l'app plus des pages posées
// à côté : accueil et manuel en FRANÇAIS à la racine, les mêmes en ANGLAIS sous `/en/`, et le
// manuel en PDF. Le PDF n'existe qu'en français, et la page anglaise le dit dans son lien.
//
// Deux phases, branchées dans package.json :
//   `prebuild`  → `node scripts/build-site.mjs prepare`
//   `postbuild` → `node scripts/build-site.mjs finish`
//
// prepare — enveloppe chaque entrée de `PAGES` d'un squelette HTML et la dépose dans `public/`
// avec le PDF et les captures ; Vite recopie `public/` verbatim dans `dist/`. Les sources sont
// écrites SANS `<!doctype>`/`<html>`/`<head>`/`<body>` : c'est la forme que demande l'outil
// d'artefact de Claude, qui les enveloppe lui-même. Servies nues, elles perdraient leur
// `<meta charset>` — mojibake sur les accents selon le navigateur.
//
// ⚠️ `prepare` ÉCHOUE EN ENOENT si une source de `PAGES` manque, et c'est voulu : une page
// déclarée mais absente doit arrêter le build, pas se sauter en silence. Corollaire pratique —
// ajouter une entrée à `PAGES` et son fichier `docs/` se fait dans le MÊME commit, sinon
// `npm run build` casse entre les deux.
//
// finish — SEULEMENT sur Vercel (`process.env.VERCEL`) : la racine du site devient la page
// d'accueil, `/en/` la page d'accueil anglaise, et l'app se déplace en `/app.html`. Partout
// ailleurs `dist/index.html` reste l'app : `npm run tauri build` lance `npm run build` et embarque
// `dist/` tel quel (`frontendDist`) — un swap inconditionnel livrerait le site dans l'installeur.
//
// `public/` est généré et gitignoré : la source reste `docs/`.
import { copyFile, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const dist = join(root, "dist");

// Le français vit à la RACINE, l'anglais sous `/en/`. Ce sens-là et pas l'inverse : déplacer le
// français casserait les URL déjà publiées (`/manuel.html` est dans le README et dans le PDF).
//
// ⚠️ `lang` n'est pas décoratif. Il part dans `<html lang>`, que les lecteurs d'écran utilisent
// pour choisir leur voix et leur prononciation — une page anglaise déclarée `fr` se fait lire
// avec une phonétique française. Le défaut reste `fr` pour que les deux entrées d'origine ne
// changent pas de comportement.
const PAGES = [
  {
    src: "accueil.html",
    out: "accueil.html",
    lang: "fr",
    description: "Sift, app desktop gratuite pour DJ : faux lossless détectés au spectrogramme, doublons, rangement au format CDJ, export Rekordbox, clé USB. Windows et macOS.",
  },
  {
    src: "manuel.html",
    out: "manuel.html",
    lang: "fr",
    description: "Manuel de Sift : installer, trois mots, les huit écrans, le clavier, ce que la détection laisse passer.",
  },
  {
    src: "accueil.en.html",
    out: "en/accueil.html",
    lang: "en",
    description: "Sift, a free desktop app for DJs: fake lossless caught on the spectrogram, duplicates, filing in CDJ format, Rekordbox export, USB drive. Windows and macOS. French interface.",
  },
  {
    src: "manuel.en.html",
    out: "en/manuel.html",
    lang: "en",
    description: "Sift manual: installing, the three words, the eight screens, the keyboard, what detection lets through. The application's interface is in French.",
  },
];

async function wrap(page) {
  const body = await readFile(join(root, "docs", page.src), "utf8");
  if (body.includes("<!doctype") || body.includes("<html")) {
    console.error(`build-site: docs/${page.src} porte déjà un squelette HTML — l'artefact et ce script attendent un fragment.`);
    process.exit(1);
  }
  const html =
    `<!doctype html>\n<html lang="${page.lang ?? "fr"}">\n<head>\n<meta charset="utf-8">\n` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    // Déclaré avant tout rendu : le canevas prend la bonne couleur dès le départ (guide dark-mode).
    '<meta name="color-scheme" content="light dark">\n' +
    // Favicon : le carré vert seul — l'échelle de dégradation de la direction de marque
    // (2026-07-03) le réserve aux 16 px, favicon compris.
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n' +
    `<meta name="description" content="${page.description}">\n` +
    "</head>\n<body>\n" +
    body +
    "\n</body>\n</html>\n";
  // `out` peut porter un dossier (`en/accueil.html`) : le créer, sinon `writeFile` échoue en
  // ENOENT et le build s'arrête sans avoir rien écrit.
  await mkdir(dirname(join(pub, page.out)), { recursive: true });
  await writeFile(join(pub, page.out), html, "utf8");
}

async function prepare() {
  await mkdir(join(pub, "screenshots"), { recursive: true });
  for (const page of PAGES) await wrap(page);
  await copyFile(join(root, "docs", "manuel.pdf"), join(pub, "manuel.pdf"));
  await copyFile(join(root, "docs", "favicon.svg"), join(pub, "favicon.svg"));
  // Toutes les variantes (PNG d'origine, AVIF/WebP bureau 1x/2x, recadrage mobile) : le <picture>
  // de l'accueil les nomme une par une.
  await cp(join(root, "docs", "screenshots"), join(pub, "screenshots"), { recursive: true });
  console.log(
    `build-site: public/{${PAGES.map((p) => p.out).join(", ")}, manuel.pdf, screenshots/*}`,
  );
}

async function finish() {
  if (!process.env.VERCEL) {
    console.log("build-site: hors Vercel, dist/index.html reste l'app (Tauri l'embarque)");
    return;
  }
  await rename(join(dist, "index.html"), join(dist, "app.html"));
  await rename(join(dist, "accueil.html"), join(dist, "index.html"));
  // Même geste sous `/en/`, à une différence près : aucune app à déplacer là, donc pas de
  // `app.html`. Sans ce rename, `/en/` rendrait 404 et seul `/en/accueil.html` répondrait.
  await rename(join(dist, "en", "accueil.html"), join(dist, "en", "index.html"));
  console.log("build-site: Vercel — racine = accueil, /en/ = accueil anglais, app en /app.html");
}

const phase = process.argv[2];
if (phase === "prepare") await prepare();
else if (phase === "finish") await finish();
else {
  console.error("usage: node scripts/build-site.mjs prepare|finish");
  process.exit(1);
}
