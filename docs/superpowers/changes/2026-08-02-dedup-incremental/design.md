# Dédoublonnage — arrêter de tout recalculer pour une piste rangée

**Ouvert** : 2026-08-02 · Phase 4 du chantier d'évolution architecturale · **design, non implémenté**

## Ce que la mesure dit

Benchmark : `src-tauri/src/bench_dedup.rs`, lancé en `--release`, `--test-threads=1`.

**Coût unitaire de `fingerprint::similarity`** — indépendant de toute hypothèse sur la
bibliothèque :

| durée de piste | items | coût par paire |
| --- | --- | --- |
| 3 min | 1 453 | 47 µs |
| 6 min | 2 906 | 128 µs |
| 10 min | 4 844 | 326 µs |

Superlinéaire. `similarity` n'est pas la comparaison de bits que promet le doc-comment de
`fingerprint.rs:3` : elle appelle `match_fingerprints` (rusty-chromaprint 0.3.0), qui alloue
deux `Vec` de `len1+len2`, les trie, puis balaye un histogramme.

**Énumération et pré-filtre**, à 15 000 pistes :

- 112 492 500 paires énumérées, **123 ms** — la boucle `O(n²)` n'est pas le problème
- 928 135 paires survivent au pré-filtre de durée (0,825 %)
- 166 Mo d'empreintes tenues simultanément en RAM

**`group_duplicates` bout à bout**, modèle validé sur deux points (coût effectif
163 µs/survivante, allocation des groupes comprise) :

| n | prédit | mesuré |
| --- | --- | --- |
| 2 000 | 2,6 s | 2,79 s |
| 4 000 | 10,4 s | 10,45 s |
| 15 000 | **151 s** | — |

≈ **2 min 31 s à 15 000 pistes**, et c'est un plancher : la distribution de durées du corpus
est uniforme (`bench_dedup.rs::duration_for`, marquée provisoire) alors qu'une vraie
collection s'agglutine autour des formats de production, ce qui fait monter le taux de survie.

## Le vrai défaut n'est pas l'algorithme

Le comptage est mémoïsé (`library::duplicate_count_or_compute`), sur une signature —
`library.rs:109` :

```sql
SELECT COUNT(*), COALESCE(MAX(id), 0) FROM tracks WHERE status='filed'
```

**Ranger une seule piste change les deux champs.** Le cache tombe entièrement, et la visite
suivante de Bibliothèque rejoue le scan complet, dans `ipc_library::library_stats` — une
commande Tauri synchrone, la même forme qui bloquait toute l'interface pendant le formatage
USB (corrigé en `fc1e116`).

Or après avoir rangé une piste, le travail réellement nécessaire est de comparer cette piste
aux 14 999 autres : ~120 survivent au pré-filtre, soit **~20 ms**.

Le cas courant demande 20 ms et en coûte 151 000. Le facteur n'est pas dans la comparaison —
il est dans la granularité de l'invalidation. Le cache est en RAM, donc **chaque redémarrage
de l'app repaie aussi les 151 s** à la première visite du tableau de bord.

## La forme proposée : persister les arêtes, pas le comptage

Aujourd'hui on mémorise le *résultat agrégé* (un entier) sous une clé qui bouge tout le temps.
On propose de mémoriser le *résultat des comparaisons*, qui lui ne bouge que pour les pistes
touchées.

Deux tables, migration v19 (append-only — `db.rs::MIGRATIONS`, jamais de réordonnancement) :

- **`dup_edges(a_id, b_id, similarity)`** — une ligne par paire dont la similarité atteint
  `MATCH_THRESHOLD`. Petite : seules les paires qui matchent, pas les 928 135 candidates.
- **`dup_scanned(track_id)`** — les pistes déjà comparées à toutes les autres pistes de cette
  même table.

**Invariant** : toute paire de `dup_scanned` a été évaluée. Ajouter une piste X consiste à la
comparer à tout `dup_scanned`, insérer ses arêtes, puis l'ajouter à `dup_scanned` — l'invariant
se maintient par récurrence.

