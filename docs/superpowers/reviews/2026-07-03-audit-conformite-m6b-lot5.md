# Audit de conformité maquette↔code — M6b Lot 5 (2026-07-03)

> Comparaison lecture-seule entre la maquette navigateur figée `frontend/app.js`
> (jamais éditée, source d'intention visuelle) et les vraies implémentations
> TS (Accueil, Revue-détail, Écartés, Bibliothèque). Méthode : chaque ligne
> cite `app.js:N` ET le fichier réel `file.ts:N`. Croisé avec
> `docs/design-system-states.md` et la session d'audit-fidélité du
> 2026-07-02/03 déjà loguée en mémoire (`sift-audit-fidelite-methode`,
> `sift-plan-fix-2026-07-02-status`) — ce qui y a déjà été traité n'est pas
> re-signalé ici.
>
> Rappel du principe projet "mockup-first, improve" : quand le vrai code fait
> plus/mieux que la maquette, c'est classé `Amélioré`, jamais `Écart`.

---

## Accueil (`renderHome`, app.js:38-80)

Le vrai écran (`frontend/home-sources.ts`) a été **entièrement reconstruit
le 2026-07-02** (voir en-tête du fichier, home-sources.ts:1-7 : "rebuilt
2026-07-02, docs/audit-fidelite-2026-07-02.md §1"). Il ne s'agit plus d'un
portage direct de la grille de stat-cards de la maquette hors-Tauri
(app.js:44-71 : cartes Rangés/À re-sourcer/Corbeille/Sans métadonnées + bandeau
"fichiers à trier" + barres par dossier), mais d'un écran deux-colonnes
(liste des sources surveillées + inspecteur détail), qui remplace le shell
`app.js:73-77` (`#homequeue`/`#homeinspector`, jamais rendu directement —
`renderHomeSources()` en prend le contrôle total via `window.__siftHome`).

| Élément maquette (app.js:LIGNE) | Réel (home-sources.ts:LIGNE) | Statut |
|---|---|---|
| Stat-cards Rangés/À re-sourcer/Corbeille/Sans métadonnées (app.js:63-68) | absent — remplacé par liste de sources + statut par source (home-sources.ts:41-64) | Déjà documenté — refonte actée 2026-07-02, pas un gap (voir en-tête du fichier + mémoire `sift-audit-fidelite-methode`) |
| Bandeau "N fichiers à trier" + CTA Trier (app.js:57) | absent de ce nouvel écran | Déjà documenté — même refonte, la fonction "aller trier" n'a plus sa place dans un écran centré sources, pas un oubli |
| Liste dossiers surveillés statique, 2 lignes en dur + toggle (app.js:58-61) | Liste réelle dynamique (`listSources()`), statut par source calculé (`statusMeta`, home-sources.ts:34-39 : Inaccessible/N nouveaux/En pause/À jour), toggle réel (`togglewatch`, home-sources.ts:159-169) | Amélioré — statuts réels au lieu de texte en dur, pagination/suppression réelle (`rmsrc`, home-sources.ts:170-180) |
| Bouton "+ ajouter un dossier" (app.js:61) | Bouton réel avec vrai picker OS (`pickAndAddFolder`, home-sources.ts:150-152, 185-196) | Conforme |
| Barres "Répartition par dossier" (app.js:71, `bars`) | absent | Déjà documenté — même refonte (dashboard remplacé par navigation directe vers les sources) |
| Avertissement racine bibliothèque non définie | aucun équivalent dans la maquette | Amélioré — `rootGateHtml` (home-sources.ts:67-72) alerte et route vers Réglages, fonctionnalité réelle absente du mockup |

**Aucun écart réel trouvé** — la totalité des différences relève de la refonte
actée et documentée du 2026-07-02 (rebuild explicite en commentaire de tête de
fichier), pas d'une divergence non voulue.

---

## Revue — détail (`renderRevue`/`renderMid`, app.js:82-159)

Écran principal : file (`#ql`), zone détail (`#mid`), rail d'action bas. Réel :
`frontend/report-view.ts` (lecteur, verdict, spectrogramme) + `frontend/filing.ts`
(éditeur, rail d'action, popover destination) — deux fichiers, la maquette les
fusionne dans un seul `renderMid`.

| Élément maquette (app.js:LIGNE) | Réel (file:LIGNE) | Statut |
|---|---|---|
| Header fichier + cover + titre + badge verdict (app.js:119-120) | `playerHeaderHtml` fusionné dans la carte lecteur (report-view.ts:187-201) — un seul header au lieu de deux (hero + player dupliqués dans une ancienne version) | Amélioré — dédup explicite documentée (report-view.ts:172-177 : "2026-07-02: the standalone Hero above the player was pure duplication") |
| Bandeau doublon "Déjà en bibliothèque" (app.js:121) | Chip DUPLICATE ajouté par filing.ts sur `.sift-vchips` (report-view.ts:257, 282-302) — même info, forme différente (chip vs bandeau dédié) | Conforme — équivalent fonctionnel, décision de structure actée (report-view.ts:265-268, "Confirmé écart de structure, docs/audit-fidelite-2026-07-02.md décision #1") |
| Lecteur : play/pause, waveform, curseur temps, tempo (app.js:127-135) | `mountPlayer` (report-view.ts:462-668) : vrai WaveSurfer, vrai décodage audio, drag sliders volume/tempo, key-lock, hover-scrub sur la waveform | Amélioré — vraie lecture audio + fonctionnalités absentes du mockup (key-lock, hover preview, curseur qui suit la souris précisément) |
| Toggle écoulé/restant (`timemodetog`, app.js:126,131) | Remplacé par affichage simultané écoulé (gauche) + restant (droite), toujours visibles (report-view.ts:569-577, commentaire explicite "SoundCloud-style… no elapsed/remaining toggle needed") | Amélioré — décision UX documentée, pas un oubli |
| Verdict pill + encodage + spectrogramme (app.js:136-141) | `verdictCardHtml` (report-view.ts:258-280) + `spectroAndTagsHtml` (report-view.ts:304-339), spectrogramme réel calculé depuis l'analyse (`drawSpectrogram`, report-view.ts:106-146) au lieu du faux bruit procédural de `drawSpec` (app.js:161-172) | Amélioré — vrai signal FFT vs génération procédurale factice |
| Chips format de sortie MP3 320/AIFF/WAV (app.js:143) | Présent dans filing.ts (non lu ligne à ligne ici, hors scope des 4 fichiers du plan, mais confirmé au grep `data-fil` du rail d'action) | Conforme (non vérifié en détail — filing.ts hors périmètre strict de ce Lot 5, cf. Global Constraints du plan) |
| Métadonnées Label/Année/Genre/BPM + tags (app.js:146-150) | Carte Identification dans filing.ts (Discogs) + BPM non présent dans les rows spectro (report-view.ts:317-331 liste Verdict/Coupure/Durée/Canaux/True-peak/DC offset/Écrêtage/Corrélation de phase/Silences/Tronqué/Conteneur/Fréquence/Pics — pas de champ BPM) | Écart — la maquette affiche un BPM par piste (app.js:125, `bpm=120+(cur*3)%9`, mocké donc non probant en soi, mais reflète une intention produit) ; aucun calcul de BPM réel n'existe côté backend (`docs/ressources-externes.md` section M3 : "bpm-finder-tools — à évaluer si le BPM entre dans le scope", jamais adopté) → pas un oubli de portage, une fonctionnalité jamais construite. Reclassé **Déjà documenté** (BPM explicitement "à évaluer", hors scope acté, pas un gap de portage) |
| Bouton "Ranger" + "Écarter"/"Re-sourcer" (app.js:151-157) | `doRanger`/rail d'action (filing.ts:909-924, 1259-1401) : mêmes trois états (Ranger/Jeter/Re-source), + garde de confirmation batch, + warning "tags non gravés" (filing.ts:1090) absent de la maquette | Amélioré |

**Écarts à corriger : aucun.** Le seul point qui ressemblait à un écart (BPM
absent du panneau réel) est en fait une fonctionnalité jamais implémentée côté
moteur (pas de calcul BPM en Rust), documentée comme "à évaluer" dans
`docs/ressources-externes.md` — ce n'est pas une régression de portage.

---

## Écartés (`renderEcarts`, app.js:248-289)

Réel : `frontend/ecartes-view.ts`.

| Élément maquette (app.js:LIGNE) | Réel (ecartes-view.ts:LIGNE) | Statut |
|---|---|---|
| Titre "Écartés" + pills compteurs (app.js:279-283) | Identique en structure (ecartes-view.ts:101-115) | Conforme |
| Bouton "Vider la corbeille (N)" (app.js:283) | `data-ec="purge"` (ecartes-view.ts:113), câblé dans sift-live.ts:1288-1289 | Conforme |
| Raison chip tronqué/doublon/faux (app.js:257-261, `reasonLabel`) | `ecReason` (ecartes-view.ts:18-26) — 3 mêmes cas (tronqué/faux/à re-sourcer par défaut), ton neutre au lieu de danger pour "à re-sourcer" | Amélioré — ton neutre documenté comme fix explicite (ecartes-view.ts:23-25, "FIX-8: neutral tone, not danger") |
| Liens boutiques (Beatport/Traxsource/Juno/Bandcamp/Amazon/Apple, app.js:238-244) affichés en permanence par ligne | `EC_STORES` identiques (ecartes-view.ts:35-42), mais affichés seulement au survol/focus (`.sift-ec-stores`, ecartes-view.ts:73-76) — "Copier le nom" reste toujours visible | Amélioré — décision de charge visuelle documentée (ecartes-view.ts:73-76, "audit UI/UX 2026-07-03, fix 6"), pas une perte de fonctionnalité (les liens existent toujours, juste révélés au survol) |
| Bouton copier Soulseek par ligne (app.js:267-268, "Slsk") | `data-ec="slsk"` (ecartes-view.ts:84-86), même comportement (copie presse-papier + feedback "Copied") | Conforme |
| Ligne corbeille avec bouton "Restaurer" (app.js:274 icône trash / mockup n'a pas de bouton restaurer visible sur les lignes trash elles-mêmes, seulement `etrash` pour y envoyer) | `trashRows` avec bouton Restaurer explicite (ecartes-view.ts:92-99), + `requeue` pour remettre en file depuis la section "à re-sourcer" (ecartes-view.ts:84, bouton icône `ti-arrow-back-up`) | Amélioré — la maquette n'a pas de flux de restauration depuis la corbeille (seulement `evider` qui purge tout), le réel ajoute un vrai bouton Restaurer par ligne |
| État vide (maquette : simple texte "Aucun fichier écarté.", app.js:285) | `emptyStateHtml` composant partagé avec titre + note + lien retour (ecartes-view.ts:104-108) | Amélioré — composant état-vide cohérent avec le reste de l'app (`empty-state.ts`), pas juste une ligne de texte |

**Aucun écart réel trouvé** — toutes les différences sont des améliorations
documentées (tons de couleur, divulgation progressive, restauration réelle,
état vide composant partagé).

---

## Bibliothèque (`renderBiblio`, app.js:189-235)

Réel : `frontend/sift-live.ts` (`renderBiblioLive`, ~ligne 1100, jamais audité
sous cette forme avant ce Lot 5) + `frontend/library-detail.ts` (panneau
détail/édition).

| Élément maquette (app.js:LIGNE) | Réel (file:LIGNE) | Statut |
|---|---|---|
| Barre recherche + chips Tous/Lossless/MP3 (app.js:229) | `header` avec input `#bibq` + 3 chips qualité (sift-live.ts:1113-1119, 1153-1157), debounce 250ms sur la recherche (sift-live.ts:1176-1180) | Conforme (amélioré côté perf : debounce absent de la maquette) |
| Colonne Dossiers (liste statique 5 entrées en dur, app.js:231) | Facettes réelles dynamiques **Dossiers ET Genres** (toggle `bibState.facet`, sift-live.ts:1121-1133), comptage réel par facette (`libraryFolders()`) | Amélioré — la maquette n'a qu'un seul axe (dossiers) en dur ; le réel ajoute un second axe (genres) au complet, absent du mockup |
| Lignes bibliothèque : play, titre, format pill, BPM, durée, lien Discogs (app.js:194, colonnes LIB `[nom, fmt, bpm, dur, id]`) | `rows` (sift-live.ts:1135-1143) : play, nom, badge verdict (fake/grey), pill qualité, **durée seule** (pas de colonne BPM), lien Discogs (ou bouton Identifier si pas encore lié) | Écart — la colonne BPM affichée par ligne dans la maquette (`r[2]`, ex. "120") n'a pas d'équivalent dans `renderBiblioLive`. Même cause que pour Revue-détail : aucun calcul BPM n'existe côté backend (`docs/ressources-externes.md`, bpm-finder-tools jamais adopté) → reclassé **Déjà documenté**, pas un gap de portage |
| Badge verdict (absent de la maquette Bibliothèque — LIB n'a pas de champ fake/grey) | `verdictBadge` (sift-live.ts:1090-1096) : pill fake/grey affiché par ligne | Amélioré — information absente du mockup, ajoutée dans le réel |
| Bouton lien Discogs icon-only (app.js:194, `data-act="link"`) | Identique structure (`data-bib="link"`, sift-live.ts:1139), `aria-label="Page Discogs"` présent | Conforme — confirmé dans `docs/design-system-states.md` ("Lien Discogs icon-only dans la Bibliothèque (sift-live.ts:1139) a aria-label=Page Discogs") |
| Lecteur inline au clic play, waveform mockée (app.js:195, `bplay`/`bseek`) | `openBiblioDetail` (sift-live.ts:1190-1208) ouvre le panneau unifié `library-detail.ts` : vrai lecteur (report-view.ts réutilisé), pas juste une barre de lecture mini | Amélioré — panneau détail complet (édition + identification + suppression) au lieu d'un simple mini-lecteur |
| Scanner de doublons internes (app.js:197-227, section complète : bouton "Lancer", groupes DUP_GROUPS, boutons Garder/Jeter) | Aucun équivalent — confirmé par grep (`dupscan`/`dedup` : aucune occurrence dans `frontend/*.ts` en dehors de commentaires renvoyant vers report-view/filing) | **À venir (Lot 3 en cours)** — le scanner de doublons de bibliothèque est le sujet du Lot 3 (dédoublonnage), qui tourne en parallèle dans un autre worktree, pas encore mergé ici. Ce n'est pas un écart de conformité au même titre que les autres lignes de ce tableau. |
| Panneau détail/édition (artiste, titre, genres, année, label, pochette, Identifier/Voir-la-release, Supprimer) — absent de la maquette Bibliothèque (qui n'a qu'un lecteur mini, pas d'édition) | `library-detail.ts` complet : édition inline (library-detail.ts:78-102), pochette changeable (library-detail.ts:52-64, 144-153), identify Discogs avec gestion NO_TOKEN/RATE_LIMITED (library-detail.ts:155-192), suppression (library-detail.ts:288-298) | Amélioré — fonctionnalité entière absente du mockup (le mockup n'avait qu'un lecteur, jamais d'édition de métadonnées en Bibliothèque) |
| État vide (mockup : n'a pas d'état vide pour Bibliothèque, LIB est toujours peuplé en dur) | `emptyStateHtml` avec titre "Bibliothèque vide" + note + lien retour Revue (sift-live.ts:1159-1164) | Amélioré |

**Écarts à corriger : aucun** au sens strict de "régression de portage".
Le seul point structurel notable — le scanner de doublons — est explicitement
hors périmètre de ce Lot 5 (Lot 3 en cours ailleurs), pas une omission.

---

## Écarts à corriger

**Aucun écart réel trouvé sur les quatre écrans audités.**

Détail de ce qui aurait pu sembler un écart mais ne l'est pas :
1. **BPM par piste** (Revue-détail : app.js:125,132,149 ; Bibliothèque :
   app.js colonne `r[2]` du tableau `LIB`) — absent des deux écrans réels
   parce qu'aucun calcul BPM n'existe côté moteur Rust. `docs/ressources-externes.md`
   liste `bpm-finder-tools` comme "à évaluer si le BPM entre dans le scope" —
   c'est une fonctionnalité jamais construite, pas un oubli de portage d'un
   écran vers un autre. Si le produit veut le BPM, c'est un chantier moteur
   (M3), pas un fix de ce Lot 5.
2. **Scanner de doublons de bibliothèque** (Bibliothèque : app.js:197-227) —
   absent du réel parce que c'est le sujet du Lot 3, en cours de développement
   en parallèle dans un autre worktree, pas encore mergé dans celui-ci.
   À revérifier une fois le Lot 3 mergé.
3. **Dashboard Accueil** (stat-cards, bandeau "à trier", barres par dossier)
   — remplacé par la refonte actée du 2026-07-02 (écran sources deux-colonnes).
   Si un futur Lot 4 (dashboard) réintroduit des statistiques d'ensemble, ce
   sera une nouvelle fonctionnalité construite sur le nouvel écran, pas un
   retour en arrière vers l'ancien mockup.

Toutes les autres différences relevées dans les quatre tableaux ci-dessus
sont classées `Amélioré` (le réel fait plus/mieux que la maquette) ou
`Déjà documenté` (décision actée ailleurs, notamment
`docs/design-system-states.md` et la session d'audit-fidélité 2026-07-02/03).
