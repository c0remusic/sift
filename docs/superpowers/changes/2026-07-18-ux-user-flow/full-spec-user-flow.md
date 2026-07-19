# Sift — Full-spec user flow (écran par écran)

> Spec complet du parcours, en aval de `PRD.md` (le QUOI) et de `design.md` (le
> flux cible). Ici : chaque écran en séquence, avec action primaire/secondaire,
> info affichée, raisons de drop-off, micro-copy, points de friction, états
> d'erreur et chemins happy/recovery. Branches marquées.
>
> **⚠ Correction vocabulaire (recoupée sur la VRAIE app via CDP, 2026-07-18) :**
> l'app réelle utilise **« Convertir »** (action principale) et **« Écarter »**
> (rejet) — PAS « Ranger »/« Jeter » de `content.md`. `content.md` est donc
> **périmé** sur ces libellés (à resynchroniser, cf. audit du chantier). Les
> occurrences « Ranger »/« Jeter » ci-dessous se lisent **Convertir**/**Écarter**
> tant que `content.md` n'est pas corrigé. Le concept « déplacer = encoder +
> ranger » reste le principe ; le libellé bouton est « Convertir ». Toute autre
> micro-copy reste une **proposition à recouper avec l'UI réelle**.

## Légende
- **[P]** action primaire · **[S]** action secondaire · **↳** branche ·
  **⚠ drop-off** raison d'abandon · **✎** micro-copy proposée.
- États canoniques : `Prêt à ranger`, `À finaliser`, `À vérifier`,
  `Faux lossless probable`, `Sur-encodé`, `Destination manquante`,
  `CDJ compatible/incompatible`.

---

## Flux principal — grosse conversion de bibliothèque

### 0. Premier lancement (état vide onboarding)
Affiché seulement si aucune source n'est déclarée.
- **Info** : une phrase de cadrage + un seul chemin d'action.
- **[P]** Choisir un dossier source.
- **[S]** Activer un dossier surveillé (watcher) pour plus tard.
- **⚠ drop-off** : l'utilisateur ne comprend pas quoi pointer → un exemple concret
  lève le doute.
- **✎** titre : « Ajoute ta musique pour commencer ». corps : « Choisis le dossier
  où vit ta bibliothèque — Sift analyse, identifie et t'aide à ranger. » CTA :
  `Choisir un dossier`.

### 1. Accueil — sources
- **Info** : dossiers sources déclarés, état du watcher, nb de fichiers vus /
  en file.
- **[P]** Importer un dossier (lance scan → met en File).
- **[S]** Gérer les sources (ajouter/retirer, activer le watcher).
- **⚠ drop-off** : scan long sans retour → afficher une progression vivante
  (compteur qui monte), jamais un spinner muet.
- **✎** CTA : `Importer un dossier`. état watcher : `Surveillé` / `En pause`.

### 2. File « à traiter » (panneau de la Revue)
- **Info** : liste des morceaux en attente, verdict d'analyse quand prêt,
  recherche/filtre. Virtualisée (gros volumes).
- **[P]** Ouvrir un morceau (mode Détail) **ou** basculer en mode Lot.
- **[S]** Filtrer (ex. `sans identification fiable`, `à écouter`, `doublons`).
- **⚠ drop-off** : file énorme = sentiment d'écrasement → l'indicateur de
  progression (§friction 2) et les filtres découpent la masse.
- **✎** filtre : `À écouter (ambigus)`, `Sans identification fiable`.

### 3. Revue — mode Détail (titre par titre, soin)
Poste de décision. Ordre de décision (pas technique) : écouter → Diagnostic audio
→ Métadonnées → Destination → Format → Nom final → Ranger/Jeter.
- **Info** : lecteur (écoute de vérification), spectrogramme, verdict qualité,
  métadonnées + Match Discogs, Destination (pré-remplie, voir §suggestion),
  Format, Nom final calculé.
- **[P]** `Convertir` (encode + range vers la Destination ; libellé réel — bouton
  désactivé « Choisis une destination pour convertir » tant que Destination vide).
- **[S]** `Écarter` (→ Écartés) · `Rechercher à nouveau` (ré-identifier) ·
  `Choisir` une autre Destination · écouter. Raccourcis affichés : SPACE écouter ·
  ENTER convertir · BKSP jeter · HAUT/BAS naviguer.
- **⚠ drop-off** : trop d'infos d'un coup → sections Diagnostic/Métadonnées
  repliables, résumé visible replié ; le bouton `Ranger` désactivé tant que la
  Destination manque (état `Destination manquante`).
- **✎** guidance destination : « Choisir où Sift doit ranger ce morceau ».
  bouton : `Ranger`. warning : `Destination manquante`.

### 4. Revue — mode Lot (volume)
- **Info** : liste multi-sélection, colonne **Destination suggérée** + chip de
  confiance (`sûr` / `ambigu`), action d'écoute par ligne, barre de progression
  d'encodage.
- **[P]** Confirmer en lot les suggestions `sûr` d'un même bac (Ranger le lot).
- **[S]** Changer la destination d'une ligne · écouter une ligne · passer un
  morceau en Détail · `Jeter` une sélection.
- **⚠ drop-off** : peur de ranger en masse → confirmation à deux clics armée +
  tout réversible (Journal) ; les `ambigu` ne partent jamais dans un lot `sûr`.
- **✎** en-tête colonne : `Destination`. chip : `sûr` / `ambigu · à écouter`.
  action lot : `Ranger 800 morceaux` (compteur réel).

#### 3–4a. ↳ Suggestion de destination (pièce maîtresse — voir design §3.1)
- Net (styles → 1 bac) → Destination pré-remplie, chip `sûr`, confirmable en lot.
- Ambigu (styles → plusieurs bacs) → chip `ambigu · à écouter`, routé en Détail
  pour écoute + choix. **Jamais rangé sans oreille.**
- Toujours **écoutable** et **modifiable**, y compris les `sûr`.
- **✎** hint appris : « Suggéré d'après tes rangements ». ambigu : `à écouter`.

#### 3–4b. ↳ Doublon détecté (voir design §3.5)
- **Info** : les deux fichiers côte à côte (qualité, format, bitrate, tags, chemin),
  **critère de départage affiché**.
- **[P]** `Garder` celui suggéré (meilleure qualité). **[S]** `Garder` l'autre ·
  écouter les deux.
- Décision **manuelle** ; le perdant part en Écartés (récupérable), jamais
  supprimé sec.
- **✎** bandeau : `Doublon probable`. raison : `Garde le vrai lossless — l'autre
  est un faux lossless probable`.

#### 3–4c. ↳ Fichier problématique (voir design §3.6)
- **Info** : verdict au plus près du Diagnostic audio (`Faux lossless probable`,
  `Sur-encodé`, tronqué…).
- **[P]** `Jeter` → Écartés → re-sourcer. **[S]** `Ranger` quand même (averti) ·
  corbeille.
- Jamais bloquant ; le faux lossless est orienté vers le re-sourcing, pas imposé.
- **✎** warning : `Faux lossless probable`. action Écartés : `Re-sourcer`.

#### 3–4d. ↳ Identification incertaine (voir design §3.6)
- **Info** : `Aucun match fiable` ; pas de suggestion de destination.
- **[P]** Identifier à la main / `Rechercher à nouveau`. **[S]** Ranger
  manuellement (l'utilisateur sait à l'oreille) · `Jeter`.
- Jamais bloquant. *Objectif produit parallèle* : ce cas doit rester rare (taux
  Discogs proche de 100 %, résidu = releases numériques hors Discogs).
- **✎** état : `Aucun match fiable`. action : `Rechercher à nouveau`.

### 5. ↳ Écartés (branche de rejet)
- **Info** : morceaux jetés/écartés, raison, liens d'achat / copie du nom pour
  Soulseek.
- **[P]** `Re-sourcer` (ouvrir liens). **[S]** Remettre en File · Corbeille
  (destructif → confirmation in-app).
- **⚠ drop-off** : l'utilisateur oublie ses écartés → le compteur d'écartés reste
  visible dans le shell.
- **✎** : `Re-sourcer`, `Remettre en file`, corbeille : `Jeter définitivement`.

### 6. Bibliothèque (collection rangée)
- **Info** : morceaux rangés, facettes (Genres/Artistes), vues table/grille,
  doublons internes (empreinte), tableau de bord de stats.
- **[P]** Parcourir / rechercher. **[S]** Éditer un morceau · re-ranger ·
  résoudre un doublon interne (même flux que §3–4b).
- **⚠ drop-off** : lenteur perçue sur très gros volumes → virtualisation (déjà
  en place ; pagination différée, cf. Phase 3).
- **✎** doublon interne : `Doublon dans ta bibliothèque`.

### 7. Journal (réversibilité)
- **Info** : historique des actions de rangement (surtout par lot), horodatées.
- **[P]** `Annuler` une action / un lot. **[S]** Voir le détail d'un lot.
- **⚠ drop-off** : n/a — filet de sécurité, pas une étape obligatoire.
- **✎** : `Annuler`. toast : `Rangé — Annuler`.

### 8. ↳ Satellites d'export (optionnels)
- **Rekordbox** : export/synchro XML + master.db (Tier 1/2/3). Écriture
  **sauvegardée + vérifiée** avant validation.
  - **[P]** `Exporter vers Rekordbox` (ici « Exporter » = vrai fichier/écriture
    externe, usage autorisé). **[S]** Réparer chemins / dédup playlist / synchro
    metadata.
  - **✎** : `Rekordbox est ouvert — ferme-le avant de synchroniser`.
- **Clé USB** : formatage FAT32/exFAT + copie.
  - **[P]** `Formater et copier`. Confirmation in-app armée (destructif).
  - **✎** : `Formater efface tout le contenu de la clé`.

---

## Régime permanent (watcher, hors grosse conversion)
Même pipeline, rythme au fil de l'eau :
- Nouveau fichier détecté → **analysé + pré-suggéré en fond** (rien rangé) →
  notification `X nouveaux à revoir`. Suggestion fiable (historique entraîné).
- L'utilisateur ouvre la Revue (Détail, quelques morceaux), confirme/ajuste.
- **✎** notif : `3 nouveaux morceaux prêts à revoir`.

---

## 3 points de friction les plus élevés + améliorations

1. **Répétition du rangement (majeur).** Choisir la destination des milliers de
   fois. → **Suggestion de destination** (design §3.1) : pré-remplissage confiance-
   scoré, confirmation en lot, ambigu→écoute. La répétition tombe à « confirmer ».
2. **Écrasement par le volume / perte du fil (majeur).** File énorme, pas de sens
   de progression. → **Indicateur global** `à traiter · suggérés · à trancher ·
   rangés` + filtres (`à écouter`, `sans identification`) + « et maintenant ? »
   qui ouvre la Revue filtrée sur la prochaine décision utile.
3. **Frein confiance à l'échelle (majeur).** Peur de laisser l'auto agir. →
   **Rien de silencieux** : tout suggéré→vu→confirmé, Journal réversible,
   sauvegarde/vérif avant écriture Rekordbox. Le mode batch rapide reste opt-in.

---

## États d'erreur par étape

- **Scan / import** : dossier illisible ou vide → bandeau `Dossier illisible ou
  vide`, la File n'est pas polluée par des entrées fantômes (fail-fast, pas de
  fallback silencieux).
- **Analyse** : fichier corrompu → le worker isole le panic (catch_unwind),
  logge, et marque le morceau `Analyse impossible` sans tuer la file ; l'utilisateur
  peut Jeter ou re-sourcer.
- **Identification (Discogs)** : réseau/HTTP en échec → `Discogs indisponible —
  réessayer` (retry réservé à Discogs/AcoustID), jamais un faux match par défaut.
- **Rangement (encode + file)** : échec d'encodage/déplacement → l'action échoue
  **atomiquement** (rien de à-moitié rangé), message précis, morceau reste en File.
- **Écriture Rekordbox** : Rekordbox ouvert / master.db inattendu / vérif échouée
  → message humanisé (déjà en place : `MasterDbError`), backup restauré
  automatiquement, rien d'appliqué.
- **Clé USB** : identité de support inattendue → refus + message, jamais formater
  le mauvais volume.

Principe transverse : un échec est **remonté avec contexte et actionnable**,
jamais avalé ni masqué par une valeur par défaut.

---

## Happy path & recovery

**Happy path (confirmation).** Import → analyse auto → suggestions de destination
→ confirmation en lot des `sûr`, écoute des `ambigu` → morceaux rangés
(`Prêt à ranger` → rangé) → (optionnel) export Rekordbox/USB. Confirmation :
un flash bref sur la ligne rangée + toast `Rangé — Annuler`, puis retour neutre
(pas d'aplat de couleur permanent).

**Recovery (flux abandonné).** À la réouverture, l'état est **persistant**
(SQLite) : la File, les suggestions et le Journal survivent à la fermeture. Rien
n'est perdu ni à recommencer. L'indicateur de progression rappelle où on en était
(`40 à trancher`), et « et maintenant ? » ramène directement à la prochaine
décision. Aucune action destructive n'a été prise sans confirmation, donc aucun
rattrapage d'urgence n'est nécessaire — au pire, `Annuler` au Journal.

---

## Suite
Livrable 2 (demandé) : **audit heuristique + critique visuelle sur l'app live**
(`tauri dev`, captures des vrais écrans) — Nielsen 10 + hiérarchie/contraste/
alignement sur l'UI existante. Nécessite l'app qui tourne.
