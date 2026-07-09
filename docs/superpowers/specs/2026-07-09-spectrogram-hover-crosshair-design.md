# Spectrogramme interactif : réticule au survol (remplace le cutoff statique)

Date : 2026-07-09
Écran : Revue → Diagnostic audio → spectrogramme (`report-view.ts`, `.sift-spectro-canvas`)

## Contexte

Le spectrogramme dessine aujourd'hui une ligne pointillée statique verdict-tonnée à la
fréquence de coupure détectée, avec une étiquette `"cutoff X kHz"` (`drawSpectrogram`,
`report-view.ts:134-207`). Antoine veut remplacer cette ligne fixe par une exploration
libre au survol de la souris : un réticule qui suit le curseur et affiche la fréquence
et l'amplitude (dB) exactes sous le point survolé — comme un vrai analyseur de spectre
(iZotope RX, Audacity).

La valeur de coupure elle-même n'est pas perdue : `row("Coupure", fmt(r.cutoff_hz, 0) +
" Hz")` (`report-view.ts:440`) l'affiche déjà en texte plein, indépendamment du dessin
sur le canvas.

## Décisions actées (grill-me)

1. **Remplace entièrement**, ne garde pas la ligne fixe — tout se découvre au survol.
2. **Réticule complet** (horizontale + verticale), pas une simple barre horizontale —
   identifie aussi la position temporelle exacte, pas seulement la fréquence.
3. **Fréquence + amplitude (dB)**, pas la fréquence seule — la vraie valeur du pixel
   survolé, lue depuis `sg.mag_db`, la même source qui colore le pixel.
4. **Souris uniquement**, pas d'équivalent clavier — exploration secondaire, la donnée
   clé (Coupure) reste lisible en texte indépendamment. Le canvas garde son
   `role="img"`/`aria-label` statique actuel.
5. **Légende permanente incrustée** (pas de chrome externe autour de la vignette) —
   itérée en mockup visuel (`mcp__visualize`) avant de se fixer :
   - Paliers de fréquence en petit texte semi-transparent, coin supérieur-gauche
     (`20k`/`10k`/`0`), avec `Hz` en petit sous la colonne.
   - Paliers de dB, coin supérieur-droit (`0`/`-20`/`-40`/`-60`/`-80`/`-100`), avec `dB`
     en petit sous la colonne — 6 paliers alignés sur les bornes RÉELLES du mapping
     couleur (`SPECTRO_GAIN_DB`/`SPECTRO_RANGE_DB`, `report-view.ts:114-115` : 0 dBFS à
     -100 dBFS, saturation blanche déjà à partir de -20 dBFS), pas des valeurs
     inventées.
   - **Pas de barre dégradée** — testée en mockup, jugée peu claire une fois les
     paliers numériques ajoutés ; les paliers texte suffisent, la couleur réelle reste
     sur le spectrogramme lui-même.
   - **Pas d'axe temps permanent** — testé en mockup, chevauchait visuellement et jugé
     redondant : le temps reste lisible via l'étiquette du réticule au survol
     uniquement (`"{freq} kHz · {db} dB"`, voir Rendu du réticule), jamais affiché en
     repos.

## Architecture

Un second `<canvas>` transparent, `.sift-spectro-overlay`, positionné en absolu par-dessus
`.sift-spectro-canvas`, mêmes dimensions exactes. Le canvas de base continue à faire
exactement ce qu'il fait aujourd'hui (peindre l'image du spectrogramme) — seul le dessin
de la ligne de coupure/étiquette est retiré de `drawSpectrogram()`.

Cette séparation existe pour la performance : `drawSpectrogram()` reconstruit l'image
pixel par pixel (`w×h` itérations, `report-view.ts:147-159`) — un `mousemove` ne doit
jamais redéclencher cette boucle. L'overlay ne dessine que 2 lignes fines + une étiquette
texte à chaque `mousemove`, largement assez léger pour du 60fps.

### Positionnement CSS

`.sift-spectro-canvas` et `.sift-spectro-overlay` partagent le même conteneur en
`position:relative`, tous deux en `position:absolute;inset:0` (ou équivalent), le overlay
avec `pointer-events:none` sauf sur son propre `mousemove`/`mouseleave` — en pratique le
listener s'attache à l'élément conteneur ou au canvas de base (qui reste le seul à
capter les événements souris), l'overlay ne fait que dessiner par-dessus.

### Wiring (report-view.ts)

Dans `wireSpectrogram()` (ou son point d'appel après le premier `drawSpectrogram`
réussi) :
- `mousemove` sur le canvas de base → calcule `(frame, bin)` depuis `(x, y)` avec
  exactement la même formule que `drawSpectrogram` utilise pour peindre
  (`report-view.ts:148-150`), lit `sg.mag_db[frame*bins+bin]` pour la dB exacte, calcule
  la fréquence via le même ratio `y/h * nyquist` déjà utilisé pour le cutoff. Efface puis
  redessine le réticule sur l'overlay.
- `mouseleave` → efface entièrement l'overlay (canvas.clearRect), rien ne reste affiché
  au repos.

### Rendu du réticule

- Ligne horizontale à la hauteur du curseur (fréquence) + ligne verticale à la position X
  du curseur (temps), fines, semi-transparentes — même poids visuel que l'actuelle ligne
  de coupure (`lineWidth 1.5`, `globalAlpha 0.8`), mais **ton neutre** désormais (plus
  verdict-toné, ce n'est plus le verdict qui s'affiche) : une couleur de texte neutre
  existante (ex. `--color-text-secondary` ou `--color-text-tertiary`) plutôt qu'une
  variable de ton success/warning/danger.
- Étiquette pill sombre près du curseur (même style que l'actuelle : fond
  `rgba(0,0,0,0.55)`, coins arrondis, texte 11px monospace), contenu
  `"{freq_khz.toFixed(1)} kHz · {db.toFixed(1)} dB"`. Positionnement à côté du curseur
  avec le même garde-fou de débordement que l'actuel (`boxY` bascule au-dessus/en-dessous
  selon la place disponible, `report-view.ts:199`).

### Rendu de la légende (permanente)

Contrairement au réticule, la légende ne dépend pas de la souris — dessinée UNE FOIS,
sur le canvas DE BASE juste après le `putImageData` de `drawSpectrogram()` (pas sur
l'overlay, pas redessinée à chaque `mousemove`).

- **Fréquence** (coin haut-gauche) : 3 paliers `20k`/`10k`/`0` répartis verticalement
  sur la hauteur du canvas (proportionnels à `nyquist`, pas des kHz fixes si le fichier
  a un sample rate différent — calculer les 3 valeurs depuis `nyquist` plutôt que les
  coder en dur), `Hz` en dessous. Texte semi-transparent (`rgba(255,255,255,0.55)` pour
  les paliers, `0.4` pour le label d'unité), 9-10px monospace, même famille que
  l'étiquette du réticule.
- **dB** (coin haut-droit) : 6 paliers `0`/`-20`/`-40`/`-60`/`-80`/`-100`, calculés
  depuis `SPECTRO_GAIN_DB`/`SPECTRO_RANGE_DB` (pas des littéraux — si ces constantes
  changent un jour, la légende doit suivre automatiquement), `dB` en dessous, même
  traitement visuel que la colonne fréquence.
- **Pas de barre de couleur dégradée** (décision actée ci-dessus) — texte seul.
- **Pas d'axe temps** (décision actée ci-dessus).

## Suppression

- Le bloc `if (r.cutoff_hz > 0 && nyquist > 0) { ... }` de `drawSpectrogram()`
  (`report-view.ts:162-206`) est retiré en entier — ligne pointillée + étiquette
  `"cutoff X kHz"`. `nyquist` reste calculé (toujours utile pour le nouveau calcul de
  fréquence au survol).

## Hors scope

- Pas d'équivalent clavier (décision actée ci-dessus).
- Pas de changement à `row("Coupure", ...)` — reste tel quel, seule source de vérité
  texte pour la valeur de coupure.
- Pas de persistance/pin du réticule au clic — survol uniquement, éphémère.
