// Graphique d'occupation par format — un segment par extension, trié du plus gros au plus petit.
// Un seul composant pour deux écrans, et il ne rend QUE la barre, la légende et le détail
// dépliable : `usb-view.ts` l'appelle en `{ report, plain: true }` et pose lui-même sa tête, ses
// faits et ses boutons (`headHtml` / `factsHtml` / `actionsHtml`) ; `bibliotheque-view.ts`
// l'appelle en `{ report }` et garde la carte. Une bibliothèque n'étant pas un volume,
// `free_bytes` y vaut 0 et aucun segment libre n'y est dessiné.
//
// Tout ce qui vient du disque passe par `esc()` : un nom de volume et une extension sont des
// données utilisateur.
import type { UsageReport, ExtUsage } from "./ipc";
import { esc } from "./dom";
import { T } from "./i18n/usage-chart";
import { DRIVE_VANISHED, EJECT_BUSY, NO_EXT_BUCKET } from "../shared/contracts";

/** Un format, une couleur système Apple. Ces tokens `-solid` n'ont qu'un emploi — l'aplat de
 * donnée — et ne doivent jamais porter de texte (voir docs/design-system-states.md). */
const FORMAT_TOKEN: Record<string, string> = {
  ".wav": "--color-hue-blue-solid",
  ".aiff": "--color-hue-indigo-solid",
  ".aif": "--color-hue-indigo-solid",
  ".flac": "--color-hue-teal-solid",
  ".alac": "--color-hue-green-solid",
  ".mp3": "--color-hue-orange-solid",
  ".m4a": "--color-hue-yellow-solid",
  ".aac": "--color-hue-yellow-solid",
  "PIONEER/": "--color-hue-purple-solid",
  ".jpg": "--color-hue-pink-solid",
  ".jpeg": "--color-hue-pink-solid",
  ".png": "--color-hue-pink-solid",
};

/** Un format inconnu retombe sur le gris neutre plutôt que d'emprunter la couleur d'un autre :
 * deux formats de la même couleur mentiraient sur la lecture de la barre. */
/** Ce que la légende AFFICHE pour un seau. Le seau des fichiers sans extension porte une CLÉ
 *  (`NO_EXT_BUCKET`, française pour une raison d'histoire) qui est aussi stockée dans le cache
 *  d'occupation (`volume_usage.buckets_json`) : la traduire côté Rust aurait laissé les disques déjà
 *  parcourus en français, ou demandé de vider le cache. La clé reste, le libellé se traduit ici.
 *  Les clés — couleur, ancre `data-ext`, `revealRow` — gardent la valeur brute. */
function extLabel(ext: string): string {
  return ext === NO_EXT_BUCKET ? T().noExtension : ext;
}

function colorFor(ext: string): string {
  return `var(${FORMAT_TOKEN[ext.toLowerCase()] ?? FORMAT_TOKEN[ext] ?? "--color-hue-gray-solid"})`;
}

/** Les groupes du détail. De la structure de format, jamais un verdict d'analyse : un fichier
 * n'est FAKE que si Sift l'a analysé, et une clé jamais passée en Revue rendrait la catégorie
 * vide sans explication — ou pire, fausse si elle ne l'est qu'à moitié. */
// Le libellé d'un groupe est une CLÉ du dictionnaire, lue à l'appel par `groupBuckets` : ce
// tableau s'évalue à l'import, avant que la langue soit tranchée.
const GROUPS: ReadonlyArray<{ label: "groupLossless" | "groupCompressed" | "groupRekordbox"; exts: readonly string[] }> = [
  { label: "groupLossless", exts: [".wav", ".aiff", ".aif", ".flac", ".alac"] },
  { label: "groupCompressed", exts: [".mp3", ".m4a", ".aac"] },
  { label: "groupRekordbox", exts: ["PIONEER/"] },
];

const GO = 1_000_000_000;
export const formatGo = (bytes: number): string => {
  const L = T();
  return `${(bytes / GO).toFixed(1).replace(".", L.decimalSep)} ${L.unitGo}`;
};

/** Répartit les seaux dans les groupes du détail, et rassemble le reste sous « Autres fichiers » —
 * la seule logique non triviale de ce fichier, et elle n'a aujourd'hui aucun test.
 *
 * Cette phrase a dit « Exportée pour être testable » jusqu'au 2026-09-16 : l'`export` est parti
 * avec `4b771c8` (« neuf `export` dont l'unique appelant est dans leur propre fichier »), qui a
 * laissé la justification derrière lui. La rendre testable redemande son `export` ET un test — un
 * geste à décider, pas à supposer fait. */
