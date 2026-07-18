# Phase 2 — rapport de clôture (contrats IPC)

> Spec : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
> section 5. Plan : `docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md`.
> Commit : `114530d`.

## Résultat

12 tests de contrat ajoutés, inline dans les `mod tests` existants de 7
fichiers Rust déjà propriétaires des types concernés (`filing.rs`,
`queue.rs`, `library.rs`, `analysis/mod.rs`, `naming.rs`, `dedup.rs`,
`ipc_filing.rs`) :
- 2 tests de constantes partagées (`FILE_IN_PLACE`, `EXTERNAL_DEST_PREFIX`)
  — lisent le texte source de `shared/contracts.ts` via `include_str!` et
  vérifient que la valeur littérale Rust y apparaît.
- 10 tests de forme exhaustive (déstructuration sans `..`) — un champ
  ajouté/retiré/renommé côté Rust fait échouer la **compilation** du test,
  pas seulement son exécution.

Aucun codegen, aucune dépendance ajoutée, aucun changement de comportement
de production.

## Comportement préservé

N/A pour cette phase — que des tests ajoutés, zéro fichier de production
touché.

## Décisions architecturales

Contrainte technique découverte pendant la rédaction du plan (avant
dispatch) : `src-tauri/src/lib.rs` ne déclare `pub mod` que pour
`analysis` — tous les autres modules sont privés au crate. Un fichier de
test d'intégration séparé n'aurait pas pu y accéder ; les 12 tests vivent
donc en `#[cfg(test)] mod tests` inline dans chaque fichier propriétaire,
suivant la convention déjà majoritaire du codebase.

## Preuve du garde-fou

Faite par l'implémenteur pendant la Step 4 : renommage temporaire de
`QueueItem.id` en `id2` → `cargo test` échoue à la **compilation**
(`error[E0026]: struct 'queue::QueueItem' does not have a field named
'id'`), pas à l'exécution. Changement annulé avant le commit, état
revérifié propre.

## Tests exécutés

- `cargo test --manifest-path src-tauri/Cargo.toml` → 381 passed (372 suite
  lib, dont les 12 nouveaux + 360 pré-existants ; +9 characterization.rs),
  4 ignored, 0 failed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  → clean.
- Revue task-scopée (Sonnet) : approuvée, 0 finding Critical/Important, 1
  Minor cosmétique (commentaire de doc manquant sur un des 12 tests,
  n'affecte pas la garantie).

## Risques restants

- Couverture volontairement partielle : 10 types sur ~30 dans
  `shared/contracts.ts`. Si une dérive réelle survient sur un des ~20 types
  non couverts, étendre le même mécanisme à ce type précis plutôt que de
  reconsidérer l'approche.
- Le mécanisme protège contre une dérive côté Rust (champ ajouté/retiré/
  renommé) mais pas contre une dérive purement côté TS (quelqu'un modifie
  `shared/contracts.ts` sans toucher au Rust) — risque jugé plus faible en
  pratique (le Rust est la source de vérité du payload IPC réel) mais non
  nul.

## Diff synthétique

7 fichiers, +269 lignes, 0 suppression, 0 fichier de production modifié
(uniquement des `mod tests`).

## Recommandation

Phase 2 close ici. Phase 3 (pagination et volumes) est conditionnelle aux
mesures — commencer par générer des jeux de données synthétiques (15 000
puis 100 000 lignes) et mesurer `list_library`/`list_queue` avant tout
changement de code, comme l'exige la spec.
