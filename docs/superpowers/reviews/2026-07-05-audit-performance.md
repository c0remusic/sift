# Audit de performance Sift — analyse, encodage/transfert, UI, DB/IPC (2026-07-05)

> Méthode : 4 agents Sonnet en parallèle (lecture seule, un par domaine),
> synthèse et contre-vérification Fable — chaque finding « certitude » a été
> revérifié aux lignes citées par la session principale avant d'entrer ici.
> Cas dimensionnant : bibliothèque 15 000 fichiers (backlog V1,
> `docs/plan-implementation.md`), batch de rangement 200 pistes, queue 7 000+.
> Les hypothèses non mesurées sont marquées **[à mesurer]**.

## Synthèse — les 6 findings qui dominent tout le reste

| # | Finding | Site | Gain estimé |
|---|---|---|---|
| P1 | Encodage FFmpeg strictement **séquentiel** (1 process à la fois) | `ipc_filing.rs:289` (thread unique `file-batch`), boucle `run_file_batch` | ~3-4× sur un batch de 200 |
| P2 | La virtualisation de `#ql` (fix 2026-07-04) **jamais propagée** : Bibliothèque, Écartés, et le batch (reconstruit à CHAQUE case cochée) | `sift-live.ts:1421-1429`, `ecartes-view.ts:77-99`, `sift-live.ts:562-707` + handlers `:1726-1760` | supprime la classe de bug « écran noir » déjà vécue |
| P3 | Dédup : **O(n²)** sans préfiltre + **N+1** (un SELECT fingerprint par piste alors que le SELECT initial existe) — recalculé à chaque affichage du dashboard | `dedup.rs:105-108` (SELECT sans fingerprint), `:132-146` (paires), `:300-302` (N+1) ; appelé par `library_stats` `library.rs:107` | dashboard utilisable à 15k |
| P4 | XML Rekordbox lié : **lecture+parse+écriture complète du fichier à chaque action** `move`/`convert` journalisée (jusqu'à 200×/batch) | `actions.rs:83-89` → `repair_rekordbox_xml_if_linked` `:106-138` | supprime 199 cycles I/O+parse par batch |
| P5 | `listQueue()` renvoie **toute la queue** (payload IPC complet) à chaque tick débouncé 300 ms pendant une rafale d'analyse, alors que le rendu est fenêtré | `sift-live.ts:367-374`, `:1864-1867` | fluidité pendant l'analyse de masse |
| P6 | Worker d'analyse plafonné à **4 threads** (`clamp(1, 4)`) sur des machines 8-16 cœurs, tâche CPU-bound | `worker.rs:116-119` | jusqu'à 2-4× sur le scan initial **[à mesurer** : contention disque] |

## Détail par domaine

### 1. Pipeline d'analyse (`analysis/`, worker, fingerprint, dedup)

- **[ÉLEVÉ] P6 — cap 4 threads** (`worker.rs:116-119`). Fix : constante
  (`clamp(1, 8)` ou plancher seul), à valider sur disque réel.
- **[ÉLEVÉ] Double décodage complet par piste dédupliquée** : `analyze()`
  (`analysis/mod.rs:118`) et `fingerprint::compute_for_path`
  (`fingerprint.rs:25`) font chacun leur `decode_pcm` intégral — le poste de
  coût dominant, payé deux fois. Fix structurel : brancher le `Fingerprinter`
  comme accumulateur de plus dans la passe PCM d'`analyze()` et remplir
  `tracks.fingerprint` dès l'analyse (le lazy de `dedup.rs` devient un
  fallback).
- **[ÉLEVÉ] P3 — dédup O(n²) sans préfiltre** (`dedup.rs:132-146`, commentaire
  ligne 93 « fine at library-browsing scale » écrit à 2 828 pistes, plus
  valable à 15k). Préfiltre trivial : `duration` (déjà dans `Row`) à ±2 s et
  longueur d'empreinte avant `similarity()`. + N+1 : ajouter `fingerprint` au
  SELECT initial (`dedup.rs:105-108`).
