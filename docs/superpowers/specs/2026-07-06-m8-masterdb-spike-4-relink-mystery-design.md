# M8 — Spike n°4 : isoler la cause du relink silencieux Rekordbox (design)

> Statut : **design, à exécuter avant de conclure sur Tier 1 (réparation de
> chemin) de M8.** Suite directe du spike n°3
> (`docs/superpowers/specs/2026-07-06-m8-masterdb-spike-3-design.md`,
> résultats dans `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-3.md`
> section 5) : un `UPDATE djmdContent.FolderPath` a été **silencieusement
> ignoré** par le vrai Rekordbox, qui a résolu vers un troisième fichier
> (un doublon octet-identique du fichier d'origine, présent ailleurs sur le
> disque, jamais mentionné dans aucune valeur qu'on a écrite en base).

## Intention

Le spike n°3 a confirmé deux choses en même temps sans pouvoir les
départager :
1. Le fichier qu'on a modifié (`canary_moved.mp3`, tag `Artist` changé,
   copié dans `spike3-copy/`, un dossier que Rekordbox n'a jamais scanné).
2. Rekordbox a ouvert un AUTRE fichier — un doublon octet-identique de
   l'original, dans un dossier différent (`after gore/`) — sans dialogue,
   sans erreur, silencieusement.

Deux hypothèses expliquent également bien cette observation :
- **H1 (contenu)** : Rekordbox valide l'identité d'un fichier par une
  empreinte (hash/taille) au chargement. Notre édition de tag a changé le
  hash du fichier → Rekordbox l'a rejeté comme "pas le bon fichier" et a
  cherché/trouvé un doublon intact ailleurs.
- **H2 (dossier)** : Rekordbox déclenche une recherche de relink dès qu'un
  chemin pointe vers un dossier qu'il ne reconnaît pas comme faisant partie
  de sa bibliothèque surveillée — indépendamment du contenu du fichier à cet
  endroit.

Ces deux hypothèses ont des implications radicalement différentes pour M8 :
- Si **H1** : Sift peut réparer un chemin vers n'importe quel dossier tant
  que le contenu du fichier reste identique — mais Sift re-tague TOUJOURS
  les fichiers qu'il range (Discogs), donc **H1 condamnerait Tier 1 tel que
  conçu** : toute réparation de chemin accompagnant un re-tag serait
  silencieusement annulée par Rekordbox. Il faudrait soit réparer le chemin
  AVANT de re-tagger (deux commits séparés), soit trouver le mécanisme exact
  de validation pour le satisfaire.
- Si **H2** : le problème est spécifique à ce spike (dossier de test jamais
  scanné) et n'affecterait pas un vrai déploiement Sift, où les fichiers
  déplacés restent dans des dossiers déjà connus de Rekordbox (bibliothèque
  de l'utilisateur). Tier 1 resterait viable tel que conçu.

Ce spike isole laquelle des deux domine, avec 2 tests contrôlés en variant
une seule variable à la fois.

## Ce qui existe déjà (réutiliser)

- `~/Desktop/sift-masterdb-write-probe/spike3-copy/` — copie de travail
  déjà utilisée, réutilisable si repartie d'un état propre (re-copier depuis
  le live si besoin, Task 1 du plan spike n°3 comme modèle).
- Piste canary déjà identifiée et confirmée : ID `165700329`
  ("Weekender - Route 1 (Version)"), `FolderPath` original
  `D:/MUSIQUE 2025/MP3/Weekender - Route 1 (Version).mp3`. **Grille déjà
  vérifiée intacte** (spike n°3) — reste le canary de sûreté pour ce spike
  aussi.
- Doublon déjà connu : `C:\Users\LEETJ\Desktop\after gore\Weekender - Route
  1 (Version).mp3` (octet-identique au fichier D:\, confirmé sha256).

## Protocole (2 tests, une variable isolée par test)

**Commun** : repartir d'une copie fraîche de `master.db` +
`masterPlaylists6.xml` (comme Task 1 du spike n°3). Utiliser la même piste
canary (grille déjà connue comme sûre). Swap manuel + ouverture réelle
Rekordbox par Antoine à chaque test, comme le spike n°3 (jamais délégable).

### Test A — Contenu inchangé, dossier NON reconnu (isole H2)

1. Copier le fichier ORIGINAL (sans aucune modification de tag) vers
   `spike4-copy/canary_unmodified.mp3` — même dossier de test que le spike
   n°3 (jamais scanné par Rekordbox), mais **contenu octet-identique** à
   l'original.
2. `UPDATE FolderPath/FileNameL/FileNameS` vers ce nouveau chemin, **ne pas
   toucher** `TrackInfoUpdated` cette fois (variable non pertinente ici).
3. Swap + ouverture réelle. Observer `Emplacement` dans Rekordbox.

**Interprétation** :
- Si `Emplacement` = `spike4-copy/canary_unmodified.mp3` (notre chemin) →
  **H2 réfutée** : un dossier non reconnu n'est PAS le déclencheur à lui
  seul, le problème vient du contenu modifié (H1 confirmée par élimination).
- Si `Emplacement` résout encore ailleurs (vers `after gore/` ou `D:\`) →
  **H2 confirmée** : même un fichier au contenu strictement identique dans
  un dossier inconnu déclenche le relink — le problème n'a rien à voir avec
  le tag, c'est la reconnaissance de dossier qui compte.

### Test B — Contenu modifié, dossier DÉJÀ reconnu (isole H1)

1. Copier le fichier canary vers un nouveau nom **dans le dossier déjà
   connu** `D:\MUSIQUE 2025\MP3\` (celui où Rekordbox l'a toujours vu),
   ex. `D:\MUSIQUE 2025\MP3\canary_retag_test.mp3` — **avec** le tag
   `Artist` modifié (comme le spike n°3).
2. `UPDATE FolderPath/FileNameL/FileNameS` vers ce nouveau chemin (même
   dossier connu, nom de fichier différent).
3. Swap + ouverture réelle. Observer `Emplacement` ET `Artiste` affichés.

**Interprétation** :
- Si `Emplacement` = notre nouveau chemin ET `Artiste` = tag modifié →
  **H1 réfutée** : le contenu modifié n'empêche pas la résolution correcte
  quand le dossier est reconnu — c'est bien H2 (dossier) qui domine.
- Si `Emplacement` résout encore ailleurs malgré un dossier connu →
  **H1 confirmée** : le contenu modifié (hash différent) déclenche le
  relink même dans un dossier de confiance — implication directe et
  bloquante pour Tier 1 (voir Intention ci-dessus).

**Nettoyage obligatoire après Test B** : supprimer
`D:\MUSIQUE 2025\MP3\canary_retag_test.mp3` une fois le test terminé et le
verdict noté — ce fichier ne doit pas rester dans la vraie bibliothèque
musicale d'Antoine.

## Sortie attendue

`FINDINGS-m8-spike-4.md` dans `~/Desktop/sift-masterdb-write-probe/` :
verdict H1 vs H2 (ou les deux si le résultat est mixte — auquel cas
documenter précisément la combinaison observée plutôt que de forcer une
conclusion binaire), et l'implication directe pour le design v2 de M8
(Risque ouvert n°3).

## Ce que ce spike NE couvre PAS

- La synchro metadata (Tier 3, flag `TrackInfoUpdated`) — reste bloquée
  tant que Test A/B n'ont pas clarifié le mécanisme de résolution de
  chemin ; si H1 est confirmée, retester Tier 3 dans un dossier connu
  plutôt que `spike-copy/` pour ne pas reproduire le même confondu.
- Toute solution/contournement au relink — ce spike diagnostique, il ne
  propose pas encore de fix (le design v2 sera mis à jour séparément une
  fois le mécanisme connu).

## Suite

1. Ce spike (session dédiée, Antoine pour l'ouverture réelle × 2).
2. Mise à jour de
   `docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`
   avec le verdict H1/H2 comme Risque ouvert n°3, résolu ou non.
3. Si H1 confirmée : reconcevoir Tier 1 (ex. séparer réparation de chemin et
   re-tag en deux étapes, ou identifier le mécanisme exact de validation à
   satisfaire) avant tout plan Rust.
4. Si H2 confirmée (ou les deux réfutées par des résultats inattendus) :
   Tier 1 reste viable tel que conçu pour un déploiement réel (dossiers déjà
   connus) — passage direct à `superpowers:writing-plans` pour le Rust.
