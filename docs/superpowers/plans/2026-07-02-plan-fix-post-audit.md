# PLAN DE CORRECTION — Sift (source unique, post-audit RAPPORT-FINAL 2026-07-02)

> Consolide RAPPORT-FINAL.md + PASS-0..9 (audit du 2026-07-02, branche `m6a-discogs`) en un
> séquencement exécutable. Remplace PLAN-SIFT.md (28/06, périmé — plusieurs items y sont marqués
> FAIT mais l'audit du 02/07 prouve que "trash centralisé" est resté incomplet, voir PHASE 0).
> Méthode obligatoire (préférence Antoine) : détective — théorie → preuve dans le code réel →
> fix. Ne jamais corriger sur une "théorie" non vérifiée par citation fichier:ligne. Un chantier
> à la fois, testé + commité avant le suivant. Surgical changes, fail-fast, pas de fallback
> silencieux, une seule source de vérité par règle métier.
>
> **RE-VÉRIFICATION COMPLÈTE DU 02/07 (tour suivant)** : chaque fix listé ci-dessous a été
> repassé individuellement contre le code réel (grep + lecture ciblée) après rédaction initiale
> du plan. Résultat : FIX-17 retiré (déjà fait), FIX-7 et FIX-20 allégés/nuancés (le code a
> partiellement évolué sans clore le problème), tous les autres confirmés identiques à l'audit.
> Chaque fix reste à re-vérifier une dernière fois juste avant exécution (le code continue de
> bouger) — voir « MÉTHODE POUR CHAQUE FIX » en fin de document.

---

## PHASE 0 — Lever une incohérence avant tout code (lecture seule, 15 min)

**Problème** : PLAN-SIFT.md (28/06) marque "trash centralisé" comme conçu/décidé. RAPPORT-FINAL
(02/07) + PASS-1 HIGH#1 prouvent que `ecartes.rs::restore_track` (ligne ~124) utilise encore
`std::fs::rename(&to, &from)` direct — PAS la primitive copy→verify→delete cross-disk-safe que
`actions::revert_one_fs` utilise déjà pour le même type d'opération. **Vérifié en direct le
02/07** : le code n'a pas changé depuis l'audit.

**Avant de coder quoi que ce soit dans ce plan** : confirmer l'état réel de `trash_file_fs`
(filing.rs) — est-il déjà sur `{Documents}/Sift/Trash` avec copy→verify→delete (ce que PASS-1
affirme), ou seulement partiellement ? Si confirmé, le FIX-1 ci-dessous (PHASE 1) est un simple
alignement de `restore_track` sur la primitive déjà existante, pas une nouvelle conception.

---

## PHASE 1 — CRITICAL (bloquant avant toute idée de release)

### FIX-1 — Fermer le contournement du garde-fou anti-upscale
- **Preuve** : PASS-3 BUG-1 (Critical). `analysis/tags.rs::rail_from_ext` classe la rail
  (lossless/lossy) sur l'EXTENSION du fichier, jamais sur le contenu réel sondé par Symphonia.
  `filing.rs:287` (`plan_file`) rappelle `rail_from_ext` au lieu d'utiliser le verdict d'analyse
  déjà en base. Un MP3 renommé `.flac` peut être "converti" en AIFF lossless valide — exactement
  le scénario que `guard_no_upscale` existe pour bloquer.
- **Root cause** : pas de colonne persistée `detected_codec`/`declared_rail` — seul `verdict`
  dérivé existe en base.
- **DÉCISION PRODUIT TRANCHÉE (02/07)** : Option B — avertir + confirmer, PAS bloquer dur. Sift
  détecte l'incohérence (contenu réel décodé ≠ rail déclarée par l'extension) et affiche un
  avertissement explicite avant filing ("ce fichier est déclaré {ext} mais son contenu réel est
  {codec détecté} — le convertir créerait un faux lossless"), avec confirmation explicite requise
  pour filer quand même. Cohérent avec la posture "Sift montre la mesure, l'humain juge" déjà
  actée ailleurs (chantier vinyle). PAS de blocage dur inconditionnel.
- **Fix** : au moment du filing, dériver `source_rail` du contenu réellement décodé/sondé (probe
  léger, pas un décodage complet — pas besoin de refaire `analyze()` en entier). Si divergence
  avec la rail déclarée par l'extension : retourner un signal dédié (pas juste `FilingError::
  Upscale` silencieux) que le front transforme en modal de confirmation explicite, PAS un simple
  toast. Le filing ne procède qu'après confirmation utilisateur. Journaliser cette confirmation
  (le fait qu'un upscale a été explicitement forcé) pour traçabilité — décider si ça mérite une
  marque dans `actions.meta` ou juste un log.
- **Effort** : Medium (probe léger + nouveau code d'erreur dédié + modal front + wiring
  confirmation). Prêt à coder.

### FIX-2 — [DIFFÉRÉ — pas maintenant, décision Antoine 02/07] Masquer l'entrée nav "Rekordbox"/"Clé USB" simulée
- **Statut** : retiré de la Phase 1 sur décision explicite d'Antoine. L'audit le classait Critical
  (PASS-6 Constat 3, PASS-9), mais ce n'est PAS une priorité de code actuelle. Conservé ici pour
  mémoire — à reprendre plus tard, sans urgence imposée par le plan.
- **Preuve (toujours valable si repris un jour)** : PASS-6 Constat 3 (Critical), confirmé par
  PASS-9. `sift-live.ts:300-327` (`startExportSim`) : le code admet lui-même "the work itself is
  simulated". Aucune commande Tauri, aucun fichier XML écrit, aucune clé USB touchée. Un DJ qui
  clique croit avoir exporté sa bibliothèque.
- **Fix (si repris)** : masquer/désactiver les entrées nav `data-view="rkb"`/`data-view="cle"` (le
  lean-style existant sait déjà cacher des entrées nav). Retirer ou geler `runNavExport`/
  `startExportSim`.
- **Effort** : Faible.

---

## PHASE 2 — QUICK WINS (effort faible, haute visibilité, zéro risque d'archi)

Chaque item = un commit séparé, testable seul.

### FIX-3 — Cache du spectrogramme dans `report_json`
- **Preuve** : PASS-4 b2 (High), le goulot perf le plus significatif de l'audit. `ipc.rs:225-274`
  (`analyze_path`) saute TOUJOURS le cache si `with_spectrogram=true`, re-décode tout à chaque
  clic sur le spectrogramme, même pour un fichier déjà entièrement analysé et caché.
- **Fix** (option (a) de PASS-4, la plus simple) : étendre `report_json` pour inclure le
  spectrogramme (déjà borné à 800×256 = 204 800 octets max, `spectrum.rs:165-166` — pas un blob
  énorme). `worker.rs:94` calcule déjà le report ; ajouter le spectrogramme au payload persisté.
- **Effort** : Faible. **Impact perçu élevé** — élimine 100% des re-décodages pour toute piste
  déjà analysée, la feature qui EST la preuve visuelle du différenciateur produit.

### FIX-4 — Remonter "Compatibilité CDJ" dans le vocabulaire du verdict principal
- **Preuve** : PASS-6 Constat 1 (High), confirmé unique par PASS-9 catégorie 4 (aucun concurrent
  audité n'a de ciblage CDJ). `filing.ts:1036-1043` : "Compatibilité CDJ" est une ligne
  oui/non secondaire sous Genres, jamais nommée "CDJ" dans le langage de l'écran Revue.
- **Fix** : déplacer/reformuler le badge CDJ pour qu'il apparaisse dans ou juste sous le verdict
  principal (`report-view.ts`), avec un langage qui nomme explicitement le CDJ.
- **Effort** : Faible (déplacement UI + reformulation, zéro nouveau code métier).

### FIX-5 — `restore_track` : router par la primitive copy→verify→delete
- **Preuve** : PASS-1 HIGH#1, confirmé au tour précédent (`ecartes.rs:124` toujours
  `std::fs::rename` direct au 02/07). La corbeille vit hors-root (`{Documents}/Sift/Trash`,
  potentiellement autre disque) ; `actions::revert_one_fs` sait déjà faire ce mouvement
  cross-disk-safe (copy→verify→delete) pour le même type d'opération (undo via journal).
  `ecartes.rs::restore_track` (bouton "Restaurer" de l'écran Écartés) a gardé son `rename`
  d'origine. Doc-comment `actions.rs:3-4` promet "there is exactly one place that knows how to
  safely reverse work" — invariant actuellement violé.
- **Fix** : faire passer `restore_track` par `actions::revert_one_fs` (ou extraire la primitive
  FS partagée copy→verify→delete dans un point commun appelé par les deux).
- **Effort** : Faible. **Corrige un bug cross-disk réel**, config DJ courante (source externe,
  biblio locale).

### FIX-6 — Retirer le paramètre `root` mort du chemin corbeille
- **Preuve** : PASS-1 LOW. `filing.rs:150` (`trash_file_fs(_root: &Path, ...)`) — `root` ignoré
  mais toujours résolu et threadé à travers 3 fonctions (`filing.rs:184`, `:537`,
  `ipc_filing.rs:430`). `trash_track` exige donc `library_root` configuré pour une opération qui
  n'en a plus besoin depuis que la corbeille est hors-root.
- **Fix** : retirer `root` de `trash_file_fs`/`move_to_trash`/`trash_track`, lever la
  pré-condition `library_root` pour `trash_track`.
- **Effort** : Faible. Faire dans le même commit que FIX-5 (même zone de code).

### FIX-7 — [PÉRIMÈTRE RÉDUIT, vérifié 02/07] Barre de progression 0/N immédiate au clic "Filer (n)"
- **Preuve** : PASS-5 M1. `sift-live.ts:705-707` (`runBatchFile`) : entre le clic et le premier
  `file:progress`, seul signal = spinner générique "Rangement en arrière-plan…".
- **Évolution constatée (02/07)** : le code a changé depuis l'audit — une tracklist PAR MORCEAU
  (`startBatchTracklist`) est désormais montée IMMÉDIATEMENT au clic, avant même la réponse de
  `fileBatch` (commentaire du code : "the first row shows 'running' immediately — no backend
  event needed"). L'utilisateur voit déjà un signal par morceau au clic. CE QUI RESTE : la barre
  GLOBALE de la zone de progression (`progress-zone.ts`, en bas du nav) n'affiche toujours aucun
  0/N tant que le premier `file:progress` n'est pas arrivé — seul le `fileNote` textuel générique
  s'affiche immédiatement dans le rail.
- **Fix (périmètre réduit)** : appeler `setTask("file", {done:0, total:ids.length,
  state:"running"})` immédiatement dans `runBatchFile`, avant `fileBatch(...)`, pour que la barre
  globale affiche 0/N dès le clic — cohérent avec ce qui existe déjà pour la tracklist.
- **Effort** : Faible, réduit par rapport à l'estimation initiale (le gros du travail visuel
  existe déjà).

### FIX-8 — `ecartes-view.ts` : espacement hors grille + couleur danger mal utilisée
- **Preuve** : PASS-5 M3/M4. `gap:7px` répété (grille impose 4/8/12/16/24/32) ; badge générique
  "à re-sourcer" réutilise `--color-*-danger` alors que ce n'est pas une détection d'anomalie.
- **Fix** : `7px`→`8px` partout dans le fichier ; badge "à re-sourcer" générique → ton
  neutre/tertiaire, garder danger uniquement pour `verdict==='fake'`.
- **Effort** : Faible.

---

## PHASE 3 — HIGH structurel (dette technique, décisions à trancher AVANT de coder)

### FIX-9 — Généraliser `aria-label` aux boutons icon-only
- **Preuve** : PASS-5 C2 (Critical). Zéro `aria-label` sur `filing.ts`, `report-view.ts`,
  `journal.ts`, `ecartes-view.ts`, `library-detail.ts` — le pattern n'a été appliqué qu'une fois
  (`sift-live.ts:1072-1073`, nav Bibliothèque), jamais répercuté aux modules extraits.
- **Fix** : ajouter `aria-label` calqué sur le `title` existant à chaque bouton icon-only recensé
  (play/pause, Annuler, Fermer, Trash, Restaurer...).
- **Effort** : Medium (mécanique, ~20 boutons sur 5 fichiers). Aucune décision produit requise —
  peut être fait dès que FIX-1 est commité (indépendant de FIX-2, qui est différé).

### FIX-10 — Filing conformant cross-disk : fallback copy→verify→delete
- **Preuve** : PASS-1 HIGH#2. `filing.rs:367` (`execute_file`, chemin conformant) et `:400`
  (`rollback_fs`) utilisent `std::fs::rename` direct. Un fichier déjà propre (FLAC/AIFF/WAV,
  justement ceux qu'on garde tels quels) filé depuis un disque différent de la bibliothèque
  échoue avec une erreur IO brute, alors que le chemin corbeille est déjà cross-disk-safe.
- **Fix** : réutiliser la primitive copy→verify→delete de `trash_file_fs` pour le move conformant
  quand `rename` échoue en cross-device (détecter l'erreur `EXDEV`/os error 17-18, fallback).
- **Effort** : Medium. **Fait le même jour que FIX-5** (même primitive partagée à extraire une
  fois pour tous les appelants : restore_track, filing conformant, rollback_fs).

### FIX-11 — Une seule source de vérité pour le barème cutoff→kbps
- **Preuve** : PASS-1 HIGH#3, PASS-2 §4 (valeurs numériques concrètement différentes), PASS-7 §5.
  `analysis/verdict.rs:22-31` (320→19000Hz, 256→18000, 192→16500, 160→15500, 128→14500) vs
  `report-view.ts:61-62` (320→20000Hz, 256→19000, 192→18000, 160→16500) — pas la même table,
  décalée d'un cran. Signalé par 4 passes indépendantes comme le point de dette le plus
  transversal du projet (touche directement la feature signature).
- **DÉCISION PRODUIT TRANCHÉE (02/07)** : Option A — le kbps affiché DOIT dériver exactement du
  même calcul que le verdict. Rust = seule source de vérité. Le front cesse tout calcul
  indépendant du barème.
- **Fix** : exposer le barème de seuils (ou directement le kbps estimé, calculé côté Rust à
  partir de `min_cutoff_hz_for_bitrate`) via IPC/le contrat existant — probablement le plus
  simple : ajouter un champ `est_kbps: Option<u32>` calculé dans `AnalysisReport` (même table que
  `verdict()` utilise), le front l'affiche tel quel au lieu de recalculer `estKbps()` localement.
  Supprimer la fonction TS dupliquée (`report-view.ts:61-62`) une fois le champ back consommé.
- **Effort** : Medium (nouveau champ dans `AnalysisReport` + `contracts.ts` + `worker.rs` persist +
  suppression du calcul TS). Prêt à coder.

### FIX-12 — Autres règles métier dupliquées Rust↔TS (même famille que FIX-11)
- **Preuve** : PASS-1 HIGH#3, sous-cas restants : sémantique d'écriture des tags
  (`filing.ts:591-610` vs `tagging.rs:39-60`), garde no-upscale affichée (`filing.ts:868`),
  format par défaut selon le rail (`filing.ts:478-480` vs `encode.rs:62-69`), preview du nom de
  fichier qui ne lit pas le vrai template ni `sanitize()` (`filing.ts:494-503` vs
  `naming.rs:176-186`).
- **Fix par cas** : faire du back la source unique et la faire remonter plutôt que la recopier
  (le back renvoie déjà les structures, il peut renvoyer la décision calculée en plus).
  Priorité : la preview du nom de fichier d'abord (PASS-1 MEDIUM, preuve directe qu'un titre avec
  `/` affiche un nom qui ne sera pas le nom réel).
- **Effort** : Medium par cas. **Regrouper avec FIX-11 dans le même chantier "contrat unique",
  pas 4 PR séparées** — même diagnostic racine.

### FIX-13 — `run_file_batch` : identifier + loguer les erreurs avalées vers `needs_validation`
- **Preuve** : PASS-2 §2, Medium. `ipc_filing.rs:348-367` : le routage vers `needs_validation`
  est voulu, mais la `FilingError` réelle (Upscale/Encode/Tag/Io/Db) n'est jamais loguée avant le
  `continue`. Contraste avec `worker.rs::persist_result` qui loggue systématiquement.
- **Fix** : `log::warn!` l'erreur avant `continue`, routage inchangé.
- **Effort** : Faible.

### FIX-14 — Fallbacks silencieux dans `dedup.rs`/`filing.rs::load_tag_extras`
- **Preuve** : PASS-2 §2, High. `dedup.rs:72-78` (`find_duplicate`) et `:134-154`
  (`get_or_compute_fp`) confondent "pas de ligne" et "vraie erreur DB" via `Err(_) => ...`.
  `filing.rs:219-232` (`load_tag_extras`) même pattern.
- **Fix** : ne matcher le cas silencieux QUE sur `QueryReturnedNoRows`, propager/loguer les
  autres erreurs.
- **Effort** : Faible par site (3 sites).

---

## PHASE 4 — DETTE DE TEST (ne bloque rien, mais couvre les chemins les plus critiques)

### FIX-15 — Tests `rollback_fs` (chemin de sécurité non prouvé)
- **Preuve** : PASS-7 §3, High. `filing.rs:396-418` garantit "rien n'est laissé à moitié filé"
  mais aucun test ne force `commit_file()` à échouer après un `execute_file()` réussi.
- **Fix** : introduire un seam pour simuler un échec DB entre phase 2 et phase 3, exercer
  `rollback_fs` end-to-end.
- **Effort** : Medium.

### FIX-16 — Tests `encode.rs` : échouer bruyamment sans fixtures, pas silencieusement
- **Preuve** : PASS-7 §3, High. 5 occurrences du pattern `eprintln!("skip: no fixture"); return;`
  — en CI ou sur une machine sans `fixtures/`, ces tests annoncent un succès trompeur.
- **Fix** : `panic!` au lieu de `return` silencieux quand `CI=true`, ou au minimum un résumé
  agrégé du nombre de tests skippés en fin de suite.
- **Effort** : Medium.

### FIX-17 — [DÉJÀ FAIT, confirmé 02/07 tour suivant] Test du vrai cas conversion pour le revert (`.aif`→`.aiff`)
- **Statut** : retiré du travail restant. En relisant `filing.rs` et `actions.rs` en entier (post-audit),
  les DEUX parties de ce fix existent déjà dans le code actuel :
  - **Root cause** (`filing.rs::plan_file`) : un fichier conformant garde désormais SA PROPRE
    extension (`.aif` reste `.aif`) au lieu d'être forcé en `.aiff` (`target.ext()`). Le
    commentaire du code cite explicitement le relevé comme justification. Test dédié :
    `files_conformant_aif_preserving_its_extension`.
  - **Tests de reproduction** (`actions.rs`) : les trois tests décrits dans le relevé existent :
    `cold_revert_of_aif_filing_leaves_single_file`, `windows_std_reader_does_not_block_revert`,
    `windows_held_handle_reproduces_aif_aiff_duplicate`. Le déclencheur (verrou externe Windows,
    os error 32, PAS le worker Sift) est prouvé par le code lui-même.
  - `revert_batch` logue désormais explicitement l'échec FS (`log::error!`) au point d'inversion,
    ce qui couvre aussi une partie de l'esprit de FIX-14 pour ce site précis (mais pas les autres
    sites listés dans FIX-14, qui restent à traiter).
- **Leçon méthode** : ceci confirme qu'un cycle de ré-vérification avant chaque fix (comme demandé
  dans « MÉTHODE POUR CHAQUE FIX » en fin de plan) est indispensable — le code bouge entre la date
  de l'audit et l'exécution du plan.

### FIX-18 — Compléter la couverture du barème bitrate (192/160 kbps non testés)
- **Preuve** : PASS-7 §3, Medium. `verdict.rs:26-27`, deux branches sur six jamais exercées par
  aucun test direct ou indirect.
- **Fix** : ajouter les cas 192/160 kbps (honnête + sur-encodé) aux tests existants.
- **Effort** : Faible.

---

## PHASE 5 — COHÉRENCE UI (regroupée, pas de la dette bloquante mais visible en démo)

### FIX-19 — Traduire Bibliothèque en français + classes `.sift-*`
- **Preuve** : PASS-5 H3, High. `library-detail.ts` en anglais ("Save"/"Delete"/"Identify") avec
  styles inline, pendant que Revue/Écartés/Journal sont en français avec classes établies.
  Bouton "Delete" n'a même pas le style ghost rouge documenté pour une action destructive.
- **Effort** : Medium (traduction + remplacement styles inline, pas de nouvelle logique).

### FIX-20 — [REPOSITIONNÉ, problème de fond inchangé, vérifié 02/07] Unifier les 3 patterns de confirmation "action faite, annulable"
- **Preuve** : PASS-5 H2, High. Bouton-toggle (Apply tags) / bannière séparée (File) / toast 6s
  (Discard/Trash) — trois mécanismes différents pour la même idée, violation Nielsen #4.
- **Évolution constatée (02/07)** : le bandeau "Filed" a été repositionné depuis l'audit (décision
  Antoine, cf. `filed-autoadvance-releve.md`) — il vit maintenant en BAS du rail (`#filfoot`,
  sous Discard) au lieu du haut, dans une logique de convergence future avec l'état batch. Le
  fond du problème est identique : c'est TOUJOURS un 3e pattern visuel distinct du bouton-toggle
  et du toast — le repositionnement n'a pas réduit le nombre de patterns, juste déplacé l'un
  d'eux. Confirmé aussi : `library-detail.ts::toast()` reste sans bouton Undo, un 4e sous-cas du
  même problème structurel.
