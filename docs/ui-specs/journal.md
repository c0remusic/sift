# Spec — Journal

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Console** — une table
d'événements horodatés, groupés, avec un détail à droite.

Trois zones : rail · table des actions (flexe) · inspecteur (`--pane-w`, repliable).

Le Journal est le filet de sécurité de tout le reste : c'est lui qui rend le rangement
annulable, et c'est cette réversibilité qui autorise Revue à agir vite.

## Layout

### Zone A — barre unifiée

Titre « Journal » · contrôle segmenté **Session / Tout l'historique** · recherche à
droite (filtre sur nom de fichier et destination).

La bascule Session/Tout remplace le bouton « Voir tout l'historique » rendu en pied de
liste : c'est un mode de vue, sa place est la barre.

### Zone C — table des actions

Groupée par **session**, en-têtes de groupe repliables en petites capitales discrètes.
En mode « Tout l'historique », un second niveau de groupe par jour.

| Colonne | Largeur | Rendu |
|---|---|---|
| **Heure** | fixe | `--font-mono`, `tabular-nums` |
| **Action** | fixe | Rangé · Écarté · Restauré · Purgé · Tags appliqués |
| **Piste** | flex 2 | Artiste — titre, repli sur le nom de fichier |
| **Destination** | flex 1.5 | Chemin relatif, `--font-mono`, tronqué par la gauche |
| **État** | fixe | Appliqué · Annulé · Échec |

Hauteur `--row-h`, comme partout. Aucun zébrage.

L'action **Annuler** ne vit pas dans la ligne : elle est dans le menu contextuel et dans
l'inspecteur. Une colonne de boutons sur un historique long coûte de la largeur en
permanence pour un usage rare.

### Zone D — inspecteur

- **Aucune sélection** — résumé de la session : nombre d'actions, rangés, écartés,
  échecs, plage horaire.
- **Une entrée** — horodatage complet, action, piste, chemin source, chemin final,
  format produit, et le bouton **Annuler cette action** s'il est encore applicable.
- **Plusieurs entrées** — compte par type d'action et **Annuler la sélection**, avec le
  nombre exact d'actions concernées dans le libellé.

## États

| État | Rendu |
|---|---|
| **Session vide** | `emptyStateHtml` — « Rien dans cette session », note, retour vers Revue |
| **Historique vide** | Même composant, note différente |
| **Chargement** | Squelette de lignes dans la structure finale |
| **Erreur de lecture** | Carte douce, encre `danger`, bouton Réessayer. **Rien n'est affirmé du contenu** : « rien dans cette session » ne doit jamais s'afficher quand la lecture a échoué |
| **Annulation en cours** | Ligne en attente, action désarmée, le reste de la table utilisable |
| **Annulée** | État « Annulé », ton neutre et **permanent**. Seule la transition se colore, brièvement |
| **Annulation échouée** | Ligne en encre `danger`, motif dans l'inspecteur, réessai possible |

## Interactions

### Souris

- **Clic** : sélectionne, remplit l'inspecteur · **⇧+clic** plage · **⌘/Ctrl+clic** ajout.
- **Double-clic** : ouvre l'emplacement du fichier final.
- **Clic droit** : Annuler cette action · Ouvrir l'emplacement · Copier le chemin ·
  Voir la piste dans Bibliothèque.
- **Clic** sur un en-tête de groupe : replie ou déplie la session.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9. `⌘/Ctrl+Z` annule la **dernière** action, où qu'on
soit dans l'app — c'est le raccourci global, pas un raccourci de cet écran.

`Entrée` sur une ligne sélectionnée ouvre l'emplacement. **`⌫` ne fait rien ici** :
supprimer une entrée d'historique n'a pas de sens, et la touche est destructive
ailleurs — lui donner un comportement ici serait un piège.

### Retour

Annulation de masse : confirmation in-app **armée et horodatée** au-delà du seuil,
avec le nombre exact dans le libellé. La transition d'état d'une ligne annulée dure
`--duration-base`. Aucune animation sur l'arrivée de nouvelles entrées.

## Hors périmètre / questions ouvertes

- **Rétention.** Combien de temps l'historique est-il gardé ? La vue Session lit 50
  entrées ; « Tout l'historique » n'a pas de borne spécifiée. À trancher avant que la
  table ne devienne une source de lenteur.
- **Annulation partielle d'un lot.** Un lot de 200 pistes dont 3 échouent : l'annulation
  porte-t-elle sur les 197 réussies, ou est-elle refusée en bloc ? Comportement actuel
  non vérifié dans cette spec.
- **Portée de `⌘Z`.** Il annule la dernière action de la session. Doit-il traverser un
  redémarrage de l'app ? Non tranché.
