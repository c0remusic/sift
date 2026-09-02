# Spec — Rail de navigation

> Zone B du shell (`DESIGN.md` § 14). Présent sur **tous** les écrans : ce qui est
> décidé ici n'est jamais redécidé dans une spec d'écran.
>
> Ce fichier est aussi la destination de l'écran **Accueil**, absorbé
> (`DESIGN.md` § 15, fusion 1).

## Contexte dans le shell

Patron macOS : **sidebar de Finder / Music**. Une colonne de sources et de
destinations, jamais de filtres — un filtre appartient à la barre unifiée.

Largeur `--rail-w`, fixe, non redimensionnable : elle est dérivée du contenu, pas
choisie. Repliable, et replié il garde ses icônes et perd ses libellés — il ne
disparaît pas.

Porte la teinte de chrome (`--color-background-tertiary`), la même que la zone gauche
de la barre unifiée : la bordure verticale court sans interruption de la barre jusqu'en
bas du rail. **Aucune ligne horizontale n'est ajoutée entre les deux.**

## Layout

### Quatre sections, un seul niveau d'indentation

En-têtes en petites capitales discrètes (`--text-xs`, `--tracking-wider`,
`--color-text-tertiary`).

```
SOURCES
  ● ~/Downloads/incoming          8
  ● ~/Downloads/promos            1
  Ajouter un dossier

TRAITER
  Revue
  Journal

BIBLIOTHÈQUE
  Rangés                      1 204
  À re-sourcer                   17
  Corbeille                       3

EXPORTER
  Rekordbox                       6
  Clé USB

──────────────────────────────────
  Réglages
```

Réglages est ancré au pied, séparé du reste par l'espace et non par un trait.

### Item de navigation

Icône · libellé · compte à droite quand il y en a un.

Compte à droite : **chiffre nu**, aligné à droite, sans fond ni pilule — tranché le
2026-08-26 sur le motif de Notes (`docs/design-refs/08-notes.png`, compteurs de dossiers).
La pilule qui le portait (`--overlay-badge` + `--border-radius-pill`) n'était ancrée nulle
part : le kit Big Sur n'a **aucun** badge de sidebar. Le retrait enlève aussi une surface
peinte, cohérent avec « avoir une surface est la marque de la charpente »
(`docs/design-system/patterns.md`). Site : `.nav-badge` (`styles.css`). Le token
`--overlay-badge` est **supprimé** avec la pilule — il n'avait plus d'autre porteur.

⚠️ **Quelles entrées portent un compte, tranché le 2026-08-26** (`a927377`) : celles dont le
compte n'est écrit **nulle part ailleurs**. Les **sources** en portent un ; **Revue n'en porte
plus**, parce que la barre unifiée affiche déjà « N pistes » à côté du titre « Revue » — le même
nombre à deux endroits. La règle vient des refs, pas d'un arbitrage : Mail écrit « Inbox » dans sa
sidebar ET en tête de colonne mais ne met son compte qu'à **un** endroit, celui de la colonne ;
Notes met le sien dans la sidebar parce que sa colonne n'a **aucun** en-tête ; Photos n'en met nulle
part. Le compte va contre le nom de la liste, à un seul endroit.

État actif : **fond plein arrondi** (`--color-background-secondary`), jamais de bordure
ni de barre latérale colorée. Survol : `--overlay-hover`. Focus clavier : anneau
`--color-border-info`.

Le compte est neutre. Il prend un ton sémantique dans un seul cas : « À re-sourcer » passe en
`warning` quand il est supérieur à zéro, parce que c'est une file d'attente d'action, pas un
inventaire.

### Section Sources — ce qui vient d'Accueil

Une ligne par dossier surveillé : **pastille de couleur** · nom de base du dossier ·
compte de nouveaux fichiers.

La pastille de couleur est un accent catégoriel (`--color-hue-*`, `DESIGN.md` § 4) :
elle identifie la source dans les autres écrans, elle ne porte aucun état.

Cliquer une source **filtre Revue** sur ses fichiers. Le rail devient ainsi le sélecteur
de provenance, exactement comme la sidebar de Finder.

Au pied de la section : « Ajouter un dossier », **en texte seul**, qui ouvre le sélecteur natif
de répertoire. Le glyphe `+` qui le précédait est retiré le 2026-08-26 (`CLAUDE.md` § Front, un CTA
à label descriptif se dit en texte seul) : « + » devant « Ajouter » ne faisait que redire
« Ajouter ». Le `+` de sidebar macOS est un bouton **icône seule** au pied du volet, jamais un
glyphe accolé à un libellé — ce n'était pas ce patron.

## États

