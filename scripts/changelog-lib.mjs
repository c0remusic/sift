// Lecture de CHANGELOG.md, partagée par `changelog-section.mjs` (appelé par release.yml) et par
// son test. Séparée du script pour que le test exerce la VRAIE règle sur un texte qu'il choisit,
// sans dépendre de ce que contient le CHANGELOG du jour.

/** Seuls les titres de NIVEAU 2 (`## vX.Y.Z`) délimitent une version : les sous-titres d'une
 *  section sont en niveau 3 ou 4, donc ils ne la terminent jamais par accident. */
const isVersionHeading = (l) => /^## v\d+\.\d+\.\d+\s*$/.test(l);

/** Le corps de la section `## <tag>`, sans son titre, espaces de bord retirés. `null` si la
 *  section n'existe pas ; `""` si elle existe vide — les deux sont des refus pour l'appelant. */
export function sectionOf(md, tag) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${tag}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isVersionHeading(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/** Dernière version publiée avec des notes en français seul. L'interface existe en anglais depuis
 *  le 2026-09-23, et ses notes de mise à jour arrivent dans la bannière de l'app (#75) : toute
 *  version APRÈS celle-ci porte les deux langues. Les sections déjà publiées ne se réécrivent pas
 *  — `latest.json` a été généré au build, les éditer ne changerait rien pour qui les a reçues. */
export const LAST_FRENCH_ONLY = "v0.1.3";

function versionAfter(tag, ref) {
  const parse = (t) => t.replace(/^v/, "").split(".").map(Number);
  const [a, b] = [parse(tag), parse(ref)];
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export const HEADING_FR = "### Français";
export const HEADING_EN = "### English";

/** Ce qui manque à la section `body` de `tag` pour être bilingue, ou `null` si rien. La forme :
 *  `### Français` puis `### English`, chacun suivi de son texte (rubriques en `####`). Le
 *  français d'abord, parce que c'est lui qu'un lecteur de la page GitHub trouve sans faire
 *  défiler — Sift est écrit en français. */
export function bilingualProblem(tag, body) {
  if (!versionAfter(tag, LAST_FRENCH_ONLY)) return null;
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const fr = lines.indexOf(HEADING_FR);
  const en = lines.indexOf(HEADING_EN);
  const why =
    `l'interface existe aussi en anglais, et la bannière de mise à jour affiche les notes dans ` +
    `la langue de l'app (#75).`;
  if (fr === -1 || en === -1) {
    return `La section "## ${tag}" doit porter "${HEADING_FR}" puis "${HEADING_EN}" : ${why}`;
  }
  if (en < fr) return `La section "## ${tag}" doit donner le français AVANT l'anglais.`;
  const hasText = (from, to) => lines.slice(from + 1, to).some((l) => l.length > 0);
  if (!hasText(fr, en)) return `La moitié "${HEADING_FR}" de "## ${tag}" est vide.`;
  if (!hasText(en, lines.length)) return `La moitié "${HEADING_EN}" de "## ${tag}" est vide.`;
  return null;
}
