<!-- Pas de frontmatter paths: volontaire — ce fichier est un menu de contexte
     consulté à la demande par l'orchestrateur, pas une règle liée à un type de
     fichier. Voir A-fondations-memoire.md § Path-specific rules. -->

# Packs de contexte (sizing) — Sift

Menus de 3-8 fichiers par type de tâche (l'orchestrateur choisit, ne colle pas
tout). Concept de sizing dans `~/.claude/CLAUDE.md` § Sizing (+ templates
skill `sizing-templates`). Migré depuis l'ex-`docs/skills-registre.md`
(supprimé 2026-07-16). Chemins vérifiés sur disque à la migration.

## Pack UI live

- `CLAUDE.md` : sections Vision, Front — événements répétés, Front — CSS,
  Vérification UI.
- `docs/design-system-states.md` : composants concernés seulement.
- `frontend/styles.css`.
- Fichiers frontend touchés (`report-view.ts`, `filing.ts`,
  `batch-tracklist.ts`, etc.).
- Commande de vérification par défaut : `npx tsc --noEmit`.

## Pack Rust backend

- `CLAUDE.md` : sections Stack, Commandes, Documentation lookups, Méthode.
- `.claude/rules/rust.md` : override projet (forme réelle du code, avant de
  proposer un pattern Rust).
- Fichiers `src-tauri/src/*.rs` concernés seulement.
- `src-tauri/Cargo.toml` si dépendances/features.
- Commandes : `cargo test --manifest-path src-tauri/Cargo.toml` et/ou
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

## Pack Rekordbox / master.db

- `CLAUDE.md` : garde-fou « Jamais une écriture sur un système live ».
- `docs/ressources-externes.md` : évaluations Rekordbox pertinentes (voir
  sommaire en tête de fichier, cibler par ligne).
- Specs/plans M8 actifs uniquement (`docs/INDEX.json` → section `specs`/`plans`).
- Fichiers Rust/TS concernés.
- Toute vérification dans le vrai Rekordbox reste manuelle par Antoine.

## Pack docs / planning

- `docs/INDEX.json`.
- Spec/plan cible.
- Ce fichier (`context-packs.md`) si routage de packs ; `~/.claude/skills-view.md`
  si routage de skills (remplace l'ex-`docs/skills-registre.md`).
- Pas de lecture large de `frontend/` ou `src-tauri/` sauf question précise.

## Pack review adverse

- La spec approuvée.
- Le diff (`git diff -- <fichiers>`).
- Les fichiers modifiés uniquement.
- Les règles `CLAUDE.md` strictement pertinentes.
- Sortie : findings file:line, sévérité, test manquant, pas de résumé long.
