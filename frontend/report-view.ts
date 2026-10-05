// Shared analysis-report view (Tauri only): verdict, signals, waveform, on-demand
// spectrogram. Rendu INLINE dans un conteneur, et rien d'autre : chaque appelant fournit ses
// deux hôtes — le slot de verdict et le slot de Diagnostic —, Revue par `filing.ts` et
// Bibliothèque par `library-detail.ts`. La variante modale (`openReportModal`) a été retirée le
// 2026-09-16 (c5f64d1) ; le repli « tout dans le scroll du rapport », lui, servait Bibliothèque
// jusqu'à son propre slot `.lib-diag` (2026-09-08) et part ici.
import { analyzePath } from "./ipc";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import type { AnalysisReport } from "../shared/contracts";
import { FILE_GONE } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { decodedShortfallText, formatSummaryParts, hfDensityParts, hfTopDensityParts } from "./report-figures";
import { railFromExtension } from "./rails";
import { VOL_KNOB, playerAuditionHtml, volumeCentreCss, volumeIconClass } from "./player-audition";
import { T } from "./i18n/report-view";
import { drawSpectrogram, mmss, wireSpectroHover } from "./spectro-canvas";
import { openSpectroEnlarged } from "./spectro-enlarge";
import { T as TX } from "./i18n/spectro-enlarge";

/** Fallback step, only for a report predating `peaks_step` (mirrors analysis::PEAKS_WINDOW and
 *  analysis::default_peaks_step). Never use it when the report carries its own step: the envelope
 *  is max-pooled above analysis::MAX_PEAKS points, so the real step is a multiple of this. */

// L'ex-volume capsule (SVG du kit inliné, 2026-08-25) est REMPLACÉ le 2026-08-27 (Antoine :
// « couleur, taille et style vraiment goofy » dans la rangée du lecteur fin) : le volume est
// désormais un slider FIN de la même famille que la progression — patron Music, maquette Figma
// composant « Volume (lecteur) ». SPK_SLASH et VOL_DEFS sont partis avec la capsule ; le
// haut-parleur est l'icône webfont ti-volume/ti-volume-off (une seule famille d'icônes, Tabler —
// patterns § 5 : SF Symbols n'est pas licenciable hors Apple).

// Accordion behavior (shadcn Accordion reference, ui.shadcn.com/docs/components/base/accordion):
// Diagnostic and Métadonnées are exclusive — opening one closes the other. They're wired in two
// separate modules (this file + filing.ts) with no shared ancestor passed down, so coordination
// goes through a document-level event. The listener below is registered once at module load
// (ES modules are singletons) — it always calls the CURRENT instance's close fn, so re-opening a
// track (which rebuilds the DOM) never leaks a stale listener.
let closeSpectroZone: (() => void) | null = null;
document.addEventListener("sift:accordion-open", (e) => {
  if ((e as CustomEvent).detail?.zone !== "diagnostic") closeSpectroZone?.();
});

// Single live player at a time — destroyed before any re-render so audio never lingers.
let currentWs: WaveSurfer | null = null;
function destroyPlayer() {
  // NB : ne PAS déconnecter coverObserver ici — mountPlayer appelle destroyPlayer APRÈS que
  // fillVerdictLanding a créé l'observer, ce qui le tuerait avant qu'il voie le texte grandir. Il est
  // géré par sizeCoverToBody seul (déconnecte le précédent à chaque ouverture).
  if (currentWs) {
    try {
      currentWs.destroy();
    } catch {
      /* already gone */
    }
    currentWs = null;
  }
}

/** Toggle play/pause on the current report player (for the Space keyboard shortcut). */
export function togglePlay() {
  void currentWs?.playPause();
}

// One-time hover styling for the clickable time display (inline styles can't do :hover).
function ensureStyles() {
  if (document.getElementById("sift-report-style")) return;
  const st = document.createElement("style");
  st.id = "sift-report-style";
  st.textContent = ".sift-time:hover{color:var(--color-text-primary)!important}";
  document.head.appendChild(st);
}

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

function spectroCaption(v: AnalysisReport["verdict"], containerMismatch: boolean): string {
  const t = T();
  if (v === "fake" && containerMismatch) return t.captionMismatch;
  if (v === "fake") return t.captionFake;
  if (v === "grey") return t.captionGrey;
  return t.captionOk;
}

/** La LECTURE de l'image, en deux mots, pour la pastille de spectre du Diagnostic ouvert
 *  (spec `docs/ui-specs/revue.md` § Zone C, point 5 : « Pleine bande · 22 kHz »).
 *
 *  Chaque retour est un FRAGMENT VERBATIM de `spectroCaption` juste au-dessus, sur les mêmes
 *  entrées et les mêmes branches : rien n'est reformulé, aucun seuil neuf n'est introduit — la
 *  décision reste celle du backend (`verdict`), exactement comme pour la phrase longue. Celle-ci
 *  n'est d'ailleurs pas perdue : elle devient le `title` de la pastille.
 *
 *  Ce n'est PAS le verdict. Le verdict est dit une seule fois, dans la rangée de titre de
 *  l'en-tête (`fillVerdictLanding`), et ne se répète jamais ici — c'est la règle qui a fait
 *  retirer la ligne « Verdict » du Diagnostic le 2026-08-25. Ce qui est dit ici est ce que
 *  l'image MONTRE, la preuve à côté de laquelle elle est affichée. */
function spectroBandReading(v: AnalysisReport["verdict"], containerMismatch: boolean): string {
  const t = T();
  if (v === "fake" && containerMismatch) return t.readingMismatch;
  if (v === "fake") return t.readingFake;
  if (v === "grey") return t.readingGrey;
  return t.readingOk;
}


// `peaksCoverage` (« 3961 pts ≈ 229.9s / 229.9s (100%) ») retiré le 2026-09-07 avec la rangée
// « Pics (couverture) » : couverture interne de l'analyse, pas une mesure du fichier — sa place
// serait un log. Synthèse Détails techniques, décision d'Antoine.

// mono=false for a categorical word (e.g. the verdict "ok"/"fake"/"grey") rather than a numeric
// reading (Hz, dBTP, %, runs) — .sift-row-value's monospace treatment fits digits/units, but reads
// as an odd mismatch on plain text (annotation: "j'aime bien le texte de verdict mais celui de ok
// pas fan"). Default stays mono so every other numeric row call site is unaffected.
// ⚠️ Plus AUCUN appelant ne passe `false` depuis le 2026-08-25 : la ligne « Verdict » — le seul
// mot catégoriel du Diagnostic — a été retirée, le verdict n'étant dit qu'une fois, dans l'en-tête.
// L'opt-out est gardé parce que sa règle CSS (`.sift-row-value-plain`) existe toujours ; les deux
// se retirent ensemble ou pas du tout, sinon il reste une règle inerte (mode de défaillance déjà
// documenté sur `.sift-spectro-box`, styles.css).
/** Une ligne de mesure dont la valeur porte une RÉFÉRENCE d'encre tertiaire (les densités :
 *  « -3.5 dB (dans la plage des masters …) »). Remplace `rowWide` (synthèse du 2026-09-07) : la
 *  rangée pleine largeur cassait la grille et répétait sa phrase — la référence tient désormais
 *  sur la ligne, dans la grammaire commune. */
function rowRef(label: string, value: string, ref: string): string {
  return `<div class="sift-row"><span class="sift-row-label">${label}</span><span class="sift-row-value">${value} <span class="sift-row-ref">${ref}</span></span></div>`;
}

/** En-tête de groupe des Détails techniques (Spectre · Signal · Forme · Intégrité — synthèse du
 *  2026-09-07, patron Informations système : « serré dedans, aéré entre »). Les rangées de son
 *  groupe coulent dessous — une colonne depuis H1 (même jour) : la grammaire de la fiche
 *  Métadonnées voisine. */
function grpRow(label: string): string {
  return `<div class="sift-row-grp">${label}</div>`;
}

/** Sucre : `rowRef` depuis la paire {value, ref} des fonctions de report-figures. */
function rowRefParts(label: string, p: { value: string; ref: string }): string {
  return rowRef(label, p.value, p.ref);
}

