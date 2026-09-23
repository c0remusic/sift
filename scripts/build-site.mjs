// Le site Vercel (https://sift-music.vercel.app) est le build Vite de l'app plus des pages posées
// à côté : accueil et manuel en FRANÇAIS à la racine, les mêmes en ANGLAIS sous `/en/`, et le
// manuel en PDF, un par langue.
//
// ⚠️ LES PDF NE SE CONSTRUISENT PAS ICI, et aucun script ne les fabrique. Ils sont produits
// a la main par IMPRESSION NAVIGATEUR de la page servie, avec son CSS `@media print` :
//
//   msedge --headless --disable-gpu --no-pdf-header-footer
//          --run-all-compositor-stages-before-draw --virtual-time-budget=20000
//          --print-to-pdf=<cible> http://localhost:5173/<page>
//
// Le procede n'etait ecrit nulle part avant le 2026-09-23. Il a ete retrouve en REJOUANT le
// PDF francais avec cette commande : 7 pages des deux cotes, taille a 0,6 % pres du fichier
// commite — donc c'est bien le procede d'origine (commit a142ac8, « 6 pages, verifiees page
// par page »). Refaire un PDF apres avoir edite un manuel, sinon il ment.
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
    // ⚠️ `/` et pas `/accueil.html` : `finish()` renomme la page en `index.html` sur Vercel.
    url: "/",
    groupe: "accueil",
    description: "Sift, app desktop gratuite pour DJ : faux lossless détectés au spectrogramme, doublons, rangement au format CDJ, export Rekordbox, clé USB. Windows et macOS.",
  },
  {
    src: "manuel.html",
    out: "manuel.html",
    lang: "fr",
    url: "/manuel.html",
    groupe: "manuel",
    description: "Manuel de Sift : installer, trois mots, les huit écrans, le clavier, ce que la détection laisse passer.",
  },
  {
    src: "accueil.en.html",
    out: "en/accueil.html",
    lang: "en",
    url: "/en/",
    groupe: "accueil",
    description: "Sift, a free desktop app for DJs: fake lossless caught on the spectrogram, duplicates, filing in CDJ format, Rekordbox export, USB drive. Windows and macOS. French interface.",
  },
  {
    src: "manuel.en.html",
    out: "en/manuel.html",
    lang: "en",
    url: "/en/manuel.html",
    groupe: "manuel",
    description: "Sift manual: installing, the three words, the eight screens, the keyboard, what detection lets through. The application's interface is in French.",
  },
];

async function wrap(page) {
  const body = await readFile(join(root, "docs", page.src), "utf8");
  if (body.includes("<!doctype") || body.includes("<html")) {
    console.error(`build-site: docs/${page.src} porte déjà un squelette HTML — l'artefact et ce script attendent un fragment.`);
    process.exit(1);
  }
  // Les alternates se DÉRIVENT de `PAGES` : une page traduite ajoutée à la table déclare ses
  // alternates toute seule, et aucune liste parallèle ne peut dériver de celle-ci.
  //
  // ⚠️ Pourquoi ça compte, mesuré sur le site EN LIGNE le 2026-09-23 : les quatre pages ne
  // portaient AUCUN lien entre versions linguistiques. Le site anglais était donc inatteignable
  // sauf à deviner son URL. Un lien visible a été ajouté dans chaque page pour un LECTEUR ; ces
  // `hreflang` sont le même signal pour une MACHINE, et l'un ne remplace pas l'autre.
  //
  // `x-default` désigne le français : c'est la langue d'origine du produit et celle de son
  // interface (`content.md` § Langue).
  const alternates = PAGES.filter((p) => p.groupe === page.groupe && p.url)
    .map((p) => `<link rel="alternate" hreflang="${p.lang}" href="${p.url}">\n`)
    .join('');
  const defaut = PAGES.find((p) => p.groupe === page.groupe && p.lang === 'fr');
  const xDefault = defaut ? `<link rel="alternate" hreflang="x-default" href="${defaut.url}">\n` : '';

  const html =
    `<!doctype html>\n<html lang="${page.lang ?? "fr"}">\n<head>\n<meta charset="utf-8">\n` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    // Déclaré avant tout rendu : le canevas prend la bonne couleur dès le départ (guide dark-mode).
    '<meta name="color-scheme" content="light dark">\n' +
    // Favicon : le carré vert seul — l'échelle de dégradation de la direction de marque
    // (2026-07-03) le réserve aux 16 px, favicon compris.
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n' +
    `<meta name="description" content="${page.description}">\n` +
    alternates +
    xDefault +
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
  // Un PDF par langue. Ils vivent a la RACINE du site et pas sous `/en/` : ce sont des
  // fichiers, pas des pages, et le lien de chaque accueil les nomme explicitement.
  await copyFile(join(root, "docs", "manuel.pdf"), join(pub, "manuel.pdf"));
  await copyFile(join(root, "docs", "manuel.en.pdf"), join(pub, "manuel.en.pdf"));
  await copyFile(join(root, "docs", "favicon.svg"), join(pub, "favicon.svg"));
  // Toutes les variantes (PNG d'origine, AVIF/WebP bureau 1x/2x, recadrage mobile) : le <picture>
  // de l'accueil les nomme une par une.
  await cp(join(root, "docs", "screenshots"), join(pub, "screenshots"), { recursive: true });
  console.log(
    `build-site: public/{${PAGES.map((p) => p.out).join(", ")}, manuel.pdf, manuel.en.pdf, screenshots/*}`,
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
