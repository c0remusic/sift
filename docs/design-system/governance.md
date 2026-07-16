# Sift Design System - Governance

## Regle Centrale

Le design system de Sift est un systeme operationnel, pas une bibliotheque
parallele. Toute decision durable doit etre verifiee contre l'app reelle.

Sources obligatoires :

1. `frontend/styles.css` pour les tokens ;
2. `docs/design-system-states.md` pour les composants et etats ;
3. `docs/skills-registre.md` pour le routage skills/agents ;
4. `AGENTS.md` pour les contraintes projet ;
5. `PRODUCT.md` pour la direction produit.

## Routage Skills Et Agents

Avant toute tache substantielle, consulter `docs/skills-registre.md`. Le choix
du skill/agent fait partie du design system parce qu'il determine la qualite de
la decision.

Routage courant :

- toute tache UI/UX/design/theme/parcours utilisateur sur Sift :
  `sift-ui-design-governance` en premier, comme garde-fou projet ;
- retouche/polish d'un ecran existant : `impeccable` en priorite ;
- audit post-implementation : `design-review` ;
- nouveau chantier UI significatif : `design-flow` ;
- a11y/WCAG ponctuel : `ui-ux-pro-max` ;
- refactor/legacy : `working-with-legacy-code`, `refactoring-patterns`,
  `clean-code` ;
- Rust/backend : `rust-best-practices`, `error-handling-patterns` ;
  pointu/review → session + `.claude/rules/rust.md` + agent `auditor` ;
- audit dette : `tech-debt-audit`.

Ne pas invoquer sur Sift :

- `design-taste-frontend` ;
- `redesign-existing-projects` ;
- `gpt-taste` ;
- `top-design`.

Si une skill est indisponible dans la session, noter l'indisponibilite et
continuer avec le fallback humain/documentaire, sans inventer une nouvelle
source de verite.

## Quand Modifier Quel Fichier

| Changement | Fichier a modifier |
|---|---|
| Nouvelle valeur de couleur/spacing/typo | `frontend/styles.css` |
| Nouvel etat visuel reel | `docs/design-system-states.md` |
| Nouveau role de composant | `docs/design-system/components.md` |
| Nouveau pattern de parcours | `docs/design-system/patterns.md` |
| Nouveau libelle canonique | `docs/design-system/content.md` |
| Nouvelle regle de process | `docs/design-system/governance.md` |
| Nouveau doc sous `docs/` | `docs/INDEX.json` |

## Interdits

- creer un theme parallele hors `frontend/styles.css` ;
- traiter une maquette HTML comme source de verite ;
- ajouter une carte pour regler un probleme de hierarchie ;
- dupliquer un warning dans deux zones ;
- utiliser une couleur semantique pour une categorie neutre ;
- verifier une UI Tauri avec une simple preview navigateur si le code vit dans
  le bloc `inTauri`.

## Verification UI

Pour une modification UI reelle :

1. lire le code qui rend le composant ;
2. modifier les fichiers de production ;
3. lancer `npx tsc --noEmit` si TypeScript touche ;
4. verifier dans `tauri dev` quand le changement depend de Tauri/WebView2 ;
5. demander un screenshot utilisateur si la verification automatique serait trop
   couteuse ;
6. mettre a jour la doc canonique concernee.

Pour une modification docs-only :

1. verifier que les docs ne contredisent pas `AGENTS.md` ;
2. verifier que `docs/INDEX.json` reste valide ;
3. ne pas lancer de build inutile.

## Definition De Fini

Un changement de design system est fini quand :

- la source de verite reelle est modifiee ou referencee ;
- la doc correspond au comportement reel ;
- le routage skill/agent reste explicite ;
- `docs/INDEX.json` reference tout nouveau document ;
- les limites de verification sont dites clairement.
