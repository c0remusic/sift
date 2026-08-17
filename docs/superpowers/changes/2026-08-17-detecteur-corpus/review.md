# Le détecteur de faux lossless, mesuré sur de la vraie musique

Ouvert le 2026-08-17 sur une question d'Antoine : **« est-ce qu'on est sûrs que le détecteur de
faux fonctionne ? »** La réponse est non, et ce document dit de combien.

Trois étapes, décidées ensemble dans cet ordre : corriger ce qui est prouvé faux, construire un
corpus étalonné, puis seulement confronter à un second logiciel.

## Étape 0 — ce que les tests prouvaient, et ce qu'ils ne prouvaient pas

`verdict()` est une table de seuils, couverte par 11 tests unitaires : solide, mais ce n'est pas là
qu'est le risque. Tout le risque est dans `detect_cutoff` (`analysis/spectrum.rs`), et le corpus
qui le gardait descend **entièrement d'un seul signal** :
`aevalsrc=0.3*sin(2*PI*(300+20000*t/10)*t)` — un balayage sinusoïdal (`make-fixtures.mjs:15`), pas
de la musique, passé par **un** encodeur à **deux** débits.

Un sweep a de l'énergie pleine à chaque fréquence qu'il traverse : c'est l'entrée la plus facile
possible pour un détecteur de falaise. Les deux ancres « authentiques » prévues
(`anchor_real_lossless.flac`, `anchor_real_320.mp3`) **ne sont pas sur le disque**, et les tests qui
les utilisent passent en sautant.

## Étape 1 — deux faux positifs prouvés, corrigés (`ce97d92`)

Trouvés en interrogeant la base de production (2705 pistes analysées), pas par lecture de code.

**Le pied de basse rendu comme une coupure.** 10 fichiers portaient un cutoff entre 571 et 1367 Hz,
dont 4 exactement à 571,0 — le bin 53, c'est-à-dire `guard`, le plus bas que la boucle pouvait
tester. Un morceau house de 5 minutes n'a pas zéro contenu au-dessus de 571 Hz : les 10 étaient
marqués FAKE à tort.

La sonde `spectrum::tests::ltas_probe`, ajoutée pour l'occasion, a montré le mécanisme — et il n'est
pas celui qu'on supposait. **Il n'y a aucune falaise dans ces fichiers** : spectre lisse jusqu'à
21 kHz. La seule chute de 18 dB sur 500 Hz s'y trouve au passage grave→médium (+24,5 dB à 120 Hz,
−0,1 dB à 800 Hz), et rien au-dessus ne remonte à moins de `RECOVERY_TOL` du niveau des **graves** —
donc `recovers` est faux et la boucle rend son propre plancher. Comparé au témoin sain mesuré le
même jour, la seule différence est **4 dB de pente** : 17 dB de chute contre 21.

Correctif : `SEARCH_FLOOR_HZ = 2000`, une borne physique et non un seuil calibré — aucun passe-bas
d'encodeur ne descend là. Contrôle sur la base réelle : **zéro fichier** n'a de cutoff entre 1400 et
8400 Hz, donc la borne retire les 10 faux positifs sans déplacer aucune autre mesure.

**Un décodage vide lu comme une mesure.** 2 MP3 de plus de six minutes, déclarés 320 kbps,
`codec_error` NULL, portaient `cutoff_hz = 0` — que le verdict lisait comme « coupe à 0 Hz, très en
dessous du plancher de 19 000 pour du 320 » et marquait FAKE. `NO_MEASUREMENT_HZ` est maintenant
nommé et rend Grey, **après** le désaccord de conteneur, qui est une fraude établie sans le spectre.

Migration **v21** : sans elle le correctif ne toucherait pas les données. `verdict` et `cutoff_hz` ne
sont couverts par aucune version de cache — c'est le défaut « une seule des trois sorties d'étape est
versionnée » relevé sur la map #6.

## Étape 2 — le corpus étalonné, et ce qu'il mesure

10 fichiers lossless de provenance connue (achats, dossier fourni par Antoine) × 15 variantes
d'encodage, ré-emballées en FLAC. **160 fichiers étiquetés, vérité terrain par construction** : les
originaux sont authentiques par provenance, les transcodages sont faux parce qu'on les a fabriqués.

Reproductible : `scripts/make-corpus.mjs` (fabrication) + `analysis::corpus::corpus_scan` (mesure) +
`scripts/score-corpus.mjs` (matrice). Le corpus lui-même — 17 Go de dérivé — n'est pas versionné.

### Résultat

```
verite \ verdict        Ok    Grey    Fake   total
genuine                10       0       0      10
fake                  102       7      40     149

FAUX POSITIFS (authentique -> Fake) : 0/10  = 0,0 %
FAUX NEGATIFS (faux -> Ok)          : 102/150 = 68,0 %
  rattrapes en Grey                 : 7/150
```

**68 % des transcodages passent pour du lossless authentique.** Et la moyenne ment : la ventilation
par encodeur montre que le détecteur n'est pas « moyennement bon », il est **aveugle à des familles
entières**.

```
variante        n   detecte  rate   Grey   cutoff min..max
aac128          10        0     10      0   22050..22050  <-- RATE
aac256          10        0     10      0   22050..22050  <-- RATE
aacmf128        10        0     10      0   22050..22050  <-- RATE
aacmf256        10        0     10      0   22050..22050  <-- RATE
lame128         10        9      1      0   16817..22050  <-- RATE
lame160         10       10      0      0   17582..18002
lame192         10       10      0      0   18906..19391
lame256         10        2      1      7   19488..20004  <-- RATE
lame320         10        0     10      0   20177..20704  <-- RATE
lameV0          10        0     10      0   22050..22050  <-- RATE
mfmp3_128       10        9      0      0   15999..16699
mfmp3_320       10        0     10      0   22050..22050  <-- RATE
opus128         10        0     10      0   20215..24000  <-- RATE
vorbisq5        10        0     10      0   20941..22050  <-- RATE
wma192          10        0     10      0   20134..22050  <-- RATE
```

