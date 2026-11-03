# Spec — Rekordbox

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Utilitaire de disque** —
cible → action → progression → rapport.

Trois zones : rail · liste des candidats de la section choisie (flexe) · inspecteur du
candidat (`--pane-w`, repliable).

**Le changement structurel de cet écran.** Les quatre sections de synchronisation
(M8 Tier 1/2/3) sont aujourd'hui **quatre cartes empilées verticalement** dans une page
qui défile, chacune avec sa propre action. Quatre cibles et quatre actions dans un même
flux : rien ne dit laquelle on traite. Elles deviennent **quatre entrées de la zone
gauche**, plus une entrée « Tout ». La zone C montre les candidats de celle qui est
choisie. C'est le patron Utilitaire de disque appliqué tel quel : on choisit une cible
avant qu'une action soit disponible.

## Layout

### Zone B′ — sections

Cinq entrées, sélection exclusive, chacune avec son compte en attente :

| Entrée | Contenu |
|---|---|
| **Tout** | Les candidats des quatre sections, colonne Section en plus |
| **Fichiers** | Tier 1 — corrections de chemin détectées au rangement |
| **Playlists** | Tier 2 — doublons `djmdContent` |
| **Métadonnées** | Tier 3 — écarts de tags |
| **Pochettes** | Tier 3 — pochettes manquantes ou divergentes |

Une section dont l'appel IPC a échoué garde son entrée, avec un indicateur d'erreur.
Elle ne disparaît pas — une section absente se lit comme « rien à faire », ce qui est
un mensonge.

### Zone A — barre unifiée

Titre de la section active + compte en attente · **Synchroniser** (action principale,
dominante, portée sur la sélection ou sur toute la section) · recherche à droite.

Le bandeau explicatif du flux (« Sift convertit → l'export fusionne dans le XML lié →
réimporte-le ») descend en tête de zone C, et **seulement quand un XML est lié** : c'est
un rappel de procédure, pas un titre.

### Zone C — table des candidats

| Colonne | Largeur | Rendu |
|---|---|---|
| Case | fixe | Sélection pour la synchronisation |
| **Section** | fixe | Uniquement en mode « Tout » |
| **Piste** | flex 2 | Artiste — titre |
| **Écart** | flex 2 | Ce qui diffère : chemin actuel → chemin corrigé, ou tag avant → après |
| **État** | fixe | En attente · Synchronisé · Échec |

Hauteur `--row-h`. Les lignes remplacent les sept `.sift-ui-card-outline` de
`rekordbox-view.ts`, chacune rembourrée à la main en `padding:10px 12px` — un `10px`
qui n'appartient à aucune échelle (`DESIGN.md` § 5).

### Zone D — inspecteur

**Écartée le 2026-11-03** (Antoine) — voir § Décision 2026-11-03. Prévu : détail du
candidat (valeur actuelle dans Rekordbox, valeur proposée, source, action unitaire ; en
sélection multiple, compte par section et action de masse). La v4 du 2026-09-08 a borné la
zone C à `--measure-data` sans colonne d'inspecteur : un candidat se lit sur sa rangée, et
l'action unitaire passe par le clic droit.

## États

