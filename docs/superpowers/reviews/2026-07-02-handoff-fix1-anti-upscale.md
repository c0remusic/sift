# HANDOFF — FIX-1 (garde-fou anti-upscale), reste à faire + suite du plan

> Écrit par Claude (web) le 02/07/2026, pour Claude Code. Contexte : bridge MCP local
> (Filesystem/Desktop Commander) instable pendant cette session — plusieurs timeouts consécutifs,
> d'où le passage de relais. Le backend de FIX-1 est fini et validé (170/170 tests, clippy propre).
> Il reste le frontend de FIX-1, puis la suite du plan `audit/PLAN-FIX-2026-07-02.md` (source
> unique de vérité pour tout le reste — le lire en entier avant de continuer).

---

## Méthode obligatoire (rappel, non négociable)

Détective : théorie → preuve dans le code réel → fix. Avant CHAQUE fix du plan, relire le
fichier:ligne cité et confirmer que le code n'a pas bougé — plusieurs fixes du plan se sont déjà
avérés partiellement ou totalement faits entre l'audit (02/07 matin) et l'exécution (02/07
après-midi) : FIX-17 était déjà entièrement résolu, FIX-7 et FIX-20 avaient partiellement évolué.
Ne jamais corriger un problème qui n'existe plus. Un chantier à la fois, testé + commité avant le
suivant. `cargo test` + `cargo clippy --all-targets -- -D warnings` verts côté Rust, `tsc --noEmit`
+ `npm run build` verts côté front, avant de considérer un fix terminé.

---

## PARTIE A — Finir FIX-1 (frontend)

### État actuel (déjà fait, validé)

