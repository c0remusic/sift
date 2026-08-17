// Shared, stateless rendering of Discogs candidate rows — used by both the Revue filing
// footer (filing.ts) and the Bibliothèque detail panel (library-detail.ts). Pure HTML
// builders + the "first result + N others" list layout; the stateful apply/changer wiring
// lives in each caller (it differs: filing edits canonical fields, the library edits a
// filed track's metadata). Keeps the candidate markup in one place (spec: zero duplication).
import type { Candidate } from "./ipc";
import { esc } from "./dom";
import { humanizeError } from "./errors";

/** Cover thumbnail (or vinyl placeholder) for a candidate row. */
function candCoverHtml(c: Candidate): string {
  if (c.cover_url) {
    return `<img src="${esc(c.cover_url)}" alt="" class="sift-cand-noart" loading="lazy">`;
  }
  return '<span class="sift-cand-noart"><i class="ti ti-vinyl" style="font-size:var(--text-xl);color:var(--color-text-tertiary)"></i></span>';
}

/** One candidate button row (sub-line: label · year · country · format). */
function candRowHtml(c: Candidate, idx: number): string {
  const sub = [c.label, c.year != null ? String(c.year) : null, c.country, c.format]
    .filter(Boolean)
    .join(" · ");
  return (
    `<button class="sift-cand" data-cand="${idx}">` +
    candCoverHtml(c) +
    `<span class="sift-cand-meta"><span>${esc(c.artist)} — ${esc(c.title)}</span>` +
    (sub ? `<small>${esc(sub)}</small>` : "") +
    `</span></button>`
  );
}

/** Render candidates into `host`: first result inline, the rest behind a "N autres résultats"
 * disclosure. Empty list → a neutral "no results" message (no warning styling). */
export function renderCandidates(host: HTMLElement, list: Candidate[]): void {
  if (list.length === 0) {
    host.innerHTML = '<div class="sift-cands-msg">Rien sur Discogs.</div>';
    return;
  }
  const [first, ...rest] = list;
  const moreHtml = rest.length
    ? `<details class="sift-cand-more"><summary class="sift-cand-more-summary">▸ ${rest.length} autre${rest.length > 1 ? "s" : ""} résultat${rest.length > 1 ? "s" : ""}</summary>${rest.map((c, i) => candRowHtml(c, i + 1)).join("")}</details>`
    : "";
  host.innerHTML = candRowHtml(first, 0) + moreHtml;
}

/** Ce qu'un échec d'identification Discogs dit à l'utilisateur, en un seul endroit.
 *
 *  Les deux appelants (`filing-identify.ts`, `library-detail.ts`) portaient la même cascade de
 *  branches, dupliquée — et donc les mêmes deux défauts, deux fois :
 *
 *  - **A9** (issue #15) : le texte NO_TOKEN parlait de « recherches anonymes ». Il n'en existe
 *    aucune. `ipc_identify.rs` rend `NO_TOKEN` AVANT tout appel réseau et `settings.rs` le dit —
 *    « Empty/unset = identification disabled ». Sans jeton l'identification n'est pas dégradée,
 *    elle est absente.
 *  - **A10** (issue #15) : un jeton refusé (401/403) arrivait ici en `NETWORK:` et s'affichait
 *    « Discogs injoignable », envoyant l'utilisateur vérifier une connexion qui allait bien.
 *    `BAD_TOKEN:` existe désormais côté Rust ; il se dit comme ce qu'il est.
 *
 *  Ce n'est PAS la table code -> message qu'`errors.ts` refuse : là-bas le refus porte sur un
 *  humanisateur générique deviné, appliqué à toutes les erreurs de l'app. Ici les quatre codes
 *  sont produits par un seul `ProviderError::code()`, à trois `match` de distance, et l'un d'eux
 *  porte une donnée à afficher (les secondes du débit).
 *
 *  La chaîne brute part en console ICI, une fois, via `humanizeError` — c'est le seul point qui
 *  voit toutes les branches, donc le seul où la garantie ne peut pas être oubliée par une branche
 *  ajoutée plus tard. */
export function identifyErrorHtml(err: unknown): { html: string; gotoReglages: boolean } {
  const msg = String(err);
  humanizeError(err, msg, "identify");
  if (msg.includes("NO_TOKEN")) {
    return {
      html: `<div class="sift-cands-msg">L'identification Discogs demande un jeton — sans lui, Sift n'interroge pas Discogs du tout. Il est gratuit et se colle dans Réglages.</div>`,
      gotoReglages: true,
    };
  }
  if (msg.includes("BAD_TOKEN")) {
    return {
      html: `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>Discogs a refusé le jeton — il est invalide, expiré ou révoqué. Ce n'est pas la connexion : réessayer ne changera rien.</div>`,
      gotoReglages: true,
    };
  }
  const rl = msg.match(/RATE_LIMITED:(\d+)/);
  if (rl) {
    return {
      html: `<div class="sift-cands-msg">Discogs limite le débit — réessaie dans ${esc(rl[1])}s.</div>`,
      gotoReglages: false,
    };
  }
  return {
    html: `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>Discogs injoignable.</div>`,
    gotoReglages: false,
  };
}