/** « AIFF · lossless » — ce que le fichier PRÉTEND être, la moitié gauche de la paire
 *  Déclaré/Mesuré (synthèse 2026-09-07). Le rail vient du miroir unique `rails.ts` ; `unknown`
 *  ne s'affiche pas — le format seul suffit alors. */
function declaredText(r: AnalysisReport): string {
  const fmt2 = (r.declared_format ?? "").toUpperCase();
  const rail = railFromExtension(r.declared_format ?? "");
  const railWord = rail === "unknown" ? "" : ` · ${rail}`;
  return fmt2 ? `${fmt2}${railWord}` : "—";
}

export function row(label: string, value: string, mono = true): string {
  const valueCls = mono ? "sift-row-value" : "sift-row-value sift-row-value-plain";
  return `<div class="sift-row"><span class="sift-row-label">${label}</span><span class="${valueCls}">${value}</span></div>`;
}

// ── HTML helpers ────────────────────────────────────────────────────────────

/** Rangée de légende clavier, rendue par `filing.ts` dans le PIED DE BOÎTE depuis le 2026-08-30
 *  (décision V2b) — la légende suit les boutons qu'elle nomme, jamais le contenu qui défile.
 *  Retirée le 2026-09-03 (audit œil-Apple : Apple n'écrit jamais les raccourcis en dur dans une
 *  fenêtre), RESTAURÉE le 2026-09-05 sur retour d'Antoine (« je préférais avec la légende ») —
 *  préférence produit assumée contre le patron Apple, à ne pas re-retirer sur le seul argument
 *  HIG. Les tooltips posés au retrait restent (Convertir « (Entrée) » etc.) : deux canaux, un
 *  survolable, un permanent. */
export function keyboardHintsHtml(): string {
  const t = T();
  const k = (key: string, what: string) => `<span><b>${key}</b> ${what}</span>`;
  return (
    `<div class="sift-kbd-hints">` +
    k("SPACE", t.kbdListen) + k("ENTER", t.kbdConvert) + k("BKSP", t.kbdSetAside) + k(t.kbdUpDown, t.kbdNavigate) +
    `</div>`
  );
}

/** Chemin d'origine en PATH CONTROL (wireframe fix 10 ; HIG « Path controls » / `NSPathControl`,
 *  la barre de chemin du Finder) : des SEGMENTS séparés par un chevron, plus une chaîne collée.
 *  Hiérarchie par l'encre, posée en CSS : intermédiaires en secondaire, dernier segment — le nom
 *  de fichier — en primaire.
 *
 *  Troncature : on garde les 2 DERNIERS segments (ex-`shortPath`, replié ici avec sa raison).
 *  L'ellipse CSS coupe par la droite, donc laisser le chemin entier au `text-overflow` mangeait
 *  justement le nom de fichier, la seule part du chemin qui vaut d'être lue (audit UI/UX
 *  2026-07-03, fix 7). La spec (`docs/ui-specs/revue.md` § Zone C, point 1) veut à terme une
 *  troncature PAR LE MILIEU (premier + dernier segments) : elle demande de mesurer la place
 *  réellement disponible, ce que ce rendu-chaîne ne fait pas — non implémenté ici, pas oublié.
 *  Le chemin complet reste dans le `title`.
 *
 *  `esc()` sur CHAQUE segment : ce sont des noms de dossiers et de fichiers utilisateur. */
function pathControlHtml(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const shown = parts.length > 2 ? parts.slice(-2) : parts;
  const sep = `<i class="ti ti-chevron-right sift-player-path-sep" aria-hidden="true"></i>`;
  // Le segment élidé est un segment comme un autre dans la série (« … › dossier › fichier »),
  // exactement la barre de chemin tronquée du Finder — pas un préfixe collé au premier nom.
  const head = shown.length < parts.length ? [`<span class="sift-player-path-seg is-elided">…</span>`] : [];
  const segs = shown.map(
    (seg, i) =>
      `<span class="sift-player-path-seg${i === shown.length - 1 ? " is-leaf" : ""}">${esc(seg)}</span>`,
  );
  return (
    `<div class="sift-player-path" title="${esc(path)}">` +
    head.concat(segs).join(sep) +
    `</div>`
  );
}

interface PlayerHeaderOptions {
  deferText?: boolean;
  title?: string;
  subtitle?: string;
  showAnalysisFailure?: boolean;
  /** Called with the raw error message when analyzePath fails, in addition to (not instead of)
   *  the inline "Échec de l'analyse" rendering below — lets a caller react to a specific failure
   *  (e.g. filing.ts detecting decode.rs's "file no longer exists" message to clear a stale pane)
   *  without changing this function's own return value/behavior for callers that don't pass it. */
  onAnalysisError?: (message: string) => void;
}

/** Single header, folded into the player card itself (2026-07-02: the standalone Hero above the
 *  player was pure duplication — same title/artist/path, twice). Cover (real art once identified,
 *  a minimalist vinyl placeholder via `.sift-cover-frame`'s CSS until then) + title + verdict ·
 *  artiste · version · chemin en path control, optionally a close button (`openReportModal`'s
 *  popup only). Keeps the shared `.sift-report-cover`/`.sift-report-name`/`.sift-report-sub` hooks
 *  that filing.ts writes into (cover src on identify, clean displayName on reconcile).
 *  (Ce bloc décrivait déjà cette fonction ; il était posé au-dessus de l'ex-`shortPath`, deux
 *  définitions plus haut — remis sur son sujet le 2026-08-25.) */
function playerHeaderHtml(name: string, path: string, opts: PlayerHeaderOptions = {}): string {
  const pendingCls = opts.deferText ? " sift-report-text-pending" : "";
  return (
    `<div class="sift-player-header">` +
    `<div class="sift-cover-frame">` +
    // Abstract note glyph, not a literal vinyl (annotation: "l'icone fait trop redondant avec le
    // bouton play... un délire plus minimaliste vectoriel"). Two adjacent circular shapes (the
    // play button + a drawn vinyl disc) read as duplicated; a plain icon sidesteps that entirely.
    // `ti-music` et non `ti-music-note` (2026-10-05) : ce nom-là n'existe pas dans Tabler 3.46.0,
    // et la pochette d'une piste sans image restait vide depuis le 2026-07-08. Gardé par
    // `test/tabler-glyphs.test.ts`, qui confronte chaque glyphe posé à la police installée.
    `<i class="ti ti-music sift-cover-fallback" aria-hidden="true"></i>` +
    `<img class="sift-report-cover sift-player-cover" hidden alt="${T().coverAlt(esc(name))}">` +
    `</div>` +
    `<div class="sift-player-header-body">` +
    // Le verdict est AU NIVEAU DU TITRE, à droite (wireframe « Poste de décision » § 05, patron
    // Mail : le statut en haut à droite du message) — d'où cette rangée qui les tient tous les
    // deux. Il était la 3e de quatre lignes empilées, alignée à gauche entre l'artiste et le
    // chemin (en-tête B, 2026-08-21) : c'est le PLACEMENT qui a changé, pas son rendu.
    `<div class="sift-player-title-row">` +
    `<div class="sift-report-name sift-player-name${pendingCls}">${esc(name)}</div>` +
    // Vide dans la coque initiale ; rempli par fillVerdictLanding (point + mot teintés + format
    // réel) quand l'analyse résout. Le slot doit donc EXISTER ici, peint ou non.
    `<div class="sift-player-verdict"></div>` +
    `</div>` +
    `<div class="sift-report-sub sift-player-sub${pendingCls}">${esc(opts.subtitle ?? "")}</div>` +
    pathControlHtml(path) +
    `</div>` +
    `</div>`
  );
}

