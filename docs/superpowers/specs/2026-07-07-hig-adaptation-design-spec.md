# Sift — Design Spec HIG adaptée desktop

> Date : 2026-07-07
> Statut : spec active
> Sources : Apple HIG (lecture du 2026-07-06), `2026-07-06-apple-hig-review-notes.md`,
> `docs/design-system-states.md`, `frontend/styles.css`

## But

Adapter à Sift ce qui fait sens dans Apple Human Interface Guidelines pour une
app desktop dense, orientée travail, sans singer iOS ni macOS.

Cette spec sert de contrat de design pour les prochains fixes UI. Elle définit
ce qu'on emprunte à Apple, ce qu'on refuse, et comment on l'applique écran par
écran dans l'app réelle.

## Cadre

Sift n'est pas :
- une app mobile
- une app tactile
- une app Apple native
- une vitrine marketing

Sift est :
- un outil desktop dense
- une app mono-fenêtre
- un produit de tri, écoute, vérification, identification et rangement
- une interface qui doit rester rapide à scanner et fiable à manipuler

## Ce qu'on emprunte à Apple

- clarté
- déférence de l'interface par rapport au contenu
- profondeur légère
- discipline typographique
- discipline iconographique
- feedback bref et causal
- structuration claire des actions, réglages et recherches

## Ce qu'on n'emprunte pas

- patterns iPhone/iPad
- safe areas et conventions notch/home indicator
- police SF Pro en production
- SF Symbols comme dépendance de prod
- effets matériaux Apple-only
- vocabulaire de navigation mobile

## Principes directeurs

### 1. Clarté

Le morceau, son statut, et l'action possible doivent se comprendre avant la
surface qui les contient.

Implications :
- hiérarchie de texte simple
- peu de tailles concurrentes
- labels explicites
- icônes nettes, jamais ambiguës

### 2. Déférence

L'UI ne doit pas voler l'attention à l'audio, aux métadonnées ou aux décisions.

Implications :
- chromes calmes
- actions secondaires discrètes
- moins de bruit visuel permanent

### 3. Profondeur légère

La profondeur sert à expliquer la structure, pas à faire joli.

Implications :
- cartes quand une section doit être lue comme bloc distinct
- fond continu quand plusieurs morceaux appartiennent à une même conversation
- ombres subtiles, jamais démonstratives

### 4. Cohésion

Un même rôle doit raconter la même chose sur tous les écrans.

Implications :
- une seule grammaire de bouton secondaire
- une seule grammaire de disclosure
- une seule grammaire d'empty state
- une seule grammaire de badges

## Typographie

### Intent

La typo doit être calme, lisible, stable, et au service du scan.

### Règles

- Le titre d'écran ancre la vue, il ne surjoue pas.
- Le hero de Revue est une exception, pas un modèle générique.
- Le poids compte avant la taille pour hiérarchiser localement.
- Le texte meta reste lisible, jamais spectral.
- Le mono est réservé aux chemins, durées, compteurs, valeurs techniques.

### Decision Sift

- Revue reste la référence pour la hiérarchie typographique.
- `--text-2xl` reste réservé aux rôles hero (nom principal du hero player,
  icône de repli associée) — jamais un titre d'écran générique.
- Les écrans d'édition et de réglages n'utilisent pas de titres hero-scale.
- Les lignes de liste restent compactes et stables.

## Couleur

### Intent

La couleur sert le sens et l'action, pas le style de fond.

### Règles

- Le neutre porte la majorité de l'interface.
- Les couleurs sémantiques ont un rôle précis.
- Une action confirmée retourne à un état final neutre.
- La couleur vive sert l'impulsion ou la transition, pas la mémoire d'état.

### Decision Sift

- success, warning, danger, info restent des rôles
- les contrôles secondaires ne prennent pas une teinte sémantique par confort
- les badges sémantiques restent compacts et explicites
- les confirmations colorées restent brèves

### Hors scope : teintes catégorielles

Les teintes de genre, de source surveillée et d'intégration (rollout Apple
system colors, 2026-07-06) forment un système distinct des 4 rôles
sémantiques ci-dessus. Cette règle ne les concerne pas : ne pas neutraliser
un chip de genre ou un point de source au prétexte de "réduire la couleur au
sens seul" en appliquant cette section.

