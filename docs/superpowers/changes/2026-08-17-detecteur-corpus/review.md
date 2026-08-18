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
du spectre (les trous de quantification MDCT survivent au ré-encodage), ou l'énergie résiduelle par
bande au-dessus de 16 kHz plutôt que la position d'une coupure.

### Une piste écartée par la mesure — le taux de compression FLAC

Une version antérieure de ce document annonçait comme piste prometteuse le rapport taille FLAC /
durée : le ré-emballage d'un transcodage semblait compresser beaucoup moins bien que l'original
(45 Mo contre 78–106 Mo pour la même piste), le signal lossy n'ayant plus la redondance bit-à-bit
d'un master.

**C'était mesuré sur les fichiers contaminés par le biais s32.** Les transcodages étaient en 24 bit
et l'original en 16 : la moitié de l'écart annoncé était de la profondeur de bits, pas de
l'entropie. À profondeur égale (s16), sur la même piste :

| fichier | taille |
|---|---|
| authentique | 45,2 Mo |
| aac128 | **43,7 Mo** |
| opus128 | 46,1 Mo |
| lame128 | 70,7 Mo |
| lameV0 | 71,0 Mo |

Le signal existe pour le MP3 — mais le MP3 est justement la famille que le détecteur voit déjà.
Pour l'AAC il pointe **dans le mauvais sens** (le transcodage compresse *mieux* que l'original), et
pour Opus il ne dit rien. Autrement dit il est absent là où le trou est, et redondant là où il n'y
en a pas. La piste est écartée, et c'est la mesure qui l'écarte, pas une intuition.

## Élargir le corpus — ce que la provenance permet vraiment (2026-08-18)

Le côté authentique reposait sur 10 achats. Le chiffre fragile de l'étape 2 est le **0/10 en faux
positifs** : c'est lui qui protège Antoine de re-sourcer un bon fichier, et dix, c'est peu. D'où la
recherche de sources supplémentaires **de provenance établie**.

### Le piège du marqueur trop lâche

Les achats Beatport portent un marqueur écrit par le magasin. Premier essai : grep de la chaîne
`Beatport` n'importe où dans le fichier. Sur `BACKUP USB` (676 fichiers lossless, l'export Rekordbox
d'Antoine), **116 correspondances** — trop beau.

Le cas qui l'a démasqué, `Kyoto (Ariane Blank Remix).wav`, 77 Mo, `pcm_s16le` :

```
encoded_by : dBpoweramp 2024-05-30      <- pas Beatport
cutoff     : 16031 Hz  ->  FAKE
```

Acheté sur Beatport à l'origine — le commentaire `Purchased at Beatport` est encore là — puis
**converti localement en WAV**, et le cutoff à 16 kHz dit que la source de cette conversion était un
MP3 128–160 kbps. Le tag d'achat survit à la conversion ; il atteste l'origine du morceau, pas
l'intégrité du fichier.

Second essai, marqueur strict (`Encoded by Beatport` exact) : **rate 5 des 10 achats connus**, parce
que Beatport écrit tantôt `Beatport`, tantôt `Encoded by Beatport` dans le même champ.

Ce qui marche est de lire le **champ** `encoded_by`, pas de grepper les octets.

### Ce que `BACKUP USB` contient réellement

676 fichiers lossless, champ `encoded_by` lu un par un :

| `encoded_by` | fichiers | lecture |
|---|---|---|
| *(absent)* | 520 (77 %) | provenance inconnue |
| `dBpoweramp` (3 versions) | 123 | converti localement, source inconnue |
| `Lavf60.3.100` | 17 | converti localement (ffmpeg) |
| `Beatport` / `Encoded by Beatport` | **13** | fichier de magasin |
| autres convertisseurs | 3 | — |

**12 titres uniques** utilisables, tous `Ok` (cutoff 20241 à 22050). Le corpus passe donc de 10 à
22 sources authentiques — l'échantillon qui porte le taux de faux positifs plus que double.

### Le chiffre inconfortable, et ce qu'il ne prouve pas

