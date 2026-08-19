# DESIGN.md — socle de design Sift

> Créé le 2026-08-19, phase 2 de la reprise UI/UX (skill `sift-macos-ui`).
> Ce fichier est la **couche de décision**. Il ne remplace pas `frontend/styles.css`,
> qui reste la **valeur** canonique des tokens. Un chiffre écrit ici sans être dans
> `styles.css` est une proposition, pas un fait.

## Précédence

Quand deux sources se contredisent, l'ordre est :

1. **Ce fichier**, pour les décisions systémiques validées.
2. **`frontend/styles.css`**, pour la valeur exacte d'un token.
3. **`docs/design-system/`** (6 fichiers) et `docs/design-system-states.md`, pour
   l'historique daté et les états réels des composants.
4. **Apple HIG**, pour toute question que les trois précédents ne tranchent pas.

Une recommandation qui ne s'appuie sur aucun des quatre se marque
« proposition, sans source ».

## Ce que ce socle ne décide pas

Les specs d'écran sont la **phase 4**, dans `docs/ui-specs/<vue>.md`. Ce fichier n'en
tient que l'index. Le shell et le mapping des écrans, eux, sont ici — sections 14 à 17.

---

## 1. Produit et utilisateur

Sift est un poste de décision avant le set, jamais pendant le live. Principe
central : **déplacer = encoder + ranger**.

L'utilisateur cible est un DJ qui traite de gros volumes — la bibliothèque est
dimensionnée à 15k–100k lignes dans les bancs du dépôt (`src-tauri/src/bench_volume.rs`).
Il accepte la densité si elle est lisible, stable et honnête. Il vit au clavier.

Conséquences non négociables :

- densité avant décoration ;
- vocabulaire métier, libellés courts, aucun ton pédagogique ;
- aucune information critique portée par la seule couleur ;
- un état permanent reste neutre ; seule sa transition se colore, brièvement.

Barre de qualité : le niveau **et la structure** des apps macOS système. Chaque vue
reprend le patron de celle qui a déjà résolu son problème — Finder et Music pour
parcourir, Réglages Système pour configurer, Utilitaire de disque pour une opération
longue, Moniteur d'activité pour du temps réel.

Anti-références : dashboard SaaS décoratif, landing page, suite audio surchargée,
interface consumer colorée, empilement de cartes sans hiérarchie.

---

## 2. Typographie

### Familles

| Rôle | Token | Valeur |
|---|---|---|
| Interface | `--font-ui` | `"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| Nombres, chemins, mesures | `--font-mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` |

Les deux familles sont auto-hébergées via `@fontsource` (`frontend/main.ts`) : l'app
ne fait aucune requête réseau pour une police. **Trois graisses chargées par famille**
— 400, 500, 600. Ne jamais écrire une graisse non chargée : le moteur ne signale
rien, il synthétise, et `document.fonts.check()` répond `true` même sans la face.
`test/font-weights.test.ts` confronte les imports de `main.ts` aux graisses demandées
par `styles.css` à chaque `npm run test`.

### Échelle

Sept crans, **seules valeurs autorisées** :

```
--text-xs:10px  --text-sm:11px  --text-md:12px  --text-base:13px
--text-lg:15px  --text-xl:20px  --text-2xl:32px
```

Deux registres, et la coupure entre eux est le point de l'échelle :

- **Donnée — 10 à 13 px.** Listes, tables, métadonnées, chips. Environ 80 % du texte
  peint. Ces quatre crans ne bougent pas : ce sont eux qui portent la densité.
- **Titre — 15, 20, 32 px.** L'écart avec le registre donnée est ce qui fait lire un
  titre comme un titre.

`--text-base:13px` est exactement la taille par défaut de macOS dans les HIG.
`--text-xs:10px` est exactement le plancher de lisibilité qu'elles fixent. **Rien ne
descend sous 10 px**, ni par token ni par littéral. Deux crans inférieurs ont existé
(9 px, 8 px) et ont été retirés le 2026-08-05.

### Tracking

```
--tracking-normal:.01em  --tracking-wide:.03em
--tracking-wider:.05em   --tracking-widest:.06em
```

Le tracking se dérive de la **taille**, jamais du goût : plus la taille descend, plus
le tracking s'ouvre. Les en-têtes de colonne en capitales (`.col-h`) emploient
`--tracking-wider`.

---

## 3. Grille et espacement

Base 4. Six valeurs, **seules autorisées** :

```
--space-4  --space-8  --space-12  --space-16  --space-24  --space-32
```

Règles d'application :

- **4** — écart intra-composant (icône ↔ libellé, deux lignes d'un même bloc).
- **8** — écart entre éléments frères d'un même groupe.
- **12** — écart entre groupes dans un panneau. C'est le pas par défaut de
  `.sift-screen-stack`.
- **16** — padding intérieur d'une boîte, écart entre deux panneaux.
- **24** — marge de fenêtre. `#content` l'emploie sur ses quatre côtés.
- **32** — respiration exceptionnelle, à justifier.

`npm run lint:tokens` refuse un espacement en dur qui contourne un token.

### Rayons

Un seul nombre pilote l'échelle :

```
--border-radius-base:14px
--border-radius-sm: calc(base - 6px)   /*  8px */
--border-radius-md: calc(base - 4px)   /* 10px */
--border-radius-lg: base               /* 14px */
--border-radius-pill:999px
```

Rayon imbriqué : il se dérive du conteneur, jamais choisi séparément. Un élément
dans une boîte `lg` prend `md` ; dans une boîte `md`, il prend `sm`.

### Mesures et hauteurs

| Token | Valeur | Rôle |
|---|---|---|
| `--measure-data` | 1200px | Largeur maximale d'une surface portant de la **donnée mesurée** (spectrogramme). ⚠️ Dupliqué côté Rust dans `analysis::spectrum::MAX_COLS` et épinglé par `analysis::spectrum::tests::css_data_measure_matches_max_cols` — éditer l'un sans l'autre fait tomber `cargo test`. |
| `--h-40` | 40px | Hauteur de contrôle. Seule hauteur déclarée : le dépôt supprime tout token sans consommateur. |
| `--titlebar-h` | 30px | Barre de titre custom. Partagée entre `chrome.ts` et le bandeau de mise à jour. |

**Règle du dépôt, à respecter dans ce fichier aussi : on ne déclare pas un token qui
n'a pas de consommateur.** `--h-32` et `--h-44` ont été supprimés pour cette raison.

---

## 4. Couleur

Toutes les valeurs sont en **OKLCH**, dans `frontend/styles.css`. Ce fichier n'en
recopie aucune : la valeur exacte se lit là-bas.

### Trois blocs, toujours les trois

Une édition de token doit rester cohérente dans :

1. `:root` (`styles.css:11`) — thème clair ;
2. `@media (prefers-color-scheme:dark) > :root:not([data-theme="light"])` (`:266`) ;
3. `:root[data-theme="dark"]` (`:329`) — override explicite du réglage Apparence.

Comparer les valeurs **résolues** des deux tokens dans les deux thèmes, pas leurs noms.
⚠️ Une feuille injectée pour tester un override doit s'écrire `:root:root:root` : le
bloc sombre du dépôt est de spécificité (0,2,0), un `:root` simple perd silencieusement.

### Neutres — quatre plans, pas plus

```
fond  <  chrome  <  contenu  <  surélevé
```

