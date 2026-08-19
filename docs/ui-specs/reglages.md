# Spec — Réglages

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Réglages Système** — sidebar de
catégories à gauche, panneau à droite, **application immédiate**.

Trois zones : rail · **catégories** (zone fixe gauche) · **panneau du réglage choisi**
(flexe, contenu borné à `--measure-form`).

**Ce que ce découpage corrige.** L'écran est aujourd'hui une colonne unique plafonnée à
560 px (`.sift-settings-stack`), qui laisse 44 % de la fenêtre vide sur 1200 px. La
correction n'est **pas** d'élargir la colonne : Réglages Système emploie justement un
panneau étroit — mais à côté d'une sidebar de catégories. Ce qui manquait n'était pas
de la largeur, c'était la seconde colonne. Le panneau garde donc sa mesure de
formulaire ; il est simplement accompagné.

## Layout

### Zone B′ — catégories

Sélection exclusive, fond plein arrondi sur l'active. Cinq entrées :

| Catégorie | Contenu |
|---|---|
| **Général** | Racine de bibliothèque, dossiers surveillés, comportement au démarrage |
| **Conversion** | Formats cible, règle anti-surqualité, normalisation |
| **Nommage** | Modèle de nom de fichier, aperçu en direct |
| **Identification** | Jeton Discogs, ordre des sources d'identification, familles de genre |
| **Apparence** | Thème clair / sombre / auto, densité si elle devient réglable |

### Zone C — panneau

Contenu borné à `--measure-form` (560 px), aligné en tête de zone, jamais centré dans
un vide.

**Une grille commune à tout le panneau** : libellé à gauche, contrôle à droite, alignés
sur la même colonne d'un réglage à l'autre. Description en `--text-sm`,
`--color-text-secondary`, sous le libellé, uniquement quand elle est nécessaire.

**Aucun bouton Enregistrer ni Annuler.** Chaque réglage s'applique à la frappe ou au
clic. Une action destructrice demande une confirmation **inline**, dans la ligne du
réglage, pas une modale.

Les quatre sections d'aujourd'hui (`discogs`, `bibliotheque`, `nommage`, `apparence`)
se répartissent dans les cinq catégories. Elles ne redeviennent **pas** quatre cartes
empilées : la consolidation en un seul bloc était une bonne décision, elle est
conservée — le découpage se fait par catégorie, pas par boîte.

### Ce qui n'est plus ici

**Clé USB.** L'écran a quitté Réglages le 2026-07-31 et n'y revient pas. Réglages ne
porte aucune action sur un périphérique.

## États

| État | Rendu |
|---|---|
| **Réglage appliqué** | Retour immédiat et **bref** — la valeur affichée change, un indicateur discret confirme, puis s'efface. L'état permanent reste neutre : seule la transition se colore |
| **Écriture en cours** | Le contrôle reste utilisable, un indicateur discret en marge |
| **Écriture échouée** | Le contrôle revient à sa valeur réelle, le motif s'affiche sous lui, en encre `danger`. Jamais un échec silencieux qui laisse voir la valeur souhaitée |
| **Racine non définie** | Bandeau `warning` en tête de la catégorie Général, et **aussi** dans la barre unifiée tant que la racine manque — cette porte a quitté Accueil (`DESIGN.md` § 15, fusion 1) |
| **Discogs non connecté** | Champ de jeton, lien vers la page d'obtention, et l'état de la dernière vérification |
| **Discogs en limite de débit** | Message propre à ce cas, avec le délai. Pas un message d'erreur générique |
| **Aperçu de nommage** | Recalculé à chaque frappe via `previewFilename`. **Jamais** réimplémenté en TS |

## Interactions

### Souris

- **Clic** catégorie : change le panneau. Aucun état intermédiaire, aucune animation
  de panneau.
- **Clic** contrôle : applique. Pas de validation différée.
- **Clic** sur un dossier de la liste des sources : ouvre son emplacement.
- **Clic droit** sur une source surveillée : Retirer · Ouvrir l'emplacement ·
  Suspendre la surveillance.

### Clavier

Couche 1 de `DESIGN.md` § 9. `⌘/Ctrl+,` ouvre cet écran depuis n'importe où.
`↑` `↓` déplacent la sélection de catégorie. `Tab` parcourt les contrôles du panneau
dans l'ordre visuel.

Un champ de saisie garde ses touches : aucun raccourci d'écran ne se déclenche dans un
`INPUT`.

### Retour

`--duration-fast` sur les bascules. Aucune animation sur le changement de catégorie :
c'est un changement de contenu, pas une transition.

## Recherche de réglages

Le patron macOS la demande au-delà d'environ trois catégories, et il y en a cinq.
Champ dans la barre unifiée, à droite comme partout. Il filtre les **réglages**, pas les
catégories, et affiche les résultats avec leur catégorie d'origine.

**Marqué comme deuxième temps** : la recherche n'a de valeur qu'une fois les cinq
catégories peuplées. Ne pas la construire avant.

## Hors périmètre / questions ouvertes

- **Réglage de thème applicatif.** Les HIG demandent de ne pas en offrir. Sift en a un,
  avec `auto` par défaut — donc le système est respecté tant que l'utilisateur ne
  demande rien. Justification : la cible Windows, où la bascule applicative est une
  convention courante. **Divergence assumée, à ne pas « corriger ».**
- **Fenêtre séparée.** macOS ouvre ses préférences dans une fenêtre à part. Sift les
  garde comme destination du rail. À rouvrir seulement si l'écran devient un obstacle
  au flux de travail, pas par conformité.
- **Densité réglable.** La catégorie Apparence l'accueillerait, mais `--row-h` est
  aujourd'hui une valeur unique. En faire un réglage est une décision de socle, pas
  d'écran.
- **Mode Rekordbox (XML / `master.db`).** Vit aujourd'hui dans l'écran Rekordbox.
  Remonter ici ? Question ouverte, la même des deux côtés.
