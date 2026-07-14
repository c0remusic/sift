# Phase 3 — measurement report (list_filed / list_pending at volume)

Chantier : évolution architecturale Sift, Phase 3
(`docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`, section 6).
Mesure uniquement — aucun code de production modifié. Méthodologie et code :
`src-tauri/src/bench_volume.rs` (`#[cfg(test)]`, exécuté via
`cargo test --release --lib bench_volume_list_filed_and_list_pending -- --ignored --nocapture`).

**Aucune recommandation de pagination dans ce document.** Chiffres seuls.

## Finding critique — bug fonctionnel découvert pendant la conception du benchmark

> **Corrigé** (commit `50239e3`, le jour même) — voir Décision, section
> finale. La description ci-dessous documente l'état AU MOMENT de la
> mesure (avant fix), gardée telle quelle pour l'historique du diagnostic.

`library::list_filed` (`src-tauri/src/library.rs:191`) appelle
`genres::get_genres_batch` (`src-tauri/src/genres.rs:32`), qui construit une
seule requête `SELECT track_id, genre FROM track_genres WHERE track_id IN (?,?,...)`
avec **un paramètre lié par piste retournée** — aucun découpage en lots.

SQLite limite le nombre de paramètres liés par requête préparée
(`SQLITE_MAX_VARIABLE_NUMBER`). Mesuré directement sur ce build (bisection dans
`debug_print_sqlite_variable_limit`, `src-tauri/src/bench_volume.rs`) :

```
largest working variable count = 32766, fails at 32767
```

**Conséquence** : dès que le nombre de pistes retournées par `list_filed` (donc
par n'importe quel filtre incluant l'absence de filtre) dépasse 32 766, l'appel
échoue avec `too many SQL variables` — `list_filed` renvoie une `Err`, pas des
résultats lents. Reproduit directement (100 000 lignes, 50% filed = 50 000
pistes filed) :

```
=== Reproducing the SQLite bound-parameter crash (100k rows, 50% filed) ===
  CONFIRMED crash: list_filed(no filter) returned Err: too many SQL variables in
  SELECT track_id, genre FROM track_genres WHERE track_id IN (?,?,?,...50000 placeholders...)
```

Ce n'est PAS un problème de latence — c'est une panne fonctionnelle complète de
l'écran Bibliothèque une fois la bibliothèque filed assez grande (~33k+ pistes
filed, selon le filtre). Aucune régression de code de production n'a été faite
ici (mesure seule) ; ce finding est remonté pour lecture par le
contrôleur/Antoine.

**Conséquence sur la suite du benchmark** : pour obtenir des chiffres de
latence comparables aux deux volumes (15k et 100k) sans déclencher ce crash,
le run principal de mesure ci-dessous utilise une proportion filed/pending
**25%/75%** (documentée, pas les 50/50 initialement prévus) — à 100k lignes
cela donne 25 000 pistes filed, sous la limite de 32 766 avec une marge
suffisante. À 15k lignes, 25% donne 3 750 pistes filed.

## Jeu de données synthétique

- Pool ~500 artistes (25 prénoms × 20 noms de famille, combinés
  déterministiquement — pas 15k/100k valeurs uniques).
- Pool 30 genres électroniques réels (House, Techno, Disco, Drum and Bass...),
  1-3 genres par piste.
- Formats : 3/5 mp3 (bitrate 128/192/256/320 variés), 1/5 aiff, 1/5 flac,
  1/5 wav (bitrate lossless 1411) — pas un format unique.
- Verdict : ~80% ok, ~10% fake, ~10% grey.
- Statut : 25% filed / 75% pending pour le run principal (voir finding
  ci-dessus), interleaved (pas un split en bloc) pour répartir comme un vrai
  catalogue.
- 5 itérations par requête, min/median/max reportés (le premier appel peut
  inclure un coût de warm-up du cache de pages SQLite).
- Build **release** obligatoire (mesures en debug non représentatives).

## Latences — 15 000 lignes (3 750 filed / 11 250 pending)

| Requête | min | median | max |
|---|---|---|---|
| `list_filed` (sans filtre) | 17.94 ms | 18.57 ms | 18.74 ms |
| `list_filed` (q LIKE, pire cas) | 18.50 ms | 18.95 ms | 27.79 ms |
| `list_filed` (genre, sous-requête IN) | 3.82 ms | 4.03 ms | 5.15 ms |
| `list_pending` | 14.24 ms | 15.99 ms | 20.58 ms |

## Latences — 100 000 lignes (25 000 filed / 75 000 pending)

| Requête | min | median | max |
|---|---|---|---|
| `list_filed` (sans filtre) | 153.10 ms | 164.88 ms | 167.80 ms |
| `list_filed` (q LIKE, pire cas) | 166.47 ms | 175.65 ms | 179.25 ms |
| `list_filed` (genre, sous-requête IN) | 36.05 ms | 36.67 ms | 42.47 ms |
| `list_pending` | 90.03 ms | 97.03 ms | 99.31 ms |

Rappel : ces chiffres sont à 25 000/75 000 filed/pending (pas 50/50) pour
rester sous la limite SQLite ci-dessus — comparer les deux tableaux entre eux
est valide (même proportion aux deux volumes), mais une bibliothèque réelle à
50/50 crasherait avant même d'atteindre ces temps à 100k lignes filed.

## EXPLAIN QUERY PLAN