`--color-background-primary` (fond) · `--color-background-tertiary` (chrome : rail de
navigation et colonne de file, même couche) · `--color-background-secondary` (contenu,
et **aussi** l'état actif : un élément sélectionné est promu au niveau du contenu, il
n'a pas de gris à lui) · `--color-surface-raised` (popover, bouton surélevé).

Base neutre = gris système d'Apple, teinte H≈286. Provenance citable : table
« iOS system gray colors » des HIG, valeurs publiées en texte. Écart assumé et nommé :
ce sont les gris **iOS**, Apple ne publiant aucune valeur chiffrée pour macOS.

### Sémantique — quatre teintes, un sens chacune

| Teinte | Sens | Ne jamais employer pour |
|---|---|---|
| Vert (`success`) | Sain, lossless authentique, terminé | Une progression de lecture |
| Ambre (`warning`) | Doute, décision attendue, en attente | Un risque réel |
| Rouge (`danger`) | Risque réel, faux lossless, destructif | Un simple avertissement |
| Bleu (`info`) | Interactif, focus, sélection, lien | Un verdict |

Quatre niveaux d'encre : `--color-text-primary` → `quaternary`. Les fonds sémantiques
sont **opaques**, jamais en alpha : un fond alpha se compose différemment selon le gris
sous-jacent, et le contraste mesuré descendait à 3,37:1 sur les cartes les plus sombres.

### Aplat d'accent — le fond d'un bouton primaire, et rien d'autre

`--color-accent-fill` + `--color-accent-ink`, ajoutés le 2026-08-19. Un bouton primaire macOS
est un **aplat** d'accent avec du texte blanc (kit Big Sur, § 02-Buttons / 01-Push Buttons) ;
Sift n'avait aucun token pour ça — `--color-background-info` est un fond *pâle* et
`--color-hue-blue-solid` interdit le texte par-dessus, son propre commentaire le dit.

Les deux sont **theme-invariants**, comme `--color-text-on-scrim` : ce couple ne se pose pas sur
une surface de l'app, il **est** sa propre surface, et c'est le rapport interne de la paire qu'on
veut constant.

La valeur **est** le systemBlue d'Apple (`--color-hue-blue-solid`, L 60,28 %). Blanc dessus mesure
~3,9:1, donc sous le plancher AA — voir la portée ci-dessous.

⚠️ Le **fond** d'un bouton secondaire ne fait que 1,86:1 contre la page, sous le 3:1 des HIG pour un
élément d'interface non textuel. Le kit fait le même écart (~2,3:1 sur carte sombre) : la lisibilité
d'un bouton vient de son texte, mesuré à 8,12:1.

### Portée du plancher de contraste — révisée le 2026-08-19

Décision d'Antoine, et elle prime sur ce que la section dit plus haut : **Sift est son outil
personnel, pas un produit à auditer.** Le plancher AA 4,5:1 cesse d'être une contrainte bloquante.

Ce que ça change : un arbitrage entre *fidélité au kit* et *ratio de contraste* se tranche
désormais en faveur de la fidélité. `--color-accent-fill` en est le premier cas — il avait été
assombri à L 46 % pour atteindre 7:1, il est rendu à la valeur d'Apple.

Ce que ça ne change pas : la **lisibilité** reste un critère de qualité, pour un lecteur d'un seul
utilisateur comme pour mille. Un texte qu'on ne lit pas confortablement reste un défaut, mesuré ou
non. Et les deux règles issues de défauts réels tiennent, parce qu'elles ne parlent pas
d'accessibilité mais d'honnêteté : l'atténuation d'un état ne se fait pas à l'opacité, et « échec »
est l'information qu'on n'a pas le droit d'estomper.

Corollaire pratique : aucun attribut ARIA n'est ajouté aux composants neufs. Ceux déjà en place
restent — les retirer coûterait du temps pour rien et casserait des sélecteurs de test.

Deux encres qui ne basculent **jamais** avec le thème, parce qu'elles se posent sur des
pixels d'image et non sur une surface de l'app : `--color-text-on-scrim` et les deux
scrims `--overlay-scrim` / `--overlay-scrim-caption`.

### Accents catégoriels

Les neuf `--color-hue-*-solid` sont réservés aux **taxonomies** : familles de genre,
segments de graphique d'occupation, couleur de dossier source. Jamais un titre de
section, jamais un état. Les variantes `-bg` / `-text` sont des couleurs de puce ; les
`-solid` sont des aplats de donnée et ne portent jamais de texte.

### Contraste

Plancher **AA 4,5:1** partout. Cible **7:1** pour une couleur personnalisée sur du
petit texte, conformément aux HIG Dark Mode.

Deux règles issues de défauts réels :

- **L'atténuation d'un état ne se fait pas à l'opacité.** Aucune valeur d'opacité ne
  franchit 4,5:1 avant ~0,92, où l'atténuation ne se voit plus. Le levier est le token
  (`--color-text-secondary` au lieu de `primary`).
- **« Échec » est l'information qu'on n'a pas le droit d'estomper.** Un fichier dont
  l'analyse a échoué doit se voir **mieux** que les autres, pas moins bien.

---

## 5. Surfaces — la grammaire de boîte

### État mesuré le 2026-08-19

Cinq classes se disputent le même travail. Comptage exact des occurrences dans
`frontend/` et `index.html` :

| Classe | Occurrences | Ce qu'elle fait vraiment |
|---|---|---|
| `.sift-ui-card-soft` | 19 | Fond secondaire + bordure |
| `.sift-ui-card-soft-pad` | 14 | Son padding (16 px) |
| `.sift-ui-card-outline` | 8 | Bordure seule — **7 usages sur 7 dans `rekordbox-view.ts`**, chacun avec `padding:10px 12px` en style inline |
| `.sift-ui-card` | 7 | Fond, sans bordure |
| `.sift-ui-card-pad` | 4 | Son padding |

`.sift-ui-card-outline` n'est pas un troisième niveau sémantique : c'est **la ligne de
Rekordbox**, rembourrée à la main sept fois, avec un `10px` qui n'appartient à aucune
échelle.

### Décision

**Deux niveaux, pas cinq.**

1. **Contenu** — `.sift-ui-card` : fond, pas de bordure. La surface sur laquelle vit la
   donnée.
2. **Chrome doux** — `.sift-ui-card-soft` : fond secondaire + bordure. Un groupe de
   contrôles, un panneau latéral, un avertissement.

Le padding reste une classe séparée (`-pad`, `-soft-pad`) pour qu'une boîte sans
padding reste possible.

`.sift-ui-card-outline` disparaît : ses 7 sites deviennent une classe de **ligne**
propre à Rekordbox, avec un padding pris dans l'échelle. Le geste appartient à la
phase 3, pas ici.

**Une boîte est une décision, pas une décoration.** Si un bloc ne contient qu'une seule
information, il ne prend pas de boîte : l'espacement suffit à le grouper.

---

## 6. Motion

```
--duration-fast:100ms   --duration-base:150ms   --ease-out:cubic-bezier(.2,0,0,1)
```

### État mesuré le 2026-08-19

`frontend/styles.css` porte **37 déclarations `transition:`**, dont **2** référencent un
token de durée. Les littéraux emploient **9 durées distinctes** : `.08s .1s .12s .15s
.16s .18s .2s .25s .3s`. Une échelle à deux valeurs, neuf valeurs en usage.

### Décision

Trois durées, et elles couvrent tout :

| Token | Valeur | Emploi |
|---|---|---|
| `--duration-fast` | 100 ms | Retour immédiat sous le doigt : survol, pression, bascule |
| `--duration-base` | 150 ms | Changement d'état visible : sélection, ouverture de popover, apparition de chip |
| `--duration-slow` | 250 ms | **Nouveau.** Déplacement de matière : pouce de contrôle segmenté, panneau qui s'ouvre, progression |

Une seule courbe, `--ease-out`. Une entrée sort de la courbe ; une sortie est linéaire
et plus courte.

### Ce qui ne s'anime jamais

- La **donnée**. Une valeur qui change de chiffre change de chiffre.
- Un verdict, un compte, une durée, un BPM.
- Tout ce qui est peint par un renderer appelé en rafale (progression, watcher, scroll,
  resize). Ces renderers créent leurs nœuds une fois et mutent ensuite — un
  `innerHTML =` dans une boucle d'événements n'anime rien de toute façon, et coûte.

### Ce qui s'anime

`transform` et `opacity`, jamais autre chose. Une transition qui vise `background`,
`width` ou `height` est un défaut de conception : elle force une recomposition.

### Mouvement réduit

Le bloc `@media (prefers-reduced-motion:reduce)` en fin de `styles.css` **met les durées
à zéro, il ne supprime pas les animations**. C'est délibéré : `animationend` doit
continuer à se déclencher, sinon `filing-identify.ts` reste bloqué sur
`.sift-identified-flash` / `.sift-applytags-flash`.

---

## 7. Barre de titre

`decorations: false` (`src-tauri/tauri.conf.json:22`) sur les deux cibles. La barre est
du HTML, haute de `--titlebar-h` (30 px), et c'est le levier principal du rendu macOS
sur Windows.

Deux zones réelles, jamais un dégradé simulé :

- **Gauche** — largeur du rail de navigation, ton du rail
  (`--color-background-tertiary`), bordure droite identique à celle du rail. La ligne
  verticale court sans interruption de la barre de titre jusque dans le rail.
- **Droite** — ton du contenu.

Aucune ligne horizontale n'est ajoutée dans cette barre.

Boutons de fenêtre : carrés alignés à droite hors macOS ; trois pastilles rondes à
gauche sur macOS (`.sift-tb-mac`). Même markup, même câblage — seuls le placement et le
style diffèrent.

**Décision de phase 2 :** le titre de la barre est aujourd'hui le littéral `Sift`
(`chrome.ts:214`), jamais la vue courante. La barre devient porteuse du **titre de la
vue** et fusionne avec la toolbar. Le `.h1` que chaque écran réémet dans son contenu
disparaît, ainsi que le `<h1 class="sift-sr-only">` de `index.html` qui doublonne avec
lui. Géométrie exacte : phase 3.

---

## 8. États systémiques

Définis une fois ici, jamais redécidés par un écran.

| État | Rendu | Règle |
|---|---|---|
| **Repos** | Aucun traitement | Un état confirmé permanent reste neutre |
| **Survol** | `--overlay-hover` | Aplat, jamais une bordure colorée |
| **Focus visible** | `outline:2px solid var(--color-border-info); outline-offset:1px` | Sur tout élément interactif, via `:focus-visible`. Une saisie remplace l'anneau par une bordure `--color-text-info` |
| **Sélection** | `--color-background-secondary` | Promue au plan du contenu. Jamais un accent coloré, jamais une bordure latérale |
| **Chargement** | Squelette ou libellé sobre **dans la structure finale** | Ne jamais vider l'écran pour recharger : si des données valides sont affichées, elles restent jusqu'à l'arrivée des nouvelles |
| **Vide** | `emptyStateHtml()` | Titre, note, une action. Distinguer « rien du tout » (impasse, retour vers Revue) de « ce filtre ne rend rien » (les filtres restent à l'écran pour être défaits) |
| **Erreur** | Carte douce, encre `danger`, bouton Réessayer discret | **L'erreur passe avant tout le reste** : après un scan échoué on ne dit rien sur le contenu. Affirmer « aucun doublon » après un échec, c'est affirmer un fait non mesuré |
| **Opération en cours** | Zone de progression + action d'annulation | Patron Utilitaire de disque : cible → action → progression → rapport |

Deux garde-fous qui ne se négocient pas :

- **Jamais `window.confirm()` / `alert()` / `prompt()`.** Un clic synthétique en a déjà
  traversé un et rangé 265 pistes. La confirmation est in-app, **armée et horodatée**
  (`confirm-modal.ts`, `BATCH_CONFIRM_THRESHOLD`). Elle ne vise pas la réversibilité —
  le rangement est annulable — elle vise un clic qui n'est pas humain.
- **Toute donnée non fiable rendue via `innerHTML` passe par `esc()`** (`dom.ts`). Son
  contrat s'arrête au texte et aux valeurs d'attribut **entre guillemets**. Le premier
  `href="${…}"`, attribut non quoté ou donnée dans un `<script>` demande une **seconde**
  fonction, jamais un `esc()` élargi.

---

## 9. Clavier et focus

### État mesuré le 2026-08-19

Quatre raccourcis d'action, tous derrière `if (!state.track) return` (`filing.ts:584`),
donc **Revue uniquement** : Espace, Entrée, ⌫ / X, I. Plus ↑ ↓ dans la file
(`queue-panel.ts:263`). Hors Revue il reste **un** raccourci dans toute l'app : ⌘Z /
Ctrl+Z (`filing.ts:617`). `installNavKeyboard` (`chrome.ts:278`) n'ajoute aucun
raccourci — il réémet un clic sur Entrée/Espace pour un élément **déjà focalisé**.

Sept écrans sur huit exigent la souris, pour une cible qui vit au clavier.

### Décision

**Trois couches, et chacune a une portée nette.**

**Couche 1 — fenêtre.** Disponible partout, quel que soit l'écran.

| Raccourci | Action |
|---|---|
| ⌘/Ctrl + 1…8 | Aller à la n-ième destination du rail |
| ⌘/Ctrl + F | Placer le focus dans la recherche |
| ⌘/Ctrl + , | Réglages |
| ⌘/Ctrl + Z | Annuler la dernière action |
| Échap | Fermer le popover, la modale ou la recherche au premier plan |

**Couche 2 — liste.** Partout où une liste a le focus.

↑ ↓ déplacent la sélection · ⇧+↑↓ étendent · ⌘/Ctrl+A sélectionne tout · Entrée ouvre ·
⌫ écarte · Début/Fin vont aux extrémités.

**Couche 3 — écran.** Les touches propres à un écran, jamais un accélérateur à une
lettre qui écraserait la couche 2. Revue garde Espace (lecture), I (identifier),
Entrée (ranger), ⌫ (écarter).

### Règles de focus

- Un raccourci d'écran ne se déclenche **jamais** quand le focus est dans un `INPUT` ou
  un `TEXTAREA`.
- Un raccourci à une lettre retire le focus du bouton actif avant d'agir, pour que
  Espace n'active pas simultanément le bouton focalisé et la lecture.
- Une modale **piège** le focus (Tab boucle dedans) et le **restitue** à sa fermeture.
- Après un rebuild par `innerHTML`, le focus est perdu : tout écran qui se reconstruit
  sur une action doit reposer le focus explicitement.
- Aucune décision n'est atteignable à la souris seule.

---

## 10. Diff de tokens proposé

Trois entrées seulement. Chacune est justifiée par une duplication ou un manque
mesuré — aucune valeur nouvelle n'est inventée.

### D‑1 · `--rail-w:152px` — nouveau

```diff
+--rail-w:152px;
```

**Preuve.** `152px` est écrit deux fois, dans deux fichiers : `styles.css:417` (`.sb`)
et `chrome.ts:161` (`#sift-tb-left`). Les deux **doivent** rester égales — la bordure
droite du rail continue dans la barre de titre, et un écart d'un pixel casse la ligne
verticale continue. Rien ne le garantit aujourd'hui.

Consommateurs à migrer : les deux ci-dessus. `chrome.ts` construit sa feuille en
JavaScript, elle peut écrire `var(--rail-w)`.

### D‑2 · `--pane-w:272px` — nouveau

```diff
+--pane-w:272px;
```

**Preuve.** `272px` est écrit trois fois : `app.js:39` (`QCOL_DEFAULT`), `app.js:112`
(style inline de `#homequeue`), `styles.css:1759` (`.sift-library-side`). Le
commentaire `styles.css:1754` documente déjà l'intention — « alignée sur la largeur
canonique de `#qcol`/`#homequeue` » — mais en **prose**, jamais en valeur. Sa largeur a
été rattrapée quatre fois de suite (150 → 190 → 245 → 272, `styles.css:1746-1758`) :
une valeur rattrapée quatre fois n'a jamais été dérivée.

`QCOL_DEFAULT` reste une constante JS — elle sert de valeur de repli avant lecture du
CSS. Elle **mire** le token, comme `shared/contracts.ts` mire les structs serde : même
discipline, même geste unique.

### D‑3 · `--duration-slow:250ms` — nouveau

```diff
--duration-fast:100ms;--duration-base:150ms;--ease-out:cubic-bezier(.2,0,0,1);
+--duration-slow:250ms;
```

**Preuve.** 37 `transition:` dans `styles.css`, 9 durées littérales distinctes, 2 seules
déclarations qui référencent un token. Les trois quarts des littéraux se rangent sous
100 ou 150 ms ; le reste (`.18s`, `.2s`, `.25s`, `.3s`) est un déplacement de matière
— pouce de contrôle segmenté, panneau, barre de progression — qui n'a pas de cran.
Sans lui, la migration des 37 sites est impossible sans écraser une intention.

### Non déclarés volontairement

- **`--toolbar-h`** — la toolbar n'existe pas encore. Le dépôt supprime tout token sans
  consommateur (`--h-32`, `--h-44`, `--h-36`). Il se déclarera en phase 3, avec sa
  première utilisation.
- **`--measure-form:560px`** — le littéral existe (`.sift-settings-stack`,
  `styles.css:1650`) et `styles.css:157` note que cette mesure de l'issue #9 n'est pas
  encore déclarée. Elle attend la décision de shell : voir § 11.

---

## 11. Décisions ouvertes

Quatre points que ce socle ne tranche pas seul.

### O‑1 · Outfit ou une famille plus proche de SF

Le brief de la skill nomme Inter comme candidat standard. **Le dépôt emploie Outfit**,
et ce n'est pas un défaut : trois graisses ont été chargées et alignées sur la table de
styles macOS d'Apple, où Medium est une graisse de première classe, et un test
(`test/font-weights.test.ts`) garde la correspondance. Changer de famille est une
décision d'identité, pas une correction. **Rien n'a été changé.**

### O‑2 · L'encre reste chaude sur des fonds devenus froids

`styles.css` le note explicitement : les tokens de texte sont restés à H≈77,5 quand les
surfaces sont passées à H≈286, et ils sont 2 à 4 fois plus chromatiques que les fonds.
Le coût **n'est pas** le contraste — mesuré, l'écart est de 0,02 au plus, et le plus bas
ratio reste au-dessus de AAA. C'est un choix esthétique en attente, pas un bug.

### O‑3 · Le plafond de 560 px

`.sift-settings-stack{max-width:560px}` laisse 44 % de la fenêtre vide sur Réglages et
Clé USB (fenêtre 1200 px, moins le rail 152 et le padding 2×24 : 1000 px utiles).

**La correction n'est pas d'élargir la colonne.** Réglages Système de macOS emploie
justement un panneau étroit — mais à côté d'une **sidebar de catégories**. Ce qui manque
n'est pas de la largeur, c'est la seconde colonne. Décision de phase 3.

### O‑4 · Le signal orange→vert décrit par le brief n'existe pas

Le brief de la skill présente un « signal de compatibilité orange→vert » comme identité
visuelle du produit, à ne jamais affaiblir. **Vérifié le 2026-08-19 : il n'existe pas.**
`frontend/styles.css` contient deux occurrences de `gradient`, toutes deux sur
`.sift-qresize` (la poignée de redimensionnement), et c'est un dégradé vertical
transparent → gris → transparent, sans rapport.

Le signal réel de Sift est **discret**, pas continu : des puces de verdict sur quatre
teintes sémantiques, avec un libellé texte (`LOSSLESS`, `FAKE`, `DUPLICATE`) qui rattrape
la couleur pour un daltonien. C'est meilleur qu'un dégradé pour ce travail — un dégradé
suggère un continuum là où le verdict est catégoriel.

**Aucun dégradé ne sera introduit sur cette base.** Si un signal continu est voulu, c'est
une décision produit à prendre explicitement, pas un existant à préserver.

---

## 12. Jargon conservé

Volontairement en anglais dans l'interface, ne pas « corriger » :

`LOSSLESS` · `DUPLICATE` · `MATCH` · `CHECK MATCH` · `FAKE` · `kbps` · `kHz` · `MP3` ·
`AIFF` · `WAV`

Ce n'est pas du jargon d'implémentation : c'est le vocabulaire professionnel de la
cible. Traduire dégraderait la reconnaissance.

---

## 13. Index des specs d'écran

Une ligne par écran. Le contenu vit dans `docs/ui-specs/`, jamais ici.

| Surface | Spec | Statut |
|---|---|---|
| **Rail** (zone B, tous écrans) | [`docs/ui-specs/rail.md`](docs/ui-specs/rail.md) | écrite |
| Bibliothèque — *table canonique* | [`docs/ui-specs/bibliotheque.md`](docs/ui-specs/bibliotheque.md) | écrite |
| Revue | [`docs/ui-specs/revue.md`](docs/ui-specs/revue.md) | écrite |
| Journal | [`docs/ui-specs/journal.md`](docs/ui-specs/journal.md) | écrite |
| Rekordbox | [`docs/ui-specs/rekordbox.md`](docs/ui-specs/rekordbox.md) | écrite |
| Clé USB | [`docs/ui-specs/cle-usb.md`](docs/ui-specs/cle-usb.md) | écrite |
| Réglages | [`docs/ui-specs/reglages.md`](docs/ui-specs/reglages.md) | écrite |

Les deux vues absorbées ne sont pas orphelines, elles ont une destination écrite :

| Vue absorbée | Où son contenu vit désormais |
|---|---|
| **Accueil** | `rail.md` (section Sources) · la porte de racine manquante remonte dans la barre unifiée, voir `reglages.md` |
| **Écartés** | `bibliotheque.md` — « À re-sourcer » et « Corbeille », deux sources de la même table |

⚠️ `docs/` est en liste blanche. `docs/ui-specs/` est ré-autorisé par `!docs/ui-specs/`
dans `.gitignore` — sans cette ligne le dossier n'existerait pas pour git, en silence.

Patron macOS de chacun : § 15. Ordre d'écriture : § 17.

---

# Phase 3 — Shell, mapping, table

## 14. Le shell unique

### La règle qui remplace les deux grammaires

Aujourd'hui l'app porte **deux grammaires incompatibles** : Revue et Accueil sont en
panneaux fixes sans défilement de page ; les six autres écrans passent par `block()`
(`app.js:33`) et laissent la page entière défiler. Le modèle mental change à chaque
changement d'écran.

Une seule règle les remplace :

> **Trois zones. Une seule flexe — celle qui porte l'objet d'attention. Les deux
> autres sont à largeur fixe. La page ne défile jamais ; chaque zone défile chez elle.**

C'est la règle de macOS lui-même, pas une invention : dans Finder la liste flexe et
l'inspecteur est fixe ; dans un éditeur de photo le canevas flexe et la palette d'outils
est fixe. La zone qui flexe est celle qu'on regarde.

### Les quatre zones

```
┌──────────────────────────────────────────────────────────────────┐
│ A · Barre unifiée        --toolbar-h                             │
├──────────┬───────────────────────────────┬───────────────────────┤
│          │                               │                       │
│ B · Rail │  C · Zone centrale            │  D · Inspecteur       │
│ --rail-w │                               │  --pane-w             │
│          │                               │                       │
│  fixe    │                               │  fixe, repliable      │
│ repliable│                               │                       │
└──────────┴───────────────────────────────┴───────────────────────┘
```

#### A — Barre unifiée (titlebar + toolbar fusionnées)

Une seule barre, jamais deux empilées. Elle absorbe l'actuelle barre de titre de 30 px.

De gauche à droite : contrôles de fenêtre (à gauche sur macOS, à droite ailleurs) ·
**titre de la vue courante** · actions contextuelles de la vue, deux ou trois au
maximum · modes de vue · **recherche, toujours à droite**.

Icônes seules avec infobulle, jamais de libellé sous une icône. Les espaces vides sont
zone de drag.

**Hauteur — dérivée, pas choisie.** La barre vaut le contrôle le plus haut qu'elle
porte, plus un cran d'espacement au-dessus et au-dessous. Le contrôle le plus haut est
le champ de recherche : `--text-md` sur une ligne, plus son padding vertical de 6 px,
soit ~29 px calculés depuis `styles.css`. D'où `--toolbar-h: 29 + 8 + 8 ≈ 44px`.

⚠️ `--titlebar-h` a un consommateur au-delà de `chrome.ts` : le bandeau de mise à jour
s'y positionne. Le passage de 30 à 44 doit le suivre dans le même geste.

#### B — Rail de navigation

Fixe, repliable. Porte la **teinte de chrome** (`--color-background-tertiary`), la même
que la zone gauche de la barre unifiée : la bordure verticale court sans interruption
de la barre jusqu'en bas du rail.

**Largeur — dérivée.** Le libellé le plus long est « Bibliothèque ». À `--text-base`,
plus l'icône (17 px), le gap (`--space-12`), le padding horizontal (`--space-8` × 2) et
un badge de compte à droite (~26 px + `--space-8`), le total dépasse les 152 px
actuels — ce qui explique qu'un seul item porte un badge aujourd'hui. `--rail-w: 200px`,
premier multiple de 8 qui loge l'ensemble, et la valeur tombe dans la bande 200–260 px
des apps système. **À confirmer par une mesure dans la vraie fenêtre avant
implémentation** : la largeur d'un texte ne se déduit pas d'un calcul.

Contenu groupé par sections, en-têtes en petites capitales discrètes, **un seul niveau
d'indentation**. Item actif : fond plein arrondi (`--color-background-secondary`),
jamais de bordure ni de barre latérale colorée.

⚠️ **Conflit tranché, à ne pas « corriger » à la prochaine passe.** Le kit Big Sur
(§ 06-Sidebars) montre l'item actif d'une sidebar en **bleu accent plein, texte blanc**.
Ce fichier l'interdit — ici même, et au § 8 : « Sélection : jamais un accent coloré ».
La précédence tranche (ce fichier avant le kit), et le motif tient : dans Sift, le bleu
est déjà pris par une sémantique (« interactif, focus, sélection, lien ») et par l'aplat
d'accent des boutons primaires. Un rail bleu ferait du rail la chose la plus accentuée
d'un écran dont le sujet est la table. Le rail garde son gris.

Replié, le rail garde ses icônes et perd ses libellés — il ne disparaît pas.
Raccourci de bascule : proposition ⌥⌘S sur macOS (convention Finder), Ctrl+B ailleurs.
**Marqué proposition — à vérifier dans les HIG avant d'être figé.**

#### C — Zone centrale

C'est presque toujours **la table** (§ 16). Deux exceptions, et elles sont nommées :
la surface de travail de Revue, et le panneau de formulaire de Réglages.

Défile chez elle, jamais en emportant les autres zones. Le champ de recherche, les
filtres et les en-têtes de colonne restent visibles quand la liste défile.

#### D — Inspecteur

Fixe à `--pane-w`, repliable. Affiche le détail de la **sélection courante**.

Sélection multiple : un **résumé agrégé** (nombre, formats, durée totale, actions
possibles), jamais un état vide. Sections repliables à en-têtes discrets ; libellé à
gauche en `--color-text-secondary`, valeur à droite en `--color-text-primary`.

**L'inspecteur n'est jamais un bloc dans le flux.** Aujourd'hui le détail de
Bibliothèque est rendu dans `#bibplayer`, placé après la liste et après la section
doublons : ouvrir une piste au rang 300 pousse son détail hors de l'écran.

### Les deux profils

Même trois zones, même règle. Ce qui change est **laquelle flexe**.

| Profil | Zone fixe gauche | Zone qui flexe | Zone fixe droite | Objet d'attention |
|---|---|---|---|---|
| **Parcours** | rail | table centrale | inspecteur | La liste |
| **Poste de décision** | rail + file (`--pane-w`) | surface de travail | — | La piste ouverte |

Le profil Poste de décision existe pour une raison mesurable, pas par confort : la
surface de travail de Revue porte le spectrogramme, borné à `--measure-data` (1200 px)
et **dupliqué côté Rust** dans `analysis::spectrum::MAX_COLS`. Une zone de largeur fixe
y présenterait de la donnée étirée ou tronquée — c'est-à-dire fausse, dans une app dont
le métier est de détecter du faux.

### Redimensionnement et persistance

- Rail : repliable, largeur non redimensionnable (elle est dérivée du contenu).
- File de Revue : redimensionnable, bornes 220–480 px, valeur persistée. Le mécanisme
  existe déjà (`app.js:39`) et ne change pas.
- Inspecteur : repliable, largeur non redimensionnable.
- Toute largeur persistée est relue au montage, jamais gardée dans une variable JS
  vivante — chaque changement d'écran reconstruit la zone.

---

## 15. Mapping des vues

Aucune vue orpheline. Deux fusions proposées, chacune avec son motif.

| Vue | Patron macOS | Profil | Zone C | Zone D |
|---|---|---|---|---|
| **Bibliothèque** | Finder / Music | Parcours | Table des pistes rangées | Détail de la piste |
| **Journal** | Console | Parcours | Table des actions, groupées par session | Détail de l'entrée + annuler |
| **Revue** | Finder + Utilitaire de disque (mode Lot) | Poste de décision | Surface de travail : lecture, verdict, identification, rangement | — (la file tient lieu de zone fixe) |
| **Rekordbox** | Utilitaire de disque | Parcours | Liste des candidats de la section choisie | Détail du candidat |
| **Clé USB** | Utilitaire de disque | Parcours | Liste des disques amovibles | Occupation + formatage du disque choisi |
| **Réglages** | Réglages Système | Parcours | Panneau du réglage choisi, borné à `--measure-form` | — (les catégories occupent la zone gauche) |

### Fusion 1 — Accueil disparaît dans le rail

**Motif.** Accueil ne montre qu'une chose : les dossiers surveillés et leur état de
scan. Dans Finder, une source n'est pas un écran — c'est une **entrée de sidebar**. Un
écran entier pour lister des sources est un détour : l'utilisateur y va pour en ajouter
une, puis en repart.

**Sort.** Les dossiers surveillés deviennent une section du rail (« Sources »), avec
leur pastille de couleur, leur compte de nouveaux fichiers et leur bascule de
surveillance au clic droit. Le bouton « ajouter un dossier » vit au pied de la section.
Cliquer une source **filtre Revue** sur ses fichiers.

**Ce que la fusion coûte.** La porte de premier réglage (racine de bibliothèque non
définie) perd son emplacement. Elle remonte dans la barre unifiée, comme bandeau
persistant tant que la racine manque — ce qui la rend d'ailleurs visible depuis tous
les écrans, pas seulement depuis celui qu'on quitte.

### Fusion 2 — RÉFUTÉE PAR LA MESURE, le 2026-08-19

Ce qui suit était la proposition. Elle repose sur « Écartés est une vue filtrée de la même
donnée », et **c'est faux** : `EcarteItem` porte **8 champs** contre **16** pour `LibraryTrack`
(`shared/contracts.ts`). Ni BPM, ni durée, ni format, ni genre, ni année, ni pochette. Les six
colonnes de la table rendraient donc cinq tirets sur six pour chaque ligne écartée.

Et l'écran porte **sept affordances** que la table n'a pas : `store` (liens boutiques pour
racheter la piste), `copy-query`, `requeue`, `restore`, `retry`, `trash`, `purge`. Ce sont elles
qui font l'écran — le fondre dans la table les perdrait ou obligerait à les y ajouter, donc à
transporter l'écran dans la table plutôt que l'inverse.

**Écartés reste une destination.** La moitié utile de la fusion a été faite : il vit dans la
section « Bibliothèque » du rail, à côté de « Rangés », donc la parenté se lit dans la navigation.
Ce qui manquait n'était pas la fusion, c'était le groupement.

Réouvrir cette décision demanderait d'abord d'enrichir `EcarteItem`, ce qui est un chantier
backend, pas de design.

### Proposition d'origine, conservée pour l'historique

**Motif.** Écartés est une **vue filtrée de la même donnée** : des pistes, avec un
statut. Finder ne fait pas un écran pour la Corbeille — c'est un item de sidebar qui
change le contenu de la même table.

**Sort.** Deux entrées dans la section « Bibliothèque » du rail : « À re-sourcer » et
« Corbeille ». Même table, mêmes colonnes, colonne Verdict qui porte le motif d'écart
(tronqué, faux, doublon). Les liens boutiques et l'action « purger » deviennent des
actions de la barre unifiée quand ces sources sont actives.

**Ce que la fusion coûte.** Rien de mesuré. Écartés a aujourd'hui ses propres hauteurs
de ligne (58 px et 42 px, `ecartes-view.ts:162,173`) : elles rejoignent celle de la
table, ce qui est le but.

### Bilan

**Huit destinations deviennent six.** Le rail passe de huit items plats à trois
sections : Traiter (Revue · Journal) · Bibliothèque (Rangés · À re-sourcer · Corbeille) ·
Exporter (Rekordbox · Clé USB), plus Réglages au pied. Les sources surveillées forment
une quatrième section, au-dessus.

### Sous-modes

- **Revue / Lot** — ce n'est pas un écran mais un **changement de zone C** : la surface
  de travail devient une table à cases à cocher. La file reste, le rail reste, la barre
  reste. La bascule vit dans la barre unifiée, en contrôle segmenté.
- **Bibliothèque / Table et Grille** — deux rendus de la même zone C, bascule dans la
  barre unifiée. Le tri est partagé entre les deux.
- **Rekordbox / 4 sections M8** — les quatre sections deviennent quatre **entrées de la
  zone gauche**, plus un item « Tout ». La zone C montre les candidats de celle qui est
  choisie. Cela résout l'empilement vertical de quatre cartes concurrentes.

---

## 16. La table centrale

L'écran de vie du DJ. Une seule table, un seul comportement, partout où il y a des
pistes : Bibliothèque, À re-sourcer, Corbeille, file de Revue, mode Lot.

### Colonnes par défaut

| # | Colonne | Largeur | Rendu |
|---|---|---|---|
| 1 | **Verdict** | fixe | Pastille + libellé (§ « Signal » ci-dessous) |
| 2 | Pochette | 44 px | Vignette, repli sur une icône de vinyle |
| 3 | **Artiste** | flex 1.4 | `--color-text-primary` |
| 4 | **Titre** | flex 1.4 | `--color-text-primary` |
| 5 | **BPM** | fixe | `--font-mono`, `tabular-nums`, aligné à droite |
| 6 | **Durée** | fixe | `--font-mono`, `tabular-nums`, aligné à droite |
| 7 | Genre | flex 1 | `--color-text-secondary` |
| 8 | Année | flex 0.6 | `--font-mono`, `tabular-nums` |
| 9 | Qualité | fixe | Pastille format + débit |

**BPM et Durée sont des ajouts, et ce sont les deux plus importants.** Les deux champs
existent déjà dans le contrat (`shared/contracts.ts:313-314`, `duration` et `bpm`), et
**aucun des deux n'est affiché** : la table actuelle trie sur Artiste, Titre, Genre,
Année (`library-views.ts:48-53`). Un DJ trie sa bibliothèque par tempo. L'information
est en base et n'atteint pas l'écran.

⚠️ **Tonalité et énergie n'existent nulle part.** Vérifié le 2026-08-19 : aucun champ
de tonalité dans `shared/contracts.ts`, aucune colonne dans `db.rs` (le seul `key TEXT`
est la clé de la table `settings`). Le brief de la skill dit que la cible pense en
« BPM, tonalité, énergie » : un tiers de cette phrase est affichable aujourd'hui, un
tiers l'est après ce changement, et le dernier tiers **n'est pas une décision de
design** — c'est de l'analyse à écrire côté Rust. Aucune colonne fantôme ne sera
spécifiée pour du vide.

### Tri, largeur, ordre

- **Toutes** les colonnes sont triables au clic sur l'en-tête, indicateur de direction
  visible, `aria-sort` tenu à jour. Aujourd'hui quatre le sont.
- Largeurs redimensionnables au glisser sur le séparateur d'en-tête, **mémorisées**.
  *Livré le 2026-08-19* (`frontend/library-columns.ts`). Source Apple : HIG « Lists and tables »
  § macOS, « Let people resize columns ». Bornes 48–600 px, `localStorage`, et une colonne
  non touchée garde sa règle CSS — c'est ce qui lui permet de continuer à suivre la largeur
  de la zone.
- Colonnes réordonnables au glisser, ordre mémorisé. *Livré le même jour.* Pas de source
  Apple : la page HIG ne parle que de réordonner des **lignes**. Cette règle vient d'ici,
  et se marque comme telle.
- **Un en-tête porte deux gestes.** Bouton de tri et poignée de déplacement sur le même
  élément, séparés par un seuil de 5 px de déplacement — sans lui, réordonner trierait
  aussi, deux effets pour un geste.
- ⚠️ La même page HIG conseille « Consider using alternating row colors ». Le § Densité
  ci-dessous l'interdit. Conflit tranché par la précédence (ce fichier avant les HIG), et
  l'argument d'Apple ne mord pas : il vise une table **large**, celle de Sift vit entre un
  rail et un inspecteur.
- Le tri est **partagé** entre Table et Grille, et **stable** : il ne se rejoue jamais
  sur un tick de données, seulement sur une action utilisateur.

### Densité

**Une seule hauteur de ligne pour toute l'app.** Aujourd'hui il y en a quatre —
34 px en Bibliothèque, 150 px en grille, 58 px et 42 px en Écartés
(`bibliotheque-view.ts:455,468`, `ecartes-view.ts:162,173`).

`--row-h: 32px`, dérivé : vignette de pochette 24 px (le plus petit format où une
pochette reste reconnaissable) plus `--space-4` au-dessus et au-dessous. C'est au-dessus
de la bande 24–28 px d'une liste Finder, et la raison est nommée : la ligne de Sift
porte une pochette, celle de Finder n'en porte pas.

Pas d'alternance de fond de ligne. La séparation vient de l'espace, pas d'un trait ni
d'un zébrage.

### Signal de compatibilité — une seule forme, partout

Le verdict est **catégoriel**, pas continu. Il se rend en **pastille pleine + libellé
texte**, dans la colonne 1, identique dans les cinq tables.

| Verdict | Teinte | Libellé |
|---|---|---|
| Lossless authentique | `success` | `LOSSLESS` |
| Authentique, rail lossy | `success` | `AUTHENTIQUE` |
| Faux lossless | `danger` | `FAKE` |
| Douteux | `warning` | `À VÉRIFIER` |
| Non analysé | neutre | `—` |

⚠️ **Révisé le 2026-08-19 contre les littéraux réels du backend** (`worker.rs::verdict_str` :
`ok` / `fake` / `grey`, plus NULL). Deux corrections mesurées, pas des choix : **`DUPLICATE` n'est
atteignable par aucune valeur de `tracks.verdict`** — un doublon sort du scan de dédoublonnage
(`DupGroup`) et se rend en mode Lot et en Revue, pas dans cette colonne ; et `ok` sur un fichier
lossy ne peut pas s'écrire `LOSSLESS` sans mentir — le libellé reprend le vocabulaire déjà présent
(`report-view.ts` « qualité authentique », `queue-panel.ts::verdictWord` « à vérifier »).
`LOSSLESS` exige les deux faits, comme `qualityChipTone` : verdict sain ET rail lossless.

Le libellé texte n'est pas décoratif : c'est lui qui rattrape la couleur pour un
utilisateur daltonien, et les HIG interdisent de porter un état par la seule couleur.
Il ne descend jamais sous `--text-xs` (10 px) et ne s'atténue jamais à l'opacité —
voir § 4, « l'échec est l'information qu'on n'a pas le droit d'estomper ».

**Aucun dégradé.** Un dégradé suggère un continuum là où le jugement est discret. Voir
§ 11, O‑4.

### Sélection multiple

Standard système, et **elle n'existe pas aujourd'hui** en Bibliothèque (les lignes sont
`data-bib="row"`, ouverture simple ; seul le mode Lot a des cases).

Clic = sélectionner · ⇧+clic = étendre la plage · ⌘/Ctrl+clic = ajouter ou retirer ·
⌘/Ctrl+A = tout · ↑ ↓ = déplacer · ⇧+↑↓ = étendre · Entrée = action principale ·
⌫ = écarter · Début / Fin = extrémités.

La sélection survit au tri et au changement de filtre tant que les lignes restent
visibles. L'inspecteur montre le résumé agrégé.

### Menu contextuel

**Il n'y en a aucun dans toute l'app** — vérifié le 2026-08-19, zéro gestionnaire
`contextmenu` dans `frontend/`. C'est le manque le plus coûteux de la table : chaque
action secondaire est aujourd'hui un bouton dans la ligne, et chaque bouton mange de la
largeur sur 15k lignes pour être utilisé sur une.

Le clic droit ouvre les actions secondaires : Ouvrir l'emplacement · Identifier ·
Fiche Discogs · Réanalyser · Changer la destination · Écarter · Restaurer.

**Reste dans la ligne :** le bouton lecture, et lui seul. C'est le geste primaire.

### Temps réel

Les mises à jour ne provoquent **aucun saut de layout** : largeurs stables, nombres en
chiffres tabulaires alignés à droite. Aucune animation sur une valeur qui change
souvent. Un renderer appelé en rafale crée ses nœuds une fois et mute ensuite.

---

## 17. Ordre d'implémentation

Du plus structurant au plus cosmétique. Chaque étape est livrable seule et laisse l'app
utilisable.

> **État au 2026-08-19.** Les dix étapes livrées et vérifiées dans la vraie fenêtre. Ce qui reste est nommé sous le tableau — pas « presque fini », la liste exacte.

| # | Étape | État | Débloque | Frictions closes |
|---|---|---|---|---|
| 1 | **Sortir la maquette du chemin de production** — `router.ts`, `app.js` hors Tauri | ✅ livrée | Tout le reste | F11 |
| 2 | **Barre unifiée** — `--toolbar-h`, titre de vue, recherche à droite | ✅ livrée | Recherche, actions, titre unique | F2, F9 |
| 3 | **Shell à trois zones** — plus de `block()`, inspecteur hors du flux | ✅ livrée | Le mapping entier | F1, F5, F6 |
| 4 | **Rail restructuré** — 3 sections + Sources, repli, fusion 1 | ✅ livrée | Navigation lisible, Accueil absorbé | F3 (accès) |
| 5 | **Table unique** — BPM, Durée, `--row-h`, menu contextuel, sélection multiple | ✅ livrée² | La vie quotidienne du DJ | § 16 |
| 6 | **Clavier couche 1** — ⌘1…8, ⌘F, ⌘,, ⌘B, Échap | ✅ livrée | L'usage sans souris | F4 |
| 7 | **Grammaire de boîte à deux niveaux** — `outline` retirée | ✅ livrée | Cohérence de surface | F8 |
| 8 | **Motion unifiée** — 54 durées sur trois crans | ✅ livrée | — | § 6 |
| 9 | **Réglages en deux colonnes** | ✅ livrée | — | F7, O‑3 |
| 10 | **Rekordbox en quatre entrées** | ✅ livrée¹ | — | F10 |

² Complète depuis le 2026-08-19 : navigation clavier de la table, puis actions de masse dans le
menu contextuel (Réanalyser · Écarter · Corbeille). Voir « Ce qui reste vraiment » pour ce qui n'a
pas été exécuté contre la base réelle.

¹ Vue tourner le 2026-08-19 sur un XML **réellement lié** (24 playlists, 2828 pistes) : cinq
entrées peintes, sélection exclusive, zone C qui suit. Reste non vérifié le rendu **avec des
candidats en attente** — les cinq comptes valent 0.

### Ce qui reste

**Fusion 1 — faite.** Accueil a disparu dans le rail : les dossiers surveillés y sont une section,
cliquer l'un d'eux filtre Revue, et la porte de racine manquante est remontée au niveau fenêtre.

**Fusion 2 — réfutée, pas reportée.** Voir § 15 : la mesure a montré que les deux écrans ne
portent pas la même donnée. Écartés reste une destination, groupée avec Rangés dans le rail.

**Sélection multiple — faite.** Clic, ⇧+clic, ⌘/Ctrl+clic, ⌘/Ctrl+A, et résumé agrégé dans la
zone D.

**Couche 2 du clavier — faite le 2026-08-19.** ↑ ↓ déplacent, ⇧+↑↓ étendent, Début/Fin vont aux
extrémités (`bibliotheque-view.ts::stepBibSelection`). Le déplacement se fait par **index** dans la
liste ordonnée et jamais en marchant sur les nœuds du DOM : la table est virtualisée, un parcours
du DOM s'arrêterait au bord de ce qui se trouve rendu. Une version antérieure de cette section
disait cette navigation impossible faute de gestion de focus de liste — c'était une conclusion
tirée du mécanisme envisagé, pas de la contrainte.

### Ce qui reste vraiment

**Actions de masse — faites le 2026-08-19.** Trois actions passent à N, et les trois sont
**mesurées contre le contrat IPC**, pas choisies : Réanalyser (`reanalyze_tracks` prend déjà un
tableau), Écarter (`reject_batch`, l'IPC du mode Lot), Corbeille (`trash_track` unitaire, bouclé
séquentiellement — le backend sérialise de toute façon derrière son Mutex). Identifier n'y est pas,
et c'est une décision : chaque identification demande de **choisir** un candidat. Le menu garde la
même liste d'entrées aux mêmes positions quelle que soit la taille de la sélection ; ce qui ne
s'applique pas est désactivé, jamais retiré. Motifs et tableau complet :
`docs/ui-specs/bibliotheque.md` § Décisions du 2026-08-19.

Vérifié dans la vraie fenêtre : sélection de 3 par ⇧+clic → les deux entrées singulières
désactivées, les trois autres portant `(3)`, résumé agrégé en zone D. Clic droit **hors** sélection
→ la sélection tombe à la ligne visée et le menu repasse en unitaire. **Non exécuté** : aucune des
trois actions n'a été lancée contre la base réelle — écarter ou jeter de vraies pistes n'est pas
une vérification à prendre seul.

**Rekordbox à quatre entrées : vu tourner le 2026-08-19.** L'affirmation précédente — « cette
machine n'a aucun XML lié » — était **fausse** : `C:\Users\LEETJ\Documents\rekordbox\library.xml`
est lié, 24 playlists et 2828 pistes. Les cinq entrées (Tout · Fichiers · Métadonnées · Pochettes ·
Playlists) sont peintes, la sélection est exclusive (`all*` → `files*`) et la zone C passe bien des
quatre sections à la seule choisie. Ce qui n'a **pas** été vu est le rendu avec des candidats en
attente : les cinq comptes valent 0, tout est « à jour ». Table de candidats, inspecteur de
candidat, sheet de progression et rapport restent donc non vérifiés — et le devenir demande une
divergence réelle entre Sift et Rekordbox, pas une manipulation à fabriquer.

**Colonnes redimensionnables et réordonnables — livrées le 2026-08-19.** `frontend/library-columns.ts`,
plus un menu contextuel d'en-tête (patron Finder) qui porte « Réinitialiser les colonnes ». Vérifié
dans la vraie fenêtre : glissement d'un séparateur, glissement d'un en-tête, tri **inchangé** après
un déplacement, réinitialisation qui vide le stockage. Deux planchers, et il en fallait deux : le
token `--col-min-w` empêche une colonne VOISINE de s'écraser (mesuré, Genre tombait à 35 px avec le
seul garde JS), le plafond dynamique de `startResize` empêche la ligne de déborder. Après correctif,
un glissement de 900 px donne Artiste 545, Titre 48, Genre 48, et `scrollWidth == clientWidth`.

**« Ouvrir l'emplacement » — livré le 2026-08-19.** Commande Rust `reveal_track` : prend un
`track_id`, jamais un chemin, parce que la branche Windows lance un processus. Câblée sur la
première entrée du menu et sur le double-clic. Chemin nominal exécuté dans la vraie fenêtre, et le
chemin d'erreur aussi — il a d'ailleurs trouvé une piste de la base dont le fichier n'existe plus
sur le disque, ce que la commande dit en toutes lettres au lieu d'ouvrir un dossier au hasard.

**Débordement de l'inspecteur — corrigé le 2026-08-19, et la cause n'était pas celle qu'on
cherchait.** `.sift-report-scroll` annonçait 369 px pour 287 alors que chacun de ses enfants
directs mesurait 287, parce que le coupable ne débordait pas par sa **largeur** mais par sa
**position** : `.sift-player-controls` porte `margin-left:82px` (alignement sur la forme d'onde,
conçu pour la surface large de Revue) et la surcharge de zone D lui donnait `width:100%` — 287 de
large à partir de 82, donc un bord droit à 369. Un filtre `scrollWidth > clientWidth` ne pouvait
pas le voir ; il fallait comparer les **bords droits**. Correctif : `margin-left:0` dans le seul
bloc `#sift-aside` (`styles.css`). Mesure après : `scrollWidth` 287 sur les deux conteneurs, zéro
élément dépassant à droite, et `.sift-volume-block` toujours replié à 20 px au repos.

**`.sift-volume-track` déborde et ce n'est PAS un défaut** — noté ici pour qu'un prochain passage ne
le « corrige » pas : le bloc de volume est volontairement replié à 20 px au repos et s'ouvre au
survol. Le corriger casserait le contrôle.

**`docs/archive/TECH_DEBT_AUDIT.md` porte une tâche ouverte (F08) sur un fichier supprimé** —
`frontend/home-sources.ts:40`. Archive, donc non corrigée dans ce geste, mais la case reste cochable
sur un fichier qui n'existe plus.

Étapes 1 à 3 : rien n'est visible pour l'utilisateur avant la fin de la 3. Elles se
livrent ensemble ou l'app reste à moitié dans deux shells.

---

### Sweep 2 — réconcilié au wrap-up du 2026-08-20

**Livré et poussé** (`813b83b` → `f475ae0`, audit du chantier :
`docs/superpowers/changes/2026-08-19-kit-sweep-2/audit.md`, local) :
- Composants restants alignés sur le kit : primaires en aplat d'accent partout (Revue,
  Rekordbox, modale), secondaires en aplat gris sans bordure, pop-up Destination, switch/range/
  tri-état sur l'accent, sélection et survol des catégories Réglages enfin visibles, un seul
  matériau de surface flottante, fonds sémantiques opaques, KEY-LOCK accent/gris, Stop/Écarter
  du Lot en gris à encre danger, bouton armé qui garde l'accent (HIG § Buttons/Role, lu).
