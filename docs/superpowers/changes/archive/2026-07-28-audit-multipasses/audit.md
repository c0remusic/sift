> **RAPPORT DE COLLECTE DATÉ — plusieurs de ses chiffres et de ses portées ont été
> DÉMENTIS à l'exécution.** Ne pas s'en servir comme référence de l'état du code : c'est la
> base de preuve derrière les IDs cités par `plan.md`, telle qu'elle a été écrite le
> 2026-07-28, et rien de plus. Elle n'a PAS été relue ligne à ligne après coup.
>
> Erreurs constatées en corrigeant, à titre d'échantillon : SDP-5 annonçait « 1 ligne » pour
> ce qui était une perte de données ; SYS-3 décrivait une divergence sur `tracks.format`,
> colonne qu'aucun code de production n'écrit — donc inatteignable ; SIMP-5 comptait
> 34 classes CSS mortes aux lignes 1424-1467, c'est 37 aux lignes 1440-1483 et 1424 est du
> code vivant ; D-1(e) affirmait sortir wavesurfer du bundle, ce qu'il ne fait pas ; deux
> des trois « routages morts » de `CLAUDE.md` ne le sont pas. Les écarts complets, avec le
> commit qui les documente, sont dans l'encadré de tête de `plan.md`.
>
> Le verdict de chaque finding — retenu, partiel, rejeté — est dans `plan.md`, pas ici.

# AUDIT — Sift, audit multi-passes du 2026-07-28

Repo `C:\dev\sift`, branche `perf-mi-fixes`. Reference de tokens : `frontend/styles.css`.

Collecte executee en workflow : 7 passes en parallele (elles n'ont aucune dependance
entre elles), puis une passe Ralph de deduplication/arbitrage, puis un verdict final.
**Ecart au protocole, assume** : les 7 passes ont rendu leurs findings structures au
lieu d'appender dans ce fichier en parallele, ou elles se seraient ecrasees. Ce fichier
est ecrit en un geste, dans l'ordre des passes. Aucune ligne de code n'a ete modifiee.

## Compte brut

| Passe | Findings |
|---|---|
| clean-architecture | 12 |
| software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle | 12 |
| pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule | 17 |
| clean-code | 15 |
| code-review | 12 |
| simplify | 15 |
| steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes) | 10 |
| **total brut** | **93** |

Repartition avant deduplication : A = 13 · B = 42 · C = 32 · D = 6

---

## Passe 1 — clean-architecture

**Portee reellement balayee.**

OUVERT REELLEMENT (lecture, pas grep) — 22 fichiers en entier ou par plages larges : CLAUDE.md, AGENTS.md, .claude/rules/rust.md, .claude/rules/context-packs.md, docs/INDEX.json, package.json ; shared/contracts.ts (436 l., intégral) ; frontend/ ipc.ts, b85.ts, dom.ts, filing-toast.ts, filing-preview.ts, genre-families.ts, main.ts, selftest.ts, sift-live.ts (intégraux), + filing-bins.ts:1-90, filing.ts:335-380, batch-panel.ts:560-629, usb-format-modal.ts:160-189, app.js:254-302 ; src-tauri/src/ ipc.rs (intégral, 478 l.), ipc_library.rs:155-441, analysis/mod.rs:240-330, analysis/decode.rs:20-70+205-227, queue.rs:1-70+120-180, db.rs:1-12+205-255, filing.rs:1985-2033, ipc_filing.rs:165-180+295-334, encode.rs:55-75, b85_bytes.rs:1-80+125-146, rekordbox_repairs.rs:1-20+260-340+375-405, rekordbox_masterdb.rs:1010-1085+930-990, lib.rs:204-294, genres.rs:1-60, ecartes.rs:10-30, actions.rs:995-1020, sources.rs:21-35, dedup.rs:18-25, metadata/mod.rs:10-30.

NEGATIFS PROUVES (balayages non vides, rejouables) :
1. Parité des commandes IPC : 69 noms `invoke("…")` extraits des 40 fichiers frontend/*.ts vs 69 commandes de `generate_handler!` (lib.rs:204-274). `comm -23` ET `comm -13` renvoient tous deux le vide — aucune commande orpheline ni non enregistrée dans les deux sens.
2. Règle de dépendance côté Rust : balayage de `tauri::|AppHandle|tauri::command` sur les 40 .rs de src-tauri/src/. Occurrences uniquement dans ipc*.rs (5 fichiers), lib.rs, worker.rs, watcher.rs, db.rs (1 ligne), dev_*.rs, bench_volume.rs, rekordbox_repairs.rs (1 ligne de doc). ZERO dans filing.rs, actions.rs, library.rs, naming.rs, encode.rs, dedup.rs, analysis/*, metadata/*, usb_format/*. Le framework est bien confiné — c'est le point fort de cette archi, et le pattern `_inner(conn)` + wrapper `#[tauri::command]` (ipc_library.rs:238/272/338, rekordbox_repairs.rs:1-10) est un Humble Object correctement appliqué.
3. Dérive de contrat ACTUELLE : j'ai comparé champ par champ 8 types NON couverts par les 13 tests de forme — Source (sources.rs:21), EcarteItem (ecartes.rs:12), JournalEntry (actions.rs:999), DupMatch (dedup.rs:18), FileTags (ipc_filing.rs:169), MetadataEdit (metadata/mod.rs:14), PendingMasterdbRepair (rekordbox_repairs.rs:18), PendingMetadataSync (rekordbox_repairs.rs:378) contre shared/contracts.ts. Aucune divergence de champ aujourd'hui. Les findings CA-3/CA-9 portent sur l'absence de garde, pas sur une dérive constatée.
4. Cycles d'import frontend : graphe d'imports relatifs extrait pour les 40 frontend/*.ts. Aucun cycle statique. Les 5 `registerXxxHook` (filing-bins.ts:66/74, filing-toast.ts:10, queue-panel.ts:742, batch-panel.ts:673) cassent chacun un cycle réel et sont documentés ; je ne les signale pas comme défaut en soi (CA-7 vise l'état exporté, pas le hook).
5. Pas de sentinelle `UPSCALE` : balayage frontend/*.ts + src-tauri/src/*.rs, aucun résultat (le refus d'upscale passe par `EncodeError::Upscale`, encode.rs:56, jamais mirroré côté TS).

NON COUVERT (dit explicitement) : je n'ai PAS ouvert report-view.ts (64 Ko), rekordbox-view.ts (46 Ko), queue-panel.ts (41 Ko), filing-identify.ts (43 Ko), library-detail.ts, journal.ts, home-sources.ts, reglages-view.ts, chrome.ts, ecartes-view.ts, bibliotheque-view.ts (greps ciblés seulement), list-virtual.ts, library-views.ts, progress-zone.ts, confirm-modal.ts, batch-tracklist.ts, identify-shared.ts. Côté Rust : le CORPS de actions.rs (125 Ko), filing.rs (79 Ko, seulement la signature de plan_file et le mod tests), rekordbox_xml.rs (55 Ko), le reste de rekordbox_masterdb.rs (129 Ko), library.rs, naming.rs, search_terms.rs, search_corpus.rs, tagging.rs, scanner.rs, worker.rs (sites de lock seulement), usb_format/*, analysis/* hors mod.rs+decode.rs. Aucun cargo/npm lancé (interdit + tauri dev possiblement concurrent) : aucun finding ne repose sur une exécution, tous sur de la lecture. Aucune vérification runtime/UI. Les magnitudes de CA-2 (durée du gel) sont raisonnées, pas mesurées.

### [CA-1] Une phrase francaise d'UI est la condition d'une suppression de ligne DB, a travers 3 couches, et son test de garde autorise la divergence
- Passe : clean-architecture
- Emplacement : `src-tauri/src/ipc.rs:324`
- Preuve : decode.rs:36 (couche la plus basse, adaptateur Symphonia) produit `"le fichier n'existe plus a cet emplacement — a-t-il ete deplace ou supprime ?"`. Deux couches au-dessus s'en servent comme d'un code de controle : ipc.rs:324 `if allow_forget && e.contains("n'existe plus") && !std::path::Path::new(&path).exists()` -> `scanner::forget_path` (ipc.rs:327), soit la SUPPRESSION de la ligne tracks ; et filing.ts:354 `if (msg.includes("n'existe plus")) fileGone = true`. Le seul test qui epingle la chaine est decode.rs:222-225 : `assert!(err.contains("n'existe plus") || err.contains("introuvable"), ...)` — un OU, donc il reste VERT si le message devient "fichier introuvable…". La sous-chaine n'est meme pas unique dans le crate : rekordbox_repairs.rs:306 emet un autre message qui la contient aussi.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Un dev reformule decode.rs:36 en "fichier introuvable a cet emplacement — deplace ou supprime ?" (exactement le type de retouche que l'audit UX F2 a deja fait sur ce chemin). `cargo test` reste VERT : decote.rs:223 accepte "introuvable". Consequence immediate : (a) ipc.rs:324 ne declenche plus forget_path -> la ligne pending d'un fichier supprime n'est jamais retiree -> l'auto-avance de Revue rouvre indefiniment la meme piste disparue, le bug exact documente en commentaire ipc.rs:313-318 ("found live, 2026-07-20") revient ; (b) filing.ts:354 ne met plus fileGone a true -> l'ecran Revue affiche l'erreur brute au lieu du parcours fichier-disparu. Deux regressions silencieuses, zero test rouge.
- Fichiers : `src-tauri/src/analysis/decode.rs`, `src-tauri/src/ipc.rs`, `frontend/filing.ts`, `shared/contracts.ts`
- Correctif esquisse : Introduire un variant/sentinelle stable et non traduisible (ex. `FILE_GONE`) exporte dans shared/contracts.ts, produit par decode.rs et teste par egalite exacte cote Rust (meme motif include_str! que filing.rs:1996-2014). La phrase francaise redevient un simple libelle d'affichage, plus une condition. Remplacer le `||` de decode.rs:223 par une assertion d'egalite sur le sentinel.

### [CA-2] Le Mutex<Connection> global est tenu pendant des E/S externes non bornees (export XML, ecriture master.db), contre la regle ecrite deux fonctions plus haut dans le meme fichier
- Passe : clean-architecture
- Emplacement : `src-tauri/src/ipc_library.rs:366`
- Preuve : `export_rekordbox_xml` prend le verrou global (ipc_library.rs:366 `let conn = db::lock_conn(&conn)?;`) puis appelle `export_rekordbox_xml_inner` (ligne 367) qui enchaine fs::read du XML (344), parse (345), merge_filed_tracks (346), write (347), fs::write (348) — le MutexGuard vit jusqu'a la fin de la fonction. Meme motif pour les 5 commandes master.db : ipc_library.rs:427-428 prend le verrou puis appelle `apply_repairs_inner`, qui boucle sur les ids et appelle `repair_track_path` (rekordbox_repairs.rs:320) -> `with_masterdb_write` (rekordbox_masterdb.rs:939-982) : backup_rekordbox_files, fs::read integral de master.db, decrypt_masterdb, mutation, encrypt_masterdb, fs::write, rename, puis relecture+parse complete de verification. Le meme fichier documente pourtant la regle inverse deux fois : ipc_library.rs:155-161 ("Does NOT hold the global Mutex<Connection> across ... that would starve every other IPC command sharing the lock, including the background analysis pool's persist_result") avec la portee de verrou explicitement decoupee en 166-178, et ipc_library.rs:279-283 ("this command is called on every visit to the Rekordbox screen, so it must not run under the global connection mutex").
- Impact : perf
- Effort : M
- Risque du fix : moyen
- Note : **A**
- Scenario de defaillance : Bibliotheque Rekordbox reelle (master.db de plusieurs centaines de Mo, XML de plusieurs milliers de pistes). L'utilisateur clique "Reexporter maintenant", ou applique 3 reparations Tier 1 d'un coup. Pendant toute la duree (lecture + decrypt + reencrypt + reecriture + relecture de verification, x N ids), TOUT le reste bloque sur le meme mutex : list_queue (queue.rs:51, chemin critique de l'ouverture de Revue), analyze_path (cache read ipc.rs:263), worker::persist_result et refill (worker.rs:188-192). L'app parait gelee, y compris l'analyse de fond qui s'arrete. Le PRD 2026-07-27 pose justement un budget de 50 ms sur la boucle de rangement et declare le decoupage de ce verrou BLOQUANT.
- Fichiers : `src-tauri/src/ipc_library.rs`, `src-tauri/src/rekordbox_repairs.rs`, `src-tauri/src/rekordbox_masterdb.rs`
- Correctif esquisse : Appliquer a ces 6 commandes le decoupage deja demontre par scan_library_duplicates (ipc_library.rs:166-178) : lire sous verrou ce dont on a besoin (settings, liste des lignes/ids), relacher, faire l'E/S externe hors verrou, reprendre un verrou bref pour les UPDATE de statut. Pour export : list_filed sous verrou -> drop -> read/parse/merge/write -> relock pour drift_detected.

### [CA-3] Huit litteraux de code d'erreur traversent l'IPC en dur des deux cotes sans aucun test miroir, alors que le mecanisme existe et n'est branche que sur 2 constantes
- Passe : clean-architecture
- Emplacement : `src-tauri/src/filing.rs:1996`
- Preuve : Le projet possede le garde : filing.rs:1996 `const CONTRACTS_TS: &str = include_str!("../../shared/contracts.ts");` puis deux tests (1999-2014) qui assertent que le litteral Rust apparait dans le fichier TS. Il ne couvre que FILE_IN_PLACE et EXTERNAL_DEST_PREFIX. Les 8 autres litteraux qui franchissent la meme frontiere sont apparies a la main, cote TS par sous-chaine : "RAIL_MISMATCH" (filing.rs:57 -> filing-actions.ts:97), "NoLibraryRoot" (ipc_filing.rs:47 -> filing-actions.ts:116 + batch-panel.ts:608), "ALREADY_FILING" (ipc_filing.rs:307 -> filing-actions.ts:120), "NO_TOKEN" et "RATE_LIMITED:" (metadata/mod.rs:255-256 -> filing-identify.ts:384/397 + library-detail.ts:236/246), "source gone" (actions.rs:627 -> filing-actions.ts:289 + filing-toast.ts:81 + journal.ts:174), "n'existe plus" (voir CA-1), "aucun XML" (ipc_library.rs:341 -> sift-live.ts:124). Aucun de ces 8 n'est declare dans shared/contracts.ts, aucun n'a de test.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : actions.rs:627 `RevertError::Blocked(format!("source gone: {to}"))` est reformule en francais (coherent avec la politique d'humanisation deja appliquee ailleurs). cargo test et tsc restent verts. Les 3 sites TS qui le testent (filing-actions.ts:289, filing-toast.ts:81, journal.ts:174) tombent dans leur branche generique : au lieu de "Annulation impossible : un fichier necessaire a disparu — l'original a peut-etre ete purge de la corbeille." (filing-toast.ts:83), l'utilisateur recoit "Echec de l'annulation : <texte brut>", sur les 3 surfaces d'undo a la fois.
- Fichiers : `src-tauri/src/filing.rs`, `shared/contracts.ts`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/actions.rs`, `src-tauri/src/metadata/mod.rs`
- Correctif esquisse : Declarer les 8 sentinelles comme constantes exportees dans shared/contracts.ts, les importer cote TS (fin du `msg.includes("litteral")`), et etendre le bloc de tests filing.rs:1996-2014 avec un test par sentinelle sur le meme motif include_str!. Cout : ~8 tests de 5 lignes.

### [CA-4] IDENTITY_MISMATCH / DRIVE_VANISHED sont produits, documentes, et honores par aucun consommateur — le garde de securite du formatage USB meurt au dernier metre
- Passe : clean-architecture
- Emplacement : `frontend/usb-format-modal.ts:170`
- Preuve : Cote Rust, usb_format/mod.rs:62-63 emet deliberement deux sentinelles distinctes (`DRIVE_VANISHED`, `IDENTITY_MISMATCH`) avec le commentaire ligne 46 : "(meme convention que FilingError/RAIL_MISMATCH) so the frontend can pattern-match distinctly". frontend/ipc.ts:386-388 documente le contrat cote client : "the backend re-checks it against a fresh listing immediately before formatting and rejects with IDENTITY_MISMATCH/DRIVE_VANISHED if the drive was swapped". Or le SEUL consommateur, usb-format-modal.ts:165-179, ne teste ni l'un ni l'autre : `const humanized = /access|denied|permission/i.test(raw) ? … : /not found|no such|introuvable/i.test(raw) ? … : "Echec du formatage. Verifie que le disque est bien branche et reessaie."`. Balayage confirme : `grep -rn "IDENTITY_MISMATCH|DRIVE_VANISHED" frontend/*.ts` ne matche que le commentaire d'ipc.ts:388, aucun code.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : L'utilisateur liste les disques, debranche la cle A et branche la cle B sur le meme port, puis confirme le formatage. Le backend detecte correctement le swap et refuse avec IDENTITY_MISMATCH. Le modal affiche "Echec du formatage. Verifie que le disque est bien branche et reessaie." — un message qui invite a RECOMMENCER un formatage sur un disque dont Sift vient de dire qu'il n'est pas celui choisi, et qui ne mentionne jamais le swap. Le retry echoue a l'identique (volume_serial toujours perime) : cul-de-sac muet sur l'operation la plus destructive de l'app.
- Fichiers : `frontend/usb-format-modal.ts`, `src-tauri/src/usb_format/mod.rs`, `frontend/ipc.ts`
- Correctif esquisse : Ajouter en tete de la cascade usb-format-modal.ts:170 deux branches sur les sentinelles exactes : IDENTITY_MISMATCH -> "Ce n'est plus la meme cle qu'a la selection — reactualise la liste avant de formater" (+ forcer un relist) ; DRIVE_VANISHED -> "Cle debranchee". A brancher avec CA-3 (constantes partagees).

### [CA-5] L'invariant anti-double-rangement de plan_file appartient a un static prive de la couche adaptateur et fuit dans la signature du domaine
- Passe : clean-architecture
- Emplacement : `src-tauri/src/filing.rs:417`
- Preuve : `filing::plan_file` (domaine, sans dependance Tauri) prend `reserved: &HashSet<String>` en parametre (filing.rs:430) et s'en sert pour ecarter les destinations deja revendiquees (filing.rs:387-406, `ensure_unique_reserved`). Mais le registre reel est un static prive de la couche IPC : ipc_filing.rs:324-333 `struct InFlightFilings { tracks, dests }` + `fn inflight() -> &'static Mutex<InFlightFilings>` avec `static REG: OnceLock<…>`, lu via `reserved_dests()` (ipc_filing.rs:339). Le domaine ne peut donc ni constituer ni verifier l'invariant : il depend d'un parametre que chaque appelant doit penser a remplir. Le commentaire ipc_filing.rs:318-323 documente le sinistre passe : "`dests` replaces the empty `reserved` set `file_track` used to pass plan_file … two tracks reconciling to the same name would be handed the SAME destination and the second encode would land on the first".
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Un futur appelant de `filing::plan_file` hors ipc_filing.rs (auto-rangement declenche au scan, rejeu depuis le watcher, outil de maintenance, test d'integration) passe `&HashSet::new()` — exactement ce que file_track faisait avant le correctif P5. Rien ne l'en empeche : le type est un HashSet vide parfaitement valide, aucun test ne couvre cet appelant, et le registre n'est pas accessible depuis le domaine. Deux conversions planifiees avant que le premier fichier existe sur disque recoivent la meme destination, le second encodage ecrase le premier. Perte de fichier, deja survenue une fois.
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Deplacer le registre (tracks + dests) dans filing.rs derriere une API etroite (`filing::claim(track_id, dest) -> Result<Claim, AlreadyFiling>` avec liberation au Drop), et faire de `plan_file` le seul point qui le consulte — le parametre `reserved` disparait de la signature publique. ipc_filing.rs redevient un appelant comme un autre.

### [CA-6] La regle metier rail -> format de sortie par defaut est ecrite deux fois, en Rust et en TS, et un seul des deux exemplaires est teste
- Passe : clean-architecture
- Emplacement : `frontend/filing-preview.ts:17`
- Preuve : Rust : encode.rs:64-68 `pub fn target_for(rail: Rail) -> Target { match rail { Rail::Lossless => Target::Aiff1644, _ => Target::Mp3320 } }`, teste a encode.rs:187-189. TS : filing-preview.ts:17-19 `function defaultTarget(rail: string): Target { return rail === "lossless" ? "aiff_16_44" : "mp3_320"; }`. La version TS pilote l'extension du nom final affiche dans le rail (filing-preview.ts:100 `targetExt(state.target ?? defaultTarget(state.rail))`) ET la pastille de format allumee (filing.ts:160). La version Rust pilote l'encodage reel des que le front envoie `target: null`, ce qu'il fait par defaut (filing-actions.ts:72 passe `state.target`, qui vaut null tant que l'utilisateur n'a pas clique une pastille). Aucun test miroir, et package.json:6-15 ne declare aucun script de test frontend — la copie TS n'est couverte par rien.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Decision produit : le rail lossless part desormais en WAV. On modifie encode.rs:66 en `Rail::Lossless => Target::Wav1644` et on met a jour encode.rs:187 — cargo test vert, clippy vert, tsc vert. filing-preview.ts:18 reste sur aiff. Sur toute piste lossless ouverte sans clic de pastille : le rail affiche "-> Artiste — Titre.aiff", la pastille AIFF est allumee, et le fichier reellement ecrit sur disque est un .wav. Le nom final promis a l'utilisateur ne correspond pas au fichier produit, sur le chemin par defaut.
- Fichiers : `frontend/filing-preview.ts`, `src-tauri/src/encode.rs`, `frontend/filing-actions.ts`
- Correctif esquisse : Supprimer la copie TS : faire resoudre le defaut par le backend (exposer le target effectif via `reconcile` ou un champ du QueueItem), ou a defaut ajouter un test Rust include_str! sur frontend/filing-preview.ts asserant que les deux litteraux de target_for y figurent, sur le motif filing.rs:1996-2014.

### [CA-7] bibState appartient a bibliotheque-view.ts mais 23 de ses 24 mutations vivent dans l'orchestrateur — le module qui possede l'etat ne possede aucun de ses invariants
- Passe : clean-architecture
- Emplacement : `frontend/sift-live.ts:404`
- Preuve : `bibState` est declare et exporte mutable par bibliotheque-view.ts:28-40. Balayage des assignations sur les 40 frontend/*.ts : UNE seule dans le module proprietaire (bibliotheque-view.ts:291 `bibState.filter.q = q.value || undefined`), 23 dans sift-live.ts (lignes 303-308, 310-311, 332-333, 369, 372, 375, 384, 392-395, 404-406). L'invariant le plus fort — folder / genre / artist sont mutuellement exclusifs — n'existe qu'a sift-live.ts:404-406 (`bibState.filter.folder = key === "folder" ? next : undefined;` etc.), nulle part dans le module qui detient le champ. Meme constat pour bibDup, dont le commentaire bibliotheque-view.ts:43-45 assume la reassignation croisee ("Reassigned both here and from sift-live.ts's click handler").
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Ajout d'une 4e facette (Label, Annee) : le champ se declare dans bibliotheque-view.ts, la regle d'exclusion doit etre ajoutee a sift-live.ts:404-406 — un fichier different, dans un handler de clic delegue de 250 lignes. L'oubli ne produit ni erreur tsc ni exception : deux filtres de facette restent poses simultanement, la liste se vide sans explication, et le seul recours utilisateur est le stat-card "Tous" (sift-live.ts:303-308) qui, lui, remet a undefined les 6 champs enumeres en dur — donc pas le nouveau.
- Fichiers : `frontend/bibliotheque-view.ts`, `frontend/sift-live.ts`
- Correctif esquisse : Exporter depuis bibliotheque-view.ts des mutateurs etroits (`pickFacet(key, val)`, `setQuality(q)`, `resetFilters()`) et rendre bibState non exporte (ou readonly). sift-live.ts garde le dispatch de clic (choix documente) mais appelle des fonctions au lieu d'ecrire dans l'etat d'autrui.

### [CA-8] db::lock_conn est taille pour un seul appelant (State Tauri + erreur String), donc ~20 sites de lock hors IPC rejouent chacun leur politique de mutex empoisonne — dont un qui abandonne en silence
- Passe : clean-architecture
- Emplacement : `src-tauri/src/db.rs:8`
- Preuve : db.rs:3 `use tauri::State;` puis db.rs:8-12 `pub fn lock_conn<'a>(conn: &'a State<'_, Mutex<Connection>>) -> Result<MutexGuard<'a, Connection>, String>`. Le module de persistance importe donc le framework ET renvoie le type d'erreur de la couche de livraison — l'helper ne sert que les fonctions `#[tauri::command]`. Son doc-comment (db.rs:5-7) revendique remplacer "~40 duplicated call sites across ipc*.rs" : across ipc*.rs, precisement. Balayage `\.lock()` : 20 sites restants hors commande IPC, chacun avec sa propre politique. worker.rs:189-192 logge avant de bailer (le correctif documente dans .claude/rules/rust.md:73-80), mais worker.rs:202 `let Ok(mut q) = m.lock() else { return };` est muet, et watcher.rs:33-39 abandonne en silence sur TROIS echecs consecutifs (lock empoisonne, prepare, query_map) sans une seule ligne de log.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un panic quelconque survient pendant qu'un thread tient le Mutex<Connection> (worker.rs analyse un fichier corrompu hors catch_unwind, un scan concurrent, un revert). Le mutex est empoisonne. Au prochain `watcher::start_all` (relance de source, changement de reglage), watcher.rs:33 `let Ok(conn) = state.lock() else { return };` sort sans rien logger : AUCUN watcher ne demarre. L'app continue de tourner, l'utilisateur depose des fichiers dans un dossier surveille, rien n'apparait dans la file, et il n'existe aucune trace dans les logs pour le diagnostiquer.
- Fichiers : `src-tauri/src/db.rs`, `src-tauri/src/watcher.rs`, `src-tauri/src/worker.rs`
- Correctif esquisse : Elargir la signature a `lock_conn(conn: &Mutex<Connection>) -> Result<MutexGuard<'_, Connection>, String>` (les appels `db::lock_conn(&conn)` depuis un State continuent de compiler par deref) et retirer `use tauri::State` de db.rs ; ajouter une variante `lock_conn_logged(ctx: &str) -> Option<MutexGuard>` qui logge, et l'utiliser sur les 20 sites hors IPC en commencant par watcher.rs:33 et worker.rs:202.

### [CA-9] Les pointeurs de miroir de shared/contracts.ts sont perimes pour 8 types M8 — la seule carte qui traverse la frontiere manuelle pointe vers le mauvais fichier
- Passe : clean-architecture
- Emplacement : `shared/contracts.ts:347`
- Preuve : contracts.ts annonce trois familles comme "(mirror of src-tauri/src/ipc_library.rs)" : ligne 347 (M8 Tier 1 : CandidateTrack, PendingMasterdbRepair, ApplyRepairOutcome), ligne 373 (M8 Tier 3 metadata : PendingMetadataSync, ApplyMetadataSyncOutcome), ligne 421 (M8 Tier 2 : PlaylistDuplicateEntryDto, PlaylistDuplicateGroupDto). Balayage des declarations reelles : rekordbox_repairs.rs:18 (PendingMasterdbRepair), :42 (CandidateTrack), :50 (ApplyRepairOutcome), :378 (PendingMetadataSync), :876 (PlaylistDuplicateGroupDto). Aucun de ces structs n'est dans ipc_library.rs, qui n'en fait que des `pub use` (ex. ipc_library.rs:433). Cause : l'extraction de rekordbox_repairs.rs hors d'ipc_library.rs le 2026-07-09 (documentee en tete de rekordbox_repairs.rs:6-10 et dans CLAUDE.md) a deplace le code sans mettre a jour le miroir. Seul le bloc artwork (ligne 399) pointe correctement.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `shared/contracts.ts`, `src-tauri/src/rekordbox_repairs.rs`, `src-tauri/src/ipc_library.rs`
- Correctif esquisse : Corriger les 3 en-tetes de section (lignes 347, 373, 421) vers src-tauri/src/rekordbox_repairs.rs. Accessoirement : etendre les tests de forme (13 aujourd'hui, 11 types sur ~40) a PendingMasterdbRepair/PendingMetadataSync/PendingArtworkSync, les 3 formes M8 quasi identiques et donc les plus faciles a desynchroniser entre elles.

### [CA-10] Le vecteur fige base85 se declare gardien du decodeur frontend mais rien ne les relie, et aucun runner de test frontend n'existe pour l'executer
- Passe : clean-architecture
- Emplacement : `src-tauri/src/b85_bytes.rs:127`
- Preuve : b85_bytes.rs:127-129 : "Frozen cross-implementation vector: any independent decoder (e.g. the frontend one) must map this exact string back to the bytes 0x00..=0x0F. Do not regenerate it from the code it is meant to check." Le test (b85_bytes.rs:130-137) n'assere que le round-trip Rust contre lui-meme. Le decodeur vise, frontend/b85.ts, est un portage manuel a la main des internes d'une crate tierce — ses commentaires se referent a des NUMEROS DE LIGNE d'une version precise (b85.ts:12 "base85-2.0.0/src/lib.rs:31-33 for the table, :125-176 for decode", b85.ts:64 "base85-2.0.0/src/lib.rs:158-162"), alors que src-tauri/Cargo.toml:49 declare `base85 = "2.0.0"`, soit un caret `^2.0.0`. Rien ne relie l'alphabet de b85.ts:19 a celui de la crate, et package.json:6-15 ne declare aucun script de test : le fichier n'est couvert par rien.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/b85_bytes.rs`, `frontend/b85.ts`, `src-tauri/Cargo.toml`, `package.json`
- Correctif esquisse : Ajouter dans b85_bytes.rs un test include_str!("../../frontend/b85.ts") qui assere que la chaine d'alphabet exacte y figure, meme motif que filing.rs:1996-2014 — un test Rust suffit, pas besoin d'introduire un runner TS. Optionnel : epingler `base85 = "=2.0.0"` puisque le portage TS est pinne a ses internes.

### [CA-11] La couture entre app.js (artefact fige, execute en prod) et la couche live est un jeu de 7 globales window optionnelles et non typees
- Passe : clean-architecture
- Emplacement : `frontend/sift-live.ts:167`
- Preuve : sift-live.ts:167-173 pose 7 globales (`window.__siftHome`, `__siftQueue`, `__siftEcarts`, `__siftReglages`, `__siftBiblio`, `__siftJournal`, `__siftRkb`), declarees toutes optionnelles en sift-live.ts:533-543 (`__siftHome?: () => void`). app.js les appelle avec une garde de presence : lignes 108, 147, 252, 300, 312, 354, 372, motif `if(window.__siftBiblio)window.__siftBiblio();`. Sous Tauri, le rendu maquette est explicitement saute (app.js:258 `if(!('__TAURI_INTERNALS__' in window)){ … }`), donc l'ecran ne recoit AUCUN contenu si la globale manque. CLAUDE.md avertit par ailleurs que app.js "s'execute reellement dans Tauri, importe sans garde inTauri par main.ts:6" — cette couture est donc de production, pas de maquette.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/sift-live.ts`, `frontend/app.js`, `frontend/main.ts`
- Correctif esquisse : Remplacer les 7 globales par un objet unique enregistre une fois (`window.__sift = { home, queue, … }`) type par une interface non optionnelle exportee, et faire echouer bruyamment app.js sous Tauri quand une entree manque (meme philosophie que dom.ts:14-24 requireEl, qui transforme deja le no-op silencieux en erreur situee).

### [CA-12] Le gating dev-only est incoherent : dev-inspector est derriere import.meta.env.DEV, le self-test est charge dans tout build
- Passe : clean-architecture
- Emplacement : `frontend/main.ts:37`
- Preuve : main.ts:45-47 gate correctement l'outil d'annotation : `if (import.meta.env.DEV) { void import("./dev-inspector")… }`, avec le commentaire ligne 44 "dev builds only — never in a shipped app". Juste au-dessus, main.ts:37-42 charge le self-test sans aucune garde : `void import("./selftest").then((m) => { window.__siftSelfTest = () => void m.runSelfTest(); … })` — l'import dynamique s'execute au demarrage de chaque lancement, y compris en production. selftest.ts embarque wavesurfer.js et, une fois appele, itere sur la file en faisant fetch + decodeAudioData + creation de WaveSurfer sur 15 pistes (selftest.ts:16-89). Cote Rust la commande associee `ipc::report_smoke` est enregistree inconditionnellement (lib.rs:208), alors que dev_locate/dev_annotate sont, eux, gates par cfg!(debug_assertions) selon CLAUDE.md.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `frontend/main.ts`, `frontend/selftest.ts`, `src-tauri/src/lib.rs`
- Correctif esquisse : Deplacer le bloc main.ts:37-42 a l'interieur du `if (import.meta.env.DEV)` de la ligne 45 (ou le conditionner a VITE_SIFT_SELFTEST), pour que le chunk selftest + wavesurfer sorte du bundle de production et que la globale ne soit pas exposee.

---

## software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle

**Portee reellement balayee.**

LU INTEGRALEMENT AVANT DE JUGER: CLAUDE.md racine, AGENTS.md, .claude/rules/rust.md, .claude/rules/context-packs.md, docs/INDEX.json. Beaucoup de "defauts" candidats (Result<T,String> a la frontiere IPC, enums d erreur a la main sans thiserror, absence d async, pass-through #[tauri::command] -> *_inner, Arc<Mutex>+Condvar) sont des choix documentes et NE SONT PAS signales.

FICHIERS REELLEMENT OUVERTS (33). Rust (lecture): filing.rs 1-1421 (le reste = mod tests, non lu), search_terms.rs 1-940, ipc_identify.rs (integral), metadata/mod.rs 1-200, metadata/discogs.rs 330-520, actions.rs 100-620 + outline complet des fn, worker.rs (integral), analysis/mod.rs (integral), ipc_filing.rs 1-750, ipc_library.rs 1-181, rekordbox_repairs.rs 220-350 / 455-505 / 680-722 + outline. Par extrait cible verifie: rekordbox_masterdb.rs 332-350 (RekordboxIndex), analysis/tags.rs 24-30, encode.rs 64-84, scanner.rs 7-16. TS (lecture): filing.ts, filing-state.ts, filing-preview.ts, filing-toast.ts, filing-actions.ts (les 5 integraux), library-detail.ts 30-58, rekordbox-view.ts 324-513 + outline, report-view.ts 1135-1147. Greps de balayage repo-wide: mutations `state.X =` (frontend/, 42 sites), `search_terms`/`search_corpus` (src-tauri/, 11 hits), call sites des 8 detecteurs masterdb (src-tauri/, tous fichiers .rs), `sift-toast` (frontend/, 3 fichiers), `country|format` (frontend/+shared/).

CE QUE JE N AI PAS REGARDE (a ne pas lire comme "rien a signaler"): rekordbox_masterdb.rs (2972 l., seul le struct index lu), rekordbox_xml.rs, rekordbox_repairs.rs 1-220 et 350-455 et 505-680 et 722-1000, dedup.rs, library.rs, db.rs, naming.rs, tagging.rs, queue.rs, scanner.rs (hors 7-16), watcher.rs, sources.rs, ecartes.rs, genres.rs, fingerprint.rs, usb_format/*, search_corpus.rs, bench_volume.rs, b85_bytes.rs, dev_*.rs, lib.rs, analysis/{decode,spectrum,verdict,peaks,phase,dynamics,structure}.rs. Cote front: report-view.ts (1274 l., 12 lues), queue-panel.ts, batch-panel.ts, filing-identify.ts (grep seul), filing-bins.ts, bibliotheque-view.ts, sift-live.ts, chrome.ts, home-sources.ts, reglages-view.ts, ecartes-view.ts, journal.ts, library-views.ts, ipc.ts, styles.css. Aucune compilation ni execution de test (contrainte cargo partage respectee) — tous les findings sont statiques et rejouables a la lecture.

### [SDP-1] La table extension->rail est dupliquee cote front et a DEJA divergE de la Rust (.opus)
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing.ts:464-467`
- Preuve : frontend/filing.ts:464-467 : `let rail = "unknown"; if (["flac","wav","aif","aiff","alac"].includes(ext)) rail="lossless"; else if (["mp3","m4a","aac","ogg"].includes(ext)) rail="lossy";`. La table de reference est src-tauri/src/analysis/tags.rs:25-29 : `"mp3"|"aac"|"m4a"|"ogg"|"opus" => Rail::Lossy`. `opus` manque cote TS. Or `opus` EST mis en file : src-tauri/src/scanner.rs:8-9 `const AUDIO_EXTS: &[&str] = &["mp3","flac","wav","aif","aiff","m4a","aac","ogg","opus"]`. Aggravant : la valeur autoritaire est deja en portee — `report` (AnalysisReport, champ `declared_rail` mirore en shared/contracts.ts:99) est resolu a filing.ts:350 et passe a renderEditor a filing.ts:472, mais filing.ts:463 la contourne (commentaire : "analysis data attribute not available cross-module", devenu faux). Cote conso : filing.ts:153 `const lossy = rail === "lossy"` puis filing.ts:157-159 desactive les chips AIFF/WAV "pour eviter le clic sans issue" ; garde backend : src-tauri/src/encode.rs:72-76 `guard_no_upscale` renvoie EncodeError::Upscale des que source_rail==Lossy && target lossless, remonte en FilingError::Upscale par filing.rs:453-455.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Une piste `.opus` dans la file. filing.ts:466-467 ne la classe ni lossless ni lossy -> rail="unknown" -> filing.ts:153 `lossy=false` -> les chips AIFF et WAV restent cliquables. L utilisateur clique AIFF -> state.target="aiff_16_44" -> doRanger (filing-actions.ts:72) appelle fileTrack avec ce target -> plan_file (filing.rs:438) calcule source_rail=Rail::Lossy via rail_from_ext("opus") -> guard_no_upscale echoue -> FilingError::Upscale -> filing-actions.ts:122 affiche "Refuse : pas de surqualite lossy -> lossless". Le clic sans issue que le desactivage existe precisement pour empecher est servi a chaque .opus, a chaque ouverture.
- Fichiers : `frontend/filing.ts`, `src-tauri/src/analysis/tags.rs`, `src-tauri/src/scanner.rs`
- Correctif esquisse : Supprimer la table TS et lire `report?.declared_rail ?? "unknown"` (deja en portee filing.ts:350) pour alimenter `state.rail` et le parametre de renderFoot/renderEditor. La connaissance extension->rail redevient monopropriete de analysis/tags.rs.

### [SDP-2] RekordboxIndex expose un Vec nu : la regle de comparaison de chemin fuit dans 3 appelants et coute un scan lineaire par detecteur
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/rekordbox_masterdb.rs:332-335`
- Preuve : src-tauri/src/rekordbox_masterdb.rs:332-335 : `pub struct RekordboxIndex { pub tracks: Vec<RekordboxTrack> }` — aucune methode. Consequence, le meme bloc est recopie mot pour mot dans les 3 detecteurs de actions.rs : lignes 276-282, 387-393 et 460-466, tous les trois `let lookup = normalize_masterdb_path(x); let matches: Vec<&str> = index.tracks.iter().filter(|t| normalize_masterdb_path(&t.folder_path) == lookup).map(|t| t.track_id.as_str()).collect();` suivi du meme `match matches.len() { 0 => return, 1 => pending, _ => ambiguous }`. La regle metier "Rekordbox stocke des slashes avant, Windows est case-insensitive" (actions.rs:231-241) est donc une connaissance que chaque appelant doit posseder : elle n est pas dans le module qui possede l index. Cout : `normalize_masterdb_path` alloue 2 String par piste indexee et par scan (actions.rs:241 `.replace(..).to_lowercase()`), et filing.rs:703-755 declenche jusqu a 3 scans complets par ligne de journal commitee (repair + metadata + artwork), soit 2 a 3 balayages integraux de djmdContent par piste rangee — dans une boucle de rangement dont le PRD du 2026-07-27 fixe le budget a 50 ms.
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **B**
- Fichiers : `src-tauri/src/rekordbox_masterdb.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Donner a RekordboxIndex une interface etroite : construire une fois `HashMap<String /*chemin normalise*/, Vec<String> /*track_ids*/>` a la lecture, exposer `fn track_ids_for_path(&self, p: &str) -> &[String]`, rendre `tracks` prive. Les 3 detecteurs deviennent un `match ids.len()` sans connaitre ni Vec ni normalisation.

### [SDP-3] Chaine de pass-through a 4 niveaux sur la detection masterdb, avec la meme garde recopiee 3 fois
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/actions.rs:114-165`
- Preuve : Le chemin de production reel est : actions.rs:71 (`record_with_meta`) -> `maybe_detect_masterdb_repair` (actions.rs:132-146) -> `detect_masterdb_repair_if_linked` (actions.rs:255-265) -> `resolve_masterdb_index_if_linked` (actions.rs:210) -> `detect_masterdb_repair_with_index` (actions.rs:269). Trois de ces quatre niveaux n ajoutent qu une ligne. La garde `if matches!(kind, "move"|"convert") { if let (Some(from),Some(to)) = ... { if from != to { ... } } }` est ecrite trois fois a l identique : actions.rs:120-126, 139-145, 158-164 — les doc-comments l assument ("mirrors ... exactly", actions.rs:129-131 et 148-149), ce qui est l aveu que la connaissance est dupliquee. Symetriquement les 3 wrappers `*_if_linked` (actions.rs:255-265, 357-375, 429-447) ne font que resoudre l index puis deleguer au `*_with_index` de meme nom. Verifie par grep repo-wide des 8 symboles : `maybe_detect_masterdb_repair_with_index` n a qu un appelant (filing.rs:715), `detect_masterdb_repair_if_linked` n a qu un appelant de prod (actions.rs:142, le reste = tests).
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/actions.rs`, `src-tauri/src/filing.rs`
- Correctif esquisse : Une seule fonction `detect_all(conn, index: Option<&RekordboxIndex>, row: &JournalRow)` qui porte la garde une fois et dispatche vers les 3 detecteurs ; `index: None` fait la resolution paresseuse. Supprime 6 fonctions publiques et les 3 copies de la garde.

### [SDP-4] Le concept "file de candidats master.db" n a pas de module : 3 cycles de vie quasi identiques en Rust ET 3 rendus quasi identiques en TS
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/rekordbox_repairs.rs:223-260`
- Preuve : `dismiss_*_inner` existe 3 fois, corps identique au nom de table pres : rekordbox_repairs.rs:223-230 (`rekordbox_masterdb_repairs`), 459-466 (`..._metadata_syncs`), 682-692 (`..._artwork_syncs`). `resolve_ambiguous_*_inner` existe 3 fois, ~28 lignes chacune, identiques y compris les deux messages d erreur francais mot pour mot ("cette ligne n est plus ambigue — rechargement necessaire" / "piste choisie invalide pour cette ambiguite") : lignes 233-260, 470-497, 695-722 ; seules varient la table et la colonne cible (`track_id` vs `rekordbox_track_id`). Les 3 structs de sortie sont structurellement identiques `{id, ok, error}` : ApplyRepairOutcome (l.50), ApplyMetadataSyncOutcome (l.500), ApplyArtworkSyncOutcome (l.726). Cote front la meme triplication : rekordbox-view.ts:324-408 (`metadataSyncsSectionHtml`) et 424-503 (`artworkSyncsSectionHtml`) sont deux clones de ~80 lignes — meme `liveIds`/purge de selection, meme split ambiguous/pending, meme `candidateList` (l.348-354 vs 443-449, byte-identique), meme `pendingRowHtml`, meme `applyBar`, meme `subtext`, meme ternaire `body` ; seuls changent le contenu d `infoBlock` et le prefixe `mds`->`mas` des 6 attributs data-sift. Idem `rerender*Section` (l.310, 411, 506).
- Impact : maintenabilite
- Effort : L
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/rekordbox_repairs.rs`, `frontend/rekordbox-view.ts`
- Correctif esquisse : Cote Rust : un type `CandidateQueue { table: &'static str, id_col: &'static str }` portant dismiss/resolve_ambiguous/apply_all, 3 constantes au lieu de 3 familles de fonctions. Cote TS : un `renderCandidateSection(cfg)` parametre par prefixe d action, set de selection et fonction `infoBlock`.

### [SDP-5] Aucun module ne possede "ecrire les tags d un fichier" : la recette a 6 etapes est recopiee sur les 3 sites d ecriture
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/ipc_filing.rs:245-299`
- Preuve : La meme sequence — snapshot des anciens tags, `write_tags_full`, journal `tag_edit`, `resolve_masterdb_index_if_linked`, `detect_masterdb_metadata_sync_*`, puis `detect_masterdb_artwork_sync_*` conditionne a un cover — est reecrite a la main sur les 3 sites : filing.rs:529-547 + 696-755 (chemin conformant + boucle post-commit), ipc_filing.rs:245-299 (`apply_tags`), ipc_library.rs:43-112 (`update_metadata_write_file` + `update_metadata_commit`). Les doc-comments nomment eux-memes la contrainte ("Called directly by the 3 sites that write ID3 tags", actions.rs:349-351 ; "Mirrors filing's tag write ... so an Apply and a File write the same tags", ipc_filing.rs:222-223), ce qui est exactement la definition d une connaissance partagee sans proprietaire. Les 3 copies ont deja divergE sur des details porteurs : le titre synchronise vers Rekordbox passe par `naming::tag_title` a filing.rs:731 et ipc_filing.rs:212 mais est le brut `edit.title` a ipc_library.rs:96 ; le detecteur pochette est conditionne a `plan.extras.cover_path` (filing.rs:743), a `extras.cover_path` (ipc_filing.rs:293) et a `edit.cover_path` (ipc_library.rs:105), trois sources differentes. Un 4e appelant devra redecouvrir les 6 etapes par lecture croisee.
- Impact : maintenabilite
- Effort : L
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/ipc_library.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Un module `tag_write` avec une interface unique `write_and_journal(conn, track_id, path, &TagValues) -> Result<String /*batch_id*/>` qui encapsule snapshot + ecriture + journal + les 3 detecteurs. Les 3 appelants n en gardent que la construction de `TagValues`.

