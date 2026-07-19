# Sweep échelle d'espacement — plan (à exécuter, PAS encore fait)

Chantier isolé, jamais mélangé à un autre fix. Chaque étape produit une preuve
avant de passer à la suivante.

## Étape 1 — Enumérer exhaustivement (lecture seule)
- Grep `padding:|margin|gap:|width:[0-9]|height:[0-9]` sur `frontend/styles.css`.
- Classer chaque site : valeur isolée (1 occurrence, pas de rôle répété) vs
  valeur répétée avec rôle cohérent (≥3 occurrences, même type de composant).
- Sortie : tableau `fichier:ligne | valeur | classe/sélecteur | isolé ou répété`.

## Étape 2 — Trancher le micro-tier (option C du design.md)
- Pour les valeurs répétées avec rôle cohérent (candidats déjà vus : 2px/6px/
  7px/9px sur badges/pills denses) : décider avec Antoine si elles deviennent
  `--space-2`/`--space-6` officiels dans `system.md` + `styles.css`, ou si
  elles restent hors échelle mais commentées comme exception assumée.
- Ne pas décider seul — c'est un choix de design system, pas un fix mécanique.

## Étape 3 — Snap les valeurs isolées
- Les sites à occurrence unique sans rôle répété : snap vers la valeur 4/8/12/16
  la plus proche, un site à la fois.
- Après chaque groupe de sites liés (ex. tous les composants d'un même écran) :
  screenshot avant/après (Playwright/CDP, voir moyen de preuve du projet).

## Étape 4 — Vérifier les cas à risque connu
- Revérifier spécifiquement `.sift-seg-opt`/`.sift-seg-thumbed` (cf.
  `styles.css:1265`, régression déjà vécue une fois sur un padding similaire)
  après tout snap qui les touche.
- Repasser les 8 écrans du catalogue `design-system-states.md` (§ audits
  référence canonique 07-08/09) en revue visuelle rapide.

## Étape 5 — Documenter
- Mettre à jour `system.md` § Espacement avec le micro-tier tranché (ou noter
  explicitement qu'aucun n'a été ajouté et pourquoi).
- Ajouter une entrée dans `design-system-states.md` (Sommaire + section) :
  sweep fait, date, décision prise sur le micro-tier.
- Fermer ce dossier de chantier (déplacer vers `changes/archive/` via wrap-up).

## Definition of done
- Zéro valeur isolée hors échelle restante dans `styles.css` (les valeurs du
  micro-tier officialisé ne comptent pas comme "hors échelle").
- Captures avant/après archivées pour chaque écran touché.
- `system.md` et `design-system-states.md` à jour.
- Aucune régression visuelle confirmée sur les cas à risque connu (étape 4).
