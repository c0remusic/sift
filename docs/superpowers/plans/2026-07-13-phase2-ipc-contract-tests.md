# Phase 2 — Fiabiliser les contrats IPC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empêcher la dérive silencieuse entre Rust et TypeScript sur les
contrats IPC les plus centraux, sans ajouter de chaîne de génération.

**Comparaison des 3 options (spec section 5), tranchée ici :**

1. **Génération automatique** (ex. `ts-rs`/`specta`) — écartée : nouvelle
   dépendance Cargo, derive macros sur ~30 structs à travers plusieurs
   fichiers, pipeline de build supplémentaire qui doit tourner à chaque
   changement sous peine de sortie périmée silencieuse. Coût
   disproportionné pour ce volume de types.
2. **Tests de round-trip/snapshot côté TS** — écartée : aucun runner de
   tests frontend n'existe sur Sift (`package.json` : pas de vitest/jest,
   confirmé Phase 1). Un vrai round-trip nécessiterait soit d'installer un
   runner + lancer l'app Tauri (test d'intégration lourd), soit des types
   TS qui n'existent plus à l'exécution (effacés à la compilation) — ne
   permet pas un test unitaire léger.
3. **Maintien manuel + validation renforcée côté Rust (retenue)** — la
   suite Rust existe déjà (369 tests). Deux techniques, zéro dépendance
   nouvelle :
   - **Constantes partagées** (`FILE_IN_PLACE`, `EXTERNAL_DEST_PREFIX`) :
     un test Rust lit le texte source de `shared/contracts.ts`
     (`include_str!`) et vérifie que la valeur littérale Rust y apparaît
     bien telle quelle. Détecte toute divergence immédiatement.
   - **Formes de structs** : une fonction de test par type partagé qui
     déstructure une instance **sans `..`** (déstructuration exhaustive).
     Ajouter un champ au struct Rust sans mettre à jour cette
     déstructuration **ne compile plus** — le compilateur force la main du
     développeur à toucher ce fichier (donc à se souvenir de vérifier
     `shared/contracts.ts`) avant même de lancer les tests. Retirer/renommer
     un champ casse la compilation de la même façon.

Cette 3ᵉ option est retenue : coût le plus bas, garantie la plus forte
(erreur de compilation, pas seulement un test qui peut être ignoré), zéro
nouvelle dépendance.

**Périmètre** : pas les ~30 types de `shared/contracts.ts` en entier
(disproportionné — "ne pas ajouter... si quelques tests suffisent") mais un
sous-ensemble représentatif des types les plus centraux/actifs :
`QueueItem`, `LibraryTrack`, `AnalysisReport`, `Spectrogram`, `BatchResult`,
`FileProgress`, `Canonical`, `DupGroup`, `DupGroupMember`, `TrackRelease`,
plus les 2 constantes. Documenté comme un choix de portée, pas un oubli —
étendre à d'autres types plus tard si une dérive réelle survient sur l'un
des ~20 non couverts.

**Tech Stack :** Rust (`#[cfg(test)]`), aucune nouvelle dépendance Cargo.

## Global Constraints

- `frontend/ipc.ts` reste la façade unique des appels Tauri — aucun
  changement à ce fichier dans cette phase.
- Aucune régression sur les 369 tests existants.
- Jamais deux commandes Cargo/Tauri concurrentes.
- Commit uniquement après autorisation explicite.
- Spec source : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
  section 5.

---

### Task 1: Ajouter les tests de contrat IPC

**Contrainte technique découverte avant dispatch (à respecter)** :
`src-tauri/src/lib.rs` ne déclare `pub mod` que pour `analysis` — tous les
autres modules (`filing`, `queue`, `library`, `ipc`, `ipc_library`, etc.)
sont `mod` (privés au crate). Un fichier de test d'intégration séparé
(`src-tauri/tests/*.rs`, qui compile comme un crate externe lié à
`sift_lib`) **ne peut pas** accéder à leurs types/constantes privés — c'est
pourquoi `characterization.rs` n'importe que `sift_lib::analysis::*`.
**Conséquence : ces tests de contrat vivent en tests unitaires INLINE**
(`#[cfg(test)] mod tests { ... }`, déjà présent dans la plupart des
fichiers concernés — ex. `filing.rs:717`) au sein de chaque fichier source
propriétaire du type/de la constante, pas dans un nouveau fichier
d'intégration. Aucun changement de visibilité (`pub mod`) sur la
production — plus chirurgical.

