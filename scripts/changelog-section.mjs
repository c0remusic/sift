// Extrait de CHANGELOG.md la section d'une version, pour la passer en `releaseBody`
// (`.github/workflows/release.yml`). Ce texte finit sur la page GitHub de la release ET dans le
// champ `notes` de `latest.json`, que chaque installation existante telecharge.
//
// Fail fast, pas de repli silencieux : une section absente sort en code 1 et fait echouer le
// build de release. Publier des notes vides serait pire que ne pas publier — les installations
// existantes recevraient un `notes` vide sans que rien ne le signale.
//
// Usage : node scripts/changelog-section.mjs v0.0.3
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/changelog-section.mjs <tag>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = await readFile(join(root, "CHANGELOG.md"), "utf8");

// Les sections de version sont les titres de NIVEAU 2 (`## vX.Y.Z`) et rien d'autre : les
// sous-titres d'une section sont en niveau 3, donc ils ne peuvent pas la terminer par accident.
const lines = md.split(/\r?\n/);
const isVersionHeading = (l) => /^## v\d+\.\d+\.\d+\s*$/.test(l);
const start = lines.findIndex((l) => l.trim() === `## ${tag}`);
if (start === -1) {
  console.error(
    `CHANGELOG.md n'a pas de section "## ${tag}". ` +
      `L'ajouter avant de publier ce tag — les notes de version ne s'inventent pas au build.`,
  );
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (isVersionHeading(lines[i])) {
    end = i;
    break;
  }
}

const body = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();

if (!body) {
  console.error(`La section "## ${tag}" de CHANGELOG.md est vide.`);
  process.exit(1);
}

// Le heredoc de release.yml delimite par CHANGELOG_EOF : si ce marqueur apparaissait dans le
// texte, la sortie GITHUB_OUTPUT serait tronquee en silence et le corps publie serait faux.
if (body.includes("CHANGELOG_EOF")) {
  console.error(
    "La section contient le marqueur CHANGELOG_EOF, qui delimite le heredoc de release.yml.",
  );
  process.exit(1);
}

// Pied de page stable, ajoute a CHAQUE version : il ne decrit pas ce qui a change, il dit
// comment installer. Sa place est ici et pas dans CHANGELOG.md, ou il faudrait le recopier a
// chaque section — donc l'oublier une fois.
//
// Les etapes macOS sont donnees en clair plutot que par un simple lien : c'est la premiere
// chose que rencontre quelqu'un a qui on envoie le lien, et le contournement par clic droit
// ne fonctionne plus depuis macOS 15 Sequoia.
//
// Le tableau du fichier a prendre passe AVANT les messages du systeme, et ce n'est pas un choix
// de mise en page. Le 2026-08-16, la premiere installation sans accompagnement a echoue avant
// meme d'atteindre Gatekeeper : la release expose HUIT assets, et l'ami d'Antoine a telecharge
// `Sift_0.0.3_aarch64.app.tar.gz` (34 198 810 octets, confirme contre la taille vue sur sa
// capture) au lieu du `.dmg` (33 204 781). L'artefact d'auto-update pese plus lourd que
// l'installeur, donc il a l'air d'etre le bon. Un `.app` sorti d'un tar.gz telecharge porte la
// quarantaine et n'est pas signe : « is damaged », sans bouton pour continuer.
//
// La doc existait et etait juste. Le defaut etait de PRESENTATION des assets, pas de contenu —
// d'ou ce tableau, et la liste explicite de ce qui ne s'installe pas. Vaut aussi pour Windows,
// ou `.exe` et `.msi` sont tous deux publies et ou rien ne disait lequel prendre.
const FOOTER = `
---

### Installation

Ces builds ne sont pas signes : le systeme avertit au premier lancement. Une seule fois.

**Un seul fichier a telecharger, selon la machine :**

| machine | fichier |
|---|---|
| Windows | \`Sift_<version>_x64-setup.exe\` |
| Mac Apple Silicon | \`Sift_<version>_aarch64.dmg\` |

Tout le reste de la liste sert a la mise a jour automatique et **ne s'installe pas** :
\`.app.tar.gz\`, \`.msi\`, les \`.sig\`, \`latest.json\`. Le \`.app.tar.gz\` est le piege — il pese
PLUS LOURD que le \`.dmg\`, donc il a l'air d'etre le bon.

**Windows** — SmartScreen affiche « Windows a protege votre ordinateur » : cliquer
**Informations complementaires**, puis **Executer quand meme**.

**macOS** (Apple Silicon uniquement) — ouvrir le \`.dmg\`, glisser Sift dans Applications, puis
selon le message affiche :

- « developpeur non identifie » : **Reglages Systeme > Confidentialite et securite**, descendre
  jusqu'au message concernant Sift, cliquer **Ouvrir quand meme**.
- « Sift is damaged and can't be opened » : ce message n'offre PAS de bouton « Ouvrir quand
  meme ». Dans le Terminal — le \`-r\` est indispensable, un \`.app\` est un dossier :
  \`xattr -dr com.apple.quarantine /Applications/Sift.app\`
  Si le message persiste : \`codesign --force --deep --sign - /Applications/Sift.app\`

### Se servir de Sift

Le manuel — vocabulaire, les huit ecrans, et ce que la detection laisse passer :
https://github.com/c0remusic/sift/blob/main/docs/manuel.md
`;

process.stdout.write(body + "\n" + FOOTER);