| État | Rendu |
|---|---|
| **Aucun XML lié** | `emptyStateHtml` en zone C — « Aucun XML Rekordbox lié », action « Lier un fichier XML ». Le rail et la barre restent |
| **Statut indisponible** | Carte d'erreur, bouton Réessayer. Aucune section n'est affichée comme vide |
| **`master.db` introuvable** | XML lié mais `masterdb_error` posé : les QUATRE sections portent le message qui nomme `master.db`, compte « — » dans B′, y compris celles dont l'appel a réussi (leurs listes lisent la base de Sift, pas `master.db`). Les rangées en attente d'avant la disparition restent **masquées** : inapplicables, elles se liraient comme du travail possible (décision d'Antoine, 2026-11-03, issue #84 — règle dans `rekordbox-section.ts`). Le XML illisible garde son propre rendu |
| **Section en erreur** | L'entrée du rail porte l'indicateur, la zone C porte la carte d'erreur et son motif. Le compte global **compte les sections tombées** — quatre cartes en erreur ne doivent jamais produire un en-tête « à jour » |
| **Rien en attente** | Section affichée, atténuée, libellée « à jour ». Elle ne disparaît pas |
| **Dérive détectée** | Bandeau `warning` persistant en tête de zone C : « Ferme Rekordbox, vérifie la piste, puis relie à nouveau le fichier XML. » Phrase entière, **jamais tronquée** |
| **Synchronisation en cours** | Sheet attachée à la fenêtre, barre déterminée, étape en texte, Annuler présent |
| **Rapport** | Résumé chiffré — synchronisés / échecs — avec accès au détail des échecs et une sortie claire |

## Interactions

### Souris

- **Clic** ligne : sélectionne, remplit l'inspecteur · **⇧+clic** plage ·
  **⌘/Ctrl+clic** ajout · case à cocher pour la sélection de synchronisation.
- **Clic droit** : Synchroniser cette entrée · Ignorer · Voir la piste dans
  Bibliothèque · Ouvrir l'emplacement.
- **Clic** en-tête de colonne : tri.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9. `Entrée` synchronise la sélection, après
confirmation. **Aucun raccourci à une lettre sur cet écran** : il écrit dans une base
tierce, un accélérateur à une touche y est un piège.

### Retour

La sheet de progression glisse depuis le haut de la fenêtre en `--duration-slow`.
Aucune animation sur l'arrivée ou la disparition d'un candidat.

## Sécurité — non négociable

Cet écran écrit dans un système **live** — la base d'un autre logiciel.

- Le backend refuse d'agir quand Rekordbox tourne
  (`MasterDbError::RekordboxRunning`) ; l'interface le dit avant l'action, pas après
  l'échec.
- Toute écriture en mode `master.db` est précédée d'un backup, et le backup est vérifié
  contre une référence propre **juste avant** l'écriture.
- Aucune écriture ne se déclenche sur la seule foi d'un rapport : l'état est relu
  indépendamment.
- La confirmation est in-app, armée et horodatée. Jamais `window.confirm()`.

## Décision — 2026-09-08 : lu contre Finder › appareil, Photos › Importer et Utilitaire de disque (déclinaison #24, cinquième écran)

Une première passe le même soir (`27a3ff6`) avait mis la cible en tête de zone C, la colonne B′ au
plan de la file et les sections en fiches sans cadre. Retour d'Antoine : « le texte semble posé au
hasard » — mesuré, la zone principale faisait 2332 px et les compléments (« à jour », « 1 »,
« Tout sélectionner ») étaient poussés à son bord droit, à 1900 px de leur titre — « et pourquoi on
ne peut pas tout synchroniser d'un coup ? ». Puis : « regarde la ref et comment Apple ferait »,
« d'autres pages peut-être ? ». Trois apps Apple font le geste de cet écran — **des changements en
attente, à appliquer sur un autre système** — et leurs figures officielles disent la même chose :

- **Finder › appareil** (guide macOS Big Sur, « Overview of syncing ») : l'appareil dans la
  sidebar ; en tête l'icône, le nom, une ligne de faits ; une barre de boutons par type de contenu
  (General · Music · Movies…) ; des sections à **libellé aligné à droite** (Software: / Backups: /
  Options:), la valeur en face, les **actions secondaires dans la section** (Check for Update,
  Restore iPhone… sous Software:) ; en bas, **un seul Apply**.
- **Photos › Importer** (guide macOS Tahoe) : l'appareil dans la sidebar ; barre **« Import
  Selected »** (inactif sans sélection) · **« Import All New Photos »** (primaire) ; les éléments
  en **groupe nommé avec son compte** (« New Photos (15 photos) »), sans boîte.
- **Utilitaire de disque** (guide macOS Tahoe) : la cible en tête, une action de toolbar = une
  sheet. Pas de liste d'attente.

Quatre maquettes dans la vraie fenêtre avec les composants de l'app (v1 réfutée par la référence,
v2 table de la § Zone C, v3 carte de Clé USB, v4 Finder + Photos — artefact « Rekordbox — comment
Apple le ferait ») ; **v4 retenue, « moins de prose »** (Antoine, « go v4 »).

### Ce qui est livré

