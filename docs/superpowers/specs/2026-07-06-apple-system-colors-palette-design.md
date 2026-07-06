# Palette couleur Apple system colors — design

> Date : 2026-07-06. Contexte : lecture des Apple Human Interface Guidelines
> (design-principles, color, materials, layout, sidebars, drag-and-drop,
> entering-data, feedback, file-management, loading, multitasking,
> playing-audio, settings, searching, undo-and-redo, icons) + un skill tiers
> "Apple HIG Designer" proposant les system colors iOS/macOS comme référence.
> Décision utilisateur : abandonner la règle "2 teintes sémantiques
> seulement (vert/ambre), aucun bleu" au profit d'une palette multi-teintes
> à l'Apple, à la fois pour les rôles sémantiques ET pour catégoriser du
> contenu qui n'a aujourd'hui aucune identité visuelle propre.

## Ce que ça remplace

Décisions documentées jusqu'ici (CLAUDE.md, `docs/design-system-states.md`,
mémoire `sift-ui-refonte-2026-07`) et explicitement révisées par ce design :
- "2 couleurs sémantiques seulement (vert/ambre), pas de 3e teinte" — sauf
  l'exception dorée du bouton Identifier, qui elle **reste inchangée** (CTA,
  pas un statut — voir section Exception dorée).
- "Le danger fusionne dans l'ambre" — se sépare en rouge (danger) / orange
  (warning).
- `--color-text-info` réutilisé comme "le seul neutre foncé interactif" —
  redevient un vrai bleu.

## 1. Rôles sémantiques

| Rôle | Teinte Apple | Usage |
|---|---|---|
| `success` | vert | inchangé dans son rôle |
| `danger` | rouge | **nouveau** — se sépare de l'ambre (fake détecté, erreur bloquante) |
| `warning` | orange | reprend l'ancien rôle ambre non-bloquant (tags CDJ manquants, doublon) |
| `info` | bleu | **nouveau** — remplace le neutre actuel réutilisé pour "sélectionné/interactif" |

Convention technique inchangée : chaque rôle garde le triplet
`--color-text-{role}` / `--color-background-{role}` / `--color-border-{role}`,
défini dans `:root` (clair) + les 2 blocs sombres existants
(`@media (prefers-color-scheme:dark)` et `:root[data-theme="dark"]`) — même
mécanique que `danger`/`success`/`warning` aujourd'hui, avec 2 vraies
couleurs (rouge, bleu) au lieu de réutiliser l'ambre/le neutre.

**Consommateurs directement affectés par la bascule neutre→bleu de `info`** :
`.sift-bgrp-box.on` (case de sélection groupée), `button:focus-visible`
et les autres sélecteurs `:focus-visible` (actuellement sur
`--color-border-info`, garde le même token, change juste de couleur), `.chip.on`,
`.fld.on`, `.sift-ranger-btn`, `.sift-genre-chip`, `.sift-cand-jump`,
`.sift-spectro-hint`, `.sift-bt-run`/`.sift-bt-spin`, `.sift-confirm-btn`.

**Consommateurs affectés par la séparation ambre→rouge de `danger`** :
tout ce qui utilise aujourd'hui `--color-text-danger`/`--color-background-danger`/
`--color-border-danger` (déjà un token dédié, donc uniquement les *valeurs*
changent, pas les sélecteurs CSS) — carte verdict "fake", `.sift-secondary-trash`,
`.sift-vchip`/`.sift-chip-badge` en variante danger.

## 2. Teintes catégorielles

Après les 4 rôles sémantiques (bleu/vert/orange/rouge), il reste 5 teintes
Apple : indigo, rose, violet, teal, jaune. Ces 3 usages catégoriels
n'apparaissent jamais sur le même écran en même temps (Bibliothèque/Revue vs
Accueil vs Intégrations), donc ils réutilisent le même pool de 5 sans risque
de confusion visuelle — seule l'unicité *à l'intérieur* de chaque groupe
compte.

### 2a. Genres musicaux (par famille, pas par genre exact)

Nouvelle table de correspondance genre→famille, **frontend uniquement**
(aucun changement DB/backend — `genres.rs` reste un simple stockage de
chaînes libres Discogs "style"). Repli "Autre" neutre pour tout genre non
reconnu par la table.

