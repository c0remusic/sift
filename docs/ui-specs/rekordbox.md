# Spec — Rekordbox

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Utilitaire de disque** —
cible → action → progression → rapport.

Trois zones : rail · liste des candidats de la section choisie (flexe) · inspecteur du
candidat (`--pane-w`, repliable).

**Le changement structurel de cet écran.** Les quatre sections de synchronisation
(M8 Tier 1/2/3) sont aujourd'hui **quatre cartes empilées verticalement** dans une page
qui défile, chacune avec sa propre action. Quatre cibles et quatre actions dans un même
flux : rien ne dit laquelle on traite. Elles deviennent **quatre entrées de la zone
gauche**, plus une entrée « Tout ». La zone C montre les candidats de celle qui est
choisie. C'est le patron Utilitaire de disque appliqué tel quel : on choisit une cible
avant qu'une action soit disponible.

## Layout

### Zone B′ — sections

Cinq entrées, sélection exclusive, chacune avec son compte en attente :

| Entrée | Contenu |
|---|---|
| **Tout** | Les candidats des quatre sections, colonne Section en plus |
| **Fichiers** | Tier 1 — corrections de chemin détectées au rangement |
| **Playlists** | Tier 2 — doublons `djmdContent` |
| **Métadonnées** | Tier 3 — écarts de tags |
| **Pochettes** | Tier 3 — pochettes manquantes ou divergentes |

Une section dont l'appel IPC a échoué garde son entrée, avec un indicateur d'erreur.
Elle ne disparaît pas — une section absente se lit comme « rien à faire », ce qui est
un mensonge.

### Zone A — barre unifiée

Titre de la section active + compte en attente · **Synchroniser** (action principale,
dominante, portée sur la sélection ou sur toute la section) · recherche à droite.

Le bandeau explicatif du flux (« Sift convertit → l'export fusionne dans le XML lié →
réimporte-le ») descend en tête de zone C, et **seulement quand un XML est lié** : c'est
un rappel de procédure, pas un titre.

### Zone C — table des candidats

| Colonne | Largeur | Rendu |
|---|---|---|
| Case | fixe | Sélection pour la synchronisation |
| **Section** | fixe | Uniquement en mode « Tout » |
| **Piste** | flex 2 | Artiste — titre |
| **Écart** | flex 2 | Ce qui diffère : chemin actuel → chemin corrigé, ou tag avant → après |
| **État** | fixe | En attente · Synchronisé · Échec |

Hauteur `--row-h`. Les lignes remplacent les sept `.sift-ui-card-outline` de
`rekordbox-view.ts`, chacune rembourrée à la main en `padding:10px 12px` — un `10px`
qui n'appartient à aucune échelle (`DESIGN.md` § 5).

### Zone D — inspecteur

Détail du candidat : valeur actuelle dans Rekordbox, valeur proposée par Sift, source de
la proposition, et l'action unitaire. En sélection multiple : compte par section et
l'action de masse.

## États

| État | Rendu |
|---|---|
| **Aucun XML lié** | `emptyStateHtml` en zone C — « Aucun XML Rekordbox lié », action « Lier un fichier XML ». Le rail et la barre restent |
| **Statut indisponible** | Carte d'erreur, bouton Réessayer. Aucune section n'est affichée comme vide |
| **Section en erreur** | L'entrée du rail porte l'indicateur, la zone C porte la carte d'erreur et son motif. Le compte global **compte les sections tombées** — quatre cartes en erreur ne doivent jamais produire un en-tête « à jour » |
| **Rien en attente** | Section affichée, atténuée, libellée « à jour ». Elle ne disparaît pas |
| **Dérive détectée** | Bandeau `warning` persistant en tête de zone C : « Ferme Rekordbox, vérifie la piste, puis relie à nouveau le fichier XML. » Phrase entière, **jamais tronquée** |
| **Synchronisation en cours** | Sheet attachée à la fenêtre, barre déterminée, étape en texte, Annuler présent |
| **Rapport** | Résumé chiffré — synchronisés / échecs — avec accès au détail des échecs et une sortie claire |

## Interactions

### Souris

- **Clic** ligne : sélectionne, remplit l'inspecteur · **⇧+clic** plage ·
  **⌘/Ctrl+clic** ajout · case à cocher pour la sélection de synchronisation.
- **Clic droit** : Synchroniser cette entrée · Ignorer · Voir la piste dans
  Bibliothèque · Ouvrir l'emplacement.
- **Clic** en-tête de colonne : tri.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9. `Entrée` synchronise la sélection, après
confirmation. **Aucun raccourci à une lettre sur cet écran** : il écrit dans une base
tierce, un accélérateur à une touche y est un piège.

### Retour

La sheet de progression glisse depuis le haut de la fenêtre en `--duration-slow`.
Aucune animation sur l'arrivée ou la disparition d'un candidat.

## Sécurité — non négociable

Cet écran écrit dans un système **live** — la base d'un autre logiciel.

- Le backend refuse d'agir quand Rekordbox tourne
  (`MasterDbError::RekordboxRunning`) ; l'interface le dit avant l'action, pas après
  l'échec.
- Toute écriture en mode `master.db` est précédée d'un backup, et le backup est vérifié
  contre une référence propre **juste avant** l'écriture.
- Aucune écriture ne se déclenche sur la seule foi d'un rapport : l'état est relu
  indépendamment.
- La confirmation est in-app, armée et horodatée. Jamais `window.confirm()`.

## Hors périmètre / questions ouvertes

- **Vérification dans le vrai Rekordbox** — manuelle, hors de cette spec.
- **Mode XML contre `master.db`** — le choix vit aujourd'hui dans cet écran. Doit-il
  remonter dans Réglages, où vivent les autres décisions persistantes ? Non tranché.
- **Ignorer un candidat** — l'action est spécifiée dans le menu contextuel ; sa
  persistance (session, ou définitive) ne l'est pas.