- **Barre unifiée** = Photos › Importer : **« Synchroniser la sélection »** (`data-sift="rkbsyncsel"`,
  inactif sans sélection, compte entre parenthèses sinon) · **« Tout synchroniser (N) »**
  (`rkbsyncall`, primaire). N est borné à la section active de B′ (« Tout » = les quatre) — choisir
  une section, c'est le bouton de contenu du Finder. Les deux sont inactifs si la synchronisation
  est indisponible ou en cours. Plus de compte dans la barre ni de badge.
- **Zone C bornée à `--measure-data`** (`.rkb-main`), grammaire du Finder › appareil :
  1. **Tête** (`.sift-usage-head`, la même que Clé USB) : icône, nom du fichier, une ligne de
     faits « XML Rekordbox lié · N playlists · N pistes · N en attente de synchronisation » (ou
     « à jour », ou warning : « synchronisation indisponible », « N sections sans réponse »).
  2. **Fichier :** chemin en mono, puis **Réexporter maintenant** (absent tant que le XML est
     illisible) · **Changer de XML lié…** — les actions du XML près du XML, comme Check for Update
     sous Software:.
  3. **master.db :** « Lisible » ou la cause (`masterdb_error`, warning) ; « Dérive : aucune » ou
     la phrase entière en warning (elle était un bandeau).
  4. **En attente :** un groupe par section (`.rkb-group-hd` « Métadonnées (1) », « · N à
     choisir » si des ambigus attendent), **une rangée par candidat** (`.rkb-cand`, `--row-h`) :
     case, piste, écart à droite en encre secondaire ; cochée = `--overlay-hover`. Rangée ambiguë
     sans case, écart « à choisir », une piste candidate par bouton. Erreur d'application sous la
     rangée. Rien en attente : « Rien — le XML lié est à jour. »
  Libellés à droite (150 px, 600), filet en retrait entre les sections. Pas de rappel de procédure,
  pas de règle master.db en prose — les faits seuls.
- **Colonne B′** inchangée (plan de la file, cinq entrées, compte ou « — » si la section n'a pas
  répondu).
- **Synchroniser** (`rekordbox-plan.ts`, pur, gelé par `test/rekordbox-plan.test.ts`) : le plan
  = tiers dans l'ordre 1 → 3 (métadonnées) → 3 (pochettes) → 2 (playlists), sélection ∩ en attente,
  borné à la section active ; une confirmation in-app (« Synchroniser N entrées avec Rekordbox ?
  Ferme Rekordbox avant de continuer. »), les quatre IPC enchaînés — chacun garde son backup et son
  refus si Rekordbox tourne —, un rapport par toast, l'échec inscrit sur sa rangée.