| Famille | Teinte | Exemples de genres qui y tombent |
|---|---|---|
| House | teal | house, deep house, tech house, garage |
| Techno / électro dur | indigo | techno, electro, industrial, EBM |
| Disco / Funk / Soul | rose | disco, funk, soul, boogie |
| Hip-Hop / R&B | violet | hip-hop, r&b, trap |
| Autre | gris neutre | tout le reste, non reconnu |

Consommateur : `.sift-genre-chip` (`filing.ts` pour le rendu, `styles.css`
pour le token). La table de correspondance vit dans un nouveau module
frontend (ex. `frontend/genre-families.ts`), pas dans `genres.rs`.

Résolution genre→famille : comparaison insensible à la casse par
mot-clé contenu dans la chaîne (ex. "Deep House" contient "house" → famille
House), pas une correspondance exacte — les genres Discogs réels varient en
formulation. Chaque famille a une liste de mots-clés ; premier mot-clé
trouvé qui matche gagne ; aucun match → "Autre". La liste de mots-clés
précise par famille sera affinée au moment du plan d'implémentation, sur la
base des genres réellement croisés dans la bibliothèque de l'utilisateur.

### 2b. Sources surveillées (Accueil)

Attribution automatique par ordre d'ajout, cycle sur les 5 teintes
catégorielles :

| Ordre d'ajout | Teinte |
|---|---|
| 1ʳᵉ source | indigo |
| 2ᵉ | violet |
| 3ᵉ | rose |
| 4ᵉ | teal |
| 5ᵉ | jaune |
| 6ᵉ et au-delà | recycle depuis indigo |