/** Les deux hôtes que la boîte de lecture réserve au rangement, décision « V2b — pied de boîte »
 *  (`docs/ui-specs/revue.md` § Décision 2026-08-30) : la boîte devient le poste de décision
 *  complet, réglages puis engagement.
 *
 *  Ce sont des SLOTS VIDES, pas un reparentage : `#mid` est réécrit par `innerHTML` à chaque
 *  ouverture de piste, donc déplacer le nœud `#filfoot` ici le détruirait au rendu suivant (et
 *  `requireEl("#filfoot")` lèverait ensuite). `filing.ts` (`renderFoot`) les remplit APRÈS que
 *  `openReportInto` a peint la boîte — l'ordre est garanti par `openFilingInto`, qui attend le
 *  rapport avant d'appeler `renderFoot`.
 *
 *  Posés pour les DEUX appelants depuis que Bibliothèque a son propre slot de Diagnostic
 *  (2026-09-08, ded5c9a). Le paramètre qui les conditionnait n'avait plus qu'une valeur depuis
 *  le retrait d'`openReportModal` (2026-09-16, c5f64d1), seul chemin qui atteignait encore
 *  cette fonction sans slots. Revue les remplit (`filing.ts::renderFoot`), Bibliothèque les
 *  laisse vides — et une bande vide ne peint rien, la feuille les masque :
 *  `.sift-filbox-settings:empty, .sift-filbox-foot:empty { display:none }`. */
function playerRowHtml(name: string, path: string, headerOpts: PlayerHeaderOptions = {}): string {
  return (
    `<div class="sift-player-row">` +
    playerHeaderHtml(name, path, headerOpts) +
    // La rangée d'audition (play · slider kit · temps · volume fin) vit dans `player-audition.ts`
    // depuis le 2026-08-27 — module pur, la story exécute le même rendu. Ses commentaires de
    // décision (lecteur simple, retrait tempo/key-lock, slider fin) sont partis avec le markup.
    playerAuditionHtml() +
    `<div class="sift-player-error" hidden></div>` +
    `<div class="sift-filbox-settings" id="filbox-settings"></div>` +
    `<div class="sift-filbox-foot" id="filbox-foot"></div>`
  );
}

type ChipTone = "success" | "neutral" | "danger" | "warning";

function toneCss(tone: ChipTone): string {
  return tone === "success"
    ? "background:var(--color-background-success);color:var(--color-text-success)"
    : tone === "danger"
      ? "background:var(--color-background-danger);color:var(--color-text-danger)"
      : tone === "warning"
        ? "background:var(--color-background-warning);color:var(--color-text-warning)"
        : "background:var(--overlay-selected);color:var(--color-text-secondary)";
}

/** A verdict-panel chip: `success` = green-tinted (LOSSLESS), `neutral` = white@.06 (MATCH/UNIQUE). */
export function vchipHtml(label: string, tone: ChipTone): string {
  return `<span class="sift-vchip" style="${toneCss(tone)}">${esc(label)}</span>`;
}

/** ACTUAL verdict panel: the CONCLUSION, a single status "bulle" (pill) — sitting on the
 *  inspector's own continuous surface, no full-bleed tinted panel anymore (2026-07-06 redesign;
 *  superseded the tinted-panel treatment). Nom final moved OUT of here entirely, into the rail
 *  (filing.ts renderFoot, .sift-rail-final-group). This ONLY reflects the audio verdict now — an
 *  earlier "À finaliser" state (verdict ok but no destination chosen yet) was tried and reverted
 *  (annotation: "on ne comprend pas ce qui reste à finaliser ? Redondant ?") — the pill alone
 *  couldn't explain WHAT needed finalizing, and it duplicated the Destination button's own
 *  "Choisir…" CTA, which is the actual, self-explanatory place that signal belongs. */
/** The promoted verdict — the "landing block" that sits high, right under the track header
 *  (spec `docs/ui-specs/revue.md` § Zone C, direction « verdict promu », validée le 2026-08-21).
 *  It is said ONCE, here: the tone-coded badge that used to sit on the Diagnostic disclosure
 *  header was the duplicate this replaces (the pill removed 2026-07-06 was another). NO surface —
 *  #8/#23 forbid a content surface in the middle of Revue — so it renders the same categorical
 *  pastille as the library table (`DESIGN.md` § 16), scaled up: a filled dot that inherits the
 *  tone `currentColor` plus the verdict word.
 *
 *  Mirrors `library-views.ts::verdictView` — LOSSLESS demands the TWO facts (verdict `ok` AND a
 *  lossless rail), and it reuses the library's own `.sift-lib-v-*` tone classes so the two signals
 *  cannot drift apart. `declared_rail` is the rail directly here (AnalysisReport carries it;
 *  LibraryTrack instead derives it from the written format). */
function verdictWordTone(r: AnalysisReport): { word: string; cls: string } {
  // VRAI / FAUX depuis le 2026-09-10 (Antoine : « le verdict annonce "vrai" ou "faux", pas
  // "lossless" »). Le verdict répond à UNE question — le fichier est-il ce qu'il prétend être — et
  // son mot dit la réponse, pas le rail : LOSSLESS nommait le format, AUTHENTIQUE variait selon le
  // rail pour le même fait. Le rail reste dit à côté, par la ligne de format (`formatSummary`).
  // L'entrée « LOSSLESS » de l'allowlist de jargon (CLAUDE.md § Front) ne couvre plus ce mot.
  const t = T();
  if (r.verdict === "fake") return { word: t.verdictFake, cls: "sift-lib-v-fake" };
  if (r.verdict === "grey") return { word: t.verdictCheck, cls: "sift-lib-v-check" };
  if (r.verdict !== "ok") return { word: "—", cls: "sift-lib-v-none" };
  return { word: t.verdictOk, cls: "sift-lib-v-ok" };
}

/** Fill the verdict slot (`.sift-player-verdict`, rendered empty by playerHeaderHtml dans la rangée
 *  de titre, à droite du nom — wireframe § 05, patron Mail). Point + mot teintés par la classe
 *  `.sift-lib-v-*` de la table (§ 16, via currentColor), suivis du format réel en encre secondaire.
 *  Slot-fill : la coque du header est peinte avant que l'analyse résolve, puis le verdict s'y
 *  dépose — c'est pourquoi ce slot ne se crée PAS ici. */
function fillVerdictLanding(root: HTMLElement, r: AnalysisReport): void {
  const slot = root.querySelector<HTMLElement>(".sift-player-verdict");
  if (!slot) return;
  const { word, cls } = verdictWordTone(r);
  // Le débit d'un lossy sous 320 kbps est teinté, avec son infobulle (issue #69) ; le reste de la
  // ligne est inchangé. Chaque segment est échappé ; le séparateur et le span sont du markup à nous.
  const fmtHtml = formatSummaryParts(r)
    .map((p) =>
      p.low
        ? `<span class="sift-player-verdict-low" title="${esc(T().belowClubTitle)}">${esc(p.text)}</span>`
        : esc(p.text),
    )
    .join(" · ");
  slot.className = `sift-player-verdict ${cls}`;
  slot.innerHTML =
    `<span class="sift-player-verdict-dot" aria-hidden="true"></span>` +
    `<span class="sift-player-verdict-word">${esc(word)}</span>` +
    (fmtHtml ? `<span class="sift-player-verdict-fmt">· ${fmtHtml}</span>` : "");
  // La pochette prend la hauteur du bloc texte (en-tête B, Antoine 2026-08-21 ; mesure JS
  // CONFIRMÉE le 2026-08-25 contre la piste « pochette fixe 56px » de la spec). Le pur CSS
  // (aspect-ratio:1 + align-self:stretch) rendait une largeur nulle dans ce contexte flex, mesuré
  // via CDP — d'où la mesure JS, au point unique où la hauteur finale est connue.
  // ⚠️ Le verdict n'AJOUTE PLUS sa ligne depuis qu'il est passé dans la rangée de titre : le bloc
  // texte est descendu de 4 lignes à 3, donc la pochette est plus petite qu'avant. C'est voulu, la
  // pochette suit le texte. La mesure reste appelée ici parce que la pose du verdict peut encore
  // faire varier la hauteur de la rangée de titre (retour à la ligne dans une colonne étroite).
  sizeCoverToBody(root);
}

let coverObserver: ResizeObserver | null = null;
/** Plafond de la pochette d'en-tête, en px — voir `sizeCoverToBody` pour la mesure et la racine. */
const COVER_MAX_PX = 96;
/** Pochette d'en-tête EN COLONNE (zone D), fixe — voir `sizeCoverToBody`. */
const COVER_COLUMN_PX = 56;
/** La pochette (carrée) prend la hauteur du bloc texte de l'en-tête (en-tête B, Antoine 2026-08-21).
 *  Un ResizeObserver la garde synchrone quel que soit le moment où cette hauteur se stabilise :
 *  chargement d'Outfit (police système d'abord, mesuré 81→100px), pose du verdict, mise à jour tardive
 *  du nom par updateHeaderName. Le pur CSS (aspect-ratio:1 + align-self:stretch) rendait une largeur
 *  nulle dans ce contexte flex, et une mesure ponctuelle rate le reflow tardif. Un seul observer à la
 *  fois — reconnecté à chaque ouverture, déconnecté par destroyPlayer. */
