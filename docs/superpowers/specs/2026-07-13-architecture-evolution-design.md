# Évolution architecturale de Sift — design

> Worktree `dj-assistant-m6a`, branche `m6a-discogs`. Diagnostic fait au commit
> `30e06ff`. Objectif : corriger progressivement les faiblesses architecturales
> confirmées sans réécriture massive, en restant un monolithe modulaire desktop
> Tauri adapté à un développeur unique.

## 1. Diagnostic confirmé (preuves file:line)

| # | Affirmation | Verdict | Preuve |
|---|---|---|---|
| 1 | `frontend/sift-live.ts` orchestrateur très large | **Confirmé** — 2083 lignes (`wc -l`) |
| 2 | Contrats IPC Rust/TS maintenus manuellement dans `shared/contracts.ts` | **Confirmé** — ~30 `interface`/`type` mirrorés à la main, zéro génération. `FILE_IN_PLACE` dupliqué [contracts.ts:7](../../../shared/contracts.ts) / [filing.rs:20](../../../src-tauri/src/filing.rs), seule garde = commentaire, aucun test round-trip. |
| 3 | `list_library`/`list_queue` renvoient potentiellement toutes les lignes | **Confirmé** — [ipc_library.rs:13](../../../src-tauri/src/ipc_library.rs) → `library::list_filed` sans `LIMIT` ([library.rs:223](../../../src-tauri/src/library.rs) `ORDER BY` seul) ; [ipc.rs:113](../../../src-tauri/src/ipc.rs) → `queue::list_pending` idem. |
| 4 | Dédup globale comporte un chemin O(n²) | **Confirmé, atténué par un pré-filtre** — [dedup.rs:144-168](../../../src-tauri/src/dedup.rs) double boucle sur toutes les pistes `filed` ; le pré-filtre durée court-circuite le calcul de similarité coûteux mais le nombre d'itérations reste O(n²). |
| 5 | `report_json` garde rapport + spectrogramme en JSON | **Confirmé** — [db.rs:91](../../../src-tauri/src/db.rs) colonne `TEXT` classique, spectrogramme inclus dedans ([worker.rs:228](../../../src-tauri/src/worker.rs)). |
| 6 | Pool d'analyse et encodeurs FFmpeg ne partagent pas de budget | **Confirmé** — analyse : [worker.rs:116-119](../../../src-tauri/src/worker.rs) `available_parallelism().clamp(1,8)` ; encode : [ipc_filing.rs:345-350](../../../src-tauri/src/ipc_filing.rs) `(cores/2).max(1).min(4)`. Calculés indépendamment, aucun sémaphore/budget partagé. |
| 7 | Connexion SQLite partagée peut créer de la contention malgré WAL/busy_timeout | **Confirmé, partiellement déjà traité** — [db.rs:223](../../../src-tauri/src/db.rs) WAL + `busy_timeout=5000` déjà en place. Une deuxième connexion dédiée existe déjà pour le scan seul ([ipc.rs:356-372](../../../src-tauri/src/ipc.rs), suite à un incident documenté). Le reste (bibliothèque, filing, actions, worker) partage toujours un seul `Mutex<Connection>`. |

### Déjà bien conçu (à ne pas re-régler)

- Pool d'encodage batch déjà borné avec annulation propre (`cancel_flag`,
  [ipc_filing.rs](../../../src-tauri/src/ipc_filing.rs)), pas un spawn naïf par fichier.
- Dédup a déjà un pré-filtre durée avant le calcul d'empreinte coûteux.
- Virtualisation frontend déjà en place ([list-virtual.ts](../../../frontend/list-virtual.ts),
  [library-views.ts](../../../frontend/library-views.ts)) — le problème de volume
  est côté transfert IPC/SQL, pas côté rendu DOM.
- Contention SQLite déjà diagnostiquée et corrigée une fois pour le cas le
  plus grave (scan complet).
- `master.db` Rekordbox a une chaîne de sûreté (backup → transaction → vérif
  round-trip → rollback) largement au-dessus du reste du code — hors scope
  de ce chantier, pas un point faible à traiter.

