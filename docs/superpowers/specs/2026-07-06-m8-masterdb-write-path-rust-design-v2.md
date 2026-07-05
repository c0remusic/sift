# M8 — Write path Rust pour `master.db` Rekordbox (design v2)

> Statut : **design, bloqué sur le spike n°4.** Remplace
> `2026-07-04-m8-masterdb-write-path-rust-design.md` (v1, gardé pour
> historique — ne plus l'utiliser comme référence active). Suite du
> brainstorm du 2026-07-06 (`superpowers:brainstorming`) : élargit le
> scope de v1 (2 opérations figées) à 3 tiers priorisés par surface
> d'écriture, ajoute la stratégie "flag de reload" pour la metadata
> (au lieu d'écrire les tables normalisées nous-même), et précise la
> machinerie de sûreté.
>
> **Mise à jour 2026-07-06 (spike n°3 exécuté)** : Test 4 (grille) et Test 2
> (acceptation XML) PASS. Mais Test 3 (réparation de chemin) a **échoué de
> façon inattendue** — Rekordbox a silencieusement ignoré notre `FolderPath`
> et résolu vers un fichier tiers non modifié (voir
> `~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-3.md`, section 5).
> Test 1 (flag `TrackInfoUpdated`) reste **non testé** en conséquence (le
> mauvais fichier a été ouvert). Nouveau **Risque ouvert n°3** ci-dessous,
> bloquant, résolu par
> `docs/superpowers/specs/2026-07-06-m8-masterdb-spike-4-relink-mystery-design.md`
> avant de pouvoir continuer.

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
- Statut : **BLOQUÉ, plus le gate le plus proche d'être levé.** L'acceptation
  XML (spike n°3 Test 2) est confirmée, mais le spike n°3 a révélé que
  **l'écriture `FolderPath` elle-même n'a pas été respectée par Rekordbox** :
  la piste test a résolu vers un fichier tiers non modifié, jamais mentionné
  dans aucune valeur écrite en base (voir Risque ouvert n°3 ci-dessous).
  Tier 1 ne peut pas avancer vers un plan Rust tant que ce risque n'est pas
  résolu par le spike n°4.

## Risque ouvert n°3 — relink silencieux de Rekordbox sur `FolderPath` (nouveau, 2026-07-06)

**Constat** (spike n°3, détail complet dans
`~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-3.md` section 5) : un
`UPDATE djmdContent SET FolderPath=...` (+ `FileNameL`/`FileNameS` cohérents)
a été committé, le fichier écrit existe bien au chemin indiqué avec le bon
contenu (vérifié par hash) — mais à l'ouverture réelle de Rekordbox, la piste
a résolu vers un **troisième fichier**, un doublon octet-identique de
l'original, situé dans un tout autre dossier jamais mentionné dans master.db.
Aucun dialogue, aucune erreur — la substitution est silencieuse.

**Hypothèses écartées avec preuve** : que Rekordbox lisait une colonne
annexe (`rb_LocalFolderPath`/`OrgFolderPath`) contenant encore l'ancien
chemin — vérifié `None`/vide avant ET après sur les dumps du spike, écarté.

**Hypothèses restantes, non départagées** :
1. Rekordbox valide l'identité du fichier par empreinte (hash/taille) au
   chargement ; notre modification de tag (partie normale du flux Sift —
   Sift re-tague TOUJOURS en rangeant) change ce hash, provoquant un rejet
   silencieux et une recherche de relink qui retrouve un doublon intact
   ailleurs.
2. Rekordbox déclenche cette recherche de relink dès qu'un chemin pointe
   vers un dossier qu'il ne reconnaît pas comme surveillé — indépendamment
   du contenu du fichier.

**Implication si l'hypothèse 1 se confirme** : bloquant pour Tier 1 tel que
conçu — toute réparation de chemin accompagnant un re-tag (le cas d'usage
réel de Sift) serait silencieusement annulée par Rekordbox. Nécessiterait de
séparer réparation de chemin et re-tag en deux opérations, ou de comprendre
et satisfaire le mécanisme de validation exact de Rekordbox.

**Implication si l'hypothèse 2 se confirme (ou les deux réfutées)** : le
problème est spécifique au dossier de spike (jamais scanné par Rekordbox) et
n'affecterait pas un déploiement réel (fichiers déplacés dans la
bibliothèque déjà connue de l'utilisateur) — Tier 1 resterait viable tel
que conçu.

**Résolution** : spike n°4, protocole à 2 tests isolant chaque variable —
voir `docs/superpowers/specs/2026-07-06-m8-masterdb-spike-4-relink-mystery-design.md`.
Bloquant pour tout plan Rust tant que non résolu.

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

### Tier 3 — Synchro metadata via flag de reload (contingent au spike)

- **Stratégie primaire (si spike n°3 Test 1 passe)** : Sift écrit déjà les
  tags propres dans le fichier (`lofty`, pipeline de filing existant). Ajout :
  poser `TrackInfoUpdated` (valeur exacte = sortie du spike) sur la ligne
  `djmdContent` correspondante, **sans toucher** `Analysed`/`AnalysisUpdated`.
  Rekordbox rejoue sa propre normalisation (`djmdArtist`/`Album`/`Genre` + FK)
  au prochain lancement — Sift n'écrit aucune table normalisée.
- **Fallback (si le spike échoue)** : ce tier est retiré du scope de ce
  design et redevient un design séparé à haut risque (écriture directe des
  tables normalisées, find-or-create FK, nettoyage d'orphelins) — pas
  implémenté tant que ce design séparé n'existe pas.
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
   (Test 2) PASS. Réparation de chemin (Test 3) a révélé le Risque ouvert
   n°3 (relink silencieux) au lieu de confirmer le gate. Test 1 (flag
   `TrackInfoUpdated`) reste non testé en conséquence.
2. **Spike n°4** (`2026-07-06-m8-masterdb-spike-4-relink-mystery-design.md`)
   — isole la cause du relink (contenu modifié vs dossier non reconnu).
   **Bloquant**, à exécuter avant toute suite.
3. Mise à jour de ce design avec le verdict du spike n°4 — en particulier
   retester Tier 3 (flag `TrackInfoUpdated`) dans les conditions qui
   évitent le relink, une fois celui-ci compris.
4. `superpowers:writing-plans` — plan d'implémentation Rust : extension de
   `rekordbox_masterdb.rs` (encrypt/write/verify), TDD sur fixture
   synthétique existante, puis test sur copie réelle, tier par tier
   (Tier 1 d'abord). **Pas avant que le Risque ouvert n°3 soit résolu.**
5. Design UI d'intégration (séparé, après le moteur prouvé au moins pour
   Tier 1).

## Historique

- **v1** (2026-07-04) : scope figé à 2 opérations (path repair, dédup
  playlist), écriture directe des tables. Gardé pour référence historique
  uniquement.
- **v2** (2026-07-06) : élargit à 3 tiers, ajoute la stratégie flag de reload
  pour la metadata (évite l'écriture directe des tables normalisées), corrige
  le scope réel du path repair (3 colonnes, pas 1), ajoute le spike n°3
  comme gate bloquant avant tout code.
- **v2 mise à jour** (2026-07-06, même jour) : spike n°3 exécuté — grille et
  acceptation XML confirmées sûres, mais réparation de chemin a échoué de
  façon inattendue (relink silencieux Rekordbox vers un fichier tiers).
  Ajoute le Risque ouvert n°3, bloquant, avec le spike n°4 comme condition
  de déblocage.
