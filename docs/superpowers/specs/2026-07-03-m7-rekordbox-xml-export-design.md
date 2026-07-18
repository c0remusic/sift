# M7 — Export XML Rekordbox + suivi des playlists (design)

> Bricks 1+2 du brainstorm M7 fusionnées : elles partagent le même mécanisme
> de fond (import/merge/réécriture XML), seul le déclencheur diffère.

## Problème

M7 (`docs/plan-implementation.md:231`) demande la génération de playlists
Rekordbox via XML depuis les dossiers/tags de Sift. Le nav rail a déjà un item
"Export Rekordbox" mais c'est une simulation pure (`startExportSim`,
`frontend/sift-live.ts:344`) — aucun backend réel.

Deuxième besoin, découvert en discussion : Rekordbox **ne sait pas relocaliser
un fichier**, même manuellement, quand son chemin change. Si Sift renomme,
déplace ou reformate (conversion CDJ) un fichier déjà présent dans une
playlist Rekordbox existante, ce morceau **disparaît silencieusement** de
cette playlist côté Rekordbox tant que l'utilisateur ne corrige pas le lien à
la main. Sift a déjà toute l'info nécessaire pour éviter ça : chaque
filing/renommage/conversion est loggé dans `actions` avec `from_path`/
`to_path` (`src-tauri/src/actions.rs:53`).

## Pourquoi un seul mécanisme pour les deux besoins

Le format Rekordbox XML stocke chaque morceau **une seule fois** dans
`<COLLECTION>` avec un `TrackID` et son `Location`. Les `<PLAYLISTS>`
référencent les morceaux **uniquement par `TrackID`**, jamais par chemin.
Conséquence directe : mettre à jour le `Location` d'un `TrackID` corrige
automatiquement toutes les playlists qui le référencent, sans toucher à la
structure `<PLAYLISTS>` elle-même. Générer le XML et réparer un chemin cassé
sont donc la même opération de fond : "parser l'arbre XML lié → modifier une
entrée COLLECTION → réécrire l'arbre entier".

## Architecture

Nouveau module `src-tauri/src/rekordbox_xml.rs` :

- **Parse** : lit un fichier XML Rekordbox (format `DJ_PLAYLISTS`) en un arbre
  en mémoire (`COLLECTION` = `Vec<CollectionTrack>` avec `TrackID`/`Location`/
  champs metadata ; `PLAYLISTS` = arbre `Node` récursif dossier/playlist avec
  listes de `TrackID`). Construit en parallèle un index
  `HashMap<PathBuf normalisé, TrackID>` pour les lookups O(1).
- **Merge** : ajoute au `COLLECTION` les morceaux Sift `status='filed'` absents
  (par chemin), crée/complète les `PLAYLISTS` par dossier (un dossier Sift →
  une playlist, hiérarchie de sous-dossiers → hiérarchie de nodes) sans
  toucher aux playlists déjà existantes non gérées par Sift.
- **Patch path** : étant donné un `from_path`/`to_path`, si `from_path` est
  dans l'index, met à jour le `Location` du `TrackID` correspondant. Ne touche
  à rien d'autre dans l'arbre.
- **Write** : sérialise l'arbre complet vers un fichier XML (format identique
  à ce que Rekordbox produit/attend en import).

Aucune dépendance externe nouvelle : parsing XML via une crate déjà légère
(à choisir en implémentation — `quick-xml` est le candidat naturel, pas encore
en deps Sift, vérifier via Context7 avant d'ajouter).

## Persistance

Nouveau réglage persisté (dans `settings.rs`, même mécanisme que la racine de
bibliothèque) : `rekordbox_xml_path : Option<PathBuf>` — le fichier XML "lié".
Pas de nouvelle table SQLite : l'arbre XML est ré-parsé en mémoire au
démarrage de l'app (et à la demande via un bouton "rafraîchir") plutôt que
projeté dans SQLite — le XML lui-même reste la source de vérité, Sift ne fait
que le lire/patcher/réécrire.

## Flux

1. **Lier un XML** : l'utilisateur choisit un fichier XML déjà exporté depuis
   Rekordbox (`Fichier > Exporter la collection en XML`) via un dialogue natif.
   Sift le parse, retient le chemin en réglage persisté. Si aucun XML n'existe
   encore côté Rekordbox, l'utilisateur peut aussi choisir un chemin cible
   vide — Sift part alors d'un arbre neuf.
2. **Export** (`export_rekordbox_xml` IPC) : recharge l'arbre depuis le XML
   lié, fusionne les morceaux filed manquants, réécrit le fichier. Remplace la
   simulation de `sift-live.ts`.
3. **Réparation automatique** : après chaque action de filing/renommage/
   conversion (hook dans `actions::record_with_meta`), si `from_path` est dans
   l'index chargé, patch + réécriture immédiate du XML lié, puis toast (même
   famille que le journal existant) : *"N morceaux dans tes playlists
   Rekordbox mis à jour — réimporte le XML dans Rekordbox pour resynchroniser."*
4. **UI** : une carte dans l'écran Bibliothèque (même famille que les
   dashboard stat cards du Lot 4) affichant : chemin XML lié, nombre de
   playlists importées, date de dernière resync, bouton "changer de XML lié".

## Gestion d'erreurs (fail-fast, cohérent avec le reste de Sift)

Si le XML lié est introuvable/corrompu à la relecture : la carte passe en
état d'erreur explicite ("XML Rekordbox illisible — relie un fichier"), et
**aucune réécriture automatique n'est tentée** tant que l'utilisateur n'a pas
relié un fichier valide. Pas de recréation silencieuse d'un arbre vide qui
écraserait la référence perdue — mieux vaut bloquer que risquer de perdre des
playlists non gérées par Sift.

## Hors scope (explicite)

- Pas de copie automatique vers une clé USB (Rekordbox s'en charge lui-même
  une fois le XML réimporté — confirmé avec l'utilisateur).
- Pas de lecture/écriture directe de `master.db` (voir spec séparée
  `2026-07-03-rekordbox-masterdb-sqlcipher-reader-design.md` — chantier
  distinct, lecture seule, pourra remplacer l'étape d'import XML plus tard
  sans changer ce module : il attend juste un index `chemin → TrackID`, peu
  importe sa source).
- Pas de création/édition de playlists depuis Sift au-delà de l'auto-génération
  par dossier.

## Tests

- Unitaires : parse d'un XML de fixture → index correct ; patch d'un
  `Location` → seul ce champ change, reste de l'arbre byte-identique après
  réécriture ; merge n'écrase jamais une playlist non gérée par Sift.
- Fixture : petit XML Rekordbox synthétique (pas de données réelles),
  construit à la main pour couvrir dossiers imbriqués + un TrackID présent
  dans plusieurs playlists.
