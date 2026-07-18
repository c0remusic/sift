# Sift Design System - Patterns

## Parcours Revue

Le parcours Revue est une chaine de decision :

1. ecouter et reconnaitre le morceau ;
2. verifier le diagnostic audio ;
3. verifier les metadonnees ;
4. choisir destination et format ;
5. ranger ou jeter.

La page doit donc privilegier l'ordre de decision, pas l'ordre technique des
modules internes.

## Surface Continue

Pattern prefere : les contenus reposent sur le fond de l'application, avec des
groupes formes par l'espacement, les titres et les etats.

Utiliser une carte seulement pour :

- une surface flottante ;
- un popover ;
- un modal ;
- une liste d'items repetes ;
- un outil qui a besoin d'un cadre fonctionnel.

Eviter :

- cartes dans cartes ;
- sections pleine page encadrees sans raison ;
- separateurs entre lignes quand le spacing suffit ;
- ombres pour compenser une hierarchie floue.

## Sections Collapsables

Diagnostic audio et Metadonnees peuvent etre collapsables, mais la page doit
rester comprehensible quand une section est fermee.

Regles :

- le titre de section annonce le role, pas l'action ;
- l'indicateur d'ouverture doit etre iconographique et discret ;
- ne pas ajouter de texte "afficher/masquer" permanent ;
- l'etat ferme doit garder un resume utile si la decision en depend.

## Title Bar Et Panneaux

La title bar doit suivre la structure de la fenetre :

- zone gauche alignee sur le rail ;
- zone centrale alignee sur le fond principal ;
- bordure verticale du rail continue ;
- pas de ligne noire parasite ;
- pas de decalage entre title bar, rail et panneau File.

Si le panneau File est flottant, il ne doit pas etre force a toucher la title
bar. Son espacement haut doit deduire la hauteur de title bar pour que le rythme
visuel reste identique en haut et en bas.

## Destination D'abord

La destination est une decision structurante. Elle doit rester visible dans
l'espace A finaliser, meme si l'utilisateur a deja choisi le format.

Pattern :

1. titre court "Destination" ;
2. controle de destination ;
3. format ;
4. nom final calcule ;
5. actions.

Ne pas cacher la destination dans une barre secondaire ou un controle trop
petit : sans destination, "Convertir" n'a pas de sens.

## Nom Final Apres Format

Le nom final depend du format choisi. Il doit donc venir apres le choix MP3/AIFF/WAV.

Regles :

- taille moderee ;
- police mono acceptable ;
- alignement avec les actions de fin ;
- pas de grand bloc dedie si le nom tient sur une ligne ;
- montrer le changement immediatement quand le format change.

## Warnings

Un warning doit apparaitre au plus proche de la decision qu'il affecte.

Exemples :

- probleme ID3 : Metadonnees ;
- destination manquante : A finaliser ;
- fichier audio suspect : Diagnostic audio ;
- action destructive : confirmation in-app dediee.

Ne pas repeter le meme warning dans plusieurs zones. La repetition augmente le
bruit et fait perdre le signal.

## Densite Lisible

Sift peut etre dense, mais chaque niveau doit avoir son propre rythme :

- ecran : grands blocs ;
- section : respiration verticale claire ;
- groupe : spacing moyen ;
- ligne : spacing compact ;
- valeur technique : densite maximale.

Quand un bloc parait casse, auditer dans cet ordre :

1. est-ce le bon ordre de decision ?
2. le titre indique-t-il le bon role ?
3. le spacing correspond-il au niveau ?
4. une carte ou une bordure parasite cree-t-elle du bruit ?
5. la couleur signale-t-elle un vrai etat ?

