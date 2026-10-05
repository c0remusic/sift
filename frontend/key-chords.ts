// Ce que veulent dire ⌘/Ctrl+Z et ⌘/Ctrl+A selon Maj : deux accords dont une erreur passe en
// silence. Sans DOM et sans import, donc testable en env Node (`test/key-chords.test.ts`).
//
// Trouvé le 2026-10-05, au triage de #58 :
//   · `installUndoShortcut` (`filing.ts`) ne regardait pas Maj. ⇧⌘Z — « Rétablir » dans toute app
//     Mac, et Ctrl+Maj+Z, son équivalent courant sous Windows — annulait donc une SECONDE action
//     du journal. Sift n'a pas de rétablir : l'accord ne doit rien faire.
//   · ⇧⌘A sélectionnait TOUT en Bibliothèque (`shortcuts.ts`) et au Journal (`journal.ts`), alors
//     que le manuel (`docs/manuel.md`) et la HIG Keyboards (« Shift-Command-A : Deselect all ») en
//     font « Tout désélectionner » — ce que le mode Lot de Revue faisait déjà (#60).

/** Les champs d'un `KeyboardEvent` que ces accords lisent. */
export interface Chord {
  key: string;
  /** La touche PHYSIQUE (`KeyI`), indépendante de la disposition et de ce qu'Option produit sur
   *  Mac : ⌥I y donne la touche morte « ˆ », jamais « i ». */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Une touche NUE (Maj tolérée) : la seule forme que prennent les accélérateurs à une touche de
 *  Revue (Espace, Entrée, ⌫, X, I — `filing.ts`). Jusqu'au 2026-10-05, leur gestionnaire ne
 *  regardait aucun modificateur : Ctrl+X, le réflexe « couper », ÉCARTAIT la piste ouverte,
 *  Ctrl+Entrée la rangeait. La couche 1 (`shortcuts.ts`) prend les accords, la couche 3 les touches
 *  nues — c'est ce partage qui leur permet de cohabiter. */
export function isBareKey(e: Chord): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** ⌥⌘I sur Mac, Ctrl+Alt+I sous Windows : masquer ou afficher l'inspecteur (zone D). Le raccourci
 *  de Pages pour « Hide or show sidebars on the right side of the Pages window »
 *  (support.apple.com, guide de Pages, raccourcis clavier). Lu sur la touche physique. */
export function isInspectorToggleChord(e: Chord): boolean {
  return (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyI";
}

/** ⌘/Ctrl+Z, sans Maj ni Alt : l'annulation du journal. Ctrl ET ⌘ sont acceptés plutôt qu'un
 *  branchement sur `platform()`, pour la raison écrite au-dessus d'`installUndoShortcut`. Alt est
 *  exclu : sur un clavier AZERTY, AltGr arrive comme Ctrl+Alt et n'est pas un raccourci. */
export function isUndoChord(e: Chord): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z");
}

/** ⌘/Ctrl+A : « tout » ; avec Maj : « rien ». Toute autre frappe : `null`. Même règle Alt. */
export function selectionChord(e: Chord): "all" | "none" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key !== "a" && e.key !== "A") return null;
  return e.shiftKey ? "none" : "all";
}