- **Ignorer** : clic droit sur une rangée (pas sur un doublon de playlist, rien n'y est persisté).
- Partis : la carte du XML, la sur-ligne, les quatre fiches, les groupes de session repliés et
  leur « Tout sélectionner », les quatre boutons « Appliquer la sélection », « Dédupliquer » par
  groupe, le bandeau de dérive, le rappel de procédure. `.rb-row`, `.rb-session-*`, `.bx-row`
  retirés de `styles.css`.

### Vérifié dans la vraie fenêtre le 2026-09-08 (CDP 9333)

Zone C 1200 px de large ; barre « Synchroniser la sélection » inactif · « Tout synchroniser (2) »
28 px ; libellés « Fichier : / master.db : / En attente : » alignés à droite, 150 px ; groupes
« Métadonnées (1) », « Pochettes (1) » ; rangées 32 px. Clic sur une rangée : `aria-checked`,
fond `--overlay-hover`, barre « Synchroniser la sélection (1) » actif ; second clic : retour.
« Tout synchroniser » : confirmation « Synchroniser 2 entrées avec Rekordbox ? Ferme Rekordbox
avant de continuer. » puis **Annuler** — aucune écriture, les deux candidats toujours en attente.
Plancher typographique 10 px tenu, aucun défilement de page. **Non exercés** : la synchronisation
effective (écriture dans `master.db`, manuelle par Antoine), état non lié, XML illisible, sections
en erreur, ambigus, doublons de playlist, `masterdb_error`, dérive.

### Reste

- **Rangée Pochettes / Fichiers** : « Artiste — Titre » depuis `metadata` (jointure par
  `track_id`, `actions.track_id` pour les corrections de chemin), repli sur le nom du fichier sans
  ligne `metadata` — livré le jour même (`PendingArtworkSync.artist/title`,
  `PendingMasterdbRepair.artist/title`, miroir `contracts.ts`, tests de contrat
  `pending_*_shape_matches_contracts_ts`).
- **Inspecteur** (§ Zone D) : non fait — un candidat se lit sur sa rangée. Écarté le 2026-11-03.
- La § Zone C ci-dessus (table Case · Section · Piste · Écart · État) est **remplacée** par les
  groupes de rangées de Photos : à 200 candidats, la table de Rangés redeviendrait la bonne forme.

## Décision — 2026-09-29 : la synchro vide ce que la release n'a plus (#81)

Depuis #68, choisir une autre release VIDE du fichier et de la base ce qu'elle n'a pas. La synchro
`master.db` ne savait que poser : Rekordbox gardait le label, l'année, le genre et la pochette de
l'ancienne. Décisions d'Antoine :

- **Vider pour de vrai**, dans la forme que Rekordbox donne lui-même à un tag absent, mesurée sur
  la vraie bibliothèque (Évaluation 24 de `docs/ressources-externes.md`) : `LabelID` et `GenreID`
  à NULL, `ReleaseYear` à 0, `ImagePath` vide. Des milliers de pistes portent déjà ces valeurs et
  Rekordbox les affiche normalement : l'essai « Relire le tag » d'abord prévu n'apprendrait rien
  de plus, et il a été abandonné (Antoine, même jour). Rien n'est supprimé — les lignes
  `djmdLabel`/`djmdGenre` d'avant et les fichiers de pochette du cache restent, orphelins. La
  vérification après écriture relit désormais label, genre, année et pochette, posés comme vidés.
  Vérifié sur une copie de la vraie bibliothèque.
- **Pochette vidée, pochette reposable** : une pochette se synchronise en réécrivant les trois
  fichiers vers lesquels `ImagePath` pointe, et Sift n'en crée jamais. Vider `ImagePath` sans
  retenir sa valeur coupait donc pour toujours la synchro de pochette de la piste (revue de la
  phase B). Sift retient l'ancien chemin (`rekordbox_cleared_artwork`, migration v25) ; la
  pochette suivante réécrit d'abord ces fichiers restés dans le cache, puis y repointe la piste.
- **Ce qui se vide se recalcule** : un champ que le fichier a reposé depuis la détection ne se
  vide plus — la rangée ne se rafraîchit que si Rekordbox connaît le chemin écrit, la mémoire de
  la piste, elle, suit toujours. Une rangée ambiguë annonce ce que porte au moins une candidate ;
  résolue, elle n'annonce plus que ce que porte la piste choisie. Un champ déjà vide n'est pas
  réécrit, donc la piste n'est pas marquée modifiée pour rien.
- **Rangée** : la rangée Métadonnées annonce EN TÊTE de l'écart, en encre d'avertissement,
  « À vider : label, année » (`.rkb-cand-cleared`). En tête parce que l'écart est une ligne
  tronquée à droite. La confirmation nomme les vidages : « Synchroniser N entrées avec
  Rekordbox ? K champs y seront vidés. ». N'est annoncé que ce que Rekordbox PORTE,
  lu dans `master.db` à la détection : une valeur que Sift a posée puis retirée sans qu'elle ait
  été synchronisée n'est pas annoncée (revue du 2026-09-29). La mémoire de ce que Sift a retiré
  vit par piste (`tracks.rekordbox_cleared`), hors du journal que la purge vide à 30 jours.
- **Hors périmètre** : l'artiste et le titre — Rekordbox garde toujours un titre, tiré du nom de
  fichier à l'import.
- **Rétablir** : la synchro reprend l'état rétabli (recalcul), au lieu de garder les valeurs de
  l'écriture annulée. La pochette n'est reposée que pour un changement de release, seul Rétablir
  qui rend aussi le chemin de l'image en base ; ailleurs, la pochette en attente de l'écriture
  annulée est retirée, jamais ré-armée.
- La pochette de l'ancienne release, restée en attente, est retirée quand la nouvelle n'a pas
  d'image : l'appliquer aurait poussé une image que le fichier n'a plus.

## Décision — 2026-11-03 : les décisions jamais codées

Un audit en lecture seule du 2026-11-03 a relevé cinq points de cette spec que
`rekordbox-view.ts` n'avait jamais reçus. La décision du 2026-09-08 ne citait qu'« Ignorer »
au clic droit sans retirer le reste, et le code portait un commentaire « Ignorer et rien
d'autre — HIG, a small number of menu items ». Arbitrages d'Antoine, même jour :

- **Clic droit : les quatre entrées** (§ Souris), dans cet ordre : Synchroniser cette entrée
  (confirmation in-app, comme la barre) · Ignorer · Voir la piste dans Bibliothèque (filtre sur
  le nom du fichier, chemin de `journal.ts`) · Ouvrir l'emplacement (`reveal_track`). Une entrée
  impossible est **désactivée, pas retirée** (`context-menu.ts`) : une rangée ambiguë ne se
  synchronise pas avant le choix de sa piste ; un doublon de playlist n'a ni Ignorer (rien n'est
  persisté) ni piste Sift à montrer. Pour Ouvrir l'emplacement d'une correction de chemin,
  `PendingMasterdbRepair` porte désormais `sift_track_id` (`actions.track_id`).
