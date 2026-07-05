# M8 — Spike complémentaire n°3 : flag reload metadata + acceptation XML (design)

> Statut : **design, à exécuter avant tout code Rust de M8.** Suite du
> brainstorm du 2026-07-06 (voir `docs/ressources-externes.md`, section
> Rekordbox) et des spikes précédents (Éval 5/7/11). Ce spike lève les deux
> inconnues qui bloquent actuellement
> `docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`
> (design Rust mis à jour, à lire en parallèle). Tant que les réponses ne sont
> pas actées ici, aucune ligne de Rust d'écriture ne doit être commencée.

## Intention

Deux idées ont émergé du brainstorm qui changent la nature du risque M8 :

1. **Rekordbox ne lit jamais les tags fichier après l'import** — il les cache
   dans `master.db`. Pour que la metadata Discogs de Sift (déjà écrite dans le
   fichier via `lofty`) apparaisse dans Rekordbox, il faut soit (a) écrire les
   tables normalisées (`djmdArtist`/`djmdAlbum`/`djmdGenre` + FK) nous-même —
   surface élevée, risque de corruption relationnelle — soit (b) **poser un
   flag qui dit à Rekordbox de rejouer sa propre logique d'import** au
   prochain lancement (case "Reload Tags" existante dans l'UI Rekordbox).
   L'option (b) est strictement préférable si elle existe et si elle ne
   déclenche PAS de ré-analyse audio.
2. **Grilles sacrées** : `djmdContent.Analysed`/`AnalysisUpdated` déclenchent
   une **ré-analyse complète** (BPM/clé/waveform/**grille**), destructrice si
   un DJ a corrigé une grille à la main. `TrackInfoUpdated` semble être un
   marqueur distinct (docstring pyrekordbox : "track info updated status"),
   séparé de `AnalysisUpdated` ("analysis updated status") et de `CueUpdated`
   ("cue updated status") — trois colonnes séparées dans
   `db6/tables.py:709-712`. C'est un indice fort, pas une preuve : la
   sémantique réelle vient de Pioneer, pas de pyrekordbox (docstrings = best
   guess de l'auteur pyrekordbox, jamais vérifié empiriquement).

Ce spike vérifie empiriquement, sur une copie complète, avant tout
engagement Rust.

## Ce qui existe déjà (réutiliser)

- `~/Desktop/sift-masterdb-write-probe/` — scripts des spikes précédents
  (baseline, path repair, playlist dedup, verrou). Réutiliser le pattern
  (copie jetable, connexion fraîche pour vérifier, jamais le fichier live).
- Lecteur SQLCipher Rust `src-tauri/src/rekordbox_masterdb.rs` — pas nécessaire
  pour ce spike (Python/pyrekordbox suffit, comme les spikes précédents), mais
  les colonnes trouvées ici doivent être documentées pour le futur design Rust.
- pyrekordbox `db6/tables.py` (installé localement,
  `%APPDATA%\Python\Python314\site-packages\pyrekordbox\db6\tables.py`) — déjà
  lu en session, colonnes `DjmdContent` pertinentes identifiées : `Analysed`,
  `AnalysisUpdated`, `TrackInfoUpdated`, `CueUpdated`, `FolderPath`,
  `FileNameL`, `FileNameS`.

## Protocole (4 tests, méthode commune)

**Commun à tous les tests** : copie **complète du dossier** (`master.db` +
`masterPlaylists6.xml` + dossier `PIONEER/rekordbox/share/pdb_data`/ANLZ si
présent — pas juste `master.db` comme les spikes précédents, c'est
justement ce qui manquait pour tester l'acceptation réelle). Modifier via
pyrekordbox sur la copie. **Puis swap manuel dans le vrai dossier Rekordbox
(Antoine, backup du dossier réel avant) et ouvrir le vrai Rekordbox** —
c'est le seul juge qui compte, un round-trip SQLite propre ne prouve rien
sur l'acceptation.

### Test 1 — Flag de reload metadata (le plus important)

1. Choisir une piste canary avec une **grille corrigée à la main** (nécessite
   qu'Antoine en ait une dans sa bibliothèque, ou en corriger une exprès sur
   la copie de test).
2. Modifier son tag fichier réel (ex. `Artist`) sans passer par master.db.
3. Sur la copie DB : `UPDATE djmdContent SET TrackInfoUpdated = <valeur non
   vue en pratique par le spike, à définir après lecture des valeurs
   existantes> WHERE ID = ...` — **ne toucher ni `Analysed` ni
   `AnalysisUpdated`**.
4. Swap, ouvrir le vrai Rekordbox.
5. Observer : (a) le nouveau tag apparaît-il ? (b) la grille a-t-elle bougé
   (comparer un screenshot/export avant-après) ? (c) y a-t-il eu une
   ré-analyse visible (icône de progression, changement de `Analysed`) ?

**Verdict attendu** : PASS si (a) oui et (b) non. Si (a) non → essayer
`ContentLink` ou une combinaison; documenter ce qui a été essayé. Si (b) oui
même avec (a) oui → **rejeté**, la grille est plus importante que
l'automatisation ; fallback = écriture directe des tables ou reload manuel.

### Test 2 — Acceptation `masterPlaylists6.xml` (bloquant depuis Éval 11)

1. Reprendre le protocole Task 3 (réparation `FolderPath`) des spikes
   précédents, mais cette fois sur la copie complète incluant
   `masterPlaylists6.xml`.
2. Modifier via pyrekordbox (`commit()` réécrit le XML — comportement déjà
   observé Éval 11).
3. Swap dans le vrai dossier, ouvrir le vrai Rekordbox.
4. Observer : Rekordbox accepte-t-il sans avertissement/réparation forcée ?
   Les pistes modifiées sont-elles saines (lecture, cues, grille intacts) ?

**Verdict attendu** : PASS/FAIL binaire + toute réparation automatique que
Rekordbox effectuerait à l'ouverture (documenter précisément, capture d'écran
si besoin).

### Test 3 — Colonnes exactes du path repair

1. Sur la copie, déplacer un fichier puis réparer via pyrekordbox.
2. Diff SQL avant/après sur `djmdContent` (toutes colonnes, pas seulement
   `FolderPath`) : confirmer que `FolderPath`, `FileNameL`, `FileNameS`
   changent ensemble, et quelles colonnes de suivi (`rb_local_usn`,
   `updated_at`, `rb_data_status`) bougent.
3. Pas de test d'acceptation Rekordbox séparé ici (déjà couvert par Test 2 si
   la piste canary de Test 2 est aussi une piste déplacée).

### Test 4 — Grille comme canary transversal

Pas un test séparé — la piste à grille corrigée à la main sert de canary
dans les Tests 1 et 2 : toujours vérifier son état après swap+ouverture,
avant de vérifier quoi que ce soit d'autre.

## Sortie attendue

`FINDINGS-m8-spike-3.md` dans `~/Desktop/sift-masterdb-write-probe/`
(mêmes conventions que les FINDINGS précédents) :
- Verdict PASS/FAIL par test, avec ce qui a été observé dans le vrai
  Rekordbox (pas seulement en SQLite).
- Valeur exacte à écrire dans `TrackInfoUpdated` (et toute colonne annexe
  nécessaire) si Test 1 passe.
- Confirmation ou infirmation de l'acceptation `masterPlaylists6.xml`.
- Liste complète des colonnes touchées par un path repair.

**Étape manuelle non déléguable** : l'ouverture du vrai Rekordbox et le
jugement visuel (grille, tags, absence d'avertissement) sont réservés à
Antoine — aucun agent ne peut les exécuter. Le spike doit être scripté pour
que la partie Python (préparation de la copie, modification, diff SQL)
tourne seule, avec un arrêt net avant l'étape "ouvrir le vrai Rekordbox" et
un rapport de ce qui a été préparé pour cette étape.

## Ce que ce spike NE couvre PAS (hors scope)

- Le portage Rust lui-même (design séparé, v2).
- L'écriture directe des tables normalisées (fallback de Test 1 seulement si
  le flag échoue — pas testé ici, ce serait un spike propre si besoin).
- La création de playlists (exclue du scope M8 par décision explicite,
  voir design v2).
- Tout flag/colonne au-delà de ceux listés ici (`Analysed`, `AnalysisUpdated`,
  `TrackInfoUpdated`, `CueUpdated`, `FolderPath`/`FileNameL`/`FileNameS`).

## Suite

1. Ce spike (session dédiée, Python + manip manuelle Antoine dans le vrai
   Rekordbox).
2. Mise à jour de `2026-07-06-m8-masterdb-write-path-rust-design-v2.md` avec
   les FINDINGS réels (remplacer les hypothèses par les valeurs vérifiées).
3. `superpowers:writing-plans` pour le plan d'implémentation Rust, seulement
   après (2).
