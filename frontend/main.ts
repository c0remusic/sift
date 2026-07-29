// Self-hosted UI fonts — Outfit (UI: 400 body, 600 titles/labels) + JetBrains Mono (numbers).
// Bundled via @fontsource so the desktop app needs no network. See system.md (Typographie).
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import "@fontsource/jetbrains-mono/400.css";
// Police d'icones, meme regle que les trois ci-dessus. Elle etait chargee depuis un CDN par un
// <link> dans index.html, seule ressource reseau restante de l'app : hors ligne — en club, en
// cabine, sur une machine sans wifi — TOUTE l'iconographie tombait en tofu, y compris les icones
// de la barre de titre et du rail de navigation. Audit 2026-07-28, SIMP-1.
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import "@tabler/icons-webfont/dist/tabler-icons-filled.min.css";
import "./app.js";
import { invoke } from "@tauri-apps/api/core";
import { appInfo, dbHealth, ffmpegVersion } from "./ipc";
import { installLiveWiring } from "./sift-live";
import { installUpdateBanner } from "./updater";

// Only exercise the IPC layer inside the Tauri app. In a plain browser (e.g. the
// Vercel web demo) there is no Tauri runtime — skip it so the UI renders cleanly.
const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

if (inTauri) {
  installLiveWiring();
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

  // Headless playback self-test: exercises the real audio-load path on every queued track
  // and logs OK/FAIL per file (no manual clicks). Auto-runs with VITE_SIFT_SELFTEST=1; also
  // exposed as window.__siftSelfTest() to trigger from devtools.
  void import("./selftest").then((m) => {
    (window as { __siftSelfTest?: () => void }).__siftSelfTest = () => void m.runSelfTest();
    if ((import.meta as { env?: Record<string, string> }).env?.VITE_SIFT_SELFTEST === "1") {
      setTimeout(() => void m.runSelfTest(), 2500);
    }
  });

  // Click-to-source inspector (Alt+Click), dev builds only — never in a shipped app.
  if (import.meta.env.DEV) {
    void import("./dev-inspector").then((m) => m.installDevInspector());
  }
}
