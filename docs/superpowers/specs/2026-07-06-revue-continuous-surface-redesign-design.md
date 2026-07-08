# Revue — surface continue + titlebar 2-tons + hero agrandi (2026-07-06)

## Contexte

Suite de la refonte Revue du 2026-07-05 (zones repliables Diagnostic/Métadonnées,
`docs/superpowers/specs/2026-07-05-revue-screen-redesign-design.md`). Cette passe
retire l'effet "cartes empilées" de l'inspecteur, agrandit le hero d'écoute,
sort le nom final du verdict card vers le rail, et retravaille la titlebar en
deux aplats (nav-tone à gauche / content-tone à droite) au lieu d'un bandeau uni.

Périmètre : `frontend/chrome.ts`, `frontend/styles.css`, `frontend/report-view.ts`,
`frontend/filing.ts`. Pas de backend touché. `docs/mockups/sift-club-ready-dark.html`
reste une référence visuelle, non modifiée.

## État réel constaté avant patch (vérifié par lecture directe)

- `#qcol`/`#rvinspector` sont **déjà** des cartes flottantes (marges 10px,
  bordure+radius, **zéro box-shadow** — commentaire `styles.css:184-198` explicite
  depuis une session antérieure du même jour). Rien à refaire ici.
- `.sb` (nav rail) = 152px de large exactement (`styles.css:121`).
- `refreshPreview()` (`filing.ts:571-593`) écrit déjà dans `.sift-fil-prev`
  (sélecteur actuellement mort — aucun nœud ne porte cette classe) ET dans
  `.sift-verdict-finalname` (vivant, dans `verdictCardHtml()`). Déplacer le nom
  final vers le rail = juste ajouter le nœud manquant dans `renderFoot()` — le
  code de mise à jour existe déjà et n'attend que sa cible.
- Le toggle Détail/Lot est un vrai contrôle (`ensureReviewSeg()`, `sift-live.ts`),
  inséré en tête de `#qcol`, actuellement `align-self:flex-start` — à centrer.
- `#filfoot`/`#fldz` sont bien des siblings de `.mid` (contrat préservé).

## Changements

### 1. Titlebar (chrome.ts)
Remplacement du style injecté de `#sift-titlebar` par une structure à 2 zones
DOM réelles (pas de `linear-gradient`, pour éviter tout artefact de sous-pixel) :
- zone gauche, largeur = largeur nav (152px), fond `--color-background-tertiary`
- zone droite, fond `--color-background-primary`
- bordure verticale entre les deux zones : `border-right:0.5px solid
  var(--color-border-tertiary)` sur la zone gauche, dans le prolongement exact
  de `.sb{border-right}` en dessous.
- Titre + contrôles fenêtre restent dans la zone droite (layout inchangé sinon).
- macOS (`sift-tb-mac`) : les traffic lights restent à gauche ; la zone gauche
  de la titlebar garde son rôle de fond nav-tone, sans le split appliqué au
  layout des boutons eux-mêmes (pas de Mac dispo pour vérifier visuellement —
  cohérent avec la limitation déjà documentée).
- `#pa{height:calc(100vh - 30px)}` inchangé.

### 2. Queue flottante
Déjà fait (voir ci-dessus). Seul ajout : centrer `#sift-revseg` (toggle
Détail/Lot) — `align-self:flex-start` → `center` dans `sift-live.ts`.

### 3. Surface continue de l'inspecteur
Retrait de l'effet carte sur `.sift-player-row`, `.sift-spectro-box`,
`.sift-fil-editor.sift-fil-editor-margin`, et le conteneur verdict
(`.sift-verdict-card`) : plus de `background`/`border`/`border-radius` propres
à ces blocs — ils reposent sur le fond de `#rvinspector`
(`--color-background-queue`) déjà en place. Les bordures restantes ne
subsistent que sur les vrais contrôles (`.sift-dest-btn`, `.chip`, inputs,
`.sift-dest-popover`, le canvas spectrogramme). Les en-têtes de section
(`Diagnostic audio`, `Métadonnées`, bulle conclusion) restent des labels
arrondis (`.sift-zone-toggle`/nouvelle bulle conclusion), pas des cards.