function sizeCoverToBody(root: HTMLElement): void {
  coverObserver?.disconnect();
  coverObserver = null;
  const body = root.querySelector<HTMLElement>(".sift-player-header-body");
  const cover = root.querySelector<HTMLElement>(".sift-cover-frame");
  if (!body || !cover) return;
  // La pochette est la sœur flex du corps observé : poser sa largeur change la largeur disponible
  // du corps, le texte re-wrap, la hauteur du corps bouge, et l'observer se redéclenche DANS LA
  // MÊME FRAME — le navigateur coupe la boucle et le dit (« ResizeObserver loop completed with
  // undelivered notifications », une fois par ouverture de piste dans le terminal de Vite,
  // 2026-09-07). Rendu final juste, avertissement de trop. Deux gardes, MESURÉES dans la vraie
  // fenêtre : ne rien écrire à valeur égale (seule, elle laissait encore 1 avertissement sur 3
  // ouvertures — la hauteur change réellement à la première passe), et différer l'écriture issue
  // de l'observer à la frame suivante (`requestAnimationFrame`) : l'écriture ne tombe plus
  // pendant la livraison des notifications, donc plus rien de « non livré ». La première pose
  // reste synchrone : pas de frame sans pochette dimensionnée.
  const write = (s: string) => {
    if (cover.style.width === s && cover.style.height === s) return;
    cover.style.width = s;
    cover.style.height = s;
  };
  // BORNE, mesurée le 2026-09-08 dans la zone D de Rangés (library-detail, colonne de 287 px) :
  // là, la rangée de titre est une PILE (`#sift-aside .sift-player-title-row`, styles.css), donc
  // la largeur du corps dépend de la largeur de la pochette — élargir la pochette fait replier le
  // titre, le corps grandit, la pochette suit… jusqu'à 1915 px de haut pour un corps de 73 en
  // surface large, et un inspecteur qui défile sur 3292 px. Dans Revue (zone C, 647 px de corps)
  // la hauteur converge à 73. Racine de la borne — proposition, sans source Apple : le corps de
  // l'en-tête fait trois lignes (nom --text-lg, artiste, format) et vaut 73 px mesurés ; 96 laisse
  // la marge d'une police de secours plus haute sans laisser la rétroaction de la colonne courir.
  // Un corps plus haut que ça n'est plus un en-tête, c'est un titre replié — la pochette s'arrête.
  const size = (h: number) => `${Math.min(h, COVER_MAX_PX)}px`;
  // EN COLONNE (zone D — Rangés à l'ouverture, Diagnostic de Revue), la pochette est FIXE : 56 px,
  // sans observer. « Ok pour le proposé » (Antoine, 2026-09-08, wireframe « Rangés — inspecteur
  // ouvert ») : la règle « pochette à la hauteur du corps » est une décision de surface large ; en
  // colonne le corps est une pile dont la largeur dépend de la pochette, donc même bornée à 96 elle
  // repoussait le titre sur cinq lignes. 56 = la piste « pochette fixe 56px » de la spec Revue,
  // celle que l'en-tête B (2026-08-21) avait écartée en surface large au profit de la mesure —
  // voir le commentaire de `fillVerdictLanding` — et qui est la bonne en colonne.
  if (root.closest("#sift-aside")) {
    write(`${COVER_COLUMN_PX}px`);
    return;
  }
  let pending = 0;
  const apply = () => {
    const s = size(body.offsetHeight);
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = 0;
      write(s);
    });
  };
  write(size(body.offsetHeight));
  if ("ResizeObserver" in window) {
    coverObserver = new ResizeObserver(apply);
    coverObserver.observe(body);
  }
}

function spectroAndTagsHtml(r: AnalysisReport): string {
  const t = T();
  return (
    `<div class="sift-spectro-box">` +
    // « Ben non, tu l'as laissé collapsable » (Antoine, 2026-09-07) : la règle « pas besoin
    // d'ouvrir s'il n'y a rien à charger » s'applique à TOUTE la fiche, pas qu'aux ex-Détails
    // techniques. Le Diagnostic n'est plus un disclosure : titre STATIQUE (même étage que
    // « Métadonnées », direction T), pastilles et mesures toujours visibles — seul le
    // SPECTROGRAMME reste repliable, parce que lui seul charge (recalcul ~631 ms à l'ouverture,
    // wireSpectrogram). L'audit finding #5 (le jargon derrière un étage) est porté par la
    // position (fin de fiche) et les groupes, plus par un pli.
    `<div class="sift-diag-title">${t.diagTitle}</div>` +
    // DEUX pastilles compactes, et deux seulement : le format, et la lecture du spectre. La
    // pastille de spectre porte la coupure ARRONDIE au kHz — la lecture, pas la mesure ; le hertz
    // exact reste une ligne là-dessous. `.pill` est la pastille générique du dépôt. Format
    // absent = pas de pastille vide : `formatSummary` se garde déjà pareil.
    `<div class="sift-spectro-pills">` +
    (r.declared_format ? `<span class="pill">${esc(r.declared_format.toUpperCase())}</span>` : "") +
    `<span class="pill" title="${spectroCaption(r.verdict, r.container_mismatch)}">` +
    `${spectroBandReading(r.verdict, r.container_mismatch)} · ${fmt(r.cutoff_hz / 1000, 0)} kHz</span>` +
    `</div>` +
    // Ex-`zoneToggleHtml`, replié ici le 2026-09-15. Elle existait pour tenir « one markup shape
    // so the two disclosures can't quietly drift again » — Métadonnées et Spectrogramme —, et
    // cette contrainte est morte depuis que `aac5bde` (#47) a remplacé l'en-tête Métadonnées par
    // un `.sift-meta-header` statique : `sift-cdj-badge` n'a plus AUCUNE occurrence dans le
    // dépôt, et il ne restait qu'un appelant. Une forme partagée par un seul consommateur ne
    // partage rien.
    //
    // Quatre des neuf champs de son interface étaient morts avec lui (`toggleId`, `badgeLabel`,
    // `badgeTone`, `badgeHidden`), donc `badgeStyle` valait toujours `""` et le badge était
    // toujours `hidden`. Le span `#sift-quality-badge` part avec eux : il était le seul usage de
    // `.sift-chip-badge` dans tout le TypeScript, toujours vide, toujours masqué, et aucune règle
    // CSS ne le cible par son id.
    //
    // Le hint, lui, RESTE et n'est pas décoratif : `wireSpectrogram` y écrit le « calcul… » et le
    // « échec — réessayer » transitoires, qui n'ont aucun autre chemin de retour visuel.
    `<button class="sift-zone-toggle sift-sg-toggle sift-spectro-toggle" aria-expanded="false">` +
    `<span><span class="sift-zone-toggle-car sift-sg-caret sift-spectro-caret">▸</span>` +
    `<span class="sift-zone-toggle-label">${t.spectrogram}</span></span>` +
    `<span class="sift-zone-toggle-right">` +
    `<span class="sift-zone-toggle-hint sift-sg-hint sift-spectro-hint"></span>` +
    `</span>` +
    `</button>` +
    `<div class="sift-sg-body sift-spectro-body">` +
    `<div class="sift-spectro-body-inner">` +
    `<div class="sift-spectro-canvas-wrap">` +
    `<canvas class="sift-sg sift-spectro-canvas" width="720" height="180" role="img" aria-label="${t.spectrogramAria}"></canvas>` +
    // Canvas transparent superposé — ne dessine QUE le réticule au survol (wireSpectroHover),
    // jamais l'image du spectrogramme elle-même. Séparé du canvas de base pour la perf :
    // un mousemove ne doit jamais redéclencher la boucle pixel-par-pixel de drawSpectrogram.
    `<canvas class="sift-spectro-overlay" width="720" height="180"></canvas>` +
    `</div>` +
    // #72 : la vue agrandie, calculée à la résolution de l'écran. Texte seul (règle des CTA) ; le
    // clic sur le canevas fait la même chose, ce bouton porte le chemin clavier.
    `<div class="sift-spectro-actions">` +
    `<button type="button" class="sift-meta-ident-btn sift-spectro-enlarge" title="${TX().agrandirTitre}">${TX().agrandir}</button>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<div class="sift-spectro-rows">` +
    // SYNTHÈSE du 2026-09-07 (wireframe validé par Antoine, sourcing Utilitaire de disque +
    // Fakin' The Funk) : quatre groupes — Spectre, Signal, Forme, Intégrité — et la paire
    // discriminante Déclaré/Mesuré en tête, dans la grammaire commune (« État : Vérifié » chez
    // Apple, « Bitrate / Actual Bitrate » chez FTF), jamais une flèche de dashboard. Retirés :
    // « Durée » (le lecteur l'affiche — un compte, un endroit ; seul le cas divergent survit,
    // sous Intégrité) et « Pics (couverture) » (couverture interne de l'analyse, pas une mesure
    // du fichier). Densités : `null` veut dire « pas mesuré », jamais zéro — la ligne ne se rend
    // pas du tout.
    grpRow(t.grpSpectrum) +
    row(t.declared, declaredText(r)) +
    row(t.measured, t.measuredValue(spectroBandReading(r.verdict, r.container_mismatch), fmt(r.cutoff_hz, 0))) +
    (r.hf_flatness_db != null ? rowRefParts(t.hfDensity, hfDensityParts(r.hf_flatness_db, fmt)) : "") +
    // Seconde bande de platitude, APRÈS celle du dessus et jamais avant : sa référence ne s'appuie
    // que sur 20 fichiers contre 44, et la faire lire en premier noierait celle qui porte la mesure
    // la mieux étayée. Elle reste indispensable : c'est la SEULE qui voit Opus.
    (r.hf_flatness_top_db != null
      ? rowRefParts(t.hfTopDensity, hfTopDensityParts(r.hf_flatness_top_db, fmt))
      : "") +
    grpRow(t.grpSignal) +
    // « Pic d'échantillon », pas « True-peak » : malgré son nom, `true_peak_dbtp` EST le pic
    // d'échantillon — son sur-échantillonnage linéaire ne peut pas dépasser `max |s|`, démontré et
    // épinglé dans `analysis/dynamics.rs`. L'unité suit : dBFS, pas dBTP.
    row(t.samplePeak, fmt(r.true_peak_dbtp, 2) + " dBFS") +
    row(t.clipping, r.clip_runs + " runs · " + fmt(r.clip_pct, 2) + "%") +
    row(t.phaseCorrelation, fmt(r.phase_correlation, 3)) +
    row(t.dcOffset, fmt(r.dc_offset, 5)) +
    grpRow(t.grpShape) +
    row(t.silence, r.silence_head_ms + " ms · " + r.silence_tail_ms + " ms") +
    row(t.channels, String(r.channels) + (r.dual_mono ? " (dual-mono)" : "") + " · " + r.sample_rate + " Hz") +
    grpRow(t.grpIntegrity) +
    row(t.container, r.container_ok ? t.containerOk : t.containerBad) +
    row(t.endOfFile, r.truncated ? t.truncated : t.complete) +
    (decodedShortfallText(r.duration_sec, r.decoded_duration_sec, fmt) != null
      ? row(t.decodedDuration, decodedShortfallText(r.duration_sec, r.decoded_duration_sec, fmt) as string)
      : "") +
    `</div></div>` +
    // Tags CDJ OK / Version ID3 moved to the Identification card (filing.ts, alongside Label/
    // Année/Genre) — Pochette dropped entirely (redondant avec la pochette déjà visible dans le
    // hero). Nothing meaningful was left in the old "Tags" box, so it's gone too; codec_error is
    // its own standalone diagnostic, not tied to those three fields.
    (r.codec_error ? `<div class="sift-codec-error">${t.codecError(esc(r.codec_error))}</div>` : "")
  );
}

