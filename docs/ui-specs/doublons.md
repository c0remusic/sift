# Spec — Doublons

> **Validée par Antoine le 2026-10-05** : direction hybride et six décisions, puis la maquette
> hybride et ses réponses : ordre des groupes, confirmation destructive, copie gardée comparée à
> la meilleure des autres (tranché sur wireframe), débit départageant les seules copies lossy.
> `rail.md`, `revue.md` et `bibliotheque.md` portent leurs amendements du même jour.
>
> **Refonte du 2026-10-30** : l'écran passe à l'option B (file de tri, un groupe à la fois, mode
> Lot, rangée « Issue »), § Layout. Groupes, preuve, règle et corbeille inchangés.

## Contexte dans le shell

Une **destination du rail**, section TRAITER, juste sous Revue : **Doublons**. Demande d'Antoine
avant la 0.1.4 : « un endroit propre où voir tous les doublons, les comparer et les trier »,
« choisir lequel garder », « comparer avant de choisir ».

Pourquoi un écran, et pas la section de Rangés d'aujourd'hui : sur la vraie bibliothèque (copie
lue le 2026-10-04), 300 des 304 groupes sont des pistes **de la file**, que Rangés ne montre pas ;
l'écran actuel en voit 4. Le badge DUPLICATE de Revue marque déjà 686 pistes sans mener nulle part.

Patron macOS : Photos range ses doublons dans un **album utilitaire de la barre latérale**
(Utilitaires › Doublons). HIG Sidebars : « top-level collections of content ». Direction
**hybride**, choisie par Antoine le 2026-10-05 sur trois maquettes critiquées
(artefact « Trier les doublons ») :

- **le lieu et la table de A** : une table de tous les groupes, l'inspecteur compare ;
- **la décision de C** : une case « Garder » par copie, un plan, puis une seule application ;
- **les niveaux de preuve de B** : ce qui fonde chaque groupe se dit.

Écart assumé envers Photos : Photos choisit seul la copie gardée et fusionne. Ici le choix reste
à l'utilisateur, parce qu'un DJ peut vouloir deux formats d'un même morceau (un AIFF pour
Rekordbox, un MP3 pour la clé).

## Ce qui forme un groupe

**Le nom prime** (Antoine, 2026-10-05). Clé = artiste + titre + **version** entre parenthèses,
normalisés (`naming::name_key`). La version reste dans la clé : par le nom seul, 36 groupes
réels mêlaient des remixes différents.

**Noms sales, nettoyés avant la clé** (1 354 noms sur 3 403 ne passent pas `parse_filename`) :
numéro de piste en tête (`01 `, `01. `, `1-`), suffixe de copie (`-1`, ` (1)`, `_1`),
crochets et accolades (`[…]`, `{…}`), jetons de débit et de format (`320`, `kbps`, `flac`…).
La version entre parenthèses est extraite même d'un nom sale (`naming.rs::extract_version_hint`). Chaque règle de
nettoyage se fige en vecteurs dans le corpus réel (`search_corpus.rs`), et se mesure sur la
bibliothèque avant d'être livrée : un nettoyage qui fusionnerait deux morceaux distincts est pire
que le doublon qu'il trouve.

**Fichiers identiques à l'octet**, groupés quel que soit leur nom : même taille, puis même
empreinte de contenu (hachage, calculé seulement entre fichiers de même taille). Mesuré : la clé
de nom en ratait au moins 50 groupes.

**La durée ne scinde jamais un groupe.**
- Une copie que l'analyse marque **tronquée** reste dans son groupe, marquée « tronquée », et
  n'est jamais cochée par défaut — **sauf quand toutes les copies présentes du groupe le sont**.
  La troncature ne départage alors rien : la règle coche la meilleure comme ailleurs, la marque
  reste affichée, les durées des tronquées servent à décider d'À vérifier. Tranché le 2026-10-06 :
  sur la vraie bibliothèque, 16 groupes sur 672 sortaient tout décochés, cases désactivées, hors
  du plan — aucun geste possible.
- Un écart de durée de plus de 2 s **sans** troncature détectée rend le groupe **À vérifier** :
  deux versions possibles sous le même nom.

