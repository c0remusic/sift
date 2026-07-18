# Audit UI contre références canoniques — design

> Décisions actées en grill-me le 2026-07-08 (conversation, pas de brainstorm
> séparé — le sujet est sorti du spike stack, voir
> `docs/ressources-externes.md` Évaluation 19).

## Problème

Les composants UI de Sift ont été construits en grande partie "de mémoire
d'entraînement" sans référence vérifiée (root cause documentée en
Évaluation 19 : scrollbar sans source, segmented control réimplémenté 4
fois, `.lk` mal réutilisée). Depuis le 2026-07-08, un pool de références
canoniques est installé (MCP `shadcn`, MCP `ui-thing`, skills
`coss`/`coss-particles`, Apple HIG via WebFetch) et une règle CLAUDE.md
impose de les consulter avant d'inventer. Ce chantier applique cette règle
**rétroactivement** : chaque composant existant est comparé à sa référence.

## Décisions (grill-me)

1. **Scope** : audit complet des composants catalogués dans
   `docs/design-system-states.md`, y compris ceux déjà validés récemment
   (palette Apple, grammaire de carte Boxes, segmented control).
2. **Arbitrage** : la référence l'emporte par défaut, mais chaque
   divergence est montrée à Antoine en comparaison avant/après avec sa
   source **avant** application — pas de correction silencieuse. Les
   macro-décisions déjà sourcées HIG (couleur système, matériaux,
   élévation) ne sont rouvertes que sur divergence argumentée, pas par
   défaut shadcn.
3. **Découpage** : par écran → éléments (pas une liste de composants à
   plat). Les primitives partagées (scrollbar, nav, titlebar, toasts,
   confirm modal) sont auditées avec le premier écran qui les exerce.
4. **Ordre** : Accueil → Revue → Écartés → Journal → Bibliothèque →
   Réglages → Rekordbox → Clé USB. (Dévie volontairement de l'ordre du
   spec HIG `2026-07-07-hig-adaptation-design-spec.md` — choix d'Antoine.)
5. **Cadence** : au fil de l'eau — un écran audité + corrigé + validé
   (Antoine dans `tauri dev`) avant de passer au suivant. Chaque écran est
   livrable indépendamment.

## Méthode par écran (identique pour chaque tâche)

1. Inventorier les éléments réellement rendus sur l'écran (code + entrée
   `design-system-states.md`).
2. Pour chaque élément, identifier le composant de référence équivalent et
   le consulter via l'outil dédié (MCP shadcn en premier, ui-thing/coss en
   complément, HIG pour le macro). Si aucun équivalent n'existe (waveform,
   spectrogramme), le noter "sans référence externe, design propriétaire
   assumé" — pas d'invention.
3. Produire un tableau de divergences : élément · état · valeur actuelle
   (fichier:ligne) · valeur/comportement de référence (source citée) ·
   verdict proposé (conserver/corriger).
4. Présenter le tableau à Antoine, appliquer uniquement les corrections
   approuvées.
5. Vérifier : `npx tsc --noEmit` clean, Antoine valide visuellement dans
   `tauri dev` (CDP ponctuel si besoin de mesure).
6. Mettre à jour `docs/design-system-states.md` (chaque entrée touchée
   gagne sa ligne "référence : <source>") et committer.

## Hors scope

- Nouveaux composants (l'audit compare l'existant, il n'ajoute pas de
  features UI).
- Refonte des macro-décisions HIG déjà actées sans divergence argumentée.
- `app.js`/`Sift.dc.html` (maquettes figées, pas des livrables).
