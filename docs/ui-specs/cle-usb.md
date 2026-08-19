# Spec — Clé USB

## Contexte dans le shell

**Profil Parcours** (`DESIGN.md` § 14). Patron macOS : **Utilitaire de disque**, et ici
littéralement — c'est la même tâche, sur le même objet.

Trois zones : rail · liste des disques amovibles (flexe) · détail du disque choisi
(`--pane-w`, repliable).

L'écran quitte le plafond `.sift-settings-stack{max-width:560px}` qu'il partage
aujourd'hui avec Réglages : une **liste de disques** n'est pas un formulaire. Sur une
fenêtre de 1200 px ce plafond laissait 44 % de la zone vide.

## Layout

### Zone A — barre unifiée

Titre « Clé USB » · compte de disques détectés · **Actualiser** · pas de recherche
(la liste tient à l'écran par construction).

### Zone C — liste des disques

Une ligne par volume amovible. Hauteur supérieure à `--row-h` assumée et **nommée** :
la ligne porte un graphique d'occupation, pas seulement du texte. C'est la seule
dérogation à la hauteur unique de `DESIGN.md` § 16, et elle vaut pour cet écran seul.

Contenu d'une ligne : icône de bus · nom du volume · capacité · système de fichiers ·
barre d'occupation par format · espace libre en `--font-mono` avec `tabular-nums`.

**Un disque non amovible n'apparaît jamais.** Le bus se lit sur `MSFT_Disk.BusType`,
jamais sur `InterfaceType`, qui ment sur les boîtiers UASP.

### Zone D — détail du disque

Graphique d'occupation détaillé par format · liste des dossiers de premier niveau avec
leur poids · chemin de montage · et les deux actions :

- **Formater** — ouvre la sheet de formatage.
- **Éjecter** — action directe, avec son état d'échec explicite.

## États

| État | Rendu |
|---|---|
| **Aucun disque** | `emptyStateHtml` — « Aucun disque amovible détecté », note sur le branchement, bouton Actualiser |
| **Détection en cours** | Squelette de lignes dans la structure finale |
| **Lecture d'occupation en cours** | La ligne existe, sa barre est en attente. Le nom et la capacité sont déjà lisibles |
| **Disque inaccessible** | Ligne présente, encre `danger`, motif dans le détail. Jamais masquée |
| **Formatage — confirmation** | Sheet attachée. Nom du volume à retaper, confirmation **armée et horodatée**. Jamais `window.confirm()` |
| **Formatage en cours** | Sheet bloquante mais **annulable**, barre déterminée, étape en texte |
| **Formatage — rapport** | Résumé : système de fichiers produit, capacité utile, sortie claire |
| **Élévation refusée** | Message explicite : ce qui a été refusé et ce que l'utilisateur peut faire. Sentinelle `ELEVATION_DECLINED` |
| **Disque disparu en cours d'opération** | Sentinelle `DRIVE_VANISHED` — l'opération s'arrête, l'état est dit, rien n'est supposé |
| **Identité incohérente** | Sentinelle `IDENTITY_MISMATCH` — le volume n'est plus celui qui a été ciblé. L'opération est refusée, pas retentée |
| **Éjection refusée** | Sentinelle `EJECT_BUSY` — nommer ce qui tient le volume si l'information est disponible |

Les cinq sentinelles (`DRIVE_VANISHED`, `IDENTITY_MISMATCH`, `ELEVATION_DECLINED`,
`EJECT_BUSY`, et le préfixe de destination externe) sont des **littéraux partagés** avec
le Rust et épinglés par des tests. Leur rupture est silencieuse côté interface : ne
jamais les réécrire côté TS.

## Interactions

### Souris

- **Clic** ligne : sélectionne, remplit le détail.
- **Clic droit** : Formater · Éjecter · Ouvrir dans l'explorateur · Actualiser.
- **Clic** sur un segment du graphique d'occupation : filtre le détail sur ce format.

### Clavier

Couches 1 et 2 de `DESIGN.md` § 9. `Entrée` ouvre le détail.

**Ni `⌫` ni raccourci à une lettre sur cet écran.** Le formatage efface un disque : il
n'a pas d'accélérateur clavier, il passe par la sheet et sa confirmation armée.

### Retour

La sheet glisse depuis le haut en `--duration-slow`. La barre d'occupation ne s'anime
pas à la lecture — c'est une donnée mesurée, elle s'affiche.

## Sécurité — non négociable

- **Volumes amovibles uniquement.** Un disque fixe n'entre jamais dans la liste.
- Le nom du volume doit être **retapé** pour armer le formatage. La confirmation est
  in-app, armée et horodatée.
- L'identité du volume est revérifiée **juste avant** l'écriture, pas seulement à la
  sélection.
- FAT32 au-delà du plafond de 32 Go de Windows passe par `fatfs` (MIT). Sur macOS,
  `diskutil eraseDisk` ignore ce plafond et le binaire ne lie pas `fatfs`.

## Hors périmètre / questions ouvertes

- **Message de refus de formatage** — reste à finir : il doit nommer *ce qui* a été
  refusé et *quoi faire*, pas seulement échouer.
- **Éjection d'un SSD USB vu comme fixe** — le verbe shell est absent dans ce cas ; il
  faut viser le devnode parent. Comportement à re-vérifier avant de le spécifier comme
  acquis.
- **Copie vers la clé** — hors périmètre de cet écran aujourd'hui. Si elle y entre un
  jour, c'est une opération longue de plus, même patron.