function groupBuckets(
  buckets: readonly ExtUsage[],
): Array<{ label: string; rows: ExtUsage[] }> {
  const L = T();
  const claimed = new Set<string>();
  const out: Array<{ label: string; rows: ExtUsage[] }> = [];
  for (const g of GROUPS) {
    const rows = buckets.filter((b) => g.exts.includes(b.ext.toLowerCase()) || g.exts.includes(b.ext));
    rows.forEach((r) => claimed.add(r.ext));
    if (rows.length) out.push({ label: L[g.label], rows });
  }
  const rest = buckets.filter((b) => !claimed.has(b.ext));
  if (rest.length) out.push({ label: L.groupOther, rows: rest });
  return out;
}

export interface UsageChartOptions {
  report: UsageReport;
  /** Sans carte ni inset : le graphique posé au sol d'une zone C qui ne peint rien (Clé USB depuis
   * le 2026-09-09). L'inspecteur de Rangés garde la carte. */
  plain?: boolean;
}

/** Construit la carte. Rien n'est reconstruit ensuite : le dépliage ne touche qu'une classe et le
 * surlignage qu'une autre — un `innerHTML =` à chaque clic n'animerait rien. */
export function renderUsageChart(opts: UsageChartOptions): HTMLElement {
  const { report } = opts;
  const card = document.createElement("div");
  card.className = opts.plain ? "sift-usage-card sift-usage-card-plain" : "sift-usage-card sift-ui-card-soft";

  const used = report.buckets.reduce((s, b) => s + b.bytes, 0);
  // Une bibliothèque n'est pas un volume : `free_bytes` y vaut 0 et il n'y a pas de segment libre
  // à dessiner. Le total affiché est alors la somme des formats, pas une capacité.
  const isVolume = report.free_bytes > 0;
  const total = isVolume ? report.total_bytes : used;

  // ---- Barre + infobulle ----
  const barwrap = document.createElement("div");
  barwrap.className = "sift-usage-barwrap";
  const tip = document.createElement("div");
  tip.className = "sift-usage-tip";
  const bar = document.createElement("div");
  bar.className = "sift-usage-bar";
  const segs: HTMLElement[] = [];

  for (const b of report.buckets) {
    const pct = total > 0 ? (b.bytes / total) * 100 : 0;
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "sift-usage-seg";
    seg.style.flex = `0 0 ${pct.toFixed(2)}%`;
    seg.style.background = colorFor(b.ext);
    seg.setAttribute("aria-label", T().segAria(extLabel(b.ext), formatGo(b.bytes), b.file_count, pct.toFixed(1)));
    const show = () => {
      bar.classList.add("dim");
      segs.forEach((s) => s.classList.remove("on"));
      seg.classList.add("on");
      tip.innerHTML =
        `<span class="sift-usage-tip-ext">${esc(extLabel(b.ext))}</span> — ${formatGo(b.bytes)}` +
        `<br><span class="sift-usage-tip-meta">${T().tipMeta(b.file_count, pct.toFixed(1))}</span>`;
      tip.classList.add("on");
      // Borné aux bords de la barre, sinon l'infobulle d'un segment d'extrémité déborde.
      const bw = bar.getBoundingClientRect();
      const sr = seg.getBoundingClientRect();
      tip.style.left = "0px";
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(sr.left - bw.left + sr.width / 2 - tw / 2, bw.width - tw))}px`;
    };
    const hide = () => {
      bar.classList.remove("dim");
      seg.classList.remove("on");
      tip.classList.remove("on");
    };
    seg.addEventListener("mouseenter", show);
    seg.addEventListener("focus", show);
    seg.addEventListener("mouseleave", hide);
    seg.addEventListener("blur", hide);
    seg.addEventListener("click", () => revealRow(b.ext));
    segs.push(seg);
    bar.appendChild(seg);
  }
  if (isVolume) {
    const free = document.createElement("div");
    free.className = "sift-usage-seg sift-usage-seg-free";
    free.setAttribute("aria-label", T().freeAria(formatGo(report.free_bytes)));
    bar.appendChild(free);
  }
  barwrap.append(tip, bar);
  card.appendChild(barwrap);

  // ---- Légende ----
  const legend = document.createElement("div");
  legend.className = "sift-usage-legend";
  for (const b of report.buckets) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "sift-usage-lg";
    item.innerHTML =
      `<span class="sift-usage-lg-top"><span class="sift-usage-swatch" style="background:${colorFor(b.ext)}"></span>` +
      `<span class="sift-usage-lg-name">${esc(extLabel(b.ext))}</span></span>` +
      `<span class="sift-usage-lg-size">${formatGo(b.bytes)}</span>`;
    item.addEventListener("click", () => revealRow(b.ext));
    legend.appendChild(item);
  }
  if (isVolume) {
    const free = document.createElement("span");
    free.className = "sift-usage-lg sift-usage-lg-static";
    free.innerHTML =
      '<span class="sift-usage-lg-top"><span class="sift-usage-swatch sift-usage-swatch-free"></span>' +
      `<span class="sift-usage-lg-name sift-usage-lg-name-plain">${T().free}</span></span>` +
      `<span class="sift-usage-lg-size">${formatGo(report.free_bytes)}</span>`;
    legend.appendChild(free);
  }
  card.appendChild(legend);

  // ---- Actions ----
  const actions = document.createElement("div");
  actions.className = "sift-usage-actions";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sift-usage-disclose";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML =
    `<span class="sift-usage-chev">▶</span><span class="sift-usage-disclose-label">${T().showDetail}</span>`;
  actions.appendChild(toggle);

  card.appendChild(actions);

  // ---- Détail dépliable ----
  const panel = document.createElement("div");
  panel.className = "sift-usage-panel";
  const clip = document.createElement("div");
  clip.className = "sift-usage-panel-clip";
  const inner = document.createElement("div");
  inner.className = "sift-usage-panel-inner";

  const biggest = report.buckets[0]?.bytes ?? 1;
  for (const g of groupBuckets(report.buckets)) {
    const grp = document.createElement("div");
    grp.className = "sift-usage-grp";
    grp.innerHTML =
      `<div class="sift-usage-grp-head">${esc(g.label)}` +
      `<span class="sift-usage-grp-total">${formatGo(g.rows.reduce((s, r) => s + r.bytes, 0))}</span></div>` +
      g.rows
        .map(
          (r) =>
            `<div class="sift-usage-prow" data-ext="${esc(slug(r.ext))}">` +
            `<span class="sift-usage-pext"><span class="sift-usage-swatch" style="background:${colorFor(r.ext)}"></span>${esc(extLabel(r.ext))}</span>` +
            `<span class="sift-usage-ptrack"><span class="sift-usage-pfill" style="width:${((r.bytes / biggest) * 100).toFixed(1)}%;background:${colorFor(r.ext)}"></span></span>` +
            `<span class="sift-usage-pcount">${r.file_count}</span>` +
            `<span class="sift-usage-psize">${formatGo(r.bytes)}</span>` +
            "</div>",
        )
        .join("");
    inner.appendChild(grp);
  }
  clip.appendChild(inner);
  panel.appendChild(clip);
  card.appendChild(panel);

  let open = false;
  function setOpen(v: boolean): void {
    open = v;
    panel.classList.toggle("on", v);
    toggle.setAttribute("aria-expanded", String(v));
    const label = toggle.querySelector(".sift-usage-disclose-label");
    if (label) label.textContent = v ? T().hideDetail : T().showDetail;
    // Replié, le contenu sort de l'ordre de tabulation : sinon le focus part dans des lignes de
    // hauteur nulle.
    inner.inert = !v;
  }
  function revealRow(ext: string): void {
    if (!open) setOpen(true);
    const row = inner.querySelector<HTMLElement>(`[data-ext="${slug(ext)}"]`);
    if (!row) return;
    row.classList.remove("flash");
    // Reflow forcé : retirer puis remettre la classe dans le même frame ne relance pas
    // l'animation, donc recliquer le même segment ne ferait rien.
    void row.offsetWidth;
    row.classList.add("flash");
  }
  toggle.addEventListener("click", () => setOpen(!open));
  setOpen(false);

  return card;
}

const slug = (s: string): string => s.replace(/[^a-z0-9]/gi, "");

/** Le refus du système est le cas fréquent : le message doit dire quoi fermer, pas « réessaie ». */
/** Le motif d'un refus d'éjection, en français et en entier (spec cle-usb.md § États :
 * « nommer ce qui tient le volume »). Exportée pour `usb-view.ts`, qui porte ses propres boutons
 * depuis le 2026-09-09. */
export function humanizeEject(raw: string): string {
  if (raw.includes(EJECT_BUSY)) return T().ejectBusy;
  if (raw.includes(DRIVE_VANISHED)) return T().ejectGone;
  return T().ejectFailed;
}

/** La cause d'une occupation illisible, pour `usb-view.ts`. Un disque débranché entre la liste et le
 * parcours revient en sentinelle `DRIVE_VANISHED` (`ipc_usage.rs::drive_usage`), qui s'affichait
 * telle quelle sous « Occupation indisponible. » : la dire en mots. Toute autre cause est un message
 * du backend, déjà dans la langue de l'interface (`tr!`), montré tel quel. */
export function humanizeUsageError(raw: string): string {
  return raw.includes(DRIVE_VANISHED) ? T().usageGone : raw;
}
