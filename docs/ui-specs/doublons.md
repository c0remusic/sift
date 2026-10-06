# Spec — Doublons

> **Validée par Antoine le 2026-10-05** : direction hybride et six décisions, puis la maquette
> hybride et ses réponses : ordre des groupes, confirmation destructive, copie gardée comparée à
> la meilleure des autres (tranché sur wireframe), débit départageant les seules copies lossy.
> `rail.md`, `revue.md` et `bibliotheque.md` portent leurs amendements du même jour.

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

## Layout

### Rail

Entrée « Doublons » sous Revue, glyphe Tabler `ti-copy` en `--color-text-info`. **Pas de compte**
dans le rail : la barre l'écrit déjà (règle de `rail.md`, un compte à un seul endroit). Les
raccourcis `Ctrl+2` à `Ctrl+8` se décalent d'un cran (ordre du rail, `shortcuts.ts::railViews`).

### Zone A — barre unifiée

Titre « Doublons » · compte « N groupes » (`#sift-tb-count`, ce que la table montre) ·
menu **Groupes ▾** (pop-up à choix exclusif, coché : Tous · Identiques · Même son · Même nom ·
À vérifier · Avec Rekordbox, chacun avec son compte) · recherche · à droite des filtres, le
bouton d'application **« Envoyer N copies à la corbeille »** en *push button* secondaire danger
(`.sift-secondary-trash`, le précédent de « Vider la corbeille »). **Jamais le bleu primaire** :
HIG Buttons, « Don't assign the primary role to a button that performs a destructive action ».
Grisé tant que le plan ne retire rien.

### Zone C — table

Au sol, aucune carte (`patterns.md`). En-tête figé `.sift-lib-thead`, rangées `.lr` de 32 px
(`--row-h`), virtualisées (`createVirtualList`, une seule hauteur : les en-têtes de groupe font
aussi 32 px). Fonds alternés **par index continu**, ni filet entre groupes ni bouton par rangée
(`components.md`, rangée de table).

**Ordre — tranché le 2026-10-05** : les groupes par **artiste de A à Z**, puis titre, puis
version, sur la clé normalisée (accents repliés, casse ignorée) ; un nom sale sans artiste
lisible se range sur son radical nettoyé. C'est l'ordre de la maquette et celui où l'on cherche un
morceau ; le menu Groupes filtre déjà par preuve. Dans un groupe, la copie cochée par défaut en
premier, puis l'ordre de la règle.

**Rangée d'en-tête de groupe** : « Artiste — Titre (Version) » en 600 ; dans la colonne Preuve,
la preuve du groupe (Identiques · Même son · Même nom) ; puis en tertiaire la nature (« 3 copies ·
autre qualité ») et, calé à droite, l'effet du plan (« 2 copies à la corbeille · 125,4 Mo »). Un
groupe À vérifier le dit en encre d'avertissement (« À vérifier · hors du plan »).

**Rangée de copie** (maquette hybride du 2026-10-05) :

| # | Colonne | Rendu |
|---|---|---|
| 1 | **Garder** | case à cocher native, gabarit de `.qi-ck` ; la meilleure cochée par défaut, d'autres cochables ; désactivée sur une copie introuvable, et sur une tronquée quand une autre copie présente est entière |
| 2 | Fichier | nom complet, **tronqué au milieu pour garder la version et l'extension** (« Aldo Ostrova - … (Original Mix).flac ») ; « tronquée » ou « introuvable » en encre d'avertissement |
| 3 | Preuve | vide sur une copie : la preuve est celle du groupe, sur sa rangée d'en-tête ; la relation entre deux copies se lit en zone D |
| 4 | Verdict | pastille 6 px `currentColor` + mot, colonne de 96 px (`styles.css:1863`) ; **teinté seulement s'il diffère dans le groupe**, neutre sinon (un état permanent reste neutre, `tokens.md`) |
| 5 | Format | extension |
| 6 | Débit | kbps |
| 7 | Durée | `--font-mono`, seule colonne en mono |
| 8 | Dossier | pastille de la source + chemin court |
| 9 | Rekordbox | glyphe + « 3 playlists » si la copie y est jouée, sinon vide |

Fréquence, Taille et pochette ne vivent qu'en zone D : avec l'inspecteur ouvert, la zone C fait
920 px à 1440 de large, et dix colonnes n'y tiennent pas. Tous les en-têtes de colonne sont en
texte, Garder et Rekordbox compris (HIG Outline views).

**Encre de différence** : dans un groupe, la valeur qui diffère d'une copie à l'autre est en
encre primaire, la valeur identique en tertiaire. Une paire .aif / .aiff se lit d'un coup d'œil :
seuls Format et Dossier restent allumés.

### Zone D — inspecteur

- **Au repos** : le résumé — groupes, copies en trop, Go récupérables **en vidant la corbeille**,
  répartition par preuve, et la règle de la copie cochée, écrite.
- **Une copie ouverte** (clic sur sa rangée) : pochette, nom, lecteur (le lecteur de la fiche,
  `player-audition.ts`), puis **cette copie contre la copie gardée**, faits alignés en deux
  colonnes (verdict, coupure, format, débit, fréquence, durée, taille, dossier, identification,
  Rekordbox), la phrase de la règle (« la règle garde la copie MP3 : VRAI passe avant FAUX »),
  et le spectrogramme à la demande.
