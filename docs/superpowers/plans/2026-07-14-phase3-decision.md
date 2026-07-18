# Phase 3 — décision (après lecture des mesures)

> Rapport de mesures : `docs/superpowers/plans/2026-07-14-phase3-measurement-report.md`.
> Voir aussi le bug crash trouvé et corrigé séparément (commit `50239e3`).

## Lecture des chiffres

**À 15 000 lignes (le volume V1 réellement ciblé — "Backlog ~15 000
fichiers", `docs/plan-implementation.md`)** : `list_filed` max 27.8 ms,
`list_pending` max 20.6 ms. Aucun problème — largement sous le seuil de
perception humaine pour une action d'ouverture d'écran (~100 ms).

**À 100 000 lignes (volume de stress, pas la cible V1)** : `list_filed`
sans filtre 165 ms médiane, avec recherche texte 176 ms médiane.
`EXPLAIN QUERY PLAN` identifie la cause dominante : `USE TEMP B-TREE FOR
ORDER BY` — le tri `ORDER BY m.artist, m.title` n'a **aucun index
support**, donc SQLite matérialise et trie en mémoire à chaque appel. Le
filtre `status='filed'` lui-même est déjà indexé (`SEARCH ... USING INDEX`)
et n'est pas le goulot.

## Tentative d'index — essayée, mesurée, invalidée

Un index composite `metadata(artist, title)` a été ajouté (migration v15),
mesuré, puis **retiré** — il n'a rien changé : `EXPLAIN QUERY PLAN` montre
toujours `USE TEMP B-TREE FOR ORDER BY` après l'ajout, et la latence à
100k lignes a même empiré (165 ms → 242 ms médiane, probablement du bruit
de mesure, mais en tout cas aucune amélioration).

**Pourquoi ça ne marche pas** : le planner SQLite pilote la requête depuis
`tracks` (via `idx_tracks_status_verdict`, sur le filtre `status='filed'`
très sélectif), PUIS fait le `LEFT JOIN` vers `metadata` — c'est le bon
choix du planner (filtrer d'abord un petit sous-ensemble plutôt que
scanner toute la table `metadata` triée). Mais piloté depuis `tracks`, les
lignes ne sortent pas dans l'ordre de l'index `metadata(artist, title)` :
aucun index simple ne peut donc éliminer le tri tant que la requête filtre
sur une colonne de `tracks` et trie sur des colonnes de `metadata` — c'est
un tri après jointure, pas un tri sur table simple.

## Décision : ni index ciblé, ni pagination — différé, documenté

Le vrai fix demanderait soit une dénormalisation (dupliquer `artist`/
`title` sur `tracks` pour permettre un index mono-table couvrant filtre ET
tri), soit une vraie pagination par curseur — les deux sont des
changements de schéma/architecture plus lourds que ce que les chiffres
justifient au volume V1 réel.

**15 000 lignes (cible V1 réelle)** : déjà fluide (max 27.8 ms), aucune
action nécessaire.

**100 000 lignes (volume de stress)** : 165-250 ms médiane selon la
requête — perceptible mais pas cassé. Pas d'action maintenant, faute de
preuve qu'un utilisateur réel atteint ce volume en usage courant.

**Condition de réouverture** (nommée, pas un renvoi vague) : si un
utilisateur réel rapporte une bibliothèque `filed` dépassant ~30-50k
pistes avec une lenteur perçue à l'écran Bibliothèque, reconsidérer avec
la dénormalisation `artist`/`title` sur `tracks` comme option prioritaire
(plus simple qu'une pagination complète, résout le tri à la racine).

## Critère d'acceptation (spec, section 6)

- 15 000 morceaux restent fluides : ✅ déjà vrai, confirmé par mesure.
- Les choix pour 100 000 reposent sur des benchmarks : ✅ ce document,
  y compris la mesure d'un fix tenté ET invalidé — pas juste des chiffres
  de départ.
- Aucun changement d'architecture futuriste sans preuve : ✅ pagination ET
  dénormalisation différées, toutes deux sans preuve d'un besoin réel au
  volume V1 ; la tentative d'index a été retirée après mesure plutôt que
  gardée sans bénéfice démontré.
