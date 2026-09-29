// Shared, stateless rendering of Discogs candidate rows — used by both the Revue filing
// footer (filing.ts) and the Bibliothèque detail panel (library-detail.ts). Pure HTML
// builders + the open-listbox layout; the stateful apply/changer wiring
// lives in each caller (it differs: filing edits canonical fields, the library edits a
// filed track's metadata). Keeps the candidate markup in one place (spec: zero duplication).
import type { Candidate } from "./ipc";
import type { Canonical, IdentifyHint } from "../shared/contracts";
import { esc } from "./dom";
import { humanizeError } from "./errors";
import { T } from "./i18n/identify-shared";

/** L'indice que Revue envoie à `identify` : ce que l'écran affiche, mais SEULEMENT une valeur
 *  confirmée (verte : tags propres, nom propre, release choisie) ou tapée depuis l'ouverture.
 *  La supposition jaune de `reconcile` sur un nom sale passait sinon devant la cascade
 *  `search_terms` construite pour ces noms-là, et lui volait la première marche (relecture #67). */
export function identifyHint(c: Canonical | null, typedSinceOpen: boolean): IdentifyHint | null {
  if (!c || !(c.confidence === "green" || typedSinceOpen)) return null;
  return { artist: c.artist, title: c.title, version: c.version };
}

/** Cover thumbnail (or vinyl placeholder) for a candidate row. */
function candCoverHtml(c: Candidate): string {
  if (c.cover_url) {
    return `<img src="${esc(c.cover_url)}" alt="" class="sift-cand-noart" loading="lazy">`;
  }
  return '<span class="sift-cand-noart"><i class="ti ti-vinyl" style="font-size:var(--text-xl);color:var(--color-text-tertiary)"></i></span>';
}

/** One candidate button row (sub-line: label · year · country · format). Toujours rendue DANS une
 *  listbox depuis que la variante repliée a disparu (voir `renderCandidates`) : la ligne porte donc
 *  role=option + aria-selected sans condition, et `opt` n'est plus optionnel — le laisser optionnel
 *  recréerait, dans ce fichier même, l'option sans variateur que ce correctif retire. */
function candRowHtml(c: Candidate, idx: number, opt: { selected: boolean }): string {
  const sub = [c.label, c.year != null ? String(c.year) : null, c.country, c.format]
    .filter(Boolean)
    .join(" · ");
  const roleAttr = ` role="option" aria-selected="${opt.selected}"`;
  return (
    `<button class="sift-cand" data-cand="${idx}"${roleAttr}>` +
    candCoverHtml(c) +
    `<span class="sift-cand-meta"><span>${esc(c.artist)} — ${esc(c.title)}</span>` +
    (sub ? `<small>${esc(sub)}</small>` : "") +
    `</span></button>`
  );
}

/** La release CHOISIE, rendue SEULE après la fermeture de la liste (retours d'Antoine des
 *  2026-09-06/07 : une liste qui reste ouverte après le choix se lit comme inachevée, mais la
 *  release choisie, elle, doit rester visible). Même anatomie qu'une ligne candidate — pochette,
 *  « artiste — titre », sous-ligne. `coverSrc` : URL Discogs (choix frais) ou fichier local
 *  converti (réopen).
 *
 *  `others` > 0 (#68, décision du 2026-09-29) : la ligne devient le CONTRÔLE qui rouvre la liste
 *  des candidats déjà connus, sans requête — un <button data-cand-switch> qui porte à droite
 *  « N autres » et un chevron. Sinon un <div> inerte, comme avant : aucune liste en mémoire
 *  (redémarrage, piste jamais cherchée cette session), ou aucune autre release à proposer. */
export function chosenRowHtml(
  r: {
    artist: string;
    title: string;
    sub: string;
    coverSrc: string | null;
  },
  others = 0,
): string {
  const cover = r.coverSrc
    ? `<img src="${esc(r.coverSrc)}" alt="" class="sift-cand-noart">`
    : '<span class="sift-cand-noart"><i class="ti ti-vinyl" style="font-size:var(--text-xl);color:var(--color-text-tertiary)"></i></span>';
  const meta =
    `<span class="sift-cand-meta"><span>${esc(r.artist)} — ${esc(r.title)}</span>` +
    (r.sub ? `<small>${esc(r.sub)}</small>` : "") +
    `</span>`;
  if (others <= 0) return `<div class="sift-cand sift-cand-chosen">` + cover + meta + `</div>`;
  const L = T();
  return (
    `<button type="button" class="sift-cand sift-cand-chosen sift-cand-switch" data-cand-switch` +
    ` aria-haspopup="listbox" title="${L.switchTitle}">` +
    cover +
    meta +
    `<span class="sift-cand-others">${L.others(others)}<i class="ti ti-chevron-down" aria-hidden="true"></i></span>` +
    `</button>`
  );
}

