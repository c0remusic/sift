# Contribuer à Sift

Merci de l'intérêt. Sift est développé par une seule personne, en public.
Les contributions sont bienvenues, mais lisez d'abord la section suivante :
elle évite de perdre du temps des deux côtés.

## Avant d'écrire du code

**Ouvrez une issue d'abord.** Le projet a une direction produit assez arrêtée
et une architecture posée. Une pull request qui arrive sans discussion
préalable a de bonnes chances d'être refusée pour une raison qui n'a rien à
voir avec sa qualité — parce qu'elle élargit un périmètre volontairement
étroit, ou qu'elle réintroduit une approche déjà écartée.

Ce qui est le plus utile, par ordre décroissant :

1. **Un rapport de bug reproductible.** Surtout sur un format de fichier, un
   encodage, ou un comportement de Rekordbox que nous n'avons pas pu tester.
2. **Un retour d'usage réel** sur une bibliothèque différente de la nôtre.
3. **Un correctif ciblé** sur un bug déjà décrit dans une issue.

## Mettre en route

Prérequis : [Rust](https://rustup.rs) (le canal est épinglé par
`src-tauri/rust-toolchain.toml`, `rustup` s'en charge), Node.js, et les
[dépendances système de Tauri v2](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run fetch-ffmpeg
npm run tauri dev
```

Sur Windows, passez les commandes npm par `cmd /c "npm ..."`.

Les fixtures audio des tests ne sont pas versionnées. Sur un clone frais,
générez-les, sans quoi les tests de décodage échouent en `file not found` :

```bash
node scripts/make-fixtures.mjs
```

## Avant d'ouvrir une pull request

Les quatre commandes doivent passer :

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npx tsc --noEmit
```

## Ce que le projet attend d'un changement

Ces règles ne sont pas du formalisme : elles viennent toutes d'un incident réel.

- **Un correctif prouve qu'il corrige.** Un test qui échoue avant le changement
  et passe après. Un test qu'on n'a pas vu échouer ne prouve rien.
- **Pas de repli silencieux.** Une erreur remonte avec son contexte. Un `catch`
  vide, une valeur par défaut sur échec, un `unwrap()` sur un chemin de
  production sont refusés.
- **Changements chirurgicaux.** Un correctif ne se double pas d'un refactor
  opportuniste : les deux se relisent mal ensemble.
- **Jamais d'écriture sur un système tiers vivant** sans sauvegarde vérifiée au
  préalable. Cela vaut en particulier pour la base Rekordbox.
- **Le commentaire dit pourquoi, pas quoi.** Le code dit déjà ce qu'il fait ;
  ce qui se perd, c'est la raison pour laquelle il le fait ainsi et pas
  autrement, et ce qui casse si on le change.

## Traduction et langue

Le code, les identifiants et les messages de commit sont en anglais ou en
français selon les modules — le dépôt vit avec les deux. Les commentaires
récents sont en français. Ne convertissez pas un fichier d'une langue à
l'autre dans une pull request qui fait autre chose.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la
licence [MIT](LICENSE) du projet.
