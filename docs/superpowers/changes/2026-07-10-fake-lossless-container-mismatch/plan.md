# Détection fake lossless par mismatch conteneur — Implementation Plan

Contexte / bug trouvé (2026-07-10, audit du moteur d'analyse) : `analyze()`
(`src-tauri/src/analysis/mod.rs:144`) calcule le verdict avec
`tag.declared_rail`, qui vient de `tags::rail_from_ext()` — l'extension du
fichier, jamais son contenu réel. Il existe pourtant déjà
`tags::rail_from_content()` (sniffing des magic bytes via lofty), testée et
dédiée à exactement ce scénario
(`rail_from_content_sees_through_a_renamed_mp3`, doc-commentée "BUG-1") —
mais câblée uniquement en garde-fou anti-upscale dans `filing.rs:377`, jamais
dans le pipeline d'analyse/verdict.

Conséquence concrète : un MP3 320kbps honnête renommé `.flac` a un cutoff
mesuré ~20-20.5kHz (voir `verdict.rs::honest_mp3_matching_its_bitrate_is_ok`).
Comme `LOSSLESS_OK_HZ = 20000.0`, ce fichier passe `verdict()` avec
`declared_rail = Lossless` (extension) et obtient `Ok` — un vrai lossless
authentique — au lieu de `Fake`. Faux négatif exactement sur le cas d'usage
que l'app annonce détecter, limité aux sources lossy à cutoff élevé
(~256-320 kbps) ; les MP3 basse qualité renommés restent bien attrapés
(cutoff sous `LOSSY_CLIFF_HZ` quel que soit le rail utilisé pour
l'interpréter).

## Goal

Ajouter un second signal, déterministe et indépendant du cutoff : si
l'extension déclare Lossless mais que le conteneur réel (magic bytes) est
Lossy, c'est une fraude certaine — pas la peine d'attendre que le cutoff
tombe dans la bonne fourchette. Combiner ce signal avec la logique cutoff
existante (qui reste nécessaire pour l'autre fraude : vrai conteneur FLAC
mais contenu transcodé-vers-le-haut depuis une source lossy).

## Architecture

Deux couches de détection combinées dans `verdict()` :

1. Mismatch conteneur (nouveau) — `declared_rail` (extension) == `Lossless`
   ET `content_rail` (magic bytes) == `Lossy` → `Fake` immédiat, sans
   regarder le cutoff.
2. Cliff spectral (existant, inchangé) — sinon, logique actuelle (cutoff vs
   seuils par rail/bitrate déclaré).

`rail_from_content()` fait un second passage `lofty::Probe` — ne l'appeler
que quand `declared_rail == Lossless` (le seul cas où le mismatch importe),
pas systématiquement, pour ne pas doubler le coût I/O sur tous les fichiers
lossy.

## Tech Stack

Rust seul, aucune nouvelle dépendance (`rail_from_content` existe déjà dans
`tags.rs`).

## Contraintes globales

- `declared_rail` (extension) reste tel quel pour l'affichage "Déclaré" en
  UI (`report-view.ts:557`) — c'est littéralement ce que le fichier prétend
  être, ne pas le remplacer par le rail de contenu partout, seulement
  l'utiliser en signal additionnel pour le verdict.
- Ne pas casser le cas "vrai FLAC transcodé depuis une source lossy" (la
  fraude principale déjà couverte) — `rail_from_content` dirait `Lossless`
  pour un vrai conteneur FLAC peu importe son contenu interne, donc ce cas
  continue de passer par la couche cutoff existante, inchangée.
- `REPORT_CACHE_VERSION` (`mod.rs:82`, valeur actuelle `3`) doit être
  incrémenté — les rapports en cache pour des fichiers déclenchant le
  nouveau chemin doivent être invalidés.
- `cargo test`/`cargo clippy` jamais en concurrence avec un `tauri dev` actif
  (mémoire `avoid-concurrent-cargo-tauri-dev`).
- Fixture de test : réutiliser le pattern déjà en place dans
  `tags.rs::rail_from_content_sees_through_a_renamed_mp3` (copie de
  `fixtures/real_320.mp3` renommée `.flac` dans un tempdir) plutôt que
  fabriquer un nouveau fixture.

## Task 1 : Signal de mismatch dans verdict()

Files: Modify `src-tauri/src/analysis/verdict.rs`

Interfaces: Modifie `pub fn verdict(cutoff_hz, declared, declared_bitrate) ->
Verdict` → nouvelle signature `pub fn verdict(cutoff_hz, declared,
declared_bitrate, content_rail: Rail) -> Verdict`. Tous les appels existants
(tests inclus) à mettre à jour.

Steps:

- [x] En tête de la branche `Rail::Lossless` : si `content_rail ==
  Rail::Lossy`, retourner `Verdict::Fake` immédiatement (avant la
  comparaison cutoff).
- [x] `Rail::Unknown` en `content_rail` (lecture échouée) ne doit jamais
  déclencher ce court-circuit — retomber sur la logique cutoff existante.
- [x] Mettre à jour tous les tests existants avec un `content_rail`
  cohérent (même valeur = pas de mismatch, comportement inchangé).
- [x] Nouveau test : `declared=Lossless, content_rail=Lossy, cutoff=20500.0`
  (le cas exact du bug) → `Fake`.
- [x] Nouveau test : `declared=Lossless, content_rail=Unknown,
  cutoff=21000.0` → `Ok` (pas de faux positif si le sniffing échoue).
- [x] Nouveau test : `declared=Lossy, content_rail=Lossy, ...` →
  comportement cutoff inchangé.
- [x] `cargo test -p sift verdict::` vert.

## Task 2 : Câbler rail_from_content dans analyze()

Files: Modify `src-tauri/src/analysis/mod.rs`

Steps:

- [x] Après `let tag = tags::read(path);`, calculer `content_rail`
  (uniquement si `tag.declared_rail == Rail::Lossless`, sinon
  `Rail::Unknown`).
- [x] Passer `content_rail` au nouvel appel `verdict::verdict(...)`.
- [x] Incrémenter `REPORT_CACHE_VERSION` (vérifier la valeur actuelle avant
  — `3` au moment d'écrire ce plan).
- [x] Test d'intégration : `analyze()` sur `fixtures/real_320.mp3` renommé
  `.flac` dans un tempdir → `report.verdict == Verdict::Fake`. Skip
  proprement si fixture absent.
- [x] `cargo test -p sift analysis::` vert, `cargo clippy` clean.

## Task 3 : Exposer la raison du verdict pour l'UI

Files: Modify `src-tauri/src/analysis/mod.rs` (struct `AnalysisReport`),
`frontend/report-view.ts`

Contexte : `spectroCaption()` (`report-view.ts:91-95`) affiche
inconditionnellement "coupure nette = transcodage probable" pour tout
verdict `Fake` — trompeur pour un mismatch conteneur où le cutoff peut être
proche de Nyquist.

Steps:

- [x] Ajouter `pub container_mismatch: bool` à `AnalysisReport`, calculé
  dans `analyze()`.
- [x] Mettre à jour le test `report_serializes_to_json`.
- [x] Côté front, lire `r.container_mismatch` et afficher un texte distinct
  (ex. "conteneur .flac mais contenu MP3 détecté — extension falsifiée")
  quand `verdict === "fake" && container_mismatch`.
- [x] `tsc` clean.

## Task 4 : Vérification manuelle + revue

- [x] `cargo test` complet + `cargo clippy` (hors `tauri dev` actif).
- [ ] `tauri dev` : copier un MP3 320kbps réel, le renommer `.flac`,
  l'ajouter à une source Sift, confirmer le verdict `Fake` + nouveau
  libellé, et que les fichiers normaux restent inchangés. **Non fait via
  l'app réelle cette session** — vérifié uniquement via `analyze()` direct
  (tests + appel manuel sur `fixtures/real_320.mp3` renommé, et sur le
  fichier de terrain `Sven Dohse - All In.mp3`). Reste à confirmer dans
  `tauri dev` avant merge définitif.
- [x] Revue finale (subagent-driven-development standard) avant merge.

## Hors scope (noté, pas traité ici)

- Zone morte de détection de cliff près de Nyquist (bande de garde ~570Hz à
  44.1kHz) — pas d'impact pratique avec les seuils actuels.
- LTAS moyenné sur tout le fichier — un morceau partiellement fake peut
  diluer son cliff. Limite inhérente à la méthode, pas un bug
  d'implémentation.
- Bitrate déclaré physiquement impossible pour le sample rate (rare en
  pratique) — pas traité ici.