### [SDP-6] RevueState est un enregistrement mutable nu exporte : 42 sites d ecriture dans 3 modules et une liste de reset tenue a la main
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing-state.ts:54-68`
- Preuve : frontend/filing-state.ts:54-68 exporte `export const state: RevueState = {...}` — 13 champs publics, zero fonction d acces. Comptage par grep sur frontend/ : 29 affectations `state.X =` dans filing.ts, 9 dans filing-identify.ts, 4 dans filing-actions.ts (soit 42 avec `state.rail` a filing.ts:468, exclu du premier comptage par le commentaire de fin de ligne). Aucun module ne peut changer la forme de l etat sans relire les trois autres. Le symptome concret est `clearPane` (filing.ts:238-250) : une deuxieme copie manuelle de la liste des champs, qui en remet 12 a zero et en oublie 1 — `state.rail` n y figure pas et conserve donc le rail de la piste precedente apres un vidage du volet (non exploitable aujourd hui parce que refreshPreview sort tot sur `!state.canonical`, filing-preview.ts:95, mais c est un accident, pas une garantie). Ajouter un champ = 2 edits obligatoires non verifies par le compilateur (declaration + reset).
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `frontend/filing-state.ts`, `frontend/filing.ts`, `frontend/filing-identify.ts`, `frontend/filing-actions.ts`
- Correctif esquisse : Rendre `state` prive au module et exposer une interface etroite : `openTrack(item)`, `applyIdentity(applied)`, `clear()`, plus des getters de lecture. `clear()` reconstruit l objet initial (`{...INITIAL}`) au lieu d enumerer les champs, ce qui supprime la liste dupliquee.

### [SDP-7] toast() porte la politique d annulation globale (d ou l injection registerClearPaneHook), et un second toast concurrent vit dans library-detail.ts
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing-toast.ts:28`
- Preuve : frontend/filing-toast.ts:28 `export function toast(message: string, undo = false, onUndo?: () => void)`. Le booleen `undo` n est pas un parametre d affichage : quand il vaut true sans `onUndo`, le module importe `undoLast` (l.1), l appelle (l.65), vide le volet de detail via un hook injecte (l.69 `clearPaneHook?.(mid)`), traduit `"source gone"` en message metier francais (l.81-85) et enchaine un toast de suivi (l.77). C est la seule raison d etre de `registerClearPaneHook` (filing-toast.ts:4-12, cable filing.ts:65) : un composant de notification n aurait aucun besoin de connaitre le volet Revue. Un primitif d UI generique est ainsi devenu un module peu profond ET couple au domaine. Second effet, verifie par grep `sift-toast` (3 fichiers) : library-detail.ts:32-51 reimplemente un toast complet sur le MEME id DOM `#sift-toast`, sans fondu, sans reutilisation de noeud, avec son propre timer 6 s ; filing-toast.ts:29-35 doit poser un marqueur `dataset.owner === "filing-toast"` uniquement pour survivre a cette collision.
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **B**
- Fichiers : `frontend/filing-toast.ts`, `frontend/filing.ts`, `frontend/library-detail.ts`
- Correctif esquisse : Retirer le parametre `undo` : le toast n expose qu un label d action + un callback. La politique LIFO (undoLast + clearPane + messages) remonte chez son appelant (filing-actions.ts), ce qui supprime registerClearPaneHook et l import de ipc dans le module toast. Puis faire consommer ce toast unique par library-detail.ts et supprimer sa copie.

### [SDP-8] Le contrat d erreur IPC est de la prose : le front discrimine les cas par sous-chaines et regex sur des messages Display et du texte OS
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing-actions.ts:116-125`
- Preuve : Cote Rust les erreurs sont aplaties en String a la frontiere (convention projet, assumee) : filing.rs:52-63 rend `FilingError::Upscale` -> "refused: cannot upscale lossy to lossless" et surtout `FilingError::Io(m)` -> "io: {m}" ou `m` est le message de l OS, non maitrise. Cote front cette prose devient le contrat : filing-actions.ts:97 `msg.includes("RAIL_MISMATCH")`, :116 `includes("NoLibraryRoot")`, :120 `includes("ALREADY_FILING")`, :122 `msg.toLowerCase().includes("upscale")`, :123 `/permission|access|denied/i.test(msg)`, :124 `/no such file|not found|introuvable/i.test(msg)` ; filing-actions.ts:289 et filing-toast.ts:81 `msg.includes("source gone")` ; filing.ts:354 `msg.includes("n'existe plus")`. Les 3 premiers sont des sentinelles stables volontaires (documentees ipc_filing.rs:304-307) et ne posent pas probleme ; les 3 derniers font dependre l UI du wording anglais renvoye par le systeme. Sur un Windows francais le message de refus d acces est "Acces refuse" — le regex `/permission|access|denied/i` ne matche pas (accent sur le e, pas de mot "access"), et l utilisateur tombe sur le message generique de la ligne 125 au lieu du diagnostic ecrit pour lui.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `frontend/filing-actions.ts`, `frontend/filing.ts`, `frontend/filing-toast.ts`, `src-tauri/src/filing.rs`
- Correctif esquisse : Classer cote Rust, pas cote TS : `FilingError::Io` mappe les `raw_os_error()` connus (5/32 -> `"PERMISSION"`, 2/3 -> `"FILE_GONE"`) vers des sentinelles stables comme le fait deja RAIL_MISMATCH, et le front ne teste plus que des sentinelles.

### [SDP-9] Trois champs de RevueState sont en ecriture seule, chacun entretenu sur 4 a 6 sites
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing-state.ts:32-33`
- Preuve : Grep repo-wide sur frontend/ : `state.filedConfirm` n apparait qu en affectation — filing-actions.ts:152, 186, 263, 285 et filing.ts:249, 302 — jamais en lecture ; la banniere qu il est cense piloter est en fait retrouvee par le DOM (`banner.dataset.batchId === o.batch_id`, filing-actions.ts:258), donc sa doc (filing-state.ts:45-47) decrit un mecanisme qui n existe plus. Idem `state.releaseCountry` et `state.releaseFormat` (declares filing-state.ts:32-33) : ecrits filing-identify.ts:183-184 et filing.ts:244-245, 300-301, jamais lus — leur doc dit "kept here so the read-only release line below Genres keeps showing them afterwards", or le grep `country|format` sur frontend/+shared/ montre que le seul rendu de ces valeurs se fait depuis le candidat brut (identify-shared.ts:19), pas depuis l etat. 3 champs morts sur 13, avec 10 sites d ecriture a maintenir et une doc qui ment sur le mecanisme reel.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/filing-state.ts`, `frontend/filing.ts`, `frontend/filing-actions.ts`, `frontend/filing-identify.ts`
- Correctif esquisse : Supprimer les 3 champs et leurs 10 affectations. `releaseCache` (filing-identify.ts:46) porte deja country/format pour la duree de session, ce qui rend la copie dans l etat inutile.

### [SDP-10] Query.attempts signale "pas de cascade" par la valeur vide : signal en bande sur un cas legitimement atteignable
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/metadata/mod.rs:136-139`
- Preuve : metadata/mod.rs:136-139 documente `attempts` comme : "Vide = l appelant n en fournit pas et le fournisseur retombe sur `{artist} {title}`", et discogs.rs:339-344 implemente exactement ce repli (`if q.attempts.is_empty() { vec![format!("{} {}", q.artist, q.title)] }`). Mais le vide a deux causes distinctes : (a) l appelant historique/test qui ne fournit rien, et (b) `search_terms::build_ladder` qui a volontairement rejete tous ses essais — la fermeture `push` (search_terms.rs:834-847) jette silencieusement toute requete de moins de 3 caracteres alphanumeriques, avec une justification explicite (l.836-839 : une requete "2" "ramenerait la moitie de Discogs"). Dans le cas (b), discogs.rs ressuscite mot pour mot la requete que search_terms venait d ecarter. La decision "cette requete est du bruit" est prise dans un module et defaite dans un autre parce que le canal entre les deux ne sait pas distinguer "rien fourni" de "rien de valable".
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/metadata/mod.rs`, `src-tauri/src/metadata/discogs.rs`, `src-tauri/src/search_terms.rs`
- Correctif esquisse : Typer l absence hors bande : `attempts: Option<Vec<String>>` — `None` = appelant historique (repli legitime), `Some(vec![])` = la cascade n a rien de cherchable, on ne cherche pas. Les tests existants de discogs.rs passent `None`.

### [SDP-11] openFilingInto est une decomposition temporelle de 240 lignes : elle porte au passage la politique de recuperation fichier-disparu
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `frontend/filing.ts:281-519`
- Preuve : frontend/filing.ts:281-519 enchaine dans une seule fonction : garde de sequence (l.290), amorcage de 8 champs d etat depuis le cache (l.291-303), construction du squelette DOM (l.305-320), lancement du controle de doublon (l.324-332), 4 lectures IPC paralleles avec un `readError` agrege (l.339-374), puis l.376-420 un bloc de 45 lignes qui est une POLITIQUE a part entiere — chaine de recuperation fichier-disparu avec son ensemble `goneVisited` d anti-boucle, un re-listQueue filtre, une recursion sur elle-meme (l.403) et quatre issues distinctes — puis arbitrage identite persistee vs reconcile (l.427-438), derivation du rail (l.463-468), 6 appels de rendu (l.470-481), et enfin deux insertions de pastilles differees (l.482-518). Les etapes sont decoupees par ORDRE D EXECUTION, pas par responsabilite : chaque evolution du parcours d ouverture traverse toute la fonction. Le bloc l.376-420 en particulier ne partage rien avec le rendu et se teste seul.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/filing.ts`
- Correctif esquisse : Extraire `advancePastGoneTrack(mid, item, goneVisited)` (l.376-420) et `resolveCanonical(release, canonical)` (l.427-438) en fonctions pures/isolees ; openFilingInto ne garde que amorcage -> lectures -> rendu.

### [SDP-12] analyze() duplique la liste des accumulateurs dans les deux branches mono/stereo
- Passe : software-design-philosophy (Ousterhout) — profondeur de module, information leakage, decomposition temporelle
- Emplacement : `src-tauri/src/analysis/mod.rs:149-172`
- Preuve : src-tauri/src/analysis/mod.rs:149-172 : la branche `target_ch == 2` (l.150-162) et la branche mono (l.163-171) appellent chacune les 7 memes `push` dans le meme ordre (dc, clip, tp, sil, trunc, pk, spec) ; seule differe la preparation du buffer mono. Ajouter un analyseur coute donc 4 edits non verifies par le compilateur : declaration (l.140-147), les deux branches de push, et le `finish` (l.174-183).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `src-tauri/src/analysis/mod.rs`
- Correctif esquisse : Calculer `let mono: &[f32]` une fois (Cow : emprunt du bloc en mono, buffer downmixe en stereo) puis une seule liste de push ; `ph.push(block)` reste dans la garde stereo.

---

## pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule

**Portee reellement balayee.**

LU REELLEMENT (ouverture ou grep avec sortie citee). Racine : CLAUDE.md (403 l., integral), AGENTS.md (integral, 9 l.), .claude/rules/rust.md (integral), .claude/rules/context-packs.md, shared/contracts.ts (integral, 436 l.), PRD.md (en-tete + liste des ## ), PRODUCT.md (1-60), package.json, components.json, .mcp.json, .gitignore, .claude-gate, .claude/settings.local.json, .claude/verify.sh, .github/workflows/build.yml + release.yml (integral), scripts/lint-tokens.mjs (integral), scripts/lint-tokens-baseline.json, scripts/decrypt-masterdb-debug.py (20-52), src-tauri/Cargo.toml (en-tete). RUST : settings.rs (integral), queue.rs (1-80), encode.rs (1-130), analysis/verdict.rs (integral), analysis/tags.rs (15-35), analysis/mod.rs (180-195), analysis/spectrum.rs (108-130), filing.rs (415-475 + grep constantes/tests de contrat), ipc_filing.rs (400-760), library.rs (145-220 + grep), dedup.rs (40-70), rekordbox_masterdb.rs (80-130), worker.rs (85-105), genres.rs (en-tete). TS : filing-preview.ts (integral), filing.ts (130-190), batch-panel.ts (75-100, 210-380, 500-600, 676-720), filing-actions.ts (15-25, 70-90, 145-175), dom.ts (25-45), usb-format-modal.ts (1-15, 55-100, 185-205), ipc.ts (130-160), genre-families.ts, bibliotheque-view.ts (grep). DOCS : INDEX.json (integral + diff programmatique contre le disque), ressources-externes.md (1-62, 179-200, liste complete des ## ), design-system-states.md (1-40, liste des ## ), design-system/governance.md (integral), design-system/foundations.md (1-72), skills/sift-ui-design-governance.md (1-50), changes/2026-07-20-shadcn-react-migration/design.md (1-30), changes/2026-07-19-spacing-scale-sweep/design.md (1-20), .interface-design/system.md (74-112). BALAYAGES PROUVES : 162 fichiers docs/ enumeres puis diffes contre INDEX.json par script (6 ecarts) ; 128 entrees de skills scannees sur 3 racines (.claude/skills=1, ~/.claude/skills=61, ~/.agents/skills=66) + grep de contenu → aucune occurrence de sift-ui-design-governance ni de coss ; grep 'cargo test|clippy|tsc' sur tout .github/ → 0 hit sur 2 workflows. NON COUVERT : aucune compilation, aucun test lance (interdit cargo partage), aucune verification visuelle (pas de tauri dev, pas de CDP). Fichiers jamais ouverts : frontend/sift-live.ts, chrome.ts, report-view.ts (hors 105-155), home-sources.ts, reglages-view.ts, rekordbox-view.ts, ecartes-view.ts, library-detail.ts, library-views.ts, journal.ts, list-virtual.ts, queue-panel.ts (hors greps), styles.css, app.js, *.stories.ts ; src-tauri/src/naming.rs, search_terms.rs, metadata/discogs.rs, scanner.rs, watcher.rs, sources.rs, actions.rs, db.rs (migrations), tagging.rs, fingerprint.rs, ffmpeg.rs, ecartes.rs, rekordbox_xml.rs, rekordbox_repairs.rs, ipc.rs, ipc_library.rs, ipc_identify.rs, ipc_usb.rs, usb_format/. L'axe « seuils numeriques partages Rust<->TS » n'a ete balaye que sur les constantes MAJUSCULES exportees de frontend/*.ts (28 resultats) — les litteraux inline des deux cotes n'ont pas ete compares exhaustivement.

### [PP-1] Le mode Lot ignore la regle no-upscale que le backend applique : tout MP3 honnete rebondit en silence
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/batch-panel.ts:84`
- Preuve : La regle « un lossy ne monte jamais en lossless » a UNE implementation faisant autorite : src-tauri/src/encode.rs:72-77 `guard_no_upscale`, appelee sans echappatoire par filing.rs:453 (`if encode::guard_no_upscale(source_rail, target).is_err() { return Err(FilingError::Upscale); }` — `allow_rail_mismatch` ne la contourne PAS, il ne desactive que le sniff de contenu de filing.rs:446). Elle est mirroree dans le rail Detail (filing.ts:158 : `if (lossy && t !== "mp3_320")` → chips AIFF/WAV grises) mais DELIBEREMENT abandonnee en mode Lot : batch-panel.ts:80-84 « a lossy-sourced file can still be asked for AIFF/WAV here, unlike the Detail rail which keeps the no-upscale guard » puis `let batchFormat: Target = "aiff_16_44";`. Or le groupe « Prets · lossless » ne filtre PAS le rail : batch-panel.ts:219 `const ready = currentItems.filter((it) => it.verdict === "ok");` et batch-panel.ts:226-229 coche TOUT `ready` par defaut. Et verdict.rs:74-78 rend `Verdict::Ok` pour tout MP3 honnete (`Rail::Lossy` + cutoff coherent avec le bitrate — test `honest_mp3_matching_its_bitrate_is_ok`, verdict.rs:116). Enfin batch-panel.ts:596 `for (const id of ids) targets[id] = batchFormat;` envoie aiff_16_44 pour chaque id.
- Impact : correctness
- Effort : M
- Risque du fix : moyen
- Note : **A**
- Scenario de defaillance : File d'attente de 250 MP3 320 kbps authentiques (verdict ok, rail lossy). L'utilisateur ouvre Revue > Lot : les 250 sont dans « Prets · lossless » et coches d'office, Format affiche AIFF (defaut module). Il clique Convertir. Cote Rust, plan_file appelle guard_no_upscale(Lossy, Aiff1644) → Err(Upscale) pour les 250 → tous poussés dans needs_validation (ipc_filing.rs:717-719). Resultat affiche : batch-panel.ts:705-716 rend `0 filed · 250 need validation` precede d'une icone `ti-check` et colore en `var(--color-text-success)` — un echec total presente comme un succes, en anglais dans une UI francaise, sans nommer une seule cause. Zero fichier range, zero explication.
- Fichiers : `frontend/batch-panel.ts`, `src-tauri/src/encode.rs`, `src-tauri/src/filing.rs`, `frontend/filing.ts`
- Correctif esquisse : Une seule autorite pour la regle. Soit le Lot applique le meme filtre que le rail Detail (desactiver AIFF/WAV des que la selection contient un rail lossy, ou envoyer target=null pour laisser encode::target_for decider par piste), soit le backend expose la regle en une commande IPC que les deux rails consomment. Dans tous les cas, ne plus laisser deux ecrans decider independamment de ce qu'un lossy peut devenir.

### [PP-2] run_file_batch jette la variante de FilingError : chaque rebond de lot est indiagnosticable
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `src-tauri/src/ipc_filing.rs:717`
- Preuve : `Err(_) => { needs_validation.push(id); continue; }` — le motif est detruit sur place, sans `log::error!`, alors que filing.rs:35-60 definit un enum riche (`Upscale`, `RailMismatch`, ...) avec un `Display` manuel dedie (« refused: cannot upscale lossy to lossless »). Cote front, BatchResult ne transporte que des ids (shared/contracts.ts:163-167 : `filed`, `needs_validation`, `cancelled`) donc l'information n'existe nulle part. Contradiction directe avec CLAUDE.md:120 « fail fast, pas de fallback silencieux » et avec le meme fichier qui prend soin de logger ailleurs (ipc_filing.rs:693 `log::error!("file_batch: DB lock poisoned...")`, ipc_filing.rs:735 `log::error!("file_batch: could not claim track {id}")`).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : N'importe quel lot partiellement rejete (PP-1, collision de nom, disque plein, source disparue) produit la meme sortie indifferenciee « K need validation ». Un utilisateur ne peut pas corriger, et un developpeur qui debugge n'a ni log serveur ni payload : il doit rejouer piste par piste en mode Detail pour retrouver la cause.
- Fichiers : `src-tauri/src/ipc_filing.rs`, `shared/contracts.ts`
- Correctif esquisse : `Err(e) => { log::error!("file_batch: plan_file refused track {id}: {e}"); needs_validation.push(id); continue; }` au minimum ; idealement remonter `Vec<(i64, String)>` dans BatchResult pour que le recap nomme la cause.

### [PP-3] L'ensemble « quelles extensions sont lossless » est encode 4 fois et a deja diverge sur alac
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `src-tauri/src/dedup.rs:53`
- Preuve : Quatre representations independantes de la meme regle metier. (1) analysis/tags.rs:26 — l'autorite, celle qui pilote le rail : `"flac" | "wav" | "aif" | "aiff" | "alac" => Rail::Lossless`. (2) dedup.rs:51-55 `is_lossless_fmt` : `matches!(f.to_lowercase().as_str(), "aiff" | "aif" | "wav" | "flac")` — alac absent. (3) library.rs:150 (dashboard) : `lower(format) IN ('aiff','aif','wav','flac')`. (4) library.rs:206 (filtre qualite) : meme litteral SQL. Le champ compare est bien la meme donnee : analysis/mod.rs:185-189 remplit `declared_format` avec l'extension en minuscules, worker.rs:95 l'ecrit dans `tracks.format`. Aucun test de contrat ne relie ces 4 sites (les seuls tests de contrat existants sont filing.rs:2000-2012 pour FILE_IN_PLACE/EXTERNAL_DEST_PREFIX).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Ajout d'un format lossless a tags.rs:26 (alac deja present, ou wv/ape demain). dedup.rs:59 `pick_keep` ordonne `(is_lossless_fmt, bitrate, duration, !truncated)` : un doublon ALAC contre un MP3 320 donne `(false, ~1000, ...)` pour l'ALAC et `(false, 320, ...)` pour le MP3 — l'ALAC gagne ici par bitrate, mais un ALAC a bitrate declare bas perd contre le MP3 et Sift recommande de garder le lossy. Le meme fichier est simultanement compte hors « Lossless » dans le dashboard (library.rs:150) et hors du filtre Lossless (library.rs:206) alors que le moteur d'analyse le classe Rail::Lossless.
- Fichiers : `src-tauri/src/dedup.rs`, `src-tauri/src/library.rs`, `src-tauri/src/analysis/tags.rs`
- Correctif esquisse : dedup.rs appelle `analysis::tags::rail_from_ext(fmt) == Rail::Lossless` ; library.rs construit sa clause IN depuis une constante `LOSSLESS_EXTS` exportee par tags.rs (ou fait le filtre en Rust apres lecture). Un test qui compare les 4 ensembles suffit a bloquer la prochaine divergence.

### [PP-4] La regle rail->format par defaut et la table des extensions de sortie sont dupliquees Rust/TS sans test de contrat
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/filing-preview.ts:18`
- Preuve : `function defaultTarget(rail: string): Target { return rail === "lossless" ? "aiff_16_44" : "mp3_320"; }` reimplemente encode.rs:64-69 `target_for(rail)` (`Rail::Lossless => Target::Aiff1644, _ => Target::Mp3320`). Juste en dessous, filing-preview.ts:21-25 `targetExt` reimplemente encode.rs:27-33 `Target::ext()`. Ces valeurs sont consommees quand l'utilisateur n'a rien choisi : filing-preview.ts:100 `targetExt(state.target ?? defaultTarget(state.rail))` pour l'extension du nom final, filing.ts:160 `(state.target ?? defaultTarget(rail)) === t` pour allumer la puce. Et ipc.ts:142 envoie `target: target ?? null`, donc c'est bien le backend qui tranche reellement via `override_target.unwrap_or_else(|| encode::target_for(source_rail))` (filing.rs:452). Ironie : le meme fichier prend soin de NE PAS dupliquer le rendu du nom (filing-preview.ts:90 « Renders via naming::render_filename ... not a TS reimplementation ») — l'extension est le residu oublie.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Le jour ou le defaut lossless passe a WAV (Target::Wav1644) dans encode.rs:66, ou qu'une extension change dans Target::ext, le rail Revue continue d'afficher « Nom final → Artiste - Titre.aiff » et d'allumer la puce AIFF, tandis que le fichier ecrit sur disque est un .wav. L'ecran ment sur le resultat, ce que PRODUCT.md interdit explicitement (« Ne jamais mentir a l'ecran »).
- Fichiers : `frontend/filing-preview.ts`, `src-tauri/src/encode.rs`, `frontend/filing.ts`, `shared/contracts.ts`
- Correctif esquisse : Faire renvoyer par previewFilename (deja un aller-retour IPC) l'extension effective quand target est null, ou exposer target_for/ext via une commande ; a defaut, ajouter un test de contrat Rust qui grep filing-preview.ts comme filing.rs:2000-2012 le fait deja pour les deux sentinelles.

### [PP-5] L'index de navigation de ressources-externes.md est maintenu en double et les deux copies ont derive de 49 a 72 lignes
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `docs/INDEX.json:6`
- Preuve : Le meme tableau (numero de ligne + gist par section) existe deux fois : dans le corps du fichier (docs/ressources-externes.md:22-60, « L92 — Evaluation 1 », « L1578 — Evaluation 19 », « L1880 — Evaluation 23 ») et dans le champ `sections` de docs/INDEX.json (lignes 92, 144, 179, ... 1880 — valeurs identiques). Les positions reelles, obtenues par `grep -n "^## " docs/ressources-externes.md` : Evaluation 1 = 141, Evaluation 2 = 193, Evaluation 3 = 228, Evaluation 19 = 1650, Evaluation 23 = 1952. Ecart constant de 49 lignes sur la premiere moitie, jusqu'a 72 lignes sur la fin. Or CLAUDE.md:100-103 impose ce mecanisme : « Utiliser son sommaire en tete de fichier (ligne + gist par section/Evaluation) pour cibler la bonne section via `Read offset=<L>`, plutot que tout lire. » Le meme dispositif applique a design-system-states.md n'est decale que de 1 ligne (INDEX.json annonce 442/521/604, reel 443/522/605) : le mecanisme n'est pas fiable, il est seulement inegalement pourri.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un agent applique CLAUDE.md:100-103 et fait `Read docs/ressources-externes.md offset=1578` pour lire l'Evaluation 19 (« spike stack UI ecarte, reference canonique »). Il atterrit dans l'Evaluation 18 (bug WAL master.db), lit un contenu sans rapport, et soit conclut que la section a disparu, soit raisonne sur la mauvaise decision. Le fichier fait 2000+ lignes et n'est volontairement pas charge en entier : le decalage n'est pas rattrapable a l'oeil.
- Fichiers : `docs/INDEX.json`, `docs/ressources-externes.md`, `CLAUDE.md`
- Correctif esquisse : Supprimer une des deux copies et generer l'autre (`grep -n '^## '` dans un script npm), ou abandonner les numeros de ligne au profit des ancres de titre — un index qui doit etre revalide a la main a chaque edition du fichier qu'il indexe ne tiendra jamais.

### [PP-6] Deux docs vivants du design system designent AGENTS.md comme source des contraintes projet — AGENTS.md a ete vide de tout contenu
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `docs/design-system/governance.md:13`
- Preuve : governance.md liste ses « Sources obligatoires » : « 4. `AGENTS.md` pour les contraintes projet », puis impose en verification docs-only (governance.md:84) « verifier que les docs ne contredisent pas `AGENTS.md` ». foundations.md:72 fait pareil : ligne de tableau « | Regles projet | `AGENTS.md` | ». Or AGENTS.md fait aujourd'hui 9 lignes et ne contient AUCUNE contrainte — AGENTS.md:3-8 : « `CLAUDE.md` (racine du repo) est la source unique d'instructions projet pour Sift. `AGENTS.md` a diverge de `CLAUDE.md` ... corrige en supprimant la duplication plutot qu'en la resynchronisant a la main. » La suppression de la duplication du 2026-07-22 n'a pas ete propagee aux deux docs qui pointaient dessus.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un agent en tache UI suit governance.md, ouvre AGENTS.md pour connaitre les contraintes projet, y trouve un pointeur de 9 lignes, et conclut qu'il n'y a pas de contrainte particuliere — court-circuitant les garde-fous reels de CLAUDE.md (Front — CSS, Verification UI, evenements repetes). L'etape 1 de verification docs-only (« ne contredisent pas AGENTS.md ») devient une verification triviale toujours verte.
- Fichiers : `docs/design-system/governance.md`, `docs/design-system/foundations.md`, `AGENTS.md`
- Correctif esquisse : Remplacer les trois references par `CLAUDE.md` (racine). C'est une edition de 3 lignes ; l'omettre laisse deux docs actifs qui renvoient a un fichier vide.