**Backend — terminé, ne pas retoucher** :
- `src-tauri/src/analysis/tags.rs` : nouvelle fonction `rail_from_content(path: &str) -> Rail`
  (détection par contenu réel via `lofty::probe::Probe::open(path)?.guess_file_type()?.read()?`,
  PAS l'extension). 2 tests dédiés, verts avec fixtures réelles.
- `src-tauri/src/filing.rs` : nouvelle variante `FilingError::RailMismatch` (Display →
  `"RAIL_MISMATCH"`, sentinel stable façon `"NoLibraryRoot"`). `plan_file()` a un nouveau dernier
  paramètre `allow_rail_mismatch: bool` : si `source_rail==Lossless` (extension) ET
  `rail_from_content(&source)==Lossy` ET `!allow_rail_mismatch` → `Err(FilingError::RailMismatch)`.
  2 nouveaux tests dédiés (`plan_file_blocks_a_disguised_lossy_source_unless_allowed`,
  `plan_file_does_not_flag_a_genuine_lossless_source`), verts. `#[allow(clippy::too_many_arguments)]`
  posé sur `plan_file` et le helper de test `file_track` (8 params, seuil clippy = 7 — justifié en
  commentaire, pas de struct de regroupement introduite, pas de précédent dans le code pour cet
  allow donc à surveiller si Antoine préfère une autre convention).
- `src-tauri/src/ipc_filing.rs` : commande Tauri `file_track` a un nouveau param
  `allow_rail_mismatch: Option<bool>` (thread vers `plan_file` via `.unwrap_or(false)`).
  `run_file_batch` passe toujours `false` explicitement (un mismatch en batch tombe dans
  `needs_validation` comme toute autre erreur de filing — pas de confirmation automatique en masse).
- Validé : `cargo test --lib` → **170 passed, 0 failed**. `cargo clippy --all-targets -- -D
  warnings` → propre (seul reste `TRASH_PURGE_DAYS` dead_code, dette PRÉ-EXISTANTE hors scope,
  documentée comme telle ailleurs dans le projet — ne pas y toucher dans ce chantier).

**Frontend — partiellement fait** :
- `frontend/ipc.ts::fileTrack` a un nouveau dernier paramètre optionnel `allowRailMismatch?: boolean`,
  passé à `invoke("file_track", {..., allowRailMismatch: allowRailMismatch ?? null})`. **Fait.**
- `frontend/filing.ts::doRanger` — **PAS FAIT, à faire maintenant.**

### Ce qui reste : `frontend/filing.ts::doRanger`

Fonction actuelle (dans `filing.ts`, cherchez `async function doRanger`) :

```ts
async function doRanger(mid: HTMLElement): Promise<void> {
  if (!state.track || !state.canonical || acting) return;
  const inPlace = fileInPlaceChecked();
  const dest = inPlace ? FILE_IN_PLACE : state.binRel;
  if (dest === null) {
    toast("Choisis un dossier de destination.", false);
    return;
  }
  const ranger = document.querySelector<HTMLElement>('[data-fil="ranger"]');
  const orig = ranger?.innerHTML ?? null;
  acting = true;
  setActionsDisabled(true);
  if (ranger)
    ranger.innerHTML =
      '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Rangement en cours…';
  try {
    const res = await fileTrack(state.track.id, dest, state.target, state.canonical);
    // ... (succès : capture filedPath/batchId, auto-avance, showFiledConfirm — INCHANGÉ)
  } catch (e) {
    const msg = String(e);
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else toast(`Échec du rangement : ${msg}`, false);
    console.error("file_track failed", e);
    setActionsDisabled(false);
    if (ranger && orig != null) ranger.innerHTML = orig;
  } finally {
    acting = false;
  }
}
```

**Objectif** : quand `fileTrack(...)` rejette avec un message contenant `"RAIL_MISMATCH"`, afficher
une confirmation explicite (option B du plan — avertir + confirmer, PAS bloquer dur), et si
l'utilisateur confirme, relancer le filing avec `allowRailMismatch=true`.

**Piège de concurrence à éviter (identifié en préparant ce handoff, ne pas le recréer)** :
NE PAS résoudre ça par un simple appel récursif `doRanger(mid)` depuis l'intérieur du `catch`
après avoir remis `acting = false` à la main — le `finally { acting = false }` de l'appel EXTÉRIEUR
s'exécute après le `return`, et retomberait sur `false` PENDANT que l'appel récursif (déjà lancé de
façon async) a lui-même remis `acting = true` et est en train d'`await` — l'extérieur écraserait
l'état de l'intérieur en pleine opération. Le acting-flag ne protégerait plus rien.

**Structure recommandée** : une seule zone `try/finally` pour `acting`, avec une boucle de retry
interne (pas de récursion) :

```ts
async function doRanger(mid: HTMLElement): Promise<void> {
  if (!state.track || !state.canonical || acting) return;
  const track = state.track;
  const canonical = state.canonical;
  const inPlace = fileInPlaceChecked();
  const dest = inPlace ? FILE_IN_PLACE : state.binRel;
  if (dest === null) {
    toast("Choisis un dossier de destination.", false);
    return;
  }
  const ranger = document.querySelector<HTMLElement>('[data-fil="ranger"]');
  const orig = ranger?.innerHTML ?? null;
  acting = true;
  setActionsDisabled(true);
  if (ranger)
    ranger.innerHTML =
      '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Rangement en cours…';
  let allowRailMismatch = false;
  try {
    for (;;) {
      try {
        const res = await fileTrack(track.id, dest, state.target, canonical, allowRailMismatch);
        // ... succès : chemin INCHANGÉ (copier tel quel depuis l'implémentation actuelle)
        return; // sortir de la boucle ET de la fonction — le finally remet acting=false
      } catch (e) {
        const msg = String(e);
        if (!allowRailMismatch && msg.includes("RAIL_MISMATCH")) {
          const ext = (track.path.split(".").pop() || "").toUpperCase();
          const proceed = window.confirm(
            `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
              `le convertir créerait un faux fichier lossless.\n\nRanger quand même ?`,
          );
          if (proceed) {
            allowRailMismatch = true;
            continue; // relance la MÊME boucle, cette fois avec confirmation
          }
          // refus explicite → sortie propre, pas d'erreur, pas de toast (l'utilisateur a choisi
          // de ne rien faire) ; réactiver les boutons et rendre le libellé d'origine
          setActionsDisabled(false);
          if (ranger && orig != null) ranger.innerHTML = orig;
          return;
        }
        throw e; // toute autre erreur (ou un mismatch déjà confirmé qui re-échoue) → catch extérieur
      }
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else toast(`Échec du rangement : ${msg}`, false);
    console.error("file_track failed", e);
    setActionsDisabled(false);
    if (ranger && orig != null) ranger.innerHTML = orig;
  } finally {
    acting = false;
  }
}
```

Points d'attention pour l'implémentation réelle :
1. Copier le chemin de succès EXACTEMENT tel qu'il existe aujourd'hui (capture filedPath/batchId,
   listQueue, auto-avance via openFilingInto, showFiledConfirm) — rien ne change là-dedans, juste
   le contexte (boucle au lieu d'un simple try une fois).
2. `state.track`/`state.canonical` peuvent théoriquement changer pendant l'`await` (navigation) —
   capturer `track`/`canonical` en `const` locales AVANT la boucle (comme dans le squelette
   ci-dessus) pour éviter tout problème de narrowing TypeScript et de cohérence si l'utilisateur
   navigue pendant que la confirmation `window.confirm` est affichée (peu probable vu que
   `window.confirm` est bloquant, mais plus sûr).
3. `window.confirm` est cohérent avec le seul autre pattern de confirmation bloquante déjà présent
   dans le code (`journal.ts`, 2 usages sur des actions bulk destructrices) — pas d'introduction
   d'un nouveau pattern UI. Si Antoine préfère un vrai modal plus tard, c'est un chantier séparé
   (déjà noté dans le plan comme FIX-20, unification des patterns de confirmation).
4. Tester en live : (a) filer un fichier normal → comportement inchangé ; (b) créer un MP3 renommé
   `.flac` (copier un vrai mp3, renommer l'extension), le mettre dans une source surveillée, tenter
   de le filer → la confirmation doit apparaître avec le bon message ; refuser → rien ne se passe,
   boutons réactivés ; accepter → le filing se termine normalement, `.aiff` produit dans la
   bibliothèque (comportement AVANT le fix : aucune alerte, conversion silencieuse — c'est
   exactement ce qui devait changer).
5. `tsc --noEmit` + `npm run build` verts avant de committer.

Une fois ce fix testé live et commité, **FIX-1 est intégralement terminé**.

---

## PARTIE B — Continuer le plan

Après FIX-1, enchaîner sur `audit/PLAN-FIX-2026-07-02.md` dans l'ordre de la section
« ORDRE D'EXÉCUTION RECOMMANDÉ » (en bas du fichier), en sautant FIX-1 (fait) et FIX-2 (différé,
décision Antoine — ne pas y toucher sauf s'il le redemande explicitement) :

1. **PHASE 2 en bloc** (FIX-3 à FIX-8) — tous indépendants, tous petits, un commit chacun.
   Re-vérifier chaque fichier:ligne cité avant de coder (cf. méthode ci-dessus).
2. **FIX-5 + FIX-6 + FIX-10 ensemble** — même primitive FS partagée (copy→verify→delete) à
   extraire une fois, sert aux trois. FIX-5 confirmé encore nécessaire au 02/07
   (`ecartes.rs::restore_track` toujours en `std::fs::rename` direct) ; FIX-6 confirmé encore
   présent (`trash_file_fs(_root: &Path, ...)` toujours avec `root` mort) ; FIX-10 non re-vérifié
   depuis l'audit initial — à confirmer avant de coder.
3. **FIX-9** (aria-label) — mécanique, peut être fait en parallèle du reste par lots.
4. **FIX-11 + FIX-12** (contrat unique Rust↔TS pour le kbps et les autres règles dupliquées) —
   décisions produit déjà tranchées dans le plan (option A pour FIX-11 : Rust source unique).
5. **PHASE 4** (tests, FIX-15/16/18 — FIX-17 déjà fait, retiré) — au fil de l'eau.
6. **PHASE 5** (cohérence UI, FIX-19/20/21/22) — FIX-20 nuancé au 02/07 (bandeau repositionné mais
   problème de fond identique, voir le plan pour le détail) ; FIX-21 confirmé encore nécessaire
   (`doIdentify`/`onIdentityApplied` toujours sans jeton de séquence, contrairement à
   `openFilingInto` qui a `openSeq`).
7. **PHASE 6** — différé, gros effort, pas avant que le reste soit stable.

Pour chaque fix : relire la preuve citée dans le plan contre le fichier réel, confirmer ou signaler
un écart, coder chirurgicalement, tester (unitaire + live si le fix touche un chemin utilisateur),
committer séparément. Ne pas grouper plusieurs FIX non explicitement associés dans le plan en un
seul commit.

## NE PAS TOUCHER (rappel du plan)
- Le moteur de revert (`revert_batch`/`undo_last`/`revert_one_fs`) — prouvé correct.
- Le garde-fou joueur `syncDetail` (`state.track && paneIsOurs` → jamais de switch pendant lecture).
- L'architecture 3-phases du filing (plan/execute/commit, lock relâché autour de l'encode).
- Le pattern create-once de `progress-zone.ts`.
- FIX-2 (nav Rekordbox/USB simulée) — différé sur décision explicite d'Antoine.
- `TRASH_PURGE_DAYS` — dette pré-existante hors scope de ce chantier.
