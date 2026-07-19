# Sift — UX/UI user flow (as-is → cible)

> Design de parcours issu du brainstorm 2026-07-18, en aval de `PRD.md` (le QUOI).
> Ici : le COMMENT côté UX/UI — cartographier le flux réel, nommer les frictions,
> concevoir le flux cible. Pièce maîtresse : la suggestion de destination.
> Sources de vérité design respectées : `frontend/styles.css` (tokens),
> `docs/design-system-states.md` (états), `docs/design-system/patterns.md`
> (parcours Revue, surface continue, destination-first, warnings au plus près).
> Ce doc ne fige pas de valeurs de tokens ni de skin — il décrit le parcours.

## Contexte

Sift est feature-complet (M0→M8). Le produit (voir `PRD.md`) est un poste de prépa
« entre Soulseek et les platines » : analyser, dédoublonner, identifier, ranger,
puis exporter vers Rekordbox/USB. Double nature : flux linéaire pour la grosse
conversion, boîte à outils à la carte pour l'usage ponctuel. Principe :
« déplacer = encoder + ranger ». Le seul point encore 100 % manuel est le choix
de destination au rangement — c'est la friction cœur que ce chantier cible.

## Partie 1 — Carte du flux actuel (as-is)

### Colonne vertébrale
```
Accueil (sources/import/watcher)
   │  met en file « à traiter »
   ▼
Revue  ── analyse (auto) ─ diagnostic audio ─ métadonnées/identification (Discogs)
   │        │
   │        ├─ ranger  → encode + file → Bibliothèque
   │        └─ écarter → Écartés
   ▼
(satellites optionnels)  Rekordbox (XML/master.db)  ·  Clé USB
```

### Écrans et rôles réels
- **Accueil** (`home-sources.ts`) : déclarer les sources, import d'un dossier,
  watcher ; point d'entrée du flux.
- **Revue** (`report-view.ts` + `filing.ts`/`filing-bins.ts`) : poste de décision.
  Répond aux 4 questions (audio sain ? identification fiable ? où ranger ? quel
  format/nom ?). Deux modes : **Détail** (titre par titre, écoute) et **Lot**
  (`batch-panel.ts`, volume, confirmation à deux clics).
- **Écartés** (`ecartes-view.ts`) : branche de rejet — re-sourcer (liens
  d'achat / copie Soulseek) ou corbeille. Un morceau écarté n'est pas supprimé.
- **Bibliothèque** (`library-detail.ts`, `library-views.ts`) : collection rangée —
  parcourir/éditer/re-ranger, doublons internes (empreinte), tableau de bord.
- **Journal** (`journal.ts`) : actions post-lot, revert (support de la
  réversibilité).
- **Rekordbox** (`rekordbox-view.ts`) et **Clé USB** (`usb-format-modal.ts`) :
  satellites d'export/synchro.

### Décisions par station (état actuel)
- Analyse, dédup, identification : assistées/automatiques, l'humain confirme.
- **Rangement : 100 % manuel** — l'utilisateur choisit la destination à chaque
  fois (par lot ou titre par titre). Aucune proposition de destination.

## Partie 2 — Frictions

1. **Répétition du rangement** (cœur). Choisir la destination des milliers de
   fois sur une grosse conversion est épuisant. Aucune assistance aujourd'hui.
2. **Fil du parcours entre écrans.** L'utilisateur peut perdre le « et
   maintenant ? » entre Accueil → Revue → Écartés → Bibliothèque → Rekordbox :
   pas d'indicateur global de progression ni de prochaine action évidente.
3. **Premier lancement.** Un nouvel utilisateur ouvre Sift et ne sait pas par où
   commencer (sources ? watcher ? importer ?) — pas de chemin balisé vers le
   premier résultat.
4. **Confiance dans l'auto.** Frein à laisser Sift traiter en masse (peur de
   perdre/dégrader). Tant que l'auto n'est pas visible et réversible, l'utilisateur
   hésite à passer à l'échelle.

## Partie 3 — Flux cible (to-be)

### 3.1 Pièce maîtresse — suggestion de destination (frictions #1 + #4)

**Principe.** Sift ne range jamais tout seul : il **propose** une destination
pré-remplie ; la destination reste la décision de l'utilisateur (invariant du
PRD : « ne jamais perdre / déplacer en douce »). La répétition s'effondre en
« confirmer » pour les cas nets.