### [PP-7] La skill designee comme garde-fou n°1 de tout chantier UI n'est installee nulle part
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `CLAUDE.md:139`
- Preuve : CLAUDE.md:137-140 : « Specifique a Sift : `docs/skills/sift-ui-design-governance.md` pour le routage UI ». governance.md:26-27 va plus loin : « toute tache UI/UX/design/theme/parcours utilisateur sur Sift : `sift-ui-design-governance` en premier, comme garde-fou projet ». Le fichier tracke docs/skills/sift-ui-design-governance.md:3-5 se decrit lui-meme comme « Source suivie par Git pour la skill locale `.agents/skills/sift-ui-design-governance/SKILL.md`. `.agents/` est ignore par Git ». Verifications : `.agents/` n'existe pas dans C:\dev\sift (`ls` → No such file or directory) ; balayage des trois racines de skills — C:\dev\sift\.claude\skills (1 entree : impeccable/), ~/.claude/skills (61 entrees), ~/.agents/skills (66 entrees, dont `sift/` qui est le cold-start, pas celle-ci) — soit 128 entrees, plus un `grep -rl "sift-ui-design-governance"` sur ces trois racines : zero fichier. Elle n'apparait pas non plus dans l'inventaire de skills de la session.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un agent lance une tache UI, applique la RÈGLE IMPÉRATIVE de routage (~/.claude/CLAUDE.md etape 4 : « Invoquer EXPLICITEMENT la/les skills trouvees »), ne trouve pas la skill, et applique l'etape 5 (« Aucune correspondance → continuer sans en inventer une »). Le garde-fou projet cite deux fois comme obligatoire est silencieusement saute — la regle produit exactement le comportement qu'elle voulait empecher.
- Fichiers : `CLAUDE.md`, `docs/design-system/governance.md`, `docs/skills/sift-ui-design-governance.md`
- Correctif esquisse : Trancher : soit installer la skill depuis sa source suivie (et documenter la commande d'installation dans CLAUDE.md), soit retirer le routage de CLAUDE.md:139 et governance.md:26 et traiter docs/skills/*.md comme une simple checklist a lire. Ne pas laisser un routage qui ne resout rien.

### [PP-8] Les trois sources de reference obligatoires avant tout nouveau composant UI sont indisponibles (2 MCP desactives, 1 skill absente)
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `CLAUDE.md:336`
- Preuve : CLAUDE.md:333-338 : « Jamais de style/comportement UI "de memoire d'entrainement" sans tracabilite. Avant tout nouvel element sans exemple fourni, consulter une reference reelle ... micro-composants : `shadcn` MCP, `ui-thing` MCP, skills `coss`, puis 21st.dev ». La regle est redite dans docs/design-system-states.md:22-25. Realite sur disque : .mcp.json declare bien les deux serveurs (`shadcn` via `npx shadcn@latest mcp`, `ui-thing` via mcp-remote), mais .claude/settings.local.json contient `"disabledMcpjsonServers": ["shadcn", "ui-thing"]` — les deux sont eteints. Et `coss` n'apparait dans aucune des 127 entrees de ~/.claude/skills + ~/.agents/skills (grep -i coss → exit 1).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un agent doit creer un nouveau micro-composant (chip, popover, toggle). Il applique CLAUDE.md:336, tente shadcn MCP → indisponible, ui-thing MCP → indisponible, skill coss → inexistante. Il ne reste que « 21st.dev » sans procedure, donc en pratique il improvise depuis sa memoire d'entrainement : exactement l'interdit que la regle ouvre par « Jamais ». La regle est inapplicable telle qu'ecrite, et rien dans le repo ne le signale.
- Fichiers : `CLAUDE.md`, `.claude/settings.local.json`, `.mcp.json`, `docs/design-system-states.md`
- Correctif esquisse : Soit reactiver les deux MCP (retirer les entrees de disabledMcpjsonServers) et remplacer `coss` par une source existante, soit reecrire CLAUDE.md:336 avec les sources REELLEMENT disponibles. Un `.mcp.json` qui declare deux serveurs eteints par la config locale est aussi a arbitrer.

### [PP-9] Un chantier encore ouvert (sweep d'espacement) repose sur une regle que sa propre source a retractee 5 jours plus tard
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `docs/superpowers/changes/2026-07-19-spacing-scale-sweep/design.md:5`
- Preuve : Le design (non archive, non execute) s'ouvre sur : « `.interface-design/system.md:79` declare une echelle stricte : `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32` — "toute autre valeur interdite". En pratique, `frontend/styles.css` (≈262 declarations ...) contient un grand nombre de valeurs hors echelle ». Le fichier cite dit aujourd'hui l'inverse, section « ## Espacement — ⚠️ a reverifier contre `styles.css` » (.interface-design/system.md:97-105) : « Ce doc listait AUTREFOIS : xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32. `styles.css` ne declare aujourd'hui que `--space-4/8/12/16` ... **Ne pas assumer que 24/32 existent comme tokens sans grep `--space` dans `styles.css` au prealable.** ». La chronologie est verifiable : `git log -1 -- .interface-design/system.md` → Fri Jul 24 21:01:52 2026, 16bed17 « retire les valeurs hex perimees du corps de system.md » ; `git log -1 -- .../spacing-scale-sweep/design.md` → Sun Jul 19 22:57:58 2026, 9016829. Le pointeur de ligne est faux en prime : system.md:79 parle d'inputs/wells, pas d'espacement.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Reprise du chantier telle qu'ecrite : le plan (plan.md, 5 etapes) fait snapper ~262 declarations de styles.css sur une echelle 4/8/12/16/24/32 dont les paliers 24 et 32 n'existent pas en token CSS — le sweep genere donc soit des litteraux, soit des tokens inventes, sur un changement visuel de masse que le design lui-meme signale comme risque (« un sweep qui snappe aveuglement casserait potentiellement des cas similaires non documentes », design.md:19-20), et le fait contre un standard retracte.
- Fichiers : `docs/superpowers/changes/2026-07-19-spacing-scale-sweep/design.md`, `.interface-design/system.md`, `CLAUDE.md`
- Correctif esquisse : Rebaser le constat sur la seule source canonique (le bloc :root de frontend/styles.css) et corriger la citation, ou archiver le chantier. Plus generalement : `.interface-design/system.md` est declare perime par CLAUDE.md:43 et CLAUDE.md:90 mais reste cite comme autorite par un doc actif — l'archiver plutot que le maintenir sous avertissements.

### [PP-10] La CI ne lance ni tests, ni clippy, ni tsc : la definition de fini est ecrite 3 fois et appliquee par un gate per-machine non versionne
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `.github/workflows/build.yml:26`
- Preuve : La meme checklist « avant de dire fini » existe dans CLAUDE.md:58-65 (cargo test / clippy / tsc --noEmit), dans .claude/rules/rust.md:106-110 (memes trois commandes) et dans docs/design-system/governance.md (« Definition De Fini », « Verification UI » etape 3). Ce qui tourne reellement en CI : `grep -rn "cargo test\|clippy\|tsc --noEmit\|npx tsc" .github/` → 0 resultat sur les 2 workflows. build.yml n'execute que `npm run lint:tokens` (job lint-tokens) et `npm run tauri build` (job build) ; release.yml n'a que checkout/toolchain/npm ci/fetch-ffmpeg/tauri-action. Le seul executeur des ~399 tests est local : .claude-gate (`TEST_CMD="cargo test --manifest-path src-tauri/Cargo.toml --quiet"`) consomme par .git/hooks/pre-commit — un fichier que Git ne versionne jamais — et .claude/verify.sh, qui exclut explicitement les tests (« La suite de tests complete (399 cas) et `cargo test` restent hors gate », verify.sh:11-13).
- Impact : correctness
- Effort : M
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un commit pousse depuis une machine sans le hook pre-commit installe (nouveau clone, worktree, agent, contributeur) traverse la CI en vert des lors que `tauri build` compile — un test rouge, un warning clippy promu erreur, ou une erreur tsc n'arretent rien. Sur main, release.yml produit alors des installeurs signes a partir d'un code dont aucune suite n'a jamais tourne de facon reproductible.
- Fichiers : `.github/workflows/build.yml`, `.claude/verify.sh`, `.claude-gate`, `CLAUDE.md`
- Correctif esquisse : Ajouter au workflow un job `test` independant (comme lint-tokens) : `npx tsc --noEmit`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Sans `needs:` sur build, pour garder la production d'installeurs decouplee — meme raisonnement que le commentaire deja present en tete de build.yml.

### [PP-11] usb-format-modal.ts reimplemente l'echappement HTML, en plus faible que le helper canonique
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/usb-format-modal.ts:191`
- Preuve : dom.ts:25-33 definit l'autorite avec un mandat explicite : « Every render helper that builds markup from data not fully owned by Sift's own code must run it through this first — a file that skips it is a stored-XSS gap (found in journal.ts, 2026-07-10 security audit) », et echappe les 5 caracteres `[&<>"']`. usb-format-modal.ts n'importe pas `esc` (son seul import est `./ipc`, ligne 12) et redefinit `escapeHtml` en 4 `.replace` chaines : `&`, `<`, `>`, `"` — l'apostrophe manque. Les 5 sites d'appel (lignes 66, 69, 73, 76, 95) injectent des donnees hors du controle de Sift : `drive.id`, `drive.label`, `drive.current_fs` (fournis par l'OS) et `lastError` (message backend).
- Impact : securite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Non exploitable en l'etat : les 5 interpolations tombent en contenu texte (`<div>`, `<code>`, `<label>`), jamais dans un attribut a guillemets simples. Le defaut est structurel : la prochaine edition de ce fichier qui place une de ces valeurs dans un attribut style `data-x='...'` — le pattern est deja partout dans le repo, ex. batch-panel.ts:300 `style="..."` construit par concatenation — ouvre une sortie d'attribut que le helper canonique aurait fermee. C'est la meme classe de trou que l'audit du 2026-07-10 a corrige dans journal.ts.
- Fichiers : `frontend/usb-format-modal.ts`, `frontend/dom.ts`
- Correctif esquisse : `import { esc } from "./dom";` et supprimer escapeHtml (renommer les 5 appels). Un seul echappeur dans le repo, celui qui porte la doctrine.

### [PP-12] Les cles de la table settings sont dupliquees en litteraux nus des deux cotes de l'IPC, sans entree dans shared/contracts.ts ni test de contrat
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/reglages-view.ts:61`
- Preuve : Cote Rust, settings.rs:8-24 declare 6 cles comme constantes documentees (`LIBRARY_ROOT`, `FILENAME_TEMPLATE`, `DISCOGS_TOKEN`, `CURRENT_SESSION_ID`, `REKORDBOX_XML_PATH`, `REKORDBOX_XML_DRIFT`). Cote TS, aucune n'existe dans shared/contracts.ts (lecture integrale, 436 lignes : seules FILE_IN_PLACE, EXTERNAL_DEST_PREFIX et MAX_ANALYSIS_ATTEMPTS y sont). Elles sont retapees en litteraux : filing-bins.ts:17 `const LIBRARY_ROOT = "library_root"`, home-sources.ts:14 `const LIBRARY_ROOT = "library_root"; // same setting key filing.ts gates the destination tree on`, theme.ts:7 `const THEME_SETTING = "ui_theme"`, et surtout reglages-view.ts qui les inline sans constante du tout — lignes 48, 54, 61, 121, 132, 289 (`await setSetting("library_root", dir)`, `getSetting("discogs_token")`). `ui_theme` n'est meme pas declaree cote Rust : settings.rs ne la connait pas. Le contraste est net avec FILE_IN_PLACE, dont l'identite est verrouillee par un vrai test de contrat qui lit shared/contracts.ts depuis Rust (filing.rs:1999-2013).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Un renommage de cle cote Rust (ou une faute de frappe dans un des 6 sites TS) ne casse ni la compilation Rust, ni `tsc --noEmit`, ni aucun test : `settings::get` renvoie simplement `None` sur la cle inconnue. La racine de bibliotheque parait vide, l'arbre de destination se desactive, le token Discogs disparait — tout cela silencieusement, avec le comportement d'un premier lancement.
- Fichiers : `shared/contracts.ts`, `src-tauri/src/settings.rs`, `frontend/reglages-view.ts`, `frontend/filing-bins.ts`, `frontend/theme.ts`, `frontend/home-sources.ts`
- Correctif esquisse : Exporter les cles depuis shared/contracts.ts (comme FILE_IN_PLACE), importer partout cote TS, et ajouter dans settings.rs le meme test de contrat que filing.rs:1999 — il lit deja le fichier TS, le pattern est en place.

### [PP-13] Le savoir produit (utilisateur, but, personnalite, principes) est maintenu en trois exemplaires vivants sans autorite designee
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `PRODUCT.md:9`
- Preuve : Trois fichiers actifs decrivent les memes faits. PRD.md (racine) : sections « Utilisateur et contextes d'usage » (l.26) et « Objectif » (l.20). PRODUCT.md (racine) : « ## Users » (« DJs professionnels et amateurs serieux qui preparent leur set avant un gig ... Pas d'usage en direct sur scene »), « ## Product Purpose », « ## Brand Personality », « ## Design Principles » (dont « Densite avant decoration »). docs/design-system/foundations.md:9-33 : « ## Produit » (« Il sert avant le set, pas pendant le live »), « ## Utilisateur » (« un DJ serieux qui traite de gros volumes »), puis « densite avant decoration ». CLAUDE.md ne nomme AUCUN des trois comme source produit ; PRODUCT.md n'est reference que depuis .claude/skills/impeccable/reference/*.md (skill vendue), c'est-a-dire par le seul outil que CLAUDE.md:90 route en premier sur toute tache UI existante. Aucun des trois ne renvoie aux deux autres.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **C**
- Scenario de defaillance : Divergence deja amorcee sur l'accessibilite : PRODUCT.md affirme « Pas d'exigence WCAG formelle pour l'instant », alors que le chantier UX du 2026-07-18 a corrige les tokens text-tertiary/quaternary pour atteindre WCAG AA (docs/superpowers/plans/2026-07-18-ux-fixes-homogeneity.md, finding F1). Un agent `impeccable`, qui charge PRODUCT.md automatiquement a chaque invocation, travaille donc sur une contrainte d'a11y que le code a depassee.
- Fichiers : `PRODUCT.md`, `PRD.md`, `docs/design-system/foundations.md`, `CLAUDE.md`
- Correctif esquisse : Designer une seule autorite produit dans CLAUDE.md (PRD.md est le candidat naturel, deja cite par les designs recents) et reduire les deux autres a des pointeurs — PRODUCT.md ne gardant que ce que la skill impeccable exige et qui n'existe pas ailleurs (Register, anti-references).

### [PP-14] Les 8 constantes cryptographiques SQLCipher de master.db sont recopiees a l'identique en Python
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `scripts/decrypt-masterdb-debug.py:36`
- Preuve : rekordbox_masterdb.rs:81-92 declare PAGE_SIZE=4096, RESERVE=80, KDF_ITER=256_000, HMAC_KDF_ITER=2, HMAC_SALT_XOR=0x3a, SALT_LEN=16, puis lignes 116-118 BLOB (chaine base85 de 74 caracteres) et BLOB_KEY=b"657f48f84c437cc1". decrypt-masterdb-debug.py:36-46 les repete toutes, valeur pour valeur, en s'annoncant comme « Pure-Python port of `decrypt_masterdb()`/`deobfuscate_key()` in `src-tauri/src/rekordbox_masterdb.rs` ». Rien ne relie les deux : le Rust a un `const _: () = assert!(...)` d'alignement AES (l.102-105) et un test de non-regression sur la cle derivee (l.1635-1638), le Python n'a aucun test. RESERVE a deja bouge une fois cote Rust (0->80, documente dans docs/superpowers/plans/2026-07-06-m8-tier1-write-path-rust.md).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Une future correction d'une de ces constantes cote Rust (comme RESERVE 0->80 l'a ete) laisse le script Python dechiffrer de travers. Comme c'est precisement l'outil qu'on sort pour arbitrer « est-ce le lecteur Rust qui se trompe ? », l'enqueteur compare deux resultats faux et conclut a un bug la ou il n'y en a pas — sur un chemin d'ecriture dans un master.db reel, ce qui est la zone la plus dangereuse du projet.
- Fichiers : `scripts/decrypt-masterdb-debug.py`, `src-tauri/src/rekordbox_masterdb.rs`
- Correctif esquisse : Soit generer l'en-tete de constantes du script depuis le Rust, soit lui ajouter une assertion qui lit rekordbox_masterdb.rs et compare les 8 valeurs avant de dechiffrer (echec bruyant plutot que sortie fausse).

### [PP-15] La quantification dB du spectrogramme (-100..0 dBFS sur 0..255) est reimplementee en TS sans garde
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/report-view.ts:136`
- Preuve : Cote Rust, spectrum.rs:118-123 : `let db = ...; let clamped = db.clamp(-100.0, 0.0); ((clamped + 100.0) / 100.0 * 255.0) as u8`. Cote TS, report-view.ts:135-137 fait l'inverse a la main : `function rawToDbfs(val: number): number { return (val / 255) * 100 - 100; }` et le facteur 100 est re-code deux fois de plus lignes 116-117 (`SPECTRO_CEILING_RAW = 255 - (SPECTRO_GAIN_DB / 100) * 255`, `SPECTRO_FLOOR_RAW = ... (SPECTRO_RANGE_DB / 100) * 255`). Le contrat est documente (shared/contracts.ts:84-85 « frames*bins, row-major, 0..255 (-100..0 dBFS) ») mais aucun test ne le tient — la Phase 2 n'a verrouille que 2 constantes et 10 formes de structs (docs/superpowers/plans/2026-07-14-phase2-closing-report.md).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Elargissement de la plage cote Rust (spectrum.rs:122, ex. clamp(-120,0)) : le reticule interactif du spectrogramme continue d'annoncer des dB calcules sur 100 dB. Un fichier lu a -110 dBFS s'affiche a environ -95 dBFS. Sur un ecran dont le role est de trancher « faux lossless ou pas », c'est une valeur de diagnostic fausse presentee comme exacte — alors que le commentaire de report-view.ts:143-145 promet justement « la MEME formule que celle qui colore ce pixel ... jamais une valeur recalculee differemment qui pourrait diverger ».
- Fichiers : `frontend/report-view.ts`, `src-tauri/src/analysis/spectrum.rs`, `shared/contracts.ts`
- Correctif esquisse : Publier la plage (DB_FLOOR/DB_CEIL) dans shared/contracts.ts et ajouter un test de contrat Rust qui la relit, sur le modele de filing.rs:1999-2013 ; ou faire porter les dB par le payload plutot que par une formule dupliquee.

### [PP-16] docs/INDEX.json omet 6 documents, dont un design de migration React qui contredit frontalement le stack declare dans CLAUDE.md
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md:1`
- Preuve : Diff programmatique (script python, os.walk sur docs/ hors archive design_handoff) : 152 fichiers .md/.html sur disque, 146 references dans INDEX.json, 6 absents — docs/chat-project-instructions.md, docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md, docs/superpowers/plans/2026-07-09-ux-heuristics-audit-fixes.md, docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md, docs/superpowers/plans/2026-07-14-phase3-measurement.md, docs/wireframes/suggestion-destination.html (0 reference morte dans l'autre sens). CLAUDE.md:113-117 exige pourtant l'ajout « dans le meme geste, pas en rattrapage differe ». Le plus lourd des 6 : « # Migration Sift vers React + shadcn/ui — plan (pas execute) ... Reecrire le frontend de Sift en React + Tailwind + shadcn/ui », non archive, dans un chemin scanne. CLAUDE.md:34-36 dit l'inverse : « Stack assume : vanilla TS sans framework ... une migration de framework est explicitement ecartee (Evaluation 3, ressources-externes) ». Un troisieme signal existe a la racine : components.json (config shadcn, `"css": "frontend/styles.css"`, `"components": "frontend"`).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Un agent cherche l'etat du stack frontend. S'il lit CLAUDE.md, la migration est ecartee ; s'il tombe sur le design (chemin actif, non archive, invisible dans l'index cense servir a trouver un doc sans grepper), la migration est le plan. Aucun des deux ne renvoie a l'autre, et components.json a la racine tranche en faveur du second. Deux verites actives sur une decision structurante.
- Fichiers : `docs/INDEX.json`, `docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md`, `CLAUDE.md`, `components.json`
- Correctif esquisse : Trancher la contradiction dans CLAUDE.md (ecartee -> archiver le design sous changes/archive/ ; ou reouverte -> reecrire CLAUDE.md:34-36), puis indexer les 6 fichiers manquants. Statuer aussi sur components.json, qui pointe vers un frontend sans React.

### [PP-17] Le meme concept « ranger sur place » porte deux libelles utilisateur, dont un en anglais dans une UI declaree francaise
- Passe : pragmatic-programmer (DRY du SAVOIR, orthogonalite, couplage, dette de tooling) — Sift, branche perf-mi-fixes, lecture seule
- Emplacement : `frontend/filing-actions.ts:20`
- Preuve : Un seul concept backend (`filing::FILE_IN_PLACE` / shared/contracts.ts:7), deux libelles independants cote front : batch-panel.ts:33 `const IN_PLACE_LABEL = "Dossier source de chaque morceau";` et filing-actions.ts:20 `const IN_PLACE_BIN_LABEL = "source folder";`. Le second est bien affiche : filing-actions.ts:75 `const bin = inPlace ? IN_PLACE_BIN_LABEL : binLabel();` alimente showFiledConfirm, qui rend filing-actions.ts:173 `<span class="sift-filed-banner-bin">→ ${esc(bin)}</span>`. docs/design-system/content.md:113 pose pourtant la regle : « L'interface est en francais. » — et ce fichier est designe par governance.md comme l'endroit ou vit tout « nouveau libelle canonique ».
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Ranger une piste en mode Detail avec l'option « sur place » activee : la banniere de confirmation francaise affiche « → source folder ». Le meme etat, atteint depuis le mode Lot, affiche « Dossier source de chaque morceau ». Deux ecrans, un concept, deux mots, une langue de trop.
- Fichiers : `frontend/filing-actions.ts`, `frontend/batch-panel.ts`, `docs/design-system/content.md`
- Correctif esquisse : Une seule constante partagee (filing-state.ts ou filing-preview.ts), valeur francaise, importee par les deux panneaux ; inscrire le libelle dans content.md comme le veut le tableau « Quand Modifier Quel Fichier » de governance.md.

---

## Passe 4 — clean-code

**Portee reellement balayee.**

LU D'ABORD (obligatoire avant jugement) : CLAUDE.md racine (403 l.), AGENTS.md, .claude/rules/rust.md (124 l.), .claude/rules/context-packs.md, docs/INDEX.json, et TECH_DEBT_AUDIT.md EN ENTIER — ce dernier pour ne pas re-plaider des points deja tranches. Consequence directe : j ecarte volontairement 4 findings que j avais trouves et qui sont deja explicitement statues "actually fine" dans TECH_DEBT_AUDIT.md § "Things that look bad but are actually fine" — les 3 expect() de rekordbox_masterdb.rs:521/616/732 (item 3, prouves infaillibles), le `let _ = conn.execute` du self-heal de cache d ipc.rs (item 5), les innerHTML de filing.ts (item 7), et les format!() de nom de table (item 4). Je signale en revanche lib.rs, que ce meme audit n a PAS balaye (sa liste de fichiers "zero unguarded panics" ne le contient pas) — voir CC-5.

BALAYAGE SCRIPTE, PROUVE (comptes non nuls) : (1) 50 fichiers .rs enumeres avec leur nombre de lignes ; (2) unwrap()/expect() hors #[cfg(test)] sur les 50 fichiers, avec detection des bornes de mod tests par comptage d accolades — 52 occurrences, dont 44 dans bench_volume.rs (fichier lui-meme gate `#[cfg(test)] mod bench_volume;` a lib.rs:4-5, verifie) ; restent 4 dans lib.rs et 3 dans rekordbox_masterdb.rs ; (3) fonctions Rust >= 60 lignes hors tests : 33 (dont 1 faux positif, next_group, du a des litteraux de char '{'/'}') ; (4) 431 `#[test]` comptes fichier par fichier, plus extraction des corps sans assert (14, dont 12 sont les tests de contrat IPC a destructuration exhaustive — echec a la COMPILATION, documente, non defectueux) ; (5) `let _ =` en code de prod : 25 sites ; (6) modules sans aucun `#[cfg(test)]` : 4 (ipc.rs 477 l., ipc_identify.rs 124 l., ipc_usb.rs 44 l., main.rs) ; (7) 37 fichiers .ts frontend hors stories = 11 485 lignes, inventaire complet des `catch` par fichier, et grep dedie des catch vides.

FICHIERS REELLEMENT OUVERTS (tout finding ci-dessous vient d une de ces lectures) : Rust — lib.rs (integral), watcher.rs (1-166), worker.rs (1-340), ipc_identify.rs (integral), b85_bytes.rs (integral), ipc.rs (240-365), ipc_filing.rs (300-930), filing.rs (521-645), library.rs (180-311), rekordbox_repairs.rs (240-640), rekordbox_masterdb.rs (490-650), search_terms.rs (1-460 et 860-1071), search_corpus.rs (690-850), metadata/discogs.rs (320-475), db.rs (235-275). Frontend — b85.ts, batch-tracklist.ts, list-virtual.ts (integraux), filing.ts (280-590), sift-live.ts (150-460), rekordbox-view.ts (655-880), batch-panel.ts (660-750), bibliotheque-view.ts (240-260), report-view.ts (530-560, 700-730, 1150-1235), package.json.

CE QUE JE N AI PAS REGARDE — a ne pas lire comme une absence de defaut : actions.rs (3018 lignes, LE plus gros fichier du repo) n a recu que des greps, jamais une lecture ; idem rekordbox_xml.rs (1176), dedup.rs (688), tout analysis/* (DSP, ~1900 lignes cumulees), usb_format/*, tagging.rs, naming.rs, encode.rs, ecartes.rs, genres.rs, scanner.rs, sources.rs, settings.rs, fingerprint.rs. Cote frontend : report-view.ts hors des 3 fenetres citees (mountPlayer, 311 lignes, non lu), filing-identify.ts (706), queue-panel.ts (703), journal.ts (396), library-detail.ts (410), reglages-view.ts, home-sources.ts, chrome.ts, dev-inspector.ts — non lus. styles.css hors lentille. Sur la QUALITE des tests : je l ai evaluee structurellement (presence d assert sur les 431) plus une lecture de 6 modules de tests seulement (b85_bytes, search_terms, search_corpus, worker, rekordbox_repairs partiel, lib) — l axe "test qui teste sa propre implementation" est donc SONDE, pas balaye ; je ne peux pas affirmer qu il n y en a pas ailleurs. Aucune compilation ni `cargo test` lance (lecture seule, et un tauri dev peut tourner).

### [CC-1] Un scan de doublons qui echoue affirme a l utilisateur « Aucun doublon dans toute la bibliotheque »
- Passe : clean-code
- Emplacement : `frontend/sift-live.ts:321-324`
- Preuve : sift-live.ts:319-328 : `.then((groups) => { bibDup.groups = groups; }).catch((e) => { console.error("scan_library_duplicates failed", e); bibDup.groups = []; })`. Le MEME bloc de 15 lignes est copie une deuxieme fois a sift-live.ts:419-430 (branche `act === "dupscan"`). Cote rendu, bibliotheque-view.ts:250-251 : `: bibDup.groups.length === 0 ? '<div ...>Aucun doublon dans toute la bibliotheque.</div>'`. Il n existe aucun etat d erreur : `bibDup` ne porte que `{groups, loading, shown}` (bibliotheque-view.ts:46). L echec et le succes-a-zero sont donc litteralement le meme etat.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Bibliotheque de ~35 000 pistes filed. L utilisateur clique la puce « Doublons ». `scan_library_duplicates` renvoie une Err (le repo a DEJA vecu exactement cette panne : genres::get_genres_batch liait un parametre SQL par piste et depassait la limite SQLite de 32766, cf. docs/superpowers/plans/2026-07-14-phase3-measurement-report.md — panne fonctionnelle, pas lenteur). Le catch pose `bibDup.groups = []`, le panneau affiche « Aucun doublon dans toute la bibliotheque. » L utilisateur conclut que sa bibliotheque est propre et passe a la suite ; la seule trace est un console.error invisible en prod. La reponse rendue est fausse, affirmative, et non retractee.
- Fichiers : `frontend/sift-live.ts`, `frontend/bibliotheque-view.ts`
- Correctif esquisse : Ajouter un troisieme etat a `bibDup` (ex. `error: string | null`), le poser dans les deux catch, et rendre un bloc d erreur + bouton Reessayer au lieu du message « Aucun doublon ». Au passage, extraire le bloc duplique en une seule fonction `loadDuplicates()` appelee par les deux branches.

### [CC-2] Les workers de la phase 2 du filing par lot n ont pas de catch_unwind, et la piste perdue est affichee « fait » a l utilisateur
- Passe : clean-code
- Emplacement : `src-tauri/src/ipc_filing.rs:763-788`
- Preuve : ipc_filing.rs:763-788 : `handles.push(std::thread::spawn(move || { loop { ... let log = filing::execute_file(&job.plan).map_err(...).ok(); if tx.send(Phase2Outcome{...}).is_err() { break; } } }))` — aucun `catch_unwind`. Or le MEME appel, sur le chemin interactif, en est entoure : ipc_filing.rs:437-439 `std::panic::catch_unwind(AssertUnwindSafe(|| filing::execute_file(&plan)))` avec le commentaire ligne 433-436 « the same "heavy work on an unvetted user file, on a thread nobody joins" shape as worker.rs's analysis loop, so it gets the same catch_unwind treatment ». worker.rs:307-318 applique le meme garde. .claude/rules/rust.md:81-92 en fait une regle projet explicite (« A reproduire pour toute future tache lourde ajoutee dans un worker_loop-like tournant sur de l I/O utilisateur non maitrise »). Consequence cote UI, verifiee : batch-panel.ts:685-687 `finishBatchTracklist(processed.filter((id) => !failed.has(id)), res.needs_validation)` avec `processed = batchTrackIds` (run non annule), et batch-tracklist.ts:84-87 `if (bad.has(row.id)) paint(row,"fail"); else if (ok.has(row.id)) paint(row,"done")`.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Lot de 50 pistes. Le fichier n°17 est un FLAC corrompu qui fait paniquer lofty ou le pipeline d encodage a l interieur d `execute_file` (surface d entree non maitrisee, exactement la raison pour laquelle le chemin interactif est protege). Le thread worker meurt : aucun `Phase2Outcome` n est envoye pour cette piste, elle n est ni dans `filed`, ni dans `needs_validation`, et elle n est plus dans `queue` (elle avait ete pop). Le pool perd un thread pour le reste du lot. Cote UI, `finishBatchTracklist` recoit la piste 17 dans `processed` et pas dans `needs_validation` : elle est peinte « fait » (coche verte). L utilisateur lit « converti » sur une piste qui est restee `pending`, non convertie, et dont le rollback FS n a jamais tourne (fichier partiel possible a destination). Le compteur de progression, lui, plafonne a 49/50.
- Fichiers : `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Envelopper `filing::execute_file(&job.plan)` du worker dans `std::panic::catch_unwind(AssertUnwindSafe(...))`, transformer le panic en `log = None` + log::error!, et envoyer quand meme le `Phase2Outcome` — la piste part alors en needs_validation comme n importe quel echec.

### [CC-3] watcher.rs sort en silence sur 6 chemins d echec, dont le `let Ok(conn) = state.lock() else { return }` interdit nommement par la regle projet
- Passe : clean-code
- Emplacement : `src-tauri/src/watcher.rs:33`
- Preuve : watcher.rs:33 `let Ok(conn) = state.lock() else { return };` (start_all) et watcher.rs:119 `let Ok(conn) = state.lock() else { return };` (handle_events) — aucun log dans les deux cas. .claude/rules/rust.md:76-80 interdit litteralement cette forme : « refill/read_path/persist_result faisaient `let Ok(x) = ... else { return }` sur un lock potentiellement empoisonne — violation directe du principe fail-fast/pas-de-fallback-silencieux [...] Pattern a suivre : `match state.lock() { Ok(x) => x, Err(_) => { log::error!("..."); return None; } }`, jamais juste `.ok()?`/`else { return }` nu ». Le correctif de 2026-07-17 (commit c94685c) a bien atteint worker.rs — worker.rs:189-192, 243-249, 271-276 loguent tous — mais jamais watcher.rs. Quatre autres sorties muettes dans le meme fichier : :34 `let Ok(mut stmt) = conn.prepare(...) else { return };`, :37 `let Ok(rows) = stmt.query_map(...) else { return };`, :143 `if scanner::upsert_file(&conn, source_id, &f).is_ok() { touched = true; }` (erreur jetee), :151 `if let Ok(n) = scanner::forget_path(&conn, &p)` (erreur jetee).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Le Mutex<Connection> est empoisonne par un panic ailleurs pendant qu il est tenu (chemin plausible et non garde : ipc_filing.rs:833-849 prend `state.lock()` puis appelle `filing::commit_file` sans catch_unwind). A partir de la : chaque batch d evenements FS entre dans handle_events, tombe sur watcher.rs:119, et `return` sans une ligne de log. L utilisateur depose des fichiers dans un dossier surveille ; l ecran Reglages continue d afficher la source comme « surveillee » ; rien n arrive jamais dans la file ; il n y a aucune trace nulle part. Variante sans empoisonnement : si `conn.prepare` echoue au demarrage (watcher.rs:34), `start_all` retourne apres avoir demarre ZERO watcher, silencieusement, pour toute la session.
- Fichiers : `src-tauri/src/watcher.rs`
- Correctif esquisse : Remplacer les 4 `let Ok(...) else { return }` par un `match` avec `log::error!` decrivant l operation et la source concernee ; loguer l Err de `upsert_file`/`forget_path` au lieu de la jeter (`if let Err(e) = ... { log::error!(...) }`).

### [CC-4] rollback_fs avale toutes ses erreurs sans un seul log, alors que c est lui qui garantit le « FS is left clean » invoque par les deux appelants
- Passe : clean-code
- Emplacement : `src-tauri/src/filing.rs:596-620`
- Preuve : filing.rs:596-620 : `"move" | "trash" => { let _ = move_cross_disk_safe(&fs.to, Path::new(&fs.from)); }`, `"convert" => { let _ = std::fs::remove_file(&fs.to); }`, `"tag_edit" => { ... let _ = tagging::restore_tags(&fs.from, &snap); }`. Le commentaire ligne 609 l assume (« best-effort like the rest of this rollback (errors are swallowed) ») mais il n y a aucun log. Or deux appelants s appuient sur ce rollback comme sur une garantie : ipc_filing.rs:631-633 (« `None` = execute_file failed (the FS is left clean by execute_file itself) ») et ipc_filing.rs:855 (« execute_file failed (FS left clean by it) »). C est exactement la classe de defaut deja identifiee par TECH_DEBT_AUDIT.md F01/F02 sur le module frere (rekordbox_masterdb.rs, rollback avale + zero log) — ce site-la n a jamais ete balaye par cet audit.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Piste conformante : les tags sont ecrits en place, puis le fichier est deplace source -> dest (filing.rs:538-554). La phase 3 echoue (verrou DB empoisonne, ipc_filing.rs:833). `rollback_fs` tente `move_cross_disk_safe(dest -> source)` ; le volume de destination vient d etre demonte, ou un lecteur audio tient le fichier. Le `let _ =` avale l echec. Resultat : le fichier de l utilisateur est reste a `dest` avec de NOUVEAUX tags, la ligne DB pointe toujours sur `source`, la piste reste `pending` sur un chemin vide, et il n existe aucune ligne de log expliquant ou est passe le fichier.
- Fichiers : `src-tauri/src/filing.rs`
- Correctif esquisse : Remplacer chaque `let _ =` par `if let Err(e) = ... { log::error!("rollback {kind} failed: {from} -> {to}: {e}") }`. Optionnellement faire remonter un booleen « rollback incomplet » a commit_file pour que l appelant puisse le dire a l utilisateur au lieu d un echec generique.

### [CC-5] expect() en code de prod sur le chemin de boot — la consequence exacte est deja documentee dans db.rs, sans message pour l utilisateur
- Passe : clean-code
- Emplacement : `src-tauri/src/lib.rs:180`
- Preuve : lib.rs:178 `let dir = app.path().app_data_dir().expect("no app data dir");`, lib.rs:180 `let conn = db::open(&dir.join("sift.db")).expect("db open failed");`, lib.rs:189-190 `settings::set(...).expect("session_id write failed");`. .claude/rules/rust.md:44-47 : « unwrap()/expect() hors #[cfg(test)] = interdit dur ». Le `setup` est une closure qui renvoie `Result` (elle finit par `Ok(())` a lib.rs:202 et utilise deja `?` a lib.rs:154) : `?` est disponible sans rien restructurer. Surtout, db.rs:244-250 nomme deja la consequence noir sur blanc : « une migration whose failure aborts db::open (lib.rs `.expect("db open failed")`): a full disk or an antivirus holding the file would panic the app at every launch until the condition clears ». Note : les 3 expect() de rekordbox_masterdb.rs sont deliberement HORS de ce finding, TECH_DEBT_AUDIT.md § « actually fine » item 3 les ayant deja juges infaillibles ; lib.rs n a jamais figure dans la liste de fichiers balayes par cet audit.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Disque plein, ou un antivirus tient sift.db pendant l ouverture (scenario nomme par db.rs:248). `db::open` renvoie Err ; l `expect` panique dans `setup`. L application meurt sans fenetre et sans message : l utilisateur voit un lancement qui ne fait rien, a chaque tentative, sans savoir que c est son disque. Avec `?`, Tauri remonte l erreur de setup et le message « db open failed: disk I/O error » est au moins visible.
- Fichiers : `src-tauri/src/lib.rs`
- Correctif esquisse : Remplacer les trois `expect` par `?` avec un contexte (`.map_err(|e| format!("ouverture de la base: {e}"))?`). Le `.expect` final de `.run(tauri::generate_context!())` (lib.rs:276) est du boilerplate genere hors closure et peut rester.

### [CC-6] rekordbox_repairs.rs : trois familles de fonctions quasi identiques (repair / metadata sync / artwork sync), messages et tests compris
- Passe : clean-code
- Emplacement : `src-tauri/src/rekordbox_repairs.rs:233-369`
- Preuve : Trois quintuplets structurellement identiques : `dismiss_repair_inner`(:223) / `dismiss_metadata_sync_inner`(:459) / (artwork, meme forme) ; `resolve_ambiguous_inner`(:233) / `resolve_ambiguous_metadata_sync_inner`(:470) / artwork(:~700) ; `apply_one_repair`(:264, 82 l.) / `apply_one_metadata_sync`(:509, 78 l.) / `apply_one_artwork_sync`(:735, 75 l.) ; `apply_repairs_inner`(:351) / `apply_metadata_syncs_inner`(:589) / artwork ; `ApplyRepairOutcome`(:50) / `ApplyMetadataSyncOutcome`(:501) / `ApplyArtworkSyncOutcome`(:726) — trois structs `{id: i64, ok: bool, error: Option<String>}` identiques au champ pres. Les messages sont dupliques a l identique : « cette ligne n est plus ambigue — rechargement necessaire » aux lignes 247, 484, 709 ; « piste choisie invalide pour cette ambiguite » aux lignes 251, 488, 713 ; « piste ambigue ou deja traitee — resolution manuelle requise » aux lignes 297, 548, 762. Les tests suivent : `resolve_ambiguous_*` x3 scenarios x3 familles = 9 tests quasi identiques (:1401, :1425, :1448, :1684, :1710, :1731, :2259, :2286, :2309).
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/rekordbox_repairs.rs`
- Correctif esquisse : Un seul `ApplyOutcome` partage, et un descripteur de tier (`&'static str` de table + colonne d id + closure d ecriture) passe a des `resolve_ambiguous_row(desc, ...)` / `apply_one(desc, ...)` generiques ; les trois messages deviennent trois `const`. Les 9 tests se replient sur un test parametre par le descripteur.

### [CC-7] handleRekordboxAction : 345 lignes, 20 branches, 3 familles copiees, et la classification d erreur se fait par sous-chaine francaise dupliquee 3 fois
- Passe : clean-code
- Emplacement : `frontend/rekordbox-view.ts:660-1005`
- Preuve : rekordbox-view.ts:660 `export function handleRekordboxAction(...)` : chaine de `else if` sur `act` avec 20 branches enumerees a :666, 669, 679, 685, 698, 710, 730, 770, 798, 808, 814, 827, 839, 859, 899, 909, 915, 928, 940, 960 — soit trois familles `mdb*`/`mds*`/`mas*` de 6 branches chacune, identiques au nom d etat pres (`mdbRepairSel`/`mdsSyncSel`/`masSyncSel`, `rerenderMasterdbRepairsSection`/`rerenderMetadataSyncsSection`/`rerenderArtworkSyncsSection`). Le pire site est la classification d erreur, copiee verbatim 3 fois — rekordbox-view.ts:723, :852, :953 : `raw.includes("plus ambiguë") || raw.includes("piste choisie invalide") ? raw : "Choix impossible — réessaie"`. Ces deux sous-chaines sont exactement les messages Rust de CC-6 (rekordbox_repairs.rs:247/484/709 et :251/488/713) : le meme message existe donc a 6 endroits, 3 en Rust et 3 en TS, sans aucun code d erreur stable entre les deux.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `frontend/rekordbox-view.ts`, `src-tauri/src/rekordbox_repairs.rs`
- Correctif esquisse : Introduire des sentinelles stables cote Rust (meme convention que `ALREADY_FILING` / `NoLibraryRoot`, ipc_filing.rs:307) et tester le code, pas le texte francais. Puis factoriser les 3 familles en une table `{prefix, sel, errById, expanded, rerender, ipc}` et une seule implementation de pick/grouptoggle/groupselect/dismiss/resolve/apply.

### [CC-8] run_file_batch : 255 lignes, trois phases, un registre de reservation et l emission de progression dans une seule fonction
- Passe : clean-code
- Emplacement : `src-tauri/src/ipc_filing.rs:651-905`
- Preuve : ipc_filing.rs:651 `fn run_file_batch(...)` s etend jusqu a :905. Elle contient : la phase 1 de planification sous verrou avec le set `reserved` et la liste `claims` (:667-747), le montage d un pool mpsc + N threads (:749-789), la boucle de collecte avec sondage du drapeau d annulation (:792-808), le tri par ordre de lot (:811), la phase 3 de commit sous verrou avec accumulation des paires de reparation XML (:813-865), le flush XML (:867-871), le balayage des jobs jamais demarres (:873-879), la liberation des claims (:884-886) et deux emissions d evenements finales (:888-904). Six responsabilites distinctes, chacune avec son propre traitement d erreur, dans un seul corps ; les 15 lignes de doc-comment (:636-650) qui la precedent sont elles-memes la preuve qu elle a besoin d un mode d emploi.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Extraire trois fonctions nommees d apres les phases que le doc-comment decrit deja : `plan_batch(...) -> (Vec<PlannedJob>, Vec<i64> needs_validation, Vec<(i64,String)> claims, bool cancelled)`, `run_phase2(jobs, cancel) -> Vec<Phase2Outcome>`, `commit_outcomes(...) -> (usize filed, Vec<i64>)`. Le corps restant devient une dizaine de lignes d orchestration + emissions.

### [CC-9] Aucune suite de tests frontend : 11 485 lignes de TypeScript sans un seul test, dont un decodeur binaire miroir dont le vecteur de reference existe cote Rust mais n est verifie nulle part cote TS
- Passe : clean-code
- Emplacement : `package.json:7-14`
- Preuve : package.json ne declare aucun script `test` (scripts : dev, build, preview, tauri, fetch-ffmpeg, lint:tokens, storybook, build-storybook) et aucune devDependency de runner (ni vitest, ni jest, ni playwright). Aucun fichier vitest.config.*/jest.config.*/playwright.config.* a la racine, aucun *.test.ts ni *.spec.ts dans le repo. Les 3 seuls fichiers *.stories.ts sont de la doc visuelle Storybook. Portee mesuree : 37 fichiers .ts hors stories = 11 485 lignes. Le cout le plus net est frontend/b85.ts : un decodeur base85 ecrit a la main, dont l en-tete (b85.ts:1-14) dit « exact mirror of the base85 2.0.0 crate used on the Rust side » et « Do not "fix" the 126 padding value: it is what the encoder's inverse expects, and the Rust round-trip test in b85_bytes.rs pins it ». Or le test en question, b85_bytes.rs:130-137 `frozen_vector_matches_the_reference_encoding`, fige la chaine `"009C61O)~M2nh-c3=Iws"` pour les octets 0x00..=0x0F et son commentaire dit explicitement « any independent decoder (e.g. the frontend one) must map this exact string back » — mais rien cote TS ne consomme ce vecteur. Le contrat inter-langage est unilateral.
- Impact : correctness
- Effort : L
- Risque du fix : faible
- Note : **B**
- Fichiers : `package.json`, `frontend/b85.ts`, `src-tauri/src/b85_bytes.rs`, `frontend/batch-tracklist.ts`
- Correctif esquisse : Ajouter vitest (config a 5 lignes, il partage deja le pipeline Vite du repo) et commencer par les modules purs et sans DOM : b85.ts contre le vecteur fige de b85_bytes.rs:134, batch-tracklist.ts (derivation d etat pure), genre-families.ts, library-views.ts/sortTracks. Ne pas viser la couverture des vues, viser les fonctions qui ont une reponse juste.

### [CC-10] ipc_identify.rs n a aucun test alors que build_query est le point de composition neuf du chantier Discogs en cours
- Passe : clean-code
- Emplacement : `src-tauri/src/ipc_identify.rs:51-85`
- Preuve : Le fichier fait 124 lignes et ne contient aucun `#[cfg(test)]` (balayage des 50 fichiers .rs : seuls ipc.rs, ipc_identify.rs, ipc_usb.rs et main.rs sont dans ce cas). `build_query` (:51-85) est pourtant une fonction PURE qui porte une regle d arbitrage neuve et non triviale : `let tags_clean = crate::naming::is_clean(&tag_artist, &tag_title);` puis `let (artist, title) = if tags_clean { tags } else { (terms.artist, terms.title) }` (:65-71), et la construction de `attempts` qui prefixe conditionnellement la requete issue des tags (:73-77) tandis que `version` vient TOUJOURS de search_terms (:82). Contraste mesurable dans le meme chantier : search_terms.rs a 11 tests et search_corpus.rs fige un corpus de 77 cas reels avec quatre constantes de plancher (search_corpus.rs:799-802, TERMS_EXACT=75 etc.). Toute la rigueur porte sur le producteur ; le point ou ses sorties sont melangees aux tags n a rien.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Fichiers : `src-tauri/src/ipc_identify.rs`
- Correctif esquisse : Ajouter un `#[cfg(test)] mod tests` a ipc_identify.rs couvrant build_query sur 4 cas : tags propres (les tags gagnent, la cascade suit), tags sales (search_terms gagne), tags propres mais version presente seulement dans le nom, et stem/folder vides. La fonction est pure — aucun runtime Tauri requis.

### [CC-11] Suppression de doublons par lot : un echec partiel affiche « tout a echoue » et laisse la liste perimee a l ecran
- Passe : clean-code
- Emplacement : `frontend/sift-live.ts:444-452`
- Preuve : sift-live.ts:444-452 : `void Promise.all(losers.map((id) => trashTrack(id))).then(() => { bibDup.groups = (bibDup.groups || []).filter((_, i) => i !== idx); return renderBiblioLive(); }).catch((e) => { console.error("dupresolve failed", e); toast("Échec : impossible d envoyer les doublons à la corbeille"); });`. `Promise.all` rejette au premier echec, mais les autres appels `trashTrack` sont deja partis et aboutissent. Le catch ne rappelle jamais `renderBiblioLive()`, donc `bibDup.groups` conserve le groupe entier.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un groupe de doublons de 3 pistes, l utilisateur confirme l envoi a la corbeille de 2 perdantes. La premiere part, la seconde echoue (fichier tenu par un lecteur audio). Le toast annonce « impossible d envoyer les doublons a la corbeille » — faux pour la premiere, qui EST a la corbeille. La vue n est pas rafraichie : le groupe affiche toujours ses 3 membres, dont un qui n existe plus a son chemin. Un second clic relance un trashTrack sur une piste deja traitee.
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : `Promise.allSettled` au lieu de `Promise.all`, compter succes/echecs, message honnete (« N envoyees, M echouees »), et appeler `renderBiblioLive()` dans TOUS les cas pour resynchroniser la liste.

### [CC-12] Copie presse-papier : catch vide et confirmation « Copié » affichee inconditionnellement
- Passe : clean-code
- Emplacement : `frontend/sift-live.ts:249-254`
- Preuve : sift-live.ts:249-254 : `void navigator.clipboard.writeText(ec.dataset.q || "").catch(() => {}); const prev = ec.innerHTML; ec.innerHTML = '<i class="ti ti-check"...></i> Copié'; setTimeout(() => { ec.innerHTML = prev; }, 1200);`. Le catch est vide (aucun log, aucun toast) et le repeint « Copié » est inconditionnel, hors de la promesse. C est le seul catch strictement vide non justifie du frontend : le balayage des 3 catch vides existants donne report-view.ts:714 et :717, tous deux documentes comme prefetch best-effort (report-view.ts:707-709 « Failures are silent by design: a prefetch must never surface UI errors »).
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Sur l ecran Écartés, l utilisateur clique « copier la requete » pour aller rechercher le morceau ailleurs. `navigator.clipboard.writeText` rejette (WebView2 sans focus document, ou permission refusee). Le bouton affiche quand meme la coche « Copié ». L utilisateur colle dans son navigateur et obtient le contenu precedent de son presse-papier.
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : Deplacer le repeint dans le `.then()` et remplacer le catch vide par un `console.error` + un feedback d echec (« Copie impossible »).

### [CC-13] verdictCardHtml : fonction morte conservee comme no-op, appelee a 4 sites, qui a deja coute deux commentaires d explication ailleurs
- Passe : clean-code
- Emplacement : `frontend/report-view.ts:552-554`
- Preuve : report-view.ts:552-554 : `export function verdictCardHtml(_r: AnalysisReport): string { return ""; }`, precedee de 18 lignes de doc (:537-551) decrivant un panneau qui n existe plus, dont l aveu « kept as a no-op (not deleted outright) so those call sites don't need touching ». Elle est appelee a report-view.ts:1106, :1192, :1215 et :1261, toujours sous la forme `verdictEl.innerHTML = verdictCardHtml(r)` — soit 4 sites dont le seul effet reel est de VIDER un conteneur. Preuve du cout deja paye : filing.ts:485-488 et filing.ts:508-511 portent DEUX fois le meme commentaire de 4 lignes (« .sift-vchips never existed in the rendered markup (verdictCardHtml() — report-view.ts — currently returns "" and never produced that wrapper); querying it was silent dead code ») — quelqu un a du enqueter sur du code mort a cause de cette fonction.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/report-view.ts`, `frontend/filing.ts`
- Correctif esquisse : Supprimer la fonction et ses 18 lignes de doc perimee ; remplacer les 4 appels par `verdictEl.innerHTML = ""` la ou le vidage est voulu, ou retirer l instruction la ou elle ne sert a rien (report-view.ts:1261 concatene une chaine vide).

### [CC-14] « reconcile » designe deux operations sans rapport dans le meme crate
- Passe : clean-code
- Emplacement : `src-tauri/src/scanner.rs:133`
- Preuve : Deux concepts partagent le verbe. Concept A, deriver une identite canonique artiste/titre depuis les tags et le nom de fichier : `naming::reconcile` (naming.rs:95), `filing::reconcile_track` (filing.rs:143), `filing::reconcile_path` (filing.rs:151), `ipc_filing::reconcile` (ipc_filing.rs:64). Concept B, synchroniser la base avec ce qui est reellement sur le disque (ajouts/mises a jour/suppressions de lignes) : `scanner::reconcile_with_progress` (scanner.rs:133), dont les tests s appellent `reconcile_adds_updates_and_removes` (scanner.rs:238) et `reconcile_drops_pending_files_that_vanished` (scanner.rs:308). Rien dans le nom ne distingue « reconcilier des metadonnees » de « reconcilier un arbre de fichiers avec la DB ».
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/scanner.rs`
- Correctif esquisse : Renommer le concept B, qui est le moins nombreux : `scanner::sync_source_with_progress` / `resync_source`, et ses tests en consequence. Le concept A garde `reconcile`, qui est le sens dominant dans le vocabulaire du projet.

### [CC-15] attempts_for porte le doc-comment d une AUTRE fonction, et probe_and_score avale silencieusement toute erreur non-rate-limit
- Passe : clean-code
- Emplacement : `src-tauri/src/metadata/discogs.rs:328-339`
- Preuve : discogs.rs:328-333 : « Fetch tracklists for the top `TRACKLIST_PROBE` candidates and score how well each contains the exact mix [...] Factored out of `search` so both the primary and the title-only fallback query can be scored the same way » — ce paragraphe decrit `probe_and_score`, mais il est colle en tete du bloc de doc de `fn attempts_for` (:339), immediatement suivi ligne 334 du vrai doc (« Construit la liste des requetes a tenter, plafonnee a LADDER_MAX_ATTEMPTS »). Deux blocs concatenes : rustdoc affichera les deux sur `attempts_for`. Second point, meme fonction voisine : discogs.rs:377-383, `Err(ProviderError::RateLimited { .. }) => { log::warn!(...) }` puis `Err(_) => {}` — l erreur reseau, le timeout et l erreur de parsing ne produisent AUCUNE trace, alors que le rate-limit en produit une.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/metadata/discogs.rs`
- Correctif esquisse : Deplacer les lignes 328-333 au-dessus de `fn probe_and_score` (:359), leur place d origine. Remplacer `Err(_) => {}` par `Err(e) => log::warn!("Discogs tracklist fetch failed for release {}: {e}", cands[i].release_id)`.

---

## Passe 5 — code-review

**Portee reellement balayee.**

LU AVANT DE JUGER: CLAUDE.md racine, AGENTS.md, .claude/rules/rust.md, .claude/rules/context-packs.md, docs/INDEX.json. Branche perf-mi-fixes (HEAD 6cd7003), aucun fichier modifie, aucun cargo/npm lance (lecture seule stricte).

RUST OUVERT INTEGRALEMENT (14 fichiers): worker.rs (508 l.), fingerprint.rs (145), dedup.rs (740), db.rs (523), metadata/discogs.rs (841), b85_bytes.rs (167), queue.rs (1-140), usb_format/mod.rs (131), ipc.rs (1-130), encode.rs (1-120), lib.rs (95-145), ipc_library.rs (163-191), usb_format/windows.rs (fn format), tagging.rs (read_tags_full/restore_tags).
RUST OUVERT PARTIELLEMENT (5): filing.rs (160-800 + carte des fn/appels fs sur les 2033 l.), ipc_filing.rs (1-905 sur 1265), actions.rs (100-345 et 600-1060 sur 3217, + carte fn/fs de tout le fichier), ecartes.rs (list_ecartes/restore_track/purge_trash), library.rs (safe_join/create_bin/cache doublons/library_stats), naming.rs (1-180 + name_key), search_terms.rs (240-440 + carte des 30 fn).

FRONTEND: balayage scripte des 40 fichiers .ts de frontend/ pour interpolation non echappee dans du HTML (script python, 57 candidats remontes, tous tries a la main). Resultat: RIEN trouve — chaque site portant de la donnee IPC (Discogs, chemins, tags, master.db) passe par esc() de dom.ts:30 ou escapeHtml() de usb-format-modal.ts:191; les 57 candidats sont des litteraux, des nombres, des constantes d'enum ou des variables deja echappees en amont (verifie ligne a ligne sur identify-shared.ts, bibliotheque-view.ts, journal.ts, queue-panel.ts, home-sources.ts, library-detail.ts, filing-identify.ts). Zero finding XSS — la discipline esc() tient. Portee du balayage: 40 fichiers, compte non nul, prouve.

PAS REGARDE DU TOUT (a ne pas lire comme une absence de defaut): rekordbox_masterdb.rs (2972 l.), rekordbox_repairs.rs (2330), rekordbox_xml.rs (1265), tout analysis/ (decode/spectrum/dynamics/phase/peaks/structure/verdict/tags — le DSP n'a pas ete audite), scanner.rs, watcher.rs, sources.rs, settings.rs, genres.rs, ipc_identify.rs, le reste de ipc_library.rs (980 l.), search_corpus.rs (859), bench_volume.rs (1127), usb_format/macos.rs, la logique de parsing de search_terms.rs (1071 l., seulement survolee). Aucune execution: pas de cargo test, pas de clippy, pas de mesure chronometree — tous les couts perf annonces sont deduits de la lecture (nombre d'appels, portee du verrou), pas mesures par moi.

### [CR-1] La retention 30 jours du journal supprime les lignes `trash` VIVANTES: restauration Ecartes definitivement cassee et fichiers orphelins sur disque
- Passe : code-review
- Emplacement : `src-tauri/src/actions.rs:869`
- Preuve : `PINNED_ACTION_IDS` (actions.rs:869-872) n'epingle QUE les 3 tables `rekordbox_masterdb_*`. `expired_batches` (actions.rs:884) ne retient qu'un batch dont `MAX(ts) < cutoff AND MIN(undone) = MAX(undone)` — un batch `trash` VIVANT n'a qu'une ligne, `undone=0`, donc MIN=MAX: il est eligible. `purge_expired_journal` tourne a chaque lancement (lib.rs:109-129, 10 s apres le boot). Or le chemin du fichier en corbeille n'existe QUE dans cette ligne: `ecartes::restore_track` la lit (ecartes.rs:139-147) et renvoie "no trashed file to restore" si elle manque, et `purge_trash` la JOIN (ecartes.rs:175-177) pour connaitre `to_path` a supprimer. La piste reste pourtant listee dans Ecartes, qui lit `tracks` par statut (ecartes.rs:76-77 `WHERE status IN ('resourcing','trash')`), et le sweep final `UPDATE tracks SET status='purged' WHERE status='trash'` (ecartes.rs:208) la fait disparaitre de l'ecran SANS toucher au fichier.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Antoine jette 200 pistes (8 Go) le 1er du mois et ne vide pas la corbeille. 31 jours plus tard il relance Sift: 10 s apres le boot, le purge efface les 200 lignes `trash`. (1) Clic sur Restaurer dans Ecartes -> erreur "no trashed file to restore", definitive, alors que le fichier est intact dans Documents/Sift/Trash. (2) Clic sur Vider la corbeille -> les 200 pistes passent a 'purged' via le sweep ecartes.rs:208, disparaissent de l'ecran, et les 8 Go restent sur le disque sans plus aucun chemin depuis l'app.
- Fichiers : `src-tauri/src/actions.rs`, `src-tauri/src/ecartes.rs`, `src-tauri/src/lib.rs`
- Correctif esquisse : Ajouter au `PINNED_ACTION_IDS` (ou a la clause NOT IN de `expired_batches`/`purge_batch`) les lignes `type='trash' AND undone=0` dont la piste est encore `status='trash'` — meme raisonnement que pour les operations master.db vivantes. Alternative complementaire: faire supprimer par le purge le fichier en corbeille avant d'effacer la ligne.

### [CR-2] `library_stats` peut decoder toute la bibliotheque rangee depuis le disque en tenant le Mutex<Connection> global
- Passe : code-review
- Emplacement : `src-tauri/src/ipc_library.rs:189`
- Preuve : `ipc_library::library_stats` prend le verrou global (`let conn = db::lock_conn(&conn)?;` ipc_library.rs:189) et le tient pendant tout `library::library_stats`, qui appelle `duplicate_count_cached` (library.rs:164). Sur cache miss celui-ci appelle `dedup::scan_library_duplicates(conn)` (library.rs:126) — le wrapper qui enchaine `load_dup_scan_rows` + `build_fingerprints` + `group_duplicates` sous la meme connexion (dedup.rs:261-268). Or `build_fingerprints` appelle `fingerprint::compute_for_path` (dedup.rs:152) pour CHAQUE ligne sans empreinte en cache, c'est-a-dire un decodage audio complet du fichier (fingerprint.rs:20-45). Le meme travail a pourtant ete soigneusement sorti du verrou 25 lignes plus haut dans le meme fichier: `ipc_library::scan_library_duplicates` (ipc_library.rs:163-181) fait read-sous-verrou / compute-hors-verrou / write-sous-verrou, avec le commentaire `guard dropped here — lock released before the heavy compute below`. Rien ne remplit `tracks.fingerprint` au rangement: seul `find_duplicate` en calcule, et uniquement pour la paire comparee (dedup.rs:388-412). L'ecran appelle `libraryStats()` a chaque rendu (bibliotheque-view.ts:166).
- Impact : perf
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Bibliotheque de 3907 pistes rangees, aucune empreinte en cache (cas nominal: le rangement n'en calcule pas). Antoine clique sur l'onglet Bibliotheque -> `library_stats` prend le verrou global et lance 3907 decodages audio (mediane mesuree 985 ms/piste selon le PRD du 2026-07-27). L'app entiere est gelee plusieurs heures: pool d'analyse bloque, toute commande IPC bloquee, aucune progression affichee, aucune annulation possible. `invalidate_duplicate_count_cache()` etant appele a chaque commit de rangement (filing.rs:694) et a chaque revert (actions.rs:817), le recalcul se represente regulierement.
- Fichiers : `src-tauri/src/ipc_library.rs`, `src-tauri/src/library.rs`, `src-tauri/src/dedup.rs`
- Correctif esquisse : Appliquer a `library_stats` le meme decoupage qu'a `scan_library_duplicates` (ipc_library.rs:163-181): sortir le comptage de doublons du verrou, ou mieux le sortir de `library_stats` (le rendre non bloquant / calcule a la demande) puisque le dashboard n'a besoin que d'un compte.

### [CR-3] Rangement conformant: l'ecriture de tags en place n'est ni annulee ni journalisee si le deplacement echoue ensuite
- Passe : code-review
- Emplacement : `src-tauri/src/filing.rs:538`
- Preuve : Dans `execute_file`, branche conformante: `tagging::write_tags_full(&plan.source, ...)` ecrit les nouveaux tags DANS le fichier source (filing.rs:538-547), puis `move_cross_disk_safe(&plan.source, ...)` (filing.rs:548). Si ce deplacement echoue, `?` retourne `Err(FilingError::Io)` et le `log: Vec<FsLog>` — qui contient pourtant la ligne `tag_edit` avec le snapshot des ANCIENS tags, poussee en filing.rs:532-537 — est simplement droppe. `rollback_fs` (filing.rs:596) n'est appele que par `commit_file` (filing.rs:686), jamais sur un echec de `execute_file`. Les deux appelants confirment: `run_file_track` se contente de logguer et de remonter l'erreur (ipc_filing.rs:440-443), `run_file_batch` fait `.map_err(log).ok()` (ipc_filing.rs:771-775) avec le commentaire faux "the FS is left clean by execute_file itself" (ipc_filing.rs:632, ipc_filing.rs:855). Le declencheur n'est pas theorique: le projet documente lui-meme le sharing violation Windows sur ce chemin — filing.rs:459 "a blocked revert (external lock, os error 32 — proved in the revert-duplicate releve)".
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Fichier .aiff deja conformant, range vers un bac dont le volume est plein ou dont le fichier destination est verrouille par l'antivirus/l'explorateur. `write_tags_full` reussit (artiste/titre/label/annee/genres/pochette ecrases dans le fichier), `std::fs::rename` echoue en os error 32 ou 112 (ni 17 ni 18, donc pas de repli copy_verify_delete). Le rangement est annonce en echec, la piste reste `pending`, et les tags d'origine sont perdus sans aucune ligne dans le Journal: le bouton Annuler ne propose rien puisque `commit_file` n'a jamais tourne.
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Dans `execute_file`, remplacer les `?` post-ecriture par une capture qui appelle `rollback_fs(&log)` avant de retourner l'erreur (le log porte deja le snapshot `tag_edit`), ou deplacer l'ecriture de tags APRES le move reussi (tagger a `plan.dest`).

### [CR-4] Les workers phase 2 du rangement par lot n'ont pas de catch_unwind: un panic fait disparaitre la piste de toute la comptabilite du lot
- Passe : code-review
- Emplacement : `src-tauri/src/ipc_filing.rs:771`
- Preuve : Dans `run_file_batch`, chaque worker appelle `filing::execute_file(&job.plan)` nu (ipc_filing.rs:771). Le chemin interactif fait exactement l'inverse 330 lignes plus haut: `std::panic::catch_unwind(AssertUnwindSafe(|| filing::execute_file(&plan)))` (ipc_filing.rs:437-448) avec le commentaire "the same 'heavy work on an unvetted user file, on a thread nobody joins' shape as worker.rs's analysis loop, so it gets the same catch_unwind treatment". C'est aussi la regle ecrite du projet (.claude/rules/rust.md:81-92). Un panic dans le worker: le job a deja ete retire de la file (`q.pop()`, ipc_filing.rs:769), le `tx` clone est droppe sans envoi, donc l'outcome n'arrive jamais dans `outcomes`; le job n'est pas non plus dans `queue` au moment du balayage final (ipc_filing.rs:875-879). Il n'est donc ni dans `filed` ni dans `needs_validation`. Meme trou si le Mutex de la file est empoisonne: `queue.lock().ok()` (ipc_filing.rs:769) rend None -> tous les workers sortent en silence, et `if let Ok(q) = queue.lock()` (ipc_filing.rs:875) echoue aussi -> les jobs restants ne sont meme pas reportes.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Lot de 50 pistes, l'une porte un conteneur corrompu qui fait paniquer lofty pendant `write_tags_full` (surface d'entree non maitrisee — c'est la raison d'etre du catch_unwind pose ailleurs). Le thread meurt. `file:done` renvoie `filed=49, needs_validation=[]` sur `total=50`: la barre de progression reste bloquee a 49/50, la piste n'apparait dans aucune liste d'echec, et si le panic est survenu apres l'ecriture des tags en place (cf. CR-3) le fichier garde ses nouveaux tags sans ligne de journal.
- Fichiers : `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Envelopper l'appel ipc_filing.rs:771 dans le meme `catch_unwind(AssertUnwindSafe(...))` que ipc_filing.rs:437, en traitant le panic comme `log: None`; logguer + reporter en `needs_validation` le cas `queue.lock()` empoisonne au lieu de sortir muet.

### [CR-5] `commit_file` dechiffre master.db (SQLCipher multi-Mo) sous le verrou global, une fois PAR PISTE du lot
- Passe : code-review
- Emplacement : `src-tauri/src/filing.rs:701`
- Preuve : `commit_file` appelle `actions::resolve_masterdb_index_if_linked(conn)` (filing.rs:701), qui fait `read_rekordbox_masterdb(&master_db_path)` (actions.rs:219) — la doc de cette fonction dit elle-meme "`master.db` is a multi-MB SQLCipher file — decrypting it is the expensive part of detection" (actions.rs:204-206). `commit_file` est appele sous le verrou global, une fois par piste: chemin interactif ipc_filing.rs:452-453 (`state.lock()` puis `commit_file`), chemin lot ipc_filing.rs:833-850 (`state.lock()` par outcome puis `commit_file`). La factorisation existante n'a resolu que le niveau au-dessous (une lecture par commit au lieu d'une par detecteur), pas le niveau lot — alors que la reparation XML, elle, a bien ete batchee une seule fois pour tout le lot via `xml_repair_sink` (filing.rs:637-643, flush ipc_filing.rs:867-871, finding P4 de l'audit 2026-07-05).
- Impact : perf
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Utilisateur ayant lie son XML Rekordbox, lot de 200 pistes. Phase 3 prend le verrou global 200 fois et dechiffre 200 fois le meme fichier master.db de plusieurs Mo. Le pool d'analyse et toute commande IPC sont bloques a chaque iteration; le budget de latence de 50 ms sur la boucle de rangement (PRD D3) est depasse a chaque piste, alors qu'une seule lecture suffirait pour tout le lot.
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Resoudre l'index master.db UNE fois avant la boucle phase 3 de `run_file_batch` (hors verrou) et l'injecter dans `commit_file` en parametre optionnel, exactement comme `xml_repair_sink` — `commit_file` retombant sur `resolve_masterdb_index_if_linked` quand rien n'est fourni (chemin interactif).

### [CR-6] `revert_batch` / `undo_last` recopient des fichiers entiers en tenant le Mutex<Connection> global
- Passe : code-review
- Emplacement : `src-tauri/src/ipc_filing.rs:1018`
- Preuve : `ipc_filing::revert_batch` prend le verrou (`let conn = db::lock_conn(&conn)?;` ipc_filing.rs:1018) et appelle `actions::revert_batch(&conn, &batch_id)` avec le verrou tenu pour toute la duree; idem `undo_last` (ipc_filing.rs:1002-1003). Or `actions::revert_batch` boucle sur `revert_one_fs` (actions.rs:773-790), dont la branche `trash` fait `std::fs::metadata` + `std::fs::copy(to, from)` + `std::fs::remove_file(to)` (actions.rs:665-684) — une copie octet a octet depuis Documents/Sift/Trash, explicitement decrite comme cross-disque. La branche `tag_edit` fait en plus une lecture+reecriture complete du fichier via `restore_tags` (actions.rs:712). Le meme travail est pourtant sorti du verrou partout ailleurs dans le sens aller: `trash_track` (ipc_filing.rs:950-963) et `file_track` (ipc_filing.rs:518-553) font tous deux plan/execute/commit precisement pour ca.
- Impact : perf
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Annulation d'un lot de 50 rangements lossless (fichiers de 40 Mo). `revert_batch` recopie 2 Go depuis la corbeille vers la bibliotheque en tenant le verrou global: pendant toute la copie (dizaines de secondes), le pool d'analyse est fige, `list_queue`/`list_library` bloquent, l'UI ne repond plus — alors que le rangement aller a ete explicitement decoupe pour eviter exactement ce gel.
- Fichiers : `src-tauri/src/ipc_filing.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Decouper `revert_batch` sur le modele plan/execute/commit deja en place: lire les lignes du batch sous verrou, relacher, executer les `revert_one_fs` hors verrou, reprendre le verrou pour marquer `undone=1` par ligne (le marquage incremental existant reste compatible avec un echec partiel).

### [CR-7] `list_queue` recalcule les cles de nom de TOUTE la bibliotheque (pending + filed) sous le verrou, a chaque rafraichissement de file
- Passe : code-review
- Emplacement : `src-tauri/src/ipc.rs:117`
- Preuve : `ipc::list_queue` prend le verrou en ipc.rs:114 et le tient pour `queue::list_pending` PUIS `dedup::name_dups(&conn)` (ipc.rs:117). `name_dups` selectionne `SELECT id, path, status FROM tracks WHERE status IN ('pending','filed')` (dedup.rs:287) — donc toute la bibliotheque rangee, pas seulement la file — et appelle `key_for_path` sur chaque ligne (dedup.rs:295), qui enchaine `naming::parse_filename` puis `naming::name_key` (naming.rs:260-277): par ligne, un `to_lowercase`, un map/fold char par char, un `split_whitespace().collect::<Vec<_>>().join(" ")` et un `format!` — soit ~5 allocations par piste. Le resultat n'est pourtant utilise que pour badger les items PENDING (ipc.rs:118-120). `list_queue` est declenche par chaque `queue:changed` (debounce 150 ms cote front, sift-live.ts:488-491), emis notamment apres chaque rangement commite.
- Impact : perf
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Cible declaree de 15 000 pistes (PRD D1), file de 20 pistes en cours de revue. Chaque rangement emet `queue:changed` -> `list_queue` -> ~15 000 normalisations de chaine et ~75 000 allocations sous le verrou global, pour badger 20 lignes. Le cout croit avec la bibliotheque rangee meme quand la file est quasi vide, et s'ajoute au budget de 50 ms de la boucle de rangement.
- Fichiers : `src-tauri/src/ipc.rs`, `src-tauri/src/dedup.rs`, `src-tauri/src/naming.rs`
- Correctif esquisse : Materialiser la cle de nom (colonne `name_key` calculee a l'insertion/au rescan, avec index) et remplacer `name_dups` par un GROUP BY SQL; ou a minima memoiser le cote `filed` (invalide comme le cache de doublons) puisque seul le cote pending bouge entre deux rafraichissements.

### [CR-8] `group_duplicates`: la similarite minimale d'un groupe est perdue des qu'un groupe fusionne dans un autre — le champ publie ment sur sa propre definition
- Passe : code-review
- Emplacement : `src-tauri/src/dedup.rs:196`
- Preuve : `min_sim` est indexe par la racine union-find COURANTE: `let root = find_root(&mut parent, i); let e = min_sim.entry(root).or_insert(s);` (dedup.rs:195-199). Mais `union` fait `parent[ra] = rb` (dedup.rs:87) — quand un arbre deja porteur d'un minimum est rattache sous un autre, son ancienne racine `ra` cesse d'etre racine et l'entree `min_sim[ra]` devient inatteignable: la lecture finale ne consulte que `min_sim.get(&root)` de la racine finale (dedup.rs:241). Trace rejouable: pistes 0,1,2. Paire (0,1) score 0.65 -> parent[0]=1, min_sim[1]=0.65. Paire (0,2) score 0.95 -> ra=find(0)=1, rb=2, parent[1]=2, root=2, min_sim[2]=0.95. Groupe final {0,1,2}, `similarity` publie = 0.95 alors que le lien le plus faible qui l'a construit vaut 0.65. La doc du champ dit pourtant "Weakest pairwise similarity that linked the group together" (dedup.rs:47).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Trois encodages du meme morceau, lies par transitivite avec des scores 0.65 puis 0.95. `DupGroup.similarity` remonte 0.95 au front (le champ traverse le contrat IPC, teste en dedup.rs:463-474) au lieu de 0.65 — un indicateur de confiance faux sur un groupe qui pilote une action destructive (envoi des perdants a la corbeille). Non affiche aujourd'hui dans bibliotheque-view.ts, donc l'impact est latent, pas visible.
- Fichiers : `src-tauri/src/dedup.rs`
- Correctif esquisse : Fusionner les minimums au moment du `union` (reporter `min_sim[ra]` sur `rb` en prenant le min), ou plus simplement accumuler les scores dans une liste `(i, j, s)` et calculer le min par groupe apres la passe union-find finale.

### [CR-9] Cascade Discogs: une erreur reseau sur un essai DEGRADE jette le meilleur resultat deja obtenu
- Passe : code-review
- Emplacement : `src-tauri/src/metadata/discogs.rs:447`
- Preuve : Dans `Discogs::search`, la boucle sur la cascade fait `let mut cands = self.search_query(attempt)?;` (discogs.rs:447). Le `?` propage immediatement toute `ProviderError` — y compris un `RateLimited` ou un `Network` transitoire sur un essai de rang 1 ou 2 — alors que la variable `best` (discogs.rs:435, alimentee en discogs.rs:458-466) contient peut-etre deja des candidats exploitables ramenes par l'essai de rang 0. Le `match best` de sortie (discogs.rs:469-472) n'est jamais atteint. Le contraste est net avec le sondage de tracklist juste a cote, ou un echec est explicitement traite comme non fatal (discogs.rs:377-383, "best-effort ... a failed or rate-limited one just leaves that candidate unscored").
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Nom de fichier sale: l'essai 0 ramene 6 candidats mais aucun score de tracklist > 0, donc la cascade continue. L'essai 1 tombe sur un 429 (le budget est de 13 requetes par clic, cf. discogs.rs:19-27, la limite Discogs est de 60/min). `search` retourne Err, le front affiche "Discogs limite le debit" (filing-identify.ts:399) et les 6 candidats deja payes sont perdus, alors qu'ils etaient affichables.
- Fichiers : `src-tauri/src/metadata/discogs.rs`
- Correctif esquisse : Remplacer le `?` de discogs.rs:447 par un `match`: sur Err, logguer et `break` la cascade pour tomber dans le `match best` final; ne propager l'erreur que si `best` est encore `None` (rang 0 en echec).

### [CR-10] worker.rs: bail muet sur le Mutex de la file de travail, et `pop` qui rend None tue le thread pour toujours
- Passe : code-review
- Emplacement : `src-tauri/src/worker.rs:202`
- Preuve : Le meme fichier applique deux regimes opposes. Sur le Mutex<Connection> il respecte la regle projet (logguer avant de bailer): worker.rs:189-191, 243-248, 271-276. Sur le Mutex<Queue> il ne la respecte pas: `refill` fait `let Ok(mut q) = m.lock() else { return };` (worker.rs:202) sans une ligne de log; `pop` fait `let mut q = m.lock().ok()?;` puis `q = cv.wait(q).ok()?;` (worker.rs:218, 227); `finish` fait `if let Ok(mut q) = m.lock()` (worker.rs:235). Or `pop` renvoyant None termine `worker_loop` (worker.rs:293 `while let Some(id) = pop(&inner)`), et rien ne relance jamais un thread du pool (aucun `join`, aucune supervision — c'est le constat pose en .claude/rules/rust.md:67-71). La regle explicite: "jamais juste `.ok()?`/`else { return }` nu sur un `Mutex` partage avec un pool de threads" (.claude/rules/rust.md:78-80).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Un panic quelconque survenu en tenant le Mutex<Queue> l'empoisonne. Des lors: chaque thread du pool sort de `worker_loop` a son prochain `pop` et n'est jamais relance -> le pool tombe a 0 thread; `refill` retourne sans rien faire a chaque `queue:changed`. Aucune trace dans les logs, aucun signal cote UI: l'analyse s'arrete definitivement et la file affiche "analyse…" pour toujours, exactement le mode de degradation silencieuse que le durcissement du 2026-07-17 pretendait fermer.
- Fichiers : `src-tauri/src/worker.rs`
- Correctif esquisse : Appliquer aux 4 sites (worker.rs:202, 218, 227, 235) le pattern deja utilise pour la connexion: `match m.lock() { Ok(q) => q, Err(_) => { log::error!("..."); return ... } }`; et faire de l'empoisonnement de la file une sortie loggee de `worker_loop`, pas un retour muet.

### [CR-11] Cache d'empreintes: ecritures avalees sans log et decodage tolerant qui rend une empreinte tronquee au lieu d'une erreur
- Passe : code-review
- Emplacement : `src-tauri/src/dedup.rs:168`
- Preuve : Deux echecs silencieux sur la meme donnee. (1) `persist_fingerprints` fait `let _ = conn.execute("UPDATE tracks SET fingerprint=?2 WHERE id=?1", ...)` (dedup.rs:168-172) — aucune erreur remontee ni logguee; meme motif dans `get_or_compute_fp` (dedup.rs:404-407). (2) `fingerprint::decode` fait `s.split(',').filter_map(|t| t.parse::<u32>().ok()).collect()` (fingerprint.rs:55): tout jeton illisible est jete en silence, la fonction ne peut pas echouer et rend une empreinte plus courte, utilisee telle quelle par `similarity` (fingerprint.rs:61) sans controle de longueur. Contraire au principe projet fail-fast / pas de fallback silencieux (CLAUDE.md, section Methode).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Scenario de defaillance : Une colonne `fingerprint` tronquee (ecriture interrompue, valeur partielle) est relue par `decode`, qui rend une empreinte amputee sans broncher; `similarity` compare alors des longueurs incoherentes et peut passer sous `MATCH_THRESHOLD` -> deux copies reelles du meme morceau ne sont plus detectees comme doublons, sans aucun message. Variante (1): si les UPDATE de `persist_fingerprints` echouent (base occupee), le cache ne se rechauffe jamais et chaque scan de doublons redecode toute la bibliotheque depuis le disque — sans une ligne de log pour l'expliquer.
- Fichiers : `src-tauri/src/dedup.rs`, `src-tauri/src/fingerprint.rs`
- Correctif esquisse : Logguer (log::error!) l'echec d'ecriture dans `persist_fingerprints`/`get_or_compute_fp` au lieu de `let _ =`; faire de `decode` un `Result<Vec<u32>, String>` (ou renvoyer None des qu'un jeton ne parse pas) pour qu'une valeur corrompue soit traitee comme un cache miss explicite.

### [CR-12] `Queue.running` est incremente et decremente mais jamais lu (champ mort)
- Passe : code-review
- Emplacement : `src-tauri/src/worker.rs:224`
- Preuve : Le champ `running: usize` de `struct Queue` (worker.rs:13) n'a que deux usages dans tout le fichier: `q.running += 1;` dans `pop` (worker.rs:224) et `q.running = q.running.saturating_sub(1);` dans `finish` (worker.rs:237). Aucune lecture — verifie par grep sur `.running` dans worker.rs, 2 occurrences, toutes deux des ecritures. Le commentaire de `pop` ("Increments `running` for the popped id") et celui de `finish` documentent donc un etat que personne n'observe.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `src-tauri/src/worker.rs`
- Correctif esquisse : Soit supprimer le champ et les deux ecritures, soit l'exposer (un `pool_busy()` alimentant la zone de progression), mais ne pas laisser un compteur maintenu que personne ne lit.

---

## Passe 6 — simplify

**Portee reellement balayee.**

Lecture reelle: CLAUDE.md, AGENTS.md, .claude/rules/rust.md, docs/INDEX.json, index.html, package.json, vercel.json, tsconfig.json, vite.config.ts, src-tauri/tauri.conf.json, src-tauri/src/lib.rs (integral), frontend/main.ts, frontend/dom.ts, frontend/app.js (~200 lignes lues + cartographie integrale par grep des fonctions/gardes), et extraits cibles de frontend/{filing-toast,library-detail,report-view,sift-live,chrome}.ts, src-tauri/src/{ipc_library,ipc_filing,rekordbox_repairs,rekordbox_masterdb,db,settings,naming}.rs, .claude/scripts/cdp.cjs, TECH_DEBT_AUDIT.md, README.md, docs/ressources-externes.md (sections ciblees), docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md.
Balayages automatises (comptes non nuls): (1) exports TS jamais references hors de leur fichier — 42 fichiers .ts/.js/.html balayes, 13 trouves; (2) exports de shared/contracts.ts croises avec 42 TS + 40 .rs — 0 mort; (3) les 69 commandes de generate_handler! croisees avec tout frontend/ — 0 non referencee; (4) evenements Tauri emit/listen — 5 noms, appariement complet; (5) 436 classes CSS de styles.css croisees avec 42 fichiers de code — 64 candidates, filtrees a la main des faux positifs de classes construites dynamiquement; (6) docs/INDEX.json vs 153 .md sous docs/ — 7 absents, 0 fantome; (7) 10 tables SQL de db.rs grepees repo-wide.
NON couvert, a ne pas lire comme un feu vert: aucune compilation ni execution (pas de cargo, npm, tauri dev, CDP) — tout est statique; correctness du moteur DSP analysis/ et du moteur d'ecriture master.db non auditee; internes de batch-panel.ts, queue-panel.ts, report-view.ts, filing-identify.ts, rekordbox-view.ts non lus integralement (fichiers de 40-64 Ko); styles.css analyse uniquement au niveau des NOMS de classes (pas de regles dupliquees ni de proprietes mortes); src-tauri/tests/ et les mod tests inline non audites; 3 des 18 #[allow(dead_code)] (lignes 358/379/392, sur des types) non verifies; docs/ lu par echantillon cible, pas integralement.

### [SIMP-1] Police d'icones Tabler chargee depuis un CDN, sans repli local — toute l'iconographie disparait hors ligne (deja observee cassee le 2026-07-01)
- Passe : simplify
- Emplacement : `index.html:7`
- Preuve : index.html:7 `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/tabler-icons.min.css">` et frontend/styles.css:1487 `@font-face{font-family:"tabler-icons-filled";...src:url("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/fonts/tabler-icons-filled.woff2")}`. `git grep tabler` sur tout le repo: aucune copie locale, aucun @tabler dans package.json (dependencies + devDependencies lues), aucune entree tabler dans package-lock.json. tauri.conf.json whiteliste explicitement le CDN (`style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net data:`), donc c'est un chemin actif, pas un residu. A comparer a frontend/main.ts:1-5 qui bundle Outfit/JetBrains Mono via @fontsource avec le commentaire « so the desktop app needs no network » — l'invariant est pose puis viole pour les icones. Deja constate EN VRAI: docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md:66-72 « le bouton play de la bande d'audition affiche un glyphe qui ressemble a un caractere de repli », avec le fix propose (« bundler les icones Tabler en local comme les deux polices ») — non applique 27 jours plus tard.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Un DJ lance le Sift package sans reseau (avion, club, DNS coupe, jsdelivr bloque par un pare-feu d'entreprise): le <link> de index.html:7 echoue, aucune famille de police .ti n'est definie. Chaque `<i class="ti ti-*">` de l'app rend un glyphe de repli. Les controles ICONE-SEULE n'ont alors plus aucun label: les boutons de titlebar (.sift-win i, fermer/reduire/agrandir, chrome.ts:153-157), le play/pause du lecteur, et tous les .lk-icon 22x22 (convention CLAUDE.md § Front-CSS) deviennent des carres vides non identifiables. L'app reste fonctionnelle mais illisible. Symptome deja capture en screenshot le 2026-07-01 sur le bouton play.
- Fichiers : `index.html`, `frontend/styles.css`, `package.json`
- Correctif esquisse : Ajouter @tabler/icons-webfont en dependance, importer son CSS depuis main.ts comme les @fontsource, remplacer le src du @font-face styles.css:1487 par l'asset local, puis retirer cdn.jsdelivr.net de style-src et font-src dans tauri.conf.json (le CSP redevient 'self' seul = preuve que plus rien ne sort).

### [SIMP-2] frontend/app.js: 292 des 424 lignes (69 %) sont de la maquette morte sous Tauri, embarquee telle quelle dans le bundle de production
- Passe : simplify
- Emplacement : `frontend/app.js:3-22,73-107,129-146,150-233,234-241,248-251,260-299,303-310,319-353,357-359,367-368,379-408,417-421`
- Preuve : main.ts:6 importe ./app.js sans garde. Sous Tauri, chaque render* de maquette est neutralise par une garde explicite `if(!('__TAURI_INTERNALS__' in window))`: app.js:72 (renderHome), :128 (renderRevue), :247 (renderRkb), :259 (renderBiblio), :318 (renderEcarts), :366 (renderReglages), :416 (keydown). Trois fonctions n'ont PAS de garde mais sont neanmoins inatteignables sous Tauri, verifie: renderMid (app.js:150-233, 84 lignes) n'est appelee que depuis le bloc garde app.js:144 et depuis les branches data-act du handler de clic; renderBatch (app.js:234-241) n'est atteinte que si revMode devient "batch", ce qui passe uniquement par `data-act="revmode"`, masque en dur par chrome.ts:139 (`'[data-act="revmode"],[data-act="togglequeue"]{display:none!important}'`); renderCle (app.js:357-359) est court-circuitee par le handler en phase de CAPTURE de sift-live.ts:191-206, qui intercepte `[data-view="cle"]` et appelle stopPropagation() avant que le listener bubble de app.js:376 ne s'execute. Les 30 branches data-act du handler (app.js:379-408) ne pilotent que des noeuds de maquette, tous absents ou masques sous Tauri. Restent VRAIMENT vivants: le squelette DOM (app.js:122 qui cree #qcol/#ql/#mid/#filfoot/#fldz), le routage `[data-view]` (app.js:377), la bascule .nv (app.js:63), installQueueResize (app.js:44-62) et les 8 hooks window.__siftX. Compte: 292/424 lignes, sur 54 142 octets de source expedies dans dist/.
- Impact : maintenabilite
- Effort : L
- Risque du fix : moyen
- Note : **B**
- Fichiers : `frontend/app.js`, `frontend/main.ts`, `frontend/chrome.ts`, `frontend/sift-live.ts`, `README.md`
- Correctif esquisse : Trancher d'abord avec Antoine si la demo web Vercel est un livrable maintenu (README.md:124-129 dit que le deploiement d'origine « ne fonctionne plus tel quel »). Si non: supprimer les 13 plages listees + le catalogue de fausses pistes, ne garder que squelette DOM + routage + hooks __siftX (~130 lignes), et renommer le fichier pour qu'il cesse de se lire comme une maquette. Si oui: extraire le mock dans un module charge dynamiquement seulement hors Tauri, pour qu'il quitte le bundle desktop.

### [SIMP-3] TECH_DEBT_AUDIT.md a la racine: 18 de ses 20 findings sont resolus, et son resume executif decrit un codebase qui n'existe plus
- Passe : simplify
- Emplacement : `TECH_DEBT_AUDIT.md:1-22`
- Preuve : Date « Generated: 2026-07-15 », en-tete « branch `m6a-discogs` » — branche supprimee le 2026-07-18 (CLAUDE.md:4-5). Verifie un par un sur disque aujourd'hui: F01 (rollback artwork silencieux) resolu, rekordbox_masterdb.rs:1409-1421 distingue desormais les deux cas et logue; F02 (« zero log::* dans le fichier ») faux, `grep -c 'log::' src-tauri/src/rekordbox_masterdb.rs` = 6; F03 (filing.ts 2150 lignes) resolu, filing.ts fait 33,8 Ko/538 lignes; F04/F05 (19 exports inutiles dans rekordbox-view.ts) resolus, rekordbox-view.ts:43 declare `const mdbRepairSel` sans export et mon balayage des 42 fichiers TS ne trouve aucun de ces 19 symboles exporte; F12 (rescanSource sans appelant) resolu, home-sources.ts:8 l'importe et :246 l'appelle; F13 (fmtDur) resolu, `git grep fmtDur -- frontend` = 0 resultat; F14 (.remember/tmp/last-ndc.ts) resolu, le dossier n'existe pas; F15 (design_handoff_sift_refonte/ a la racine) resolu, deplace sous docs/archive/; F16 (~40 sites de conn.lock duplique) resolu, db::lock_conn compte 13+25+3+24 usages dans ipc.rs/ipc_filing.rs/ipc_identify.rs/ipc_library.rs. Seuls F19 et F20 survivent (cf. SIMP-4). Or le resume executif (lignes 6-10) affirme encore au present « filing.ts (2150 lines) is now the largest, least-split frontend file », « zero log::* calls », « ~20 unnecessary export keywords », « 2 confirmed dead exports ». Le fichier est a la RACINE, a cote de CLAUDE.md, qui le cite deux fois comme reference (F03 ligne 189, F15 ligne 258).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Fichiers : `TECH_DEBT_AUDIT.md`, `CLAUDE.md`
- Correctif esquisse : Archiver sous docs/archive/ (politique doc-rot de ~/.claude/rules/workflow.md: un audit apres « done » ne reste pas au niveau du code vivant), ne garder vivants que F19/F20 sous forme de deux lignes, et repointer les deux references de CLAUDE.md vers le chemin d'archive.

### [SIMP-4] cdp.cjs: le selecteur est interpole non echappe dans la chaine « NOT FOUND » — la commande click echoue sur tout selecteur contenant des guillemets, exactement ceux de ce repo
- Passe : simplify
- Emplacement : `.claude/scripts/cdp.cjs:118`
- Preuve : cdp.cjs:116-122, cmdClick construit l'expression evaluee: ligne 117 `document.querySelector(${JSON.stringify(selector)})` (correctement echappe) puis ligne 118 `if (!el) return "NOT FOUND: ${selector}";` (brut). Le repo utilise precisement des selecteurs a guillemets: cdp.cjs:131 lui-meme fait `document.querySelector('[data-view="revue"]')` dans cmdOpenTrack. L'expression generee pour `click '[data-view="revue"]'` est donc `return "NOT FOUND: [data-view="revue"]";` — la chaine se ferme sur le guillemet de data-view. Comme Runtime.evaluate parse l'expression ENTIERE avant de l'executer, l'echec est total et ne depend pas de la presence de l'element. Deja identifie le 2026-07-20 (TECH_DEBT_AUDIT.md F20) et toujours present. F19 aussi vivant: cdp.cjs:36-37 `return new Promise(async (resolve, reject) => { const ws = new WebSocket(await pageWsUrl()); ... })` — un rejet de pageWsUrl() (port CDP injoignable) n'est pas relie au reject externe.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Antoine ou un agent lance `node .claude/scripts/cdp.cjs click '[data-view="revue"]'` pour verifier l'UI reelle par CDP — le moyen de preuve documente en CLAUDE.md § Verification UI. Runtime.evaluate renvoie une SyntaxError au lieu de cliquer; le clic n'a jamais lieu. L'agent lit un echec ambigu et conclut a un port squatte ou a une app absente (piste que CLAUDE.md:394-402 encourage explicitement), et perd la session a diagnostiquer le mauvais probleme.
- Fichiers : `.claude/scripts/cdp.cjs`
- Correctif esquisse : Ligne 118: `return "NOT FOUND: " + ${JSON.stringify(selector)};`. Ligne 36: resoudre pageWsUrl() AVANT `new Promise`, puis .then/.catch dans la mise en place du socket — pas d'executor async.

### [SIMP-5] Bloc CSS mort: 34 classes .jrnl-insp-*/.jrnl-q* (styles.css:1424-1467) d'un ecran Journal 3 colonnes jamais construit
- Passe : simplify
- Emplacement : `frontend/styles.css:1424-1467`
- Preuve : Balayage des 436 classes de styles.css (commentaires strippes) contre 42 fichiers .ts/.js + index.html + .storybook/. Les 34 classes du bloc entete `/* Journal — grammaire 3 colonnes (Sift.dc.html) : liste en col Queue + detail en Inspecteur */` (styles.css:1424, plage .jrnl-queue:1426 -> .jrnl-insp-revert:disabled:1467) ne sont nommees dans AUCUN fichier de code. journal.ts utilise bien 23 classes jrnl-*, mais toutes d'une autre famille (jrnl-row, jrnl-cat, jrnl-hd, jrnl-session-group, jrnl-toast, journal.ts:102-125,185-187,351,391-392) — aucune intersection avec jrnl-insp-* ni jrnl-q*. `git grep -l 'jrnl-insp-card|jrnl-qrow-main'` repo-wide ne remonte que styles.css et 3 fichiers docs (design-system-states.md, un plan archive, la spec HIG) — jamais de code. Meme balayage, autres orphelines confirmees repo-wide a 0 fichier de code: .home-right, .nv-export-dot, .nv-grp, .qdrag, .sift-tags-box, .sift-tags-title, .sift-ui-kicker, et .sift-vchips-row (styles.css:948, residu de la dette .sift-vchips documentee resolue en ressources-externes.md:1294-1310 — les querySelector ont ete repointes vers .sift-fil-verdict, filing.ts:489/512, la regle CSS est restee).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Supprimer styles.css:1424-1467 en bloc plus les 8 regles orphelines isolees. Verification: `npm run lint:tokens` puis une capture par ecran (le Journal est le seul concerne, et n'utilise aucune de ces classes).

### [SIMP-6] library-detail.ts reimplemente toast() a l'identique, et force une machinerie defensive dans le module partage
- Passe : simplify
- Emplacement : `frontend/library-detail.ts:33-51`
- Preuve : library-detail.ts:33-51 definit une fonction privee `toast(message, undo?, onUndo?)` qui cree `#sift-toast`, meme id, meme classe, memes attributs role/aria-live, meme delai de 6000 ms (ligne 50) que la fonction partagee filing-toast.ts:28-106 (delai identique ligne 105), importee par 8 fichiers (chrome.ts:9, filing-actions.ts:17, filing-bins.ts:15, filing-identify.ts:10, filing.ts:35, queue-panel.ts:13, rekordbox-view.ts:36, sift-live.ts:31). Le doublon n'est pas gratuit: filing-toast.ts:29-35 porte un marqueur `dataset.owner === "filing-toast"` et 5 lignes de commentaire dont la seule raison d'etre est ce doublon (« library-detail.ts:33 builds the same #sift-toast with its own 6s timer whose id is never stored, so it cannot be cleared from here »), plus le commentaire de filing-toast.ts:98. Les 6 sites d'appel de library-detail.ts (lignes 309, 317, 321, 350, 353, 357, 381, 384) passent soit aucun undo, soit un onUndo explicite — jamais le cas `undo=true` sans callback, seul comportement ou les deux implementations divergent (le partage retombe sur undoLast LIFO).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/library-detail.ts`, `frontend/filing-toast.ts`
- Correctif esquisse : Supprimer library-detail.ts:33-51, ajouter `import { toast } from "./filing-toast"`. Puis, dans un second temps, retirer le garde dataset.owner de filing-toast.ts:29-35 et ses commentaires devenus faux.

### [SIMP-7] Table SQLite custom_tags creee en v1 et jamais lue ni ecrite
- Passe : simplify
- Emplacement : `src-tauri/src/db.rs:50-54`
- Preuve : db.rs:50-54 cree `CREATE TABLE custom_tags (track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (track_id, tag))` dans la migration v1. `git grep -n custom_tags` sur le repo entier (fichiers suivis) donne exactement 4 resultats: db.rs:50 (la creation), docs/plan-implementation.md:513 et docs/superpowers/plans/2026-06-12-m0-scaffolding.md:503+872 (les documents de specification d'origine). Aucun SELECT, INSERT, DELETE, ni aucune reference frontend. A comparer aux 9 autres tables de db.rs, toutes requetees (track_genres par exemple compte 24 references dont genres.rs:9/18/27/56).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/db.rs`
- Correctif esquisse : Ne PAS toucher a l'entree v1 (db.rs:41 interdit d'editer une migration livree). Ajouter une migration en fin de MIGRATIONS avec `DROP TABLE IF EXISTS custom_tags;`, ou trancher explicitement qu'elle est reservee a une feature future et l'ecrire en commentaire a db.rs:50.

### [SIMP-8] verdictCardHtml() est un no-op conserve exprès dont la vraie semantique (vider le conteneur) est cachee — piege pour le prochain nettoyage
- Passe : simplify
- Emplacement : `frontend/report-view.ts:552-554`
- Preuve : report-view.ts:552-554: `export function verdictCardHtml(_r: AnalysisReport): string { return ""; }`, precede de 10 lignes de commentaire (545-551) qui assument le choix: « kept as a no-op (not deleted outright) so those call sites don't need touching ». 4 sites d'appel ecrivent donc systematiquement la chaine vide: report-view.ts:1106, :1192, :1215, :1261. Le piege est en :1215 — le spinner « Analyse en cours… » est pose en :1205 (`pendingEl.innerHTML = '<i class="ti ti-loader-2 sift-spin"></i>Analyse en cours…'`) et n'est efface QUE par cette affectation de chaine vide. Un futur nettoyage qui supprime « la fonction morte » et ses appels laisse le spinner a l'ecran indefiniment. Le parametre optionnel `verdictContainer` est par ailleurs traine dans deux signatures publiques (renderReportInto report-view.ts:1099-1104, openReportInto :1135-1140) uniquement pour ce role.
- Impact : maintenabilite
- Effort : S
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/report-view.ts`
- Correctif esquisse : Remplacer les 4 appels par `= ""` explicite (report-view.ts:1106/1192/1215, et retirer `+ verdictCardHtml(r)` en :1261), supprimer la fonction et son commentaire, et renommer le parametre en `verdictHostToClear` pour que l'intention « vider » soit lisible au site d'appel.

### [SIMP-9] Un design de migration React+shadcn dort dans docs/superpowers/changes/ alors que CLAUDE.md declare la migration de framework ecartee
- Passe : simplify
- Emplacement : `docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md:1`
- Preuve : Le fichier existe (seul contenu du dossier, 4,9 Ko) et s'ouvre sur `# Migration Sift vers React + shadcn/ui — plan (pas execute)`, avec « shadcn (React+Tailwind) ne peut pas s'y greffer sans reecriture du frontend ». CLAUDE.md:34-36 dit l'inverse au present: « Stack assume : vanilla TS sans framework — les patterns React (hooks/stores/providers) ne s'appliquent pas ici, et une migration de framework est explicitement ecartee (Evaluation 3, ressources-externes) ». Deux sources actives contradictoires. Le document est en outre invisible du catalogue: absent de docs/INDEX.json (verifie par diff programmatique, cf. SIMP-13) et `git grep shadcn-react-migration` ne remonte aucune reference entrante — il n'est atteignable que par un grep de docs/, ce que fait un agent qui cherche « comment est structure le front ».
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md`, `CLAUDE.md`
- Correctif esquisse : Trancher avec Antoine: soit archiver sous docs/archive/ avec un en-tete « ECARTE — voir CLAUDE.md § Vision de travail », soit supprimer. Si au contraire la migration redevient d'actualite, c'est CLAUDE.md:34-36 qu'il faut amender dans le meme geste — jamais laisser les deux.

### [SIMP-10] README.md se contredit sur l'auto-update et pointe un chemin de doc qui n'existe plus
- Passe : simplify
- Emplacement : `README.md:121`
- Preuve : README.md:27-28 affirme « auto-update Tauri OK fait (2026-07-24, gratuit, sans certificat OS — voir docs/superpowers/changes/2026-07-24-auto-update/design.md, verifie en conditions reelles sur v0.0.1/v0.0.2) ». README.md:121, 93 lignes plus bas, dit encore « Le code-signing / notarization + auto-update sont prevus en V1 ». Le lien de la ligne 28 est mort: `ls docs/superpowers/changes/2026-07-24-auto-update/` -> No such file or directory; le dossier reel est docs/superpowers/changes/archive/2026-07-24-auto-update/ (design.md 9,3 Ko + plan.md 25,4 Ko), ce que docs/INDEX.json confirme. La livraison est par ailleurs prouvee sur disque: src-tauri/tauri.release.conf.json existe, frontend/updater.ts existe, .github/workflows/release.yml existe, et lib.rs:170-176 enregistre tauri_plugin_updater.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `README.md`
- Correctif esquisse : README.md:121: retirer « + auto-update » de la phrase des differes. README.md:28: inserer `archive/` dans le chemin.

### [SIMP-11] 14 des 18 #[allow(dead_code)] de rekordbox_masterdb.rs sont perimes (les items sont tous construits/appeles en code de prod)
- Passe : simplify
- Emplacement : `src-tauri/src/rekordbox_masterdb.rs:177`
- Preuve : 18 occurrences de `allow(dead_code)` dans le fichier (lignes 177,182,191,199,207,215,222,226,233,239,358,379,392,409,1083,1261,1310,1480). Le `mod tests` commence a la ligne 1625, donc tout ce qui precede est du code de production. Les 10 variantes d'enum annotees sont TOUTES construites avant 1625: NoDuplicatesToRemove:1090, SongPlaylistEntryNotFound:1106, UnknownFkTable:1217, IdGenerationExhausted:1187, NoArtworkPath:1342, ArtworkVariantMissing:1350, ArtworkWriteVerificationFailedRolledBack:1450, ArtworkWriteVerificationFailedRollbackFailed:1458, ArtworkWriteFailedRollbackFailed:1418, ArtworkPathEscapesRoot:1273 et 1280 — une variante construite n'est jamais dead_code. 4 des fonctions annotees ont un appelant externe en prod (mod tests de rekordbox_repairs.rs commence a 963): detect_playlist_duplicates (:409) appelee en rekordbox_repairs.rs:924, sync_track_artwork (:1310) en rekordbox_repairs.rs:780, sync_track_metadata (:1480) via rekordbox_repairs.rs:507+, dedup_playlist_group (:1083) via ipc_library.rs:578-589. Non verifies: les 3 annotations sur des types, lignes 358/379/392. Le compteur suivi par la doc est lui aussi perime: docs/ressources-externes.md:1227 parle d'un « cluster de 16 `#[allow(dead_code)]` », il y en a 18.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/rekordbox_masterdb.rs`, `docs/ressources-externes.md`
- Correctif esquisse : Retirer les 14 attributs prouves perimes en gardant les doc-comments, puis `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` via scripts/cargo-isolated.sh: ce qui rallume un warning se remet, le reste part. Mettre a jour le compteur de ressources-externes.md:1227 avec sa date de mesure.

### [SIMP-12] Le reglage filename_template n'est expose par aucune UI — le moteur de template ne rendra jamais qu'une valeur
- Passe : simplify
- Emplacement : `src-tauri/src/settings.rs:10`
- Preuve : settings.rs:10 declare `pub const FILENAME_TEMPLATE: &str = "filename_template"`. Hors bench_volume.rs (test-only) et settings.rs lui-meme, la constante n'a qu'un usage: ipc_filing.rs:52-59 `fn template(conn)` qui fait get_or(FILENAME_TEMPLATE, DEFAULT_TEMPLATE). Cote frontend, le balayage de tous les getSetting/setSetting des 42 fichiers TS ne remonte que 3 cles: library_root (5 sites), discogs_token (2), ui_theme (2) — jamais filename_template; `git grep filename_template -- frontend shared` = 0 resultat. La valeur passee a naming::render_filename (naming.rs:223) est donc toujours DEFAULT_TEMPLATE = `{artist} - {title}{version}` (settings.rs:27). La seule mention UI est une ligne figee de la maquette (app.js:367, 'Modele de nommage' dans un tableau statique non cliquable, dans un bloc garde hors Tauri).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/settings.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/naming.rs`
- Correctif esquisse : Question a Antoine avant tout code: le modele de nommage configurable est-il au perimetre V1 ? Si oui c'est une feature a moitie cablee a finir cote Reglages; si non, inliner DEFAULT_TEMPLATE et supprimer la cle de reglage + ipc_filing.rs:52-59.

### [SIMP-13] docs/INDEX.json a decroche de docs/: 7 documents absents du catalogue, dont 2 chantiers non archives
- Passe : simplify
- Emplacement : `docs/INDEX.json:1`
- Preuve : Diff programmatique entre les 146 chemins listes dans INDEX.json et les 153 .md presents sous docs/ (glob recursif): 0 entree fantome, 7 fichiers non catalogues — docs/archive/design_handoff_sift_refonte/DESIGN.md, docs/archive/design_handoff_sift_refonte/README.md, docs/chat-project-instructions.md, docs/superpowers/changes/2026-07-20-shadcn-react-migration/design.md, docs/superpowers/plans/2026-07-09-ux-heuristics-audit-fixes.md, docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md, docs/superpowers/plans/2026-07-14-phase3-measurement.md. CLAUDE.md:113-117 pose pourtant la regle: « a chaque nouveau document cree sous docs/ ... ajouter son entree ici dans le meme geste, pas en rattrapage differe ». Le fichier est @importe par CLAUDE.md:110, donc c'est le catalogue que tout agent consulte en premier pour trouver un doc sans grepper — un doc absent est un doc invisible (cf. SIMP-9).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `docs/INDEX.json`
- Correctif esquisse : Ajouter les 5 entrees legitimes (les 2 sous docs/archive/ peuvent rester hors catalogue si la convention est que l'archive n'est pas indexee — a ecrire noir sur blanc dans CLAUDE.md:113). Un script de verification INDEX.json vs glob docs/**/*.md en pre-commit rendrait la regle mecanique plutot que declarative.

### [SIMP-14] scripts/rekordbox-spike-helper.ps1: 158 lignes touchant le dossier Pioneer reel, referencees nulle part et absentes de l'inventaire CLAUDE.md
- Passe : simplify
- Emplacement : `scripts/rekordbox-spike-helper.ps1:1`
- Preuve : `git grep -n 'spike-helper|rekordbox-spike'` sur tout le repo ne remonte que 5 lignes, toutes DANS le fichier lui-meme (ses propres exemples d'usage, lignes 32-35, et son fichier d'etat ligne 51). Balayage compare des 8 entrees de scripts/: toutes les autres ont au moins une reference entrante (cargo-isolated.sh et lint-tokens.mjs -> CLAUDE.md, fetch-ffmpeg.mjs -> package.json+README, make-fixtures.mjs -> src-tauri/tests/characterization.rs, make-rekordbox-fixture.py -> rekordbox_masterdb.rs + 4 plans, decrypt-masterdb-debug.py -> CLAUDE.md) — celui-ci est le seul a zero. CLAUDE.md:255-261 (« Outils de dev annexes ») ne le liste pas. Son en-tete le rattache aux spikes M8 (« Backup/swap/restore/status helper for M8 Rekordbox master.db spikes », « Consolidates a pattern hand-written for every M8 spike since Evaluation 5 »), or M8 est declare fait (README.md:24).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `scripts/rekordbox-spike-helper.ps1`, `CLAUDE.md`
- Correctif esquisse : Choix binaire a poser a Antoine, pas a trancher seul: soit l'ajouter a CLAUDE.md § Outils de dev annexes (c'est un filet de securite pour tout futur spike master.db, la surface la plus risquee du projet), soit le supprimer. L'etat actuel — outil dangereux, non documente, non reference — est le seul a exclure.

### [SIMP-15] Deux exports superflus: fonctions exportees mais consommees uniquement dans leur propre fichier
- Passe : simplify
- Emplacement : `frontend/home-sources.ts:268`
- Preuve : Balayage des exports de 42 fichiers .ts/.js/.html: 13 exports sans reference externe, dont 6 sont des faux positifs Storybook (Base, AvecLienRevue, Warning, Danger, FormatUSB — format CSF) et 5 des types utilises en position de type interne. Restent 2 vraies fonctions: home-sources.ts:268 `export async function pickAndAddFolder` — unique appelant home-sources.ts:210; report-view.ts:1099 `export function renderReportInto` — unique appelant report-view.ts:1147 (les 2 autres occurrences, report-view.ts:625 et le corps meme, sont un commentaire et la definition). C'est exactement le motif F04-F11 de TECH_DEBT_AUDIT.md, nettoye ailleurs mais reintroduit depuis sur ces deux-la.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `frontend/home-sources.ts`, `frontend/report-view.ts`
- Correctif esquisse : Retirer le mot-cle export sur les deux; `npx tsc --noEmit` suffit a prouver l'absence de consommateur (noUnusedLocals est deja actif dans tsconfig.json, donc une fonction devenue reellement morte apparaitrait immediatement).

---

## steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)

**Portee reellement balayee.**

Ce que j'ai REELLEMENT balaye. Lectures d'abord : CLAUDE.md racine (403 l., integral), AGENTS.md (9 l., pointeur), docs/INDEX.json, .claude/rules/context-packs.md, scripts/lint-tokens.mjs (273 l., integral), scripts/lint-tokens-baseline.json, docs/design-system/content.md (118 l., integral), frontend/empty-state.ts (49 l., integral), frontend/styles.css par blocs (1-200, 670-701, 725-745 + tous les hits de grep cibles), docs/ressources-externes.md 1185-1229 (audit Project Cleaner), docs/design-system-states.md 1324-1390 (Conventions de coherence) + hits de grep, et des extraits precis de report-view.ts (735-760), filing-actions.ts (88-120, 275-325), filing.ts (74-100), queue-panel.ts (625-650), sift-live.ts (108-140), usb-format-modal.ts (160-178), rekordbox-view.ts (712-728), chrome.ts (14-24), bibliotheque-view.ts (l.251-280 via grep). Balayages mecaniques sur les 41 fichiers frontend/*.ts + styles.css (42 fichiers, compte non nul) : (a) diff des 3 blocs de theme — 78 tokens en :root, 39 overrides dans le bloc @media dark ET 39 dans :root[data-theme="dark"], ensembles de cles IDENTIQUES et valeurs IDENTIQUES, ZERO divergence, c'est le point le plus propre du systeme ; (b) tout var(--x) confronte aux declarations — 2 variables non declarees trouvees (SJ-1, SJ-3) ; (c) comptage des litteraux font-size / border-radius / top-left-right-bottom / durees de transition / couleurs nommees / style.zIndex ; (d) execution reelle de `node scripts/lint-tokens.mjs` (sortie complete lue, 122 couleurs / 3 z-index / 69 px-spacing) ; (e) grep vocabulaire Ranger|Jeter|Valider|Sauvegarder sur tout frontend/*.ts — aucune fuite dans une chaine AFFICHEE, uniquement des commentaires et des identifiants : le vocabulaire content.md est respecte, je ne rapporte donc rien sur cet axe.
CE QUE JE N'AI PAS COUVERT, explicitement. Je n'ai PAS pu lancer l'app (aucun tauri dev, aucun screenshot, aucun CDP) : tout jugement de rendu ci-dessous est deduit du CSS/TS, jamais observe — en particulier je n'ai mesure AUCUN contraste sur pixels rendus et je n'ai observe aucune animation, latence ni interaction reelle. Je n'ai pas ouvert : src-tauri/**/*.rs (aucun), app.js (maquette figee), .storybook/ et les 4 *.stories.ts, docs/design-system/{foundations,tokens,components,patterns,governance}.md, ni le corps de docs/design-system-states.md hors la section 1324-1390 et les lignes atteintes par grep (soit ~1300 lignes non lues) — un ecart doc/CSS peut donc m'avoir echappe ailleurs dans ce catalogue. Je n'ai pas audite l'accessibilite au-dela du focus clavier et des aria-label croises en passant. Aucun fichier modifie, aucun cargo/npm ecrivant dans target/ lance.

### [SJ-1] Le token --overlay-bar lu par la waveform n'existe plus : repli code en dur rgba(255,255,255,.35) sur le theme CLAIR, qui est le theme par defaut
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/report-view.ts:748`
- Preuve : report-view.ts:748 : `const waveColor = cs.getPropertyValue("--overlay-bar").trim() || "rgba(255,255,255,.35)";`. Or `--overlay-bar` n'est declare NULLE PART : grep `overlay-bar` sur frontend/, index.html et .storybook/ ne rend que ces deux lignes (748 + le commentaire 742), aucune declaration. La cause est datee et assumee ailleurs : docs/ressources-externes.md:1196 « 10 tokens CSS orphelins (--h-36, --overlay-bar, --color-cta-text, 6 variantes --color-hue-*) retires de styles.css (3 blocs) » le 2026-07-09 — le token a ete supprime comme orphelin alors qu'il avait ce lecteur JS, invisible a un grep `var(--overlay-bar)` puisqu'il est lu par getPropertyValue. Le commentaire juste au-dessus (report-view.ts:742-745) decrit exactement le bug reintroduit : « theme-aware unlike the old hardcoded rgba(255,255,255,.35) — that literal only worked by accident in dark mode, invisible in light ». Le theme par defaut est clair : styles.css:11-12 `:root{color-scheme:light}`, le sombre n'arrive que par @media ou [data-theme="dark"].
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : App en theme clair (defaut), ecran Revue, ouvrir n'importe quelle piste : getPropertyValue("--overlay-bar") rend "", waveColor tombe sur rgba(255,255,255,.35) et WaveSurfer dessine les barres NON LUES en blanc a 35% par-dessus le fond gris chaud clair (--color-background-* autour de 91-94% de clarte). La partie non encore lue de la forme d'onde — l'element hero de l'ecran de decision du produit — devient quasi illisible, alors que la partie lue (progressColor, --color-waveform-elapsed, bien declare) reste nette. Symptome trompeur : le lecteur a l'air de n'afficher que la portion deja jouee.
- Fichiers : `frontend/report-view.ts`, `frontend/styles.css`
- Correctif esquisse : Redeclarer --overlay-bar dans les 3 blocs de theme de styles.css (teinte translucide, sombre en clair / claire en sombre, meme convention que --overlay-hover), ou pointer waveColor sur un token existant equivalent (--overlay-selected / --color-border-secondary). Retirer le repli litteral au profit d'un echec bruyant, ou au minimum d'un repli theme-aware.

### [SJ-2] lint-tokens.mjs ne neutralise pas les blocs de tokens : 89 des 122 findings couleur SONT les declarations de tokens elles-memes, et le ratchet CI accorde du mou a la vraie derive
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `scripts/lint-tokens.mjs:99`
- Preuve : TOKEN_BLOCK_RE (lint-tokens.mjs:99) borne le contenu d'un bloc par `[^{}]*`. Or styles.css:18 contient, DANS le bloc :root, le commentaire `/* bg-{info,danger,success,warning} + hue-*-bg: ... */` — des accolades litterales. J'ai instrumente la regex sur le fichier reel : elle ne trouve QU'UN SEUL match, qui commence ligne 153 (le bloc :root[data-theme="dark"]). Le bloc :root clair (11-114) n'est jamais neutralise a cause de cette accolade ; le bloc @media sombre (120-152) ne l'est pas non plus, pour DEUX raisons cumulees (meme commentaire a accolades l.135-136, et selecteur `:root:not([data-theme="light"])` que l'alternative `:root(\[[^\]]*\])?` ne couvre pas). Consequence mesuree en repartissant la sortie reelle de `node scripts/lint-tokens.mjs` par numero de ligne : sur les 91 findings couleur imputes a frontend/styles.css, 51 tombent dans :root (11-114), 38 dans le bloc @media sombre (115-152) et 2 SEULEMENT dans de vraies regles de composant (l.867 rgba(255,255,255,.7), l.1072 #000). Cela contredit frontalement le commentaire de justification lint-tokens.mjs:92-98, qui affirme scanner styles.css « pour attraper la derive qui vit LA, dans les regles de composant sous les declarations de tokens ».
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **A**
- Scenario de defaillance : Un changement ajoute `color:#ff0000` dans une regle de composant de styles.css ET supprime une declaration de token devenue inutilisee (geste courant ici — c'est exactement ce qui a ete fait le 2026-07-09, cf. SJ-1). Le compte couleur reste a 122, `node scripts/lint-tokens.mjs` affiche « within baseline — pass » et sort 0 : la couleur en dur passe le gate. Verifiable aujourd'hui sans rien modifier : la sortie actuelle designe styles.css:13 `oklch(91.48% 0.0109 76.59)` comme « hardcoded value bypassing tokens » alors que c'est la declaration de --color-background-primary. Effet collateral immediat : le rapport destine a un humain est a ~73% de bruit sur la categorie couleur, donc illisible.
- Fichiers : `scripts/lint-tokens.mjs`, `scripts/lint-tokens-baseline.json`
- Correctif esquisse : Retirer les commentaires CSS AVANT d'appliquer TOKEN_BLOCK_RE (ou compter les accolades au lieu de `[^{}]*`), et elargir le selecteur pour couvrir `:root:not([...])`. Verifier apres coup que le match compte 3 blocs et non 1, puis regenerer la baseline depuis un arbre propre (procedure deja ecrite dans design-system-states.md:1386).

### [SJ-3] --space-6 n'existe pas : le padding du toast et de la banniere du Journal est purement et simplement supprime
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/styles.css:733`
- Preuve : styles.css:733 `.jrnl-toast{...padding:var(--space-6) var(--space-12);...}` et styles.css:735 `.jrnl-banner{...padding:var(--space-6) var(--space-12);...}`. L'echelle declaree styles.css:80-81 est `--space-4:4px;--space-8:8px;--space-12:12px;--space-16:16px;--space-24:24px;--space-32:32px` — commentee « the ONLY allowed values ». Aucun --space-6 nulle part : grep `space-6` sur frontend/, index.html et .storybook/ ne rend que ces deux lignes d'usage, zero declaration. Par la specification CSS, une declaration contenant un var() vers une propriete personnalisee non definie et sans repli est invalide at computed-value time ; `padding` n'etant pas heritee, elle retombe sur sa valeur initiale, 0 — le raccourci ENTIER tombe, y compris la composante horizontale --space-12 qui, elle, est valide. Ni tsc ni lint-tokens.mjs ne peuvent l'attraper : le premier ne lit pas le CSS, le second ne verifie que les litteraux, jamais qu'un var() se resout.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Ecran Journal, annuler une action rangee : le toast de confirmation `.jrnl-toast` (fond vert teinte + bordure) s'affiche avec padding 0 sur les quatre cotes — le texte colle la bordure teintee, en haut, en bas ET sur les cotes. Idem pour `.jrnl-banner` (ok et warn) apres un lot. Le decalage visuel est permanent, pas transitoire.
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Remplacer var(--space-6) par var(--space-4) ou var(--space-8) selon le rendu voulu ; si un palier de 6px est reellement necessaire, le declarer dans les blocs de tokens et le documenter comme micro-tier (chantier deja cadre dans docs/superpowers/changes/2026-07-19-spacing-scale-sweep/design.md). Ajouter au lint une verification que tout var(--x) lu a une declaration — c'est ce qui a trouve ce bug.

### [SJ-4] Deux champs de recherche annulent le focus clavier sans rien remettre a la place, dans une app qui se declare keyboard-first
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/queue-panel.ts:637`
- Preuve : queue-panel.ts:637 injecte l'input de filtre de la File avec `style="width:100%;border:none;background:transparent;font:inherit;color:var(--color-text-primary);outline:none;padding:6px 30px 6px 9px"` — `outline:none` inline, inconditionnel, et `border:none`. bibliotheque-view.ts:262 fait exactement pareil pour #bibq : `style="flex:1;border:0;background:transparent;color:inherit;font-size:var(--text-md);outline:none"`, la bordure visible etant portee par le div parent, qui ne reagit jamais au focus. La regle globale censee compenser, styles.css:504, est `input:not([type="checkbox"]):focus-visible{outline:none;border-color:var(--color-text-info)}` : elle ECHANGE l'outline contre une coloration de bordure — mecanisme inoperant sur un input a `border:none/0`. Le principe contredit est ecrit dans le fichier lui-meme, styles.css:488 : « Keyboard-first: a visible focus ring on interactive elements, accent-coloured ». Le module d'audit UI generique (~/.claude/rules/audit/ui.md, section HAUTE Accessibilite) classe « outline:none sans remplacement visible » comme bloquant.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Ecran Revue au clavier : Tab jusqu'au champ de filtre de la File (#sift-qsearch-input). Aucun changement visuel — ni anneau, ni bordure, ni fond : l'utilisateur tape sans savoir ou va la frappe, alors que la File a par ailleurs une navigation clavier complete. Identique sur Bibliotheque avec #bibq.
- Fichiers : `frontend/queue-panel.ts`, `frontend/bibliotheque-view.ts`, `frontend/styles.css`
- Correctif esquisse : Retirer `outline:none` des deux styles inline et laisser jouer la regle generique styles.css:497 ; ou, si le ring doit rester hors du champ, poser le focus sur le conteneur via `:focus-within` (bordure --color-text-info sur #sift-qsearch et sur le wrapper de #bibq).

### [SJ-5] L'echec d'export Rekordbox renvoie l'utilisateur vers un ecran ou la commande n'existe plus
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/sift-live.ts:125`
- Preuve : sift-live.ts:125, dans le catch de runNavExport : `"Aucun XML Rekordbox lie — relie un fichier depuis la Bibliotheque"`. Or le bouton qui fait ce lien vit sur l'ecran Rekordbox : rekordbox-view.ts:576 `actionHtml: '<button data-bib="rkblink">Lier un fichier XML Rekordbox</button>'`. Sur l'ecran Bibliotheque il n'y a plus rien : grep `rkblink|Rekordbox` sur bibliotheque-view.ts + library-detail.ts ne rend que deux mentions en prose, dont le commentaire bibliotheque-view.ts:254 « Export (Rekordbox/Cle USB) lives in the nav rail now, not here ». Le deplacement est trace : docs/INDEX.json, spec 2026-07-05-rekordbox-integration-page-design — « carte de statut deplacee depuis Bibliotheque ». Le message n'a pas suivi. Le toast n'offre par ailleurs aucune action de rattrapage.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Bibliotheque non liee a un XML. L'utilisateur clique Exporter dans le rail de nav : toast « relie un fichier depuis la Bibliotheque ». Il ouvre Bibliotheque, cherche, ne trouve aucun controle de liaison — impasse. Le bon chemin (Integrations > Rekordbox > « Lier un fichier XML Rekordbox ») n'est nomme nulle part dans le message.
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : Reformuler vers l'ecran reel (« Aucun XML Rekordbox lie — a relier depuis Integrations > Rekordbox ») et, mieux, passer une action au toast qui navigue vers cet ecran, comme le fait deja empty-state.ts avec son lien « Ouvrir Revue ».

### [SJ-6] L'echelle typographique est declaree « the allowed font sizes » mais n'est appliquee nulle part par outil : 39 litteraux, dont 10 hors echelle
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/styles.css:77`
- Preuve : styles.css:77 declare l'intention sans ambiguite : « Type scale (audit P-1): the allowed font sizes. ... Use these, not literals. » suivi de --text-3xs:8px --text-2xs:9px --text-xs:10px --text-sm:11px --text-md:12px --text-base:13px --text-lg:14px --text-xl:16px --text-2xl:26px. Comptage sur les 42 fichiers frontend (*.ts + styles.css) : 39 occurrences de `font-size:<N>px` litteral, reparties en 8(1) 9(1) 10(6) 11(6) 12(11) 12.5(1) 13(2) 15(1) 16(2) 17(1) 18(2) 20(3) 22(1) 28(1). Soit 29 sites qui recopient la valeur exacte d'un token existant (derive de discipline) et 10 qui inventent une taille absente de l'echelle : 12.5px, 15px, 17px, 18px x2, 20px x3, 22px, 28px. Exemples ouverts : styles.css:305 `.qi{...font-size:12px}` (=--text-md), styles.css:676 `.sift-genre-chip{font-size:11px}` (=--text-sm), chrome.ts:157 `font-size:15px` (hors echelle). Rien ne l'attrape : SPACING_PROP_RE (lint-tokens.mjs:108) ne couvre que `padding|margin|width|height|gap` — `font-size` n'y est pas, ni `border-radius`, ni `top/left/right/bottom/inset` (132 litteraux px comptes sur ces derniers). L'echelle n'est donc tenue que par la vigilance humaine, alors que le projet croit avoir un filet (design-system-states.md:1374 « Prevention mecanique disponible »).
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **B**
- Fichiers : `scripts/lint-tokens.mjs`, `frontend/styles.css`
- Correctif esquisse : Ajouter une categorie `font-size` au linter (memes tokens --text-*, meme mode ratchet) et enregistrer la baseline ; traiter d'abord les 10 valeurs hors echelle, qui sont une decision de design non tranchee, avant les 29 recopies mecaniques.

### [SJ-7] Les tokens de motion ajoutes le 2026-07-27 n'ont que 2 consommateurs sur 39 transitions, et 9 durees differentes coexistent
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/styles.css:113`
- Preuve : styles.css:113 declare `--duration-fast:100ms;--duration-base:150ms;--ease-out:...`, justifie par le commentaire 104-113 : « Only the two durations that actually have a consumer are declared ... They match values already recurring in the transitions further down (.1s / .15s), so this is token wiring, not a new scale. » Or grep `var(--duration` sur frontend/ ne rend que 2 lignes, styles.css:1239 et 1241, toutes deux dans le bloc @media (prefers-reduced-motion). Comptage des durees litterales des declarations `transition:` de styles.css : .16s x10, .15s x10, .12s x9, .3s x3, .18s x2, .08s x2, .2s x1, .25s x1, .1s x1 — 9 valeurs distinctes sur 39 sites. Les 10 occurrences de .15s sont l'egal exact de --duration-base et ne sont pas cablees ; .16s, plus frequent encore, n'est meme pas dans l'echelle.
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Trancher l'echelle reelle (probablement 3 paliers : ~.1s micro-feedback, ~.15s transition, ~.3s overlay), replier .12s/.16s/.18s dessus, cabler les 39 sites sur var(--duration-*), et etendre le linter aux durees comme pour font-size (SJ-6).

### [SJ-8] design-system-states.md, declare source de verite des etats, documente pour .qi.cur un liseré qui n'existe plus dans le CSS
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `docs/design-system-states.md:106`
- Preuve : design-system-states.md:106 decrit l'etat selectionne de la file : « `.qi.cur` | background: var(--color-row-active) + color: var(--color-text-primary) + font-weight:500 + lisere gauche box-shadow:inset 2px 0 0 var(--overlay-bar) | idem, overlay-bar sombre ». Le CSS reel, styles.css:313, est `.qi.cur{background:var(--color-row-active);color:var(--color-text-primary);font-weight:500}` — pas de box-shadow, et --overlay-bar n'existe plus (cf. SJ-1). CLAUDE.md:31-32 designe pourtant ce fichier avec styles.css comme les deux « sources de verite design », et ressources-externes.md:1198-1201 note que le meme piege s'etait deja produit avec --h-36 (« documente comme cable mais avait perdu son consommateur ... sans que la doc soit mise a jour »). Le geste correctif du 2026-07-09 a corrige --h-36 dans la doc mais pas --overlay-bar, alors qu'il supprimait les deux.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `docs/design-system-states.md`, `frontend/styles.css`
- Correctif esquisse : Trancher d'abord SJ-1 (le lisere revient-il, ou disparait-il ?), puis aligner la ligne 106 sur la decision. Si --overlay-bar est reintroduit pour la waveform, remettre aussi le box-shadow de .qi.cur, sa raison d'etre d'origine.

### [SJ-9] L'erreur brute du backend est deversee telle quelle dans des toasts, alors que deux modules montrent la bonne pratique
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/filing-actions.ts:320`
- Preuve : Sites qui affichent l'erreur brute a l'utilisateur, ouverts et verifies : filing-actions.ts:320 `toast(\`Echec : ${String(e)}\`, false)` et :315 (echec d'annulation), :292 (branche else de doRevert), library-detail.ts:357 et :384, sift-live.ts:220 `toast(\`Echec de la reanalyse : ${String(e)}\`)` et :126 `Export Rekordbox echoue : ${msg}`, updater.ts:45, plus filing-identify.ts:350 et library-detail.ts:276 qui injectent `esc(String(e))` directement dans la carte de candidats. En face, la discipline attendue existe deja : usb-format-modal.ts:169-178 mappe l'erreur brute sur trois messages humains actionnables (« Acces refuse — ferme tout programme utilisant ce disque et reessaie. »), et rekordbox-view.ts:719-725 ne laisse passer le texte backend que lorsqu'il est deja humain, avec repli « Choix impossible — reessaie ». C'est exactement le finding F2 de docs/superpowers/changes/2026-07-18-ux-user-flow/audit-heuristique-visuel.md (« jargon 'os error 2' non humanise », MAJEUR), corrige a la source pour le seul chemin decode.rs — les autres chemins sont restes tels quels. content.md:5-14 pose la regle : « sobre, precis, utile ... jamais cryptique ».
- Impact : UX
- Effort : M
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/filing-actions.ts`, `frontend/library-detail.ts`, `frontend/sift-live.ts`, `frontend/updater.ts`, `frontend/filing-identify.ts`
- Correctif esquisse : Extraire un `humanizeError(raw): string` partage (dom.ts ou un module dedie) sur le modele usb-format-modal.ts:169-178, avec une table motif -> message actionnable et un repli generique nomme ; router les 9 sites dessus, et garder String(e) en console.error uniquement.

### [SJ-10] Aucun token de largeur de bordure : 4 epaisseurs decidees site par site, dont 62 hairlines a 0.5px
- Passe : steve-jobs-design-review — UX & fidelite aux tokens (lecture seule, branche perf-mi-fixes)
- Emplacement : `frontend/styles.css:201`
- Preuve : Le bloc de tokens declare des rayons (--border-radius-*) et des couleurs de bordure (--color-border-tertiary/secondary/info/danger) mais AUCUNE largeur : la liste complete des 78 tokens de :root, extraite mecaniquement, ne contient aucun --border-width-*. Comptage des declarations `border[-cote]:<N>px` : dans styles.css, 0.5px x54, 1px x10, 1.5px x2, 2px x3 ; dans frontend/*.ts, 0.5px x8, 1px x1, 1.5px x1, 2px x1. Sites ouverts illustrant le melange sur des roles voisins : styles.css:201 `.sb{...border-right:0.5px solid var(--color-border-tertiary)}`, styles.css:698 `.sift-tag-warn{...border:1px solid var(--color-text-warning)}`, chrome.ts:19 `.sift-dz-on{outline:1.5px dashed ...}`. La convention design-system-states.md:1363 (« avant de dupliquer un style inline repete >=3 fois, chercher une classe existante ») vise le meme probleme sans le couvrir : ici c'est une valeur transverse, pas une classe. Le linter ne regarde pas non plus les largeurs de bordure (SPACING_PROP_RE, lint-tokens.mjs:108).
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Declarer deux ou trois largeurs nommees (--border-hairline:0.5px, --border-base:1px, eventuellement --border-strong:1.5px) dans :root, cabler les 62 sites hairline dessus, et documenter dans quel role chacune s'emploie — sinon le prochain composant redecidera au juge, comme les 4 valeurs actuelles.

---

## Passe 8 — Ralph (deduplication, arbitrage, systemique)

DEDUP: 93 findings bruts (CA=12, SDP=12, PP=17, CC=15, CR=12, SIMP=15, SJ=10) -> 44 entrees, dont 6 SYS- (causes racines) et 3 REJETE. A RETROGRADES: 3 sur 13 (CA-1, CC-3, SJ-2 — motif dans chaque entree; les 10 autres A survivent, dont 5 fusionnes en SYS-1). VERIFICATION REELLE: j ai rouvert le code de TOUS les A, pas relaye. Confirmes sur disque ce tour: actions.rs:869-905 + ecartes.rs:136-215 + lib.rs:109-129 (CR-1), filing.rs:521-560 (CR-3), ipc_library.rs:189 + library.rs:126-168 + dedup.rs:145-268 (SYS-1), batch-panel.ts:80-84/219-229/596/705-716 + encode.rs:64-77 + filing.rs:452-455 (PP-1), filing.ts:463-467 + tags.rs:24-30 + scanner.rs:7-16 + filing.ts:153-159 + verdict.rs:74-78 (SDP-1), ipc_filing.rs:763-788 vs 437-448 (CC-2), sift-live.ts:317-328/419-430 + bibliotheque-view.ts:243-251 (CC-1), index.html:7 + styles.css:1487 + absence de @tabler dans package.json (SIMP-1), report-view.ts:742-748 + zero declaration de --overlay-bar (SJ-1), watcher.rs:33/119 (CC-3), .claude/rules/rust.md:73-92 (regle projet violee par CC-2 et SYS-7). J ai INSTRUMENTE TOKEN_BLOCK_RE de scripts/lint-tokens.mjs sur styles.css reel: 1 seul match, lignes 153->167 (au lieu de 3 blocs complets), et j ai reparti la sortie reelle du linter par ligne: 101 des 122 findings couleur tombent DANS des blocs de tokens (59 en :root clair, 42 dans @media dark). CORRECTION FACTUELLE: PP-9 est faux — styles.css:81 declare bien --space-24 et --space-32; c est la retractation de .interface-design/system.md:99-104 qui ment (voir REJETE PP-9). CE QUE JE N AI PAS FAIT: aucune compilation, aucun cargo test, aucun tauri dev, aucune verification visuelle — tous les jugements de rendu (SJ-*) restent deduits du CSS/TS. Je n ai pas rouvert les preuves des findings B/C/D: elles sont relayees telles que fournies par les passes, avec leur ID d origine. 3 PROBLEMES SYSTEMIQUES, PAR GRAVITE: (1) SYS-1 — un Mutex<Connection> unique tenu pendant toutes les E/S lourdes: 6 commandes, dont une capable de geler l app des heures, alors que le decoupage correct est demontre 25 lignes plus haut dans le meme fichier; c est la contrainte d archi qui coute le plus cher a chaque nouvelle commande. (2) SYS-4 — la definition de fini est ecrite 3 fois et appliquee par personne: CI sans cargo test/clippy/tsc, seul executeur = un hook git non versionne, lint-tokens a 83% de bruit, zero test sur 11 485 lignes de TS; c est ce qui laisse passer TOUS les autres findings. (3) SYS-2 — aucune sentinelle stable ne traverse l IPC: 20+ decisions de controle prises par sous-chaine de prose francaise, dont une qui declenche un DELETE de ligne DB et une qui desactive un garde de formatage USB.

Findings consolides : **48** (bruts : 93). Repartition : A = 9 · B = 16 · C = 17 · D = 6

### [SYS-1] Le Mutex<Connection> global est tenu pendant du travail lourd sur 6 commandes — dont une qui peut decoder toute la bibliotheque depuis le disque
- Passe : ralph
- Emplacement : `src-tauri/src/ipc_library.rs:189`
- Preuve : Cause racine unique: une seule connexion SQLite derriere un Mutex en Tauri State, et aucune convention appliquee sur la portee du verrou. Le decoupage correct EXISTE et est demontre a 25 lignes du pire site: ipc_library.rs:163-181 (scan_library_duplicates) fait read-sous-verrou / drop / compute-hors-verrou / write-sous-verrou, avec le commentaire `guard dropped here — lock released before the heavy compute below`. Six commandes ne le font pas. VERIFIE CE TOUR, le pire: ipc_library.rs:189 `let conn = db::lock_conn(&conn)?;` puis library::library_stats -> library.rs:126 duplicate_count_cached -> dedup.rs:261-268 scan_library_duplicates(conn) -> dedup.rs:150-158 build_fingerprints qui appelle fingerprint::compute_for_path (decodage audio complet) pour CHAQUE ligne sans empreinte en cache. Le doc-comment de dedup.rs:255-259 assume ce wrapper `pour les appelants qui tiennent deja le verrou` — la forme est documentee, jamais son cout. Les 5 autres sites: export_rekordbox_xml (ipc_library.rs:366-367, verrou tenu pendant fs::read + parse + merge + fs::write du XML), les 5 commandes master.db (ipc_library.rs:427-428 -> rekordbox_repairs.rs:320 -> with_masterdb_write: backup + fs::read integral + decrypt + mutation + encrypt + fs::write + relecture de verification), commit_file qui dechiffre master.db une fois PAR PISTE du lot (filing.rs:701 sous verrou depuis ipc_filing.rs:833-850), revert_batch/undo_last qui recopient des fichiers entiers sous verrou (ipc_filing.rs:1002-1018 -> actions.rs:665-684 fs::copy), et list_queue qui recalcule les cles de nom de TOUTE la bibliotheque sous verrou a chaque rafraichissement (ipc.rs:114-120 -> dedup.rs:287). Vu par CA-2 (A), CR-2 (A), CR-5 (B), CR-6 (B), CR-7 (B): cinq passes independantes ont trouve cinq sites du meme defaut — je monte l ensemble en A sur cette convergence.
- Impact : perf
- Effort : L
- Risque du fix : moyen
- Note : **A**
- Scenario de defaillance : Bibliotheque de plusieurs milliers de pistes rangees, colonne tracks.fingerprint encore vide (cas nominal: le rangement n en calcule aucune, seul find_duplicate en produit pour la paire comparee, dedup.rs:388-412). L utilisateur ouvre l onglet Bibliotheque: library_stats prend le verrou global et lance un decodage audio complet par piste sans empreinte, verrou tenu du premier au dernier. Pendant toute la duree: pool d analyse bloque (worker.rs persist_result/refill), list_queue bloque (chemin critique de l ouverture de Revue), analyze_path bloque. L app parait morte, sans progression ni annulation. Meme mecanique, declencheurs plus courants: `Reexporter maintenant` sur un gros XML, ou 3 reparations Tier 1 (chaque with_masterdb_write relit et rechiffre un master.db de plusieurs Mo, verrou tenu), ou l annulation d un lot de 50 rangements lossless (2 Go recopies depuis la corbeille sous verrou). Le PRD du 2026-07-27 pose un budget de 50 ms sur la boucle de rangement et declare le decoupage de ce verrou BLOQUANT.
- Fichiers : `src-tauri/src/ipc_library.rs`, `src-tauri/src/library.rs`, `src-tauri/src/dedup.rs`, `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/ipc.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Appliquer aux 6 sites le patron deja demontre en ipc_library.rs:163-181 (lire sous verrou / relacher / travailler / relocker bref pour ecrire). Priorite: library_stats (sortir duplicate_count_cached du verrou, ou le rendre non bloquant), puis resoudre l index master.db UNE fois par lot hors verrou et l injecter dans commit_file comme le fait deja xml_repair_sink (filing.rs:637-643). Ecrire la convention noir sur blanc dans .claude/rules/rust.md pour que la 7e commande ne la redecouvre pas.

### [CR-1] La retention 30 jours du journal supprime les lignes `trash` VIVANTES: restauration definitivement cassee et fichiers orphelins sur disque
- Passe : ralph
- Emplacement : `src-tauri/src/actions.rs:869`
- Preuve : VERIFIE CE TOUR, ligne a ligne. actions.rs:869-872 PINNED_ACTION_IDS n epingle QUE les trois tables rekordbox_masterdb_* (`WHERE status IN ('pending','ambiguous')`), et son doc-comment (actions.rs:855-868) ne raisonne que sur elles. actions.rs:877-889 expired_batches ne retient qu un batch avec `MAX(ts) < datetime('now', ?1) AND MIN(undone) = MAX(undone)`: une ligne trash vivante a undone=0, seule dans son batch, donc MIN=MAX -> eligible. actions.rs:853 JOURNAL_RETENTION_DAYS = 30, et lib.rs:109-129 spawn_journal_purge tourne a chaque lancement apres un court delai. Or le chemin du fichier en corbeille n existe QUE dans cette ligne: ecartes.rs:136-147 restore_track fait `SELECT id, from_path, to_path FROM actions WHERE track_id=?1 AND type='trash' AND undone=0` et renvoie `no trashed file to restore` si elle manque; ecartes.rs:172-178 purge_trash la JOIN pour connaitre to_path. La piste reste pourtant listee dans Ecartes (statut lu sur tracks, pas sur actions) et le sweep ecartes.rs:207 `UPDATE tracks SET status='purged' WHERE status='trash'` la fait disparaitre de l ecran SANS toucher au fichier. Aucun test ne couvre ce cas: les 6 tests de purge (actions.rs:2954-3204) couvrent straddle, half-reverted et le pin masterdb — jamais une ligne trash vivante. Code NEUF de la branche courante (PRD D4, 2026-07-27).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : L utilisateur jette 200 pistes le 1er du mois et ne vide pas la corbeille. Au lancement suivant apres J+30, le purge efface les 200 lignes trash. (1) Clic Restaurer dans Ecartes -> `no trashed file to restore`, definitif, alors que les fichiers sont intacts dans Documents/Sift/Trash. (2) Clic Vider la corbeille -> les 200 pistes passent a 'purged' par le sweep ecartes.rs:207, disparaissent de l ecran, et les fichiers restent sur le disque sans plus aucun chemin depuis l app. Perte de la seule voie de recuperation + fuite d espace disque invisible.
- Fichiers : `src-tauri/src/actions.rs`, `src-tauri/src/ecartes.rs`, `src-tauri/src/lib.rs`
- Correctif esquisse : Etendre PINNED_ACTION_IDS avec `SELECT a.id FROM actions a JOIN tracks t ON t.id=a.track_id WHERE a.type='trash' AND a.undone=0 AND t.status='trash'` — meme raisonnement que pour les operations master.db vivantes. Ajouter le test manquant (`purge_spares_a_live_trash_row`) sur le modele de purge_spares_an_action_pinned_by_a_pending_masterdb_repair.

### [CR-3] Rangement conformant: l ecriture de tags en place n est ni annulee ni journalisee si le deplacement echoue ensuite
- Passe : ralph
- Emplacement : `src-tauri/src/filing.rs:538`
- Preuve : VERIFIE CE TOUR. filing.rs:521-553, branche conformante d execute_file: snapshot des anciens tags (530), `log.push(FsLog{kind:"tag_edit", ...})` (532-537), `tagging::write_tags_full(&plan.source, ...)` qui ecrase les tags DANS le fichier source (539-547), puis `move_cross_disk_safe(&plan.source, Path::new(&plan.dest))?` (548). Si ce `?` sort, le Vec<FsLog> — qui contient deja la ligne tag_edit avec le snapshot — est simplement droppe. rollback_fs (filing.rs:595-620) n est appele que depuis commit_file, jamais sur un echec d execute_file. Les deux appelants croient l inverse: ipc_filing.rs:632 et :855 portent le commentaire `the FS is left clean by execute_file itself`, et le doc-comment d execute_file lui-meme (filing.rs:519-520) revendique `filesystem clean on its own failure (no orphan transcode)` — vrai pour la branche transcode, faux pour la branche conformante ou les tags sont deja ecrasés en place. Le declencheur n est pas theorique: filing.rs:459 documente `a blocked revert (external lock, os error 32 — proved in the revert-duplicate releve)`.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Fichier .aiff deja conformant, range vers un bac dont le volume est plein ou dont la destination est tenue par l antivirus/l explorateur. write_tags_full reussit (artiste, titre, label, annee, genres, pochette ecrases dans le fichier source), std::fs::rename echoue en os error 32 ou 112 (ni 17 ni 18, donc pas de repli copy_verify_delete). Le rangement est annonce en echec, la piste reste pending — et les tags d origine sont perdus SANS aucune ligne dans le Journal: le bouton Annuler ne propose rien, puisque commit_file n a jamais tourne. L utilisateur n a aucun moyen de savoir que son fichier a ete modifie.
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Dans execute_file, remplacer les `?` post-ecriture par une capture qui appelle rollback_fs(&log) avant de retourner l erreur (le log porte deja le snapshot tag_edit), ou deplacer l ecriture de tags APRES le move reussi (tagger a plan.dest). Corriger dans le meme geste les deux commentaires ipc_filing.rs:632/855 qui affirment un invariant faux.

### [PP-1] Le mode Lot ignore la regle no-upscale que le backend applique: un lot de MP3 honnetes rebondit a 100% et l ecran l annonce comme un succes
- Passe : ralph
- Emplacement : `frontend/batch-panel.ts:84`
- Preuve : VERIFIE CE TOUR, chaine complete. batch-panel.ts:84 `let batchFormat: Target = "aiff_16_44";` (defaut du module, precede du commentaire 80-83 qui assume l abandon du garde). batch-panel.ts:219 `const ready = currentItems.filter((it) => it.verdict === "ok");` — aucun filtre de rail — puis 226-229 coche TOUT ready par defaut au premier rendu. batch-panel.ts:596 `for (const id of ids) targets[id] = batchFormat;`. Cote Rust, verdict.rs:74-77 rend Verdict::Ok pour tout MP3 honnete (`Rail::Lossy => match declared_bitrate { Some(b) if cutoff_hz < min_cutoff_hz_for_bitrate(b) => Fake, _ => Ok }`). Et filing.rs:452-455 `let target = override_target.unwrap_or_else(...); if encode::guard_no_upscale(source_rail, target).is_err() { return Err(FilingError::Upscale); }` — allow_rail_mismatch ne contourne PAS ce garde (il ne desactive que le sniff de contenu, filing.rs:446-450). Le rail Detail applique bien la regle (filing.ts:153-159 grise AIFF/WAV des que lossy, avec le commentaire `greying it out prevents the dead-end click`). Le Lot est le seul ecran ou le clic sans issue est possible — et il est massif. Recap verifie batch-panel.ts:705-716: `${res.filed} filed · ${res.needs_validation.length} need validation`, precede d une icone `ti-check` et colore en var(--color-text-success), en anglais dans une UI francaise, sans nommer une seule cause.
- Impact : correctness
- Effort : M
- Risque du fix : moyen
- Note : **A**
- Scenario de defaillance : File de 250 MP3 320 kbps authentiques (verdict ok, rail lossy). L utilisateur ouvre Revue > Lot: les 250 sont dans `Prets · lossless`, coches d office, Format affiche AIFF. Il clique Convertir. plan_file appelle guard_no_upscale(Lossy, Aiff1644) pour chacun -> Err(Upscale) -> les 250 partent en needs_validation (ipc_filing.rs:717-719). Affichage final: coche verte, texte vert, `0 filed · 250 need validation`. Zero fichier range, zero explication, et la variante de FilingError a ete jetee au passage (voir SYS-7): ni l utilisateur ni un developpeur ne peuvent savoir pourquoi.
- Fichiers : `frontend/batch-panel.ts`, `src-tauri/src/encode.rs`, `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Une seule autorite pour la regle: soit le Lot envoie `target: null` et laisse encode::target_for decider par piste (comportement correct par construction), soit il desactive AIFF/WAV des que la selection contient un rail lossy, comme le rail Detail. Dans les deux cas, humaniser le recap en francais et nommer la cause dominante des rebonds.

### [SDP-1] La table extension->rail est dupliquee cote front et a DEJA diverge: .opus est mis en file mais classe `unknown`, ce qui rouvre le clic sans issue
- Passe : ralph
- Emplacement : `frontend/filing.ts:464`
- Preuve : VERIFIE CE TOUR. frontend/filing.ts:463-467: `const ext = ...; let rail = "unknown"; if (["flac","wav","aif","aiff","alac"].includes(ext)) rail="lossless"; else if (["mp3","m4a","aac","ogg"].includes(ext)) rail="lossy";` — `opus` absent. La table de reference est analysis/tags.rs:24-30 `"mp3" | "aac" | "m4a" | "ogg" | "opus" => Rail::Lossy`. Et scanner.rs:7-10 AUDIO_EXTS contient bien `"opus"`: le fichier EST mis en file. Consequence dans le meme fichier: filing.ts:153 `const lossy = rail === "lossy"` puis 155-159 ne grise AIFF/WAV que si lossy — donc pour un .opus les deux chips restent cliquables. Aggravant verifie: la valeur autoritaire est deja en portee (le rapport d analyse, champ declared_rail, resolu filing.ts:350 et passe a renderEditor filing.ts:472); le commentaire filing.ts:463 qui justifie la copie (`analysis data attribute not available cross-module`) est devenu faux.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Une piste .opus dans la file. rail="unknown" -> lossy=false -> les chips AIFF et WAV restent actives. L utilisateur clique AIFF -> state.target="aiff_16_44" -> fileTrack -> plan_file calcule source_rail=Rail::Lossy par rail_from_ext("opus") -> guard_no_upscale echoue -> FilingError::Upscale -> `Refuse : pas de surqualite lossy -> lossless`. Le clic sans issue que le grisage existe precisement pour empecher est servi a chaque .opus, a chaque ouverture. Le nom final affiche annonce en plus `.aiff` pour un fichier qui ne sera jamais ecrit.
- Fichiers : `frontend/filing.ts`, `src-tauri/src/analysis/tags.rs`, `src-tauri/src/scanner.rs`
- Correctif esquisse : Supprimer la table TS et alimenter state.rail depuis `report?.declared_rail ?? "unknown"` (deja en portee filing.ts:350). La connaissance extension->rail redevient monopropriete de analysis/tags.rs. Voir SYS-3 pour les 3 autres copies de la meme regle.

### [CC-2] Les workers de la phase 2 du rangement par lot n ont pas de catch_unwind — la piste perdue est peinte `fait` a l utilisateur
- Passe : ralph
- Emplacement : `src-tauri/src/ipc_filing.rs:771`
- Preuve : VERIFIE CE TOUR, cote a cote. ipc_filing.rs:763-788: `handles.push(std::thread::spawn(move || { loop { ... let job = { queue.lock().ok().and_then(|mut q| q.pop()) }; let Some(job) = job else { break }; let log = filing::execute_file(&job.plan).map_err(...).ok(); if tx.send(...).is_err() { break; } } }))` — aucun catch_unwind. Le MEME appel sur le chemin interactif en est entoure, ipc_filing.rs:437-448, avec le commentaire explicite `the same "heavy work on an unvetted user file, on a thread nobody joins" shape as worker.rs's analysis loop, so it gets the same catch_unwind treatment — a panic here must become a normal failure, not a silently vanished thread`. C est aussi une regle ecrite du projet: .claude/rules/rust.md:81-92 `A reproduire pour toute future tache lourde ajoutee dans un worker_loop-like tournant sur de l I/O utilisateur non maitrise`. Vu aussi par CR-4 (B): deux passes, meme site — je retiens le A. Second trou dans le meme bloc: `queue.lock().ok()` (ipc_filing.rs:769) rend None sur mutex empoisonne -> tous les workers sortent en silence, et le balayage final `if let Ok(q) = queue.lock()` (ipc_filing.rs:875) echoue aussi -> les jobs restants ne sont meme pas reportes en needs_validation.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Lot de 50 pistes, la n°17 est un conteneur corrompu qui fait paniquer lofty pendant write_tags_full ou le pipeline d encodage — surface d entree non maitrisee, exactement la raison d etre du catch_unwind pose 330 lignes plus haut. Le thread meurt: aucun Phase2Outcome n est envoye, le job a deja ete pop de la file donc il n est pas non plus dans le balayage final. La piste n est ni dans `filed` ni dans `needs_validation`. Cote UI, batch-panel.ts:685-687 `finishBatchTracklist(processed.filter((id) => !failed.has(id)), res.needs_validation)` avec processed = batchTrackIds la place dans les `done`: elle est peinte avec une coche verte. L utilisateur lit `converti` sur une piste restee pending, non convertie, dont le rollback FS n a jamais tourne (fichier partiel possible a destination, ou tags ecrases en place — cf. CR-3). Le pool perd en plus un thread pour le reste du lot, et la progression plafonne a 49/50.
- Fichiers : `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Envelopper filing::execute_file(&job.plan) dans `catch_unwind(AssertUnwindSafe(...))`, traiter le panic comme `log = None` + log::error!, et envoyer quand meme le Phase2Outcome pour que la piste parte en needs_validation. Logger et reporter le cas `queue.lock()` empoisonne au lieu de sortir muet.

### [CC-1] Un scan de doublons qui echoue affirme a l utilisateur `Aucun doublon dans toute la bibliotheque`
- Passe : ralph
- Emplacement : `frontend/sift-live.ts:321`
- Preuve : VERIFIE CE TOUR. sift-live.ts:317-328 : `void scanLibraryDuplicates().then((groups) => { bibDup.groups = groups; }).catch((e) => { console.error("scan_library_duplicates failed", e); bibDup.groups = []; }).finally(...)`. Le MEME bloc est copie a l identique a sift-live.ts:419-430 (branche act === "dupscan"). Cote rendu, bibliotheque-view.ts:243-251: la cascade est `!shown ? "" : loading ? "Scan en cours…" : groups === null ? "" : groups.length === 0 ? "Aucun doublon dans toute la bibliotheque." : <liste>`. Il n existe aucun etat d erreur: bibDup ne porte que `{groups, loading, shown}` (bibliotheque-view.ts:46-50). L echec et le succes-a-zero sont litteralement le meme etat, et le catch choisit d ecrire celui qui ment.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Bibliotheque volumineuse. L utilisateur clique la puce Doublons. scan_library_duplicates renvoie une Err — panne deja vecue sur ce chemin (genres::get_genres_batch liait un parametre SQL par piste et depassait la limite SQLite de 32766, docs/superpowers/plans/2026-07-14-phase3-measurement-report.md), et desormais aussi atteignable par un verrou empoisonne. Le catch pose groups = [], le panneau affiche `Aucun doublon dans toute la bibliotheque.` L utilisateur conclut que sa bibliotheque est propre et passe a la suite. Seule trace: un console.error invisible en production. Reponse fausse, affirmative, jamais retractee, sur l ecran qui decide d une action destructive.
- Fichiers : `frontend/sift-live.ts`, `frontend/bibliotheque-view.ts`
- Correctif esquisse : Ajouter `error: string | null` a bibDup, le poser dans les deux catch, rendre un bloc d erreur + bouton Reessayer au lieu du message `Aucun doublon`. Au passage extraire le bloc duplique en un seul loadDuplicates() appele par les deux branches.

### [SIMP-1] Police d icones Tabler chargee depuis un CDN, sans repli local — toute l iconographie disparait hors ligne (deja observee cassee le 2026-07-01)
- Passe : ralph
- Emplacement : `index.html:7`
- Preuve : VERIFIE CE TOUR. index.html:7 `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/tabler-icons.min.css">` et styles.css:1487 `@font-face{font-family:"tabler-icons-filled";...src:url("https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/fonts/tabler-icons-filled.woff2")}`. Un grep `tabler` sur index.html + styles.css + package.json + tauri.conf.json ne remonte AUCUNE occurrence dans package.json: aucune dependance, aucune copie locale. tauri.conf.json whiteliste le CDN dans style-src et font-src, donc c est un chemin actif, pas un residu. A comparer a main.ts:1-5 qui bundle Outfit/JetBrains Mono via @fontsource avec le commentaire `so the desktop app needs no network` — l invariant est pose puis viole pour les icones. Symptome deja capture en vrai: docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md:66-72 `le bouton play de la bande d audition affiche un glyphe qui ressemble a un caractere de repli`, avec le fix propose (bundler Tabler en local) — non applique 27 jours plus tard.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : Un DJ lance le Sift package sans reseau (avion, club, DNS coupe, pare-feu d entreprise bloquant jsdelivr): le link d index.html:7 echoue, aucune famille .ti n est definie. Chaque `<i class="ti ti-*">` rend un glyphe de repli. Les controles ICONE-SEULE perdent alors tout label: boutons de titlebar (fermer/reduire/agrandir, chrome.ts), play/pause du lecteur, tous les .lk-icon. L app reste fonctionnelle mais illisible, et le premier reflexe de l utilisateur — relancer — ne change rien.
- Fichiers : `index.html`, `frontend/styles.css`, `package.json`, `src-tauri/tauri.conf.json`
- Correctif esquisse : Ajouter @tabler/icons-webfont en dependance, importer son CSS depuis main.ts comme les @fontsource, pointer le @font-face de styles.css:1487 sur l asset local, puis retirer cdn.jsdelivr.net de style-src et font-src dans tauri.conf.json — un CSP redevenu 'self' seul est la preuve que plus rien ne sort.

### [SJ-1] Le token --overlay-bar lu par la waveform n existe plus: repli code en dur rgba(255,255,255,.35) sur le theme CLAIR, qui est le theme par defaut
- Passe : ralph
- Emplacement : `frontend/report-view.ts:748`
- Preuve : VERIFIE CE TOUR. report-view.ts:748 `const waveColor = cs.getPropertyValue("--overlay-bar").trim() || "rgba(255,255,255,.35)";`, passe a WaveSurfer.create comme `waveColor` (report-view.ts:756), c est-a-dire la couleur des barres NON LUES; `progressColor` lit --color-waveform-elapsed, lui bien declare. Un grep `overlay-bar` sur frontend/ + index.html ne rend que deux lignes, le commentaire report-view.ts:742 et cet usage: AUCUNE declaration. Cause datee et assumee ailleurs: docs/ressources-externes.md:1196 `10 tokens CSS orphelins (--h-36, --overlay-bar, ...) retires de styles.css` le 2026-07-09 — le token a ete supprime comme orphelin alors qu il avait ce lecteur JS, invisible a un grep `var(--overlay-bar)` puisqu il est lu par getPropertyValue. Le commentaire report-view.ts:744-745 decrit exactement le bug reintroduit: `theme-aware unlike the old hardcoded rgba(255,255,255,.35) — that literal only worked by accident in dark mode, invisible in light`. Theme par defaut clair, verifie: styles.css:11-12 `:root{color-scheme:light}`, le sombre n arrive que par @media (120) ou [data-theme="dark"] (153).
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **A**
- Scenario de defaillance : App en theme clair (defaut), ecran Revue, ouverture de n importe quelle piste: getPropertyValue rend "", waveColor tombe sur rgba(255,255,255,.35), WaveSurfer dessine les barres non lues en blanc a 35% par-dessus un fond gris chaud clair (oklch ~91-94% de clarte). La partie non encore ecoutee de la forme d onde — element hero de l ecran de decision du produit — devient quasi invisible, tandis que la partie lue reste nette. Symptome trompeur: le lecteur a l air de n afficher que ce qui a deja ete joue.
- Fichiers : `frontend/report-view.ts`, `frontend/styles.css`
- Correctif esquisse : Redeclarer --overlay-bar dans les 3 blocs de theme de styles.css (translucide sombre en clair, clair en sombre), ou pointer waveColor sur un token existant equivalent. Retirer le repli litteral au profit d un echec bruyant. Trancher dans le meme geste SJ-8 (design-system-states.md:106 documente un lisere .qi.cur base sur ce meme token disparu).

### [SYS-2] Aucune sentinelle stable ne traverse l IPC: 20+ decisions de controle prises par sous-chaine de prose francaise, dont une qui declenche un DELETE de ligne DB
- Passe : ralph
- Emplacement : `src-tauri/src/analysis/decode.rs:36`
- Preuve : Cause racine: le mecanisme de garde EXISTE (filing.rs:1996 `const CONTRACTS_TS: &str = include_str!("../../shared/contracts.ts");` + deux tests d appariement) mais il n est branche que sur 2 constantes, FILE_IN_PLACE et EXTERNAL_DEST_PREFIX. Tout le reste franchit la frontiere en clair. VERIFIE CE TOUR pour le pire cas: decode.rs:36 produit `le fichier n'existe plus a cet emplacement — a-t-il ete deplace ou supprime ?`; deux couches au-dessus, ipc.rs:324 `if allow_forget && e.contains("n'existe plus") && !Path::new(&path).exists()` declenche scanner::forget_path, soit la SUPPRESSION de la ligne tracks; et filing.ts:354 `if (msg.includes("n'existe plus")) fileGone = true`. Le seul test de garde, decode.rs:222-225, est un OU (`err.contains("n'existe plus") || err.contains("introuvable")`): il reste VERT si le message est reformule. La sous-chaine n est meme pas unique dans le crate (rekordbox_repairs.rs:306, :773, :1258 en emettent d autres qui la contiennent). Les 8 autres sentinelles apairees a la main: RAIL_MISMATCH, NoLibraryRoot, ALREADY_FILING, NO_TOKEN, RATE_LIMITED:, `source gone`, `aucun XML`, plus les 6 cles de settings.rs:8-24 retapees en litteraux cote TS (reglages-view.ts:48/54/61/121/132/289, filing-bins.ts:17, home-sources.ts:14, theme.ts:7 — `ui_theme` n existant meme pas cote Rust). Pire encore, deux sentinelles PRODUITES et documentees ne sont honorees par personne: usb_format/mod.rs:62-63 emet IDENTITY_MISMATCH et DRIVE_VANISHED avec le commentaire `so the frontend can pattern-match distinctly`, ipc.ts:386-388 documente le contrat, et le seul consommateur usb-format-modal.ts:165-179 ne teste ni l un ni l autre. Et 3 sites TS classent les erreurs par regex anglaise (`/permission|access|denied/i`, filing-actions.ts:123) qui ne matche pas `Acces refuse` sur un Windows francais. Vu par CA-1 (A, RETROGRADE ici en B: son scenario suppose une reformulation future, pas un mauvais resultat sur des entrees actuelles), CA-3, CA-4, SDP-8, PP-12, CC-7.
- Impact : correctness
- Effort : M
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Deux issues, aucune ne fait rougir un test. (1) Un dev reformule decode.rs:36 en `fichier introuvable a cet emplacement` — exactement le type de retouche que l audit UX F2 a deja fait sur ce chemin. cargo test reste vert (le OU accepte `introuvable`). ipc.rs:324 ne declenche plus forget_path: l auto-avance de Revue rouvre indefiniment la meme piste disparue, le bug documente en commentaire ipc.rs:313-318 (`found live, 2026-07-20`) revient. (2) L utilisateur debranche la cle A, branche la cle B sur le meme port, confirme le formatage: le backend refuse correctement avec IDENTITY_MISMATCH, le modal affiche `Echec du formatage. Verifie que le disque est bien branche et reessaie.` — invitation a RECOMMENCER un formatage sur un disque dont Sift vient de dire qu il n est pas celui choisi, sur l operation la plus destructive de l app.
- Fichiers : `src-tauri/src/analysis/decode.rs`, `src-tauri/src/ipc.rs`, `frontend/filing.ts`, `shared/contracts.ts`, `src-tauri/src/usb_format/mod.rs`, `frontend/usb-format-modal.ts`, `src-tauri/src/settings.rs`
- Correctif esquisse : Declarer les sentinelles (dont FILE_GONE, PERMISSION, les 2 USB, les 6 cles settings) dans shared/contracts.ts, les importer cote TS, et etendre le bloc de tests filing.rs:1996-2014 d un test include_str! par sentinelle — ~8 tests de 5 lignes, le patron est deja en place. Priorite absolue: FILE_GONE, la seule dont la rupture supprime des lignes de la base.

### [SYS-3] La regle `quel format pour quel rail` a quatre implementations independantes et a deja diverge trois fois
- Passe : ralph
- Emplacement : `src-tauri/src/analysis/tags.rs:24`
- Preuve : Une seule regle metier, quatre encodages sans lien ni test croise. (1) L autorite: tags.rs:24-30 rail_from_ext (VERIFIE), qui pilote le rail reel. (2) frontend/filing.ts:464-467, table recopiee, `opus` manquant — bug actif, entree SDP-1. (3) dedup.rs:51-55 is_lossless_fmt `matches!(f, "aiff"|"aif"|"wav"|"flac")` — `alac` manquant, alors que tags.rs le classe Lossless; le meme ensemble est re-encode en SQL a library.rs:150 et library.rs:206 (`lower(format) IN ('aiff','aif','wav','flac')`, VERIFIE ce tour). (4) La regle rail->format par defaut existe en Rust (encode.rs:64-69 target_for, testee encode.rs:187-189, VERIFIEE) et en TS (filing-preview.ts:17-19 defaultTarget + filing-preview.ts:21-25 targetExt qui reimplemente Target::ext), la version TS pilotant l extension du nom final affiche et la pastille allumee tandis que la version Rust decide du fichier reellement ecrit des que le front envoie target: null — ce qu il fait par defaut. Aucun test miroir sur aucune de ces copies, et package.json ne declare aucun script de test frontend (cf. SYS-4). Le meme fichier prend pourtant soin de NE PAS dupliquer le rendu du nom (filing-preview.ts:90 `Renders via naming::render_filename ... not a TS reimplementation`) — l extension est le residu oublie. Vu par SDP-1, PP-3, PP-4, CA-6: quatre passes, quatre copies differentes trouvees.
- Impact : correctness
- Effort : M
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Decision produit: le rail lossless part desormais en WAV. On modifie encode.rs:66 et son test — cargo test vert, clippy vert, tsc vert. filing-preview.ts:18 reste sur aiff. Sur toute piste lossless ouverte sans clic de pastille: le rail affiche `-> Artiste — Titre.aiff`, la pastille AIFF est allumee, et le fichier ecrit sur disque est un .wav. PRODUCT.md interdit explicitement de mentir a l ecran.
- Fichiers : `src-tauri/src/analysis/tags.rs`, `frontend/filing.ts`, `src-tauri/src/dedup.rs`, `src-tauri/src/library.rs`, `frontend/filing-preview.ts`, `src-tauri/src/encode.rs`
- Correctif esquisse : Une autorite, trois consommateurs. dedup.rs appelle rail_from_ext; library.rs construit sa clause IN depuis une constante LOSSLESS_EXTS exportee par tags.rs; le front lit declared_rail et l extension effective renvoyee par previewFilename (deja un aller-retour IPC) au lieu de recalculer. A defaut, un test include_str! sur filing-preview.ts, patron filing.rs:1996-2014.

### [SYS-4] La definition de fini est ecrite trois fois et appliquee par personne: CI sans tests ni clippy ni tsc, lint-tokens a 83% de bruit, zero test sur 11 485 lignes de TS
- Passe : ralph
- Emplacement : `.github/workflows/build.yml:26`
- Preuve : Trois garde-fous, trois trous, aucun ne se recouvre. (1) CI: la checklist `avant de dire fini` existe dans CLAUDE.md:58-65, .claude/rules/rust.md:106-110 et docs/design-system/governance.md, mais `grep -rn "cargo test|clippy|tsc --noEmit" .github/` rend 0 sur les 2 workflows; build.yml n execute que `npm run lint:tokens` et `npm run tauri build`. Le seul executeur des ~399 tests est .claude-gate consomme par .git/hooks/pre-commit — un fichier que Git ne versionne jamais — et .claude/verify.sh exclut explicitement les tests (verify.sh:11-13). (2) lint-tokens: VERIFIE CE TOUR en instrumentant TOKEN_BLOCK_RE (lint-tokens.mjs:99) sur styles.css reel — 1 SEUL match, lignes 153->167, la ou le commentaire de justification (lint-tokens.mjs:92-98) revendique neutraliser les 3 blocs de tokens pour attraper la derive des regles de composant. Cause: des accolades litterales dans les commentaires du bloc :root (styles.css:18 `/* bg-{info,danger,success,warning} ... */`) cassent le `[^{}]*`, et le selecteur ne couvre pas `:root:not([data-theme="light"])`. J ai reparti la sortie reelle du linter par ligne: sur 122 findings couleur, 59 tombent dans :root clair (11-114), 42 dans le bloc @media sombre (115-152), 11 dans la queue non neutralisee du bloc dark, et 10 SEULEMENT dans de vraies regles de composant. Le rapport est a 83% de bruit et le ratchet, qui compte des occurrences, accorde du mou a chaque token supprime. (3) Frontend: package.json ne declare aucun script test, aucun runner (ni vitest ni jest), aucun *.test.ts dans le repo — 37 fichiers .ts hors stories, 11 485 lignes non couvertes, dont frontend/b85.ts, portage manuel d une crate dont b85_bytes.rs:127-129 dit `any independent decoder (e.g. the frontend one) must map this exact string back` sans que rien cote TS ne consomme le vecteur. Vu par PP-10, SJ-2 (A, RETROGRADE ici en B: le garde est degrade et le rapport faux, mais aucun resultat produit a l utilisateur n est faux et aucune donnee n est en jeu), CC-9, CA-10, CC-10.
- Impact : correctness
- Effort : M
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un commit pousse depuis une machine sans le hook pre-commit installe (nouveau clone, worktree, agent, contributeur) traverse la CI en vert des lors que tauri build compile — un test rouge, un warning clippy promu erreur ou une erreur tsc n arretent rien, et release.yml produit des installeurs a partir d un code dont aucune suite n a tourne. En parallele, un changement qui ajoute `color:#ff0000` dans une regle de composant ET supprime une declaration de token devenue inutilisee laisse le compte a 122: le linter affiche `within baseline — pass` et sort 0. Aujourd hui deja, il designe styles.css:13 (la valeur de --color-background-primary) comme `hardcoded value bypassing tokens`.
- Fichiers : `.github/workflows/build.yml`, `scripts/lint-tokens.mjs`, `scripts/lint-tokens-baseline.json`, `package.json`, `.claude/verify.sh`
- Correctif esquisse : Trois gestes independants, par ROI decroissant: (a) ajouter au workflow un job `test` sans needs: (npx tsc --noEmit, cargo clippy --all-targets -- -D warnings, cargo test) — c est le seul qui protege TOUT le reste du rapport; (b) strip des commentaires CSS avant TOKEN_BLOCK_RE + selecteur elargi a :root:not([...]), verifier que le match compte 3 blocs, puis regenerer la baseline; (c) vitest (config 5 lignes, partage le pipeline Vite existant) sur les seuls modules purs: b85.ts contre le vecteur fige b85_bytes.rs:134, batch-tracklist.ts, genre-families.ts.

### [SYS-5] Doc-rot systemique: onze documents actifs pointent vers des cibles supprimees, videes, non installees ou contradictoires
- Passe : ralph
- Emplacement : `docs/INDEX.json:1`
- Preuve : Onze occurrences du meme mecanisme — un doc vivant qui reference une cible que le repo a bougee sans propager. VERIFIE CE TOUR: (a) `.agents/` n existe pas dans C:\dev\sift (`ls` -> No such file or directory) et .claude/skills ne contient que impeccable/, alors que CLAUDE.md:139 ET governance.md:26-27 routent toute tache UI vers la skill `sift-ui-design-governance` `en premier, comme garde-fou projet` (PP-7); (b) .claude/settings.local.json contient `"disabledMcpjsonServers": ["shadcn", "ui-thing"]` alors que CLAUDE.md:336 impose de consulter ces deux MCP + une skill `coss` inexistante avant tout nouveau micro-composant, regle ouverte par `Jamais de style de memoire d entrainement` — donc inapplicable telle qu ecrite (PP-8); (c) .interface-design/system.md:97-104 affirme que styles.css ne declare que --space-4/8/12/16 alors que styles.css:81 declare bien --space-24 et --space-32 (VERIFIE — voir le REJETE PP-9, la retractation est elle-meme fausse). Relayes des passes, non revérifiés ligne a ligne: AGENTS.md a ete vide de tout contenu le 2026-07-22 mais reste designe comme source des contraintes projet par governance.md:13 et foundations.md:72 (PP-6); l index de navigation de ressources-externes.md est maintenu en double et les deux copies ont derive de 49 a 72 lignes, ce qui casse le `Read offset=<L>` que CLAUDE.md:100-103 impose (PP-5); docs/INDEX.json omet 6 a 7 fichiers dont un design de migration React+shadcn non archive qui contredit frontalement CLAUDE.md:34-36 `une migration de framework est explicitement ecartee` — VERIFIE dans CLAUDE.md (PP-16, SIMP-9, SIMP-13); TECH_DEBT_AUDIT.md trone a la racine avec un resume executif au present decrivant 18 findings sur 20 deja resolus (SIMP-3); README.md:27-28 et :121 se contredisent sur l auto-update et le lien de la ligne 28 est mort (SIMP-10); shared/contracts.ts:347/373/421 annonce trois familles M8 comme miroir d ipc_library.rs alors que les structs vivent dans rekordbox_repairs.rs depuis l extraction du 2026-07-09 (CA-9); design-system-states.md:106 documente pour .qi.cur un lisere base sur --overlay-bar, token supprime (SJ-8, meme cause racine que le A SJ-1); scripts/rekordbox-spike-helper.ps1 touche le dossier Pioneer reel, n est reference nulle part et n est pas dans l inventaire CLAUDE.md (SIMP-14).
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **B**
- Fichiers : `docs/INDEX.json`, `CLAUDE.md`, `AGENTS.md`, `docs/design-system/governance.md`, `docs/design-system/foundations.md`, `docs/ressources-externes.md`, `.interface-design/system.md`, `TECH_DEBT_AUDIT.md`, `README.md`, `shared/contracts.ts`, `docs/design-system-states.md`
- Correctif esquisse : Deux gestes structurels plutot que onze corrections: (1) rendre l invariant mecanique — un check pre-commit `INDEX.json vs glob docs/**/*.md` (la regle CLAUDE.md:113-117 est declarative depuis le debut, donc violee) et un check `tout var(--x) a une declaration` (c est ce qui a trouve SJ-1 et SJ-3); (2) appliquer la politique doc-rot: archiver TECH_DEBT_AUDIT.md, le design React et .interface-design/system.md hors du path scanne, et trancher les 3 routages morts de CLAUDE.md (skill non installee, 2 MCP eteints, skill coss inexistante) — un routage qui ne resout rien produit exactement le comportement qu il voulait empecher.

### [SYS-6] Zone de concentration: le module Rekordbox porte trois familles clonees en Rust ET trois en TS, messages d erreur compris, sans aucun type partage
- Passe : ralph
- Emplacement : `src-tauri/src/rekordbox_repairs.rs:233`
- Preuve : Le concept `file de candidats master.db` n a pas de module, donc il existe six fois. Cote Rust (rekordbox_repairs.rs): dismiss_*_inner x3 (223, 459, ~682), resolve_ambiguous_*_inner x3 (233-260, 470-497, 695-722, ~28 lignes chacune), apply_one_* x3 (264, 509, 735, ~78 lignes chacune), apply_*_inner x3, et trois structs de sortie structurellement identiques `{id, ok, error}` (ApplyRepairOutcome:50, ApplyMetadataSyncOutcome:501, ApplyArtworkSyncOutcome:726). Les messages francais sont copies mot pour mot: `cette ligne n est plus ambigue — rechargement necessaire` aux lignes 247, 484, 709; `piste choisie invalide pour cette ambiguite` aux lignes 251, 488, 713; `piste ambigue ou deja traitee` aux lignes 297, 548, 762. Les tests suivent: 9 tests resolve_ambiguous quasi identiques (1401, 1425, 1448, 1684, 1710, 1731, 2259, 2286, 2309). Cote TS (rekordbox-view.ts): metadataSyncsSectionHtml (324-408) et artworkSyncsSectionHtml (424-503) sont deux clones de ~80 lignes, candidateList byte-identique (348-354 vs 443-449), seuls changent infoBlock et le prefixe mds->mas; handleRekordboxAction fait 345 lignes et 20 branches (660-1005) et recopie 3 fois la MEME classification d erreur par sous-chaine francaise (723, 852, 953: `raw.includes("plus ambiguë") || raw.includes("piste choisie invalide") ? raw : "Choix impossible"`) — soit les messages Rust ci-dessus, presents a six endroits dans deux langages. Deux defauts adjacents dans la meme zone: RekordboxIndex expose un Vec nu sans methode (rekordbox_masterdb.rs:332-335), donc la regle de normalisation de chemin est recopiee dans les 3 detecteurs (actions.rs:276-282, 387-393, 460-466) avec un scan lineaire chacun; et la detection masterdb est une chaine de pass-through a 4 niveaux dont la meme garde est ecrite 3 fois (actions.rs:120-126, 139-145, 158-164), les doc-comments assumant `mirrors ... exactly`. Vu par SDP-2, SDP-3, SDP-4, CC-6, CC-7. NOTE: la localisation du dispatch dans rekordbox-view.ts est un ecart documente et assume (CLAUDE.md:175-179) — ce finding vise la taille et la triplication, pas l emplacement.
- Impact : maintenabilite
- Effort : L
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/rekordbox_repairs.rs`, `frontend/rekordbox-view.ts`, `src-tauri/src/rekordbox_masterdb.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Cote Rust: un `ApplyOutcome` unique + un descripteur de tier (`{table, id_col}`) passe a resolve_ambiguous_row/apply_one/dismiss generiques; les 3 messages deviennent 3 const, et les 9 tests se replient sur un test parametre. Cote TS: un renderCandidateSection(cfg) parametre par prefixe d action + fonction infoBlock, et une table `{prefix, sel, rerender, ipc}` pour remplacer les 20 branches. Prealable utile: donner a RekordboxIndex une interface etroite (HashMap chemin normalise -> track_ids, `tracks` prive).

### [SYS-7] Erreurs avalees en silence sur les chemins critiques: ~20 sites de lock sans log hors IPC, et la variante de FilingError jetee a chaque rebond de lot
- Passe : ralph
- Emplacement : `src-tauri/src/watcher.rs:33`
- Preuve : Le projet a ECRIT la regle apres un incident (.claude/rules/rust.md:73-80, VERIFIE ce tour: `Pattern a suivre: match state.lock() { Ok(x) => x, Err(_) => { log::error!("..."); return None; } }, jamais juste .ok()?/else { return } nu sur un Mutex partage avec un pool de threads`), l a appliquee a worker.rs (189-192, 243-249, 271-276) et l a laissee tomber partout ailleurs. VERIFIE CE TOUR: watcher.rs:33 `let Ok(conn) = state.lock() else { return };` (start_all) et watcher.rs:119 idem (handle_events), plus watcher.rs:34 `let Ok(mut stmt) = conn.prepare(...) else { return };`, :37 `let Ok(rows) = stmt.query_map(...) else { return };`, :143 et :151 qui jettent l Err de upsert_file/forget_path — six sorties muettes dans un seul fichier. worker.rs applique la regle sur le Mutex<Connection> mais PAS sur le Mutex<Queue>: worker.rs:202 `let Ok(mut q) = m.lock() else { return };`, :218 `.ok()?`, :227 `.ok()?` — et un pop() qui rend None termine worker_loop definitivement (worker.rs:293), aucun thread n etant jamais relance. Cause structurelle: db::lock_conn (db.rs:8-12) est taille pour un seul appelant (prend un `State` Tauri, rend une String), donc les ~20 sites hors commande IPC rejouent chacun leur politique. Meme famille, autres sites: ipc_filing.rs:717 `Err(_) => { needs_validation.push(id); continue; }` detruit la variante de FilingError sans log alors que le meme fichier logue ailleurs (ipc_filing.rs:693, :735) — c est pourquoi le lot de PP-1 est indiagnosticable; dedup.rs:168-172 et :404-407 `let _ = conn.execute(...)` sur le cache d empreintes; fingerprint.rs:55 `filter_map(|t| t.parse().ok())` qui rend une empreinte tronquee au lieu d une erreur. Vu par CC-3 (A, RETROGRADE ici en B: l etat declencheur — mutex empoisonne — n est pas une entree concrete demontree aujourd hui, et le prejudice principal est l absence de diagnostic, pas un resultat faux), CR-10, CA-8, CR-11, PP-2. Contredit CLAUDE.md `fail fast, pas de fallback silencieux`.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un panic survient pendant qu un thread tient un des deux Mutex (chemin plausible: la phase 2 du lot n a pas de catch_unwind, cf. CC-2). A partir de la, selon le mutex touche: chaque batch d evenements FS entre dans handle_events, tombe sur watcher.rs:119 et return sans une ligne de log — l utilisateur depose des fichiers dans un dossier surveille, Reglages affiche toujours la source comme surveillee, rien n arrive jamais dans la file, aucune trace nulle part; ou chaque thread du pool sort de worker_loop a son prochain pop et n est jamais relance — le pool tombe a 0, l analyse s arrete definitivement et la file affiche `analyse…` pour toujours. Exactement le mode de degradation silencieuse que le durcissement du 2026-07-17 pretendait fermer.
- Fichiers : `src-tauri/src/watcher.rs`, `src-tauri/src/worker.rs`, `src-tauri/src/db.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/dedup.rs`, `src-tauri/src/fingerprint.rs`
- Correctif esquisse : Elargir db::lock_conn a `&Mutex<Connection>` (les appels depuis un State continuent de compiler par deref) et ajouter une variante `lock_conn_logged(ctx: &str)`; router les ~20 sites hors IPC dessus en commencant par watcher.rs:33/119 et worker.rs:202/218/227. Remplacer ipc_filing.rs:717 par `Err(e) => { log::error!("file_batch: plan_file refused track {id}: {e}"); ... }` — une ligne, et le lot de PP-1 devient diagnosticable.

### [CC-4] rollback_fs avale toutes ses erreurs sans un seul log, alors que c est lui qui garantit le `FS is left clean` invoque par ses deux appelants
- Passe : ralph
- Emplacement : `src-tauri/src/filing.rs:596`
- Preuve : VERIFIE CE TOUR. filing.rs:595-620: `"move" | "trash" => { let _ = move_cross_disk_safe(&fs.to, Path::new(&fs.from)); }`, `"convert" => { let _ = std::fs::remove_file(&fs.to); }`, `"tag_edit" => { ... let _ = tagging::restore_tags(&fs.from, &snap); }`. Le commentaire filing.rs:608-609 assume le choix (`best-effort like the rest of this rollback (errors are swallowed)`) mais il n y a AUCUN log. Deux appelants s appuient dessus comme sur une garantie: ipc_filing.rs:631-633 et ipc_filing.rs:855. Meme classe de defaut que TECH_DEBT_AUDIT F01/F02 sur le module frere (rekordbox_masterdb.rs) — ce site-la n a jamais ete balaye par cet audit. Complementaire de CR-3, qui montre le chemin ou rollback_fs n est meme PAS appele.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Piste conformante: tags ecrits en place, fichier deplace source -> dest. La phase 3 echoue (verrou DB empoisonne, ipc_filing.rs:833). rollback_fs tente le move retour; le volume de destination vient d etre demonte, ou un lecteur audio tient le fichier. Le `let _ =` avale l echec. Le fichier reste a dest avec de NOUVEAUX tags, la ligne DB pointe toujours sur source, la piste reste pending sur un chemin vide, et aucune ligne de log n explique ou est passe le fichier.
- Fichiers : `src-tauri/src/filing.rs`
- Correctif esquisse : Remplacer chaque `let _ =` par `if let Err(e) = ... { log::error!("rollback {kind} failed: {from} -> {to}: {e}") }`; optionnellement remonter un booleen `rollback incomplet` a commit_file pour que l appelant le dise a l utilisateur au lieu d un echec generique.

### [CC-5] expect() en code de prod sur le chemin de boot — la consequence exacte est deja ecrite dans db.rs, sans message pour l utilisateur
- Passe : ralph
- Emplacement : `src-tauri/src/lib.rs:180`
- Preuve : lib.rs:178 `let dir = app.path().app_data_dir().expect("no app data dir");`, lib.rs:180 `let conn = db::open(&dir.join("sift.db")).expect("db open failed");`, lib.rs:189-190 `settings::set(...).expect("session_id write failed");`. .claude/rules/rust.md:44-47 pose l interdit dur hors #[cfg(test)] (VERIFIE ce tour dans le fichier de regles). Le `setup` est une closure qui renvoie Result et utilise deja `?` a lib.rs:154: le correctif ne restructure rien. db.rs:244-250 nomme deja la consequence: `a full disk or an antivirus holding the file would panic the app at every launch until the condition clears`. Les 3 expect() de rekordbox_masterdb.rs sont hors perimetre (TECH_DEBT_AUDIT les a juges infaillibles); lib.rs n a jamais figure dans la liste balayee par cet audit.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Disque plein, ou antivirus tenant sift.db a l ouverture. db::open renvoie Err, l expect panique dans setup. L application meurt sans fenetre et sans message: l utilisateur voit un lancement qui ne fait rien, a chaque tentative, sans savoir que c est son disque. Avec `?`, Tauri remonte l erreur de setup et le message est au moins visible.
- Fichiers : `src-tauri/src/lib.rs`
- Correctif esquisse : Remplacer les trois expect par `?` avec un contexte francais (`.map_err(|e| format!("ouverture de la base: {e}"))?`). Le `.expect` de `.run(generate_context!())` (lib.rs:276) est du boilerplate genere hors closure et peut rester.

### [CC-8] run_file_batch: 255 lignes, trois phases, un registre de reservation et l emission de progression dans une seule fonction
- Passe : ralph
- Emplacement : `src-tauri/src/ipc_filing.rs:651`
- Preuve : ipc_filing.rs:651-905. Six responsabilites distinctes, chacune avec son propre traitement d erreur: phase 1 de planification sous verrou avec le set `reserved` et la liste `claims` (667-747), montage d un pool mpsc + N threads (749-789), boucle de collecte avec sondage du drapeau d annulation (792-808), tri par ordre de lot (811), phase 3 de commit sous verrou avec accumulation des paires de reparation XML (813-865), flush XML (867-871), balayage des jobs jamais demarres (873-879), liberation des claims (884-886), deux emissions d evenements (888-904). Les 15 lignes de doc-comment qui la precedent (636-650) sont elles-memes la preuve qu elle a besoin d un mode d emploi. C est la fonction qui concentre CC-2, PP-2 et une part de SYS-1: trois findings independants pointent son interieur.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Extraire les trois fonctions que le doc-comment nomme deja: plan_batch(...) -> (jobs, needs_validation, claims, cancelled), run_phase2(jobs, cancel) -> Vec<Phase2Outcome>, commit_outcomes(...) -> (filed, needs_validation). Le corps restant devient une dizaine de lignes d orchestration — et les correctifs CC-2/PP-2/SYS-1 deviennent chacun local a une fonction.

### [CA-5] L invariant anti-double-rangement de plan_file appartient a un static prive de la couche adaptateur et fuit dans la signature du domaine
- Passe : ralph
- Emplacement : `src-tauri/src/filing.rs:417`
- Preuve : filing::plan_file (domaine, sans dependance Tauri) prend `reserved: &HashSet<String>` en parametre (filing.rs:430) et s en sert pour ecarter les destinations deja revendiquees (filing.rs:387-406, ensure_unique_reserved). Mais le registre reel est un static prive de la couche IPC: ipc_filing.rs:324-333 `struct InFlightFilings { tracks, dests }` + `fn inflight() -> &'static Mutex<...>` avec un OnceLock, lu via reserved_dests() (ipc_filing.rs:339). Le domaine ne peut donc ni constituer ni verifier l invariant: il depend d un parametre que chaque appelant doit penser a remplir. Le commentaire ipc_filing.rs:318-323 documente le sinistre passe: `two tracks reconciling to the same name would be handed the SAME destination and the second encode would land on the first`.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **B**
- Scenario de defaillance : Un futur appelant de filing::plan_file hors ipc_filing.rs (auto-rangement au scan, rejeu depuis le watcher, outil de maintenance, test d integration) passe `&HashSet::new()` — exactement ce que file_track faisait avant le correctif P5. Rien ne l en empeche: le type est un HashSet vide parfaitement valide, aucun test ne couvre cet appelant, et le registre n est pas accessible depuis le domaine. Deux conversions planifiees avant que le premier fichier existe sur disque recoivent la meme destination, le second encodage ecrase le premier. Perte de fichier, deja survenue une fois.
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`
- Correctif esquisse : Deplacer le registre dans filing.rs derriere une API etroite (`filing::claim(track_id, dest) -> Result<Claim, AlreadyFiling>` avec liberation au Drop) et faire de plan_file le seul point qui le consulte — le parametre `reserved` disparait de la signature publique et ipc_filing.rs redevient un appelant comme un autre.

### [SDP-5] Aucun module ne possede `ecrire les tags d un fichier`: la recette a 6 etapes est recopiee sur les 3 sites d ecriture, et les copies ont deja diverge
- Passe : ralph
- Emplacement : `src-tauri/src/ipc_filing.rs:245`
- Preuve : La meme sequence — snapshot des anciens tags, write_tags_full, journal tag_edit, resolve_masterdb_index_if_linked, detect_masterdb_metadata_sync_*, puis detect_masterdb_artwork_sync_* conditionne a un cover — est reecrite a la main sur trois sites: filing.rs:529-547 + 696-755, ipc_filing.rs:245-299 (apply_tags), ipc_library.rs:43-112 (update_metadata_write_file + update_metadata_commit). Les doc-comments nomment eux-memes la contrainte (`Called directly by the 3 sites that write ID3 tags`, actions.rs:349-351; `Mirrors filing's tag write ... so an Apply and a File write the same tags`, ipc_filing.rs:222-223) — definition exacte d une connaissance partagee sans proprietaire. Les copies ont deja diverge sur des details porteurs: le titre synchronise vers Rekordbox passe par naming::tag_title a filing.rs:731 et ipc_filing.rs:212 mais est le brut `edit.title` a ipc_library.rs:96; le detecteur pochette est conditionne a `plan.extras.cover_path` (filing.rs:743), `extras.cover_path` (ipc_filing.rs:293) et `edit.cover_path` (ipc_library.rs:105).
- Impact : maintenabilite
- Effort : L
- Risque du fix : moyen
- Note : **B**
- Fichiers : `src-tauri/src/filing.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/ipc_library.rs`, `src-tauri/src/actions.rs`
- Correctif esquisse : Un module `tag_write` avec une interface unique `write_and_journal(conn, track_id, path, &TagValues) -> Result<String>` encapsulant snapshot + ecriture + journal + les 3 detecteurs. Les 3 appelants n en gardent que la construction de TagValues. Aligner au passage la divergence tag_title d ipc_library.rs:96, qui est un bug de coherence deja present.

### [SIMP-4] cdp.cjs: le selecteur est interpole non echappe dans la chaine `NOT FOUND` — la commande click echoue sur tout selecteur a guillemets, c est-a-dire ceux de ce repo
- Passe : ralph
- Emplacement : `.claude/scripts/cdp.cjs:118`
- Preuve : cdp.cjs:116-122: ligne 117 `document.querySelector(${JSON.stringify(selector)})` (correctement echappe) puis ligne 118 `if (!el) return "NOT FOUND: ${selector}";` (brut). Le repo utilise precisement des selecteurs a guillemets — cdp.cjs:131 lui-meme fait `querySelector('[data-view="revue"]')`. L expression generee pour `click '[data-view="revue"]'` est `return "NOT FOUND: [data-view="revue"]";`: la chaine se ferme sur le guillemet interne. Runtime.evaluate parse l expression ENTIERE avant execution, donc l echec est total et independant de la presence de l element. Deja identifie le 2026-07-20 (TECH_DEBT_AUDIT F20) et toujours present, comme F19 (cdp.cjs:36-37, executor async dont le rejet de pageWsUrl() n est relie a aucun reject).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Un agent lance `node .claude/scripts/cdp.cjs click '[data-view="revue"]'` pour verifier l UI reelle par CDP — le moyen de preuve documente par CLAUDE.md, et le seul disponible sur un WebView2. Runtime.evaluate renvoie une SyntaxError au lieu de cliquer. L agent lit un echec ambigu, conclut a un port squatte ou a une app absente (piste que CLAUDE.md:394-402 encourage explicitement) et perd la session a diagnostiquer le mauvais probleme.
- Fichiers : `.claude/scripts/cdp.cjs`
- Correctif esquisse : Ligne 118: `return "NOT FOUND: " + ${JSON.stringify(selector)};`. Ligne 36: resoudre pageWsUrl() AVANT `new Promise`, puis .then/.catch — pas d executor async.

### [SJ-3] --space-6 n existe pas: le padding du toast et de la banniere du Journal est purement supprime
- Passe : ralph
- Emplacement : `frontend/styles.css:733`
- Preuve : VERIFIE CE TOUR. styles.css:733 `.jrnl-toast{...padding:var(--space-6) var(--space-12);...}` et styles.css:735 `.jrnl-banner{...padding:var(--space-6) var(--space-12);...}`. L echelle declaree styles.css:81 est `--space-4:4px;--space-8:8px;--space-12:12px;--space-16:16px;--space-24:24px;--space-32:32px`. Un grep `space-6` sur frontend/ ne rend que ces deux lignes d usage, zero declaration. Par la specification CSS, une declaration contenant un var() vers une propriete personnalisee non definie et sans repli est invalide at computed-value time; `padding` n etant pas heritee, elle retombe sur sa valeur initiale, 0 — le raccourci ENTIER tombe, y compris la composante horizontale --space-12 qui est pourtant valide. Ni tsc ni lint-tokens ne peuvent l attraper: le premier ne lit pas le CSS, le second ne verifie que des litteraux, jamais qu un var() se resout (cf. SYS-4).
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Ecran Journal, annulation d une action rangee: le toast de confirmation s affiche avec padding 0 sur les quatre cotes — texte colle a la bordure teintee, en haut, en bas et sur les cotes. Idem pour .jrnl-banner (ok et warn) apres un lot. Decalage permanent, pas transitoire.
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Remplacer var(--space-6) par var(--space-4) ou var(--space-8) selon le rendu voulu. Ajouter au linter la verification `tout var(--x) a une declaration`: c est elle qui a trouve ce bug ET SJ-1, pour ~15 lignes de script.

### [SJ-4] Deux champs de recherche annulent le focus clavier sans rien remettre a la place, dans une app qui se declare keyboard-first
- Passe : ralph
- Emplacement : `frontend/queue-panel.ts:637`
- Preuve : queue-panel.ts:637 injecte l input de filtre de la File avec `style="...border:none;background:transparent;...outline:none;..."` — outline:none inline, inconditionnel, sur un input sans bordure. bibliotheque-view.ts:262 fait pareil pour #bibq (`border:0;...outline:none`), la bordure visible etant portee par le div parent qui ne reagit jamais au focus. La regle censee compenser, styles.css:504 `input:not([type="checkbox"]):focus-visible{outline:none;border-color:var(--color-text-info)}`, ECHANGE l outline contre une coloration de bordure — inoperante sur un input a border:none. Le principe contredit est ecrit dans le meme fichier, styles.css:488: `Keyboard-first: a visible focus ring on interactive elements`.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Ecran Revue au clavier: Tab jusqu au champ de filtre de la File. Aucun changement visuel — ni anneau, ni bordure, ni fond: l utilisateur tape sans savoir ou va la frappe, alors que la File a par ailleurs une navigation clavier complete. Identique sur Bibliotheque avec #bibq.
- Fichiers : `frontend/queue-panel.ts`, `frontend/bibliotheque-view.ts`, `frontend/styles.css`
- Correctif esquisse : Retirer outline:none des deux styles inline et laisser jouer la regle generique styles.css:497; ou porter le focus sur le conteneur via :focus-within (bordure --color-text-info sur #sift-qsearch et sur le wrapper de #bibq).

### [PP-11] usb-format-modal.ts reimplemente l echappement HTML, en plus faible que le helper canonique
- Passe : ralph
- Emplacement : `frontend/usb-format-modal.ts:191`
- Preuve : dom.ts:25-33 definit l autorite avec un mandat explicite: `Every render helper that builds markup from data not fully owned by Sift's own code must run it through this first — a file that skips it is a stored-XSS gap (found in journal.ts, 2026-07-10 security audit)`, et echappe les 5 caracteres `[&<>"']`. usb-format-modal.ts n importe pas esc (son seul import est ./ipc, ligne 12) et redefinit escapeHtml en 4 .replace: &, <, >, " — l apostrophe manque. Les 5 sites d appel (66, 69, 73, 76, 95) injectent des donnees hors du controle de Sift: drive.id, drive.label, drive.current_fs (fournis par l OS) et lastError. Note: la passe code-review a balaye les 40 fichiers .ts pour de l interpolation non echappee et n a trouve AUCUN trou exploitable — la discipline esc() tient partout ailleurs.
- Impact : securite
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Non exploitable en l etat: les 5 interpolations tombent en contenu texte (div, code, label), jamais dans un attribut a guillemets simples. Le defaut est structurel: la prochaine edition de ce fichier qui place une de ces valeurs dans un attribut du type `data-x='...'` — patron deja present ailleurs dans le repo — ouvre une sortie d attribut que le helper canonique aurait fermee. Meme classe de trou que celui corrige dans journal.ts le 2026-07-10.
- Fichiers : `frontend/usb-format-modal.ts`, `frontend/dom.ts`
- Correctif esquisse : `import { esc } from "./dom";`, supprimer escapeHtml, renommer les 5 appels. Un seul echappeur dans le repo, celui qui porte la doctrine.

### [CC-11] Suppression de doublons par lot: un echec partiel affiche `tout a echoue` et laisse la liste perimee a l ecran
- Passe : ralph
- Emplacement : `frontend/sift-live.ts:444`
- Preuve : sift-live.ts:444-452: `void Promise.all(losers.map((id) => trashTrack(id))).then(() => { bibDup.groups = (bibDup.groups||[]).filter((_, i) => i !== idx); return renderBiblioLive(); }).catch((e) => { console.error(...); toast("Échec : impossible d envoyer les doublons à la corbeille"); });`. Promise.all rejette au premier echec, mais les autres trashTrack sont deja partis et aboutissent. Le catch ne rappelle jamais renderBiblioLive(), donc bibDup.groups conserve le groupe entier. Meme famille que CC-1 (l ecran Bibliotheque affirme un etat qu il n a pas verifie).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **B**
- Scenario de defaillance : Groupe de 3 doublons, l utilisateur confirme l envoi a la corbeille des 2 perdantes. La premiere part, la seconde echoue (fichier tenu par un lecteur audio). Le toast annonce `impossible d envoyer les doublons a la corbeille` — faux pour la premiere, qui EST a la corbeille. La vue n est pas rafraichie: le groupe affiche toujours ses 3 membres, dont un qui n existe plus a son chemin. Un second clic relance un trashTrack sur une piste deja traitee.
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : Promise.allSettled, compter succes/echecs, message honnete (`N envoyees, M echouees`), et appeler renderBiblioLive() dans TOUS les cas.

### [CR-9] Cascade Discogs: une erreur reseau sur un essai degrade jette le meilleur resultat deja obtenu
- Passe : ralph
- Emplacement : `src-tauri/src/metadata/discogs.rs:447`
- Preuve : Dans Discogs::search, la boucle sur la cascade fait `let mut cands = self.search_query(attempt)?;` (discogs.rs:447). Le `?` propage immediatement toute ProviderError — y compris un RateLimited ou un Network transitoire sur un essai de rang 1 ou 2 — alors que `best` (discogs.rs:435, alimentee 458-466) contient peut-etre deja des candidats exploitables ramenes par l essai de rang 0. Le `match best` de sortie (469-472) n est jamais atteint. Contraste net avec le sondage de tracklist juste a cote, ou un echec est explicitement non fatal (discogs.rs:377-383, `best-effort ... a failed or rate-limited one just leaves that candidate unscored`).
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/metadata/discogs.rs`
- Correctif esquisse : Remplacer le `?` de discogs.rs:447 par un match: sur Err, logger et break la cascade pour tomber dans le `match best` final; ne propager l erreur que si best est encore None.

### [CR-8] group_duplicates: la similarite minimale d un groupe est perdue des qu un groupe fusionne dans un autre — le champ publie ment sur sa propre definition
- Passe : ralph
- Emplacement : `src-tauri/src/dedup.rs:196`
- Preuve : min_sim est indexe par la racine union-find COURANTE (dedup.rs:195-199 `let root = find_root(...); min_sim.entry(root).or_insert(s);`), mais union fait `parent[ra] = rb` (dedup.rs:87): quand un arbre deja porteur d un minimum est rattache sous un autre, min_sim[ra] devient inatteignable, la lecture finale ne consultant que la racine finale (dedup.rs:241). Trace rejouable: pistes 0,1,2. Paire (0,1) score 0.65 -> parent[0]=1, min_sim[1]=0.65. Paire (0,2) score 0.95 -> ra=1, rb=2, parent[1]=2, min_sim[2]=0.95. Groupe {0,1,2}, similarity publie = 0.95 alors que le lien le plus faible vaut 0.65. La doc du champ dit `Weakest pairwise similarity that linked the group together` (dedup.rs:47).
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/dedup.rs`
- Correctif esquisse : Fusionner les minimums au moment du union (reporter min_sim[ra] sur rb en prenant le min), ou accumuler les scores dans une liste (i,j,s) et calculer le min par groupe apres la passe union-find. Latent aujourd hui: le champ n est pas affiche — a corriger AVANT de l afficher, puisqu il pilote une action destructive.

### [SDP-10] Query.attempts signale `pas de cascade` par la valeur vide: signal en bande sur un cas legitimement atteignable
- Passe : ralph
- Emplacement : `src-tauri/src/metadata/mod.rs:136`
- Preuve : metadata/mod.rs:136-139 documente attempts comme `Vide = l appelant n en fournit pas et le fournisseur retombe sur {artist} {title}`, et discogs.rs:339-344 implemente ce repli. Mais le vide a deux causes: (a) appelant historique/test qui ne fournit rien, (b) search_terms::build_ladder qui a volontairement rejete tous ses essais — la fermeture push (search_terms.rs:834-847) jette toute requete de moins de 3 caracteres alphanumeriques avec une justification explicite (`une requete "2" ramenerait la moitie de Discogs`). Dans le cas (b), discogs.rs ressuscite mot pour mot la requete que search_terms venait d ecarter.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/metadata/mod.rs`, `src-tauri/src/metadata/discogs.rs`, `src-tauri/src/search_terms.rs`
- Correctif esquisse : Typer l absence hors bande: `attempts: Option<Vec<String>>` — None = appelant historique (repli legitime), Some(vec![]) = la cascade n a rien de cherchable, on ne cherche pas. Les tests existants passent None.

### [SJ-5] L echec d export Rekordbox renvoie l utilisateur vers un ecran ou la commande n existe plus
- Passe : ralph
- Emplacement : `frontend/sift-live.ts:125`
- Preuve : sift-live.ts:125, catch de runNavExport: `Aucun XML Rekordbox lie — relie un fichier depuis la Bibliotheque`. Or le bouton qui fait ce lien vit sur l ecran Rekordbox (rekordbox-view.ts:576 `data-bib="rkblink"` / `Lier un fichier XML Rekordbox`). Sur Bibliotheque il n y a plus rien: un grep `rkblink|Rekordbox` sur bibliotheque-view.ts + library-detail.ts ne rend que deux mentions en prose, dont le commentaire bibliotheque-view.ts:254 `Export (Rekordbox/Cle USB) lives in the nav rail now, not here`. Le deplacement est trace (spec 2026-07-05-rekordbox-integration-page-design); le message n a pas suivi, et n offre aucune action de rattrapage.
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : Reformuler vers l ecran reel (`a relier depuis Integrations > Rekordbox`) et passer une action au toast qui y navigue, comme le fait deja empty-state.ts avec son lien `Ouvrir Revue`.

### [SJ-9] L erreur brute du backend est deversee telle quelle dans 9 toasts, alors que deux modules montrent la bonne pratique dans le meme repo
- Passe : ralph
- Emplacement : `frontend/filing-actions.ts:320`
- Preuve : Sites affichant l erreur brute: filing-actions.ts:320 `toast(\`Echec : ${String(e)}\`)`, :315, :292; library-detail.ts:357 et :384; sift-live.ts:220 et :126; updater.ts:45; plus filing-identify.ts:350 et library-detail.ts:276 qui injectent esc(String(e)) dans la carte de candidats. En face, la discipline attendue existe: usb-format-modal.ts:169-178 mappe l erreur brute sur trois messages humains actionnables (`Acces refuse — ferme tout programme utilisant ce disque et reessaie.`), et rekordbox-view.ts:719-725 ne laisse passer le texte backend que lorsqu il est deja humain. C est le finding F2 (MAJEUR) de l audit heuristique du 2026-07-18 (`jargon 'os error 2' non humanise`), corrige a la source pour le seul chemin decode.rs. docs/design-system/content.md:5-14 pose la regle: `sobre, precis, utile ... jamais cryptique`.
- Impact : UX
- Effort : M
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/filing-actions.ts`, `frontend/library-detail.ts`, `frontend/sift-live.ts`, `frontend/updater.ts`, `frontend/filing-identify.ts`
- Correctif esquisse : Extraire un humanizeError(raw) partage (dom.ts ou module dedie) sur le modele usb-format-modal.ts:169-178, table motif -> message actionnable + repli generique nomme; router les 9 sites dessus, String(e) restant en console.error. A brancher avec SYS-2: classer cote Rust (raw_os_error -> sentinelle) est le vrai correctif, humanizeError n est que la surface.

### [SYS-8] Etat mutable exporte sans mutateurs: RevueState et bibState portent 42 et 24 sites d ecriture repartis dans 3 modules, avec des listes de reset tenues a la main
- Passe : ralph
- Emplacement : `frontend/filing-state.ts:54`
- Preuve : filing-state.ts:54-68 exporte `const state: RevueState` — 13 champs publics, zero fonction d acces. Comptage par grep sur frontend/: 29 affectations `state.X =` dans filing.ts, 9 dans filing-identify.ts, 4 dans filing-actions.ts. Symptome concret: clearPane (filing.ts:238-250) est une deuxieme copie manuelle de la liste des champs, qui en remet 12 a zero et en oublie 1 — state.rail n y figure pas et conserve donc le rail de la piste precedente (non exploitable aujourd hui parce que refreshPreview sort tot sur !state.canonical, filing-preview.ts:95, mais c est un accident, pas une garantie). Ajouter un champ = 2 edits obligatoires non verifies par le compilateur. Trois champs sont en outre en ecriture seule: state.filedConfirm (6 sites d ecriture, aucune lecture — la banniere est en fait retrouvee par le DOM, filing-actions.ts:258, donc sa doc decrit un mecanisme disparu), state.releaseCountry et state.releaseFormat (4 sites, jamais lus — le rendu se fait depuis le candidat brut, identify-shared.ts:19). Meme forme sur bibState (CA-7), ou l invariant `folder/genre/artist mutuellement exclusifs` n existe qu a sift-live.ts:404-406, jamais dans le module qui detient les champs. Vu par SDP-6, SDP-9, CA-7.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/filing-state.ts`, `frontend/filing.ts`, `frontend/filing-identify.ts`, `frontend/filing-actions.ts`, `frontend/bibliotheque-view.ts`, `frontend/sift-live.ts`
- Correctif esquisse : Rendre state prive au module et exposer une interface etroite (openTrack, applyIdentity, clear, getters); clear() reconstruit `{...INITIAL}` au lieu d enumerer les champs, ce qui supprime la liste dupliquee. Meme geste pour bibState: exporter pickFacet/setQuality/resetFilters — sift-live.ts garde le dispatch de clic (choix documente CLAUDE.md:170) mais appelle des fonctions au lieu d ecrire dans l etat d autrui. Supprimer au passage les 3 champs morts et leurs 10 affectations.

### [SIMP-6] library-detail.ts reimplemente toast() a l identique, et force une machinerie defensive dans le module partage
- Passe : ralph
- Emplacement : `frontend/library-detail.ts:33`
- Preuve : library-detail.ts:33-51 definit une fonction privee toast(message, undo?, onUndo?) qui cree #sift-toast — meme id, meme classe, memes attributs role/aria-live, meme delai de 6000 ms — que la fonction partagee filing-toast.ts:28-106, importee par 8 fichiers. Le doublon n est pas gratuit: filing-toast.ts:29-35 porte un marqueur `dataset.owner === "filing-toast"` et 5 lignes de commentaire dont la seule raison d etre est cette collision (`library-detail.ts:33 builds the same #sift-toast with its own 6s timer whose id is never stored`). ARBITRAGE avec SDP-7 (qui veut retirer le parametre `undo` de toast pour remonter la politique d annulation chez l appelant, ce qui supprimerait registerClearPaneHook): les deux gestes sont compatibles mais l ordre compte — supprimer le doublon d abord (aucun de ses 8 sites d appel n utilise le cas `undo=true sans callback`, seul cas ou les deux implementations divergent), le degraissage de la signature ensuite.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/library-detail.ts`, `frontend/filing-toast.ts`
- Correctif esquisse : 1) Supprimer library-detail.ts:33-51, `import { toast } from "./filing-toast"`. 2) Retirer le garde dataset.owner de filing-toast.ts:29-35 et ses commentaires devenus faux. 3) Optionnel (SDP-7): retirer le parametre undo, remonter la politique LIFO chez filing-actions.ts, ce qui supprime registerClearPaneHook et l import de ipc dans le module toast.

### [SIMP-8] verdictCardHtml() est une fonction morte conservee en no-op dont la vraie semantique — vider un conteneur — est cachee
- Passe : ralph
- Emplacement : `frontend/report-view.ts:552`
- Preuve : report-view.ts:552-554 `export function verdictCardHtml(_r: AnalysisReport): string { return ""; }`, precedee de 10 a 18 lignes de doc perimee qui assument le choix (`kept as a no-op (not deleted outright) so those call sites don't need touching`). 4 sites d appel ecrivent la chaine vide: report-view.ts:1106, 1192, 1215, 1261. ARBITRAGE — CC-13 recommande de supprimer et remplacer par innerHTML="", SIMP-8 signale le piege: le spinner `Analyse en cours…` pose en report-view.ts:1205 n est efface QUE par l affectation de la ligne 1215; un nettoyage qui supprime `la fonction morte` et ses appels laisse le spinner a l ecran indefiniment. Je retiens SIMP-8 (meme geste, avec la contrainte). Cout deja paye: filing.ts:485-488 et 508-511 portent DEUX fois le meme commentaire de 4 lignes expliquant que .sift-vchips n a jamais existe parce que verdictCardHtml rend "" — quelqu un a du enqueter sur du code mort a cause de cette fonction.
- Impact : maintenabilite
- Effort : S
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/report-view.ts`, `frontend/filing.ts`
- Correctif esquisse : Remplacer les 4 appels par `= ""` explicite (et retirer `+ verdictCardHtml(r)` en 1261), supprimer la fonction et sa doc perimee, renommer le parametre optionnel des deux signatures publiques en verdictHostToClear pour que l intention `vider` soit lisible au site d appel.

### [SIMP-5] Bloc CSS mort: 34 classes .jrnl-insp-*/.jrnl-q* d un ecran Journal 3 colonnes jamais construit
- Passe : ralph
- Emplacement : `frontend/styles.css:1424`
- Preuve : Balayage des 436 classes de styles.css (commentaires strippes) contre 42 fichiers .ts/.js + index.html + .storybook/. Les 34 classes du bloc styles.css:1424-1467 (entete `Journal — grammaire 3 colonnes (Sift.dc.html)`) ne sont nommees dans AUCUN fichier de code. journal.ts utilise bien 23 classes jrnl-* mais d une autre famille (jrnl-row, jrnl-cat, jrnl-hd, jrnl-session-group, jrnl-toast) — aucune intersection. Autres orphelines confirmees a 0 fichier de code: .home-right, .nv-export-dot, .nv-grp, .qdrag, .sift-tags-box, .sift-tags-title, .sift-ui-kicker, .sift-vchips-row (residu de la dette .sift-vchips, cf. SIMP-8).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/styles.css`
- Correctif esquisse : Supprimer styles.css:1424-1467 en bloc plus les 8 regles orphelines isolees. Verification: npm run lint:tokens puis une capture de l ecran Journal (le seul concerne, et il n utilise aucune de ces classes).

### [SIMP-7] Table SQLite custom_tags creee en v1 et jamais lue ni ecrite
- Passe : ralph
- Emplacement : `src-tauri/src/db.rs:50`
- Preuve : db.rs:50-54 cree `CREATE TABLE custom_tags (track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (track_id, tag))` dans la migration v1. Un grep repo-wide sur les fichiers suivis donne 4 resultats: la creation, plus 3 mentions dans les documents de specification d origine. Aucun SELECT/INSERT/DELETE, aucune reference frontend. A comparer aux 9 autres tables de db.rs, toutes requetees (track_genres compte 24 references).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/db.rs`
- Correctif esquisse : Ne PAS toucher a l entree v1 (db.rs:41 interdit d editer une migration livree). Soit ajouter une migration finale `DROP TABLE IF EXISTS custom_tags;`, soit acter en commentaire qu elle est reservee a une feature future — mais trancher, pas laisser.

### [SIMP-12] Le reglage filename_template n est expose par aucune UI — le moteur de template ne rendra jamais qu une valeur
- Passe : ralph
- Emplacement : `src-tauri/src/settings.rs:10`
- Preuve : settings.rs:10 declare `FILENAME_TEMPLATE`. Hors bench_volume.rs (test-only) et settings.rs, un seul usage: ipc_filing.rs:52-59 `fn template(conn)` = get_or(FILENAME_TEMPLATE, DEFAULT_TEMPLATE). Cote frontend, le balayage de tous les getSetting/setSetting des 42 fichiers TS ne remonte que 3 cles (library_root, discogs_token, ui_theme); `grep filename_template -- frontend shared` = 0. La valeur passee a naming::render_filename est donc toujours DEFAULT_TEMPLATE. Seule mention UI: une ligne figee de la maquette app.js:367, dans un bloc garde hors Tauri.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/settings.rs`, `src-tauri/src/ipc_filing.rs`, `src-tauri/src/naming.rs`
- Correctif esquisse : Question a poser avant tout code: le modele de nommage configurable est-il au perimetre V1 ? Si oui c est une feature a moitie cablee a finir cote Reglages; si non, inliner DEFAULT_TEMPLATE et supprimer la cle + ipc_filing.rs:52-59.

### [SJ-6] Aucun garde sur les echelles typo, motion et bordure: 39 tailles de police litterales (dont 10 hors echelle), 9 durees, 4 largeurs de bordure
- Passe : ralph
- Emplacement : `frontend/styles.css:77`
- Preuve : styles.css:77 declare l intention sans ambiguite (`Type scale (audit P-1): the allowed font sizes. ... Use these, not literals.`) pour 9 tokens --text-*. Comptage sur les 42 fichiers frontend: 39 occurrences de `font-size:<N>px` litteral — 29 recopient la valeur exacte d un token existant, 10 inventent une taille absente de l echelle (12.5, 15, 17, 18x2, 20x3, 22, 28). Meme motif sur la motion: styles.css:113 declare --duration-fast/base le 2026-07-27 en affirmant qu ils `match values already recurring in the transitions further down`, mais `var(--duration` n a que 2 consommateurs (styles.css:1239 et 1241, tous deux dans prefers-reduced-motion) alors que les declarations transition litterales comptent 9 durees distinctes sur 39 sites (.16s x10, .15s x10, .12s x9...). Et aucun token de largeur de bordure n existe: 0.5px x62, 1px x11, 1.5px x3, 2px x4 decides site par site. Cause commune: SPACING_PROP_RE (lint-tokens.mjs:108) ne couvre que padding|margin|width|height|gap — ni font-size, ni border-radius, ni border-width, ni duree, ni top/left/right/bottom (132 litteraux px sur ces derniers). Vu par SJ-6, SJ-7, SJ-10; meme cause racine que SYS-4.
- Impact : maintenabilite
- Effort : M
- Risque du fix : faible
- Note : **C**
- Fichiers : `scripts/lint-tokens.mjs`, `frontend/styles.css`
- Correctif esquisse : Etendre le linter d une categorie font-size (memes tokens --text-*, meme mode ratchet) et enregistrer la baseline; traiter d abord les 10 valeurs hors echelle, qui sont une decision de design non tranchee, avant les 29 recopies mecaniques. Ensuite seulement: trancher l echelle de durees reelle (~3 paliers) et declarer 2-3 largeurs de bordure nommees.

### [CC-14] `reconcile` designe deux operations sans rapport dans le meme crate
- Passe : ralph
- Emplacement : `src-tauri/src/scanner.rs:133`
- Preuve : Concept A, deriver une identite canonique artiste/titre depuis les tags et le nom de fichier: naming::reconcile (naming.rs:95), filing::reconcile_track (filing.rs:143), filing::reconcile_path (filing.rs:151), ipc_filing::reconcile (ipc_filing.rs:64). Concept B, synchroniser la base avec ce qui est sur le disque: scanner::reconcile_with_progress (scanner.rs:133), tests reconcile_adds_updates_and_removes (238) et reconcile_drops_pending_files_that_vanished (308). Rien dans le nom ne distingue `reconcilier des metadonnees` de `reconcilier un arbre de fichiers avec la DB`.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/scanner.rs`
- Correctif esquisse : Renommer le concept B, le moins nombreux: scanner::sync_source_with_progress / resync_source, et ses tests. Le concept A garde reconcile, sens dominant du vocabulaire projet.

### [CC-12] Copie presse-papier: catch vide et confirmation `Copie` affichee inconditionnellement
- Passe : ralph
- Emplacement : `frontend/sift-live.ts:249`
- Preuve : sift-live.ts:249-254: `void navigator.clipboard.writeText(ec.dataset.q || "").catch(() => {}); const prev = ec.innerHTML; ec.innerHTML = '<i class="ti ti-check"></i> Copié'; setTimeout(...)`. Le catch est vide et le repeint est hors de la promesse. C est le seul catch strictement vide non justifie du frontend: les 2 autres (report-view.ts:714, :717) sont documentes comme prefetch best-effort (`Failures are silent by design: a prefetch must never surface UI errors`).
- Impact : UX
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `frontend/sift-live.ts`
- Correctif esquisse : Deplacer le repeint dans le .then() et remplacer le catch vide par un console.error + feedback d echec (`Copie impossible`).

### [SDP-11] openFilingInto est une decomposition temporelle de 240 lignes qui porte au passage la politique de recuperation fichier-disparu
- Passe : ralph
- Emplacement : `frontend/filing.ts:281`
- Preuve : filing.ts:281-519 enchaine dans une seule fonction: garde de sequence (290), amorcage de 8 champs d etat (291-303), squelette DOM (305-320), controle de doublon (324-332), 4 lectures IPC paralleles avec readError agrege (339-374), puis 376-420 un bloc de 45 lignes qui est une POLITIQUE a part entiere — chaine de recuperation fichier-disparu avec son ensemble goneVisited d anti-boucle, un re-listQueue filtre, une recursion sur elle-meme (403) et quatre issues distinctes — puis arbitrage identite persistee vs reconcile (427-438), derivation du rail (463-468, cf. SDP-1), 6 appels de rendu (470-481), deux insertions de pastilles differees (482-518). Decoupage par ordre d execution, pas par responsabilite: chaque evolution du parcours d ouverture traverse toute la fonction.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **C**
- Fichiers : `frontend/filing.ts`
- Correctif esquisse : Extraire advancePastGoneTrack(mid, item, goneVisited) (376-420) et resolveCanonical(release, canonical) (427-438); openFilingInto ne garde que amorcage -> lectures -> rendu. Le premier extrait est aussi le consommateur de la sentinelle FILE_GONE de SYS-2.

### [CC-10] ipc_identify.rs n a aucun test alors que build_query est le point de composition neuf du chantier Discogs
- Passe : ralph
- Emplacement : `src-tauri/src/ipc_identify.rs:51`
- Preuve : Le fichier fait 124 lignes et ne contient aucun #[cfg(test)] (balayage des 50 fichiers .rs: seuls ipc.rs, ipc_identify.rs, ipc_usb.rs et main.rs sont dans ce cas). build_query (51-85) est pourtant une fonction PURE portant une regle d arbitrage neuve: `let tags_clean = naming::is_clean(...)` puis `let (artist, title) = if tags_clean { tags } else { (terms.artist, terms.title) }` (65-71), et une construction d attempts qui prefixe conditionnellement la requete issue des tags (73-77) tandis que version vient TOUJOURS de search_terms (82). Contraste mesurable dans le meme chantier: search_terms.rs a 11 tests et search_corpus.rs fige 77 cas reels avec quatre constantes de plancher. Toute la rigueur porte sur le producteur; le point ou ses sorties sont melangees aux tags n a rien.
- Impact : correctness
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `src-tauri/src/ipc_identify.rs`
- Correctif esquisse : Ajouter un #[cfg(test)] mod tests couvrant build_query sur 4 cas: tags propres (les tags gagnent, la cascade suit), tags sales (search_terms gagne), tags propres mais version presente seulement dans le nom, stem/folder vides. Fonction pure, aucun runtime Tauri requis.

### [D-1] Residus mesures et sans consequence: code mort, exports superflus, doc-comment deplace
- Passe : ralph
- Emplacement : `src-tauri/src/worker.rs:224`
- Preuve : Quatre items verifies par grep, aucun impact fonctionnel. (a) worker.rs:224/237 — le champ Queue.running est incremente et decremente, jamais lu (2 occurrences de `.running`, toutes deux des ecritures) [CR-12]. (b) home-sources.ts:268 pickAndAddFolder et report-view.ts:1099 renderReportInto sont exportes mais n ont qu un appelant, dans leur propre fichier — noUnusedLocals etant deja actif, retirer le mot-cle export suffit a le prouver [SIMP-15]. (c) analysis/mod.rs:149-172 duplique la liste des 7 accumulateurs dans les branches mono et stereo, donc ajouter un analyseur coute 4 edits non verifies par le compilateur [SDP-12]. (d) discogs.rs:328-333 porte le doc-comment de probe_and_score colle en tete du bloc de doc de attempts_for, et discogs.rs:377-383 logue le rate-limit mais avale reseau/timeout/parsing sur `Err(_) => {}` [CC-15]. (e) main.ts:37-42 charge le self-test (et wavesurfer) sans garde import.meta.env.DEV, alors que dev-inspector juste en dessous est correctement gate ligne 45 — le chunk part dans le bundle de production et la globale est exposee [CA-12].
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `src-tauri/src/worker.rs`, `frontend/home-sources.ts`, `frontend/report-view.ts`, `src-tauri/src/analysis/mod.rs`, `src-tauri/src/metadata/discogs.rs`, `frontend/main.ts`
- Correctif esquisse : Cinq edits independants de moins de 5 lignes chacun. Le seul avec un vrai gain: deplacer main.ts:37-42 dans le `if (import.meta.env.DEV)` de la ligne 45, ce qui sort selftest + wavesurfer du bundle expedie.

### [CA-11] La couture entre app.js et la couche live est un jeu de 7 globales window optionnelles et non typees
- Passe : ralph
- Emplacement : `frontend/sift-live.ts:167`
- Preuve : sift-live.ts:167-173 pose 7 globales (__siftHome, __siftQueue, __siftEcarts, __siftReglages, __siftBiblio, __siftJournal, __siftRkb), toutes declarees optionnelles en sift-live.ts:533-543. app.js les appelle avec une garde de presence (lignes 108, 147, 252, 300, 312, 354, 372). Sous Tauri le rendu maquette est saute (app.js:258), donc l ecran ne recoit AUCUN contenu si une globale manque. CONTRAINTE: le correctif propose (objet unique type, echec bruyant) exige d editer app.js, alors que CLAUDE.md:26-27 pose `Aucune modification prevue dessus pour autant, juste ne pas supposer qu il est inerte en prod` — le finding reste valable mais son fix est subordonne a une decision d Antoine sur le statut d app.js (cf. REJETE SIMP-2). Je le degrade en D pour cette raison.
- Impact : maintenabilite
- Effort : M
- Risque du fix : moyen
- Note : **D**
- Fichiers : `frontend/sift-live.ts`, `frontend/app.js`, `frontend/main.ts`
- Correctif esquisse : A ne faire QUE si le gel d app.js est leve: remplacer les 7 globales par un objet unique enregistre une fois (window.__sift = { home, queue, ... }) type par une interface non optionnelle, et faire echouer bruyamment app.js sous Tauri quand une entree manque — meme philosophie que dom.ts:14-24 requireEl.

### [SIMP-14] scripts/rekordbox-spike-helper.ps1: 158 lignes touchant le dossier Pioneer reel, referencees nulle part et absentes de l inventaire
- Passe : ralph
- Emplacement : `scripts/rekordbox-spike-helper.ps1:1`
- Preuve : Un grep `spike-helper|rekordbox-spike` sur tout le repo ne remonte que 5 lignes, toutes DANS le fichier (ses propres exemples d usage et son fichier d etat). Balayage compare des 8 entrees de scripts/: toutes les autres ont au moins une reference entrante (cargo-isolated.sh et lint-tokens.mjs -> CLAUDE.md, fetch-ffmpeg.mjs -> package.json, make-fixtures.mjs -> tests/characterization.rs, make-rekordbox-fixture.py -> rekordbox_masterdb.rs, decrypt-masterdb-debug.py -> CLAUDE.md) — celui-ci est le seul a zero. CLAUDE.md § Outils de dev annexes ne le liste pas. Son en-tete le rattache aux spikes M8, or M8 est declare fait.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `scripts/rekordbox-spike-helper.ps1`, `CLAUDE.md`
- Correctif esquisse : Choix binaire a poser, pas a trancher seul: l ajouter a CLAUDE.md § Outils de dev annexes (c est un filet de securite pour tout futur spike master.db, la surface la plus risquee du projet), ou le supprimer. L etat actuel — outil destructif, non documente, non reference — est le seul a exclure.

### [PP-14] Les 8 constantes cryptographiques SQLCipher de master.db sont recopiees a l identique en Python, sans lien ni test
- Passe : ralph
- Emplacement : `scripts/decrypt-masterdb-debug.py:36`
- Preuve : rekordbox_masterdb.rs:81-92 declare PAGE_SIZE, RESERVE, KDF_ITER, HMAC_KDF_ITER, HMAC_SALT_XOR, SALT_LEN, puis 116-118 BLOB et BLOB_KEY. decrypt-masterdb-debug.py:36-46 les repete toutes, valeur pour valeur, en s annoncant comme `Pure-Python port of decrypt_masterdb()/deobfuscate_key()`. Rien ne relie les deux: le Rust a un const assert d alignement AES et un test de non-regression sur la cle derivee, le Python n a aucun test. RESERVE a deja bouge une fois cote Rust (0 -> 80).
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **C**
- Fichiers : `scripts/decrypt-masterdb-debug.py`, `src-tauri/src/rekordbox_masterdb.rs`
- Correctif esquisse : Ajouter au script une assertion qui lit rekordbox_masterdb.rs et compare les 8 valeurs avant de dechiffrer (echec bruyant plutot que sortie fausse). C est l outil qu on sort pour arbitrer `est-ce le lecteur Rust qui se trompe ?` — s il ment, l enqueteur compare deux resultats faux sur la zone la plus dangereuse du projet.

### [REJ-1] REJETE — app.js: CLAUDE.md:26-27 pose explicitement `Aucune modification prevue dessus`, le finding recommande d en supprimer 69%
- Passe : ralph
- Emplacement : `frontend/app.js:1`
- Preuve : SIMP-2 mesure correctement que 292 des 424 lignes d app.js sont inatteignables sous Tauri (gardes `if(!('__TAURI_INTERNALS__' in window))` aux lignes 72, 128, 247, 259, 318, 366, 416, plus 3 fonctions inatteignables par masquage CSS chrome.ts:139 ou interception en phase de capture sift-live.ts:191-206) et recommande de les supprimer. VERIFIE dans CLAUDE.md:22-27: `app.js reste un artefact d exploration fige, mais s execute reellement dans Tauri, importe sans garde inTauri par main.ts:6 [...] Aucune modification prevue dessus pour autant, juste ne pas supposer qu il est inerte en prod`. Le projet a deja tranche: le fichier est gele, l information a retenir est qu il n est pas inerte — pas qu il faut l elaguer. Le residu defendable (54 Ko de maquette dans le bundle expedie) est un D, pas un L de refactor.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `frontend/app.js`, `CLAUDE.md`
- Correctif esquisse : Ne rien faire sans decision d Antoine sur le statut d app.js et de la demo web Vercel (README.md:124-129 dit que le deploiement d origine ne fonctionne plus tel quel). Si le gel est leve, le geste minimal et sans risque est de charger la maquette en import dynamique hors Tauri pour la sortir du bundle desktop — pas de la supprimer.

### [REJ-2] REJETE — sweep d espacement: la premisse est fausse, --space-24 et --space-32 existent bien
- Passe : ralph
- Emplacement : `.interface-design/system.md:99`
- Preuve : PP-9 affirme que le chantier docs/superpowers/changes/2026-07-19-spacing-scale-sweep/ reposerait sur une echelle retractee, en citant .interface-design/system.md:97-104: `styles.css ne declare aujourd hui que --space-4/8/12/16 [...] Ne pas assumer que 24/32 existent comme tokens sans grep --space dans styles.css au prealable`. J AI FAIT LE GREP: styles.css:81 declare `--space-4:4px;--space-8:8px;--space-12:12px;--space-16:16px;--space-24:24px;--space-32:32px;` — les six paliers existent. C est la retractation qui est perimee, pas le chantier. Le finding est rejete sur son mecanisme (le sweep ne generera pas de tokens inventes), mais le fait qu il ait ete produit EST la preuve du probleme reel: .interface-design/system.md est declare perime par CLAUDE.md et reste cite comme autorite — il a induit une passe d audit en erreur en une seule lecture. Reporte a ce titre dans SYS-5.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `.interface-design/system.md`, `docs/superpowers/changes/2026-07-19-spacing-scale-sweep/design.md`, `frontend/styles.css`
- Correctif esquisse : Archiver .interface-design/system.md hors du path de scan plutot que de le maintenir sous avertissements — un doc qui previent qu il ment continue de mentir. Le chantier de sweep, lui, peut etre repris sur la seule source canonique (bloc :root de styles.css).

### [REJ-3] REJETE — bibState mute depuis sift-live.ts: la centralisation du dispatch est un choix documente dans CLAUDE.md
- Passe : ralph
- Emplacement : `frontend/bibliotheque-view.ts:28`
- Preuve : CA-7 reproche que 23 des 24 mutations de bibState vivent dans sift-live.ts plutot que dans le module proprietaire. VERIFIE dans CLAUDE.md:169-172: `bibliotheque-view.ts [...] etat bibState/bibDup exportes, mutes aussi depuis le handler de clic delegue de sift-live.ts (dispatch reste centralise, comme ecartes-view.ts)`. L emplacement du dispatch est une decision prise et ecrite; la rejouer est du bruit. Ce qui SURVIT et n est pas couvert par la decision: l invariant `folder/genre/artist mutuellement exclusifs` n existe qu a sift-live.ts:404-406 et le reset `Tous` (sift-live.ts:303-308) enumere 6 champs en dur — ajouter une 4e facette demande deux edits dans un fichier tiers, sans erreur tsc en cas d oubli. Ce residu est porte par SYS-8, dont le correctif (des mutateurs exportes appeles PAR le dispatch central) respecte la decision documentee.
- Impact : maintenabilite
- Effort : S
- Risque du fix : faible
- Note : **D**
- Fichiers : `frontend/bibliotheque-view.ts`, `frontend/sift-live.ts`, `CLAUDE.md`
- Correctif esquisse : Rien a faire sur l emplacement du dispatch. Traiter le seul residu via SYS-8: exporter pickFacet/setQuality/resetFilters depuis bibliotheque-view.ts, que sift-live.ts appelle depuis son handler central.