/** Wrap a decoded AudioBuffer as an in-memory 16-bit PCM WAV blob (lossless container swap;
 * AIFF and WAV are both PCM). The player no longer uses this (it streams via the media
 * element); kept for selftest.ts, which exercises the decode → WAV → wavesurfer chain. */
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length;
  const blockAlign = numCh * 2;
  const dataLen = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, dataLen, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Resolve a URL the webview's media element can play directly: the file itself for the
 * formats Chromium decodes natively (mp3/wav/flac/m4a/ogg), or the backend's cached WAV
 * transcode for AIFF (`playback_url`, mtime-guarded temp file, re-encoded only when stale).
 * The old path here fetched the WHOLE file into an ArrayBuffer, decoded it fully with Web
 * Audio, then re-encoded a 40-80MB WAV blob sample-by-sample in JS — for every format, on
 * every cache-miss open. The media element streams instead; with pre-computed peaks passed
 * to `ws.load` there is nothing left to decode up-front.
 *
 * Every format now round-trips through `playback_url`, AIFF or not: the `asset:` scope starts
 * empty, so that command is also what grants the webview read access to this one file. Returning
 * `path` directly here would yield a URL the webview is forbidden to fetch. The extra IPC costs
 * one round-trip per track opened — nothing next to loading the audio itself. */
async function playableUrl(path: string): Promise<string> {
  return invoke<string>("playback_url", { path });
}

/** Point the player's media element at the track (streaming, no up-front decode). `peaks`/
 * `duration` (from the Rust analysis report) let wavesurfer render without decoding audio;
 * without them (fresh, never-analyzed track) wavesurfer decodes for display itself.
 * Each await yields the event loop; the user may switch tracks meanwhile, which destroys
 * this ws and creates a new currentWs — bail so we never load into a destroyed instance. */
async function loadAudio(ws: WaveSurfer, path: string, peaks?: number[], duration?: number): Promise<void> {
  try {
    const src = await playableUrl(path);
    if (ws !== currentWs) return;
    await ws.load(convertFileSrc(src), peaks?.length ? [peaks] : undefined, duration || undefined);
  } catch (e) {
    if (ws !== currentWs) return; // AbortError from a track switch mid-load: expected, silent
    console.error("audio load failed", e);
  }
}

/** Warm everything the NEXT track's open needs, so queue navigation feels instant: the
 * analysis report (verdict + peaks — a DB hit when the worker already analyzed it) and,
 * for AIFF, the backend's transcoded WAV. Failures are silent by design: a prefetch must
 * never surface UI errors — the real open retries and reports. Called from the queue-open
 * sites at most once per user track-switch (not a burst event). */
export function prefetchTrack(path: string): void {
  if (!reportCache.has(path)) {
    void analyzePath(path, false)
      .then((r) => reportCache.set(path, r))
      .catch(() => {});
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "aif" || ext === "aiff") void invoke<string>("playback_url", { path }).catch(() => {});
}

/** Mounts a wavesurfer player on the report's player row. Tempo uses the browser's native
 * time-stretch (`preservesPitch`) for key-lock — adequate for the ±8% DJ nudge; SoundTouch.js
 * was evaluated and skipped (would require re-architecting playback to Web Audio for marginal
 * gain at this range). See docs/ressources-externes.md.
 * `peaks` and `duration` (from the Rust analysis report) render the waveform instantly AND
 * spare wavesurfer its own display decode; audio streams via the media element (loadAudio). */
