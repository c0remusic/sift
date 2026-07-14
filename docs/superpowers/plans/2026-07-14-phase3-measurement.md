# Phase 3 — mesures préalables (pagination et volumes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesurer la latence réelle de `list_filed`/`list_pending` à 15 000
et 100 000 lignes AVANT tout changement de code — la spec l'exige
explicitement (section 6, "Mesurer... avant de modifier"). Aucun code de
pagination n'est écrit dans ce plan ; la décision (paginer ou non, par
curseur ou non) se prend APRÈS lecture des chiffres, dans un plan séparé.

**Ce qui est mesurable automatiquement vs pas** : latence SQL et taille de
sérialisation JSON (proxy du coût IPC) sont mesurables par un benchmark
Rust autonome. La latence IPC réelle (Tauri round-trip) et l'effet de la
virtualisation frontend existante nécessitent une vraie app `tauri dev` en
marche — **hors de portée d'un agent automatisé**, à mesurer manuellement
par Antoine si les chiffres SQL/sérialisation s'avèrent déjà limites.
Documenté comme limite, pas caché.

## Global Constraints

- Aucun changement de code de production dans ce plan — uniquement un
  benchmark, exécuté puis ses résultats consignés.
- Jamais deux commandes Cargo concurrentes.
- Le benchmark n'écrit que dans un fichier SQLite temporaire, jamais dans
  `sift.db` réel.
- Commit uniquement après autorisation explicite.
- Spec source : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
  section 6 (Phase 3).

---

### Task 1: Écrire et exécuter le benchmark

**Contrainte technique (même famille que Phase 2)** : `db`, `library`,
`queue` sont des modules **privés** au crate `sift_lib` (seul `analysis`
est `pub mod` dans `lib.rs`). Un test d'intégration externe
(`src-tauri/tests/*.rs`) ne pourrait pas les atteindre. Solution : un
nouveau fichier interne au crate, déclaré `#[cfg(test)] mod bench_volume;`
dans `lib.rs` (compilé UNIQUEMENT en contexte test, jamais dans le binaire
de production — une ligne ajoutée à `lib.rs`, aucun autre changement de
production).

**Files:**
- Create: `src-tauri/src/bench_volume.rs` — contient les fonctions de
  génération de données + les `#[test] #[ignore]` (exécutés à la demande
  via `cargo test --release -- --ignored --nocapture`, jamais dans la
  suite normale). Pas de `[[bench]]`/crate `criterion` — dépendance
  supplémentaire non justifiée pour une mesure ponctuelle. `tempfile`
  (déjà en dev-dependency, `Cargo.toml:55`) fournit le fichier SQLite
  temporaire.
