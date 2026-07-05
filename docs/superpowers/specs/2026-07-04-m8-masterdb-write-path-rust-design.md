# M8 — Write path Rust pour `master.db` Rekordbox (design)

> Statut : **design, pas encore planifié ni implémenté.** Suite directe de
> l'Évaluation 7 (`docs/ressources-externes.md`) : le spike Python
> (`pyrekordbox`) a validé les 3 scénarios d'écriture sur une copie de la
> vraie bibliothèque. Ce document spécifie le portage Rust de prod, condition
> (1) du dégel de M8 (`docs/plan-implementation.md:236-246`).
>
> Rédigé pour être implémentable par une session ultérieure **sans recharger
> tout ce contexte** : l'intention et les invariants de sûreté sont dans ce
> fichier, pas seulement le quoi.

## Intention (pourquoi ce chantier existe)

Le cas utilisateur M8 : Sift déplace/ré-encode des fichiers (« déplacer =
encoder + ranger »), ce qui casse les chemins que Rekordbox connaît. En V1
(M5), Sift **avertit** seulement (garde-fou lecture seule). M8 est la bascule
vers la **réparation intégrée** : mettre à jour `djmdContent.FolderPath` dans
`master.db` pour que Rekordbox retrouve ses morceaux, plus la **dédup des
entrées de playlist** dupliquées. Rien d'autre. Toute écriture au-delà de ces
deux opérations est hors scope de ce design — c'est le périmètre qui rend le
risque acceptable.

## Ce qui existe déjà (à réutiliser, pas à réinventer)

