import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { esc } from "./dom";

const BANNER_ID = "sift-update-banner";

function renderBanner(update: Update): void {
  document.getElementById(BANNER_ID)?.remove();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.className = "sift-update-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML =
    `<span>Mise à jour ${esc(update.version)} disponible.</span>` +
    '<button data-upd="install" class="sift-update-banner-install">Installer et redémarrer</button>' +
    '<button data-upd="later" class="sift-update-banner-later">Plus tard</button>';
  document.body.appendChild(el);

  el.querySelector('[data-upd="later"]')?.addEventListener("click", () => {
    el.remove();
  });

  el.querySelector('[data-upd="install"]')?.addEventListener("click", () => {
    void installAndRelaunch(update, el);
  });
}

async function installAndRelaunch(update: Update, banner: HTMLElement): Promise<void> {
  const span = banner.querySelector("span");
  const installBtn = banner.querySelector('[data-upd="install"]') as HTMLButtonElement | null;

  if (installBtn) {
    installBtn.disabled = true;
    if (span) span.textContent = "Téléchargement…";
  }

  try {
    await update.downloadAndInstall();
    if (span) span.textContent = "Installation terminée, redémarrage...";
    await relaunch();
  } catch (e) {
    // .textContent, not .innerHTML — the browser escapes it on assignment, so esc() here
    // would double-encode entities (literal "&amp;" shown to the user instead of "&").
    if (span) span.textContent = `Échec de la mise à jour : ${String(e)}`;
    if (installBtn) installBtn.disabled = false;
    console.error("update install failed", e);
  }
}

/** Checks for an update once, at app launch. Called only from the `inTauri` block in
 *  main.ts — this module talks to the real updater plugin and has no meaning outside
 *  a running Tauri shell. No periodic re-check: release cadence is one-off, not
 *  scheduled (design.md, Contexte). */
export async function installUpdateBanner(): Promise<void> {
  try {
    const update = await check();
    if (update?.available) {
      renderBanner(update);
    }
  } catch (e) {
    // Silent: two expected causes, neither worth interrupting the user for. (1) No network /
    // GitHub unreachable — the real-world case on a signed release build. (2) The updater plugin
    // itself never registered — happens on every dev/unsigned-CI build, where plugins.updater has
    // no config to merge (see lib.rs's setup()); the IPC command this calls simply doesn't exist
    // there. Logged only, both cases.
    console.error("update check failed", e);
  }
}
