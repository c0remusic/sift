# Chantier triple : token-sync v3 + spike CDP WebView2 + spike M8 complémentaire (design)

> Issu du brainstorm du 2026-07-04 (audits Fable de session). Trois volets
> indépendants, exécutés par agents parallèles (Sonnet), audit final par le
> modèle principal. Décisions actées par Antoine pendant le brainstorm :
> maquette = push seul (app → maquette, plus jamais l'inverse) ; v3
> « styles.css canonique » ; spike CDP intégré ; spike M8 maintenant.

## Volet A — token-sync v3 : `styles.css` canonique, push seul

**Intention** : `frontend/styles.css` est déjà la source de vérité déclarée du
projet. Le pivot JSON DTCG (v2, 2026-07-04) n'existait que pour arbitrer
entre 3 cibles dont une (l'édition de couleurs dans Claude Design) est
abandonnée. Sans elle, la machinerie baseline/conflit ne protège plus rien :
on la supprime, un seul fichier fait foi, zéro conflit possible.

**Architecture** (`design_handoff_sift_refonte/token-sync/`) :
- **Nouveau module `styles-css.cjs`** : parse + écriture des 3 blocs de
  `styles.css` (`:root`, `@media (prefers-color-scheme:dark)`,
  `:root[data-theme="dark"]`). Logique d'extraction reprise de
  `pull-styles-css.cjs` (regex par bloc, vérif de cohérence des deux blocs
  sombres) AVANT sa suppression. Invariant tenu par le writer : les deux
  blocs sombres sont toujours écrits identiques. Fail-fast si un bloc ou un
  token attendu est introuvable (jamais deviner).
- **`editor-server.cjs`** : `GET /tokens.json` construit en parsant
  `styles.css` à chaque requête ; le POST de « Valider » écrit `styles.css`
  directement via le writer. Editor.html (UI, aperçu maquette live, undo 1
  niveau, mode sombre) inchangé côté utilisateur.
- **Générateurs** : `generate-design-md.cjs` et `generate-theme-html.cjs`
  lisent `styles.css` via le parser (plus les JSON). `alias-map.json` reste
  (noms legacy `theme()` pour la maquette). `apply-tokens.cjs` devient
  « propage styles.css → DESIGN.md + Sift.dc.html » + affichage des
  consommateurs réels (`locate.cjs`, inchangé).
- **Supprimés** : `design-tokens.light.json`, `design-tokens.dark.json`,
  `last-sync.json`, `pull-styles-css.cjs`, `pull-theme-html.cjs`,
  `migrate-to-dtcg.cjs`, `sync-core.verify.cjs`/`verify-roundtrip.cjs` si
  leur objet disparaît (à remplacer par le test v3 ci-dessous, pas à garder
  morts). `sync-core.cjs` maigrit (plus de loadCanonical/resolveTheme JSON)
  ou fusionne dans `styles-css.cjs`.

**Vérification obligatoire** :
1. Round-trip no-op : parser `styles.css` puis le réécrire sans changement
   = octet-identique (test scripté, pas une affirmation).
2. `apply-tokens.cjs` (dry-run puis --write) : no-op vérifié quand rien n'a
   changé ; un changement de couleur test propagé puis annulé.
3. `editor-server.cjs` démarre, `GET /tokens.json` renvoie les valeurs
   réelles de `styles.css`, un POST de test modifie bien les 3 blocs.
4. `styles.css` final strictement identique à l'état de départ (aucun
   changement de valeur de token ne fait partie de ce chantier).

## Volet B — spike CDP WebView2 (vérification visuelle de la vraie app)

**Intention** : combler le seul trou du workflow UI (le code gated `inTauri`
n'est jamais vérifiable par l'agent, seulement par Antoine). WebView2 expose
un endpoint Chrome DevTools si lancé avec
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`.

**Protocole** :
1. Lancer `tauri dev` avec la variable d'env posée (session env, pas de
   modification de config committée).
2. Vérifier que `http://127.0.0.1:9222/json` liste la page de la fenêtre Sift.
3. S'y attacher (skill `agent-browser` en mode CDP connect, ou tout client
   CDP équivalent) : prendre un screenshot + vérifier dans le DOM un
   marqueur du vrai code (ex. `#sift-tb-title` de la titlebar custom
   `chrome.ts`, absent du mock `app.js`).
4. Verdict binaire documenté (succès = screenshot du vrai shell ; échec =
   message d'erreur exact et à quelle étape).

**Livrable** : rapport de findings (pas d'écriture dans
`docs/ressources-externes.md` par l'agent — intégration docs faite au moment
de l'audit final pour éviter les conflits d'écriture entre volets).
Si succès, suite (hors volet) : noter l'option dans CLAUDE.md « Vérification
UI » — le défaut reste « Antoine regarde lui-même ».

## Volet C — spike M8 complémentaire (masterPlaylists6.xml + colonnes USN)

**Intention** : lever les 2 risques ouverts bloquants de
`2026-07-04-m8-masterdb-write-path-rust-design.md` — le spike Évaluation 7 a
validé le round-trip SQLite mais jamais l'acceptation par Rekordbox lui-même
(copie testée sans `masterPlaylists6.xml`).

**Contraintes absolues** (héritées du plan spike précédent) :
- Ne JAMAIS écrire dans `C:\Users\LEETJ\AppData\Roaming\Pioneer\rekordbox\`
  — lecture/copie seulement. Tout le travail dans
  `C:\Users\LEETJ\Desktop\sift-masterdb-write-probe\` (hors repo).
- Aucun fichier du spike committé dans le repo.

**Protocole (partie agent)** :
1. Copier le **dossier Rekordbox complet** (au minimum `master.db` +
   `masterPlaylists6.xml` + tout fichier frère pertinent) vers le probe.
2. Dump SQL de référence (via `sqlcipher3`) des tables `djmdContent` /
   `djmdSongPlaylist` (colonnes de suivi incluses : `rb_local_usn`,
   `updated_at`, `rb_data_status`...) + hash de `masterPlaylists6.xml`.
3. Modifier UN `FolderPath` via pyrekordbox (`db.commit()`), sur la copie.
4. Diff avant/après : exactement quelles colonnes ont bougé sur la ligne
   modifiée, la table `agentRegistry`/USN globale éventuelle, et si
   `masterPlaylists6.xml` a été réécrit par pyrekordbox (hash + diff).
5. Lire le code source pyrekordbox installé (pas la mémoire d'entraînement)
   pour confirmer ce que `commit()` fait des USN et du XML.
6. Rapport de findings + **instructions pas-à-pas prêtes pour Antoine** pour
   la validation finale dans le vrai Rekordbox (Rekordbox fermé → backup des
   fichiers live → swap de la copie modifiée → ouverture/vérification →
   restauration). L'agent ne fait PAS cette étape.

**Livrable** : rapport détaillé ; intégration dans la spec M8 et
`ressources-externes.md` à l'audit final, une fois la manip d'Antoine faite.

## Exécution

Trois agents Sonnet en parallèle (A n'exécute rien côté Rust ; B lance
`tauri dev` ; C est hors repo — pas de collision). Aucun agent n'écrit dans
`docs/` (rapports retournés en fin de tâche, docs consolidées à l'audit).
Audit final par le modèle principal : revue du diff v3 (round-trip prouvé),
verdicts B et C, consolidation docs, puis commit sur demande d'Antoine.