- **La copie ouverte est la gardée** — tranché sur wireframe le 2026-10-05 : elle se compare à
  **la meilleure des autres copies** selon la règle, et l'en-tête le dit (« Comparée à : FLAC ·
  Ostgut rips », puis en tertiaire « meilleure des 2 autres »). La zone D garde ainsi la même forme
  en deux colonnes quelle que soit la copie ouverte. Écartées : la fiche seule (les autres copies
  perdaient coupure et taille, la zone changeait de forme) et la copie ouverte juste avant
  (l'historique, invisible, décidait ; au premier clic du groupe, rien à comparer).
- **« Comparer les spectrogrammes »** ouvre la vue agrandie (`spectro-enlarge.ts`) avec les
  spectrogrammes du groupe **empilés**, un par copie, à la même échelle de temps — jusqu'à 8 copies.

## États

| État | Rendu |
|---|---|
| Calcul des groupes | squelette de table (`.sift-skel-line`), compte vide ; la barre reste utilisable |
| Groupes | la table, le plan coché par défaut |
| Plan modifié | les en-têtes de groupe recalculent leur effet ; le bouton recompte « Envoyer N copies » |
| Rekordbox décoché | pas de rangée en plus (toutes font 32 px, la liste est virtualisée) : le repère Rekordbox de la rangée passe en encre d'avertissement, et l'effet du groupe dit « Rekordbox la joue (3 playlists) » ; Sift n'écrit rien dans Rekordbox |
| Confirmation | modale armée sur le patron de `confirmBatchAlert` : titre « Envoyer N copies à la corbeille ? », récapitulatif « N copies · X Go · G groupes », ligne tertiaire « Les K groupes à vérifier restent hors du plan. Un seul Ctrl+Z annule tout. », case cochée « Garder aussi les N copies que Rekordbox joue » ; si des copies envoyées n'ont pas pu être vérifiées dans Rekordbox, une ligne en encre d'avertissement le dit sous le récapitulatif, avec la raison (§ Interactions, « Copie non vérifiée ») ; Annuler a le focus ; bouton d'action désactivé 250 ms (armement), en **secondaire danger, pas le bleu** — **variante destructive** de `confirmBatchAlert`, tranchée le 2026-10-05 (HIG Buttons : « Don't assign the primary role to a button that performs a destructive action ») ; le mode Lot garde sa variante bleue |
| Application | feuille non modale `.sift-batch-sheet` attachée en haut de la zone C : barre déterminée, « Copie 215 sur 421 · fichier courant », **Arrêter** (l'arrêt tombe entre deux copies : rien n'est défait), « Afficher les détails » ; le bouton de la barre attend, grisé |
| Fini | la feuille se ferme sur le toast « N copies dans la corbeille · Annuler » ; les groupes réglés quittent la table ; restent les À vérifier et ceux où plusieurs copies sont gardées ; une seule entrée au Journal pour toute l'application |
| Échec partiel | la feuille devient le rapport : les copies qui ont résisté et pourquoi ; le reste est appliqué et annulable |
| Aucun doublon | l'état vide réel (`.sift-empty-state`, `emptyStateHtml`), **en haut à gauche** de la zone C : « Aucun doublon à trier », une phrase (les groupes « Ce ne sont pas des doublons » ne reviennent pas ; Go récupérables en vidant la corbeille), sortie « Ouvrir Revue » ; la zone D se ferme, le bouton d'application quitte la barre |
| Erreur de lecture | jamais lue comme « aucun doublon » : le message brut et « Réessayer », sans carte (`bibliotheque.md` § États) |
| Copie introuvable | le fichier a disparu du disque : marquée « introuvable », case désactivée, jamais envoyée ; la règle coche la suivante |

## Interactions

**Souris.** Clic sur une rangée : l'ouvre en zone D (la sélection se voit dans la table). Clic sur
la case : modifie le plan, n'exécute rien. Double-clic : écouter.

**Clic droit sur une copie.** Il l'ouvre d'abord (comme dans Rangés), puis le menu : Garder
seulement celle-ci · Garder aussi · Préférer ce dossier · Écouter · Ouvrir l'emplacement ·
*séparateur* · Ce ne sont pas des doublons (sur le groupe : il quitte la table et ne revient plus).
Rien n'y exécute, tout touche le plan, sauf Écouter et Ouvrir l'emplacement. Une entrée sans effet
(« Garder aussi » sur une copie déjà gardée) est désactivée, jamais retirée (`context-menu.ts`).

**« Préférer ce dossier »** recoche, dans tous les groupes à égalité qui touchent ce dossier, la
copie de ce dossier ; un bandeau neutre le dit (« Préféré : MUSIQUE A TRIER › Jay Tripwire —
26 groupes recochés · Annuler »).

**Clavier** (légende en pied, comme Revue) :

| Touche | Action |
|---|---|
| `↑` `↓` | copie précédente / suivante |
| `Espace` | écouter / pause |
| `Entrée` | garder seulement cette copie (plan) |
| `⌫` | ne pas garder cette copie (plan) |
| `Ctrl+Entrée` | appliquer : ouvre la confirmation |
| `Ctrl+Z` | annuler la dernière application, en entier |

Ni Entrée ni ⌫ n'exécutent quoi que ce soit : ils ne changent que le plan. Seuls le bouton de la
barre et `Ctrl+Entrée`, confirmés, envoient des copies à la corbeille.

**Geste de masse.** L'application couvre les groupes dont la preuve l'autorise (table plus haut),
plus les groupes À vérifier que l'utilisateur a tranchés (case modifiée, ou Entrée). Les autres
restent dans la table.

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