**Source du signal (auto-apprise, zéro config).**
- Sift apprend « style Discogs → bac » de l'historique de rangement de
  l'utilisateur : quand il range des morceaux d'un style dans un bac, la
  correspondance est retenue et re-proposée. Les règles se construisent en
  rangeant, sans table à remplir.
- **Signal de base** : le champ **Style** de Discogs (fin : Techno, Deep House),
  pas le champ Genre (large : Electronic).
- **Repli démarrage à froid** (pas encore d'historique) : correspondance avec le
  **nom des bacs existants** (bac « Techno » + style Techno → propose /Techno).

**Confiance et ambiguïté** (réutilise le pattern « ambigu → tu résous » déjà
présent dans l'app pour l'identification Discogs et les réparations master.db) :
- Les styles du morceau collapsent vers **un seul bac candidat** → destination
  **suggérée** (chip « sûr »), **confirmable en lot**.
- Les styles pointent vers **plusieurs bacs** → morceau marqué **« ambigu · à
  écouter »**, routé vers la Revue (Détail) pour être écouté puis tranché — car
  décider la destination demande souvent l'oreille, pas seulement les tags.

**Toujours écoutable, toujours modifiable** (exigences Antoine, 2026-07-18) :
- **Écoute** : chaque suggestion — pas seulement les ambiguës — porte une action
  d'écoute (vérifier avant de confirmer).
- **Changement** : toute destination suggérée est modifiable en un clic, y compris
  les « sûr ». Rien n'est verrouillé ; la suggestion est un point de départ.

**Mode batch rapide (optionnel, off par défaut).** Pour une très grosse
conversion, un mode « style principal seulement » accepte les suggestions en masse
sans passer sur chaque ambiguïté — précision échangée contre vitesse. Explicitement
optionnel, jamais le défaut, pour ne pas heurter la friction confiance.

**Où dans l'UI.**
- **Mode Lot** (`batch-panel.ts`) : colonne destination pré-remplie par ligne,
  chip de confiance (sûr / ambigu), action d'écoute et sélecteur de bac par ligne ;
  confirmation en lot des « sûr » d'un même bac. Les « ambigu » restent en attente
  d'écoute.
- **Mode Détail / rail A finaliser** (`filing.ts`, pattern *destination-first*) :
  la destination suggérée pré-sélectionne le contrôle de destination existant ;
  format puis nom final calculé suivent, inchangés. Le warning « ambigu » apparaît
  au plus près de la décision (zone A finaliser), pas ailleurs.
- Le rangement reste **encode + file en un geste** ; rien ne change au moteur.

**Ce que ça sert.** #1 (la répétition disparaît pour les cas nets), #4 (tout est
suggéré → vu → confirmé, jamais déplacé en douce, et réversible via le Journal),
et alimente #2 (compte « suggérés / à trancher »).

### 3.2 Fil du parcours (friction #2) — traitement léger

- **Indicateur de progression global** lisible depuis le shell : « X à traiter ·
  Y suggérés · Z à trancher (ambigus) · rangés ». Il donne l'état de la conversion
  en un coup d'œil.
- **Prochaine action** : un « et maintenant ? » discret qui pointe la station
  suivante utile (ex. « 40 morceaux à écouter » → ouvre la Revue filtrée sur les
  ambigus). Pas un wizard : un raccourci vers la décision suivante.
- Densité et sobriété : pas de carte décorative, on s'appuie sur le shell existant
  (surface continue).

### 3.3 Premier lancement (friction #3) — traitement léger

- **Premier-run balisé** : au premier démarrage sans source, un état vide
  actionnable (composant `empty-state.ts` existant) qui mène en 3 gestes au premier
  résultat : choisir une source (ton gros dossier) → lancer l'analyse → voir le
  premier verdict en Revue.
- Pas d'onboarding multi-écrans ; un chemin unique vers le premier résultat, puis
  l'utilisateur est dans le flux normal.

### 3.4 Confiance (friction #4)

Pas un écran dédié : la confiance est une **propriété** du flux cible ci-dessus —
suggestions visibles, jamais d'action silencieuse, tout réversible (Journal),
sauvegarde/vérification avant écriture Rekordbox (déjà en place). Rien à ajouter
au-delà de rendre l'auto lisible et annulable.

### 3.5 Résolution de doublon (station dédup)

Même logique que la destination : Sift **suggère**, l'humain **tranche**.

