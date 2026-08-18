# Sift — manuel

Pour quelqu'un qui vient de recevoir le lien et veut s'en servir. Pas pour un développeur : le
vocabulaire technique du dépôt vit dans `CONTEXT.md`, et l'installation dans
[`install-non-signe.md`](install-non-signe.md).

Sift prépare une bibliothèque de DJ : il détecte les faux fichiers lossless, trouve les doublons,
range, et exporte vers Rekordbox. Son principe tient en une phrase — **déplacer, c'est encoder et
ranger** : un fichier ne bouge jamais sans être mis au bon format et au bon endroit en même temps.

---

## Le vocabulaire, d'abord

Trois mots portent tout le reste.

**Faux lossless** — un fichier qui se présente en FLAC, WAV ou AIFF alors que son contenu est
passé par du MP3, de l'AAC ou de l'Opus. Le contenant est sans perte, le contenu ne l'est plus, et
la qualité perdue ne revient pas. C'est ce que Sift traque.

**Verdict** — ce que Sift dit d'un fichier, en trois valeurs et pas plus :

| verdict | ce que ça veut dire |
|---|---|
| **Vrai lossless** | rien de mesuré ne contredit un master |
| **Faux lossless** | preuve mesurée : le spectre s'arrête là où un encodeur lossy coupe, ou le conteneur ment sur son codec |
| **Douteux** | quelque chose sort de l'ordinaire sans être une preuve — Sift le signale, il n'accuse pas |

**Écartés** — les fichiers que vous avez sortis du flux : un faux à re-sourcer, un doublon, une
erreur. Rien n'est supprimé sans que vous le demandiez.

### L'anglais est gardé exprès

`LOSSLESS`, `DUPLICATE`, `MATCH`, `CHECK MATCH`, `FAKE`, `kbps`, `kHz`, `MP3`, `AIFF`, `WAV` —
ces mots restent en anglais dans l'interface parce que c'est sous cette forme qu'ils apparaissent
partout ailleurs : dans Rekordbox, sur les boutiques, sur les forums. Les traduire créerait un
second vocabulaire à apprendre.

---

## Un passage, dans l'ordre d'une session

Le rail de gauche a huit entrées. Elles ne se visitent pas dans le désordre : elles suivent le
trajet d'un fichier.

### Accueil

Le point de départ. On y déclare les **sources** : les dossiers où arrivent les nouveaux fichiers.
Sift les surveille et analyse ce qui s'y pose, sans rien déplacer.

La bannière du haut compte ce qui attend — combien de fichiers à trier, et combien de faux déjà
détectés dedans.

### Revue

L'écran où le travail se fait, et le seul qui compte vraiment. Une file à gauche, un fichier à la
fois au centre.

Pour chaque morceau : la forme d'onde, le spectrogramme, le verdict, et ce qu'il faut pour décider.
Le son passe **avant** le verdict — on écoute, puis on tranche.

Trois issues, au clavier ou à la souris :

- **Ranger** — le fichier part vers sa destination, encodé au format voulu au passage.
- **Écarter** (`X`) — vers les Écartés. Pour un doublon, ou un fichier qu'on ne veut pas.
- **Re-sourcer** (`X` sur un faux) — vers les Écartés aussi, avec la raison : ce fichier est à
  racheter ou retrouver ailleurs.

Un **mode Lot** permet de traiter une sélection d'un coup quand le verdict est évident sur plusieurs
fichiers à la fois.

### Écartés

Ce qui a été sorti du flux, avec la raison. C'est une liste de courses autant qu'une corbeille : les
morceaux à re-sourcer y attendent d'être rachetés.

Le vidage de la corbeille est une action explicite, jamais automatique.

### Journal

Tout ce que Sift a fait, dans l'ordre, avec un retour en arrière possible. Un rangement de masse
qui s'est trompé de destination se défait ici.

### Bibliothèque

Ce qui est rangé. Recherche, filtres, occupation par format, et le détail d'un morceau.

### Rekordbox

L'export. Deux chemins : un fichier XML à importer, ou l'écriture directe dans la base de
Rekordbox.

⚠️ **Rekordbox doit être fermé** pendant l'écriture directe. Sift sauvegarde la base avant de la
toucher et refuse d'agir si le logiciel tourne.

### Clé USB

Formatage d'une clé pour les platines, en FAT32 même au-delà de 32 Go, et éjection propre.

Le formatage efface la clé. Sift le demande deux fois, en nommant le volume.

### Réglages

Les formats de destination, le modèle de nom de fichier, l'arborescence de rangement, le thème.

---

## Ce que Sift ne fait jamais tout seul

- **Rien n'est supprimé** sans une demande explicite. Écarter déplace, ça n'efface pas.
- **Aucune source n'est modifiée** : un dossier surveillé est lu, jamais réécrit.
- **Rien n'est écrit dans Rekordbox** sans sauvegarde préalable vérifiée.
- Les actions coûteuses ou irréversibles demandent une confirmation dans l'app — et sur un lot
  important, cette confirmation s'arme quelques instants pour qu'un double-clic ne la traverse pas.

---

## Ce que la détection attrape, et ce qu'elle laisse passer

Un manuel qui promet un détecteur parfait ment. Mesuré le 2026-08-18 sur un corpus fabriqué de
150 transcodages et 10 achats vérifiés :

- **Aucun fichier authentique n'a été accusé.** C'est la contrainte qui prime sur tout le reste :
  mieux vaut rater un faux que faire re-racheter un bon fichier.
- **Environ un tiers des transcodages passent encore pour authentiques.** Le noyau dur est l'AAC à
  débit élevé et le MP3 320 : ces encodeurs ne coupent pas le haut du spectre, donc la trace la
  plus visible n'existe pas chez eux.

Autrement dit : un verdict **Faux lossless** est fiable, un verdict **Vrai lossless** veut dire
« rien de mesuré ne le contredit », pas « garanti ».

---

## Quand quelque chose ne va pas

Les erreurs s'affichent dans l'app avec leur cause. Si un fichier refuse de s'analyser, son message
est conservé et visible sur la ligne du morceau — ce n'est pas un silence.

Pour signaler un problème : [github.com/c0remusic/sift/issues](https://github.com/c0remusic/sift/issues).