/** Render candidates into `host` : une LISTE OUVERTE (listbox) — tous les candidats visibles, un
 *  seul pré-sélectionné (aria-selected) : le meilleur (indice 0) après une recherche, la release
 *  APPLIQUÉE quand la ligne choisie rouvre la liste (#68). La décision centrale ne coûte pas un
 *  clic d'ouverture, et se navigue au clavier (`wireCandidateKeys`).
 *
 *  DISPOSITION UNIQUE depuis le 2026-09-08 (`ded5c9a`), et c'est ce qui a rendu le paramètre
 *  `opts` mort : la Bibliothèque, dernier appelant de la variante repliée « premier résultat +
 *  N autres », est passée elle aussi à la liste ouverte en reprenant la fiche de Revue. Les deux
 *  appelants passaient dès lors `open: true`, donc la branche repliée était INATTEIGNABLE et le
 *  doc-comment continuait de l'annoncer comme le rendu de la Bibliothèque. `selectedIdx` ne
 *  variait pas davantage : la navigation clavier déplace le FOCUS, elle ne re-rend rien.
 *  Retirée ici avec ses quatre règles `.sift-cand-more*` de `styles.css` — sans elles, la gate
 *  `npm run lint:orphan-css` serait montée de 16 à 18 : ces quatre règles ne portent que deux
 *  NOMS de classe, et c'est des noms que la gate compte.
 *
 *  `selectedIdx` est revenu le 2026-09-29 (#68), et pour une raison qui n'existait pas alors : la
 *  liste se rouvre depuis la ligne choisie, et c'est la release appliquée qu'elle doit montrer
 *  sélectionnée, pas la première.
 *
 *  Empty list → a neutral "no results" message (no warning styling). */
export function renderCandidates(host: HTMLElement, list: Candidate[], selectedIdx = 0): void {
  const L = T();
  if (list.length === 0) {
    host.innerHTML = `<div class="sift-cands-msg">${L.nothing}</div>`;
    return;
  }
  host.innerHTML =
    `<div class="sift-cands-list" role="listbox" aria-label="${L.releases}">` +
    list.map((c, i) => candRowHtml(c, i, { selected: i === selectedIdx })).join("") +
    `</div>`;
}

/** Le clavier de l'hôte des candidats (`.sift-cands-host`), posé UNE fois sur l'hôte, qui survit
 *  aux rendus de son contenu.
 *
 *  Il ARRÊTE la propagation de toute touche sans modificateur, Tab excepté. Les raccourcis de Revue
 *  écoutent `document` (`filing.ts::installFilingKeys`) et ne s'écartent que devant un champ de
 *  saisie : Entrée sur un candidat focalisé RANGEAIT la piste en plus d'appliquer la release,
 *  Espace lançait la lecture, ⌫ l'écartait. Ici Entrée et Espace ne font que ce que fait un bouton
 *  natif — un clic.
 *
 *  ↑/↓ déplacent le focus d'un candidat à l'autre. Échap appelle `onEscape`, qui dit s'il a fermé
 *  quelque chose : sinon la touche continue son chemin. */
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function wireCandidateKeys(host: HTMLElement, onEscape: () => boolean): void {
  host.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab") return;
    if (e.key === "Escape") {
      if (onEscape()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Hors de la liste — sur la ligne choisie — les touches de navigation continuent vers la table ou
    // la file : la ligne n'a rien à parcourir, et la Bibliothèque perdait ↑/↓ après un Échap.
    const inList = (e.target as Element | null)?.closest?.(".sift-cands-list");
    if (!inList && NAV_KEYS.has(e.key)) return;
    e.stopPropagation();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(host.querySelectorAll<HTMLElement>(".sift-cands-list [data-cand]"));
    const cur = btns.indexOf(document.activeElement as HTMLElement);
    if (cur < 0) return;
    const next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
    if (next >= 0 && next < btns.length) {
      e.preventDefault();
      btns[next].focus();
    }
  });
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
  const { texte, grave, gotoReglages } = identifyErrorText(err);
  const classe = grave ? "sift-cands-msg sift-cands-error" : "sift-cands-msg";
  const icone = grave ? `<i class="ti ti-alert-triangle sift-cand-error-icon"></i>` : "";
  return { html: `<div class="${classe}">${icone}${esc(texte)}</div>`, gotoReglages };
}

/** La MÊME phrase, sans balise — pour une surface qui n'est pas la liste de candidats.
 *
 *  Extrait le 2026-08-18 en câblant le bouton « Vérifier » des Réglages (impasse A11, issue #15).
 *  Le second appelant aurait sinon recopié les quatre branches, et c'est exactement le défaut que
 *  cette fonction-ci a été écrite pour corriger : la cascade dupliquée portait deux fois les mêmes
 *  deux erreurs de texte (A9 et A10).
 *
 *  `grave` sépare ce qui accuse le fichier ou le jeton de ce qui demande d'attendre — c'est la
 *  seule distinction dont une surface a besoin pour choisir son ton. `humanizeError` reste appelé
 *  ICI, une fois, pour que la chaîne brute parte en console quelle que soit la branche. */
export function identifyErrorText(err: unknown): {
  texte: string;
  grave: boolean;
  gotoReglages: boolean;
} {
  const msg = String(err);
  humanizeError(err, msg, "identify");
  const L = T();
  if (msg.includes("NO_TOKEN")) {
    return {
      texte: L.noToken,
      grave: false,
      gotoReglages: true,
    };
  }
  if (msg.includes("BAD_TOKEN")) {
    return {
      texte: L.badToken,
      grave: true,
      gotoReglages: true,
    };
  }
  const rl = msg.match(/RATE_LIMITED:(\d+)/);
  if (rl) {
    return {
      texte: L.rateLimited(rl[1]),
      grave: false,
      gotoReglages: false,
    };
  }
  return { texte: L.unreachable, grave: true, gotoReglages: false };
}