## Surfaces

### Intent

La surface raconte l'organisation du travail.

### Règles

- carte pleine si une section doit se lire comme bloc autonome
- fond continu si les sous-sections appartiennent à la même tâche
- bordure légère pour délimitation calme, jamais comme accent
- ombre subtile seulement pour les surfaces qui doivent se détacher

### Decision Sift

- Revue définit le meilleur équilibre actuel entre cartes et fond continu
- Bibliothèque et Réglages doivent converger vers cette logique
- Écartés peut garder des cartes de section, car ses groupes sont distincts
- Accueil doit rester plus calme qu'un écran de travail détaillé

## Contrôles

### Familles

Trois familles maximum :
- primaire
- secondaire
- destructif

### Règles

- le primaire est rare et évident
- le secondaire s'intègre à la surface, ne crie pas
- le destructif est net sans dramatisation excessive
- l'icon-only est réservé aux actions immédiatement reconnaissables

### Decision Sift

- `Ranger` garde le rôle primaire
- `Écarter`, `Supprimer`, `Purger` gardent la famille destructive
- `Voir la release`, `Ré-identifier`, `Copie` et actions de support doivent
  converger vers la famille secondaire

## Icônes

### Intent

Les icônes doivent accélérer la lecture, jamais remplacer un sens absent.

### Règles

- aucune icône décorative seule
- rôle stable par icône
- tailles et poids visuels harmonisés
- pas d'icône qui laisse imaginer une autre action que l'action réelle

### Decision Sift

- conserver Tabler
- harmoniser les tailles par famille d'usage
- réserver l'icon-only aux actions déjà conventionnelles dans l'app

## Feedback et mouvement

### Intent

Le feedback doit confirmer, guider, et disparaître.

### Règles

- chaque animation doit expliquer un changement
- priorité à `transform` et `opacity`
- succès bref, état final neutre
- focus clavier visible mais discret
- pas d'accumulation de feedbacks concurrents si un seul suffit

### Decision Sift

- conserver les flashs de confirmation brefs déjà justes
- éviter les états sémantiques permanents
- garder une distinction claire entre toast, bandeau inline et retour d'action

## Layout

### Intent

Le layout doit être dense mais respirer. On optimise le scan, pas la mise en
scène.

### Règles

- groupes logiques avec rythme vertical stable
- alignements de bords prioritaires
- colonnes et rails cohérents d'un écran à l'autre
- une liste dense ne doit pas devenir un mur uniforme

### Decision Sift

- Revue sert de référence d'alignement latéral
- les surfaces sœurs ne doivent pas dériver de quelques pixels selon l'écran
- les espaces bas de panneau doivent être intentionnels, pas résiduels

## Recherche

### Intent

La recherche locale doit filtrer la vue courante de façon immédiate.

### Règles

- pas de recherche cachée derrière un pattern mobile
- placeholder explicite sur sa portée
- filtre en direct préféré à une soumission en deux temps

### Decision Sift

- tout futur champ de recherche de file ou de liste doit être explicitement local
- pas de langage trompeur type "Rechercher partout" si ce n'est pas le cas

## Réglages

### Intent

Les réglages ne doivent accueillir que les options globales et peu fréquentes.

### Decision Sift

- Discogs token, racine bibliothèque, apparence sont bien placés
- tout futur réglage par lot ou par piste doit vivre dans le flux de travail,
  pas dans l'écran Réglages

## Undo / réversibilité

### Intent

L'utilisateur doit sentir qu'il peut corriger une erreur sans panique.

### Règles

- toute action sensible doit avoir un chemin de retour lisible
- les messages de retour gagnent à nommer l'action, pas seulement l'idée d'undo

### Decision Sift

- le journal et les reverts restent des primitives fortes du produit
- si un multi-niveau de undo apparaît un jour, il devra nommer précisément ce
  qu'on annule

## Accessibility

### Règles

- le sens ne doit jamais dépendre de la couleur seule
- le focus clavier doit rester exploitable
- les actions doivent rester nommées clairement
- les textes utiles ne doivent pas glisser sous le seuil de lisibilité
- les zones cliquables ne doivent pas être mesquines

