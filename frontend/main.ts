// Self-hosted UI fonts — Outfit (UI: 400 body, 500 medium, 600 titles/labels) + JetBrains Mono
// (numbers). Bundled via @fontsource so the desktop app needs no network. See system.md
// (Typographie).
// La 500 n'etait PAS importee jusqu'au 2026-08-14, alors que styles.css la declare 24 fois. Sans
// face correspondante, l'algorithme de matching de CSS Fonts 4 essaie les graisses INFERIEURES
// avant les superieures : les 24 sites peignaient donc du 400, silencieusement. Mesure dans la
// vraie fenetre (issue #33) : meme libelle a 242,109 px en 400 ET en 500, contre 247,109 en 600.
// Piege associe — `document.fonts.check('500 13px Outfit')` repond `true` meme sans la face, car
// il dit qu'un texte peut etre rendu, pas qu'il le sera a la bonne graisse. Seule la largeur
// discrimine. Trois graisses et pas deux : decision d'Antoine, alignee sur la table de styles
// macOS d'Apple, ou Medium est une graisse de premiere classe (Caption 2) et ou Headline et Body
// ne different QUE par la graisse a metriques identiques.
// Le meme oubli vivait encore sur l'AUTRE famille au 2026-08-18 : trois regles demandent du
// mono en 500 et 600 — `.sift-time-elapsed,.sift-time-total` (styles.css:1145),
// `.sift-key-btn` (1224), `.sift-usage-tip-ext` (1814) — et seule la 400 etait importee.
// Meme silence, meme synthese approximative. Trouve en ecrivant `test/font-weights.test.ts`,
// qui confronte desormais les deux fichiers a chaque `npm run test`.
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
// Police d'icones, meme regle que les trois ci-dessus. Elle etait chargee depuis un CDN par un
// <link> dans index.html, seule ressource reseau restante de l'app : hors ligne — en club, en
// cabine, sur une machine sans wifi — TOUTE l'iconographie tombait en tofu, y compris les icones
// de la barre de titre et du rail de navigation. Audit 2026-07-28, SIMP-1.
// La feuille `tabler-icons-filled.min.css` du meme paquet NE DOIT PAS etre importee ici, et
// styles.css:1675 le disait deja : elle redefinit `.ti` avec `font-family:"tabler-icons-filled"
// !important`, donc l'ordre des imports n'y change rien. Importee le 2026-07-28 (audit SIMP-1)
// pour recuperer son @font-face, elle a bascule TOUTES les icones de l'app sur la police pleine,
// et les trois glyphes sans variante pleine ont rendu a vide : Accueil (ti-home), Journal
// (ti-history), Cle USB (ti-usb) mesurees a 0 px de large dans la vraie fenetre le 2026-08-11
// (issue #22), contre 17 px pour les cinq autres entrees du rail. Le @font-face de la police
// pleine est declare a la main dans styles.css, ou seule `.ti-fill` l'utilise.
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import { invoke } from "@tauri-apps/api/core";
import { appInfo, dbHealth, ffmpegVersion } from "./ipc";
import { installLiveWiring } from "./sift-live";
import { installRouter } from "./router";
import { installUpdateBanner } from "./updater";

// Only exercise the IPC layer inside the Tauri app. In a plain browser (e.g. the
// Vercel web demo) there is no Tauri runtime — skip it so the UI renders cleanly.
const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// `app.js` — la maquette d'origine — n'est PLUS importée sans condition (étape 1 de
// DESIGN.md § 17). Elle routait l'app réelle : état de vue, clic `[data-view]`, coquilles,
// titre, et six de ses sept renderers de démo étaient neutralisés par un garde `inTauri`
// répété six fois pour ne pas écraser les vraies données. `router.ts` reprend ce qu'elle
// fournissait à la production ; elle redevient ce qu'elle est, une démo navigateur, et ses
// gardes `inTauri` y sont désormais toujours faux — elle rend donc enfin sa maquette complète.
// Import dynamique : Vite l'élimine ainsi du chemin de démarrage de l'app de bureau.
if (!inTauri) void import("./app.js");

if (inTauri) {
  installLiveWiring();
  installRouter();
  void installUpdateBanner();
  (async () => {
    try {
      const info = await appInfo();
      const health = await dbHealth();
      const ff = await ffmpegVersion();
      const detail = `${info.name} v${info.version} · db schema=${health.schema_version} tables=${health.tables} · ffmpeg=${ff}`;
      console.log("Sift IPC contract OK", detail);
      await invoke("report_smoke", { ok: true, detail });
    } catch (e) {
      console.error("IPC smoke failed", e);
      await invoke("report_smoke", { ok: false, detail: String(e) });
    }
  })();

  // Outils de développement uniquement — jamais dans une app expédiée. Le self-test était chargé
  // INCONDITIONNELLEMENT, alors que seul un développeur le déclenche (`VITE_SIFT_SELFTEST=1` ou
  // `window.__siftSelfTest()` depuis les devtools) : le `import.meta.env.DEV` permet à Vite de
  // l'éliminer statiquement du build de production. Gain mesuré modeste (~2,5 ko : le chunk
  // `selftest-*.js` disparaît, l'index passe de 294,35 à 293,41 ko) — il ne fait PAS sortir
  // wavesurfer, contrairement à ce qu'on pourrait croire : `report-view.ts` l'importe
  // statiquement et est lui-même importé statiquement par `filing.ts`, `filing-identify.ts` et
  // `library-detail.ts`, donc il reste dans le chunk principal quoi qu'il arrive.
  if (import.meta.env.DEV) {
    // Headless playback self-test: exercises the real audio-load path on every queued track
    // and logs OK/FAIL per file (no manual clicks). Auto-runs with VITE_SIFT_SELFTEST=1; also
    // exposed as window.__siftSelfTest() to trigger from devtools.
    void import("./selftest").then((m) => {
      (window as { __siftSelfTest?: () => void }).__siftSelfTest = () => void m.runSelfTest();
      if ((import.meta as { env?: Record<string, string> }).env?.VITE_SIFT_SELFTEST === "1") {
        setTimeout(() => void m.runSelfTest(), 2500);
      }
    });

    // Click-to-source inspector (Alt+Click).
    void import("./dev-inspector").then((m) => m.installDevInspector());
  }
}
