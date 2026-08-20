// Live Réglages screen — extracted from sift-live.ts (clean-architecture audit F1,
// 2026-07-09): this was one of several full-screen renderers still inlined in the
// god-module after ecartes-view.ts/journal.ts were split out.
// Self-contained: unlike Bibliothèque/Rekordbox, no state here is mutated from
// installLiveWiring's delegated click handler, so no cross-module state wiring is needed.
import { getSetting, setSetting, openUrl, previewFilename, verifyDiscogsToken } from "./ipc";
import { identifyErrorText } from "./identify-shared";
import { DEFAULT_FILENAME_TEMPLATE } from "../shared/contracts";
import type { Canonical } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { slideSegThumb } from "./seg-thumb";
import { setTheme } from "./theme";
import type { ThemeChoice } from "./theme";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";

/** Live Réglages view: a single scrolling page of real cards (Discogs, Bibliothèque, Apparence),
 * replacing the mockup's static placeholder rows (Dossiers source, Format lossless…), which have
 * no backing data and led nowhere — same "lean Tauri UI" pattern as usb-view.ts (hide the mock
 * content, keep only the title, inject the real thing). One page, not tabs: every card is always
 * visible and reachable by scrolling, per the maquette's "PAS des onglets exclusifs" rule. */
/** Libellés des catégories, indexés par la clé `dataset.section` que chaque bloc porte déjà.
 *  Une clé sans libellé retombe sur la clé elle-même : une section neuve apparaît donc dans la
 *  colonne, mal nommée mais VISIBLE — un oubli qui se voit vaut mieux qu'une section introuvable. */
const SECTION_LABELS: Record<string, string> = {
  discogs: "Identification",
  bibliotheque: "Bibliothèque",
  nommage: "Nommage",
  apparence: "Apparence",
};

/** Catégorie affichée. Au niveau module : l'écran se re-rend à chaque réglage appliqué (pas de
 *  bouton Enregistrer, application immédiate), et un état local retomberait sur la première
 *  catégorie à chaque frappe dans le champ de jeton. */
let activeSection = "discogs";

/** Montre une seule section et marque son entrée. Les autres sont retirées du flux par `hidden`,
 *  pas seulement masquées : un champ dans une section cachée resterait tabulable. */
function selectSettingsCategory(key: string): void {
  activeSection = key;
  document.querySelectorAll<HTMLElement>("#sift-reglages-list > [data-section]").forEach((el) => {
    el.hidden = el.dataset.section !== key;
  });
  document.querySelectorAll<HTMLElement>('[data-reglages="cat"]').forEach((el) => {
    el.classList.toggle("on", el.dataset.cat === key);
  });
  // Apparence redevient visible : rejouer le placement du pouce du segmenté Thème. Il se mesure sur
  // `offsetWidth`/`offsetLeft`, tous deux 0 tant que la carte est `hidden` (display:none) — donc le
  // seul placement au render tombait à 0px quand une AUTRE catégorie était active à l'ouverture, et
  // rien ne le rejouait au changement de catégorie (seul un clic sur un bouton de thème le
  // réparait). Ici la carte vient de rentrer dans le flux, la mesure est enfin non nulle.
  if (key === "apparence") positionThemeThumb();
}

/** Place le pouce `.sift-seg-thumb` du segmenté Thème sur l'option active. Au niveau module (et non
 *  closure de `renderReglagesLive`) pour que `selectSettingsCategory` puisse le rejouer : il ne doit
 *  s'appeler QUE lorsque la carte Apparence est dans le flux — sur `display:none`, offsetWidth/Left
 *  valent 0 et le pouce se voit écrire un filet de 0px. */
function positionThemeThumb(): void {
  // Fusion du 2026-08-20 : le REPLAY au changement de catégorie vient d'une session parallèle
  // (eed4b26), le calcul partagé de la passe simplify (`seg-thumb.ts`, 6 copies fondues en une).
  const card = document.getElementById("sift-reglages-apparence");
  if (!card) return;
  slideSegThumb(card, "[data-theme-choice].on");
}