- **[MOYEN] 4 ouvertures/parses par piste analysée** : 2 probes Symphonia
  (`decode::probe` + l'interne de `decode_pcm`, `decode.rs:61/77`) + 1 probe
  lofty (`tags::read`, `mod.rs:103`) + le décodage. Fix : fusionner
  probe+decode (retourner sample_rate/channels du premier `open_format`).
- **[MOYEN] 2 Vec alloués par frame FFT** (`spectrum.rs:68-72`, ~12 900
  allocations/morceau de 5 min) — préallouer `scratch`/`mags` comme champs.
  `buf.drain(0..hop)` (`spectrum.rs:63`) = memmove par frame — ring buffer si
  on y touche déjà.
- **[FAIBLE] `FftPlanner` recréé par fichier** (`spectrum.rs:37-38`) —
  `OnceLock` partagé (taille fixe 4096).
- **✅ Sain** : cache DB des analyses (versionné, `worker.rs:42-48`),
  `out.clear()` réutilisé dans decode.

### 2. Encodage / transfert (encode, filing, actions, rekordbox_xml)

- **[ÉLEVÉ] P1 — FFmpeg série** (`run_file_batch`, un seul thread
  `file-batch`). Le split phase1/2/3 (préparer sous lock → encoder hors lock →
  committer sous lock) permet déjà un pool borné (~4 workers) sans toucher au
  modèle de verrou.
- **[ÉLEVÉ] P4 — reparse XML par action** (`actions.rs:83-89`). Fix : sortir
  la réparation du chemin per-action, charger/parser une fois par batch,
  accumuler, écrire une fois. (Le garde `from != to` existe déjà mais ne
  protège que le no-op.)
- **[MOYEN] Transactions SQLite non groupées** : `commit_file`
  (`filing.rs:471-497`) fait 4-5 commits WAL implicites par piste
  (~1 000/batch au lieu de 200). Fix quasi gratuit : `BEGIN`/`COMMIT` explicite
  par piste. Idem `purge_trash` (`ecartes.rs:139-168`, chemin rare).
- **[MOYEN — à mesurer] Tags lofty = réécriture complète du fichier**
  (`tagging.rs:76/202`) : sur un AIFF/WAV de 40-80 Mo conformant (pas de
  ré-encodage), la pose des tags peut dominer le coût de filing. Mesurer avant
  de statuer.
- **[MOYEN] Trash d'un original converti = copie complète cross-disk**
  (`filing.rs:159-182/203-209`) — design voulu (FIX-10), pas de fix simple ;
  noté pour le dimensionnement.
- **[MOYEN] Insertion XML O(n²)** (`merge_filed_tracks`,
  `rekordbox_xml.rs:317-424`) : scan complet du document par piste insérée —
  secondaire tant que P4 n'est pas fait ; l'invariant « text surgery » est
  volontaire, ne pas casser.
- **✅ Sain** : lecture stdout FFmpeg sur thread dédié, `find_bundled_ffmpeg`
  dev-only.
- **Hors scope confirmé** : aucun code de copie vers USB n'existe encore
  (M7 USB = formatage seul) — à auditer quand l'export arrivera.

### 3. Frontend UI (vanilla TS, WebView2)

- **[ÉLEVÉ] P2 — trois listes non virtualisées** alors que `#ql` l'est :
  - Bibliothèque : `content.innerHTML = bibState.tracks.map(...).join("")`
    (`sift-live.ts:1421-1429`), rebuild complet à chaque frappe (debounce
    250 ms) et clic de facette ;
  - Écartés : même pattern (`ecartes-view.ts:77-99`) ;
  - **Batch : `renderBatch()` reconstruit tous les groupes à CHAQUE case
    cochée** (`sift-live.ts:562-707`, appels `:1726-1760`) — le pire des
    trois (fréquence = clic utilisateur, taille = toute la queue). Fix : le
    tick d'une case doit muter la ligne concernée, pas tout reconstruire ;
    fenêtrage façon `renderQueueWindow` (`sift-live.ts:103-148`) pour les
    trois écrans.
- **[MOYEN-ÉLEVÉ] P5 — payload `listQueue()` complet** à chaque redraw
  débouncé pendant les rafales `analysis:changed` (le rendu est fenêtré, le
  fetch non). Fix : IPC paginé (`listQueue(offset, limit)`) ou évènement delta
  (`analysis:item-changed` avec l'item seul).
- **[MOYEN] `renderBins`/`renderFoot` réécrivent leur zone + forcent une
  lecture layout (`getBoundingClientRect`) à chaque `queue:changed`**
  (`filing.ts:474-477/966-974`) — borné par le debounce 150 ms, mais rewrite
  inconditionnel même sans changement.
- **[FAIBLE — à mesurer] Masque de survol waveform : `toDataURL()` (encodage
  PNG complet) à chaque `redrawcomplete`** (`report-view.ts:611-651`) —
  fréquence de l'évènement WaveSurfer non établie.
- **[Opportunité] `content-visibility:auto` + `contain-intrinsic-size`** sur
  les lignes de liste — utile surtout tant que P2 n'est pas fait ; la
  virtualisation reste le vrai fix.
- **✅ Sain** : zéro fuite de listeners (AbortController dans journal,
  délégation posée une fois, `usbFormatDoneHandler` remove-avant-add),
  conventions transform/opacity respectées partout, spectrogramme dessiné une
  fois par ouverture (pas par frame), boot non bloquant, aucun `setInterval`.

### 4. DB / IPC / watcher

- **[ÉLEVÉ] `list_ecartes` fait de l'I/O disque par ligne SOUS le Mutex
  global** (`ecartes.rs:66-96` via `reconcile_track` → lecture des tags du
  fichier réel, appelé `ipc_filing.rs:546-549`) : chaque écarté non identifié
  = une lecture disque en tenant le verrou qui bloque tout l'IPC et le worker.
  Fix : stocker artist/title de repli au moment du reject, ou sortir la boucle
  I/O du lock.
- **[ÉLEVÉ] P3 bis — `library_stats` recalcule le scan de doublons complet à
  chaque affichage du dashboard** (`library.rs:107`). Fix : cache invalidé sur
  filing/`queue:changed`.
- **[MOYEN] Connexion SQLite unique derrière un seul Mutex** (`lib.rs:71`) :
  toute commande lente bloque toutes les autres. Le pattern « connexion
  séparée » existe déjà (scan, watcher — `ipc.rs:328-331`) : le répliquer pour
  les lectures lourdes (library_stats, list_ecartes, scan_duplicates).
- **[MOYEN] `list_filed` sans pagination** (`library.rs:134-231`) : 15k lignes
  × 15 colonnes sérialisées à chaque changement de filtre — c'est le pendant
  backend de P2/P5. `LIKE '%…%'` et `lower(format)` non indexables — le
  payload est le vrai coût, pas le scan.
- **[MOYEN] Index manquants** : seuls `source_id`, `status`, `analyzed_at`,
  `track_genres.track_id` existent. Ajouter `tracks(status, folder)` et
  `tracks(status, verdict)` pour les requêtes dashboard/facettes
  (`library.rs:88-106/236-246`).
- **[FAIBLE] `add_source` reliste tout pour retrouver l'id inséré**
  (`ipc.rs:65-70`).
- **[FAIBLE — à surveiller] Watcher : N upserts séquentiels sous un lock par
  batch débouncé** (`watcher.rs:116`) — OK à l'échelle actuelle, transaction
  groupée si les imports massifs passent par le watcher.
- **✅ Sain** : WAL + busy_timeout (`db.rs:144`), N+1 genres déjà éliminé
  (FIX-22), réseau jamais sous le Mutex DB, emits `analysis:changed` à payload
  vide + déjà coalescés côté front (RAF + debounce 300 ms).

## Plan de correction proposé (par tranches)

**Tranche 1 — quick wins, risque faible (1 session)** :
P6 (constante threads), P3 préfiltre durée + fingerprint dans le SELECT,
cache `library_stats`, transactions groupées `commit_file`, index composites,
`add_source` ciblé, `FftPlanner` OnceLock, préallocation `scratch`/`mags`.

**Tranche 2 — parallélisation encodage (P1)** : pool borné dans
`run_file_batch` en respectant le split phase1/2/3 existant. À faire seule
(chemin critique des données utilisateur — TDD + revue).

**Tranche 3 — virtualisation front (P2) + payload (P5)** : propager
`renderQueueWindow` aux 3 écrans, muter la ligne au tick batch, IPC paginé ou
évènement delta. Grosse tranche UI, testable au CDP.

**Tranche 4 — structurels à mesurer d'abord** : fusion probe/decode +
fingerprint dans la passe d'analyse, XML par batch (P4), lofty write
(mesure), `list_ecartes` hors lock.

## Addendum 2026-07-05 — ouverture d'une piste en détail (hors audit initial, signalé par Antoine)

Cause trouvée : à chaque ouverture (cache miss), `report-view.ts` téléchargeait le
fichier ENTIER dans la webview, le décodait intégralement (`decodeAudioData`),
puis le ré-encodait en WAV 16-bit **en JS échantillon par échantillon**
(40-80 Mo alloués) avant que WaveSurfer ne charge — pour tous les formats,
alors que Chromium lit MP3/FLAC/WAV nativement et que les peaks sont déjà
précalculés en Rust. Corrigé (vérifié au CDP dans la vraie app, lecture + seek
+ AIFF, zéro erreur console) : (1) `loadAudio` streame le fichier via le media
element (`ws.load(url, peaks, duration)` — le « direct load aborts » historique
ne se reproduit plus), l'AIFF passant par le transcode backend déjà en place
(`playback_url`, temp WAV gardé par mtime) ; (2) tout le pipeline
fetch/décode/ré-encode + son cache 4 entrées supprimés ; (3) `prefetchTrack`
exporté et câblé aux 3 sites d'ouverture (`prefetchNextAfter`, debounce 400 ms) :
la piste SUIVANTE de la queue a son rapport en cache et son AIFF pré-transcodé
avant qu'on clique. Nuance restante : le tout premier Play sur un AIFF jamais
transcodé peut ne rien faire pendant la durée du transcode FFmpeg — atténué par
le préchargement, à retraiter seulement si ça se sent en usage réel.

## Ce que l'audit n'a PAS couvert

Mesures runtime (aucun profil exécuté — `tauri dev` tournait, interdiction
cargo) ; le futur export USB (code inexistant) ; la consommation mémoire.