- **Entrée** (§ Clavier) synchronise la sélection après confirmation. Ignorée dans un champ,
  sur un bouton ou une entrée de section focalisés (leur propre activation), menu ou
  confirmation ouverts, ou pendant une synchronisation.
- **Recherche** (§ Zone A), `mountBarSearch`. Chaque mot doit paraître dans la piste, l'écart ou le
  chemin, sans égard à la casse ni aux accents (`rekordbox-ecart.ts::searchMatches`). **Elle
  borne le plan** : « Tout synchroniser (N) » et la sélection ne comptent que les rangées
  visibles, on ne synchronise jamais ce qu'on ne voit pas. Les comptes de la colonne B′ et de la
  tête restent ceux de la section entière. Tout masqué : « Aucune entrée ne correspond à « … » »,
  jamais « à jour ».
- **Synchronisation en cours** (§ États) : la feuille `.sift-batch-sheet`, en tête de zone C, dans
  une ancre collante (`.rkb-sheet-anchor`). Elle porte une barre déterminée par entrée, l'étape
  en texte (« Métadonnées · 2 sur 5 ») et **Annuler**. Côté Rust (validé par Antoine avant
  écriture) : les quatre écritures `master.db` passent sur `spawn_blocking` (`hors_du_fil`,
  gardé par `ecritures_masterdb_restent_hors_du_fil_de_la_fenetre`) ; synchrones, elles gelaient
  la fenêtre, barre et bouton compris. Les trois écritures par lot émettent
  `rekordbox:sync-progress` après chaque entrée. Annuler lève un drapeau
  (`rekordbox_masterdb_set_sync_stop`) lu **entre deux entrées, jamais au milieu d'une
  écriture** (`rekordbox_repairs.rs::apply_each`). Chaque entrée garde son backup et sa
  relecture : ce qui est écrit le reste, le reste reste en attente et coché.
- **Rapport** : sans échec ni arrêt, la feuille se retire et le toast d'avant parle. Sinon elle
  devient le rapport : « N entrées synchronisées · K échouées · M non traitées — toujours en
  attente », le détail des échecs (nom et motif), et Fermer.
- **Inspecteur** (§ Zone D) : **écarté**, voir plus haut.

**Non vérifié dans la vraie fenêtre** : une synchronisation réelle. Le dossier Pioneer est
celui de la machine (`actions::rekordbox_pioneer_dir`), même dans une instance bac à sable : une
synchronisation confirmée écrirait dans le vrai `master.db`. La feuille, l'arrêt et le rapport
ont été exercés dans la vraie fenêtre, IPC Rekordbox interceptés dans la page. La progression et
l'arrêt côté Rust sont tenus par `apply_each_s_arrete_entre_deux_entrees`.

## Hors périmètre / questions ouvertes

- **Vérification dans le vrai Rekordbox** — manuelle, hors de cette spec.
- **Mode XML contre `master.db`** — le choix vit aujourd'hui dans cet écran. Doit-il
  remonter dans Réglages, où vivent les autres décisions persistantes ? Non tranché.
- **Ignorer un candidat** — l'action est spécifiée dans le menu contextuel ; sa
  persistance (session, ou définitive) ne l'est pas.
