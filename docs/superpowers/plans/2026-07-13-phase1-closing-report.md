# Phase 1 — rapport de clôture (réduction de `sift-live.ts`)

> Spec : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
> section 4. Tranches : 1a (`6d0f3f9`/`cb42772`), 1b (`cd67dea`), 1c
> (`a1eb7d7`).

## Résultat

`frontend/sift-live.ts` : **2083 → 520 lignes** (-75%).

| Tranche | Module créé | Domaine | Lignes créées |
|---|---|---|---|
| 1a | `frontend/rekordbox-view.ts` (extension) | Routage actions Rekordbox (20 branches) | +322 |
| 1b | `frontend/queue-panel.ts` | File/sélection Revue (état + 15 fonctions) | 503 |
| 1c | `frontend/batch-panel.ts` | Mode Lot (état + 19 fonctions + 3 couplages) | 833 |

`sift-live.ts` restant (520 lignes) : `pushAnalyzeProgress`, `runNavExport`,
`setReviewMode` (orchestrateur cross-panel, décision architecturale
tranche 1b), `refresh`, `installLiveWiring` (câblage global + dispatch
Écartés/Bibliothèque, resté centralisé par convention établie
préexistante — `AGENTS.md` : "dispatch reste centralisé... comme
ecartes-view.ts", jamais dans le périmètre de cette Phase).

**Tranche 1d ("progression + événements globaux") jugée inutile** : ce qui
en restait (progression, câblage `installLiveWiring`) constitue exactement
l'orchestrateur mince visé par la spec ("un installeur d'application mince
pour la navigation et le câblage global") — rien à extraire de plus sans
déplacer arbitrairement la complexité.

## Comportement préservé

Zéro changement observable sur les trois tranches — vérifié par tsc/build/
cargo test après chaque tâche, et par une checklist manuelle `tauri dev`
pour les points sensibles (debounce 150ms, virtualisation, et surtout le
garde-fou de confirmation à deux clics `BATCH_CONFIRM_THRESHOLD`/
`batchConfirmArmed`, vérifié byte-identique par le reviewer de la tranche
1c — c'est le garde-fou contre l'incident réel de filing de masse
accidentel documenté dans `AGENTS.md`).

## Décisions architecturales

- **Frontières leaf-to-leaf, jamais de cycle statique** : `queue-panel.ts`
  et `batch-panel.ts` n'importent jamais depuis `sift-live.ts` ; l'un peut
  importer en lecture depuis l'autre dans un seul sens
  (`batch-panel.ts → queue-panel.ts`, jamais l'inverse).
- **Orchestration cross-panel = injection de dépendance, pas import
  statique.** Deux mécanismes symétriques nés des couplages cachés trouvés
  en 1b/1c : `registerBatchRenderer`/`registerRefreshHook` (callbacks
  enregistrés une fois par `sift-live.ts` dans `installLiveWiring`, appelés
  depuis les modules feuilles sans jamais les importer).
- **`setReviewMode` reste dans `sift-live.ts`** — c'est le seul point qui
  légitimement orchestre les deux panels ; sa branche `"detail"` vit dans
  `queue-panel.ts` (`enterDetailMode`), sa branche `"batch"` reste locale.

## Ce que le processus a révélé

**5 couplages cachés trouvés en cours d'implémentation, aucun deviné** —
chacun escaladé par l'implémenteur (statut `NEEDS_CONTEXT`) plutôt
qu'improvisé, et résolu par le contrôleur avant re-dispatch :
1. Tranche 1b : `setReviewMode` référençait du code batch → split
   `enterDetailMode`/`setReviewModeRaw`.
2. Tranche 1b : `renderQueue` référençait `renderBatch` directement →
   `registerBatchRenderer`.
3. Tranche 1c : `onFileBatchDone`/`runBatchDiscard` référençaient `refresh()` →
   `registerRefreshHook`.
4. Tranche 1c : `pushFileProgress`/`onFileStop` + 3 variables d'état,
   classées "ne pas déplacer", se sont révélées 100% batch-exclusives →
   déplacées.
5. Tranche 1c : un listener `"change"` (hors du chaînon de clic couvert par
   l'extraction) mutait `batchInPlace` directement → `onBatchInPlaceChange`.

**Leçon retenue pour les phases suivantes** : une analyse de couplage faite
à l'avance (avant dispatch) ne suffit pas à couvrir un fichier de cette
taille — la vérification exhaustive symbole-par-symbole PENDANT
l'implémentation (grep systématique, pas de présomption) est ce qui a
réellement trouvé ces 5 couplages. Conserver cette discipline pour toute
future extraction de fichier volumineux.

**3 rounds de fix post-revue sur les 3 tranches, tous des imports morts**
(3 en tranche 1b, 1 en tranche 1c) — `tsc --noEmit` ne les détecte pas
(`noUnusedLocals` désactivé dans `tsconfig.json`). Signal pour la Phase 2 ou
un futur nettoyage : activer `noUnusedLocals` fermerait cette classe de
bug à la source plutôt que de dépendre d'une revue humaine/agent à chaque
extraction — **non fait ici** (hors scope de ce chantier, à proposer
séparément si le volume d'imports morts futurs le justifie).

## Tests exécutés (toutes tranches, résultat final)

- `npx tsc --noEmit` → PASS
- `npm run build` → PASS (seul warning résiduel : `INEFFECTIVE_DYNAMIC_IMPORT`
  sur `report-view.ts`, pré-existant avant Phase 1, non lié à ce chantier)
- `cargo test --manifest-path src-tauri/Cargo.toml` → 369 passed, 4 ignored
  (aucun fichier Rust touché par cette Phase)

## Risques résiduels

- Vérification manuelle `tauri dev` (checklists des 3 tranches) : à faire
  par l'utilisateur, jamais driven par un agent (convention du projet).
- `noUnusedLocals` non activé — voir "leçon retenue" ci-dessus.
- Écartés/Bibliothèque restent en dispatch centralisé dans
  `installLiveWiring` — cohérent avec la convention préexistante, pas un
  oubli, mais à revisiter si ces écrans grossissent au point de justifier
  le même traitement.

## Recommandation

Phase 1 close ici. Passage à la Phase 2 (fiabiliser les contrats IPC) —
prochaine étape de la spec, indépendante de la structure de fichiers
frontend.
