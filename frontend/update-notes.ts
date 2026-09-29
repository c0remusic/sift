// Le résumé des notes de version que montre la bannière de mise à jour. Module pur, sans DOM ni
// IPC, pour être tenu par Vitest en env Node : `updater.ts` importe le plugin Tauri.
import { CHANGELOG_LANG_HEADINGS as HEADINGS } from "../shared/contracts";
import type { Lang } from "./i18n";

/** Longueur au-delà de laquelle le résumé est coupé. La bannière est une ligne : au-delà elle
 *  pousse les deux boutons hors de la fenêtre sur un écran étroit — le défaut que `fix(updater):
 *  keep the update banner from clipping on narrow windows` a déjà corrigé une fois. */
const NOTES_MAX_CHARS = 90;

/** Première ligne utile des notes de version, dans la langue de l'interface, ramenée à une phrase
 *  courte.
 *
 *  Les notes sont du Markdown (section de `CHANGELOG.md`) : on ne le rend PAS — la bannière
 *  n'est pas un lecteur de changelog, et rendre du Markdown venu du réseau ouvrirait une surface
 *  d'injection pour économiser une ligne de texte. On prend le premier titre de sous-section, ou
 *  à défaut la première ligne de prose, débarrassée de ses marqueurs.
 *
 *  Une section bilingue (`### Français` puis `### English`, #75) se lit à partir du titre de la
 *  langue de l'interface, et s'arrête au titre de l'autre : sans cela, l'interface anglaise
 *  affichait la première ligne, donc la française. Une section sans ces titres (versions
 *  antérieures à #75) se lit depuis le début, comme avant.
 *
 *  Retourne `""` quand il n'y a rien de présentable — l'appelant n'affiche alors rien du tout,
 *  plutôt qu'un espace vide ou un tiret orphelin. */
export function summariseNotes(body: string | undefined, lang: Lang): string {
  if (!body) return "";
  const lines = body.split(/\r?\n/);
  const own = lines.findIndex((l) => l.trim() === HEADINGS[lang]);
  const other = HEADINGS[lang === "fr" ? "en" : "fr"];
  for (const raw of lines.slice(own + 1)) {
    // Le titre de l'autre langue termine la nôtre. Quand notre titre manque (`own` à -1), la
    // lecture part du début et s'arrête au même endroit : jamais l'autre langue à la place.
    if (raw.trim() === other) return "";
    const line = raw
      .trim()
      .replace(/^#{1,6}\s*/, "") // titre Markdown
      .replace(/^[-*]\s+/, "") // puce
      .replace(/\*\*/g, "") // gras
      .replace(/`/g, "")
      .trim();
    // `---` sépare le pied de page d'installation : tout ce qui suit n'est pas un changement.
    if (line === "---") return "";
    if (!line) continue;
    return line.length > NOTES_MAX_CHARS ? `${line.slice(0, NOTES_MAX_CHARS - 1).trimEnd()}…` : line;
  }
  return "";
}
