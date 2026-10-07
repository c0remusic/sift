# Journal des versions

Ce fichier est la **source** des notes de version : `release.yml` extrait la section du tag
publié et la passe à `releaseBody`. Ce texte part à deux endroits — la page GitHub de la
release, et le champ `notes` de `latest.json`, que chaque installation existante télécharge en
vérifiant les mises à jour. Il s'écrit donc pour un utilisateur, pas pour un développeur : les
détails techniques vivent dans les messages de commit.

Une section manquante fait **échouer** le build de release plutôt que publier des notes vides.
Le titre de section doit être exactement `## vX.Y.Z` pour que l'extraction le trouve.

**Toute version après la 0.1.3 est bilingue** (issue #75) : l'interface existe aussi en anglais,
et la bannière de mise à jour montre les notes dans la langue de l'app. La section porte
`### Français` puis `### English`, chacun suivi de ses rubriques en `####`. Une moitié manquante
ou vide fait échouer la release, comme une section absente.

## v0.1.6

### Français

#### À lire avant la mise à jour

- Depuis la 0.1.4, cette version s'installe seule. Une installation 0.1.3 doit encore l'installer
  à la main : la clé qui signe les mises à jour a changé avec la 0.1.4.

#### Clé USB

- **Formater en exFAT, ou en FAT32 une clé de 32 Go ou moins, fonctionne enfin.** Depuis les
  premières versions, ces formatages échouaient avant même l'invite de Windows, avec un message
  qui affirmait à tort que l'autorisation avait été refusée. Le nom de volume choisi est
  maintenant appliqué aussi en exFAT.
- **Formater une clé vierge prend quelques secondes au lieu d'une quarantaine.** Sift ne passe
  plus par l'outil de partitionnement de Windows, qui mettait à lui seul près de 30 s à démarrer.
  Mesuré sur un SSD de 500 Go : 39,6 s avant, 5,6 s après.
- La fenêtre de formatage est plus calme : les avertissements passent dans des bulles ⓘ, et les
  boutons Annuler et Formater… ont la même taille.

### English

#### Read before updating

- From 0.1.4 on, this version installs itself. A 0.1.3 installation still has to install it by
  hand: the key that signs updates changed with 0.1.4.

#### USB drive

- **Formatting as exFAT, or a FAT32 drive of 32 GB or less, finally works.** Since the earliest
  versions, these formats failed before the Windows prompt even appeared, with a message wrongly
  saying the permission had been declined. The volume name you choose is now applied in exFAT
  too.
- **Formatting a blank drive takes a few seconds instead of about forty.** Sift no longer goes
  through Windows' partitioning tool, which alone took nearly 30 s to start. Measured on a 500 GB
  SSD: 39.6 s before, 5.6 s after.
- The format window is calmer: the warnings move into ⓘ bubbles, and the Cancel and Format…
  buttons are the same size.

## v0.1.5

### Français

#### À lire avant la mise à jour

- Depuis la 0.1.4, cette version s'installe seule. Une installation 0.1.3 doit encore l'installer
  à la main : la clé qui signe les mises à jour a changé avec la 0.1.4.

#### Doublons

- **Un groupe dont toutes les copies sont tronquées garde de nouveau sa meilleure copie.** Avant,
  toutes ses cases étaient décochées et grisées : l'écran semblait proposer d'envoyer toutes les
  copies à la corbeille, et aucun geste ne permettait de régler le groupe. Dans ce cas, la
  troncature ne départage plus rien : la meilleure copie est cochée selon la règle habituelle, la
  marque « tronquée » reste affichée, et le groupe entre dans le plan si les durées concordent.

### English

#### Read before updating

- From 0.1.4 on, this version installs itself. A 0.1.3 installation still has to install it by
  hand: the key that signs updates changed with 0.1.4.

#### Duplicates

- **A group whose copies are all truncated keeps its best copy again.** Before, all its boxes were
  unchecked and greyed out: the screen seemed to offer to move every copy to the Trash, and nothing
  could settle the group. In that case truncation no longer decides anything: the best copy is
  checked by the usual rule, the "truncated" mark stays visible, and the group joins the plan if
  the lengths match.

## v0.1.4

### Français

#### À lire avant la mise à jour

- **Cette version s'installe à la main.** La clé qui signe les mises à jour a changé : une
  installation 0.1.3 ne peut pas vérifier la 0.1.4 et refuse la mise à jour automatique.
  Téléchargez l'installeur (tableau plus bas) et installez par-dessus : bibliothèque et réglages
  sont gardés. Les versions suivantes se mettront de nouveau à jour seules.

#### Doublons, un nouvel écran

- **Tous les doublons au même endroit.** Une entrée du rail, sous Revue, réunit les copies d'un
  même morceau dans toute la bibliothèque, file d'attente et Rangés compris. Chaque groupe dit ce
  qui le fonde : fichiers **identiques** à l'octet, **même son** (empreinte acoustique), ou **même
  nom** — noms sales compris : numéro de piste, adresse de site, « (1) », « 320kbps ».
  « (Original Mix) » vaut absence de version ; une autre version reste un autre morceau.
- **Comparer avant de choisir.** Une case « Garder » par copie : la meilleure est cochée d'office
  (VRAI avant FAUX, lossless avant MP3), et une copie que Rekordbox joue est gardée aussi. Ouvrir
  une copie l'écoute et la compare à la copie gardée, fait par fait.
- **Un seul geste, un seul Ctrl+Z.** Rien ne part avant « Envoyer à la corbeille », qui récapitule
  tout le plan. Un groupe aux durées différentes reste **À vérifier**, hors du plan, tant que vous
  ne l'avez pas tranché. Quand Rekordbox est ouvert, la confirmation dit combien de copies n'ont
  pas pu être vérifiées. « Ce ne sont pas des doublons » retire un groupe pour de bon.
- La pastille DUPLICATE de Revue mène au groupe de la piste. Le mode Doublons de Rangés disparaît,
  remplacé par cet écran, et les raccourcis `Ctrl+2` à `Ctrl+9` se décalent d'un cran.

#### Corbeille

- **Jeter ne recopie plus.** Un fichier part dans une corbeille sur son propre disque —
  `Documents/Sift/Trash` s'il est sur le même disque, sinon `.sift-trash` à la racine du sien —
  par un simple déplacement, instantané. Annuler et Restaurer le remettent de la même façon. Avant,
  tout était recopié dans Documents : jeter les doublons d'une vraie bibliothèque aurait recopié
  23 Go.
- Une copie de Rangés envoyée à la corbeille puis restaurée retourne dans Rangés.

#### Sift parle anglais

- L'interface entière existe en français et en anglais, au choix dans Réglages ; les messages du
  moteur suivent. Les notes de mise à jour arrivent dans la langue de l'app. Le site et le manuel
  ont leur version anglaise.

#### Revue

- Le verdict dit le **débit d'origine** du fichier, et un fichier lossy **sous 320 kbps** est
  signalé, avec la proposition de le mettre à l'écart (#69).
- Le **spectrogramme s'agrandit**, calculé à la résolution de l'écran (#72).
- **Changer de release** sans relancer l'identification (#68).
- Une édition des métadonnées survit à la réouverture de la piste.
- Ouvrir une piste et l'identifier **ne figent plus la fenêtre**.
- L'inspecteur se masque d'un bouton de la barre, et les poignées de redimensionnement se voient.
- Une piste sans pochette montre une note de musique au lieu d'un carré vide.

#### Détection

- **Les Vorbis (OGG) et WMA déguisés en lossless ne passent plus inaperçus** : un nouveau banc
  compte les blocs alignés sur la grille du codec. Mesuré : 22 détections de plus sur le corpus de
  test, aucune régression.
- Un AAC déguisé en `.flac` est reconnu lossy.
- Un seul décodage par fichier, et l'ouverture du Diagnostic passe de 13 s à 0,4 s. Une piste dont
  le rapport était périmé est de nouveau analysée — 1 384 l'attendaient dans une vraie
  bibliothèque.
- La durée enregistrée vient du décodage, plus de l'en-tête du fichier.

#### Rangement

- Le **profil de conversion se règle par format** (#71).
- Une conversion en place garde son nom (#77) ; deux destinations qui ne diffèrent que par la casse
  sont un seul fichier (#79) ; une conversion écrit le débit du fichier produit.
- Graver des tags ne relance plus l'analyse complète et ne sort plus une piste de Rangés.
- Mode Lot : le bouton compte ce qu'il range, et une analyse abandonnée ne passe plus pour en cours.

#### Rekordbox

- La synchro des métadonnées dit ce que Rekordbox garderait d'une release remplacée, et vide dans
  `master.db` les champs que la nouvelle release n'a plus (#81).
- Un « % » dans un nom de fichier ne fait plus échouer l'export XML.

#### Journal et lecteur

- Une mise à la corbeille ne s'affiche plus « Purgé », et la reprise d'une annulation interrompue
  reste une annulation de rangement (#80).
- La bulle de temps du lecteur suit le pouce pendant un glissement.

#### macOS

- Le paquet macOS est scellé (signature ad hoc), et chaque build le vérifie (#36).

### English

#### Read before updating

- **This version installs by hand.** The key that signs updates has changed: a 0.1.3
  installation cannot verify 0.1.4 and refuses the automatic update. Download the installer
  (table below) and install over it: your library and settings are kept. Later versions will
  update themselves again.

#### Duplicates, a new screen

- **Every duplicate in one place.** A rail entry under Review gathers the copies of the same track
  across the whole library, queue and Filed included. Each group says what it rests on: files
  **identical** byte for byte, **same sound** (acoustic fingerprint), or **same name** — dirty names
  included: track number, website address, "(1)", "320kbps". "(Original Mix)" counts as no
  version; another version stays another track.
- **Compare before you choose.** One "Keep" box per copy: the best one is checked for you (GENUINE
  before FAKE, lossless before MP3), and a copy Rekordbox plays is kept as well. Opening a copy
  plays it and compares it with the kept copy, fact by fact.
- **One gesture, one Ctrl+Z.** Nothing leaves before "Move to Trash", which sums up the whole plan.
  A group whose copies differ in length stays **To check**, out of the plan, until you decide it.
  While Rekordbox is open, the confirmation says how many copies couldn't be checked. "These aren't
  duplicates" removes a group for good.
- The DUPLICATE badge in Review leads to the track's group. Filed loses its Duplicates mode,
  replaced by this screen, and the `Ctrl+2` to `Ctrl+9` shortcuts shift by one.

#### Trash

- **Throwing away no longer copies.** A file goes to a trash on its own disk —
  `Documents/Sift/Trash` if it is on the same disk, otherwise `.sift-trash` at the root of its own —
  with a plain, instant move. Undo and Restore put it back the same way. Before, everything was
  copied into Documents: throwing away the duplicates of a real library would have copied 23 GB.
- A Filed copy moved to the Trash and then restored goes back to Filed.

#### Sift speaks English

- The whole interface exists in French and in English, to choose in Settings; the engine's
  messages follow. Update notes arrive in the app's language. The website and the manual have
  their English version.

#### Review

- The verdict states the file's **original bitrate**, and a lossy file **under 320 kbps** is
  flagged, with the offer to set it aside (#69).
- The **spectrogram can be enlarged**, computed at the screen's resolution (#72).
- **Change the release** without running the identification again (#68).
- A metadata edit survives reopening the track.
- Opening a track and identifying it **no longer freeze the window**.
- The inspector hides with a button in the bar, and the resize handles are visible.
- A track without a cover shows a music note instead of an empty square.

#### Detection

- **Vorbis (OGG) and WMA files disguised as lossless no longer go unnoticed**: a new bench counts
  the blocks aligned on the codec's grid. Measured: 22 more detections on the test corpus, no
  regression.
- An AAC disguised as a `.flac` is recognised as lossy.
- One decode per file, and opening the Diagnostic goes from 13 s to 0.4 s. A track whose report
  was out of date is analysed again — 1,384 were waiting in a real library.
- The stored length comes from decoding, no longer from the file header.

#### Filing

- The **conversion profile is set per format** (#71).
- A conversion in place keeps its name (#77); two destinations that differ only by case are one
  file (#79); a conversion writes the bitrate of the file it produced.
- Writing tags no longer restarts the full analysis nor takes a track out of Filed.
- Batch mode: the button counts what it files, and an abandoned analysis no longer passes for
  one in progress.

#### Rekordbox

- The metadata sync says what Rekordbox would keep from a replaced release, and clears in
  `master.db` the fields the new release no longer has (#81).
- A "%" in a file name no longer breaks the XML export.

#### Log and player

- Moving a file to the Trash no longer shows as "Purged", and resuming an interrupted undo stays an
  undo of a filing (#80).
- The player's time bubble follows the thumb while dragging.

#### macOS

- The macOS bundle is sealed (ad hoc signature), and every build checks it (#36).

## v0.1.3

### Apparence

- **Sift a son icône.** Deux carrés qui se chevauchent, l'un ambre et ouvert, l'autre vert et
  plein : le fichier en vrac et le fichier rangé. Elle remplace l'icône par défaut dans la barre
  des tâches, le Dock et le raccourci.

### Sous le capot

- Les tables de la norme MPEG que le détecteur rejoue sont écrites en valeurs exactes, au lieu
  des décimales arrondies qui circulent dans les décodeurs. Deux d'entre elles gagnent un
  chiffre. Aucun verdict ne change.

### Licence

- Sift devient un logiciel propriétaire : son usage reste libre et gratuit, sa redistribution et
  sa modification demandent un accord. Les versions jusqu'à la 0.1.2 restent sous licence MIT
  pour qui les a obtenues.

## v0.1.2

### Détection

- **Les MP3 320 déguisés en lossless ne passent plus pour vrais.** Un MP3 encodé par LAME à
  320 kbps coupe le spectre entre 20,2 et 20,7 kHz, juste au-dessus de la limite que Sift
  considérait comme « bande pleine ». Un fichier lossless dont le spectre s'arrête entre
  20 000 et 20 750 Hz est désormais **À VÉRIFIER** au lieu de VRAI : un mur net à cette hauteur se
  voit au spectrogramme. Jamais FAUX d'office, parce qu'un vrai master peut y avoir un roll-off
  naturel. Mesuré : les 20 MP3 320 du corpus de test passaient en VRAI, ils passent À VÉRIFIER ;
  aucun des 8 achats vérifiés n'est touché (tous à 22 050 Hz) ; dans une bibliothèque réelle de
  546 lossless, 21 fichiers tombent dans cette zone, et 19 d'entre eux ont un mur de plus de
  20 dB, la signature d'un encodeur.
- La trace de codec dans les échantillons (sonde de quantification) est aussi cherchée sur cette
  zone : si elle est trouvée, le verdict passe FAUX.
- **Les MP3 déguisés en lossless sont reconnus à leur grille de quantification, quel que soit
  leur débit.** La sonde qui cherchait la trace d'un encodeur AAC dans les échantillons rejoue
  désormais aussi l'encodeur MP3 (banc de filtres de la couche III). Mesuré sur le corpus de test :
  les MP3 320, V0, 256, 192 et 160 réencapsulés en FLAC portent la grille 10 fois sur 10, les
  MP3 128 7 fois sur 10 ; aucun des 8 achats vérifiés n'est touché. Un morceau de plus de 9 minutes est
  sondé sur ses 9 premières minutes (la sonde garde le signal décodé en mémoire, et s'arrête là) —
  la grille d'un transcodage est la même du début à la fin. Un fichier
  tenu pour authentique dans la référence s'est révélé un MP3 transcodé, et la sonde l'a vu.
- **Les AAC à bas débit déguisés en lossless sont reconnus.** La sonde ne regardait les blocs
  longs de l'AAC qu'à travers une fenêtre sinus, alors que ffmpeg les encode en Kaiser-Bessel :
  elle essaie désormais les deux formes, et juge la grille sur 2 à 18 kHz au lieu de 14,5 à
  20 kHz, là où un AAC 128 n'a plus rien à montrer. Mesuré sur le corpus de test : les AAC 128 de
  ffmpeg passent de 1 sur 10 à 10 sur 10, les AAC 256 de 6 à 10 sur 10 ; aucun des 8 achats
  vérifiés ni des 957 lossless d'une bibliothèque réelle n'est touché.
- Les verdicts sont rejoués au démarrage depuis les mesures déjà stockées, sans nouvelle analyse.

## v0.1.1

Première version publiée depuis la 0.0.3 : elle porte tout ce qui suit, plus les
installeurs **Mac Intel** (`x86_64`) à côté d'Apple Silicon et de Windows — un binaire arm64
ne démarre pas sur un Mac Intel, et le parc visé est mixte.

### Une interface refaite, écran par écran

Sift a été relu contre les applications système de macOS — Finder, Musique, Mail, Photos,
Utilitaire de disque, Réglages Système — et redessiné sur leur grammaire, puis adapté aux
conventions Windows (contrôles de fenêtre à droite, `Ctrl`, clic droit partout).

- **Une barre unique** porte le titre de l'écran, son compte et ses actions. Le rail de
  navigation est groupé en sections, repliable, et accueille désormais les **dossiers
  surveillés** (l'écran Accueil a disparu : ses sources vivent dans le rail, avec leur
  couleur, leur compte et leur état de surveillance).
- **Revue**, l'écran de décision : lecteur façon Apple (temps cliquable, survol de l'onde,
  volume en capsule), verdict dit en un mot — **VRAI**, **FAUX** ou **À VÉRIFIER** —, fiche
  Métadonnées éditable en place et gravée au blur, identification Discogs en liste ouverte,
  Diagnostic audio dans l'inspecteur, filtre par facettes et recherche en tête de la file,
  menu contextuel sur chaque piste, raccourcis clavier en infobulle.
- **Mode Lot** : on coche dans la file, la zone centrale résume la sélection (verdicts,
  formats, durée), une alerte récapitule avant un rangement de masse, une feuille de
  progression non modale montre l'avancement puis le rapport. Menu **Sélection** : tout,
  aucune, seulement une catégorie (Lossless, MP3, Faux, Doublons), sans les faux ;
  `Ctrl+A` / `Ctrl+Maj+A`.
- **Rangés** (ex-Bibliothèque) : table à fonds alternés comme le Finder, colonnes
  redimensionnables et réordonnables (mémorisées), tri sur chaque colonne, sélection
  multiple avec inspecteur agrégé, menu contextuel (ouvrir l'emplacement, réanalyser,
  écarter, corbeille), pochette-bouton de lecture, inspecteur qui parle Revue.
- **À re-sourcer** et **Corbeille** deviennent deux destinations du rail, dans la même
  table.
- **Journal** : une vraie table, groupée par session et par jour ; une action annulée reste
  marquée annulée après un redémarrage.
- **Rekordbox** : une seule synchronisation — « Synchroniser la sélection » ou « Tout
  synchroniser » —, les candidats groupés par type et nommés « Artiste — Titre », les
  faits du fichier lié en tête.
- **Clé USB** : colonne des disques, puis pour le disque choisi la barre d'occupation par
  format, une grille de faits (point de montage, format, capacité, libre, fichiers,
  modèle, périphérique, santé) et les actions Formater, Éjecter, Relire.
- **Réglages** : catégories à gauche, panneau à droite, application immédiate — plus
  aucun bouton Enregistrer, le modèle de nommage se grave à la frappe.
- Police **Inter**, gris système d'Apple, accent bleu système, coins arrondis de fenêtre
  sur Windows 11, une seule hauteur de rangée, deux familles de boutons, et plus aucun
  survol sur un bouton plein.

### Une détection des faux lossless plus fiable

- Deux signaux s'ajoutent à la coupure spectrale : la **platitude de l'aigu** et la
  **vraisemblance de quantification** (la trace que laisse un codec dans les échantillons).
  Mesuré sur la référence du dépôt : les faux négatifs passent de 68 % à 31 %.
- La durée décodée est mesurée, plus lue dans l'en-tête ; l'absence de mesure ne produit
  plus de verdict ; les seuils ont été re-dérivés sur une référence assainie.
- Un changement de moteur ne perd plus la bibliothèque rangée : le verdict est rejoué au
  démarrage sur les mesures stockées, et les pistes rangées qui ne peuvent pas l'être sont
  reprises par l'analyse de fond, la file d'abord. Un compteur le dit dans le journal.
- Le badge « Prêt CDJ » juge le porteur du tag (un WAV en RIFF n'est pas lisible par la
  platine), plus sa seule présence.

### Rangement

- La racine de bibliothèque n'est plus exigée pour convertir : elle ne conditionne que
  l'arbre de destinations. Le rappel vit dans le rail, sous les sources.
- Le popover Destination est en sections (Bibliothèque / Autres), avec un pied natif.
- Un dossier surveillé sans fichier audio reconnu porte un badge « 0 audio ».

### Clé USB

- L'écriture du FAT32 au-delà de 32 Go part par blocs de 1 Mio au lieu de secteur par
  secteur, et l'étape affiche les Mo écrits : plus d'écran qui semble figé.
- Le type de partition FAT32 est posé correctement ; l'éjection d'un SSD USB vu comme
  disque fixe passe par son périphérique parent ; plus de demande d'élévation quand la
  partition existante convient.

### Vitesse

- Les rapports d'analyse en cache sont 21 fois plus petits (la base réelle est passée de
  4,1 Go à 119 Mo), la grille du spectrogramme se recalcule à l'ouverture.
- Le dédoublonnage ne recalcule plus tout quand une seule piste est rangée, et sa fenêtre
  de durée énumère au lieu de filtrer.
- Un rendu d'écran en retard ne repeint plus l'écran courant ; le rail des sources se met
  à jour en place.

### Sous le capot

- Build macOS Intel ajouté (en plus d'Apple Silicon) ; FFmpeg macOS compilé depuis les
  sources, sans composant GPL.
- Les chaînes françaises ont retrouvé leurs accents, avec des gardes qui empêchent le
  retour du problème.

## v0.1.0

Brouillon jamais publié (sans installeur Mac Intel) : ses notes sont celles de la v0.1.1.

## v0.0.3

### L'écran Clé USB fonctionne

Il n'avait jamais fonctionné depuis son introduction : aucune clé n'apparaissait, quelle
qu'elle soit. Six causes distinctes, toutes corrigées.

- Les disques sont désormais énumérés au niveau **physique**, donc une clé neuve ou sans
  système de fichiers apparaît elle aussi — c'est précisément celle qu'on veut formater.
- Le type de bus est lu là où il est exact. Les boîtiers USB modernes se déclarent en interne,
  et Sift les écartait donc à tort.
- Le formatage demande l'élévation quand il en a besoin, au lieu d'échouer en silence.
- Le nom du volume est demandé au système, plus seulement lu.

**Ce qui n'est pas encore prouvé** : le formatage FAT32 n'a jamais abouti sur un vrai disque,
et l'éjection n'a jamais été exécutée de bout en bout. Les corrections sont écrites, pas
confirmées par l'usage. À utiliser avec prudence, sur un disque dont vous avez une sauvegarde.

### Occupation du disque, par format

Un graphique montre la répartition de ce qui occupe un volume — lossless, MP3, le reste — sur
l'écran Clé USB comme sur la Bibliothèque, avec la place libre et l'état de santé du volume.

### Formater en FAT32 au-delà de 32 Go

Windows refuse de créer un FAT32 de plus de 32 Go. Sift écrit désormais le système de fichiers
lui-même, ce qui lève cette limite pour les clés et SSD de grande capacité. macOS n'était pas
concerné : il n'a jamais eu ce plafond.

### Vitesse

- L'ouverture de la Revue passe de ~1,8 s à ~15 ms.
- Trois causes de gel de l'interface supprimées, dont le rangement, qui ne bloque plus.
- Le formatage ne fige plus la fenêtre pendant son exécution.

### Sous le capot

- FFmpeg passe au build LGPL sur Windows. Sift n'utilise que l'encodeur MP3 et du PCM, donc les
  composants sous licence GPL n'apportaient rien et n'imposaient que leurs contraintes.
- Rescan manuel par source rebranché sur l'écran Accueil.

## v0.0.2

**Aucun changement fonctionnel.** Cette version ne contient qu'un commit de plus que la
v0.0.1 : la montée de numéro elle-même.

Elle a été publiée quinze minutes après la v0.0.1 pour vérifier la mise à jour automatique en
conditions réelles — l'app installée ne cherche une mise à jour que s'il en existe une plus
récente que la sienne, donc la seule façon d'éprouver ce chemin était de publier une version
qui ne change rien d'autre.

Si vous êtes en v0.0.1, cette mise à jour ne vous apporte rien. Passez directement à la
v0.0.3.

## v0.0.1

Première version publiée. Elle représente le projet complet de son premier commit
(2026-06-11) à sa publication : 896 commits, et les neuf jalons de la V1.

- **Analyse** — décodage natif, détection de faux lossless au spectrogramme, clipping,
  troncature, silence, phase. C'est la raison d'être de Sift : un MP3 ré-encodé en FLAC ne se
  voit pas dans un tag, seulement dans son spectre.
- **Écoute** — lecture des fichiers avec forme d'onde, verrouillage de tonalité, réglage de
  tempo.
- **Ranger, c'est encoder** — deux rails de sortie, refus de sur-encoder, tags et nommage
  automatiques, bacs de destination, corbeille et annulation.
- **Écartés** — re-sourcer une piste rejetée, liens d'achat, copie vers Soulseek.
- **Doublons** — par nom puis confirmation à l'oreille, par empreinte acoustique.
- **Identification** — Discogs : pochette, genres, métadonnées.
- **Bibliothèque** — parcourir, éditer, re-ranger, tableau de bord de statistiques.
- **Rekordbox** — export XML dont les playlists survivent à un renommage ou un déplacement,
  puis écriture directe dans `master.db` : réparation de chemins, dédoublonnage de playlists,
  synchronisation des métadonnées et des pochettes. Chaîne de sûreté complète — sauvegarde,
  vérification aller-retour, retour arrière — éprouvée sur une vraie bibliothèque de
  2828 pistes.
- **Clé USB** — formatage FAT32/exFAT sur Windows et macOS.
- **Mise à jour automatique**, sans certificat de signature.
