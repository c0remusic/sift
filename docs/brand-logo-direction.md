# Sift — direction logo & marque (état au 2026-07-03, PAS produit)

> Session d'exploration brandkit du 2026-07-03. Direction convergée et validée par
> Antoine mais **production reportée** (« on verra le logo plus tard »). Ce doc est
> la source de vérité pour reprendre le chantier sans refaire les itérations.

## Le système validé

**Un seul dessin** : le point du i de « sift » est le mark, l'icône app en est un
recadrage. Concept retenu : **l'alignement** (« du vrac au rangé »), après rejet
des pistes tamis, bac de digger, coupure spectrale, aiguillage.

### Le mark (point du i / icône)
Deux carrés arrondis qui se chevauchent (référence : image fournie par Antoine) :
- **Carré ambre** : contour plein (PAS de pointillés — rejetés), penché ~16°,
  derrière, en haut à gauche = le fichier « en vrac / à trier ».
- **Carré vert** : rempli, droit, devant, en bas à droite = « rangé / validé ».
- Chevauchement ~40 %. Carrés préférés aux pastilles rondes (testées, écartées :
  plus distinctif en icône).

### Le wordmark
- « sıft » (i sans point, le mark fait office de point) en **Outfit Bold 700**,
  tracking **-3,5 %** (réglage « O3 compact »). Outfit = la fonte de l'app
  (`--font-ui`), choix délibéré « outil pro » : la typo ne fait pas de numéro,
  le symbole porte la personnalité. Typos décoratives explorées (8 coupes
  custom : ligature f–t, stencil, condensée, déconstruite…) et **rejetées**
  (« c'est moche, c'est un outil pro »).
- **Couleur, traitement « hybride I2 »** : `s` en ambre, `ı` entier (fût + point
  vert) en vert, `f` et `t` en couleur de texte primaire du thème. Lecture
  gauche→droite = le tri (le vrac entre, se range au i, le mot repart calme).

### Couleurs — uniquement des valeurs déjà dans styles.css
Sémantique app conservée : ambre = doute/à trier, vert = ok/rangé. La règle
CSS « pas de 3e teinte » est respectée. Antoine préfère les valeurs claires.
- **Thème sombre** (celui qu'il préfère, base des icônes OS) :
  ambre `#f2c274`, vert sauge `#9fe0af` (= `--color-text-warning/-success` dark).
- **Thème clair** : les pastels s'effondrent sur crème (démontré) → un cran
  au-dessus : ambre `#B07A28`, vert `#4C7B57` (bases existantes de
  `--color-border-danger` / `--color-background-success`).

### Échelle de dégradation (règles d'usage)
- Grand format : wordmark complet (les 2 carrés sur le i).
- Icône app 64/32 px : le couple de carrés seul.
- 16 px / favicon / tray : **carré vert seul**.
- Barre de titre : wordmark avec le couple (il tient à 17 px) ; si trop serré
  verticalement, point vert simple.
- Piste notée : animer le carré ambre→vert en fin de batch / splash.

## Production (le jour du GO)
1. `brand/` : SVG sources — wordmark vectorisé en tracés (Outfit converti en
   paths, licence OFL ok), variantes sombre/clair, icône seule, carré vert seul.
2. `src-tauri/icons/` : ICO/ICNS/PNG générés depuis la version sombre (tuile
   charbon + pastels = la plus robuste sur fonds OS variés).
3. Aucun token CSS à créer : le logo consomme les valeurs existantes.

## Écarté en route (ne pas re-proposer tel quel)
- Métaphore tamis (maille/débris/grain or) — série 1 complète.
- Bac de digger, coupure spectrale, aiguillage, étagère — série 2 (le « plafond
  plat » spectral reste la plus ownable si un jour on veut un mark expert).
- Pastilles rondes, pointillés/fantômes dashed, trajectoire de chute.
- Palette charbon+or initiale, puis orange saturé `#E2833C` / vert `#46B872`
  (pas les couleurs de l'app).
- Typos custom décoratives (2 séries de 4 coupes).
