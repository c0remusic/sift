# Sift Design System - Tokens

> Cette page cartographie les familles de tokens. Les valeurs exactes vivent dans
> `frontend/styles.css`; ne pas recopier un theme parallele ici.

## Canon

Les tokens sont declares dans `frontend/styles.css`, principalement dans
`:root`, `@media (prefers-color-scheme: dark)` et `:root[data-theme="dark"]`.

Regle : tout nouveau style durable doit utiliser un token existant ou ajouter un
token dans `styles.css` avec un role clair. Les valeurs hardcodees sont
acceptables seulement pour une mesure locale non themable, jamais pour une
couleur d'etat ou une surface.

## Couleurs

### Surfaces

Tokens principaux :

- `--color-background-primary`
- `--color-background-secondary`
- `--color-background-tertiary`
- `--color-background-queue`
- `--color-surface-raised`
- `--color-track`
- `--color-row-active`
- `--color-nav-active`

Usage :

- `primary` : fond principal de l'espace de travail ;
- `tertiary` : rail/navigation et chrome lateral ;
- `queue` : file de morceaux ;
- `surface-raised` : panneau flottant ou popover ;
- `row-active` / `nav-active` : selection, hover structurel, etat courant.

### Etats Semantiques

Tokens principaux :

- `--color-background-info`
- `--color-background-danger`
- `--color-background-success`
- `--color-background-warning`
- `--color-text-info`
- `--color-text-danger`
- `--color-text-success`
- `--color-text-warning`

Regle UX : un etat permanent reste sobre. La couleur semantique doit signaler
un risque, un blocage ou une confirmation utile, pas decorer une zone deja
comprise.

### Bordures Et Overlays

Tokens principaux :

- `--color-border-tertiary`
- `--color-border-secondary`
- `--color-border-info`
- `--color-border-danger`
- `--overlay-hover`
- `--overlay-selected`
- `--overlay-badge`
- `--overlay-drop`
- `--overlay-wave-hover`

Les overlays sont preferables aux aplats colores pour les etats subtils :
selection, survol, badge neutre, hover de waveform.

## Typographie

Police UI canonique : `--font-ui`.

Police mono canonique : `--font-mono`, reservee aux donnees techniques,
chemins, durees, formats, valeurs numeriques et noms de fichier.

Regles :

- pas de typo hero dans les panneaux compacts ;
- les titres de section doivent etre courts et scannables ;
- les valeurs techniques doivent privilegier la lisibilite tabulaire ;
- ne pas utiliser le poids fort comme substitut a la hierarchie spatiale.

## Espacement

Echelle courte et volontaire :

- `--space-4`
- `--space-8`
- `--space-12`
- `--space-16`

Roles :

- 4 : micro-gap entre icone, label, metadonnees ;
- 8 : groupe compact, ligne, chip ;
- 12 : respiration interne d'un module ;
- 16 : separation entre sections majeures.

Si une zone parait dense, augmenter d'abord l'espacement entre groupes, pas la
taille des cartes.

## Radius Et Hauteurs

Le radius sert a distinguer les elements interactifs, les badges et les panneaux,
pas a rendre toute la page "douce".

Hauteur canonique notable :

- `--h-40` : controle principal et bouton d'action important.

Regle : les dimensions de controles repetes doivent etre stables. Un hover,
un etat actif ou un libelle long ne doit jamais faire bouger le layout.

## Ombres

Les ombres sont rares. Sur Sift, elles servent surtout a detacher une surface
flottante utile. Si le panneau est deja separe par position, couleur ou bordure,
ne pas ajouter d'ombre.

Cas recent : le panneau File flottant ne doit pas porter d'ombre s'il est deja
compris comme une surface lateralement separee.

## Mise A Jour

Quand un token change :

1. modifier `frontend/styles.css` ;
2. verifier les composants touches dans `docs/design-system-states.md` ;
3. mettre a jour cette page seulement si le role du token change ;
4. verifier l'app reelle, pas seulement une maquette HTML.

