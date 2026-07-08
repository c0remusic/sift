# M8 — Write path Rust pour `master.db` Rekordbox (design v2)

> Statut : **Tier 1 confirmé sûr et livré (moteur+IPC+UI). Tier 2 confirmé
> sûr et livré (moteur+IPC+UI). Tier 3 : stratégie primaire (flag de reload
> seul) INFIRMÉE par test réel (2026-07-08) — voir mise à jour ci-dessous et
> section Tier 3 pour les deux chemins restants.** Remplace
> `2026-07-04-m8-masterdb-write-path-rust-design.md` (v1, gardé pour
> historique — ne plus l'utiliser comme référence active). Suite du
> brainstorm du 2026-07-06 (`superpowers:brainstorming`) : élargit le
> scope de v1 (2 opérations figées) à 3 tiers priorisés par surface
> d'écriture, ajoute la stratégie "flag de reload" pour la metadata
> (au lieu d'écrire les tables normalisées nous-même), et précise la
> machinerie de sûreté.
>
> **Mise à jour 2026-07-06 (spikes n°3 et n°4 exécutés)** : Test 4 (grille) et
> Test 2 (acceptation XML) PASS. Test 3 (réparation de chemin) avait d'abord
> semblé échouer — Rekordbox affichait un chemin ni le nôtre ni l'original —
> mais l'investigation du spike n°4 a montré que c'était une **fausse alerte** :
> deux pistes distinctes (même Titre/Artiste/Album, doublon réel préexistant
> dans la bibliothèque d'Antoine) prêtaient à confusion, pas un comportement
> de Rekordbox. Re-vérifié par ID exact au spike n°4 : **la réparation de
> chemin fonctionne correctement.** Le "Risque ouvert n°3" ci-dessous est
> **levé** — gardé en historique pour ne pas répéter l'investigation. Reste
> réellement ouvert : Test 1 (flag `TrackInfoUpdated`), jamais validé (les
> deux tentatives ont été confondues par le même problème de piste), à refaire
> avec vérification explicite par ID (voir
> `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-3.md`, section 5, et
> `FINDINGS-m8-spike-4.md`).
>
> **Mise à jour 2026-07-08 (Test 1 enfin retesté proprement, spike n°5)** :
> canary à titre unique cette fois (élimine structurellement la confusion des
> 2 tentatives précédentes) — `TrackInfoUpdated` incrémenté seul, Rekordbox
> ouvert : **le tag Artiste n'a PAS été rechargé automatiquement**
> (toujours l'ancienne valeur). L'action manuelle « Relire le tag » (clic
> droit), elle, fonctionne correctement. **Verdict : la stratégie primaire
> Tier 3 (flag seul → reload automatique) est infirmée.** Le mécanisme de
> reload lui-même n'est pas cassé — il n'est simplement jamais déclenché
> automatiquement par ce flag seul. Détail complet :
> `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-5-tier3-test1.md`.

## Intention (pourquoi ce chantier existe, et pourquoi v2)

Le cas utilisateur M8 : Sift déplace/ré-encode des fichiers (« déplacer =
encoder + ranger »), casse les chemins que Rekordbox connaît, et écrit une
metadata Discogs propre dans le fichier — invisible à Rekordbox tant qu'un
utilisateur ne fait pas "Reload Tags" manuellement piste par piste.

v1 gelait le scope à 2 opérations (repair `FolderPath`, dédup playlist) pour
garder le risque acceptable. Le brainstorm du 2026-07-06 a demandé "l'option
la plus puissante disponible" — ce qui a fait émerger deux idées qui changent
le calcul de risque plutôt que de simplement l'étendre :

1. **Rekordbox a déjà la logique d'import correcte** (normalisation
   `djmdArtist`/`Album`/`Genre` + FK) — Sift n'a pas besoin de la
   réimplémenter s'il peut simplement **dire à Rekordbox de la rejouer**. La
   commande "Reload Tags" existe déjà dans l'UI Rekordbox pour ça.
2. Cette possibilité dépend de l'existence d'un **flag de statut séparé de
   l'analyse audio** — sinon on retombe sur le risque de déclencher une
   ré-analyse complète, qui peut **déplacer une grille corrigée à la main**
   (inacceptable pour un DJ). Lecture de `pyrekordbox/db6/tables.py:598-712`
   (2026-07-06) : `djmdContent` a bien 3 colonnes de suivi distinctes —
   `AnalysisUpdated` ("analysis updated status"), `TrackInfoUpdated` ("track
   info updated status"), `CueUpdated` ("cue updated status") — en plus du
   flag grossier `Analysed` ("analysis status"). C'est un indice fort qu'un
   canal metadata-only existe, mais les docstrings sont la meilleure
   supposition de l'auteur pyrekordbox, pas la spec Pioneer — à vérifier
   empiriquement (spike n°3, Test 1) avant tout code. **Note de typage** :
   `AnalysisUpdated`/`TrackInfoUpdated`/`CueUpdated` sont `VARCHAR(255)`
   (chaîne), pas `Integer` comme `Analysed` — donc probablement des
   timestamps/versions en chaîne, pas des booléens 0/1 ; le spike n°3
   détermine le format réel avant d'écrire quoi que ce soit (voir Test 1).

## Règle non négociable (actée en brainstorm)

**La synchro metadata ne doit jamais déclencher de ré-analyse audio.** Ne
jamais flipper `Analysed`/`AnalysisUpdated` pour faire apparaître une
metadata. Si le seul levier disponible est le flag grossier d'analyse, la
route "flag" est **rejetée** pour la metadata (pas de contournement, pas de
"juste cette fois") et on retombe sur écriture directe des tables (à
re-designer séparément, risque élevé) ou reload manuel piste par piste.

## Scope : 3 tiers par surface d'écriture croissante

Chaque tier est un incrément livrable séparément, gated par sa propre preuve
(spike copie + acceptation réelle Rekordbox), sur le même moteur de sûreté
(Section suivante). Pas de big-bang.

### Tier 1 — Réparation de chemin (reprend v1, corrigé)

- **Colonnes réellement touchées** (correction vs v1, qui ne mentionnait que
  `FolderPath`) : `FolderPath`, `FileNameL`, `FileNameS` — les 3 doivent rester
  cohérentes (`pyrekordbox/db6/tables.py:619-624`). Confirmé par le spike n°3
  Test 3.
- Colonnes de suivi à poser explicitement (l'ORM pyrekordbox les gère, un
  `UPDATE` SQL nu ne les touche pas) : `rb_local_usn` (nouvelle valeur du
  compteur global `agentRegistry.localUpdateCount.int_1`, incrémenté de 1),
  `updated_at`. Valeurs exactes confirmées Éval 11 (spike n°2).
- Statut : **CONFIRMÉ SÛR — gate levé.** L'acceptation XML (spike n°3 Test 2)
  et la réparation de chemin elle-même (spike n°4 Test A, vérifié par ID
  exact) sont toutes deux confirmées fonctionnelles. Tier 1 peut avancer vers
  un plan Rust.

## Risque ouvert n°3 — relink silencieux de Rekordbox sur `FolderPath` (LEVÉ, 2026-07-06)

> **Statut : résolu, fausse alerte.** Gardé ci-dessous pour que la prochaine
> lecture de ce document ne re-découvre pas la même piste — pas parce que
> le risque est encore réel.

**Constat initial** (spike n°3) : un `UPDATE djmdContent SET FolderPath=...`
committé, fichier vérifié par hash au bon chemin — mais à l'ouverture réelle
de Rekordbox, un chemin tiers s'affichait, ni l'original ni celui écrit.

**Cause réelle, identifiée au spike n°4** : ce n'était **pas** un
comportement de Rekordbox. Requête directe sur `master.db` a montré
**deux lignes `djmdContent` distinctes** partageant le même Titre/Artiste/
Album (`ID=165700329`, notre canary, et `ID=26492393`, une piste préexistante
et sans rapport pointant depuis toujours vers un doublon octet-identique
ailleurs sur le disque). En cherchant par titre dans le navigateur Rekordbox,
il est impossible de distinguer les deux visuellement — la première
vérification manuelle a consulté la mauvaise piste. Reproduit et confirmé au
spike n°4 (Test A) : en vérifiant explicitement `ID=165700329`, `Emplacement`
affiche exactement le chemin écrit par le script. **Le mécanisme naïf
`UPDATE FolderPath`/`FileNameL`/`FileNameS` fonctionne correctement.**

**Découverte annexe (hors scope M8, notée séparément)** : le doublon réel
trouvé par accident (deux pistes identiques en apparence, fichiers
octets-identiques à deux emplacements) n'avait jamais été détecté avant ce
spike — voir mémoire projet `sift-m8-rekordbox-dedup-awareness` pour la
piste de fonctionnalité que ça ouvre (détection de doublons côté Rekordbox,
pas seulement côté Sift), explicitement reportée par Antoine pour l'instant.

Détail complet des deux investigations :
`~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-3.md` (section 5) et
`FINDINGS-m8-spike-4.md`.

### Tier 2 — Synchro playlist (existante uniquement, pas de création)

- **Sift ne crée jamais de playlist dans Rekordbox** (décision explicite du
  brainstorm) — seulement dédupliquer des entrées et **synchroniser une
  playlist existante** pour qu'elle reflète l'état Sift (ajouts/retraits de
  `djmdSongPlaylist`, réordonnancement `TrackNo`).
- Correspondance playlist Sift ↔ Rekordbox : par `ID` déjà connu de Sift (à
  spécifier au moment du plan — mécanisme de correspondance hors scope de ce
  design, qui couvre le moteur d'écriture, pas le matching applicatif).
- USN à bumper sur chaque ligne `djmdSongPlaylist` touchée, même logique que
  Tier 1.

### Tier 3 — Synchro metadata via flag de reload (STRATÉGIE PRIMAIRE INFIRMÉE, 2026-07-08)

- **Stratégie primaire testée et infirmée** : poser `TrackInfoUpdated` seul
  (sans toucher `Analysed`/`AnalysisUpdated`) sur la ligne `djmdContent`
  correspondante, dans l'espoir que Rekordbox rejoue sa propre normalisation
  (`djmdArtist`/`Album`/`Genre` + FK) au prochain lancement, sans action
  utilisateur. **Testé réellement le 2026-07-08 (spike n°5, canary à titre
  unique, sans ambiguïté possible) : le tag n'a PAS été rechargé
  automatiquement.** Voir
  `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-5-tier3-test1.md`.
  Cette route est morte telle quelle — ne plus la considérer comme viable
  sans un nouveau signal empirique (un AUTRE flag/mécanisme non testé ici).
- **Ce qui fonctionne, confirmé par le même test** : l'action manuelle
  « Relire le tag » (clic droit dans Rekordbox) recharge correctement le tag
  ID3 depuis le fichier — le mécanisme lui-même n'est pas cassé, seulement
  pas déclenché automatiquement par ce flag.
- **Deux chemins restants, aucun tranché** :
  1. Fallback déjà anticipé ci-dessous (écriture directe des tables
     normalisées) — redevient la seule route *automatique* restante si
     Tier 3 automatique est encore désiré.
  2. Renoncer à l'automatique : documenter pour l'utilisateur que les
     métadonnées Discogs écrites par Sift n'apparaissent dans Rekordbox
     qu'après un « Relire le tag » manuel — zéro code d'écriture
     supplémentaire, juste un geste utilisateur explicite (pas un fallback
     silencieux).
- **Fallback (écriture directe des tables normalisées)** : design séparé à
  haut risque (find-or-create FK, nettoyage d'orphelins) — pas implémenté,
  et pas designé en détail par ce document.
- **Communication utilisateur** : "les changements apparaissent après
  réouverture de Rekordbox" — pas de synchro live, Rekordbox doit relancer
  pour rejouer le reload.

## Ce qui existe déjà (à réutiliser, pas à réinventer)

- **Lecteur SQLCipher pur Rust** : `src-tauri/src/rekordbox_masterdb.rs`
  (déchiffrement page par page AES-256-CBC + HMAC-SHA512 vérifié avant
  déchiffrement, params SQLCipher v4 documentés en tête de fichier,
  réassemblage buffer SQLite en clair via `deserialize_read_exact`, jamais
  sur disque).
- **Erreurs** : enum `MasterDbError` — étendre, ne pas dupliquer.
- **Spikes de référence** : `~/Desktop/sift-masterdb-write-probe/` (hors
  repo) — scripts + `FINDINGS-m8-spike-2.md` (Tier 1) et, après exécution,
  `FINDINGS-m8-spike-3.md` (Tier 3 + acceptation XML).

## Architecture du moteur d'écriture (commune aux 3 tiers)

Symétrique du lecteur, même philosophie « ne pas réimplémenter SQLite » :

1. **Détecter Rekordbox fermé** — AVANT d'ouvrir le fichier (équivalent Rust
   de `pyrekordbox.utils.get_rekordbox_pid()`, crate `sysinfo` ou équivalent
   à confirmer via Context7 à l'implémentation). L'exception SQLite "database
   is locked" n'est qu'un filet a posteriori (Éval 7), jamais le garde-fou
   principal.
2. **Backup horodaté du dossier complet** (`master.db` +
   `masterPlaylists6.xml` + ANLZ pertinents — pas juste `master.db`, leçon du
   spike n°3) — vérifié lisible (ouverture + HMAC page 1) avant de continuer.
   Fail-fast si la copie échoue.
3. **Déchiffrer** tout `master.db` en buffer clair (code existant).
4. **Modifier** via `rusqlite` sur le buffer désérialisé — SQL ordinaire,
   scope fermé aux requêtes des tiers actifs uniquement (pas d'API générique
   « exécute du SQL sur master.db »).
5. **Re-sérialiser** (`Connection::serialize`), **rechiffrer** page par page :
   IV frais aléatoire par page (jamais réutiliser les IV lus), HMAC-SHA512
   recalculé sur `ciphertext || iv || page_number`, cas spécial page 1 (16
   octets de sel en clair). Constantes/géométrie déjà dans le module.
6. **Réplication `masterPlaylists6.xml`** — comportement exact déterminé par
   spike n°3 Test 2. Si Rekordbox exige une resynchro des Timestamps XML
   depuis `djmdPlaylist.updated_at`, la répliquer ; sinon, documenter
   pourquoi ce n'est pas nécessaire.
7. **Écrire atomiquement** : fichier temporaire même dossier → `rename`
   par-dessus. Jamais d'écriture in-place partielle.
8. **Round-trip vérifié** : rouvrir avec le lecteur existant (connexion
   fraîche), revérifier tous les HMAC, relire les valeurs modifiées, compter
   les tracks (inchangé sauf tier playlist).
9. **Rollback en un geste** : si la vérification échoue, ou si l'utilisateur
   signale un rejet par Rekordbox, restaurer le backup par le même
   `rename` atomique. Le rollback est une opération de premier ordre (bouton
   Revert dans le journal), pas une restauration manuelle de fichier.

## Invariants de sûreté (non négociables)

1. Backup obligatoire avant toute écriture, dossier complet, vérifié lisible.
2. Refuser d'écrire si Rekordbox tourne (détection process, pas juste
   l'exception de verrou).
3. Round-trip vérifié (connexion fraîche) avant de déclarer un succès.
4. Périmètre SQL fermé aux tables/colonnes des tiers actifs.
5. **Jamais flipper `Analysed`/`AnalysisUpdated` pour la metadata** (règle
   ajoutée en v2, section dédiée ci-dessus).
6. Rollback disponible comme action de premier ordre, pas seulement en cas
   d'échec de vérification interne — aussi si Rekordbox rejette visuellement
   le résultat une fois ouvert par l'utilisateur.

## Intégration app (esquisse, spec détaillée séparée)

- Surface de synchro Rekordbox, visible seulement si une bibliothèque
  Rekordbox est détectée.
- **Prévisualisation avant écriture** : diff lisible (N chemins à réparer, N
  pistes à synchroniser en metadata, N écarts de playlist) avant toute
  confirmation.
- **Confirmation in-app à deux clics, horodatée** — jamais `window.confirm()`
  (CLAUDE.md, incident réel WebView2) — réutiliser le pattern
  `confirmAction()`/armé→confirmé de `sift-live.ts`.
- **Blocage UI si Rekordbox tourne**, reflétant l'invariant #2 côté produit
  ("fermez Rekordbox pour continuer"), pas seulement une erreur backend.
- **Entrée de journal + Revert** après écriture, réutilisant le pattern du
  journal d'actions existant. Entrées metadata notent explicitement "visible
  après réouverture de Rekordbox".
- Design UI complet différé à une session dédiée, une fois le moteur prouvé.

## Séquencement recommandé

1. ~~**Spike n°3**~~ — exécuté 2026-07-06. Grille (Test 4) et acceptation XML
   (Test 2) PASS. Réparation de chemin (Test 3) avait d'abord semblé
   échouer, Test 1 (flag `TrackInfoUpdated`) resté non testé en conséquence.
2. ~~**Spike n°4**~~ — exécuté 2026-07-06 (Test A). A résolu le "relink" comme
   une fausse alerte (confusion entre 2 pistes distinctes, pas un
   comportement Rekordbox) — Tier 1 confirmé fonctionnel. Test B (isolation
   H1/H2) devenu sans objet, non exécuté.
3. ~~**Retest Tier 3**~~ — exécuté 2026-07-08 (spike n°5, canary à titre
   unique cette fois, aucune ambiguïté possible). **Verdict : stratégie
   primaire (flag seul) infirmée** — voir mise à jour en tête de document et
   section Tier 3. M8 n'est donc pas "entièrement dé-risqué" comme espéré,
   mais la question est tranchée : plus un point bloquant en attente, un
   verdict négatif définitif sur cette route précise.
4. `superpowers:writing-plans` — plan d'implémentation Rust : extension de
   `rekordbox_masterdb.rs` (encrypt/write/verify), TDD sur fixture
   synthétique existante, puis test sur copie réelle, tier par tier. **Fait
   pour Tier 1 et Tier 2** (moteur+IPC+UI livrés, voir
   `docs/plan-implementation.md`) — Tier 3 reste non commencé, sa stratégie
   primaire étant morte, une décision produit (fallback écriture directe vs
   renoncer à l'automatique) est requise avant de planifier son moteur.
5. Design UI d'intégration — **fait pour Tier 1 et Tier 2** (voir
   `docs/plan-implementation.md`).

## Historique

- **v1** (2026-07-04) : scope figé à 2 opérations (path repair, dédup
  playlist), écriture directe des tables. Gardé pour référence historique
  uniquement.
- **v2** (2026-07-06) : élargit à 3 tiers, ajoute la stratégie flag de reload
  pour la metadata (évite l'écriture directe des tables normalisées), corrige
  le scope réel du path repair (3 colonnes, pas 1), ajoute le spike n°3
  comme gate bloquant avant tout code.
- **v2 mise à jour** (2026-07-06, même jour) : spike n°3 exécuté — grille et
  acceptation XML confirmées sûres, réparation de chemin d'abord semblée
  échouer (relink apparent). Ajoute le Risque ouvert n°3, bloquant.
- **v2 mise à jour n°2** (2026-07-06, même jour) : spike n°4 exécuté — le
  Risque ouvert n°3 était une fausse alerte (confusion entre 2 pistes
  distinctes de même titre, pas un comportement Rekordbox). Tier 1 confirmé
  fonctionnel par vérification directe sur ID. Seul point réellement ouvert
  restant : retester Tier 3 (flag `TrackInfoUpdated`) avec vérification par
  ID, jamais fait correctement jusqu'ici.
- **v2 mise à jour n°3** (2026-07-08) : Tier 1 testé pour la première fois
  contre une copie d'un vrai `master.db` (Rust, pas le spike Python) — a
  trouvé et corrigé un vrai bug d'en-tête SQLite (mode WAL jamais géré par
  la VFS mémoire de `sqlite3_deserialize`), invisible sur le fixture
  synthétique. Round-trip complet validé sur la vraie bibliothèque
  (2828 pistes). Détail : `docs/ressources-externes.md`, Évaluation 18.
- **v2 mise à jour n°4** (2026-07-08, même jour) : Tier 2 (dédup des entrées
  de playlist dupliquées, scope "seulement dédupliquer" de cette section)
  livré côté moteur — `detect_playlist_duplicates`/`dedup_playlist_group`,
  chaîne de sûreté Tier 1 réutilisée telle quelle, zéro nouvelle dépendance.
  Vérifié contre la même copie réelle (un vrai doublon pré-existant trouvé
  et dédupliqué). Plan :
  `docs/superpowers/plans/2026-07-08-m8-tier2-playlist-dedup-rust.md`.
  Synchro de playlist complète (au-delà du dédoublonnage) reste hors scope,
  correspondance Sift↔Rekordbox toujours "à spécifier."
- **v2 mise à jour n°5** (2026-07-08, même jour) : Tier 3 Test 1 (flag
  `TrackInfoUpdated`) enfin retesté proprement (spike n°5, canary à titre
  unique — élimine la confusion qui avait invalidé les 2 tentatives
  précédentes). **Verdict négatif et définitif sur la stratégie primaire** :
  le flag seul ne déclenche aucun reload automatique du tag ID3 par
  Rekordbox. L'action manuelle « Relire le tag » fonctionne, elle. M8 n'est
  donc pas entièrement dé-risqué comme espéré au démarrage de ce document,
  mais la question Tier 3 est tranchée — reste une décision produit (design
  séparé à haut risque vs renoncer à l'automatique) avant tout code Tier 3.
  Détail : `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-5-tier3-test1.md`.
