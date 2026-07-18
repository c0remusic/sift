# Audit sécurité — branche m6a-discogs (2026-07-10)

Audit demandé par Antoine (`security-review`), portée = diff complet `main...HEAD`
(11930 insertions, tout le travail non mergé depuis le gel de `main`). Méthode :
4 agents de scan parallèles par surface (IPC/commandes Rust, API Discogs/métadonnées,
formatage USB natif, frontend XSS/dev-tools), puis 3 agents de vérification adverse
indépendants sur les candidats substantiels avant de rapporter.

## Corrigé (commit 5c58fa7)

**XSS stocké → exécution IPC Tauri via filenames non échappés dans l'onglet Journal**
`frontend/journal.ts` (fichier neuf sur cette branche) était le seul fichier frontend
touchant des données non fiables (chemins de fichiers réels, `from_path`/`to_path`)
sans le helper `esc()` que les 13 autres fichiers du projet appliquent systématiquement
avant tout `innerHTML`. Un nom de fichier `<img src=x onerror=...>.flac` déposé dans
un dossier surveillé (cas d'usage Soulseek de l'app) s'exécute sans mitigation CSP
(`unsafe-inline` actif) et donne accès à `window.__TAURI__.core.invoke()` — donc à
toutes les commandes IPC enregistrées (filing, trash, revert…). Confirmé par
vérification adverse indépendante (confiance 9/10). Fix : ajout du même `esc()` sur
`name`/`dest`/`bid`/`label` de session/`toast`/`warn` dans `rowHtml()`,
`sessionGroupHtml()`, `renderJournal()`.

## Écarté après vérification adverse

- **SSRF via `cover_url` non validé** (`ipc_identify.rs`/`metadata/cover.rs`) —
  confiance 3/10. `ureq::get(url)` n'a aucune validation de scheme/host, mais
  `cover_url` provient du champ `cover_image` de la réponse Discogs elle-même
  (CDN Discogs), pas d'une entrée libre attaquant — aucune faille XSS/injection
  démontrée ailleurs dans le repo ne permet de forger un `Candidate` malveillant
  côté client. Reste un gap de defense-in-depth à bas coût (allowlist
  `https://` + host Discogs/CDN) mais ne franchit pas le seuil pour un finding
  autonome.
- **Traversal d'écriture via `ImagePath` Rekordbox** (`rekordbox_masterdb.rs`,
  `resolve_artwork_variants`/`sync_track_artwork`) — confiance 7/10 (juste sous le
  seuil de rapport à 8). Gap de containment réel et concret (`..` non rejeté,
  contrairement à `library::safe_join` qui fait ça correctement ailleurs dans le
  même fichier) sur un chemin IPC vivant. Précondition réaliste : l'utilisateur
  doit lier un `master.db`/XML forgé via le sélecteur de fichier de Sift
  lui-même (pas besoin de compromettre le vrai Rekordbox). Primitive limitée à
  l'écrasement d'une image existante déjà présente à un chemin devinable
  (gate `exists()` + décodage image valide). Voir tâche de suivi ci-dessous —
  **corrigé** (commit `ef99ed7`, 2026-07-10).

## Suivi proposé (non appliqué, hors seuil de confiance de cet audit)

Tâche de fond suggérée : appliquer la même logique de containment que
`library::safe_join` (`src-tauri/src/library.rs:391-407`) à `image_path` dans
`resolve_artwork_variants` (`rekordbox_masterdb.rs`) avant la jointure sur
`share_root` — durcissement à faible risque, pas de régression fonctionnelle
attendue (les `ImagePath` légitimes issus de Rekordbox ne contiennent jamais `..`).

**Appliqué** (commit `ef99ed7`, 2026-07-10) : `resolve_artwork_variants` joint
désormais `image_path` composant par composant, refuse tout segment `..` ou
préfixe de lecteur (`C:`), et renvoie `Result<_, MasterDbError>`
(`ArtworkPathEscapesRoot`) au lieu de résoudre silencieusement. Régression
couverte par `resolve_artwork_variants_rejects_path_traversal` (segments `..`
purs, mêlés, et préfixe de lecteur Windows).