### 4. Hero agrandi
`.sift-player-row` : pochette ~68px (actuellement `.sift-cover-frame`, à
vérifier/agrandir), titre plus grand (passe de `--text-lg` à un token
existant plus grand, ou nouvelle valeur cohérente avec l'échelle), bouton
lecture ~46px (`--h-36` actuel → nouvelle taille), waveform ~58px (actuel
`height:46` dans `WaveSurfer.create`, `report-view.ts:552`), espace accru
entre header et waveform.

### 5. Diagnostic / Métadonnées
Renommage du label "Preuve (spectre)" → "Diagnostic audio" dans
`spectroAndTagsHtml()` (`report-view.ts:396`, via `zoneToggleHtml({label})`
déjà paramétrable — pas de nouvelle mécanique). Catégories `Signal`/
`Conteneur` optionnelles dans le tableau : **différées** (le tableau actuel
est une liste plate de lignes `row()`, sans groupement — ajouter un
sous-groupement demande une vraie décision de contenu par ligne, hors scope
mécanique de cette passe ; noté comme écart assumé). CDJ reste dans
Métadonnées (déjà le cas depuis la refonte du 05/07, aucun changement requis).

### 6. Conclusion (verdictCardHtml, report-view.ts)
Retrait de `.sift-verdict-finalname-col` (le nom final). Nouvelle structure :
bulle de statut (`À finaliser` / `Prêt à ranger` / `À vérifier` / le libellé
fake existant) + phrase courte, sur fond continu (pas de `background:panelBg`
plein cadre). État `À finaliser` : verdict=ok **et** aucune destination
choisie (`state.binRel === null` sans "sur place") — la fonction reçoit déjà
`AnalysisReport` seul ; elle doit accepter un paramètre destination-connue
optionnel pour ce calcul (signature étendue, appelants mis à jour dans
`filing.ts`/`report-view.ts`). Pas de répétition du warning ID3 ici (reste
dans `renderEditor()`/`.sift-tag-warn`).

### 7. Rail d'action (filing.ts::renderFoot)
Ordre : Destination → Format (chips) → **nouveau** groupe nom final compact
(`.sift-rail-final-group`, contenant `.sift-fil-prev` — cible déjà lue par
`refreshPreview()`) → spacer → hints clavier (masqués sous 1480px) → Jeter/
Re-source → Ranger. Bouton Destination : style ambre discret + label
`Choisir…` quand `binLabel()` vaut `—`. Bouton Ranger : `disabled` réel
(attribut + style visuel) quand aucune destination n'est choisie (miroir de
la garde déjà dans `doRanger()` — le toast devient une garde de dernier
recours, pas le seul retour utilisateur).

### 8. Espacements
Réutilisation des tokens `--space-*` existants par catégorie d'usage (page/
section/subsection/block/control/content-x) plutôt que des valeurs isolées —
pas de nouveau système de tokens. Ajout ciblé uniquement si un espacement
répété n'a aucun token qui lui correspond déjà.

## Écarts assumés vs la demande initiale
- Catégories `Signal`/`Conteneur` dans le tableau diagnostic : non ajoutées
  (demande explicitement "éventuellement" — jugé hors scope mécanique, le
  tableau actuel n'a pas de structure de groupement par ligne).
- macOS : layout de titlebar non vérifiable visuellement (pas de Mac), comme
  documenté depuis la brique titlebar initiale.

## Vérification
`npx tsc --noEmit`. Contrats préservés : `#filfoot`/`#fldz` siblings de
`.mid`, `sift-zone-toggle`/`aria-expanded`/badges Diagnostic+Métadonnées
inchangés dans leur mécanique (seul le label change), `refreshPreview()`
continue de mettre à jour `.sift-fil-prev`. Vérification visuelle réelle
(`tauri dev`) laissée à Antoine (code gated `inTauri`).