async function mountPlayer(root: HTMLElement, path: string, peaks?: number[], duration?: number) {
  const container = requireEl<HTMLElement>(".sift-wave", "mountPlayer", root);
  const playBtn = root.querySelector<HTMLButtonElement>(".sift-play");
  const volumeTrack = root.querySelector<HTMLElement>(".sift-volume");
  const volumeMute = root.querySelector<HTMLButtonElement>(".sift-volume-mute");
  const volumeFill = root.querySelector<HTMLElement>(".sift-volume-fill");
  const volumeKnob = root.querySelector<HTMLElement>(".sift-volume-knob");
  const errorEl = root.querySelector<HTMLElement>(".sift-player-error");

  ensureStyles();
  destroyPlayer();
  // WaveSurfer n'est plus que le MOTEUR (2026-08-27, lecteur simple) : son rendu part dans un
  // conteneur réduit à zéro (.sift-progress-engine), donc plus aucune couleur à résoudre ici —
  // le visuel est le trio .sift-progress-track/-fill/-knob, en tokens CSS ordinaires.
  // `interact:false` : le clic de seek appartient au slider custom (dragSlider ci-dessous), pas
  // au canvas invisible. `peaks`+`duration` restent passés : ils épargnent toujours à wavesurfer
  // son décodage d'affichage, même invisible.
  const ws = WaveSurfer.create({
    container,
    height: 0,
    interact: false,
    cursorWidth: 0,
    normalize: true,
    peaks: peaks?.length ? [peaks] : undefined,
    duration: duration || undefined,
  });
  currentWs = ws;
  void loadAudio(ws, path, peaks, duration);

  const setIcon = (name: string) => {
    // Glyphes de transport PLEINS (police tabler-icons-filled, classe .ti-fill du dépôt —
    // jamais la feuille vendeur, voir l'avertissement de main.ts).
    const i = playBtn?.querySelector("i");
    if (i) i.className = `ti-fill ti-fill-${name}`;
  };
  // Slider custom (jamais un <input type=range> natif — voir DESIGN.md). La géométrie viewBox de
  // la capsule est partie avec elle (2026-08-27) : la conversion pointeur → valeur passe par la
  // COURSE DU CENTRE du pouce en pixels rendus — même principe que la leçon du 2026-08-25 (mapper
  // la largeur entière faisait traîner le pouce derrière le pointeur), même formule que le rendu
  // (`volumeCentreCss`, importée de player-audition.ts avec `VOL_KNOB`).
  const dragSlider = (track: HTMLElement, onMove: (pct: number) => void) => {
    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const travel = Math.max(1, rect.width - VOL_KNOB);
      onMove(Math.max(0, Math.min(1, (clientX - rect.left - VOL_KNOB / 2) / travel)));
    };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      track.classList.add("dragging");
      track.setPointerCapture(e.pointerId);
      update(e.clientX);
      const onPointerMove = (ev: PointerEvent) => update(ev.clientX);
      const stopDragging = (ev: PointerEvent) => {
        track.classList.remove("dragging");
        if (track.hasPointerCapture(ev.pointerId)) track.releasePointerCapture(ev.pointerId);
        track.removeEventListener("pointermove", onPointerMove);
        track.removeEventListener("pointerup", stopDragging);
        track.removeEventListener("pointercancel", stopDragging);
      };
      track.addEventListener("pointermove", onPointerMove);
      track.addEventListener("pointerup", stopDragging);
      track.addEventListener("pointercancel", stopDragging);
    });
  };

  const renderVolume = (pct: number) => {
    // Le POUCE mène, le remplissage s'arrête à son centre (kit) : left du pouce = course du
    // centre en calc CSS, largeur du remplissage = le même point. Deux mutations de style,
    // jamais de rebuild — updateTime a le même contrat côté progression.
    const centre = volumeCentreCss(pct);
    if (volumeFill) volumeFill.style.width = centre;
    if (volumeKnob) volumeKnob.style.left = centre;
    volumeTrack?.setAttribute("aria-valuenow", String(Math.round(pct * 100))); // audit-ref R1
    // L'icône du haut-parleur dit l'état muet — formule partagée avec la story (player-audition.ts).
    const i = volumeMute?.querySelector("i");
    if (i) i.className = volumeIconClass(pct);
  };
  renderVolume(1); // WaveSurfer's own default (full volume)
  if (volumeTrack) {
    dragSlider(volumeTrack, (pct) => {
      ws.setVolume(pct);
      renderVolume(pct);
    });
    // Audit-ref R1 (Revue, 2026-07-08, réf. shadcn Slider) : flèches gauche/droite ±5%, Home/End
    // aux bornes — même granularité que le drag existant (continu), pas de pas caché supplémentaire.
    volumeTrack.addEventListener("keydown", (e) => {
      const cur = ws.getVolume();
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.max(0, cur - 0.05);
        ws.setVolume(next);
        renderVolume(next);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.min(1, cur + 0.05);
        ws.setVolume(next);
        renderVolume(next);
      } else if (e.key === "Home") {
        e.preventDefault();
        ws.setVolume(0);
        renderVolume(0);
      } else if (e.key === "End") {
        e.preventDefault();
        ws.setVolume(1);
        renderVolume(1);
      }
    });
  }
  if (volumeMute) {
    // Clic sur le haut-parleur = mute / démute. Mémorise le dernier volume non nul.
    let lastVolume = 1;
    volumeMute.addEventListener("click", () => {
      const cur = ws.getVolume();
      if (cur > 0) {
        lastVolume = cur;
        ws.setVolume(0);
        renderVolume(0);
      } else {
        const restore = lastVolume > 0 ? lastVolume : 1;
        ws.setVolume(restore);
        renderVolume(restore);
      }
    });
  }

  // Un seul temps affiché, cliquable (patron Musique/Podcasts — jamais les deux à la fois). Le clic
  // (ou Entrée/Espace au clavier) bascule écoulé ↔ restant ; le restant décompte (durée - écoulé).
  const timeEl = root.querySelector<HTMLElement>(".sift-time");
  const progressEl = root.querySelector<HTMLElement>(".sift-progress");
  const progressFill = root.querySelector<HTMLElement>(".sift-progress-fill");
  const progressKnob = root.querySelector<HTMLElement>(".sift-progress-knob");
  let showRemaining = false;
  const updateTime = () => {
    const cur = ws.getCurrentTime();
    const dur = ws.getDuration();
    if (timeEl) timeEl.textContent = showRemaining ? `-${mmss(Math.max(0, dur - cur))}` : mmss(cur);
    // Pouce + remplissage du slider kit (composant « Slider de progression » de la maquette).
    // Le pouce est révélé dès que la durée est connue — même contrat que l'ancien playhead.
    if (dur > 0) {
      const pct = Math.min(100, (cur / dur) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressKnob) {
        progressKnob.hidden = false;
        progressKnob.style.left = `${pct}%`;
      }
      progressEl?.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
  };
  if (timeEl) {
    const toggleTime = () => {
      showRemaining = !showRemaining;
      updateTime();
    };
    timeEl.addEventListener("click", toggleTime);
    timeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // La frappe s'arrête ici : sans quoi les touches nues de Revue (`installFilingKeys`, sur
        // `document`) la reprenaient, et Entrée basculait le temps ET convertissait la piste. Même
        // patron que « Agrandir » (#72).
        e.stopPropagation();
        toggleTime();
      }
    });
  }
  ws.on("ready", () => {
    updateTime();
    if (errorEl) errorEl.hidden = true;
    // Resync the icon on the REAL state. The button is clickable from the moment mountPlayer
    // returns, but `loadAudio` finishes later: a click in that window calls playPause() on an
    // empty media, WaveSurfer emits `play` (icon → pause), then `ws.load()` substitutes the
    // media without ever emitting `pause` — leaving the icon inverted for the rest of the track.
    // Nothing else corrects it: setIcon is driven only by play/pause/finish.
    syncPlayIcon();
  });
  ws.on("timeupdate", updateTime);

  // Le dim de pause est parti avec la waveform (une piste de slider Apple ne change pas d'état
  // en pause — Musique non plus) : l'icône play/pause porte seule l'état.
  /** Puts the button back in step with what the player is ACTUALLY doing.
   *  Used on `ready`, where the two can legitimately have drifted apart (see there). */
  function syncPlayIcon(): void {
    setIcon(ws.isPlaying() ? "player-pause" : "player-play");
  }
  ws.on("play", () => setIcon("player-pause"));
  ws.on("pause", () => setIcon("player-play"));
  ws.on("finish", () => {
    setIcon("player-play");
    // Fin de piste : stop + pouce ramené à 0, pas d'auto-avance (la zone C ne se recompose pas
    // sous l'utilisateur, patron Musique piste isolée). Un Espace relit du début.
    ws.setTime(0);
    updateTime();
  });

  // Seek au clic/drag sur la piste (le canvas invisible a interact:false — le slider custom est
  // le SEUL chemin de seek) + bulle mm:ss au survol (patron QuickTime, la ligne et le ghost nés
  // pour des barres sont partis avec elles). Nœuds créés une fois, mutés ici — mousemove = rafale.
  if (progressEl) {
    const pctFromX = (clientX: number): number => {
      const rect = progressEl.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    };
    const seekTo = (pct: number) => {
      const dur = ws.getDuration();
      if (dur > 0) {
        ws.setTime(pct * dur);
        updateTime();
      }
    };
    progressEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      progressEl.setPointerCapture(e.pointerId);
      seekTo(pctFromX(e.clientX));
      const onPointerMove = (ev: PointerEvent) => seekTo(pctFromX(ev.clientX));
      const stop = (ev: PointerEvent) => {
        if (progressEl.hasPointerCapture(ev.pointerId)) progressEl.releasePointerCapture(ev.pointerId);
        progressEl.removeEventListener("pointermove", onPointerMove);
        progressEl.removeEventListener("pointerup", stop);
        progressEl.removeEventListener("pointercancel", stop);
      };
      progressEl.addEventListener("pointermove", onPointerMove);
      progressEl.addEventListener("pointerup", stop);
      progressEl.addEventListener("pointercancel", stop);
    });
    // role="slider" sans clavier violerait l'APG : ±5 s aux flèches, bornes à Home/End — la même
    // granularité perceptible que le drag, aucun pas caché.
    progressEl.addEventListener("keydown", (e) => {
      const dur = ws.getDuration();
      if (dur <= 0) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        ws.setTime(Math.max(0, ws.getCurrentTime() - 5));
        updateTime();
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        ws.setTime(Math.min(dur, ws.getCurrentTime() + 5));
        updateTime();
      } else if (e.key === "Home") {
        e.preventDefault();
        ws.setTime(0);
        updateTime();
      } else if (e.key === "End") {
        e.preventDefault();
        ws.setTime(dur);
        updateTime();
      }
    });
    const hoverTime = root.querySelector<HTMLElement>(".sift-wave-hovertime");
    if (hoverTime) {
      // POINTEUR ET PAS SOURIS, et c'est un correctif, pas un goût. Signalé par Antoine avec
      // capture le 2026-09-17 : la bulle ne suivait pas le pouce pendant un glissement. Le
      // `pointerdown` ci-dessus appelle `preventDefault()`, ce qui pose le drapeau PREVENT MOUSE
      // EVENT — Pointer Events niveau 3, § 11 : « If the pointer event dispatched was pointerdown
      // and the event was canceled, then set the PREVENT MOUSE EVENT flag for this pointerType. »
      // La spec compare les deux séquences : `pointerdown` normal = « zero or more pointermove AND
      // mousemove events », `pointerdown` annulé = « zero or more pointermove events ». Aucun
      // `mousemove` de tout le glissement, donc la bulle gelait à sa dernière position de survol
      // pendant que le pouce avançait.
      //
      // `pointermove` règle les deux cas d'un coup : il porte le survol (une souris en émet sans
      // bouton enfoncé) ET le glissement, où la capture le retarge vers `progressEl` même hors de
      // ses bords — donc la bulle suit la position CLAMPÉE, exactement comme le pouce.
      //
      // `pointerleave` et pas `mouseleave` pour la même raison, plus une propriété utile : la
      // capture suspend les événements de frontière jusqu'à sa libération, donc la bulle ne
      // disparaît plus si le curseur sort pendant le glissement.
      //
      // Gardé par `npm run lint:pointer-capture` : un élément qui capture le pointeur ne doit pas
      // écouter la souris. Le slider de VOLUME, plus haut dans ce fichier, est déjà tout-pointeur.
      progressEl.addEventListener("pointermove", (e) => {
        const pct = pctFromX(e.clientX);
        hoverTime.hidden = false;
        hoverTime.style.left = `${pct * 100}%`;
        hoverTime.textContent = mmss(pct * ws.getDuration());
      });
      progressEl.addEventListener("pointerleave", () => {
        hoverTime.hidden = true;
      });
    }
  }
  ws.on("error", (e) => {
    console.error("wavesurfer error", e);
    // route to the Rust log so it shows in the dev console (webview console isn't readable here)
    void invoke("report_smoke", { ok: false, detail: `wavesurfer ${path}: ${String(e)}` });
    // Audio loads via loadAudio (native media element, AIFF pre-transcoded backend-side),
    // so there's nothing further to retry here — just surface the error.
    if (errorEl) {
      errorEl.textContent = T().playbackFailed;
      errorEl.hidden = false;
    }
  });
  playBtn?.addEventListener("click", () => void ws.playPause());
}

