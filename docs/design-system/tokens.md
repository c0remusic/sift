# Sift Design System - Tokens

> Cette page cartographie les familles de tokens. Les valeurs exactes vivent dans
> `frontend/styles.css`; ne pas recopier un thème parallèle ici.

## Canon

Les tokens sont déclarés dans `frontend/styles.css`, principalement dans
`:root`, `@media (prefers-color-scheme: dark)` et `:root[data-theme="dark"]`.

Règle : tout nouveau style durable doit utiliser un token existant ou ajouter un
token dans `styles.css` avec un rôle clair. Les valeurs hardcodées sont
acceptables seulement pour une mesure locale non thémable, jamais pour une
couleur d'état ou une surface.

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

- `primary` : fond principal de l'espace de travail, **et les champs**, creusés
  (convention du 2026-07-10, `styles.css:1372-1375`) ;
- `tertiary` / `queue` : rail, chrome latéral, file de morceaux **et cartes groupées** —
  même valeur depuis la fusion du 2026-08-05 ;
- `secondary` : contrôle monté, c'est-à-dire ancré dans la charpente (issue #8) ;
- `surface-raised` : cran saillant d'un contrôle monté (état actif, déclencheur) et
  surface flottante. ⚠️ **Pas** réservé au flottant : il peint aussi `.sift-play-btn`,
  `.sift-seg-thumb`, `.sift-settings-btn`, `.sift-ident-search-btn` ;
- `track` : rail creusé d'un segmented control ;
- `row-active` / `nav-active` : sélection, hover structurel, état courant.

### États Sémantiques

Tokens principaux :

- `--color-background-info`
- `--color-background-danger`
- `--color-background-success`
- `--color-background-warning`
- `--color-text-info`
- `--color-text-danger`
- `--color-text-success`
- `--color-text-warning`

Règle UX : un état permanent reste sobre. La couleur sémantique doit signaler
un risque, un blocage ou une confirmation utile, pas décorer une zone déjà
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

Les overlays sont préférables aux aplats colorés pour les états subtils :
sélection, survol, badge neutre, hover de waveform.

### Contraste

Les HIG demandent, pour toute couleur personnalisée, une variante de **contraste
augmenté** en plus des variantes claire et sombre, et chiffrent la cible : 4,5:1 au
minimum, 7:1 visé sur du petit texte.

`styles.css` n'a aucune règle `prefers-contrast` ni `forced-colors` — ce troisième
registre n'existe pas. Écart ouvert (E1), sans étape planifiée : le définir est un
chantier à part entière, pas une retouche.

## Typographie

Police UI canonique : `--font-ui`.

Police mono canonique : `--font-mono`, réservée aux données techniques,
chemins, durées, formats, valeurs numériques et noms de fichier.

Règles :

- pas de typo hero dans les panneaux compacts ;
- les titres de section doivent être courts et scannables ;
- les valeurs techniques doivent privilégier la lisibilité tabulaire ;
- ne pas utiliser le poids fort comme substitut à la hiérarchie spatiale ;
- pas de graisse légère : les HIG l'écartent explicitement, et `styles.css` n'en
  contient aucune (100/200/300 absents) — le rester.

### Plancher De Lisibilité

Les HIG donnent pour macOS une taille par défaut de 13 pt et un **minimum de 10 pt**.
`--text-base` vaut exactement 13px ; `--text-2xs` (9px) et `--text-3xs` (8px) passent
sous ce plancher.

Les usages sont recensés et classés par famille dans
`docs/superpowers/changes/2026-08-05-hig/design.md` § E2 : en-têtes uppercase,
métadonnées mono, badges de verdict. Les trois n'ont pas la même gravité. La densité
d'un en-tête de colonne est défendable pour un outil qui affiche 15k à 100k lignes ; un
**badge de verdict** ne l'est pas, et pour une raison qui n'est pas typographique : le
libellé texte (`FAKE`, `DUPLICATE`) est ce qui rattrape le code couleur pour un
daltonien. Le rendre illisible garde la forme de la compensation et en perd la fonction.

**Tranché le 2026-08-05 : les deux tokens n'existent plus.** Antoine a décidé de remonter
toutes les polices au plancher. Le geste n'a pas été d'éditer leur valeur — les porter à
10px aurait donné trois barreaux identiques dans l'échelle — mais de **migrer les 14 sites
vers `--text-xs`** puis de retirer les déclarations. `.nv-grp`, qui codait `9px` en dur et
qu'une édition de token aurait manqué, a migré aussi.

L'échelle commence donc à `--text-xs:10px`, et le plancher HIG est tenu dans
`styles.css`.