**Preuve**, une par groupe, la plus forte trouvée :

| Preuve | Fondement | Geste de masse |
|---|---|---|
| **Identiques** | même contenu à l'octet | oui |
| **Même son** | empreintes concordantes (≥ 0,6, `fingerprint::MATCH_THRESHOLD`) | oui |
| **Même nom** | clé de nom seule, durées à 0,1 s près, ou seule différence une copie tronquée | oui |
| **À vérifier** | même nom, durées écartées de plus de 2 s sans troncature | non : à trancher à la main |

## Layout — file de tri (option B), décidée le 2026-10-30

> **Refonte demandée par Antoine le 2026-10-30** : « la file de tri n'est pas très claire, je
> voudrais revenir à l'option B, avec l'option de pouvoir batch. Il n'est pas clair non plus de
> savoir si on GARDE ou SUPPRIME une release quand on la sélectionne. » L'option B est celle de
> l'artefact « Trier les doublons » du 2026-10-05 (planches `B-file-de-tri-fenetre` et
> `B-file-de-tri-etats`). Trois décisions du même jour l'adaptent :
> 1. **une copie gardée par défaut, plusieurs possibles** (D4 tenue) ;
> 2. **colonnes jusqu'à 3 copies, défilement horizontal au-delà**, l'étiquette des rangées fixe ;
> 3. livrée sur sa propre branche après la PR #83.
>
> Ce qui ne change pas : la formation des groupes, la preuve, la copie recommandée (`pick_keep` v2,
> § Ce que l'écran demande au backend), la corbeille par disque, la garde des copies Rekordbox.
> La table de l'hybride (zone C) et l'inspecteur (zone D) décrits jusqu'ici sont **remplacés** ;
> l'historique reste dans `git log -- docs/ui-specs/doublons.md`.

Patron : la grammaire de **Revue** appliquée aux groupes — une file à gauche, UN groupe ouvert au
centre, le clavier de Revue pour choisir et passer au suivant (motif « Merge N Items » de Photos
pour le lot).

### Rail

Inchangé : entrée « Doublons » sous Revue, `ti-copy`, pas de compte.

### Zone A — barre unifiée

Titre « Doublons » · compte « N groupes » (ce que la file montre, filtre compris ; en mode Lot :
« N sélectionnés », comme Revue) · recherche. Plus de bouton d'application dans la barre : chaque
groupe se résout dans sa boîte, le lot se résout dans son résumé.

### Colonne de file (`#qcol`, gabarit de Revue)

- **Tête** : menu **Tous ▾** (Tous · Identiques · Même son · Même nom · À vérifier · Avec
  Rekordbox, chacun avec son compte) à gauche, **Sélectionner** / **Terminé** à droite.
- **Ligne de groupe**, 46 px comme `.qi` : « Artiste — Titre (Version) » en 500, une pastille de
  verdict par copie collée au titre (même rendu que `verdictDot`) ; en dessous, en tertiaire,
  « N copies · preuve · formats » (« 3 copies · même son · FLAC, MP3 »). Un groupe À vérifier le
  dit en encre d'avertissement (« durées différentes »). Un groupe Rekordbox porte son glyphe au
  bord droit.
- **Ordre** : artiste de A à Z, puis titre, puis version (tranché le 2026-10-05, inchangé).
- **Mode Lot** : case 16 px par ligne, toute la ligne coche, Maj+clic coche une plage, Échap ou
  Terminé sortent — la mécanique de Revue (`queue-selection.ts`), réutilisée telle quelle.

### Zone C — le groupe ouvert

Une boîte, comme celle de Revue (V2b) :

1. **En-tête** : pochette, « Titre » en titre, « Artiste · N copies » dessous, puis en tertiaire
   « Différent par : verdict, format, taille, emplacement… » (les rangées qui diffèrent). À droite :
   la preuve du groupe (« Même son · empreinte 0,98 »).
2. **Lecteur** : celui de la fiche, sur la copie sous le curseur (« Copie 2 »). Passer d'une copie
   à l'autre en lecture garde la position (écoute A/B).
3. **Grille de comparaison** : une colonne d'étiquettes fixe à gauche, puis **une colonne par
   copie**, numérotée 1…N. **Au-delà de 3 copies**, les colonnes gardent leur largeur et la grille
   défile horizontalement ; l'étiquette reste fixe (décision 2). Rangées, dans l'ordre :
   - tête de colonne : n° de copie, source › dossier, nom de fichier, état (« En file » /
     « Rangée »), et **« Recommandée — raison »** sur la copie de la règle (« VRAIE, dans
     Rekordbox ») ;
   - Verdict (pastille + mot, teinté seulement s'il diffère dans le groupe) · Coupure · Format
     (format · débit · fréquence) · Durée (mono) · Taille · Date du fichier · Identification ·
     Rekordbox (« 2 playlists ») ;
   - Spectres, repliables, alignés ;
   - **Issue** — voir ci-dessous.
   L'encre de différence de l'hybride est gardée : ce qui diffère d'une copie à l'autre en
   primaire, l'identique en tertiaire. La colonne sous le curseur porte le fond de sélection.
4. **Pied** : la phrase de conséquence, puis la légende clavier et les deux boutons.

**Issue — ce qui répond à « on GARDE ou on SUPPRIME ? »** (demande du 2026-10-30). Dernière rangée
de la grille, une cellule par copie, qui dit EN TOUTES LETTRES ce que deviendra la copie si l'on
valide :
- **« Gardée »**, glyphe `ti-check`, encre primaire, poids 600 ;
- **« Corbeille »**, glyphe `ti-trash`, encre d'avertissement ;
- **« Introuvable »** (fichier disparu, jamais envoyé) et **« Tronquée »** (désactivée tant qu'une
  autre copie présente est entière), en tertiaire.
Cliquer une cellule Issue bascule la copie entre Gardée et Corbeille (décision 1) ; la règle
remplit l'Issue à l'ouverture du groupe (une seule copie Gardée). Une copie gardée en plus se lit
donc dans la grille avant toute action, jamais après.

**Phrase de conséquence**, juste au-dessus de la légende, en secondaire : « Entrée : garder la
copie 2 — les copies 1 et 3 partent à la Corbeille (53,8 Mo). Annulable. » ; avec deux gardées :
« Entrée : garder les copies 1 et 3 — la copie 2 part à la Corbeille (14,9 Mo). » ; si une copie
qui part est dans Rekordbox, une seconde ligne en encre d'avertissement le dit (« La copie 2 est
dans Rekordbox (2 playlists) : ces entrées perdront leur fichier. Sift n'écrit rien dans
Rekordbox. »).

**Boutons du pied**, à droite : « Pas des doublons » (secondaire) · **« Garder la copie N »** /
« Garder les copies 1 et 3 » (primaire, répond à Entrée). Le primaire GARDE : il n'est pas
destructif au sens de HIG Buttons, et la corbeille de Sift se restaure (Ctrl+Z, Restaurer) — c'est
l'argument de la planche B, repris.

### Zone C en mode Lot — le résumé

Rien n'est ouvert : la zone C montre le résumé de la sélection (gabarit `.sift-bsel` de Revue) :
« N groupes sélectionnés », puis en rangées chiffrées : copies qui vont à la Corbeille (et Go),
groupes à égalité tranchés par la règle, copies Rekordbox gardées d'office, groupes **exclus** (À
vérifier, et même nom sans durée concordante — pas de geste de masse sur une ressemblance). Un
bouton **« Résoudre N groupes… »** ouvre la confirmation.