**Files:**
- Modify: `src-tauri/src/filing.rs` (ajoute les 2 tests de constantes dans
  son `mod tests` existant)
- Modify (un test de forme par fichier propriétaire, dans son `mod tests`
  existant — en créer un avec `#[cfg(test)] mod tests { use super::*; ... }`
  si absent) : le fichier qui déclare chacun des 10 types listés plus haut
  — localiser par `grep -rn "struct QueueItem" src-tauri/src/` etc. avant
  d'écrire quoi que ce soit, ne pas présumer l'emplacement.
- Read only : `shared/contracts.ts`

**Interfaces:**
- Produces : un fichier de test Rust autonome, aucune modification du code
  de production.
- Consumes : les 10 structs listées ci-dessus (localiser leur définition
  exacte par `grep -rn "struct QueueItem" src-tauri/src/` etc.), plus
  `filing::FILE_IN_PLACE`/`filing::EXTERNAL_DEST_PREFIX`.

- [ ] **Step 1: Localiser chaque type et ses champs exacts**

Pour chacun des 10 types (`QueueItem`, `LibraryTrack`, `AnalysisReport`,
`Spectrogram`, `BatchResult`, `FileProgress`, `Canonical`, `DupGroup`,
`DupGroupMember`, `TrackRelease`) :
- Trouver sa définition `pub struct` exacte côté Rust (nom de fichier,
  liste de champs, types).
- Trouver l'interface TS correspondante dans `shared/contracts.ts` (mêmes
  noms de champs attendus — Tauri/serde par défaut ne renomme pas en
  camelCase sauf `#[serde(rename_all = ...)]` explicite ; vérifier au cas
  par cas si un struct en a un).
- Si un type n'a pas de constructeur simple (ex. dépend d'un autre struct
  imbriqué), utiliser `Default::default()` si le struct dérive `Default`,
  sinon construire une valeur minimale à la main (n'importe quelle valeur
  valide, seul le NOM des champs compte pour ce test, pas leur contenu).

- [ ] **Step 2: Écrire le test des constantes partagées (inline dans `filing.rs`)**

Ajouter DANS le `mod tests` existant de `src-tauri/src/filing.rs` (ligne
~718, `use super::*;` déjà présent normalement — vérifier) :

```rust
    // Contract tests (Phase 2) — see
    // docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md. No codegen: these parse
    // shared/contracts.ts's source text directly and assert the Rust constant's literal value
    // appears in it. Inline here (not a separate integration test file) because `filing` is a
    // private module — src-tauri/tests/*.rs compiles as an external crate and can't see it.
    const CONTRACTS_TS: &str = include_str!("../../../shared/contracts.ts");

    #[test]
    fn file_in_place_constant_matches_contracts_ts() {
        let expected = format!("\"{}\"", FILE_IN_PLACE);
        assert!(
            CONTRACTS_TS.contains(&expected),
            "shared/contracts.ts must contain FILE_IN_PLACE = {expected}"
        );
    }

    #[test]
    fn external_dest_prefix_constant_matches_contracts_ts() {
        let expected = format!("\"{}\"", EXTERNAL_DEST_PREFIX);
        assert!(
            CONTRACTS_TS.contains(&expected),
            "shared/contracts.ts must contain EXTERNAL_DEST_PREFIX = {expected}"
        );
    }
```

Le chemin `include_str!` est relatif au fichier source (`src-tauri/src/filing.rs`)
— compter les `../` exacts pour atteindre `shared/contracts.ts` depuis là
(probablement `../../../shared/contracts.ts` si la racine du crate est
`src-tauri/`, mais VÉRIFIER en resolvant le chemin réel plutôt que de
copier ce nombre de `../` sans le confirmer — une erreur de chemin ferait
échouer la compilation avec un message clair, facile à corriger).