### `list_filed` (sans filtre)
```sql
SELECT t.id, t.path, t.format, t.bitrate, t.duration, t.verdict, t.folder, t.has_cover,
       m.artist, m.title, m.label, m.year, m.bpm, m.cover_path, m.discogs_release_id
FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id
WHERE t.status = 'filed' ORDER BY m.artist, m.title, t.path
```
```
SEARCH t USING INDEX idx_tracks_status_verdict (status=?)
SEARCH m USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```
`SEARCH` (pas `SCAN`) sur `t` — l'index composite `idx_tracks_status_verdict`
sert le filtre `status='filed'`. Mais le tri `ORDER BY m.artist, m.title, t.path`
force un **`TEMP B-TREE`** (tri en mémoire) — confirmé, comme attendu : aucun
index n'existe sur `metadata.artist`/`metadata.title`.

### `list_filed` (q LIKE)
```sql
... WHERE t.status = 'filed'
    AND (m.artist LIKE '%a%' OR m.title LIKE '%a%' OR t.path LIKE '%a%')
ORDER BY m.artist, m.title, t.path
```
```
SEARCH t USING INDEX idx_tracks_status_verdict (status=?)
SEARCH m USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```
Même plan que sans filtre — le filtre `status='filed'` reste indexé, le
`LIKE` avec wildcard en tête (`%a%`) n'est de toute façon jamais indexable par
SQLite (pas de préfixe fixe), donc il est simplement évalué en filtre
post-jointure sur chaque ligne déjà remontée par l'index status. Le
`TEMP B-TREE` de tri est identique.

### `list_filed` (genre, sous-requête IN)
```sql
... WHERE t.status = 'filed'
    AND t.id IN (SELECT track_id FROM track_genres WHERE genre = 'House')
ORDER BY m.artist, m.title, t.path
```
```
SEARCH t USING INDEX idx_tracks_status (status=? AND rowid=?)
LIST SUBQUERY 1
SCAN track_genres USING COVERING INDEX sqlite_autoindex_track_genres_1
SEARCH m USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```
La sous-requête fait un **`SCAN`** sur `track_genres` (via son index de
couverture, la clé primaire composite `(track_id, genre)` — donc un scan
d'index, pas de table, mais un scan complet de l'index tout de même puisque
le filtre `genre = 'House'` n'a pas de préfixe indexé dans cet ordre de
colonnes). `t` bascule sur `idx_tracks_status` (au lieu de
`idx_tracks_status_verdict`) une fois combiné à la liste de la sous-requête.
Tri toujours en `TEMP B-TREE`.

### `list_pending`
```sql
SELECT t.id, t.path, t.filename, t.source_id, t.verdict, t.real_quality, m.artist, m.title
FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id
WHERE t.status='pending' ORDER BY t.id
```
```
SEARCH t USING INDEX idx_tracks_status (status=?)
SEARCH m USING INTEGER PRIMARY KEY (rowid=?) LEFT-JOIN
```
Aucun `TEMP B-TREE` — le tri `ORDER BY t.id` suit l'ordre naturel de la clé
primaire (rowid), donc pas de tri séparé nécessaire. C'est la seule des 4
requêtes sans coût de tri additionnel.

## Sérialisation JSON (proxy coût IPC)

Sur le résultat complet de `list_filed` (sans filtre) à 100k lignes/25 000
filed :

```
rows returned: 25000
serialized size: 7 702 719 bytes (7.35 MB)
serialization time: 17.27 ms
```

**Ceci n'est PAS une mesure du round-trip IPC réel.** C'est uniquement le coût
`serde_json::to_string` — Tauri sérialise le retour de commande de la même
façon en interne, donc c'est un proxy raisonnable du coût CPU de
sérialisation, mais ça ne couvre pas : la copie mémoire/transport IPC vers le
WebView2, la désérialisation côté JS, ni le rendu DOM qui suit. Extrapolation
grossière à 50 000 filed (proportion 50/50 réaliste, si le bug ci-dessus était
contourné) : ~15.4 MB, ~35 ms de sérialisation seule — mais cette
extrapolation n'a pas été mesurée directement.

## Ce qui n'a PAS été mesuré, et pourquoi

- **Round-trip IPC réel** (commande Tauri → WebView2 → JS → rendu écran
  Bibliothèque) : nécessite `tauri dev` en marche avec une vraie fenêtre
  WebView2, hors de portée d'un benchmark automatisé `cargo test`. Voir
  CLAUDE.md § "Vérification UI — app réelle, pas la maquette navigateur".
- **Effet de la virtualisation frontend** (`list-virtual.ts`) sur le temps de
  rendu réel à 25k/100k lignes affichées : même limite, nécessite l'app réelle.
- **Latence à 50/50 filed/pending réaliste au-delà de ~33k filed** : impossible
  à mesurer, `list_filed` renvoie une erreur avant tout calcul de latence (voir
  finding critique ci-dessus).
- **Effet d'un vrai disque/OS différent** : mesuré sur un seul poste
  (Windows, fichier temp SQLite sur disque local), pas de variation
  matérielle testée.
- **Coût de `ANALYZE`/statistiques SQLite à jour** : aucun `ANALYZE` n'a été
  lancé sur les jeux de données synthétiques ; `EXPLAIN QUERY PLAN` reflète les
  heuristiques par défaut de SQLite sans statistiques de distribution réelles.

## Nettoyage

Les deux bases SQLite temporaires (15k, 100k) et la base 100k/50% de
reproduction du crash sont créées via `tempfile::NamedTempFile` dans le
dossier temp système de l'OS et supprimées automatiquement à la fin de chaque
bloc (`Drop`) — aucun fichier n'a été laissé dans le repo ni sur le disque
après exécution.