## Directives par écran

### Revue

Écran maître. Rien ne doit y régresser.

Conserver :
- hero d'écoute
- disclosures compacts
- rail d'action lisible
- états de confirmation brefs

### Bibliothèque

Priorité haute.

Objectifs :
- calmer l'éditeur
- mieux relier report, édition et verdict
- aligner les actions secondaires sur la grammaire Revue

### Réglages

Priorité haute.

Objectifs :
- clarifier la famille des cartes
- rendre les contrôles plus systématiques
- réduire l'effet patchwork

### Écartés

Priorité moyenne.

Objectifs :
- garder les sections clairement séparées
- simplifier les meta-actions
- rendre les lignes plus cohérentes avec les autres écrans

### Accueil

Priorité moyenne.

Objectifs :
- calmer l'inspecteur
- mieux hiérarchiser source, statut et actions
- rester plus sobre qu'un écran de travail détaillé

### Rekordbox

Priorité haute. Page récente (2026-07-05, section réparations master.db
ajoutée 2026-07-07) jamais passée au crible de cohérence.

Objectifs :
- faire converger la carte de statut et la section réparations vers la
  grammaire de carte déjà fixée pour Bibliothèque/Réglages
- aligner les boutons d'action (Réexporter, Changer de XML lié, Choisir
  cette piste, Ignorer) sur les 3 familles de contrôles
- garder la bannière drift_detected et la section réparations visuellement
  distinctes (elles restent 2 signaux séparés, cf. design-system-states.md)

### Journal

Priorité moyenne.

Objectifs :
- aligner les lignes de journal sur la grammaire de ligne de liste (queue,
  bibliothèque) plutôt que sur une variante isolée
- garder les toasts/reverts lisibles sans surcharger la ligne

### Clé USB

Priorité basse. Écran encore minimal (une action, pas de vrai layout de
travail) — à revisiter surtout si un layout plus riche y est construit.

Objectifs :
- ne pas construire de nouvelle grammaire de bouton/carte hors de celles
  déjà fixées par les écrans prioritaires

## Do / Don't

### Do

- privilégier la lisibilité avant la signature
- faire converger les primitives avant les écrans
- utiliser la couleur pour le sens
- garder les confirmations courtes et claires
- réutiliser ce qui est déjà juste dans Revue

### Don't

- singer Apple
- utiliser du mobile pour résoudre du desktop
- multiplier les familles de boutons
- laisser des composants proches raconter des choses différentes
- garder un état confirmé allumé durablement sans raison

## Ordre d'application

1. `styles.css` — primitives
2. composants partagés
3. Bibliothèque
4. Réglages
5. Rekordbox
6. Écartés
7. Accueil
8. Journal
9. Clé USB

## Mode sombre

Chaque règle de cette spec s'applique dans les deux thèmes. Une grammaire
qui converge en clair mais casse en sombre (contraste, token manquant dans
le bloc sombre de `styles.css`) n'est pas considérée terminée. Vérifier les
deux avant de cocher un écran.

## Vérification par écran

Avant de déclarer un écran conforme à cette spec, vérifier concrètement,
pas par impression :

- chaque grammaire touchée (bouton secondaire, disclosure, empty state,
  badge) est câblée sur les mêmes sélecteurs/classes que sa référence dans
  Revue ou `design-system-states.md` — pas une variante locale proche mais
  différente
- clair ET sombre vérifiés (voir section Mode sombre)
- `npx tsc --noEmit` clean après le changement
- code gated `inTauri` vérifié dans la vraie fenêtre `tauri dev` (Antoine,
  ou CDP ponctuel — jamais le mock `app.js` via preview navigateur seul,
  voir CLAUDE.md section Vérification UI)
- `design-system-states.md` mis à jour dans le même geste si une grammaire
  change ou se crée

## Critère de validation

Un portage HIG desktop-adapté est valide si :
- la lecture de l'écran est plus immédiate
- les actions importantes ressortent sans bruit
- les actions secondaires ne parasitent pas
- la structure reste compréhensible sans couleur forte
- l'écran se rapproche de Revue sans devenir "Apple-themed"
