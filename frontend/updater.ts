import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { esc } from "./dom";
import { lang } from "./i18n";
import { T } from "./i18n/updater";
import { summariseNotes } from "./update-notes";

const BANNER_ID = "sift-update-banner";

function renderBanner(update: Update): void {
  document.getElementById(BANNER_ID)?.remove();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.className = "sift-update-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  // `update.body` porte les notes de version : `releaseBody` de release.yml, extrait de
  // CHANGELOG.md, recopié par tauri-action dans le champ `notes` de `latest.json`. Texte
  // d'origine EXTERNE (téléchargé depuis GitHub) rendu par innerHTML — `esc()` obligatoire.
  //
  // Tronqué : la bannière est une barre, pas un écran de notes. Le changelog complet vit sur la
  // page de la release, et le lire n'est pas ce qu'on demande à quelqu'un avant d'installer.
  const notes = summariseNotes(update.body, lang());
  const t = T();
  el.innerHTML =
    `<span>${t.disponible(esc(update.version))}` +
    (notes ? ` <span class="sift-update-banner-notes">${esc(notes)}</span>` : "") +
    "</span>" +
    `<button data-upd="install" class="sift-update-banner-install">${t.installer}</button>` +
    `<button data-upd="later" class="sift-update-banner-later">${t.plusTard}</button>`;
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
    if (span) span.textContent = T().telechargement;
  }

  try {
    await update.downloadAndInstall();
    if (span) span.textContent = T().redemarrage;
    await relaunch();
  } catch (e) {
    // .textContent, not .innerHTML — the browser escapes it on assignment, so esc() here
    // would double-encode entities (literal "&amp;" shown to the user instead of "&").
    if (span) span.textContent = T().echec(String(e));
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
