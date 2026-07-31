// Live Réglages screen — extracted from sift-live.ts (clean-architecture audit F1,
// 2026-07-09): this was one of several full-screen renderers still inlined in the
// god-module after ecartes-view.ts/home-sources.ts/journal.ts were split out.
// Self-contained: unlike Bibliothèque/Rekordbox, no state here is mutated from
// installLiveWiring's delegated click handler, so no cross-module state wiring is needed.
import { getSetting, setSetting, openUrl, previewFilename } from "./ipc";
import { DEFAULT_FILENAME_TEMPLATE } from "../shared/contracts";
import type { Canonical } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { setTheme } from "./theme";
import type { ThemeChoice } from "./theme";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";

/** Live Réglages view: a single scrolling page of real cards (Discogs, Bibliothèque, Apparence),
 * replacing the mockup's static placeholder rows (Dossiers source, Format lossless…), which have
 * no backing data and led nowhere — same "lean Tauri UI" pattern as home-sources.ts (hide the mock
 * content, keep only the title, inject the real thing). One page, not tabs: every card is always
 * visible and reachable by scrolling, per the maquette's "PAS des onglets exclusifs" rule. */
export async function renderReglagesLive() {
  const content = requireEl("#content", "renderReglagesLive");

  // Remove any previous live-settings wrapper so we don't duplicate on re-render.
  // All cards live inside this single wrapper (not as separate #content siblings)
  // so a future card can't be forgotten here the way libBlock/themeBlock once were.
  document.getElementById("sift-reglages-live")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "sift-reglages-live";
  wrap.className = "sift-screen-stack sift-settings-stack";

  // Hide the mockup's static rows (no real data behind them); keep only the page title.
  let title: Element | null = null;
  for (const child of Array.from(content.children)) {
    if (!title && child.classList.contains("h1")) {
      title = child;
      continue;
    }
    (child as HTMLElement).style.display = "none";
  }

  let token: string | null = null;
  try {
    token = await getSetting("discogs_token");
  } catch (e) {
    console.error("getSetting(discogs_token) failed", e);
  }
  let theme: ThemeChoice = "auto";
  try {
    const v = await getSetting("ui_theme");
    if (v === "light" || v === "dark") theme = v;
  } catch (e) {
    console.error("getSetting(ui_theme) failed", e);
  }
  let root: string | null = null;
  try {
    root = await getSetting("library_root");
  } catch (e) {
    console.error("getSetting(library_root) failed", e);
  }
  // Vide/absent = jamais personnalisé → on montre le défaut. `DEFAULT_FILENAME_TEMPLATE` vient de
  // `shared/contracts.ts`, miroir de `settings::DEFAULT_TEMPLATE` tenu par un test de contrat —
  // pas un littéral recopié ici.
  let tmpl = DEFAULT_FILENAME_TEMPLATE;
  try {
    const saved = await getSetting("filename_template");
    if (saved && saved.trim()) tmpl = saved;
  } catch (e) {
    console.error("getSetting(filename_template) failed", e);
  }

  // Cartes bordées + titre 16px/600 + texte explicatif, per la maquette (Sift.dc.html:642-691).
  // Divergence assumée : le jeton reste un input à sauvegarde auto (fonctionnel) au lieu du
  // "•••• 4471 + Modifier" de la maquette, dont le bouton est un onNotImpl de démo.
  const block = document.createElement("div");
  block.id = "sift-reglages-discogs";
  block.dataset.section = "discogs";
  block.className = "sift-settings-card sift-settings-list-row";
  block.innerHTML =
    '<div class="sift-settings-title">Discogs</div>' +
    '<div class="sift-settings-desc">Le jeton permet à Sift d\'interroger l\'API Discogs pour identifier tes morceaux (label, année, genre). Sans jeton, les recherches sont limitées et plus lentes.</div>' +
    '<div class="sift-settings-row sift-settings-row-stack">' +
    '<div class="sift-settings-row-head">' +
    '<label for="sift-discogs-token" class="sift-settings-label">Jeton d\'accès</label>' +
    '<a id="sift-discogs-link" class="sift-settings-link">' +
    '<i class="ti ti-external-link" style="font-size:var(--text-sm);vertical-align:-1px"></i> obtenir un jeton</a>' +
    "</div>" +
    // Masked like any credential (audit UI/UX 2026-07-03, fix 8) — a screenshot/share of Réglages
    // must not leak the token in clear text. Eye toggle to check it without retyping.
    '<div style="position:relative;width:100%">' +
    // class="sift-editor-input" instead of an inline-duplicated border/background (2026-07-10,
    // fix for a specificity bug this duplication caused: an inline `style="border:..."` always
    // beats a stylesheet rule, even :focus-visible, so this field's border silently didn't
    // shift color on focus while every other input using the shared class did).
    `<input id="sift-discogs-token" type="password" placeholder="Jeton Discogs…" value="${esc(token ?? "")}" class="sift-editor-input" style="width:100%;font-family:var(--font-mono);padding-right:30px">` +
    '<button type="button" id="sift-discogs-token-toggle" title="Afficher le jeton" aria-label="Afficher le jeton" style="position:absolute;right:2px;top:50%;transform:translateY(-50%);width:26px;height:26px;padding:0;border:none;background:transparent;color:var(--color-text-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti ti-eye" style="font-size:var(--text-md)"></i></button>' +
    "</div>" +
    '<div id="sift-discogs-status" style="font-size:var(--text-sm);color:var(--color-text-tertiary);min-height:14px"></div>' +
    "</div>";

  const libBlock = document.createElement("div");
  libBlock.id = "sift-reglages-bibliotheque";
  libBlock.dataset.section = "bibliotheque";
  libBlock.className = "sift-settings-card sift-settings-list-row";
  libBlock.innerHTML =
    '<div class="sift-settings-title">Bibliothèque</div>' +
    '<div class="sift-settings-desc">Le dossier racine est l\'endroit réel sur ton disque où Sift convertit les morceaux filés. L\'arborescence de destination (House/Deep, Techno…) vit à l\'intérieur.</div>' +
    '<div class="sift-settings-row">' +
    '<div style="min-width:0">' +
    '<div class="sift-settings-label" style="margin-bottom:3px">Dossier racine</div>' +
    `<div style="font-size:var(--text-md);font-family:var(--font-mono);color:${
      root ? "var(--color-text-tertiary)" : "var(--color-text-quaternary)"
    };overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(root || "Aucun dossier sélectionné")}</div>` +
    "</div>" +
    '<button id="sift-lib-root-change" class="sift-settings-btn">Changer…</button>' +
    "</div>" +
    (root
      ? '<div class="sift-settings-subactions"><button id="sift-lib-root-forget" type="button" class="sift-settings-btn sift-settings-btn-quiet">Oublier le dossier racine</button></div>'
      : "") +
    '<div id="sift-lib-root-status" style="font-size:var(--text-sm);color:var(--color-text-tertiary);min-height:14px"></div>';
  const libStatus = libBlock.querySelector<HTMLElement>("#sift-lib-root-status");
  libBlock.querySelector("#sift-lib-root-change")?.addEventListener("click", () => {
    void (async () => {
      const dir = await openFolderDialog({ directory: true, multiple: false });
      if (typeof dir !== "string") return;
      try {
        await setSetting("library_root", dir);
        void renderReglagesLive();
      } catch (e) {
        if (libStatus) libStatus.textContent = "Erreur d'enregistrement.";
        console.error("setSetting(library_root) failed", e);
      }
    })();
  });
  libBlock.querySelector("#sift-lib-root-forget")?.addEventListener("click", () => {
    void (async () => {
      try {
        await setSetting("library_root", "");
        void renderReglagesLive();
      } catch (e) {
        if (libStatus) libStatus.textContent = "Erreur d'enregistrement.";
        console.error("setSetting(library_root) failed", e);
      }
    })();
  });

  // Deux pistes d'exemple : l'une AVEC version, l'autre sans. C'est le seul moyen de voir ce que
  // `{version}` fait réellement — y compris qu'il ne laisse pas de parenthèses vides quand la
  // piste n'en a pas.
  const TPL_SAMPLES: ReadonlyArray<{ c: Canonical; ext: string }> = [
    {
      c: { artist: "Chez Damier", title: "Can You Feel It", version: "Fluent Remix", confidence: "green" },
      ext: "aiff",
    },
    { c: { artist: "Mr Fingers", title: "Mystery of Love", version: null, confidence: "green" }, ext: "mp3" },
  ];

  const tplBlock = document.createElement("div");
  tplBlock.id = "sift-reglages-nommage";
  tplBlock.dataset.section = "nommage";
  tplBlock.className = "sift-settings-card sift-settings-list-row";
  tplBlock.innerHTML =
    '<div class="sift-settings-title">Modèle de nommage</div>' +
    '<div class="sift-settings-desc">Le nom que Sift donne aux fichiers qu\'il range. Trois champs disponibles, à insérer d\'un clic. <code>{version}</code> se rend en «&nbsp;(Remix)&nbsp;» quand la piste en a une, et disparaît sinon — pas de parenthèses vides.</div>' +
    '<div class="sift-settings-row sift-settings-row-stack">' +
    '<div class="sift-settings-row-head">' +
    '<div class="sift-settings-label">Modèle</div>' +
    '<div class="sift-tpl-chips">' +
    ["{artist}", "{title}", "{version}"]
      .map((p) => `<button type="button" class="sift-tpl-chip" data-tpl-ph="${esc(p)}">${esc(p)}</button>`)
      .join("") +
    "</div></div>" +
    `<input id="sift-tpl-input" class="sift-editor-input sift-tpl-input" spellcheck="false" aria-label="Modèle de nommage" value="${esc(tmpl)}">` +
    "</div>" +
    '<div class="sift-settings-row sift-settings-row-stack">' +
    '<div class="sift-tpl-preview-label">Aperçu</div>' +
    '<div id="sift-tpl-preview" class="sift-tpl-preview"></div>' +
    '<div id="sift-tpl-warn" class="sift-tpl-warn" hidden></div>' +
    "</div>" +
    '<div class="sift-settings-subactions">' +
    '<button type="button" id="sift-tpl-save" class="sift-settings-btn">Enregistrer</button>' +
    '<button type="button" id="sift-tpl-reset" class="sift-settings-btn sift-settings-btn-quiet">Revenir au modèle par défaut</button>' +
    "</div>" +
    '<div id="sift-tpl-status" class="sift-tpl-status"></div>';

  const tplInput = tplBlock.querySelector<HTMLInputElement>("#sift-tpl-input");
  const tplPreview = tplBlock.querySelector<HTMLElement>("#sift-tpl-preview");
  const tplWarn = tplBlock.querySelector<HTMLElement>("#sift-tpl-warn");
  const tplStatus = tplBlock.querySelector<HTMLElement>("#sift-tpl-status");

  // Les deux lignes d'aperçu sont créées UNE fois ; le handler de frappe ne mute que leur
  // `textContent`. `input` est un événement en rafale (une frappe = un tir) : reconstruire le DOM
  // ici saturerait le thread UI, cf. CLAUDE.md § Front — événements répétés.
  const tplLines = TPL_SAMPLES.map(() => {
    const el = document.createElement("div");
    el.className = "sift-tpl-preview-line";
    tplPreview?.appendChild(el);
    return el;
  });

  /** Avertissement, jamais un blocage : retirer un champ est légitime si on sait ce qu'on fait —
   *  l'aperçu montre déjà la conséquence, et `ensure_unique` gère la collision côté rangement. */
  function tplWarning(t: string): string {
    if (!t.trim()) return "Un modèle vide n'est pas utilisable.";
    if (!t.includes("{title}"))
      return "Sans {title}, deux morceaux du même artiste produisent le même nom — Sift ajoutera un suffixe numérique pour éviter l'écrasement.";
    if (!t.includes("{artist}"))
      return "Sans {artist}, les reprises et remixes d'un même titre se retrouvent côte à côte sans distinction.";
    return "";
  }

  // Un aperçu = 2 appels IPC. Débounce pour ne pas en tirer un par frappe, et garde de séquence
  // pour qu'une réponse lente n'écrase pas le résultat d'une frappe plus récente.
  let tplDebounce: ReturnType<typeof setTimeout> | undefined;
  let tplSeq = 0;
  function refreshTplPreview(): void {
    const t = tplInput?.value ?? "";
    const w = tplWarning(t);
    if (tplWarn) {
      tplWarn.textContent = w;
      tplWarn.hidden = !w;
    }
    clearTimeout(tplDebounce);
    tplDebounce = setTimeout(() => {
      const mine = ++tplSeq;
      void Promise.all(TPL_SAMPLES.map((s) => previewFilename(s.c, s.ext, t)))
        .then((names) => {
          if (mine !== tplSeq) return; // une frappe plus récente a déjà répondu
          names.forEach((n, i) => {
            const line = tplLines[i];
            if (line) line.textContent = `→ ${n}`;
          });
        })
        .catch((e: unknown) => {
          if (mine !== tplSeq) return;
          console.error("[preview_filename] apercu du modele", e);
          tplLines.forEach((l) => {
            l.textContent = "→ aperçu indisponible";
          });
        });
    }, 120);
  }

  tplInput?.addEventListener("input", refreshTplPreview);
  tplBlock.querySelectorAll<HTMLElement>("[data-tpl-ph]").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!tplInput) return;
      const ph = chip.dataset.tplPh ?? "";
      const s = tplInput.selectionStart ?? tplInput.value.length;
      const e = tplInput.selectionEnd ?? s;
      tplInput.value = tplInput.value.slice(0, s) + ph + tplInput.value.slice(e);
      tplInput.focus();
      const caret = s + ph.length;
      tplInput.setSelectionRange(caret, caret);
      refreshTplPreview();
    });
  });
  tplBlock.querySelector("#sift-tpl-reset")?.addEventListener("click", () => {
    if (!tplInput) return;
    tplInput.value = DEFAULT_FILENAME_TEMPLATE;
    if (tplStatus) tplStatus.textContent = "";
    refreshTplPreview();
  });
  tplBlock.querySelector("#sift-tpl-save")?.addEventListener("click", () => {
    void (async () => {
      const t = tplInput?.value ?? "";
      if (!t.trim()) {
        if (tplStatus) tplStatus.textContent = "Un modèle vide n'est pas enregistrable.";
        return;
      }
      try {
        await setSetting("filename_template", t);
        if (tplStatus) tplStatus.textContent = "Modèle enregistré.";
      } catch (e) {
        console.error("[setSetting(filename_template)] enregistrement", e);
        if (tplStatus) tplStatus.textContent = "Échec de l'enregistrement — réessaie.";
      }
    })();
  });
  refreshTplPreview();

  const themeBlock = document.createElement("div");
  themeBlock.id = "sift-reglages-apparence";
  themeBlock.dataset.section = "apparence";
  themeBlock.className = "sift-settings-card sift-settings-list-row";
  // Audit-ref G1 (Réglages, 2026-07-09) : <span> → <button>, incohérent avec le reste de l'app.
  const themeBtn = (v: ThemeChoice, label: string) =>
    `<button class="sift-seg-opt${theme === v ? " on" : ""}" data-theme-choice="${v}">${label}</button>`;
  // Audit-ref (Réglages, 2026-07-09, retour Antoine "on n'a pas l'animation pour toutes les
  // pastilles") : thumb glissant ajouté ici — son DOM persiste déjà entre les clics (classList
  // toggle en place, pas de re-render), donc éligible sans restructuration (contrairement à
  // Dossiers/Genres et Session/Historique, qui reconstruisent tout via innerHTML à chaque clic —
  // voir css-transition-requires-persisting-dom en mémoire). Même pattern que positionFmtThumb().
  themeBlock.innerHTML =
    '<div class="sift-settings-title">Apparence</div>' +
    '<div class="sift-settings-desc">Auto suit le réglage clair/sombre de ton système. Clair et Sombre forcent un mode fixe, quel que soit le système.</div>' +
    '<div class="sift-settings-row">' +
    '<span class="sift-settings-label">Thème</span>' +
    '<div class="sift-seg sift-seg-thumbed">' +
    '<div class="sift-seg-thumb"></div>' +
    themeBtn("auto", "Auto") +
    themeBtn("light", "Clair") +
    themeBtn("dark", "Sombre") +
    "</div></div>";
  function positionThemeThumb(): void {
    const thumb = themeBlock.querySelector<HTMLElement>(".sift-seg-thumb");
    const onEl = themeBlock.querySelector<HTMLElement>("[data-theme-choice].on");
    if (!thumb || !onEl) return;
    thumb.style.width = `${onEl.offsetWidth}px`;
    thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
  }
  // Not called here yet — themeBlock isn't attached to the live DOM until content.appendChild(wrap)
  // below, and offsetWidth/offsetLeft read 0 on a detached element. Called after that instead.
  themeBlock.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) =>
    el.addEventListener("click", () => {
      const choice = el.dataset.themeChoice as ThemeChoice;
      void setTheme(choice);
      themeBlock.querySelectorAll("[data-theme-choice]").forEach((c) => c.classList.remove("on"));
      el.classList.add("on");
      positionThemeThumb();
    }),
  );

  // NB : la carte « Formater une clé USB » a quitté cet écran le 2026-07-31 — elle est le contenu
  // de l'onglet Clé USB (`usb-view.ts`), qui a désormais son propre écran. Ne pas la réintroduire
  // ici : tout ce qui touche la clé USB vit dans cet onglet, une seule source.

  // Single wrapper: only #sift-reglages-live is removed/recreated per render (see the
  // 2026-07-04 fix), so every settings card — present or future — must build inside `wrap`
  // rather than as a direct sibling of `content`, or it duplicates on re-render.
  //
  // 2026-07-08: the 4 sections used to each be their own .sift-ui-card-soft box, but each one
  // only ever holds a single setting — a box groups "related information" (HIG "Boxes"),
  // grouping one item alone just adds chrome (retour utilisateur : "trop de boîtes"). They now
  // share one .sift-ui-card-soft list, divided by a hairline (.sift-settings-list-row) instead
  // of 4 separate cards. Any future settings section must append inside `list`, same rule as
  // `wrap` above — not as a direct sibling of `content`.
  const list = document.createElement("div");
  list.id = "sift-reglages-list";
  list.className = "sift-settings-list sift-ui-card-soft sift-ui-card-soft-pad";
  list.appendChild(block);
  list.appendChild(libBlock);
  // Après Bibliothèque : le modèle décrit comment nommer DANS la racine qu'elle définit.
  list.appendChild(tplBlock);
  list.appendChild(themeBlock);
  wrap.appendChild(list);
  content.appendChild(wrap);
  positionThemeThumb(); // now attached to the live DOM — offsetWidth/offsetLeft resolve correctly

  const inp = block.querySelector<HTMLInputElement>("#sift-discogs-token");
  const status = block.querySelector<HTMLElement>("#sift-discogs-status");
  const link = block.querySelector<HTMLElement>("#sift-discogs-link");
  const toggle = block.querySelector<HTMLButtonElement>("#sift-discogs-token-toggle");

  toggle?.addEventListener("click", () => {
    if (!inp) return;
    const shown = inp.type === "text";
    inp.type = shown ? "password" : "text";
    toggle.title = shown ? "Afficher le jeton" : "Masquer le jeton";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.innerHTML = `<i class="ti ${shown ? "ti-eye" : "ti-eye-off"}" style="font-size:var(--text-md)"></i>`;
  });

  link?.addEventListener("click", () =>
    void openUrl("https://www.discogs.com/settings/developers").catch((e) =>
      console.error("openUrl failed", e),
    ),
  );

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  inp?.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const val = inp.value.trim();
      try {
        await setSetting("discogs_token", val);
        if (status) {
          status.textContent = val ? "Jeton enregistré." : "Jeton effacé.";
          setTimeout(() => {
            if (status) status.textContent = "";
          }, 2000);
        }
      } catch (e) {
        if (status) status.textContent = "Erreur d'enregistrement.";
        console.error("setSetting(discogs_token) failed", e);
      }
    }, 600);
  });
}
