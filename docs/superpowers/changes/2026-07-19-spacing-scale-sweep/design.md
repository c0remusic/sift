# Sweep échelle d'espacement — design

## Constat (audit design 2026-07-19)

`.interface-design/system.md:79` déclare une échelle stricte : `xs 4 · sm 8 ·
md 12 · lg 16 · xl 24 · xxl 32` — "toute autre valeur interdite". En pratique,
`frontend/styles.css` (≈262 déclarations `padding`/`margin`/`gap`/`width`/
`height` en px) contient un grand nombre de valeurs hors échelle (5, 6, 7, 9,
10, 13, 14, 15, 18px...) réparties sur la quasi-totalité du fichier — pas un
site isolé. Deux fixes ponctuels ont déjà été faits ce jour (`library-detail.ts`,
`batch-panel.ts` — 6 sites snappés sur `--space-4`/`--space-8`), mais le sweep
complet a été explicitement ANNULÉ en session pour éviter un changement visuel
de masse non vérifié (voir décision utilisateur du 2026-07-19).

Preuve que ce n'est pas anodin : `styles.css:1265` documente un cas où
l'absence d'un `padding:2px` a cassé un composant (`.sift-seg-opt` touchant les
bords), retour utilisateur du 2026-07-09 — donc certaines valeurs "hors
échelle" encaissent un besoin visuel réel, pas juste une négligence. Un sweep
qui snappe aveuglément casserait potentiellement des cas similaires non
documentés.

## Objectif

Réduire la dérive de token SANS régression visuelle silencieuse, en traitant
ce sweep comme son propre chantier isolé (jamais mélangé à un autre fix).

## Portée

- **Fichier concerné** : `frontend/styles.css` uniquement (les `.ts` avec
  styles inline seront traités au cas par cas s'ils réutilisent une classe
  déjà migrée).
- **Hors scope** : ne pas toucher `.interaction-model.md`/comportement, ne
  pas changer la hiérarchie visuelle voulue (`system.md:80-82`), ne pas
  élargir l'échelle sans preuve qu'un rôle réel la justifie.

## Stratégie envisagée (à trancher en phase plan, pas ici)

1. **Option A — snap strict 4/8/12/16** partout, quitte à absorber un delta
   visuel de 1-3px sur certains composants. Risque : régressions comme celle
   documentée ligne 1265 si le delta casse un alignement fin.
2. **Option B — documenter un micro-tier officiel** (`--space-2`, `--space-6`
   par exemple) pour les valeurs qui reviennent ≥3x dans le fichier avec un
   rôle cohérent (badges/pills denses, lignes compactes) — étend l'échelle au
   lieu de forcer un snap, moins de risque visuel, mais relâche la règle
   stricte "toute autre valeur interdite".
3. **Option C — mixte** : snap les valeurs isolées (1 seule occurrence, pas de
   rôle répété) vers 4/8/12/16 ; documenter en micro-tier les valeurs
   répétées avec un rôle cohérent.

Recommandation : Option C — elle respecte l'esprit de la règle (éliminer le
bruit isolé) sans nier les patterns réels déjà établis (éviter de refaire
l'erreur de la ligne 1265).

## Preuve de non-régression exigée

Avant de déclarer le chantier fini : captures Playwright/CDP avant/après sur
les écrans qui concentrent le plus de sites touchés (Bibliothèque/batch-panel,
Revue, Réglages — voir `design-system-states.md` § audits référence canonique
07-08/09 pour la liste des 8 écrans déjà catalogués). Un site modifié sans
capture avant/après ne compte pas comme vérifié.
