// Le glissement du pouce d'un contrôle segmenté — géométrie DOM pure, zéro import applicatif
// (même précédent que `popover-position.ts`, qui est sorti de `filing-bins.ts` pour la même raison :
// un calcul de position n'a besoin de rien d'autre que du nœud qu'il déplace).
//
// Six écrans montent un `.sift-seg-thumbed` — la barre unifiée, la file Revue, le format de la
// Revue, le format du mode Lot, le mode de vue Bibliothèque et le thème des Réglages — et chacun
// portait sa propre copie de ces quatre lignes. Elles ne divergeaient pas encore ; c'est justement
// le moment de n'en garder qu'une, parce que ce qui est mesuré ici (`offsetWidth`/`offsetLeft`, donc
// un reflow forcé) est aussi le genre de détail qu'on n'optimise qu'une fois.

/** Place le pouce `.sift-seg-thumb` sous l'option qui porte `.on`, à l'intérieur de `seg`.
 *
 *  `seg` est l'HÔTE de la recherche, pas forcément le `.sift-seg` lui-même : Réglages passe le bloc
 *  qui contient le segmenté, ce qui revient au même tant qu'il n'y en a qu'un dedans.
 *
 *  L'état actif est relu DEPUIS LE DOM (`onSelector`) plutôt que reçu en paramètre : la classe qui
 *  vient d'être posée fait foi, et la géométrie se mesure sur le nœud tel qu'il est maintenant.
 *
 *  Garde muette, et c'est voulu à chaque site : pouce ou option absents veut dire « rien à placer »
 *  — un segmenté dont toutes les options sont désactivées (un source lossy où seul MP3 reste
 *  cliquable) n'a pas d'option `.on`, et le pouce doit simplement rester où il est. */
export function slideSegThumb(seg: HTMLElement, onSelector = ".sift-seg-opt.on"): void {
  const thumb = seg.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg.querySelector<HTMLElement>(onSelector);
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}