## 2. Stratégie retenue

**B — suivre l'ordre des 5 phases, façades progressives.** Phase 1 extrait
`sift-live.ts` en contrôleurs par petites extractions comportement-préservantes.
Phase 2 durcit les contrats IPC par des tests, pas par une génération de code
(le volume ~30 types ne justifie pas une chaîne de génération fragile). Les
phases 3 à 5 sont **conditionnelles aux mesures** — aucun changement de perf
sans benchmark préalable. Le regroupement logique Rust en modules de façade
(`ingest`/`analysis`/`catalog`/`filing`/`rekordbox`/`platform`/`app`) n'est
entrepris qu'en fin de chantier, et seulement si l'expérience de la Phase 1
côté frontend en démontre la valeur.

**Alternatives écartées** :
- **A — correctifs ponctuels indépendants**, sans toucher à la structure :
  coût le plus bas, mais ne construit aucune frontière durable ;
  `sift-live.ts` continuerait de grossir à la prochaine feature.
- **C — mesurer d'abord, tout le reste après** : bloquerait la Phase 1 (la
  plus visible, la moins risquée) derrière un travail d'instrumentation qui
  ne la concerne pas ; le fichier de 2083 lignes est déjà une preuve
  suffisante pour agir sans benchmark.

## 3. Architecture cible (direction, pas obligation immédiate)

Monolithe modulaire, frontières fonctionnelles renforcées progressivement,
via façades cohérentes et information hiding — pas de déplacement massif de
fichiers tant qu'une frontière ne réduit pas un couplage réel ou ne cache pas
une complexité réelle.

**Backend Rust** (regroupement logique cible, via `mod.rs` de façade
lorsque justifié — pas un workspace multi-crates) :
- `ingest` : scanner, watcher, sources, queue
- `analysis` : décodage, DSP, worker, cache
- `catalog` : bibliothèque, metadata, déduplication
- `filing` : naming, tagging, encodage, actions, undo
- `rekordbox` : XML, master.db et réparations
- `platform` : SQLite, FFmpeg, USB et réglages
- `app` : initialisation Tauri, commandes et orchestration

**Frontend** : `review`, `batch`, `library`, `rekordbox`, `settings`, plus un
installeur d'application mince pour la navigation et le câblage global.
Vanilla TS conservé — pas de React/Vue/Redux/bus d'événements générique.

## 4. Phase 1 — Réduire `sift-live.ts`

**Objectif** : orchestrateur mince, zéro changement fonctionnel.

**Extractions candidates** (à confirmer par lecture détaillée du fichier au
démarrage de la phase, pas figées à l'avance) :
- contrôleur de la file et de la sélection Revue
- contrôleur du mode lot
- routage des actions Rekordbox
- gestion de la progression
- installation des événements globaux

**Contraintes** :
- Vite vanilla TS conservé.
- Identifiants DOM et contrats Tauri existants préservés à l'identique.
- Pas d'état global dupliqué (un seul point de vérité par donnée d'état).
- Écrire des tests de caractérisation ou identifier des seams avant toute
  extraction jugée risquée (suivant `working-with-legacy-code`).
- Extractions petites, une responsabilité à la fois, chacune validée
  indépendamment (`npx tsc --noEmit` + vérification manuelle `tauri dev` du
  parcours touché) avant l'extraction suivante.

**Critère d'acceptation mesurable** : `sift-live.ts` réduit à un orchestrateur
qui délègue à des modules extraits, sans changement de comportement observable
(mêmes IDs DOM, mêmes événements, mêmes appels IPC) — vérifié parcours par
parcours dans `tauri dev` réel, pas seulement par `tsc`/`build`.

## 5. Phase 2 — Fiabiliser les contrats IPC

**Objectif** : empêcher la dérive silencieuse entre Rust et TypeScript sans
ajouter de chaîne de génération fragile pour ~30 types.