Sur les 123 fichiers convertis au dBpoweramp, Sift en flague **3**. Ce n'est pas rassurant : c'est
un **plancher**. Le détecteur rate 68 % des transcodages de notre corpus et ne voit rien de l'AAC ni
du haut débit, donc les 89 « Ok » de cette population sont exactement les fichiers dont on sait
qu'ils ont été reconvertis depuis quelque chose, et dont le détecteur actuel ne peut pas dire quoi.

⚠️ On ne peut PAS en tirer un nombre de faux cachés. Extrapoler 3 avec le taux de détection du
corpus supposerait que les conversions d'Antoine ont le même mélange d'encodeurs sources que nos 15
variantes, ce que rien n'établit. Le seul énoncé soutenable est qualitatif : **le nombre réel est
supérieur à 3, d'un facteur inconnu.**

## Comment FTF décide, et pourquoi il plafonne au même endroit que nous (2026-08-18)

Établi depuis **ses propres fichiers de langue et sa base de réglages**, pas par désassemblage :
son algorithme n'a pas été lu et n'a pas été copié.

Son unique critère de faux, verbatim (`Languages\en-US.txt`) :

```
MSG_FAKE_FILE = Mr. Funk says: FAKE! Actual bitrate (%d) is lower than stated bitrate (%d)
```

Et le « débit réel » sort de la coupure : `Settings:CutoffLevl = 19600` (l'UI l'appelle
« Allow cutoffs above: »), placeholders `$frequency` et `$realbitrate` côte à côte, log
`Analyzing frequency (aggressive) for %s`. C'est **exactement notre branche lossy**, avec un seuil
au lieu de deux. Son mode « agressif » est vague dans sa propre interface : *« might detect more
fakes »*.

**Ce qu'il fait et pas nous** — un seul point compte : `Actual duration != stated duration`
(colonnes `Duration`/`ActualDuration`, peuplées et distinctes dans sa base). Nous prenons
`duration_sec` de l'en-tête et ne la comparons **jamais** au décodé (`analysis/mod.rs`), alors
qu'on décode déjà tout le fichier. C'est gratuit et ce n'est pas fait. Il a aussi une classe
CORROMPU distincte (silence long en plein morceau) et un `SupportFHGEncoder`.

**Ce que nous faisons et pas lui** : le désaccord de conteneur (un MP3 renommé `.flac` — rien dans
son schéma ni ses messages), la zone grise (il est binaire), phase/dual-mono/true-peak.

**Sa colonne `hasHole`** — la piste qui semblait la plus prometteuse — vaut **0 sur les 14 fichiers
de sa base**, dont de vrais MP3, et aucune chaîne d'interface ne la mentionne. Elle a l'air
vestigiale.

Son seuil de 19600 appliqué à **nos coupures déjà mesurées** donne 32 à 48 détections sur 150.
Nous : 40. **Les deux sont dans le bruit l'un de l'autre**, parce que c'est le même signal.

## Un signal qui double la détection — la platitude spectrale de l'aigu

Le plafond n'est pas un réglage, c'est le choix du signal. Deux candidats testés et **réfutés par la
mesure** avant celui qui marche :

- **Alignement sur la grille de trames du codec** (MP3 1152, AAC 1024) : les longueurs décodées sont
  **identiques** entre l'authentique et ses 7 transcodages (17 722 908 échantillons). ffmpeg honore
  les infos gapless dans les deux sens, la grille est effacée. Mort sur un corpus fabriqué
  proprement.
- **Corrélation des enveloppes aigu/médium** (hypothèse : un aigu resynthétisé par SBR suit la bande
  basse de trop près) : authentiques 0,48–0,65, faux 0,31–0,66. Se chevauchent. Mort.

**Ce qui marche.** Un encodeur lossy ne supprime pas l'aigu : il ne garde que ses coefficients les
plus forts et met le reste à zéro. L'aigu devient **clairsemé et pointu**, là où un master porte un
plancher de bruit continu. Ça se mesure par la platitude spectrale (moyenne géométrique / moyenne
arithmétique) de la bande 16-20 kHz, médiane sur les trames. Le sens est l'inverse de l'intuition
de départ : les transcodages sont **moins** plats, pas plus.