- [ ] **Step 3: Écrire les 10 tests de forme exhaustive (inline, mod tests du fichier propriétaire)**

Même contrainte que la Step 2 : chaque test vit dans le `#[cfg(test)] mod
tests` DÉJÀ PRÉSENT du fichier qui déclare le struct (`use super::*;` en
tête de ce module donne accès direct au type sans passer par `sift_lib::`,
puisqu'on est dans le même crate/module). Si le fichier n'a pas encore de
`mod tests`, en créer un à la fin du fichier :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    // ...
}
```

Un test par type, sur ce modèle (exemple `QueueItem`, à ajouter dans le
`mod tests` de `src-tauri/src/queue.rs` — remplacer par les champs réels
trouvés à la Step 1) :

```rust
/// Mirrors shared/contracts.ts's `QueueItem`. Exhaustive destructure (no `..`): fails to compile
/// if a field is added/removed/renamed on the Rust struct — the forcing function to also update
/// contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
#[test]
fn queue_item_shape_matches_contracts_ts() {
    let v: QueueItem = /* construire une instance minimale valide */;
    let QueueItem { id, path, filename, verdict, dup /* ...tous les champs réels, sans .. */ } = v;
    let _ = (id, path, filename, verdict, dup /* ... */); // évite un warning "unused" sans changer la sémantique
}
```

Répéter pour les 9 autres types, chacun dans le `mod tests` de SON propre
fichier source (`library.rs` pour `LibraryTrack`, etc. — localisé à la
Step 1, ne pas présumer). Si un struct ne dérive pas assez de traits pour
être construit facilement en test (ex. pas de `Default`, champs privés
inaccessibles hors du module), le signaler explicitement dans le rapport
plutôt que de forcer une construction fragile — ce cas particulier peut
être exclu du périmètre avec une justification, sans bloquer les autres.

- [ ] **Step 4: Vérifier**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, 369 + (jusqu'à 12) nouveaux tests, 0 régression.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: PASS, 0 warning (en particulier sur les variables "non
utilisées" des déstructurations — le `let _ = (...)` doit suffire, sinon
utiliser `#[allow(unused_variables)]` sur la fonction de test).

**Preuve que le garde-fou fonctionne réellement** : avant de conclure,
modifier TEMPORAIREMENT un champ d'un des structs testés (ex. renommer
`id` en `id2` dans `QueueItem`) et confirmer que `cargo test` échoue à la
COMPILATION (pas juste à l'exécution) sur le test correspondant — puis
annuler ce changement temporaire avant de continuer. Documenter ce essai
dans le rapport (nom du champ testé, message d'erreur obtenu).

- [ ] **Step 5: Commit (après autorisation explicite)**

```bash
git add src-tauri/src/filing.rs src-tauri/src/queue.rs src-tauri/src/library.rs \
        <les autres fichiers propriétaires touchés, confirmés à la Step 1>
git commit -m "test(ipc): add compile-time contract tests for shared Rust/TS types

Covers the 2 shared constants (FILE_IN_PLACE, EXTERNAL_DEST_PREFIX, checked
by parsing shared/contracts.ts's source text) and 10 of the most actively
used shared struct shapes (checked by exhaustive destructuring — a field
add/remove/rename fails compilation, forcing contracts.ts to be revisited).
Inline in each owning file's existing mod tests (not a separate integration
test file — the owning modules are private to the sift_lib crate, so an
external tests/*.rs file can't reach them). No codegen, no new dependency —
see the plan's comparison of the 3 options from the spec.

Phase 2 — see docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md"
```

---

### Task 2: Rapport de fin de phase

**Files:** aucun changement de code.

- [ ] **Step 1: Rédiger le rapport**

Fichiers modifiés, tests ajoutés (liste), preuve du garde-fou (résultat de
l'essai de renommage temporaire de la Step 4), types exclus du périmètre
avec justification (si applicable), tests exécutés + résultat, diff
synthétique, recommandation (Phase 3, conditionnelle aux mesures).
