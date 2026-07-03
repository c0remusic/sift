# Lecteur SQLCipher pur Rust pour `master.db` Rekordbox (design)

> Chantier exploratoire, séparé de M7. Objectif : remplacer à terme l'import
> XML manuel (`2026-07-03-m7-rekordbox-xml-export-design.md`) par une lecture
> directe de la vraie bibliothèque Rekordbox — sans dépendance Python, sans
> toolchain OpenSSL natif (indisponible ici, tenté et abandonné pendant le
> spike : `bundled-sqlcipher-vendored-openssl` échoue à compiler OpenSSL avec
> le `perl` Git-Bash disponible). Lecture seule uniquement — l'écriture reste
> hors scope (M8, gelé).

## Ce qui est déjà validé (spike 2026-07-03, `docs/ressources-externes.md`
## Évaluation 5)

- `pyrekordbox` (Python) lit `master.db` correctement : 2828 tracks, 24
  playlists, chemins et appartenance track↔playlist corrects, testé sur une
  **copie** de la vraie bibliothèque de l'utilisateur (jamais le fichier live).
- La clé SQLCipher n'est **pas dérivée par device** — c'est une constante
  statique obfusquée dans le code source public de `pyrekordbox`
  (`base85 → XOR → zlib`), déjà reproduite et validée en Rust pendant le
  spike (aucune dépendance crypto lourde, juste `flate2` + un décodeur base85
  maison reproduisant l'alphabet `b85` de CPython).
- Le blocage rencontré est uniquement la **liaison** SQLCipher (nécessite un
  SDK OpenSSL Windows complet, absent, et la compilation vendored échoue) —
  pas la faisabilité de la lecture elle-même.

## Décision d'architecture : ne pas réimplémenter le format SQLite

Plutôt que d'écrire un parseur B-tree/page SQLite maison (risqué, gros), le
lecteur ne fait qu'une chose : **déchiffrer chaque page SQLCipher en clair**,
puis reconstituer un buffer SQLite **standard non chiffré** et le confier à
`rusqlite` déjà en dépendance (mode `bundled` classique, sans cipher, aucune
dépendance OpenSSL). Le reste (parsing B-tree, requêtes SQL sur
`djmdContent`/`djmdPlaylist`/`djmdSongPlaylist`) est alors le SQLite standard,
déjà éprouvé dans Sift.

Le buffer déchiffré est chargé **en mémoire uniquement**, via l'API SQLite
`sqlite3_deserialize` (exposée par `rusqlite` sous la feature `serialize`) —
**jamais écrit en clair sur disque**, pour ne pas laisser traîner une copie
déchiffrée de la bibliothèque personnelle de l'utilisateur dans un fichier
temporaire.

## Algorithme de déchiffrement (SQLCipher v4, à valider empiriquement)

1. Lire les 16 premiers octets du fichier = salt.
2. Dériver la clé de chiffrement : PBKDF2-HMAC-SHA512(passphrase déobfusquée,
   salt, itérations — valeur par défaut SQLCipher 4 à confirmer empiriquement,
   probablement 256 000, **ne pas supposer** : valider en vérifiant que la
   page 1 déchiffrée démarre par le magic SQLite `"SQLite format 3\0"`).
3. Dériver la clé HMAC séparément : même PBKDF2 mais avec un salt dérivé
   (salt original XORé avec `0x3a` répété), itérations réduites (2 par
   défaut dans SQLCipher — à confirmer aussi).
4. Pour chaque page : vérifier le HMAC stocké dans la zone réservée en fin de
   page, puis déchiffrer en AES-256-CBC avec l'IV stocké dans cette même zone
   réservée. Taille de réserve à calculer (IV 16 + HMAC-SHA512 tronqué,
   arrondi au multiple du bloc AES).
5. Cas spécial page 1 : les 16 premiers octets du fichier (le salt) occupent
   le début de la page 1 sur disque — le contenu réellement chiffré de la
   page 1 ne fait que `page_size - 16` octets.
6. Assembler toutes les pages déchiffrées dans l'ordre → buffer SQLite
   valide → `Connection::deserialize` (lecture seule).

**Crates candidates (toutes pur Rust, zéro compilation C/OpenSSL)** :
`pbkdf2`, `hmac`, `sha2`, `aes`, `cbc` — familles RustCrypto, déjà l'usage
attendu pour ce genre de crypto pure-Rust sans toolchain natif. À valider via
Context7 avant d'ajouter (versions, API exacte) — ne pas deviner les
signatures.

## Vérification de correction (le point critique)

Un bug de déchiffrement silencieux est pire qu'un crash : il peut donner de
la métadonnée plausible mais fausse. Stratégie de validation :

- **Fixture synthétique**, pas la vraie bibliothèque de l'utilisateur : un
  petit `master.db` chiffré généré une fois via `sqlcipher3`/`pyrekordbox`
  avec quelques morceaux et playlists factices, committé dans
  `src-tauri/tests/fixtures/` — aucune donnée personnelle dans le repo.
- Test de non-régression : décrypter cette fixture avec le lecteur Rust,
  comparer le résultat (tracks/playlists/chemins) à la sortie de référence
  déjà produite par `pyrekordbox` sur la même fixture (oracle).
- Avant tout usage sur la vraie bibliothèque : validation manuelle sur la
  copie déjà utilisée dans le spike (`~/Desktop/sift-rekordbox-probe/`, hors
  repo), comparaison des comptes (2828 tracks / 24 playlists) et d'un
  échantillon de chemins.

## Intégration avec le reste de Sift

Ce module expose uniquement une fonction de lecture :
`read_rekordbox_masterdb(path) -> Result<RekordboxIndex, MasterDbError>`, où
`RekordboxIndex` est la même forme que l'index `chemin → TrackID` déjà défini
dans `2026-07-03-m7-rekordbox-xml-export-design.md`. Le module XML n'a pas à
changer : il consomme cet index quel que soit sa source (XML importé ou
lecture native). Bascule prévue **après** validation complète de ce lecteur,
pas en même temps que M7 — livré comme option alternative à l'import XML, pas
un remplacement forcé.

## Hors scope (explicite)

- Aucune écriture dans `master.db` (M8, gelé — nécessite backup/restore
  validés sur de vraies bibliothèques avant toute discussion de design).
- Pas de gestion des versions de schéma Rekordbox antérieures à ce qui a été
  observé dans le spike (Rekordbox 6/7, format `djmdContent`/`djmdPlaylist`).

## Risques connus

- Les paramètres KDF (itérations, taille de page) sont des **hypothèses à
  valider empiriquement**, pas des certitudes — si Pioneer a changé la config
  SQLCipher par défaut à un moment, le déchiffrement échouera silencieusement
  sur du HMAC invalide (détectable : vérifier le HMAC avant de faire confiance
  au contenu déchiffré, ne jamais retourner des données si la vérification
  HMAC échoue — fail-fast, pas de fallback).
- Reverse engineering non officiel — un changement de version Rekordbox peut
  casser ce lecteur sans préavis (même risque déjà documenté pour M8).