**Mesures du 2026-08-05, à lire avant de trancher.** Elles retirent deux arguments que
tout le monde aurait employés de bonne foi.

- **Le contraste n'est pas le problème.** Les six en-têtes uppercase passent AA dans les
  deux thèmes, au repos comme au survol, avec 22 % à 88 % de marge (pire cas 5,50:1 en
  clair, 8,45:1 en sombre). Les badges de verdict aussi (FAKE 5,00:1 dans les deux
  thèmes, DUPLICATE 6,24 / 5,00). Le 9 px de Sift n'est pas un 9 px pâle : les paires
  ton-sur-ton ont été calibrées à ~5:1 dès l'origine. **Remonter à 10 px ne change aucun
  ratio** — la taille n'entre pas dans le calcul WCAG en dessous du seuil « large text »
  (18 pt, ou 14 pt gras), dont on est très loin.
- **L'argument densité est faux sur les en-têtes.** Aucun des six n'est un élément
  par-ligne : un par tableau, un par run, un par session, un par catégorie. Le coût est en
  O(nombre de groupes), pas O(nombre de lignes) — à 15k ou 100k pistes, passer à 10 px ne
  coûte **pas une seule ligne** de liste. Le Journal n'est même pas virtualisé. Si l'on
  garde 9 px ici, la divergence documentée doit dire la vraie raison — *hiérarchie
  typographique : un en-tête de groupe reste subordonné à ses lignes de données* — et
  surtout pas « densité ». Une raison fausse gravée dans le design system se retourne
  contre la revue suivante.

Deux contraintes mécaniques à ne pas rater :

- **le token ne doit pas bouger.** `--text-2xs` a 13 consommateurs dans `styles.css` seul ;
  le porter à 10 px le rendrait identique à `--text-xs` et écraserait un cran de l'échelle.
  Le geste correct est par sélecteur. À noter : `.nv-grp` (`styles.css:224`) code
  `font-size:9px` **en dur** et contourne le token — une édition de token le raterait ;
- `.sift-tags-title` (`styles.css:1122`) n'a **aucun consommateur** dans le dépôt. Lui
  appliquer une décision de taille serait décider du sort d'un élément qui ne s'affiche
  nulle part. La supprimer est une décision, pas un correctif.

## Espacement

Six paliers déclarés (`frontend/styles.css:97`) :

- `--space-4`
- `--space-8`
- `--space-12`
- `--space-16`
- `--space-24`
- `--space-32`

Rôles :

- 4 : micro-gap entre icône, label, métadonnées ;
- 8 : groupe compact, ligne, chip ;
- 12 : respiration interne d'un module ;
- 16 : séparation entre sections ;
- 24 et 32 : respirations de haut niveau, entre blocs d'écran. 13 usages réels — cette
  page n'en listait que quatre paliers jusqu'au 2026-08-05 et attribuait à 16 seul un
  rôle que 24 et 32 assument aussi.

Si une zone paraît dense, augmenter d'abord l'espacement entre groupes, pas la
taille des cartes.

## Radius Et Hauteurs

Le radius sert à distinguer les éléments interactifs, les badges et les panneaux,
pas à rendre toute la page "douce".

⚠️ **`--h-40` est un token mort.** Il est déclaré (`frontend/styles.css:115`) et n'a
**aucun** consommateur : `var(--h-40)` a zéro occurrence dans tout `frontend/`, et aucune
règle `height:40px` ne le remplace. Cette page le présentait comme « hauteur canonique du
contrôle principal » — c'était faux, corrigé le 2026-08-05. Le commentaire
`styles.css:111` qui l'accompagne est lui aussi périmé. Ne pas s'en servir comme
référence ; ne pas le supprimer sans décision (une valeur morte ne coûte rien, une
suppression peut casser un usage futur déjà prévu).

Règle : les dimensions de contrôles répétés doivent être stables. Un hover,
un état actif ou un libellé long ne doit jamais faire bouger le layout.

## Ombres

Les ombres sont rares. Sur Sift, elles servent surtout à détacher une surface
flottante utile. Si le panneau est déjà séparé par position, couleur ou bordure,
ne pas ajouter d'ombre.

Cas récent : le panneau File flottant ne doit pas porter d'ombre s'il est déjà
compris comme une surface latéralement séparée.

## Mise À Jour

Quand un token change :

1. modifier `frontend/styles.css` ;
2. vérifier les composants touchés dans `docs/design-system-states.md` ;
3. mettre à jour cette page seulement si le rôle du token change ;
4. vérifier l'app réelle, pas seulement une maquette HTML.