| | détecte | angle mort |
|---|---|---|
| coupure (Sift **et** FTF) | 40/150 = 27 % | AAC, LAME 320, V0, Opus, Vorbis, WMA |
| **platitude de l'aigu** | **91/150 = 61 %** | Opus seul (0/10) |

Elle attrape ce que la coupure rate entièrement : mfmp3_320 9/10, vorbisq5 8/10, wma192 8/10,
aac128 6/10, lameV0 5/10, lame320 3/10 — tous à 0/10 en coupure. Et elle garde 10/10 sur les LAME
128/160/192/256 que la coupure attrape déjà : **elle la domine sur ce corpus**, elle ne la complète
pas.

### La validation, parce que le seuil est ajusté

Le seuil (−5,4 dB) est le **minimum des 10 authentiques** — donc ajusté sur eux par construction, et
61 % serait un chiffre creux sans épreuve indépendante.

Épreuve : les **10 authentiques de `BACKUP USB`**, achats Beatport d'une autre provenance, qui n'ont
pas servi à fixer le seuil. Résultat : **−4,7 à −2,8 dB, zéro faux positif**. Les 20 authentiques
des deux jeux tiennent dans [−5,4 ; −2,6] ; les transcodages descendent à −43,8.

### Par trame contre LTAS — l'agrégation fait les deux tiers du signal

Le choix d'agréger la platitude **par trame** (médiane) plutôt que de la calculer sur le LTAS était
justifié dans le code par la seule robustesse aux trames de silence, avec la mention explicite que
le gain de séparation **n'avait pas été mesuré**. Il l'est maintenant — même corpus, même règle de
seuil (le plancher des authentiques) :

| agrégation | seuil | détection |
|---|---|---|
| **par trame, médiane** | −5,4 dB | **91/150 = 61 %** |
| LTAS, moyenne puis platitude | −3,1 dB | 56/150 = 37 % |

Et l'écart est concentré exactement sur les familles que la coupure rate :

| | par trame | LTAS |
|---|---|---|
| aac128 / aacmf128 | 6 / 3 | 1 / 0 |
| lame320 / lameV0 | 3 / 5 | 0 / 0 |
| mfmp3_320 | 9 | 4 |
| vorbisq5 / wma192 | 8 / 8 | 2 / 4 |
| lame 128/160/192/256 | 10 chacun | 10 chacun |

Sur les LAME que la coupure attrape déjà, **les deux formes font 10/10** : le par-trame n'apporte
rien là où le signal est franc, et tout là où il ne l'est pas.

Ça confirme le mécanisme supposé : la moyenne long terme détruit la structure temporelle qui trahit
l'encodeur — un aigu présent sur 10 % des trames et absent ailleurs y ressemble à un aigu faible
mais continu. C'est la même raison qui rend `detect_cutoff`, calculée sur le LTAS, aveugle à l'AAC.

**Ce que ça ne répare pas** : la marge du seuil est de **0,12 dB** entre le plus bas authentique et
le suivant, dans les DEUX formes. La fragilité du seuil n'est pas un problème d'agrégation.

### Épreuve sur matériel musicalement différent (2026-08-18)

La réserve principale était que 20 authentiques house/techno ne disent rien du classique, de
l'ambient ou d'un master acoustique — le matériel dont l'aigu est naturellement clairsemé, donc là
où cette feature ferait ses faux positifs. Antoine a fourni **29 fichiers de son disque**, dont un
album de broken beat acoustique entier (Kaidi Tatham, 15 titres) et deux titres ambient.

**24 passent, 5 flaguent.** Et les 5 sont invisibles pour la coupure : `Ok`, cutoff 22050 partout.

| matériel | platitude |
|---|---|
| Kaidi Tatham, 15 titres acoustiques | −2,5 à −5,3 dB — tous ok |
| Nova Tekk ambient ×2 | −2,9 / −3,1 dB — ok |
| divers house/électro (8) | −2,8 à −5,3 dB — ok |
| **Sheeq — Just B4** | **−6,5 dB** |
| **Alex Neri, EP entier (4 titres)** | **−10,8 à −12,7 dB** |