- **Journal porté à sa spec** (table, groupes session/jour, segmenté en barre, Annuler au menu
  contextuel + inspecteur) et **l'état « annulé » traverse l'IPC** (`JournalEntry.undone`,
  `MIN(undone)` par lot, test de contrat destructurant, mutation-check exécuté).
- **Colonne Verdict** en Bibliothèque — mapping mesuré contre `worker.rs::verdict_str` ; le
  tableau § 16 ci-dessus corrigé en conséquence (`DUPLICATE` inatteignable, `AUTHENTIQUE` et
  `À VÉRIFIER` ajoutés). Une colonne nouvelle s'insère à son index par défaut dans une
  disposition mémorisée d'avant elle.
- Motion resserrée sur transform/opacity (4 exemptions nommées), focus rings unifiés,
  14 stories neuves (Journal, Verdict), sommaire de `design-system-states.md` renuméroté
  (17/55 offsets étaient déjà faux avant la session).

**Reste, dans l'ordre proposé :**
1. **Passe thème clair des 7 écrans** — tout le sweep s'est mesuré en sombre ; une seule
   capture claire prise (Journal). C'est la moitié non vérifiée du travail livré.
2. O‑2 (§ 11) — encre chaude (H≈77,5) sur fonds froids (H≈286), choix esthétique en attente.
3. `--color-accent-fill` n'est pas value-invariant entre thèmes (suit `--color-hue-blue-solid`,
   L 60,28 clair ↔ 62,43 sombre) — figer ou documenter l'intention.
4. Stories du sweep 1 absentes (boutons accent, chips, segmented, sliders, toast) — le miroir
   Storybook ne couvre que Journal/Verdict et l'existant antérieur.
5. Non observé en conditions réelles, à voir au premier usage : état « Annulé » rendu depuis la
   donnée (aucune entrée annulée en base au 2026-08-20), actions de masse exécutées contre la
   base, Rekordbox avec candidats en attente, segment d'occupation focalisé pendant `dim`.
6. Spectrogramme sans cadre en thème clair — question ouverte de la map #6, inchangée.

Résolu pendant le wrap-up : deux sessions locales avaient été lancées depuis des chips
périmés (les deux sujets étaient déjà traités par `f475ae0`). La session « famille swatch »
a convergé proprement — `57f64b2` renomme les cinq teintes en `.sift-rail-src-dot-*` d'après
leur porteur réel et met `rail-sources.ts` à jour ; son merge `7611875` réconcilie les deux
nettoyages parallèles sans perte. Plus rien à surveiller sur ce point.