- Modify: `src-tauri/src/lib.rs` — ajouter une ligne
  `#[cfg(test)] mod bench_volume;` (voir liste des `mod` existants,
  respecter l'ordre alphabétique déjà en place).
- Read only : `src-tauri/src/db.rs` (migrations, schéma), `src-tauri/src/library.rs`
  (`list_filed`), `src-tauri/src/queue.rs` (`list_pending`)

**Interfaces:**
- Produces : un binaire de benchmark exécutable manuellement (`cargo test`/
  `cargo run --example` selon l'option choisie), aucune API de production
  nouvelle.

- [ ] **Step 1: Générer un jeu de données synthétique réaliste**

Créer une connexion SQLite sur fichier temporaire (`tempfile` crate si déjà
en dépendance, sinon un chemin dans le dossier temp système — vérifier
`Cargo.toml` avant d'ajouter une dépendance), appliquer les migrations
réelles (`db::run_migrations` ou équivalent — localiser la fonction
exacte), puis insérer :
- 15 000 lignes `tracks` (status='filed' pour la moitié, 'pending' pour
  l'autre — proportion arbitraire mais documentée), avec `format`/`bitrate`/
  `duration`/`verdict` variés (pas tous identiques — un `format` unique
  fausserait le filtre qualité).
- `metadata` correspondante avec `artist`/`title` variés parmi un pool
  d'~500 noms d'artiste réalistes (pas 15 000 valeurs uniques — un
  catalogue réel a des artistes répétés, ce qui teste vraiment le tri/la
  recherche, pas un cas dégénéré).
- `track_genres` avec 1-3 genres par piste parmi un pool de ~30 genres.

Répéter à 100 000 lignes (jeu de données séparé, pas un ré-usage du jeu à
15k).

- [ ] **Step 2: Mesurer `list_filed` et `list_pending`**

Pour chaque volume (15k, 100k) :
- `list_filed` sans filtre (cas le plus favorable — juste `WHERE status='filed'`
  + tri).
- `list_filed` avec `f.q = Some("...")` (déclenche le `LIKE` sur 3 colonnes
  — cas le plus défavorable, aucun index dessus).
- `list_filed` avec `f.genre = Some("...")` (sous-requête `IN`).
- `list_pending` (cas simple, déjà indexé sur `status`).

Chronométrer avec `std::time::Instant`, plusieurs itérations (ex. 5) et
reporter min/median/max — pas une seule mesure (le premier appel peut
inclure un coût de warm-up du cache de pages SQLite).

- [ ] **Step 3: `EXPLAIN QUERY PLAN`**

Pour chacune des 4 requêtes de la Step 2 (base `list_filed`, `list_filed`
avec `LIKE`, `list_filed` avec genre, `list_pending`), exécuter
`EXPLAIN QUERY PLAN <requête>` via `conn.prepare("EXPLAIN QUERY PLAN " + sql)`
et imprimer le plan. Identifier tout `SCAN` (parcours complet) vs `SEARCH`
(utilise un index) — en particulier sur le tri `ORDER BY m.artist, m.title`
(aucun index existant sur `metadata.artist`/`metadata.title` à ce jour,
donc un `SCAN`/tri en mémoire est attendu — confirmer, pas supposer).

- [ ] **Step 4: Mesurer la taille de sérialisation (proxy du coût IPC)**

Pour le résultat complet de `list_filed` sans filtre à 100k lignes (le cas
le plus volumineux), sérialiser en JSON (`serde_json::to_string`) et
reporter la taille en octets + le temps de sérialisation. C'est un proxy
du coût de transfert IPC réel (Tauri sérialise le retour de commande de la
même façon), pas une mesure du round-trip IPC complet lui-même — le
documenter explicitement dans le rapport.

- [ ] **Step 5: Rédiger le rapport de mesures**

Fichier : `docs/superpowers/plans/2026-07-14-phase3-measurement-report.md`.
Contenu : tableau des latences (volume × requête × min/median/max),
résultat `EXPLAIN QUERY PLAN` par requête (SCAN vs SEARCH, quelle colonne),
taille + temps de sérialisation JSON à 100k, liste explicite de ce qui
N'A PAS été mesuré (IPC round-trip réel, effet virtualisation frontend) et
pourquoi (nécessite `tauri dev` en marche, hors de portée automatisée).
**Aucune recommandation de pagination dans ce rapport** — les chiffres
seuls, la décision vient après lecture par le contrôleur/Antoine.

- [ ] **Step 6: Nettoyer**

Supprimer les fichiers SQLite temporaires créés par le benchmark (15k et
100k) — ne pas les committer, ne pas les laisser traîner sur le disque.
Si le benchmark crée ses fichiers dans le dossier temp système
(recommandé), cette étape est automatique ; si un chemin dans le repo a
été utilisé par erreur, le signaler et corriger.

- [ ] **Step 7: Commit (après autorisation explicite)**

```bash
git add src-tauri/src/bench_volume.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-14-phase3-measurement-report.md
git commit -m "perf(bench): measure list_filed/list_pending latency at 15k/100k rows

Phase 3 (spec section 6) — measurement only, no production code changed.
See docs/superpowers/plans/2026-07-14-phase3-measurement-report.md for
results and docs/superpowers/plans/2026-07-14-phase3-measurement.md for
methodology."
```

---

### Task 2: Décision (après lecture du rapport)

**Ne pas exécuter avant que le rapport de la Task 1 soit lu par le
contrôleur/Antoine.** Sur la base des chiffres réels :
- Si les latences restent sous un seuil raisonnable (à juger au moment de
  la lecture, pas fixé à l'avance) même à 100k lignes → documenter "pas de
  pagination nécessaire au volume testé" et clore la Phase 3 sans code.
- Si une requête dépasse un seuil gênant → écrire un plan séparé de
  pagination (curseur si le tri le permet), scopé à la ou les requêtes
  concernées seulement, pas une réécriture générale.