/** #72 : le bouton « Agrandir » et le clic sur le canevas ouvrent la vue agrandie. Câblé une fois,
 *  quand la grille de la zone D est peinte (le canevas n'est cliquable qu'une fois visible). */
function wireEnlarge(root: HTMLElement, canvas: HTMLCanvasElement, path: string) {
  const btn = root.querySelector<HTMLButtonElement>(".sift-spectro-enlarge");
  const name = path.split(/[\\/]/).pop() ?? path;
  const open = () => openSpectroEnlarged(path, name, btn);
  btn?.addEventListener("click", open);
  // Entrée et Espace ouvrent la vue ICI, avant que les raccourcis de Revue (`installFilingKeys`,
  // posé sur `document`) ne les prennent : Entrée y range la piste, Espace lance la lecture, et le
  // bouton n'avait donc aucun chemin clavier (relecture de #72).
  btn?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  });
  canvas.addEventListener("click", open);
}

/** Wires the spectrogram toggle inside `root` (extracted so it can be called
 * independently of player mounting — used after async analysis fill-in). */
function wireSpectrogram(root: HTMLElement, r: AnalysisReport) {
  const sg = root.querySelector<HTMLCanvasElement>(".sift-sg");
  const overlay = root.querySelector<HTMLCanvasElement>(".sift-spectro-overlay");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  if (!sg || !overlay || !toggle || !body || !caret || !hint) return;

  let open = false, loaded = false, busy = false;
  const close = () => {
    if (!open) return;
    open = false;
    body.classList.remove("is-open");
    caret.style.transform = "";
    toggle.setAttribute("aria-expanded", "false");
  };
  closeSpectroZone = close; // this instance is now the one "sift:accordion-open" can close

  toggle.addEventListener("click", async () => {
    if (busy) return;
    if (open) {
      close();
      return;
    }
    if (!loaded) {
      busy = true;
      hint.textContent = T().computing;
      try {
        const full = r.spectrogram.frames > 0 ? r : await analyzePath(r.path, true);
        drawSpectrogram(sg, full);
        wireSpectroHover(sg, overlay, full);
        wireEnlarge(root, sg, r.path);
        loaded = true;
      } catch (e) {
        console.error("spectrogram analyze failed", e);
        hint.textContent = T().computeFailed;
        busy = false;
        return;
      }
      busy = false;
      hint.textContent = ""; // clear the transient "calcul…" now that it's loaded
    }
    // Exclusive accordion (shadcn Accordion reference): opening this closes Métadonnées.
    document.dispatchEvent(new CustomEvent("sift:accordion-open", { detail: { zone: "diagnostic" } }));
    open = true;
    caret.style.transform = "rotate(90deg)";
    toggle.setAttribute("aria-expanded", "true");
    body.classList.add("is-open");
  });
}


/** Renders the report INLINE into `container` (e.g. the Revue #mid pane). `verdictContainer`
 *  reçoit les états transitoires du verdict, `diagContainer` le Diagnostic (spectrogramme +
 *  mesures) : les deux sont OBLIGATOIRES, et les deux appelants les fournissent — voir
 *  `openReportInto`. */
