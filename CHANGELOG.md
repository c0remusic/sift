# Journal des versions

Ce fichier est la **source** des notes de version : `release.yml` extrait la section du tag
publié et la passe à `releaseBody`. Ce texte part à deux endroits — la page GitHub de la
release, et le champ `notes` de `latest.json`, que chaque installation existante télécharge en
vérifiant les mises à jour. Il s'écrit donc pour un utilisateur, pas pour un développeur : les
détails techniques vivent dans les messages de commit.

Une section manquante fait **échouer** le build de release plutôt que publier des notes vides.
Le titre de section doit être exactement `## vX.Y.Z` pour que l'extraction le trouve.

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
