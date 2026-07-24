# Auto-update Tauri (sans code-signing OS payant) — design

Date : 2026-07-24

## Contexte

Diffusion V1 (scope original du README : code-signing Windows + notarization
macOS + auto-update Tauri + site) est bloquée sur le budget : pas de compte
Apple Developer (99$/an), pas de certificat de signature Windows, pas de nom
de domaine réservé. Périmètre retenu après clarification : **auto-update
Tauri seul**, gratuit (clés de signature Ed25519 générées localement,
indépendantes de tout certificat OS), plus la documentation d'installation
manuelle non signée pour le premier install (Windows SmartScreen / macOS
Gatekeeper). Le reste (site de download dédié) est différé — pas de domaine.

Cadence de release : ponctuelle / à la demande (pas de rythme fixe), décidée
avec Antoine — ça écarte toute automatisation de bump de version ou de
release périodique.

## Architecture

Le plugin `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` gère le
cycle complet (check → download → install → relaunch) côté client, signé par
une paire de clés Ed25519 générée via `tauri signer generate` — gratuite,
sans rapport avec la signature de code OS (SmartScreen/Gatekeeper restent
non résolus par ce mécanisme, cf. section Limites). Le manifest `latest.json`
+ les binaires signés sont attachés à une GitHub Release ; l'endpoint pointe
vers `https://github.com/c0remusic/sift/releases/latest/download/latest.json`
(un seul endpoint — pas de domaine custom disponible).

Confirmé via Context7 (`/websites/v2_tauri_app`, doc `plugin/updater` +
`distribute/pipelines/github` + `develop/configuration-files` +
`plugin/process`) avant d'écrire ce design :
- `tauri.conf.json` : `bundle.createUpdaterArtifacts: true` +
  `plugins.updater.pubkey`/`endpoints`.
- Clés : `tauri signer generate -w ~/.tauri/sift.key` (privée jamais commitée,
  publique collée dans le config d'override, cf. section Composants).
- Signature CI : variables d'env `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (pas de fichier `.env`, secrets
  GitHub Actions).
- API frontend : `check()` → `update.downloadAndInstall(onProgress)` →
  `relaunch()` (import `@tauri-apps/plugin-updater` +
  `@tauri-apps/plugin-process`).
- Permissions requises dans les capabilities : `updater:default` +
  `process:default` (le relaunch passe par le plugin process, permission
  distincte — pas couverte par `updater:default`).