**Le cas redouté n'a pas cassé** : l'album acoustique passe en entier, l'ambient aussi.

Forme spectrale de l'EP Alex Neri, mesurée : décroissance régulière jusqu'à −47 dB à 19 kHz puis un
**plateau plat à −49 dB** de 19 à 20,5 kHz. Ce plateau est un plancher de bruit, pas du contenu — il
n'y a plus rien de musical au-dessus de ~18 kHz, dans un fichier déclaré **24 bits** (2117 kbps).
Témoin passant (Kaidi Tatham) sur la même mesure : −17 à −23 dB de vrai contenu jusqu'à 20 kHz.
La coupure rend 22050 sur les deux, parce que la pente ne fait jamais 18 dB sur 500 Hz.

**Deux réserves qui restent ouvertes :**

1. **La marge est trop mince pour livrer.** Plusieurs authentiques sont à −4,8 / −5,0 / −5,3 pour un
   seuil à −5,4. Sur du matériel encore plus varié les faux positifs commenceraient juste en
   dessous. Le seuil ne peut pas rester le minimum observé ; il faut soit une marge décidée, soit
   une bande grise comme pour la coupure.
2. **Rien ne PROUVE que les 5 flagués sont des faux.** La mesure dit que leur aigu s'arrête tôt sur
   un plancher — indication forte, pas preuve. Seule la provenance trancherait, et elle n'est pas
   établie pour ces fichiers.

### La référence consolidée — 44 fichiers, et une distribution bimodale

La réserve qui restait était la fragilité du seuil : « 0,12 dB entre le plus bas authentique et le
suivant ». Consolidation de tout ce qui a été mesuré, trois provenances d'achat indépendantes et
trois familles musicales :

| jeu | n | plage |
|---|---|---|
| corpus Beatport | 10 | −5,4 à −2,6 |
| corpus Beatport clé USB | 10 | −4,7 à −2,8 |
| fournis par Antoine, ceux qui passent | 24 | −5,3 à −2,5 |
| **référence élargie** | **44** | **−5,4 à −2,5** |
| les 5 écartés | 5 | −12,7 à −6,5 |

**La lecture de la « marge » était fausse.** La borne basse n'est pas un point isolé : trois
fichiers y convergent (−5,4 / −5,3 / −5,3). Un minimum unique serait un accident d'échantillon ;
un amas est une frontière. Et la distribution est **bimodale** — 44 fichiers d'un côté, **un vide
de 1,1 dB**, puis 5 fichiers entre −12,7 et −6,5. Il n'y a rien entre −6,5 et −5,4.

Les 44 couvrent house/techno acheté, ambient (Nova Tekk), et un album de broken beat acoustique
entier (Kaidi Tatham, 15 titres) — le matériel dont on craignait qu'il fasse des faux positifs.

**L'exclusion des 5 est un jugement, pas une mesure**, et il faut le lire comme tel. Sa raison :
le vide qui les sépare, plus l'inspection spectrale de l'un d'eux (contenu s'arrêtant à ~18 kHz sur
un plancher plat à −49 dB). Deux populations, pas une queue de distribution. Mais **ils sont
achetés eux aussi** — donc ces bornes décrivent « un master à bande pleine », pas « un fichier
légitime ». Un master volontairement sombre tombera dessous sans être fautif, et c'est exactement
pourquoi l'affichage n'accuse pas.

### Ce que ça n'établit toujours pas

- **20 fichiers authentiques**, tous house/techno achetée. Du classique, du jazz, de l'ambient, un
  master analogique ancien — tout ce dont l'aigu est naturellement clairsemé — n'a **pas** été
  testé, et c'est exactement là que cette feature ferait des faux positifs.
- **Opus reste invisible** (0/10) : il ne creuse pas l'aigu.
- Rien sur les transcodages en chaîne, ni sur les fichiers réels de la bibliothèque.
- La sonde est `scripts/hf-flatness-probe.mjs` ; **rien n'est branché dans le détecteur**. C'est un
  candidat mesuré, pas une décision.

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
