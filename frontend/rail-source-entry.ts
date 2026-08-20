// Ligne de source du rail — markup pur, SANS import de `./ipc`, chargeable par Vitest en env Node
// et par Storybook (même séparation que `source-color.ts` et `popover-position.ts`). La story
// appelle CE rendu au lieu d'en recopier le markup — même motif que la refonte des stories du
// Journal du 2026-08-20 : une copie ne peut que diverger.
import type { Source } from "../shared/contracts";
import { esc } from "./dom";
import { resolveSourceColorKey } from "./source-color";

/** Dernier segment d'un chemin, séparateurs Windows et POSIX confondus. */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

/** Une entrée de source. Même grammaire que les autres entrées du rail (`.nv`) : la section
 *  Sources n'est pas un composant à part, c'est le rail avec un contenu de plus. La pastille de
 *  couleur est un accent CATÉGORIEL — elle identifie la source ailleurs dans l'app, elle ne porte
 *  aucun état (DESIGN.md § 4). Teinte : override manuel sinon cycle par ordre d'ajout
 *  (`source-color.ts`) — jamais neutre : un gris uniforme n'identifierait rien.
 *
 *  États (rail.md § États) : l'échec PRIME sur la suspension — « jamais atténuée », un échec se
 *  voit mieux que le reste, pas moins bien — donc `--suspended` ne se pose que sans `--error`.
 *  La suspension ne touche pas l'encre de la ligne : le repos de `.nv` est déjà
 *  `--color-text-tertiary`, la valeur que la spec prescrit. Son signal est la pastille VIDÉE
 *  (contour sans fond, teinte conservée — voir `styles.css` § section Sources). */
export function sourceEntryHtml(
  s: Source,
  all: Source[],
  active: boolean,
  failure: string | undefined,
): string {
  const hue = ` sift-rail-src-dot-${esc(resolveSourceColorKey(all, s))}`;
  const count = s.pending_count > 0 ? `<span class="nav-badge">${s.pending_count}</span>` : "";
  const broken = !s.accessible || failure != null;
  const suspended = !s.watched && !broken;
  const state = broken ? " sift-rail-src--error" : suspended ? " sift-rail-src--suspended" : "";
  const title = !s.accessible
    ? `${s.path} — dossier inaccessible`
    : failure
      ? `${s.path} — scan en échec : ${failure}`
      : suspended
        ? `${s.path} — surveillance suspendue`
        : s.path;
  return (
    `<div class="nv sift-rail-src${active ? " on" : ""}${state}" data-src="${s.id}" tabindex="0" role="button" title="${esc(title)}">` +
    `<span class="sift-rail-src-dot${hue}" aria-hidden="true"></span>` +
    `<span>${esc(baseName(s.path))}</span>${count}</div>`
  );
}