### Ce que la ventilation dit

**Ce qui marche : le MP3 à passe-bas dur, et rien d'autre.** LAME 128/160/192 et MediaFoundation 128
sont détectés à 38/40. C'est le cas d'école — l'encodeur brickwalle entre 16 et 19,4 kHz et la
falaise est franche.

**Ce qui passe en entier, et pourquoi :**

- **Tout l'AAC (40 fichiers, 4 variantes, 100 % raté)** — cutoff mesuré à 22050, c'est-à-dire
  *aucune falaise détectée*. Les encodeurs AAC modernes ne brickwallent pas comme le MP3 des années
  2000. Il n'y a rien à voir pour un détecteur de coupure.
- **LAME 320 (100 % raté)** — cutoff 20177 à 20704, donc **au-dessus** de `LOSSLESS_OK_HZ` = 20000.
  Le détecteur voit la falaise et la juge normale. C'était le cas dur prévu, il est confirmé.
- **LAME V0 et MediaFoundation 320 (100 % ratés)** — 22050, pas de passe-bas du tout.
- **Opus, Vorbis, WMA (100 % ratés)** — 20134 à 24000, au-dessus du seuil ou sans coupure.

**Le seul endroit où la zone grise travaille** est LAME 256 : 7 des 10 y tombent
(19488–20004 chevauche exactement `LOSSY_CLIFF_HZ` 19500 et `LOSSLESS_OK_HZ` 20000). C'est le
comportement voulu de la bande grise, et c'est la seule variante où elle sert.

**Zéro faux positif** sur les 10 authentiques — le correctif de l'étape 1 tient sur ce corpus.

### Ce que cette mesure ne dit pas

- **10 sources seulement**, toutes de la même famille musicale (house/techno achetée). Le taux de
  faux positifs à 0/10 n'est pas une garantie : c'est un échantillon de dix.
- **Aucun transcodage en chaîne** (lossy → lossy → lossless), qui est pourtant courant dans la vraie
  vie et probablement plus visible.
- **Rien sur les fichiers déjà en bibliothèque** : le corpus est fabriqué, pas trouvé.
- Une ligne du corpus a dû être écartée du dénominateur : `src02_mfmp3_128.flac` était un **fichier
  de 0 octet** laissé par un run avorté, que le `existsSync` nu du script faisait sauter au run
  suivant. Corrigé (`done()` exige une taille non nulle). Le compte d'erreurs du harnais est ce qui
  l'a rattrapé — un artefact vide était étiqueté comme un vrai faux.

### Un biais vérifié, et écarté

Les transcodages sortaient en **s32 (24 bit)** et les authentiques en s16, parce qu'un décodeur
lossy rend du flottant. Le corpus devenait séparable par la profondeur de bits seule — un artefact
du pipeline, pas de la fraude.

Vérifié plutôt que supposé : quatre variantes ré-emballées en s16 donnent des cutoffs **identiques**
(22050 / 16860 / 22050) ou à 12 Hz près pour Opus (20215 contre 20227, sous la résolution d'un bin),
et des verdicts identiques. Le biais ne portait pas la mesure. `-sample_fmt s16` est quand même posé
dans le script, pour que le corpus n'ait qu'une seule variable.

## Ce que ça implique — non tranché

Le détecteur repose sur **un seul signal** : la position d'une falaise spectrale. Ce signal existe
dans le MP3 à passe-bas dur et n'existe pas ailleurs. Aucun réglage de seuil ne rattrape ça : à
22050 Hz il n'y a rien à seuiller.

Rendre l'AAC et le haut débit détectables demande un **autre signal**, ce qui est une décision de
conception et pas un correctif. Pistes connues, non évaluées ici : la finesse de structure du haut
du spectre (les trous de quantification MDCT survivent au ré-encodage), l'énergie résiduelle par
bande au-dessus de 16 kHz plutôt que la position d'une coupure, ou le rapport taille FLAC / durée —
observé en passant pendant ce chantier, le ré-emballage d'un transcodage compresse **beaucoup moins
bien** que l'original (45 Mo contre 78–106 Mo pour la même piste), parce que le signal lossy n'a plus
la redondance bit-à-bit d'un master. Ce dernier est gratuit à mesurer et n'a jamais été essayé.

## Étape 3 — le cross-test Fakin' The Funk

Pas encore fait. Sa valeur a changé : avant, il aurait servi de second avis sur un détecteur dont on
ignorait la qualité. Maintenant, la question est précise et bien meilleure — **est-ce que FTF
détecte les 102 que Sift rate ?**

- S'il les détecte, sa méthode ne repose pas sur la position d'une coupure, et il vaut la peine de
  comprendre laquelle.
- S'il les rate aussi, le problème est dur pour tout le monde, et ça change ce qu'on peut
  raisonnablement promettre à un DJ.

Dans les deux cas c'est le corpus étiqueté qui sert de juge, pas l'accord entre deux logiciels : la
vérité terrain est de notre côté maintenant.

Le corpus se régénère par `node scripts/make-corpus.mjs <dossier-source> <dossier-sortie>`.