| État | Rendu |
|---|---|
| **Aucune source** | La section Sources montre son seul bouton « Ajouter un dossier ». Elle ne disparaît pas — sa présence dit qu'il faut en ajouter |
| **Scan en cours** | Indicateur sur la ligne de la source, compte figé jusqu'à la fin. Le rail reste utilisable |
| **Scan échoué** | Ligne en encre `danger`, motif au survol et au clic droit. **Jamais atténuée** — un échec se voit mieux que le reste, pas moins bien |
| **Dossier inaccessible** | Même traitement. La ligne reste : la faire disparaître se lirait comme « supprimée » |
| **Surveillance suspendue** | Ligne en `--color-text-tertiary`, pastille vidée. État permanent donc neutre. **« Vidée » tranché le 2026-08-20** : contour sans fond (`box-shadow` inset, 1 px — ratio 1/9 de l'anneau du picker, 1.5 px replié), **teinte conservée** — la pastille identifie (§ Sources), l'état est porté par la forme pleine/creuse. L'encre de repos du rail est déjà tertiaire : aucune règle d'encre dédiée. L'échec prime toujours |
| **Racine de bibliothèque non définie** | **Carte ambre compacte SOUS la section Sources** (`.sift-railwarn`, tokens `--color-background-warning` / `--color-text-warning`) : « Racine non définie » puis « Choisir dans Réglages › », le tout cliquable (`data-view="reglages"`). **Tranché le 2026-09-02 (issue #54, direction A2)** : la ligne précédente disait « pas dans le rail — le bandeau remonte dans la barre unifiée ». Ce bandeau pleine largeur (`#sift-gate`) est **supprimé**, parce que la racine a cessé d'être un prérequis de la conversion (on convertit en place ou vers un dossier externe sans racine) : il criait sur tous les écrans un prérequis qui ne mord qu'à une destination de l'arbre. Le rappel reste, mais logé là où on ajoute déjà des dossiers. Disparaît dès qu'une racine est posée — Réglages **et** le popover de destination relisent le réglage. Masquée quand le rail est replié : deux lignes de texte, rien à garder en icône |
| **Replié** | Icônes seules, comptes en pastille superposée, infobulle au survol portant le libellé et le compte |

## Interactions

### Souris

- **Clic** item : navigue. **Clic** source : filtre Revue sur cette source.
- **Clic droit** sur une source : Suspendre la surveillance · Rescanner · **Couleur**
  (rangée) · Couleur automatique · Ouvrir l'emplacement · Retirer.
- **Couleur — forme actée le 2026-08-20 (wireframe validé, variante A).** Rangée de
  pastilles *dans le menu même*, patron Finder Tags (guide macOS « Utiliser des tags » :
  « choisissez une couleur au-dessus de Tags » dans le menu contextuel ; jusqu'à sept tags
  y vivent en rangée). Pas de sous-menu — HIG § Menus : « Use submenus sparingly … [it]
  hides the items it contains », réservé au terme répété sur 3+ entrées. Pas de sélecteur
  libre — une valeur unique stockée ne peut pas suivre les deux thèmes, et la taxonomie
  est un ensemble fermé (`DESIGN.md` § 4). Détail :
  - cinq pastilles = `SOURCE_HUE_CYCLE`, anneau `--color-text-primary` sur la teinte
    **résolue** (override, sinon cycle) — reprise du picker d'Accueil (`4befc09`) ;
  - clic pastille → `set_source_color(id, teinte)` ; « Couleur automatique » →
    `set_source_color(id, null)`, **désactivée** (jamais retirée) quand aucun override ;
  - succès silencieux — la pastille du rail change sous le clic ; seul l'échec toaste.
  - Élargir aux 9 teintes de la taxonomie (§ 4) resterait conforme : demanderait de
    dériver 4 tokens `--color-hue-*-text` (blue, green, orange, gray) × 3 blocs. Écarté
    le 2026-08-20 — 5 suffisent, décision réversible.
- **Clic droit** sur « Corbeille » : Purger (confirmation armée).
- **Glisser** un dossier depuis l'OS sur la section Sources : ajout à la surveillance.
- **Glisser** des fichiers audio sur « Revue » : import dans la file.

### Clavier

`⌘/Ctrl + 1…8` atteint la n-ième destination, sources comprises et dans l'ordre
d'affichage — couche 1 de `DESIGN.md` § 9.

`↑` `↓` déplacent le focus dans le rail quand il l'a. `Entrée` et `Espace` activent
l'item focalisé.

Bascule de repli : proposition ⌥⌘S sur macOS (convention Finder), Ctrl+B ailleurs.
**Marqué proposition — à vérifier dans les HIG avant d'être figé.**

### Retour

Le changement de section active est immédiat, sans animation. Le repli du rail anime
`transform` en `--duration-slow`, jamais `width`.

Un compte qui change **ne s'anime pas** : c'est une donnée. Il change de chiffre.

## Hors périmètre / questions ouvertes

- **Largeur `--rail-w: 200px`** — dérivée du libellé le plus long (« Bibliothèque »)
  plus icône, gaps, padding et badge. **À confirmer par une mesure dans la vraie
  fenêtre** : la largeur d'un texte ne se règle pas par calcul.
- **Ordre des sources** — alphabétique, par date d'ajout, ou manuel ? Non tranché.
  Au-delà d'une dizaine de dossiers surveillés, la question devient réelle.
- **Repli automatique sous une largeur de fenêtre donnée** — la fenêtre descend à
  920 px minimum (`tauri.conf.json`). À quel seuil le rail se replie-t-il seul, si
  jamais ? Non tranché.
- **Sources dans la barre de titre repliée** — quand le rail est replié, la zone gauche
  de la barre unifiée fait-elle `--rail-w` ou la largeur repliée ? La bordure continue
  en dépend. À trancher à l'implémentation de l'étape 2.
