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

Le shell — zones, dimensions, redimensionnement, panneaux repliables — et le mapping
des huit écrans dedans sont la **phase 3**. Les specs d'écran sont la phase 4, dans
`docs/ui-specs/<vue>.md`. Ce fichier n'en tient que l'index.

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

| Écran | Spec | Statut |
|---|---|---|
| Accueil | `docs/ui-specs/accueil.md` | à écrire |
| Revue | `docs/ui-specs/revue.md` | à écrire |
| Écartés | `docs/ui-specs/ecartes.md` | à écrire |
| Journal | `docs/ui-specs/journal.md` | à écrire |
| Bibliothèque | `docs/ui-specs/bibliotheque.md` | à écrire |
| Rekordbox | `docs/ui-specs/rekordbox.md` | à écrire |
| Clé USB | `docs/ui-specs/cle-usb.md` | à écrire |
| Réglages | `docs/ui-specs/reglages.md` | à écrire |

Ordre d'écriture et patron macOS de chacun : phase 3.