Ce que ça débloque, chacun pour une raison distincte :

- **Ajout d'une piste** : `O(n)` comparaisons candidates au lieu de `O(n²)`. ~20 ms.
- **Suppression d'une piste** : `DELETE FROM dup_edges WHERE a_id=? OR b_id=?` plus le retrait
  de `dup_scanned`. Exact, et immédiat. Un union-find en RAM ne sait *pas* défaire une fusion —
  c'est la raison pour laquelle un cache d'union-find aurait dû retomber sur un scan complet à
  chaque résolution de doublon, c'est-à-dire précisément quand l'écran sert à quelque chose.
- **Redémarrage** : plus rien à repayer, les arêtes sont en base.
- **Les groupes** se reconstruisent par union-find sur `dup_edges` seul, qui compte des
  centaines de lignes, pas des millions.

Le pré-filtre de durée passe du CPU au SQL : au lieu de charger les 166 Mo d'empreintes pour
n'en comparer que 0,8 %, la sélection des candidats se fait en `WHERE` et ne charge que ce
qu'elle va comparer.

## Points à trancher avant d'écrire

1. **Une piste ré-encodée sur place — vérifié, non bloquant.** `scanner.rs:92-99` : quand un
   chemin déjà connu revient avec une `size_bytes` ou une `mtime` différente, la ligne est
   remise à `status='pending'` **et** `fingerprint=NULL`. La piste quitte donc le jeu `filed`,
   ce que le schéma proposé traite comme une suppression — arêtes retirées, `dup_scanned`
   nettoyé — puis comme un ajout quand elle est rangée à nouveau. Rien de spécial à écrire.

   Réserve, qui n'est pas introduite par ce changement : ce chemin ne se déclenche que si le
   scanner repasse sur le fichier. Une piste rangée hors d'une source surveillée et modifiée
   en dehors de l'app garderait une empreinte périmée — c'est déjà vrai aujourd'hui.
2. **`db.rs:366`** assert `table_count == 11` — passera à 13, à mettre à jour dans le même geste.
3. **Les cinq appels à `invalidate_duplicate_count_cache`** (`actions.rs:906`, `ecartes.rs:69`,
   `:166`, `:213`, `filing.rs:851`) deviennent des retraits ciblés plutôt qu'une purge globale.
   Chacun est à relire pour savoir *quelle* piste il touche.

## Ce qui reste à Antoine

La clause SQL qui sélectionne les candidats d'une nouvelle piste **doit refléter exactement**
la condition de `dedup.rs:200-203`, y compris sa sémantique des NULL : le pré-filtre n'écarte
la paire que si les **deux** durées sont connues. Une durée inconnue laisse passer.

Se tromper là ne produit pas une erreur — ça produit un chemin incrémental qui trouve
silencieusement moins de doublons que le scan complet, sur les pistes dont la durée manque.

Emplacement prévu, dans `dedup.rs` :

```rust
/// Les pistes déjà comparées (`dup_scanned`) contre lesquelles `row` doit être évaluée.
///
/// Doit reproduire EXACTEMENT le pré-filtre de `group_duplicates` (`dedup.rs:200-203`) : une
/// paire n'est écartée que si les deux durées sont connues ET distantes de plus de
/// `DURATION_MATCH_TOL_SEC`. Toute divergence rend le chemin incrémental silencieusement
/// moins complet que le scan complet — aucune erreur levée, juste des doublons manquants.
pub(crate) fn load_dup_candidates(
    conn: &Connection,
    row: &DupScanRow,
) -> rusqlite::Result<Vec<DupScanRow>> {
    // TODO(Antoine) — la clause. Trois cas à couvrir :
    //   - `row.duration` connue, candidate connue  → garder si |a − b| <= 2.0
    //   - `row.duration` connue, candidate NULL    → ?
    //   - `row.duration` NULL                      → ?
    // Les deux derniers décident si l'incrémental est équivalent au scan complet.
}
```