Plus un sélecteur de couleur manuel par source dans Réglages, pour override
à tout moment sans attendre un re-ajout. Nécessite : (1) un champ couleur
persisté là où les sources le sont déjà (DB/settings — à vérifier lequel des
deux au moment du plan d'implémentation), (2) un petit contrôle de sélection
de couleur ajouté à la carte source existante (`home-sources.ts` pour le
rendu, `sift-live.ts`'s `renderReglagesLive()` ou équivalent pour le
réglage).

### 2c. Intégrations (Rekordbox, Clé USB)

Teintes fixes, stables, **jamais recyclées** par les sources ou les genres
(contrairement à 2a/2b, ces 2 items ne changent jamais d'identité) :

| Intégration | Teinte |
|---|---|
| Rekordbox | jaune |
| Clé USB | teal |

Consommateur : items nav `.nv`/`.nv-export` sous le groupe "Intégrations"
(`chrome.ts`/`sift-live.ts`), et la page dédiée Rekordbox
(`renderRekordboxLive()`) pour son propre statut visuel.

## 3. Matériaux (flou ponctuel)

Flou/verre (`backdrop-filter: blur() saturate()`) appliqué **uniquement**
aux popovers éphémères qui ne restent jamais affichés en continu :
- Popover Destination (`.sift-dest-popover`, `#fldz`)
- Overlay de confirmation (`confirm-modal.ts`)

Tout le reste (hero, file, rail, cartes Réglages, toasts, cartes
Intégrations) reste opaque + ombre légère (`--shadow-panel-subtle`),
inchangé — Liquid Glass (rendu iOS/macOS 26) n'est pas disponible dans
WebView2 ; l'équivalent "standard materials" d'Apple (structure sans flou)
correspond déjà au traitement plat en place. Le flou pur CSS
(`backdrop-filter`) reste un choix ponctuel, réservé aux 2 éléments
ci-dessus pour limiter le coût de repaint et la fragilité de lisibilité du
texte sur fond variable.

## 4. Bouton Identifier — l'exception dorée est retirée

Revu pendant la relecture du spec : un doré fait maison, ne correspondant à
aucune des 9 teintes Apple, ressortirait comme une incohérence maintenant
que la palette complète existe (les 9 teintes Apple sont déjà toutes prises
par les 4 rôles sémantiques + les 5 catégorielles — lui donner une 10e
teinte à part violerait la règle Apple "ne jamais réutiliser une couleur
pour deux significations différentes" si elle recyclait une teinte
catégorielle existante).

**Décision** : `.sift-id-btn` abandonne `--color-accent-identify`/`-hover`/
`-text`/`-border` et adopte les tokens `info` (bleu) déjà définis pour le
rôle sémantique — cohérent avec l'usage réel Apple, où le bleu **est** la
couleur d'action standard (boutons, liens, éléments interactifs), pas
seulement un statut "info" passif. Le bouton Identifier devient donc visuellement
de la même famille que les autres éléments interactifs (`.sift-ranger-btn`,
`.chip.on`, focus ring), au prix de perdre le cachet "CTA à part" qu'avait
le doré — jugé acceptable par l'utilisateur pour la cohérence globale.

Tokens `--color-accent-identify*` à supprimer de `styles.css` (les 2 blocs
sombres + `:root`) une fois `.sift-id-btn` retargeté.

## 5. Icônes — pas de changement

Le style Apple "icon-only" (bouton retour circulaire, toolbar SF Symbols
sans bordure) ne s'applique **pas** au rail d'action de Sift : ces boutons
portent soit une valeur variable (nom de dossier, format choisi), soit un
verbe métier spécifique (Écarter, Ranger) — ni l'un ni l'autre n'est
réductible à un symbole universel appris. La règle existante ("texte
seul, jamais icon-only sur les boutons de rail") reste en place, non
remise en cause par ce design.

## 6. Waveform (portion écoutée) — passe au bleu info

Revu pendant la relecture du spec : `--color-waveform-elapsed` avait été
posé sur `--color-text-success` (vert) plus tôt dans une session
précédente, en réutilisant le premier token dispo au moment du fix
dBFS — sans intention sémantique. L'utilisateur note à juste titre que le
vert lit comme "ce morceau est bon/validé", un faux signal de verdict sur
un simple indicateur de lecture. Comparé en mockup contre une teinte cyan
dédiée : le bleu info/accent l'emporte (cohérent avec "le bleu = l'élément
actif/interactif" déjà acquis pour Identifier/focus/chips), malgré le
chevauchement visuel avec un chip actif si les deux sont visibles
ensemble — jugé acceptable.

**Décision** : `--color-waveform-elapsed` passe de `var(--color-text-success)`
à `var(--color-text-info)`. Le reste du canvas waveform/spectrogramme
(overlays blanc/noir, badges temps) reste inchangé — volontairement
toujours sombre indépendamment du thème, comme un lecteur audio pro (déjà
noté dans `docs/design-system-states.md`).

## Portée de l'implémentation

Fichiers à toucher :
- `frontend/styles.css` — nouveaux tokens (rôles + catégoriels), 2 variantes
  chacun (clair + les 2 blocs sombres existants), suivant exactement la
  convention déjà en place pour `danger`/`success`/`warning`/`info`.
- `frontend/genre-families.ts` (nouveau) — table genre→famille + fonction de
  résolution avec repli "Autre".
- `frontend/filing.ts` — chips de genre consomment la nouvelle table.
- `frontend/home-sources.ts` — rendu de la couleur de source (auto +
  contrôle de sélection manuelle).
- `frontend/sift-live.ts` / `frontend/chrome.ts` — nav Intégrations,
  `.sift-bgrp-box` (bascule vers `info` bleu).
- `frontend/confirm-modal.ts`, popover Destination (`filing.ts`/`styles.css`)
  — flou ponctuel.
- `frontend/styles.css` — `.sift-id-btn` retargeté sur les tokens `info`,
  suppression de `--color-accent-identify*` (`:root` + 2 blocs sombres).
- `frontend/styles.css` — `--color-waveform-elapsed` retargeté sur
  `var(--color-text-info)` (était `--color-text-success`).
- Persistance de la couleur de source : mécanisme exact (DB vs settings
  JSON) à trancher pendant le plan d'implémentation, pas ici.

Hors scope de ce design (à traiter séparément si besoin) : migration
rétroactive d'anciennes captures d'écran/mockups (`Sift.dc.html`, `app.js`),
`docs/design-system-states.md` (sera mis à jour au fil de l'implémentation,
composant par composant, comme d'habitude — pas en un seul geste ici).