**Comparaison à faire en début de phase** (pas tranchée à l'avance) :
1. génération automatique des types (ex. depuis les structs Rust)
2. tests de round-trip ou snapshots de schéma
3. maintien manuel actuel + validation renforcée (tests qui échouent si un
   champ/constante diverge)

**Critères minimaux** :
- Détecter un champ renommé, ajouté ou supprimé.
- Détecter la divergence des constantes partagées comme `FILE_IN_PLACE`
  (déjà identifiée comme sans garde automatique).
- `frontend/ipc.ts` reste la façade unique des appels Tauri.

**Critère d'acceptation mesurable** : un test qui échoue de manière
déterministe si `FILE_IN_PLACE`/`EXTERNAL_DEST_PREFIX` ou un champ d'un type
IPC utilisé activement divergent entre Rust et TS.

## 6. Phase 3 — Pagination et volumes

**Objectif** : éviter le chargement complet de la bibliothèque et de la file
au-delà du volume V1, sans paginer côté frontend après avoir déjà tout
transféré.

**Mesures préalables obligatoires** (avant tout changement de code) :
- Latence SQL, sérialisation IPC et mémoire sur jeux synthétiques de 15 000
  puis 100 000 lignes.
- `EXPLAIN QUERY PLAN` sur `list_filed`/`list_pending` et leurs filtres.
- Effet réel de la virtualisation frontend existante (`list-virtual.ts`) à
  ces volumes.

**À préserver** : filtres, recherche, tri, facettes, sélection de lots,
navigation clavier, virtualisation existante.

**Critère d'acceptation mesurable** : latence de `list_library`/`list_queue`
à 100 000 lignes ramenée sous un seuil défini au moment des mesures (le
chiffre exact dépend du matériel de test, fixé dans le rapport de Phase 3,
pas ici) — comparée au chiffre mesuré sans pagination.

## 7. Phase 4 — Déduplication

**Objectif** : réduire le pire cas quadratique sans diminuer la qualité de
détection ; Chromaprint reste l'autorité finale quand elle est nécessaire.

**Mesures préalables obligatoires** :
- Benchmark reproductible (jeu de pistes synthétique, taille variable).
- Lecture DB, calcul d'empreinte et comparaisons mesurés séparément.
- Vérifier si `name_key` ([naming.rs:255](../../../src-tauri/src/naming.rs))
  est recalculée à chaque appel de `list_queue` (via `name_dups`,
  [ipc.rs:117](../../../src-tauri/src/ipc.rs)) plutôt que mise en cache.
- Identifier les groupes candidats possibles par durée, nom normalisé ou
  signature, comme préfiltre supplémentaire au préfiltre durée existant.
- Ne jamais supposer qu'un préfiltre garantit l'identité acoustique — la
  comparaison Chromaprint tranche toujours en dernier ressort.

**Critère d'acceptation mesurable** : nombre de paires réellement comparées
par `fingerprint::similarity` réduit à volume de bibliothèque égal, sans
changement du résultat de groupement sur le jeu de test existant.

## 8. Phase 5 — SQLite, cache et budget de ressources (conditionnelle)

Cette phase ne s'engage que si les mesures ci-dessous montrent un problème
réel — aucun pool de connexions, stockage BLOB séparé, compression ou
ordonnanceur global n'est introduit par anticipation.

**Mesures préalables obligatoires** :
- Temps d'attente du verrou SQLite et fréquence des `SQLITE_BUSY`.
- Latence des commandes IPC sous charge (scan + analyse + encodage
  simultanés).
- Taille moyenne et totale de `report_json`.
- Charge CPU/disque quand analyse et encodage tournent en même temps
  (vérification empirique du constat Phase 0 : pools non coordonnés).

**Comparaison à faire si les mesures justifient un changement** :
- connexion partagée actuelle + requêtes plus courtes
- connexions dédiées par workload (même pattern que le scan,
  [ipc.rs:365](../../../src-tauri/src/ipc.rs))
- pool borné
- pause/réduction du pool d'analyse pendant un encodage actif
- spectrogramme séparé ou chargé à la demande plutôt qu'inclus dans
  `report_json`

**Critère d'acceptation mesurable** : si la phase s'engage, réduction
mesurée du temps d'attente de verrou ou de la fréquence `SQLITE_BUSY` sous
la même charge de test qu'en mesure initiale. Si les mesures ne montrent pas
de problème réel, la phase se clôt sans changement de code, ce qui est un
résultat valide.

## 9. Validation obligatoire (toutes phases)

Après chaque tranche cohérente :

**Frontend** :
- `npx tsc --noEmit`
- `npm run build`

**Rust** :
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

**Si l'interface change** :
- Lancer l'application réelle Tauri, tester le parcours concerné.
- Vérifier événements, raccourcis clavier, sélection, progression, erreurs.
- La démo web (`preview_*`) n'est jamais une validation suffisante des
  appels IPC — seuls les blocs hors `if (inTauri)` y sont exercés (règle
  déjà actée dans `CLAUDE.md`, section Vérification UI).

Aucune commande Cargo/Tauri concurrente ; jamais de test contre un vrai
`master.db` Rekordbox.

## 10. Rapport de fin de phase (gabarit)

À la fin de chaque phase :
1. Fichiers modifiés.
2. Comportement préservé ou changé.
3. Décisions architecturales prises pendant la phase.
4. Mesures avant/après (Phases 3-5 uniquement).
5. Tests réellement exécutés, avec résultat cité (pas "devrait passer").
6. Risques ou limites restants.
7. Diff synthétique.
8. Recommandation pour la phase suivante.

Arrêt après chaque rapport, attente d'autorisation avant de continuer.

## 11. Frontières de phase et rollback

Chaque phase est un ensemble de commits distincts sur la branche
`m6a-discogs`, jamais mélangés avec une autre phase. Si une phase doit être
annulée :
- Phase 1 (extractions TS) : `git revert` des commits d'extraction concernés
  — chaque extraction étant comportement-préservante et testée isolément,
  un revert ne touche aucune autre phase.
- Phase 2 (tests de contrat) : suppression des tests ajoutés, aucun risque
  sur le comportement runtime puisque la phase n'ajoute que de la
  vérification, pas de nouveau chemin de code.
- Phases 3-5 (conditionnelles) : chaque changement de requête/pool/schéma
  est un commit séparé, revert direct possible ; toute migration de schéma
  SQLite (si Phase 5 en introduit une) suit la même discipline que les
  migrations `PRAGMA user_version` déjà en place dans `db.rs`, jamais
  destructive sans étape intermédiaire.

Aucune phase ne modifie le comportement produit visible par l'utilisateur —
un rollback ne doit donc jamais nécessiter de communication utilisateur ni
de migration de données irréversible.

## 12. Risques résiduels connus à l'issue de ce design

- Le périmètre exact des extractions de Phase 1 n'est confirmé qu'à la
  lecture détaillée du fichier en début de phase — la liste de la section 4
  est une hypothèse de travail, pas un contrat figé.
- Les critères numériques des Phases 3 et 5 dépendent de mesures qui
  n'existent pas encore ; ce design fixe la méthode de mesure, pas un
  chiffre cible arbitraire.
- La Phase 5 peut se conclure "rien à faire" si les mesures ne montrent pas
  de contention réelle — c'est un résultat attendu et valide, pas un échec
  de la phase.

## 13. Critères de succès globaux

- `sift-live.ts` devient un orchestrateur compréhensible sans déplacer
  arbitrairement la complexité.
- Chaque domaine touché possède une interface plus simple que son
  implémentation.
- Les dépendances entre domaines touchés sont explicites.
- Les contrats IPC ne peuvent plus dériver silencieusement sur au moins
  `FILE_IN_PLACE`/`EXTERNAL_DEST_PREFIX` et les types activement modifiés
  pendant ce chantier.
- 15 000 morceaux restent fluides (mesuré, pas supposé).
- Les choix pour 100 000 morceaux reposent sur des benchmarks écrits dans
  les rapports de phase, pas sur une intuition.
- Invariants métier, undo et sécurité des fichiers préservés (vérifié par
  la suite de tests Rust existante + parcours manuel `tauri dev`).
- Aucun changement d'architecture futuriste introduit sans preuve.
- Tests, Clippy, TypeScript et build passent à la fin de chaque phase.