- **Détection** : `name_key` (nom normalisé) sur le flux entrant, empreinte
  chromaprint pour les doublons internes de la Bibliothèque. Un doublon détecté
  est signalé, pas résolu tout seul.
- **Suggestion par la qualité** : Sift propose de garder le meilleur selon le
  **verdict de qualité qu'il calcule déjà** (vrai lossless > faux lossless >
  bitrate/format supérieur), et **affiche pourquoi** (le critère de départage) —
  utile surtout quand les deux sont proches.
- **Comparaison côte à côte** : qualité, format, bitrate, complétude des tags,
  chemin / déjà-rangé — pour trancher en connaissance.
- **Décision manuelle, toujours** : la suggestion est une pré-sélection, **jamais
  appliquée seule**. L'utilisateur confirme ou change lequel garder. Pas d'auto-
  résolution silencieuse (respecte la friction confiance).
- **Le perdant part en Écartés** (récupérable / re-sourçable), jamais supprimé
  sec — invariant PRD « ne jamais perdre un original ».
- **Deux surfaces, même présentation** : doublon du flux entrant (avant/pendant le
  rangement) et doublon interne de la Bibliothèque.

### 3.6 Cas limites du parcours

**Identification incertaine.** Quand Discogs ne renvoie rien de fiable → pas de
suggestion de destination (ou très basse confiance sur nom/tags existants) ; le
morceau reste revuable, l'utilisateur identifie à la main ou range manuellement —
**jamais bloqué**. Un filtre « sans identification fiable » permet de les traiter
en paquet. *Note produit* : ce cas doit rester **rare** — l'objectif est un taux
d'identification Discogs proche de 100 %, le résidu attendu étant surtout les
releases numériques absentes de Discogs. Améliorer le matching Discogs (cf. audit
recherche Discogs 2026-07-12) est un **objectif parallèle**, pas un substitut au
repli manuel.

**Fichier problématique.** Un défaut réel (faux lossless, tronqué, clipping) est
signalé par le verdict, **jamais bloquant** : l'utilisateur garde (averti), écarte
→ re-source (liens achat / copie Soulseek), ou corbeille. Le faux lossless est
orienté vers le re-sourcing sans l'imposer. Un remplaçant re-sourcé **ré-entre dans
le pipeline** (ré-analyse + dédup contre l'ancien).

**Watcher / régime permanent.** Un nouveau fichier détecté est **analysé et
pré-suggéré en fond** (rien rangé), puis notifié « X nouveaux à revoir ». La
suggestion est fiable car l'historique est déjà entraîné. Rythme au fil de l'eau
(Détail plutôt que Lot) ; rien filé sans l'utilisateur.

## Hors-scope / différé

- **Épinglage de règles dures** (forcer `Bootleg→/À vérifier`, option C du
  brainstorm) : évolution *additive* future, pas dans cette v1 (YAGNI). Trigger de
  réouverture : besoin réel de forcer des cas récurrents que l'auto-apprentissage
  ne capte pas.
- **Auto-rangement complet silencieux** : écarté (viole l'invariant PRD).
- **Refonte visuelle des écrans** : hors-scope. On câble la suggestion dans les
  surfaces existantes (Lot, rail A finaliser), on ne redessine pas la peau.
- **Signal de suggestion au-delà de Style + historique + nom de bac** (BPM,
  énergie, label…) : différé, à évaluer si le taux d'ambiguïté reste élevé.

## Terminé = démontrable

- Sur un lot réel, les morceaux à style connu arrivent avec une destination
  pré-remplie « sûr », confirmables en lot ; les multi-genres ambigus sont marqués
  et routés à l'écoute — démontrable dans le mode Lot.
- Toute suggestion est écoutable et modifiable, y compris les « sûr » — démontrable
  en cliquant écouter / changer sur une ligne.
- Sur un utilisateur sans historique, le repli par nom de bac propose quand même,
  et l'apprentissage s'améliore après quelques rangements — démontrable en rangeant
  puis en revenant sur des morceaux de même style.
- L'indicateur de progression reflète l'état réel (à traiter / suggérés / à
  trancher / rangés).
- Rien n'est déplacé sans confirmation ; toute action est au Journal et réversible.

## Suite

Design validé → `superpowers:writing-plans` pour le plan d'implémentation
(tranches verticales, chacune démontrable). L'apprentissage style→bac et la
détection d'ambiguïté sont la première tranche naturelle (backend + UI Lot).
