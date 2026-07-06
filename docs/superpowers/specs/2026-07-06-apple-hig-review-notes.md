# Notes de lecture — Apple Human Interface Guidelines (16 pages)

> Date : 2026-07-06. 16 pages HIG lues via 4 agents en parallèle
> (design-principles, color, materials, layout, sidebars, drag-and-drop,
> entering-data, feedback, file-management, loading, multitasking,
> playing-audio, settings, searching, undo-and-redo, icons), synthétisées
> pour Sift (app Tauri desktop Windows-first, pas une app Apple). Chaque
> page distingue : ce qui **valide** l'existant, ce qui est **actionnable**
> (à considérer/corriger), ce qui est **hors scope** (mobile/tactile/rendu
> Apple-only, non transposable).
>
> Décision issue directement de cette lecture (+ un skill tiers "Apple HIG
> Designer") : voir `2026-07-06-apple-system-colors-palette-design.md` pour
> le changement de palette couleur acté. Le reste ci-dessous est de la
> veille — pas encore d'implémentation décidée sauf mention contraire.

## Design principles

8 principes (Purpose, Agency, Responsibility, Familiarity, Flexibility,
Simplicity, Craft, Delight), page agnostique de toute plateforme. Valide
directement des règles déjà actées dans CLAUDE.md : "fail fast, pas de
fallback silencieux" ≈ Responsibility ; le journal d'annulation/revert ≈
Agency ("les erreurs doivent être réversibles, pas coûter du temps/travail
à l'utilisateur"). "Simplicity isn't minimalism" est un bon garde-fou pour
le chantier surface-continue en cours : retirer le chrome, pas
l'information dont on a besoin sous la main (badges verdict/CDJ qui restent
visibles quand pertinents).

## Color

Valide fortement le système actuel (voir palette Apple system colors,
design séparé) : "appliquer la couleur avec parcimonie, la réserver aux
éléments qui bénéficient vraiment d'une emphase" est exactement le principe
derrière "le danger fusionne dans l'ambre" (avant la révision) et le
pattern "un état confirmé permanent reste neutre, seule la transition est
colorée". Règle actionnable confirmée : **chaque couleur custom doit avoir
une variante sombre**, cohérent avec la discipline light/dark déjà en place
dans `styles.css`. L'exception dorée du bouton Identifier est exactement le
type d'exception qu'Apple documente pour les actions primaires.

Hors scope : couleurs système dynamiques par nom (`systemGray`,
`labelColor`), gestion P3/gamut large, True Tone, connotations culturelles
de couleur — non pertinent pour un outil DJ sur un seul écran Windows.

## Materials

Modèle à deux catégories : Liquid Glass (couche fonctionnelle
flottante — nav/toolbars) vs matériaux standards (structure dans le
contenu lui-même, sans flou). Valide directement le chantier
surface-continue : nav rail = le seul endroit où l'élévation/flou se
justifie (couche de contrôle fonctionnelle), le contenu (inspecteur/
panneaux) doit rester plat et partager le même fond — exactement ce que
"surface continue" retire (cartes empilées). Décision actée dans le design
palette : flou réservé aux popovers éphémères (Destination, confirmation),
tout le reste reste plat + ombre légère.

Hors scope : Liquid Glass lui-même (rendu iOS 26/visionOS, non disponible
WebView2), effets de vibrance (`UIVibrancyEffectStyle`), tables d'épaisseur
de matériau par plateforme (`ultraThin`/`thin`/`regular`/`thick`).

## Layout

Valide directement la divulgation progressive déjà nommée comme principe
dans CLAUDE.md (repli spectrogramme, zones repliables Diagnostic/
Métadonnées) — quasi mot pour mot la recommandation HIG. "Donner assez
d'espace aux contrôles, les regrouper en sections logiques" est un bon
prisme d'audit pour le rail de filing/les segmented controls. Actionnable :
vérifier que le redimensionnement de la fenêtre Tauri ne fait pas basculer
brutalement le layout (nav rail qui s'effondre trop tôt) — pas vérifié à ce
jour, candidat de suivi.

Hors scope : toute la section spécifications d'écran (tables de dimensions
iPhone/iPad/Watch/TV, size classes) — zéro pertinence pour une fenêtre
desktop redimensionnable.

## Sidebars

Valide la structure du rail nav existant (~152px, icônes+labels,
navigation entre zones de contenu top-level) — c'est exactement le
pattern décrit. Actionnable, mineur : HIG recommande de limiter la
hiérarchie visible à 2 niveaux max — le groupe "Intégrations" (Rekordbox/
Clé USB) reste dans cette limite, pas de changement nécessaire.

Hors scope : Liquid Glass/effet d'extension de fond (macOS 26), guidance
iPadOS/visionOS spécifique.

## Drag and drop

**Deux gaps identifiés, actionnables** :
1. HIG exige une **alternative non-drag** pour toute action de
   drag-and-drop (menu/bouton équivalent) — à vérifier : chaque zone de
   dépôt de Sift (dossier source surveillé, dossier destination, fichiers
   audio vers la file) a-t-elle un chemin bouton/menu équivalent, ou
   certaines sont drag-only ?
2. HIG recommande un **badge/indicateur différenciant** "déplacera" vs
   "copiera" vs "invalide" pendant le drag — Sift n'a aujourd'hui qu'une
   seule affordance générique (contour pointillé) pour toutes les zones ;
   à vérifier si une différenciation serait utile.

Valide : le pattern actuel (contour + texte d'indice, visible seulement
pendant le drag actif) correspond bien à "cues visuels identifiant les
destinations pendant le drag".

Hors scope : accès clavier complet en mode drag, gestes tactiles iPad.

## Entering data

Valide : le label persistant (pas seulement un placeholder) sur les champs
`artist`/`title`/`genre` de l'écran Revue — déjà en place
(`.sift-editor-field-label`, ajouté dans une session précédente) est
exactement la bonne pratique HIG ("le placeholder disparaît une fois la
saisie commencée, ne peut pas être la seule description"). Le pattern
"valider dynamiquement, feedback immédiat" correspond au bandeau de tags
CDJ déjà en place (immédiat, pas différé à un save). Actionnable : "minimiser
la saisie" — traiter le pré-remplissage depuis un candidat Discogs identifié
comme le chemin par défaut plutôt que la correction manuelle, déjà en
grande partie le cas.

Hors scope : champs sécurisés/biométrie/keychain — Sift n'a pas de
compte/mot de passe.

## Feedback

Pas de canal haptique/audio pertinent sur desktop — le principe actionnable
est **causalité + harmonie** entre les canaux visuels déjà utilisés : toast
(confirmation transitoire), bandeau inline (avertissement persistant), et
bannière "Filed ✓ ↩" (action réversible terminée) sont 3 mécanismes
distincts pour 3 causes distinctes — cohérent avec HIG, ne pas les fusionner
en un type de toast générique. À auditer : le toast "Filed" et un bandeau de
doublon peuvent-ils apparaître simultanément et se marcher dessus
visuellement (violerait "Harmony") ?

Hors scope : moteur Core Haptics, appairage son/haptique.

## File management

Valide l'approche actuelle : Sift ne force pas un navigateur de fichiers
brut, l'utilisateur choisit une source surveillée + une racine destination.
Actionnable, mineur : vérifier que le sélecteur de destination démarre sur
le dernier dossier utilisé plutôt qu'un arbre vide à chaque fois (principe
"la plupart des gens s'attendent à retrouver l'emplacement le plus
probable/récent").

Hors scope : Finder/Files app, sync iCloud multi-appareil.

## Loading

Actionnable : (1) auditer si la progression d'encodage/filing saute de 0%
à 90% puis stagne (pacing malhonnête selon HIG — "90% en 5s puis les 10%
restants en 5 minutes peut sembler trompeur") ; (2) auditer les libellés de
statut de la file/zone de progression pour des termes vagues ("Chargement")
vs nommer l'étape réelle ("Analyse spectrale…"). Valide : l'architecture
existante (une zone de progression globale en sidebar + statut par ligne
dans la file) correspond à "garder les indicateurs à un emplacement
cohérent". Valide aussi : progression déterministe par piste pendant
l'encodage (déjà en place), indéterminé seulement pour "En analyse" (durée
non mesurable) — c'est la bonne exception selon HIG.

## Multitasking

Valide le choix mono-fenêtre de Sift (pas de multiplication de fenêtres) et
la zone de progression en sidebar qui reste visible en changeant d'écran —
HIG valide plutôt que ne suggère un changement ici.

Hors scope : Stage Manager, Split View, restauration d'état multi-fenêtre —
pas d'équivalent OS-level sur Windows à emprunter.

## Playing audio

Valide le pattern lecteur inline dans Revue (play/pause/volume/tempo sans
quitter l'écran, pas de vue séparée) — correspond à "Now Playing sans
quitter l'écran". **Gap réel non vérifié, candidat de suivi** : si le
périphérique de sortie audio disparaît en cours d'écoute (casque débranché,
DAC USB retiré), est-ce que la lecture WaveSurfer/`<audio>` se met en pause,
ou continue silencieusement dans le vide ? Pas testé.

Hors scope : intégration lock-screen/Control Center, audio spatial, CarPlay.

## Settings

Page la plus directement actionnable pour l'écran Réglages actuel : la
règle "préférer les réglages contextuels/in-app pour tout ce qui est
fréquemment changé, réserver une zone Réglages dédiée aux options
rarement modifiées et globales à l'app" valide les 3 réglages actuels
(clé Discogs, dossier racine bibliothèque, apparence) — tous
rarement changés et globaux, correctement placés. Garde-fou pour l'avenir :
si un futur réglage par-piste ou par-session est ajouté (ex. une
préférence de format qui varie par lot), le placer inline dans le rail de
filing/l'UI de batch, pas dans Réglages.

## Searching

Directement pertinent pour la barre de recherche de file en cours
(portée déjà confirmée avec l'utilisateur : filtre client sur la file
affichée, titre/artiste) : le cas d'usage correspond exactement au pattern
HIG "la recherche locale filtre la vue courante" (leur exemple : la
recherche locale de Music filtre les morceaux/albums visibles) — ça valide
**filtre en direct pendant la frappe, pas de soumission par Entrée**.
Placement : position primaire près de l'en-tête de la file, pas caché
derrière une icône. Le placeholder doit indiquer la portée locale
explicitement ("Filtrer la file…" plutôt qu'un "Rechercher" générique, pour
éviter que l'utilisateur croie que ça cherche dans toute la bibliothèque).
Pas d'historique de recherche nécessaire pour un filtre de session léger.

## Undo and redo

**Gap actionnable identifié, candidat de suivi (pas encore décidé)** : le
principe HIG "ne pas plafonner le nombre d'annulations, l'utilisateur peut
essayer undo plusieurs fois sans se souvenir exactement quelle action est
ciblée" met en tension la bannière actuelle "Filed ✓ ↩" à un seul niveau —
après un 2e filing, le 1er devient inatteignable. HIG valide en revanche le
**revert de lot** déjà existant dans `journal.ts` ("mass revert
séquentiel") comme un pattern légitime ("annuler tout depuis X"). Si le
undo multi-niveau est un jour construit, HIG recommande de nommer l'action
spécifique dans le libellé ("Annuler : Filed 40 Thieves - ...", pas juste
"Annuler").

Hors scope : convention de raccourci clavier Cmd-Z (Mac-spécifique — Ctrl+Z
serait l'équivalent Windows naturel si un raccourci est un jour ajouté, pas
couvert par le menu Edit HIG).

## Icons

Valide : les règles déjà en place ("jamais d'icône seule sans texte sauf
spinner", "jamais d'icône décorative à côté d'un texte déjà descriptif")
sont **plus strictes** que HIG (qui autorise les boutons icon-only par
défaut, en s'appuyant sur un vocabulaire d'icônes appris par des millions
d'utilisateurs iOS/macOS depuis 15 ans — vocabulaire que Sift n'a pas).
Voir le design palette couleur pour l'exemple concret (bouton retour
circulaire, toolbar sans bordure) : ne s'applique pas au rail d'action de
Sift, qui porte des valeurs variables/verbes métier spécifiques. Actionnable
mineur : auditer la cohérence d'épaisseur de trait/taille des icônes
Tabler utilisées (nav, badges) contre l'échelle propre de Tabler.
Toute icône de recherche à venir devrait réutiliser `ti-search` (métaphore
loupe universelle, cohérente avec le glyphe standard HIG pour "Search").

Hors scope : système de compositing d'icônes de document macOS (coin plié,
export PNG multi-taille) — sans rapport avec un webfont Tabler.