/** Appelée par le dispatch délégué de `sift-live.ts` au clic sur une catégorie. */
export function onSettingsCategoryPick(key: string): void {
  selectSettingsCategory(key);
}

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
  block.className = "sift-settings-card";
  block.innerHTML =
    '<div class="sift-settings-title">Discogs</div>' +
    // Impasse A9 (issue #15) : la phrase précédente — « Sans jeton, les recherches sont limitées
    // et plus lentes » — décrivait une désactivation TOTALE comme une dégradation. La réalité est
    // dans le code : `ipc_identify.rs` rend `NO_TOKEN` AVANT tout appel réseau, et `settings.rs`
    // le dit en toutes lettres, « Empty/unset = identification disabled ». Aucune recherche n'est
    // ni limitée ni ralentie : il n'y en a aucune.
    '<div class="sift-settings-desc">Le jeton permet à Sift d\'interroger l\'API Discogs pour identifier tes morceaux (label, année, genre). Sans jeton, Sift n\'interroge pas Discogs du tout : le bouton Identifier renvoie ici. Le jeton est gratuit et se génère depuis un compte Discogs.</div>' +
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
    // « Vérifier » : impasse A11 de l'issue #15. Enregistrer un jeton ne dit que l'écriture ; sa
    // validité ne se découvrait qu'au premier Identifier, plus tard et dans un autre écran.
    // Libellé descriptif, donc TEXTE SEUL (règle CLAUDE.md : l'icône est réservée à ce qui n'a pas
    // d'équivalent textuel). Le bouton ne redéfinit aucun `background`, donc il garde le `:hover`
    // générique sans avoir à le réaffirmer.
    '<div style="display:flex;align-items:center;gap:8px;margin-top:6px">' +
    '<button type="button" id="sift-discogs-verify">Vérifier</button>' +
    '<div id="sift-discogs-status" style="font-size:var(--text-sm);color:var(--color-text-tertiary);min-height:14px"></div>' +
    "</div>" +
    "</div>";

  const libBlock = document.createElement("div");
  libBlock.id = "sift-reglages-bibliotheque";
  libBlock.dataset.section = "bibliotheque";
  libBlock.className = "sift-settings-card";
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
  tplBlock.className = "sift-settings-card";
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
  themeBlock.className = "sift-settings-card";
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
  themeBlock.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) =>
    el.addEventListener("click", () => {
      const choice = el.dataset.themeChoice as ThemeChoice;
      // Le `.on` suit l'APPLICATION, qui est immédiate et ne peut pas échouer — le thème demandé
      // est bien celui à l'écran. Ce que le bouton allumé ne dit pas, c'est si le choix a été
      // ENREGISTRÉ ; impasse A21 (issue #15), où l'échec d'écriture ne se voyait qu'au lancement
      // suivant, quand le thème revenait tout seul.
      void setTheme(choice).then((r) => {
        if (r.persisted) return;
        toast(
          humanizeError(
            r.error,
            "Thème appliqué, mais pas enregistré : il reviendra à sa valeur précédente au prochain lancement.",
            "setTheme",
          ),
        );
      });
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
  // share one .sift-ui-card-soft list instead of 4 separate cards. Any future settings section
  // must append inside `list`, same rule as `wrap` above — not as a direct sibling of `content`.
  //
  // 2026-08-19 : le filet qui divisait ces lignes (.sift-settings-list-row) est RETIRÉ, classe
  // comprise. Il datait du jour où les 4 sections étaient empilées et visibles ensemble ; depuis la
  // colonne de catégories (étape 9), `selectSettingsCategory` en cache trois sur quatre — mais
  // `:not(:first-child)` est structurel, un frère `hidden` compte encore. Mesuré dans la vraie
  // fenêtre : Bibliothèque, Nommage et Apparence rendaient un `border-top` de 1px AU-DESSUS de leur
  // titre, Discogs non. Un séparateur sépare deux voisines VISIBLES ; ici il n'y en a jamais deux,
  // il ouvrait donc le panneau. Le rythme vertical vient maintenant de la carte seule
  // (.sift-ui-card-soft-pad), identique pour les quatre catégories.
  const list = document.createElement("div");
  list.id = "sift-reglages-list";
  list.className = "sift-settings-list sift-ui-card-soft sift-ui-card-soft-pad";
  list.appendChild(block);
  list.appendChild(libBlock);
  // Après Bibliothèque : le modèle décrit comment nommer DANS la racine qu'elle définit.
  list.appendChild(tplBlock);
  list.appendChild(themeBlock);
  wrap.appendChild(list);

  // DEUX COLONNES depuis l'étape 9 (DESIGN.md § 17, question ouverte O-3).
  //
  // L'écran était une colonne unique plafonnée à 560px, qui laissait 44 % de la fenêtre vide sur
  // 1200 (rail 152 + padding 2×24 retirés : 1000 utiles, 560 employés). La correction n'était PAS
  // d'élargir la colonne : Réglages Système emploie justement un panneau étroit — mais à côté
  // d'une sidebar de catégories. Ce qui manquait n'était pas de la largeur, c'était la seconde
  // colonne. Le panneau garde donc sa mesure de formulaire ; il est accompagné.
  //
  // Les catégories sont DÉRIVÉES des sections déjà rendues (`dataset.section`), jamais d'une table
  // parallèle : une liste écrite ici divergerait à la première section ajoutée, exactement comme
  // l'aurait fait une table vue → titre dans le routeur.
  const layout = document.createElement("div");
  layout.className = "sift-settings-layout";
  const side = document.createElement("nav");
  side.className = "sift-settings-side sift-ui-card-soft sift-ui-card-soft-pad";
  side.setAttribute("aria-label", "Catégories de réglages");
  side.innerHTML = `<div class="col-h">Réglages</div>`;
  for (const el of [block, libBlock, tplBlock, themeBlock]) {
    const key = el.dataset.section ?? "";
    const label = SECTION_LABELS[key] ?? key;
    side.insertAdjacentHTML(
      "beforeend",
      `<div class="fld" data-reglages="cat" data-cat="${esc(key)}" tabindex="0" role="button">${esc(label)}</div>`,
    );
  }
  layout.appendChild(side);
  layout.appendChild(wrap);
  content.appendChild(layout);
  // Montre la catégorie active ET, si c'est « apparence », place le pouce du segmenté Thème
  // maintenant qu'il est dans le flux (selectSettingsCategory s'en charge).
  selectSettingsCategory(activeSection);

  const inp = block.querySelector<HTMLInputElement>("#sift-discogs-token");
  const status = block.querySelector<HTMLElement>("#sift-discogs-status");
  const link = block.querySelector<HTMLElement>("#sift-discogs-link");
  const toggle = block.querySelector<HTMLButtonElement>("#sift-discogs-token-toggle");
  const verify = block.querySelector<HTMLButtonElement>("#sift-discogs-verify");

  verify?.addEventListener("click", () => {
    void (async () => {
      if (!status) return;
      // Le jeton est écrit AVANT d'être vérifié : sans ça, un clic direct après la frappe
      // vérifierait la valeur précédente, puisque `verify_discogs_token` lit les réglages et non
      // le champ. Le débounce de 600 ms rend ce cas parfaitement atteignable.
      await saveToken();
      verify.disabled = true;
      status.textContent = "Vérification…";
      status.style.color = "var(--color-text-tertiary)";
      try {
        await verifyDiscogsToken();
        status.textContent = "Jeton accepté par Discogs.";
        status.style.color = "var(--color-text-success)";
      } catch (e) {
        const { texte, grave } = identifyErrorText(e);
        status.textContent = texte;
        status.style.color = grave
          ? "var(--color-text-danger)"
          : "var(--color-text-tertiary)";
      } finally {
        verify.disabled = false;
      }
    })();
  });

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

  /** Écrit le jeton et le dit. Annule le débounce en cours pour que l'appel immédiat du `blur` ne
   *  se fasse pas doubler par le timer qui allait échoir. */
  async function saveToken(): Promise<void> {
    clearTimeout(saveTimer);
    if (!inp) return;
    const val = inp.value.trim();
    try {
      await setSetting("discogs_token", val);
      if (status) {
        // Ce libellé ne dit QUE ce qui s'est passé : l'écriture. Il ne dit pas que le jeton est
        // valide — rien ici ne l'a testé. Ce qu'il vaut se découvre au premier Identifier, qui
        // sait maintenant distinguer un jeton refusé d'une panne réseau (impasse A10, issue #15).
        status.textContent = val ? "Jeton enregistré." : "Jeton effacé.";
        setTimeout(() => {
          if (status) status.textContent = "";
        }, 2000);
      }
    } catch (e) {
      if (status) status.textContent = "Erreur d'enregistrement.";
      console.error("setSetting(discogs_token) failed", e);
    }
  }

  inp?.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveToken(), 600);
  });
  // Moitié débounce de l'impasse A11 (issue #15) : le timer de 600 ms n'était vidé ni à la
  // navigation ni à la fermeture, donc coller un jeton puis quitter l'écran sous 600 ms le perdait
  // SANS TRACE — ni message, ni log, et le champ réaffichait l'ancienne valeur au retour. Un clic
  // sur le rail de navigation retire le focus du champ avant de démonter l'écran : c'est ce `blur`
  // qui rattrape la saisie. (Le retrait du DOM seul ne déclenche pas `blur` dans Chromium — donc
  // c'est bien l'ordre des événements du clic qui porte la garantie, pas le démontage.)
  inp?.addEventListener("blur", () => void saveToken());
}