- Enregistrement des plugins : `src-tauri/src/lib.rs`, sur le `Builder`
  existant — `.plugin(tauri_plugin_updater::Builder::new().build())` et
  `.plugin(tauri_plugin_process::init())`, aux côtés des plugins déjà
  enregistrés (fichier à lire au plan pour l'ordre réel).
- Format `latest.json` : `{version, notes, pub_date, platforms: {<os-arch>:
  {signature, url}}}` — clé `<os-arch>` au format `windows-x86_64` /
  `darwin-aarch64` / etc.
- `installMode` Windows : `passive` (défaut — barre de progression sans
  interaction requise), cohérent avec le bandeau non-bloquant déjà retenu ;
  pas de raison de le changer.
- Config par environnement : `tauri build --config <fichier>` merge un
  fichier JSON séparé par-dessus `tauri.conf.json` (dernier gagne sur
  conflit) — mécanisme utilisé en section Composants pour isoler
  `createUpdaterArtifacts`/`plugins.updater` du build de routine.

## Composants

- `src-tauri/Cargo.toml` : deps `tauri-plugin-updater` **et**
  `tauri-plugin-process` (le relaunch en dépend, cf. section précédente).
- `package.json` : deps `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`.
- `src-tauri/src/lib.rs` : enregistrement des deux plugins sur le `Builder`.
- **Nouveau `src-tauri/tauri.release.conf.json`** (jamais dans
  `tauri.conf.json` de base — voir Limite ci-dessous) : `bundle.
  createUpdaterArtifacts: true` + bloc `plugins.updater` (pubkey + endpoint
  GitHub unique). Fusionné uniquement au build de release via
  `tauri build --config src-tauri/tauri.release.conf.json`, appelé
  seulement par `release.yml`.
- `src-tauri/capabilities/*.json` (fichier à confirmer au plan — celui qui
  porte déjà les autres permissions IPC) : ajout `updater:default` +
  `process:default`.
- Nouveau `frontend/updater.ts` : au démarrage (appelé depuis `main.ts`,
  dans le bloc `if (inTauri)` aux côtés de `installLiveWiring()` — ce module
  ne s'exécute jamais hors Tauri réel, même contrainte que `sift-live.ts`),
  `check()` en fond ; si dispo, affiche un bandeau persistant (survit à la
  navigation entre écrans — attaché à `document.body`, même pattern que
  `filing-toast.ts`, mais **pas** d'auto-dismiss à 6s) avec deux actions :
  « Installer et redémarrer » (`downloadAndInstall()` + `relaunch()`) et
  « Plus tard » (retire le bandeau, pas de re-check avant le prochain
  lancement de l'app — cohérent avec la cadence ponctuelle, pas de re-check
  périodique en session).
- Nouveau `.github/workflows/release.yml` : déclenché sur tag `v*.*.*`
  seulement (jamais sur push main — `build.yml` existant reste la CI de
  routine, inchangé, **sans** `tauri.release.conf.json` donc sans exigence
  de clé de signature — c'est précisément ce qui évite la régression du
  build de routine). `permissions: contents: write`. Mêmes étapes de setup
  que `build.yml` (Rust/Node/fetch-ffmpeg) + `tauri-apps/tauri-action` pour
  build+signer+publier la Release avec `latest.json`, invoqué avec
  `args: --config src-tauri/tauri.release.conf.json` (nom exact du
  paramètre `tauri-action` à confirmer au plan — le mécanisme `--config`
  lui-même est confirmé Context7). Version exacte de `tauri-action` à
  épingler au moment du plan (vérifiée sur le repo GitHub, pas devinée).
- Nouveau `docs/install-non-signe.md` : instructions bypass SmartScreen
  (Windows : « Informations complémentaires » → « Exécuter quand même ») et
  Gatekeeper (macOS : clic droit → Ouvrir, première fois seulement, ou
  `xattr -d com.apple.quarantine`). Référencé depuis le README à la section
  "Lancer l'app" ou une nouvelle section "Installer" si aucune n'existe.

## Flux de release

1. Antoine bump les 3 fichiers de version (convention déjà posée dans
   `CLAUDE.md` § Outillage) depuis `main`.
2. `git tag vX.Y.Z && git push --tags`.
3. `release.yml` construit, signe, et publie un **brouillon** de Release
   GitHub avec les installeurs + `latest.json` (`releaseDraft: true`).
   **Étape manuelle obligatoire** : Antoine doit ensuite publier ce
   brouillon sur GitHub (Releases → Edit → Publish) — `/releases/latest/`
   (l'endpoint dans `tauri.release.conf.json`) ne résout **jamais** un
   brouillon. Sans ce clic, l'auto-update ne trouve silencieusement rien,
   pour toujours.
4. Au lancement suivant de l'app déjà installée, check silencieux → bandeau
   si maj disponible.

Vérifié en conditions réelles le 2026-07-24 : `v0.0.1` puis `v0.0.2` tagués
et poussés, `release.yml` exécuté avec succès sur les deux (`gh run list`),
`v0.0.2` publiée manuellement (`isDraft:false`), assets attendus présents
(`latest.json` + 6 installeurs/signatures Win+Mac).

## Portée réelle du manifest — limitation explicite

Le matrix CI actuel (`build.yml:10-17`) ne construit que `windows-latest` et
`aarch64-apple-darwin`. `latest.json` n'aura donc que les clés
`windows-x86_64` et `darwin-aarch64` — pas de Mac Intel (`darwin-x86_64`), pas
de Linux. Utilisateurs sur ces plateformes hors scope de l'auto-update (déjà
hors scope de la distribution actuelle) — nommé ici plutôt que découvert plus
tard en silence.

## Gestion d'erreur

- Check réseau qui échoue au lancement (pas de connexion, GitHub
  injoignable) : silencieux, pas de bandeau d'erreur intrusif (cas normal
  hors-ligne) — log console seulement.
- Échec de `downloadAndInstall()` après clic utilisateur : le bandeau
  affiche un message d'erreur explicite à la place du message de succès —
  jamais de fallback silencieux (cohérent avec `error-handling.md`).

## Risque ouvert — non vérifié

Aucune confirmation trouvée dans la doc Tauri (Context7) sur le comportement
Gatekeeper/quarantine pour un téléchargement fait par le processus updater
lui-même (par opposition à un téléchargement navigateur qui pose l'attribut
`com.apple.quarantine`). Hypothèse plausible que l'auto-update contourne
Gatekeeper silencieusement (le fichier ne transite jamais par le navigateur),
mais **non confirmée** — à vérifier empiriquement lors du test manuel
(section suivante), pas supposée acquise.

## Test

Pas de test automatisé possible (nécessite une vraie Release GitHub taguée).
Vérification manuelle au moment de l'implémentation :
1. Publier une release de test sur un tag jetable.
2. Installer une version antérieure sur une machine Windows et une Mac.
3. Lancer l'app, confirmer l'apparition du bandeau, cliquer Installer,
   confirmer le redémarrage sur la nouvelle version.
4. Sur macOS spécifiquement, noter si Gatekeeper intervient pendant
   l'auto-update (lève le risque ouvert ci-dessus).
5. Confirmer que « Plus tard » retire le bandeau sans re-déclencher de check
   avant le prochain lancement.

## Hors scope (différé)

- Code-signing Windows / notarization macOS (bloqué budget).
- Site de download dédié (pas de domaine réservé).
- Cadence de release automatisée (cadence ponctuelle confirmée).
- Build Linux / Mac Intel (matrix CI actuel ne les couvre pas).
