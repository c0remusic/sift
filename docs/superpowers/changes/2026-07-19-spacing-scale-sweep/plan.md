# Sweep échelle d'espacement — plan

Chantier isolé, jamais mélangé à un autre fix. Chaque étape produit une preuve
avant de passer à la suivante.

## Statut (2026-07-24)

- **Étape 1 (énumération)** ✅ — 306 déclarations scannées, 232 hors échelle
  (162 répété/13 valeurs + 70 hors périmètre width/height + quelques isolés).
- **Étape 2 (micro-tier)** ✅ — Antoine tranche : snap strict partout
  (4/8/12/16/24/32), `.sift-seg`/`.sift-seg-opt` exclus.
- **Étape 3 (snap)** ✅ — 176 sites snappés (commit `b1c8374`), tokens
  `--space-24`/`--space-32` créés. lint-tokens px-spacing 120→69.
  **Point à vérifier** : `.sift-play-btn`/`.sift-player-audition`
  (`styles.css:769-781`, écran Revue lecteur) — le centrage pixel-exact
  documenté en commentaire (`(68-46)/2=11px`) a glissé de 1px par le snap
  (11→12) ; le `gap` a été recalculé en cascade (25→24) pour rester
  cohérent, mais le centrage lui-même reste décalé d'1px. Cosmétique
  mineur, mais zone explicitement annotée "aligne les deux par leur
  centre" — vaut un coup d'œil dans `tauri dev` avant de considérer le
  chantier clos.
- **Étape 4 (revérif cas à risque + repasse 8 écrans)** ⏳ différée —
  reprendre ici : vérifier visuellement le point ci-dessus + repasser les
  8 écrans catalogués (`design-system-states.md` § audits référence
  canonique 07-08/09).
- **Étape 5 (documenter + archiver)** ⏳ différée — après l'étape 4 :
  mettre à jour `system.md` § Espacement + `design-system-states.md`
  (nouvelle entrée sweep), puis archiver ce dossier vers `changes/archive/`.

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