### Zone D

Fermée sur cet écran : la comparaison vit dans la grille.

## États

| État | Rendu |
|---|---|
| Calcul des groupes | squelette de file (`.sift-skel-line`), compte vide |
| Groupe ouvert | la boîte, curseur sur la copie recommandée, Issue remplie par la règle |
| Issue modifiée | la phrase de conséquence et le libellé du bouton suivent à la frappe |
| Groupe À vérifier | aucune copie n'est Corbeille par défaut (toutes Gardées) ; la phrase dit « Durées écartées de 1 min 56 — deux versions ? » ; Entrée = « Pas des doublons » |
| Résolu | le groupe quitte la file, le suivant s'ouvre (règle de `queue-next.ts` : le suivant dans la liste affichée) ; toast « Groupe résolu — N copies à la Corbeille · Annuler » |
| Lot : confirmation | modale armée (`confirmBatchAlert`) : « Résoudre N groupes ? », « X copies vont à la Corbeille (Y Go). Dans les égalités, la règle garde … Un seul Ctrl+Z annule tout le lot. », case « Garder aussi les N copies que Rekordbox joue » |
| Lot : application | feuille non modale `.sift-batch-sheet`, barre déterminée, Arrêter ; un seul lot de journal |
| Aucun doublon | état vide réel, en haut à gauche de la zone C, sortie « Ouvrir Revue » |
| Erreur de lecture | le message brut et « Réessayer », jamais « aucun doublon » |

