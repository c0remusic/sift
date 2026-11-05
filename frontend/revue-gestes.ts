// Les deux gestes secondaires de Revue, sans DOM : testables en env Node.
//
// Décidé par Antoine le 2026-11-05. Une piste écartée parce qu'elle n'est pas à son goût n'a rien à
// faire dans À re-sourcer, qui est une liste d'achat : 269 pistes sur 320 y étaient des VRAI. Les
// deux gestes sont donc présents sur TOUTE piste, et chaque touche garde le même sens, quel que soit
// le verdict. ⌫ a longtemps changé de sens selon le verdict : ne pas y revenir.

export type GesteSecondaire = "resource" | "trash";

/** Le geste d'une touche nue de Revue, `null` si elle n'en porte aucun. */
export function gesteDeTouche(key: string): GesteSecondaire | null {
  if (key === "Backspace" || key === "x" || key === "X") return "trash";
  if (key === "r" || key === "R") return "resource";
  return null;
}

interface Libelles {
  resource: string;
  resourceTitle: string;
  trash: string;
  trashTitle: string;
}

/** Les deux boutons, toujours les deux, Re-source puis Corbeille. Texte seul. */
export function actionsSecondairesHtml(tx: Libelles): string {
  return (
    `<button data-fil="resource" class="sift-secondary-resource" title="${tx.resourceTitle}">${tx.resource}</button>` +
    `<button data-fil="trash" class="sift-secondary-trash" title="${tx.trashTitle}">${tx.trash}</button>`
  );
}