- **Lecteur SQLCipher pur Rust** : `src-tauri/src/rekordbox_masterdb.rs`
  (module exploratoire M7, testé, non câblé à l'IPC). Il fait : déchiffrement
  page par page (AES-256-CBC, HMAC-SHA512 vérifié AVANT déchiffrement,
  paramètres SQLCipher v4 confirmés empiriquement et documentés en tête de
  fichier), réassemblage d'un buffer SQLite en clair, remise à `rusqlite` via
  `deserialize_read_exact`. Le buffer déchiffré ne touche jamais le disque.
- **Erreurs** : enum `MasterDbError` (fail-fast, `Display` manuel, conversion
  `String` à la frontière IPC) — étendre cette enum, pas en créer une seconde.
- **Spike de référence** : `~/Desktop/sift-masterdb-write-probe/` (hors repo)
  — les 4 scripts Python sont la spécification exécutable du comportement
  attendu (baseline, path repair, playlist dedup, verrou).

## Architecture proposée

Symétrique du lecteur, même philosophie « ne pas réimplémenter SQLite » :

1. **Déchiffrer** tout `master.db` en buffer clair (code existant).
2. **Modifier** via `rusqlite` sur le buffer désérialisé (SQL ordinaire :
   `UPDATE djmdContent SET FolderPath = ...`, `DELETE FROM djmdSongPlaylist
   WHERE ID = ...`). C'est du SQLite standard, déjà éprouvé dans Sift.
3. **Re-sérialiser** le buffer (`Connection::serialize`), **rechiffrer** page
   par page : IV frais aléatoire par page (jamais réutiliser les IV lus),
   AES-256-CBC, HMAC-SHA512 recalculé sur `ciphertext || iv || page_number`,
   page 1 avec son cas spécial (16 octets de sel en clair). Les constantes et
   la géométrie sont déjà dans le module (PAGE_SIZE 4096, RESERVE 80, etc.).
4. **Écrire atomiquement** : fichier temporaire dans le même dossier →
   `rename` par-dessus. Jamais d'écriture in-place partielle.

## Invariants de sûreté (non négociables, chacun issu d'un fait vérifié)

1. **Backup obligatoire avant toute écriture** : copie horodatée de
   `master.db` (et de `masterPlaylists6.xml`, voir risque ouvert) à côté,
   vérifiée lisible (ouvrir + HMAC page 1) avant de continuer. Fail-fast si
   la copie échoue.
2. **Refuser d'écrire si Rekordbox tourne** : détection de process explicite
   AVANT d'ouvrir le fichier (équivalent Rust de
   `pyrekordbox.utils.get_rekordbox_pid()` — chercher un process
   `rekordbox.exe`/`rekordbox` via la crate `sysinfo` ou équivalent, à
   vérifier via Context7 au moment d'implémenter). L'exception « database is
   locked » du spike (Task 5) n'est qu'un filet a posteriori, pas le
   garde-fou (décision actée Évaluation 7).
3. **Round-trip vérifié avant de déclarer le succès** : après le rename,
   rouvrir le fichier écrit avec le LECTEUR existant (connexion fraîche),
   revérifier tous les HMAC + relire la valeur modifiée + compter les tracks
   (inchangé). C'est la transposition du protocole du spike (relecture par
   connexion fraîche, jamais l'état en mémoire).
4. **Périmètre SQL fermé** : seules les requêtes des 2 opérations, sur les
   2 tables `djmdContent`/`djmdSongPlaylist`. Pas d'API générique « exécute
   du SQL sur master.db ».

> **Mise à jour 2026-07-05 (spike n°2 exécuté — Évaluation 11,
> `docs/ressources-externes.md`, détail dans
> `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-2.md`)** :
> le risque n°2 est **résolu** — une modif `FolderPath` touche exactement 3
> colonnes (`FolderPath`, `rb_local_usn` = nouvelle valeur du compteur global
> `agentRegistry.localUpdateCount.int_1` incrémenté de 1, `updated_at` posé
> par l'ORM, à poser explicitement en Rust). Le risque n°1 est **caractérisé
> mais pas encore tranché** : pyrekordbox réécrit bien `masterPlaylists6.xml`
> à chaque commit (resync des Timestamps depuis `djmdPlaylist.updated_at`,
> seuil >1 s), probablement par artefact de fuseau plutôt que par nécessité
> pour une réparation de chemin pure — le verdict dépend du test manuel
> d'Antoine dans le vrai Rekordbox (§6 du FINDINGS), toujours en attente.
> L'implémentation Rust reste bloquée sur ce verdict.

## Risque ouvert n°1 — `masterPlaylists6.xml` (le spike ne l'a PAS couvert)

Le spike a travaillé sur une copie **sans** `masterPlaylists6.xml` (warning
noté Évaluation 5 : fichier de checksums d'intégrité que Rekordbox garde à
côté de `master.db`). Conséquence : **le spike a prouvé le round-trip au
niveau SQLite, pas l'acceptation par Rekordbox lui-même.** `pyrekordbox`
maintient ce fichier lors de ses commits ; un write path Rust qui ne le fait
pas pourrait produire une base techniquement valide que Rekordbox rejette ou
« répare » (comportement inconnu). À traiter comme **prérequis bloquant** :

- Spike complémentaire (Python, copie du dossier COMPLET incluant
  `masterPlaylists6.xml`) : modifier via pyrekordbox, puis **ouvrir la copie
  dans le vrai Rekordbox** et vérifier qu'il l'accepte. Lire le code
  pyrekordbox pour savoir exactement ce qu'il met à jour (checksums, USN
  `rb_local_usn`, `updated_at`).
- Le design Rust final doit répliquer ce que ce spike révèle (probablement :
  bump des USN sur les lignes modifiées + mise à jour du XML). Tant que ce
  n'est pas connu, **ne pas implémenter l'étape 3/4 ci-dessus**.

## Risque ouvert n°2 — sémantique des colonnes annexes

`djmdContent`/`djmdSongPlaylist` ont des colonnes de suivi
(`rb_local_usn`, `updated_at`, `rb_data_status`...) que pyrekordbox gère via
son ORM. Un `UPDATE` SQL nu ne les touche pas. À inventorier dans le spike
complémentaire (diff SQL avant/après un commit pyrekordbox sur la même
modification) et à répliquer à l'identique.

## Intégration app (hors scope de ce design, pour mémoire)

Le câblage IPC/UI (où le bouton « réparer » vit, la confirmation in-app à
deux clics — jamais `window.confirm()`, cf. CLAUDE.md) sera un design séparé
une fois le moteur prouvé. Ce document ne couvre que le moteur.

## Séquencement recommandé

1. Spike complémentaire `masterPlaylists6.xml` + diff USN (Python, ~1 session,
   copie du dossier complet, validation dans le vrai Rekordbox).
2. Mise à jour de ce design avec les findings (colonnes exactes, XML).
3. Plan d'implémentation (`superpowers:writing-plans`) : extension de
   `rekordbox_masterdb.rs` (encrypt/write/verify), TDD sur fixture synthétique
   (le module a déjà une fixture chiffrée pour la lecture — la réutiliser),
   puis test sur copie réelle.
4. Décision d'intégration UI (design séparé).