## Interactions

**Souris.** Clic sur une ligne de file : ouvre le groupe. Clic sur une colonne de copie : y pose
le curseur (et le lecteur). Clic sur une cellule Issue : bascule Gardée / Corbeille. Clic droit sur
une colonne : Garder seulement celle-ci · Garder aussi · Préférer ce dossier · Écouter · Ouvrir
l'emplacement · *séparateur* · Ce ne sont pas des doublons.

**Clavier** — celui de Revue (planche B, « Clavier — couche 3 ») :

| Touche | Action |
|---|---|
| `Espace` | écouter / pause la copie sous le curseur |
| `←` `→` | copie précédente / suivante ; en lecture, bascule à la même position (A/B) |
| `1` … `9` | aller à la copie N |
| `G` | basculer la copie sous le curseur entre Gardée et Corbeille |
| `Entrée` | **appliquer l'Issue du groupe** (le bouton primaire), groupe suivant |
| `⌫` ou `X` | envoyer la copie sous le curseur à la Corbeille tout de suite ; le groupe reste ouvert s'il lui reste plusieurs copies |
| `N` | pas des doublons : garder toutes les copies, ne plus proposer ce groupe |
| `↑` `↓` | groupe précédent / suivant, sans rien décider |
| `Ctrl+Z` | annuler la dernière résolution (un groupe, ou un lot entier) |
| `Ctrl+A` / `Ctrl+Maj+A` | mode Lot : tout / aucun |

**Ce qui change du modèle « plan puis une application »** (D5 de l'hybride) : un groupe se résout
maintenant à l'unité, tout de suite, annulable — c'est le rythme de B, celui de Revue. Le plan
survit à l'intérieur du groupe (la rangée Issue, modifiable avant Entrée) et dans le lot (le
résumé, puis une seule application confirmée). Chaque résolution est un lot de journal.

**Rekordbox.** Une copie que Rekordbox joue reste cochée par défaut. La confirmation la garde
aussi (case cochée). Sift n'écrit rien dans Rekordbox à cette étape.

**Copie non vérifiée — tranché par Antoine le 2026-10-05 : avertir, ne pas garder d'office.**
Quand la source lue peut taire une piste que Rekordbox joue — Rekordbox ouvert (`master.db-wal` non
vide : ses derniers imports ne sont pas lus), ou `master.db` illisible et seul le XML d'export lu —,
une copie absente de cette source n'est pas « absente » mais **non vérifiée** (`RekordboxUse`
`unverified`, avec la raison). Elle n'est pas gardée d'office : la garder aurait vidé le plan à
chaque ouverture de Rekordbox. La confirmation le dit, sous le récapitulatif, en encre
d'avertissement : « Rekordbox est ouvert : ses derniers imports ne sont pas lus. N copies envoyées
n'ont pas pu être vérifiées — ferme Rekordbox et rouvre Doublons pour les vérifier. » (ou, XML seul :
« Rekordbox n'est lu que dans son XML exporté : une piste importée depuis n'y figure pas. »).
L'inspecteur écrit « non vérifiée » dans la ligne Rekordbox de la comparaison.

## Ce que l'écran demande au backend