- **Fix** : converger vers UN système de confirmation réversible (même timing, même position,
  même vocabulaire). Coordonner avec le chantier de convergence batch↔détail déjà noté dans
  `filed-autoadvance-releve.md` ("rapatrier l'état batch du nav rail gauche vers le pied du rail
  droit") pour ne pas retoucher `#filfoot` deux fois.
- **Effort** : Medium (harmonisation markup/CSS, pas de refonte logique).

### FIX-21 — Jeton de séquence sur l'identification Discogs (`doIdentify`)
- **Preuve** : PASS-5 H1, High. `openFilingInto` a `openSeq` ; `doIdentify`/`onIdentityApplied`
  n'ont pas d'équivalent → risque de croisement de métadonnées entre morceaux si on identifie
  puis range vite. Cité par PASS-8 comme un des 5 points les plus graves (bug de données
  silencieux, difficile à détecter par l'utilisateur lui-même).
- **Effort** : Medium.

### FIX-22 — N+1 SQL de `list_filed` (genres)
- **Preuve** : PASS-4 d2, Medium. `library.rs:130-149` : une requête SQL par piste pour charger
  les genres. Croît linéairement avec la taille de la bibliothèque à CHAQUE filtre appliqué.
- **Effort** : Low-Medium (isolé à `list_filed`, requête groupée `WHERE track_id IN (...)`).

---

## PHASE 6 — LONG TERME (différé, gros effort, pas avant les phases 1-4)

- **`renderQueue` create-once/mutate** (PASS-4 d1, High) — même pattern que le fix create-once
  déjà validé sur `progress-zone.ts` (`render-storm-releve.md`), à répliquer sur la liste de
  queue. Effort Medium, gain surtout visible sur grosse bibliothèque.
- **Découpage de `sift-live.ts`** (1412 lignes, PASS-7 High, a doublé depuis le dernier audit) —
  extraire les blocs encore autonomes sur le modèle de `chrome.ts`/`ecartes-view.ts`/
  `home-sources.ts` déjà extraits. Effort High, risque moyen (déplacements d'imports + ids
  partagés) — faire AVANT que M7 le regrossisse encore, pas après.
- **Export Rekordbox XML réel** (via `rbox`) — feature majeure, condition à terme pour rendre
  la nav Rekordbox/USB réelle plutôt que simulée (cf. FIX-2, différé). Effort Élevé, hors scope
  de ce plan de correction (c'est une feature, pas un fix).
- **Batch de filing parallélisé** (PASS-4 a2, Medium, gain non quantifié) — ne pas faire avant
  d'avoir mesuré (protocole de mesure déjà écrit dans PASS-4).

---

## ORDRE D'EXÉCUTION RECOMMANDÉ

1. **PHASE 0** (15 min, lecture seule) — confirmer l'état de `trash_file_fs`.
2. **FIX-1** (garde-fou upscale, Option B avertir+confirmer) — seul, commit, test live. Devient
   le point d'entrée de la Phase 1 puisque FIX-2 est différé.
3. **PHASE 2 en bloc** (FIX-3 à FIX-8) — tous indépendants, tous petits, peuvent être faits dans
   n'importe quel ordre, un commit chacun.
4. **FIX-5 + FIX-6 + FIX-10 ensemble** — même primitive FS partagée à extraire une fois
   (copy→verify→delete), sert aux trois.
5. **FIX-9** (aria-label) — mécanique, peut être fait en parallèle du reste par lots.
6. **FIX-11 + FIX-12** (contrat unique Rust↔TS) — nécessite une session de décision produit
   dédiée (qu'est-ce qui doit être source de vérité où), puis un chantier groupé.
7. **PHASE 4** (tests) — au fil de l'eau, pas de blocage entre eux.
8. **PHASE 5** (cohérence UI) — après les Critical/High restants, avant toute démo publique.
9. **PHASE 6** — quand le reste est stable, pas avant. FIX-2 (nav simulée) reste disponible à
   tout moment si tu changes d'avis — aucune dépendance ne l'empêche d'être repris isolément.

## NE PAS TOUCHER (rappel, principes Antoine)
- Le moteur de revert (`revert_batch`/`undo_last`/`revert_one_fs`) — PROUVÉ correct par
  `cancel-bug-live-releve.md` et `revert-releve.md`, ne pas réécrire, seulement router
  `restore_track` dessus (FIX-5).
- Le garde-fou joueur `syncDetail` (`state.track && paneIsOurs` → jamais de switch pendant
  lecture) — protège contre le bug "waveform sans son" déjà combattu.
- L'architecture 3-phases du filing (plan/execute/commit, lock relâché autour de l'encode) —
  PASS-1 la cite comme "ce qui est bien conçu, à préserver".
- Le pattern create-once de `progress-zone.ts` — déjà correct, sert de référence pour FIX
  futurs (renderQueue).

## MÉTHODE POUR CHAQUE FIX (rappel)
1. Relire le fichier:ligne cité, confirmer que le code n'a pas bougé depuis l'audit.
2. Si la preuve ne tient plus (le code a changé), le signaler et STOP — ne pas corriger un
   problème qui n'existe plus.
3. Changement chirurgical, une seule responsabilité par commit.
4. `tsc --noEmit` + `npm run build` (front) / `cargo test` + `cargo clippy -- -D warnings`
   (Rust) verts avant de considérer le fix terminé.
5. Test live quand le fix touche un chemin utilisateur (pas seulement les tests unitaires).
