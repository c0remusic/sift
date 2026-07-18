# Pointeur visuel d'annotation — design

**Date** : 2026-07-05
**Statut** : validé en brainstorm avec Antoine, prêt pour writing-plans

## Problème

Quand Antoine repère un problème visuel dans la vraie app (`tauri dev`), le
décrire avec des mots est lent et imprécis, et Claude ne trouve pas toujours
le bon endroit du code du premier coup — frustration principale identifiée.
Les captures d'écran sont un mauvais canal (Claude interprète mal les pixels ;
principe déjà acté : `screenshot-not-a-value-source` en mémoire).

Les problèmes signalés couvrent : apparence statique (couleur/taille/
espacement), cohérence entre éléments et entre écrans, parcours UX, et écarts
avec la maquette `Sift.dc.html`. La référence de comparaison est tantôt la
maquette, tantôt le jugement d'Antoine (pas de référence formelle).

## Ce que c'est (et n'est pas)

Un **canal de pointage fiable**, en direct pendant les sessions : Antoine
pointe un élément dans l'app en marche + note libre, Claude reçoit la
localisation exacte + les valeurs réelles calculées, et fait lui-même le
changement dans le code.

**Pas** : un éditeur visuel (Antoine n'édite rien lui-même), un carnet de bugs
différé (usage en direct), un outil de capture d'image, un serveur/daemon.

## Geste utilisateur

1. App en `tauri dev`, session Claude en cours.
2. **Alt+Clic** sur l'élément gênant → **cadre coloré** (highlight) autour de
   l'élément visé, sans dialogue de confirmation.
3. Raccourci pour **élargir la sélection au bloc parent** si le clic a visé
   trop précis (ex. remonter du titre à la carte entière).
4. Champ texte libre pour la remarque, aussi vague que souhaité.
5. « Envoyer » → l'annotation est écrite dans le fichier d'échange. Antoine
   dit « regarde » dans le chat (ou Claude surveille s'il a été prévenu).

## Ce qui est capturé par annotation

- **La note**, telle quelle.
- **Identité de l'élément** : tag, id, classes, extrait de texte visible.
- **Localisation code** : résultats de la recherche source (même mécanique que
  `locate_source` existant, `src-tauri/src/dev_locate.rs`) — tous les
  candidats, sans forcer de choix ; Claude tranche lui-même avec le contexte.
- **Valeurs calculées réelles** (`getComputedStyle`) de l'élément : couleurs,
  dimensions, espacements (margin/padding), typo (famille/taille/graisse),
  bordures, radius — les propriétés pertinentes pour un problème visuel, pas
  les ~350 propriétés brutes.
- **Contexte** : écran actif (route/vue courante), chaîne d'ancêtres avec
  leurs classes, et valeurs calculées des voisins directs (siblings) — parce
  qu'« incohérent » ne se juge qu'en comparant.

Pour les remarques de cohérence inter-écrans ou d'écart maquette, Claude fait
la comparaison lui-même (contre l'autre écran du vrai code, ou contre
`Sift.dc.html`) en partant des données capturées.

## Architecture

Extension du couple existant `frontend/dev-inspector.ts` +
`src-tauri/src/dev_locate.rs` — pas un nouvel outil.

- **Frontend (`dev-inspector.ts` étendu ou module frère dev-only)** :
  - Overlay de highlight (cadre) posé sur l'élément sélectionné ; navigation
    parent via raccourci (ex. flèche haut ou bouton « bloc parent »).
  - Panneau : note libre + bouton Envoyer. Pas de champs techniques.
  - Collecte : identité, `getComputedStyle` filtré (élément + siblings +
    chaîne d'ancêtres), écran actif.
  - Appel IPC pour la localisation code (réutilise `locate_source`) puis un
    second appel pour persister l'annotation complète.
- **Backend (`dev_locate.rs` ou module frère `dev_annotate.rs`)** :
  - Commande `save_annotation(annotation: Annotation) -> Result<(), String>`,
    gated `cfg!(debug_assertions)` comme `locate_source`.
  - Append dans le fichier d'échange. Aucune écriture dans les sources.
- **Fichier d'échange** : `docs/annotations.jsonl` (une annotation JSON par
  ligne — trivial à appender côté Rust, trivial à lire/tronquer côté Claude ;
  horodaté). Gitignoré ou non : **non gitignoré**, c'est un canal de travail
  temporaire mais le voir dans `git status` rappelle qu'il reste des notes
  non traitées ; Claude retire les entrées traitées au fur et à mesure.

## Boucle de traitement (côté Claude)

1. Antoine dit « regarde » (ou équivalent).
2. Claude lit `docs/annotations.jsonl`, traite chaque entrée : localise
   (candidats fournis + jugement), compare si la note évoque cohérence/
   maquette, propose ou applique le fix selon le flux de session normal.
3. Entrée traitée → retirée du fichier dans le même geste.

## Hors scope v1

- Problèmes de comportement animé (hover qui saute, transitions) : la note
  texte décrit la séquence ; le pointage donne l'élément de départ.
- Capture d'écran/image : exclue par principe.
- Édition dans le panneau : exclue — Claude édite, pas Antoine.
- Tout mécanisme de veille automatique (watcher/cron sur le fichier) :
  déclenchement conversationnel uniquement.

## Erreurs

- Élément sans classe/id : capturer quand même (position dans l'arbre +
  texte + styles calculés) ; la localisation code peut revenir vide, Claude
  se débrouille avec le reste.
- Échec d'écriture du fichier : erreur affichée dans le panneau (fail-fast,
  pas de retry silencieux).
- Release build : commandes refusées (`debug_assertions`), inspecteur jamais
  installé (`import.meta.env.DEV`, pattern existant conservé).

## Tests

- Rust : `save_annotation` refuse hors debug ; append correct (2 appels → 2
  lignes JSON valides) ; unicode/multiligne dans la note.
- TS : `npx tsc --noEmit` ; filtrage `getComputedStyle` retourne les
  propriétés attendues sur un élément de test.
- Vérification réelle : Antoine teste le geste complet dans `tauri dev`
  (highlight, parent, envoi), Claude lit le fichier produit et confirme que
  la localisation + les valeurs suffisent à agir sans question.
