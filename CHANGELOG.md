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

Publiée le 2026-07-24, avant l'existence de ce fichier. Voir la liste des commits sur la page
de la release.

## v0.0.1

Première version publiée, le 2026-07-24. Voir la liste des commits sur la page de la release.