function renderReportInto(
  container: HTMLElement,
  r: AnalysisReport,
  verdictContainer: HTMLElement,
  headerOpts: PlayerHeaderOptions = {},
  diagContainer: HTMLElement,
) {
  const name = headerOpts.title ?? (r.path.split(/[\\/]/).pop() || r.path);
  container.innerHTML =
    `<div class="sift-report-scroll">` + playerRowHtml(name, r.path, headerOpts) + `</div>`;
  // Même enveloppe `.sift-analysis-body` que le chemin asynchrone d'openReportInto : sans elle, le
  // Diagnostic n'aurait pas la même structure selon qu'on ouvre une piste pour la première fois
  // (analyse) ou qu'on y revient (cache de session) — et la première règle CSS posée sur ce slot
  // ne s'appliquerait qu'à un cas sur deux, en silence.
  diagContainer.innerHTML = `<div class="sift-analysis-body">${spectroAndTagsHtml(r)}</div>`;
  fillVerdictLanding(container, r);
  // verdictContainer (the low .sift-fil-verdict slot, after Identification) now only carries the
  // transient "Analyse en cours…"/error states — clear it on the success path.
  verdictContainer.innerHTML = "";
  mountPlayer(container, r.path, r.peaks, r.duration_sec);
  // Le spectrogramme se câble sur SON hôte : ses nœuds sont partis avec lui quand le Diagnostic
  // vit sous les Métadonnées (wireSpectrogram ne lit que des `.sift-spectro-*`/`.sift-sg-*`,
  // aucune dépendance au lecteur — vérifié à la scission, 2026-08-25).
  wireSpectrogram(diagContainer, r);
}

// In-session report cache (path → report). Backend already caches in the DB; this skips even
// the IPC round-trip + loading spinner on revisits, so switching back to a track is instant.
const reportCache = new Map<string, AnalysisReport>();

/** Drops the in-session cache so the next open re-fetches from the backend (DB is the source
 *  of truth). Call when analysis results may have changed (e.g. the `analysis:changed` event)
 *  so a re-analysed or replaced file isn't served stale. */
export function clearReportCache(path?: string) {
  if (path) reportCache.delete(path);
  else reportCache.clear();
  // No decoded-audio cache to drop anymore: the player streams the file (or the backend's
  // mtime-guarded AIFF transcode), so a replaced file is never replayed stale from JS memory.
}

// Monotonic token: the latest openReportInto call wins. A slow analyse that resolves after the
// user already switched tracks must not overwrite the newer content in the shared container.
let openSeq = 0;

/** Loads (no spectrogram) and renders inline into `container`. Instant when cached.
 *
 * The player is mounted IMMEDIATELY from the path alone, before analysis completes.
 * This eliminates the "player never mounts" race: the old design awaited analyzePath
 * before mounting, and a background event bumping openSeq during that await caused the
 * seq-guard to abort the whole render (player included). Now the seq-guard only aborts
 * the analysis fill-in — the player is already running and stays untouched. */
export async function openReportInto(
  container: HTMLElement,
  path: string,
  verdictContainer: HTMLElement,
  headerOpts: PlayerHeaderOptions = {},
  diagContainer: HTMLElement,
): Promise<AnalysisReport | null> {
  destroyPlayer();
  ensureStyles();
  const seq = ++openSeq;

  const cached = reportCache.get(path);
  if (cached) {
    renderReportInto(container, cached, verdictContainer, headerOpts, diagContainer);
    return cached;
  }

  const name = headerOpts.title ?? (path.split(/[\\/]/).pop() || path);

  // Fire analysis IPC immediately. For already-analyzed tracks the DB round-trip takes ~20ms.
  // allowForget=true: this is the real user-open path (its failure drives filing.ts's gone-file
  // recovery via onAnalysisError below), the one place a confirmed-gone row may be dropped.
  const analysisPromise = analyzePath(path, false, true);

  // Render the player shell. Son-first order: player (header+audition) → proof (Preuves). Le mot
  // de verdict vient EN DERNIER, au-dessus du rail d'actions, dans le `verdictContainer` de
  // l'appelant : les deux (filing.ts, library-detail.ts) insèrent l'Identification entre cette
  // coque et leur propre slot. Rempli plus tard (seq-guarded).
  // Le Diagnostic part lui aussi chez l'appelant, dans `diagContainer` : d'abord SOUS les
  // Métadonnées (2026-08-25, wireframe § 06 fix 4 : « on identifie plus souvent qu'on
  // n'inspecte »), puis en ZONE D — l'inspecteur `#sift-aside` — depuis le 2026-09-07 (« ok pour
  // l'inspecteur », filing.ts `openFilingInto`) ; Bibliothèque a le sien, `.lib-diag`
  // (library-detail.ts). Le corps d'analyse reste un slot rempli plus tard, il change seulement
  // d'hôte. Les deux hôtes sont OBLIGATOIRES : le dernier appelant qui omettait `diagContainer`
  // était Bibliothèque, jusqu'à ce qu'elle gagne son propre slot `.lib-diag` le 2026-09-08
  // (ded5c9a).
  container.innerHTML =
    `<div class="sift-report-scroll">` + playerRowHtml(name, path, headerOpts) + `</div>`;
  diagContainer.innerHTML = `<div class="sift-analysis-body" hidden></div>`;

  // Race the analysis against a short timeout. For already-analyzed tracks (DB cache hit)
  // we win the race and can pass peaks to WaveSurfer.create() — which renders the waveform
  // instantly from the pre-computed data. For fresh tracks the timeout fires first and we
  // mount without peaks so audio starts loading while analysis runs in the background.
  // 300ms (not 20-80ms): the DB hit itself is fast, but the full invoke round-trip (IPC
  // dispatch + JSON (de)serialization of the report incl. the peaks array) regularly exceeds
  // 80ms in a `tauri dev` debug build, which was tripping the timeout — and showing the
  // "Analyse en cours…" stub — for tracks that were in fact already analyzed.
  const earlyResult = await Promise.race([
    analysisPromise.catch((): null => null),
    new Promise<null>((res) => setTimeout(() => res(null), 300)),
  ]) as AnalysisReport | null;

  if (seq !== openSeq) return null;

  if (earlyResult) {
    reportCache.set(path, earlyResult);
    // Pass peaks to the constructor — the only path that renders the waveform immediately.
    void mountPlayer(container, path, earlyResult.peaks, earlyResult.duration_sec || undefined);
    const bodyEl = diagContainer.querySelector<HTMLElement>(".sift-analysis-body");
    verdictContainer.innerHTML = "";
    fillVerdictLanding(container, earlyResult);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(earlyResult);
      bodyEl.hidden = false;
      wireSpectrogram(diagContainer, earlyResult);
    }
    return earlyResult;
  }

  // Timeout fired — this is a genuinely fresh track (no DB cache to hit), so the wait is
  // real. Only now does the loader text get shown.
  // Squelette STATIQUE (DESIGN §6 : la donnée ne s'anime jamais ; jamais un spinner nu) : une
  // barre placeholder à la place du verdict, le temps que l'analyse résolve. Pas de .sift-spin.
  verdictContainer.innerHTML =
    `<span class="sift-skel" style="width:6em;height:var(--space-16)"></span>`;
  void mountPlayer(container, path);

  try {
    const r = await analysisPromise;
    reportCache.set(path, r);
    if (seq !== openSeq) return null;
    const bodyEl = diagContainer.querySelector<HTMLElement>(".sift-analysis-body");
    verdictContainer.innerHTML = "";
    fillVerdictLanding(container, r);
    if (bodyEl) {
      bodyEl.innerHTML = spectroAndTagsHtml(r);
      bodyEl.hidden = false;
      wireSpectrogram(diagContainer, r);
    }
    return r;
  } catch (e) {
    console.error("analyze_path failed", e);
    if (seq !== openSeq) return null;
    headerOpts.onAnalysisError?.(String(e));
    if (headerOpts.showAnalysisFailure !== false) {
      // decode.rs's open_format already humanizes the common failure (file moved/deleted) into
      // French prose meant for display (see analysis/decode.rs) — the generic "Réessaie" this
      // replaced (audit UX/accessibilité 2026-07-24) silently dropped that message. Show the
      // backend text directly, same pattern as filing-identify.ts/library-detail.ts's error cards.
      //
      // SAUF le fichier disparu. Sa phrase porte la sentinelle `FILE_GONE` (« n'existe plus »), que
      // Rust reconnaît lui-même avant de SUPPRIMER la ligne en base : `decode.rs` la garde donc en
      // français quelle que soit la langue, et la traduction se fait ICI, à l'affichage — jamais
      // dans le message, où elle casserait la reconnaissance en anglais seulement.
      const raw = String(e);
      const shown = raw.includes(FILE_GONE) ? T().analysisFileGone : raw;
      verdictContainer.innerHTML = `<div class="sift-analysis-fail">${esc(shown)}</div>`;
    }
    return null;
  }
}