- **Groupes de toute la bibliothèque** (file + Rangés), formés comme plus haut, avec pour chaque
  copie : verdict, coupure, format, débit, fréquence, durée, taille, dossier, source, troncature,
  identification, présence Rekordbox, existence du fichier sur le disque. Calculés hors du fil de
  la fenêtre.
- **Copie cochée par défaut** (`pick_keep` v2) : entière avant tronquée (une tronquée n'est cochée
  que si toutes les copies présentes le sont), puis VRAI avant À VÉRIFIER avant
  FAUX, puis lossless avant lossy, puis le débit **entre copies lossy seulement**, puis la
  fréquence ; à égalité : dossier préféré, puis .aiff plutôt que .aif, puis la plus ancienne. Plus
  jamais l'ordre de lecture SQL. Le débit ne départage pas deux lossless (tranché le 2026-10-05,
  défaut révélé par le wireframe) : celui d'un FLAC mesure sa compression, pas sa qualité, et la
  règle aurait toujours jeté un FLAC au profit d'un WAV du même son.
- **Appliquer un plan** : une seule commande pour N copies, un seul lot de journal, hors du fil de
  la fenêtre, avec progression et arrêt. Chaque copie part dans une **corbeille sur son propre
  disque** (renommage instantané) : `Documents/Sift/Trash` si elle est sur le même disque, sinon
  `.sift-trash` à la racine de son disque. Copie de secours si le renommage échoue (disque en
  lecture seule, partage réseau). « Restaurer » et `Ctrl+Z` relisent le chemin de chaque action.
- **« Ce ne sont pas des doublons »** mémorisé (une table, une migration) : le groupe ne revient
  plus.
- **Empreinte** calculée au taux réel du fichier, décimée au-delà de 48 kHz, empreintes fausses
  effacées par la migration v26 — **livré le 2026-10-05** (`0f16304`).

**Décision actée avec cette spec, le 2026-10-05** (`CLAUDE.md` § Backend : « étendre à une
troisième commande reste une décision ») : la liste des groupes et l'application d'un plan sont deux
commandes de plus dont le corps part hors du fil de la fenêtre
(`tauri::async_runtime::spawn_blocking`), chacune gardée par son test de source. Sans ça, lire
3 400 pistes et déplacer N fichiers gèleraient l'interface, exactement ce qu'`analyze_path` et
`identify` faisaient avant d'y passer.

## Hors périmètre de la 0.1.4

- Comparer au son en tâche de fond toute la bibliothèque (environ 600 décodages, coût à mesurer).
- Reporter playlists et repères Rekordbox vers la copie gardée (écriture sur un système vivant).
- La vue agrandie à plus de 8 copies.

## Questions ouvertes

Les six décisions de direction ont été tranchées par Antoine le 2026-10-05. La maquette hybride
du même jour en a soulevé quatre, tranchées le même jour sauf la dernière : l'ordre des groupes
(artiste de A à Z, § Zone C), la confirmation destructive (variante destructive, § États), la copie
gardée ouverte (comparée à la meilleure des autres, § Zone D). Reste :

- **Le mot « doublon »** : l'écran Rekordbox écrit déjà « N doublons à retirer »
  (`i18n/rekordbox-view.ts:44`) pour des entrées de playlist en double. Deux sens du même mot,
  à départager hors du lot 1.

Conséquence de la décision 1, pas une question : la nouvelle entrée du rail décale d'un cran les
raccourcis `Ctrl+2` à `Ctrl+8` (`shortcuts.ts:128`, ordre du rail). `Ctrl+2` ouvrira Doublons,
Journal passe à `Ctrl+3`. Le manuel et la légende des raccourcis suivent dans le même geste.

Défaut de l'app trouvé par la maquette, hors de cet écran : `report-view.ts:232` employait
`ti-music-note`, que Tabler 3.46.0 n'a pas (`package-lock.json:2161`) ; la pochette sans image
restait vide. **Corrigé le 2026-10-05** : `ti-music`, la note de Tabler, et
`test/tabler-glyphs.test.ts` confronte désormais chaque glyphe posé à la police installée.
