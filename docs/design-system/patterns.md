# Sift Design System - Patterns

## Parcours Revue

Le parcours Revue est une chaîne de décision :

1. écouter et reconnaître le morceau ;
2. vérifier le diagnostic audio ;
3. vérifier les métadonnées ;
4. choisir destination et format ;
5. ranger ou jeter.

La page doit donc privilégier l'ordre de décision, pas l'ordre technique des
modules internes.

## Surface Continue

Pattern préféré : les contenus reposent sur le fond de l'application, avec des
groupes formés par l'espacement, les titres et les états.

Utiliser une carte seulement pour :

- une surface flottante ;
- un popover ;
- un modal ;
- une liste d'items répétés ;
- un outil qui a besoin d'un cadre fonctionnel.

Éviter :

- cartes dans cartes ;
- sections pleine page encadrées sans raison ;
- séparateurs entre lignes quand le spacing suffit ;
- ombres pour compenser une hiérarchie floue.

**Tension connue avec les HIG.** HIG Materials pose l'inverse : une couche fonctionnelle
(contrôles, navigation) visuellement distincte de la couche contenu, matérialisée par
Liquid Glass. Le matériau lui-même est natif macOS et hors de portée d'une WebView sans
imitation coûteuse, mais le principe — différencier les contrôles du contenu — contredit
frontalement la surface continue. Tension à trancher explicitement le jour où elle se
pose sur un écran réel, pas à résoudre par défaut dans un sens ou dans l'autre.

## Sections Collapsables

Diagnostic audio et Métadonnées peuvent être collapsables, mais la page doit
rester compréhensible quand une section est fermée.

Règles :

- le titre de section annonce le rôle, pas l'action ;
- l'indicateur d'ouverture doit être iconographique et discret ;
- ne pas ajouter de texte "afficher/masquer" permanent ;
- l'état fermé doit garder un résumé utile si la décision en dépend.

Apports HIG Disclosure controls :

- ce qui est le plus utilisé reste **en haut et toujours visible** ; seul l'avancé se
  cache. Un collapse n'est pas un rangement, c'est une hiérarchie d'usage ;
- le libellé doit dire ce qui est caché, pas seulement nommer la zone ;
- convention directionnelle : l'indicateur pointe vers l'intérieur quand le contenu est
  masqué, vers le bas quand il est visible. Si Sift s'en écarte, que ce soit une
  décision, pas un défaut.

## Title Bar Et Panneaux

La title bar doit suivre la structure de la fenêtre :

- zone gauche alignée sur le rail ;
- zone centrale alignée sur le fond principal ;
- bordure verticale du rail continue ;
- pas de ligne noire parasite ;
- pas de décalage entre title bar, rail et panneau File.

Si le panneau File est flottant, il ne doit pas être forcé à toucher la title
bar. Son espacement haut doit déduire la hauteur de title bar pour que le rythme
visuel reste identique en haut et en bas.

## Destination D'abord

La destination est une décision structurante. Elle doit rester visible dans
l'espace À finaliser, même si l'utilisateur a déjà choisi le format.

Pattern :

1. titre court "Destination" ;
2. contrôle de destination ;
3. format ;
4. nom final calculé ;
5. actions.

Ne pas cacher la destination dans une barre secondaire ou un contrôle trop
petit : sans destination, "Convertir" n'a pas de sens.

## Nom Final Après Format

Le nom final dépend du format choisi. Il doit donc venir après le choix MP3/AIFF/WAV.

Règles :

- taille modérée ;
- police mono acceptable ;
- alignement avec les actions de fin ;
- pas de grand bloc dédié si le nom tient sur une ligne ;
- montrer le changement immédiatement quand le format change.

## Warnings

Un warning doit apparaître au plus proche de la décision qu'il affecte.

Exemples :

- problème ID3 : Métadonnées ;
- destination manquante : À finaliser ;
- fichier audio suspect : Diagnostic audio ;
- action destructive : confirmation in-app dédiée.

Ne pas répéter le même warning dans plusieurs zones. La répétition augmente le
bruit et fait perdre le signal.

## Densité Lisible

Sift peut être dense, mais chaque niveau doit avoir son propre rythme :

- écran : grands blocs ;
- section : respiration verticale claire ;
- groupe : spacing moyen ;
- ligne : spacing compact ;
- valeur technique : densité maximale.

Quand un bloc paraît cassé, auditer dans cet ordre :

1. est-ce le bon ordre de décision ?
2. le titre indique-t-il le bon rôle ?
3. le spacing correspond-il au niveau ?
4. une carte ou une bordure parasite crée-t-elle du bruit ?
5. la couleur signale-t-elle un vrai état ?

## Annulation

HIG Undo and redo, confronté à `frontend/journal.ts`.

Acquis :

- revert par ligne et revert de masse par catégorie coexistent
  (`journal.ts:107` et `:123`) ;
- le résultat d'une annulation est marqué **là où l'action a eu lieu** (`:232`), pas
  seulement dans un toast : sinon l'utilisateur croit que rien ne s'est passé et
  recommence ;
- l'ordre est imposé **côté Rust** ; `journal.ts:176-177` ne fait que traduire l'erreur
  levée en « Action plus récente à annuler d'abord. » ;
- le raccourci répond aux deux modificateurs, Ctrl et Cmd (`frontend/filing.ts:605`,
  corrigé le 2026-08-05).

Règles :

- ne jamais plafonner le nombre d'annulations sans raison ;
- une annulation doit être prévisible **avant** d'être déclenchée : le libellé dit ce
  qui sera défait ;
- Sift n'ayant pas de barre de menus (`decorations: false`), le clavier est la seule
  voie système d'annulation. Un raccourci manquant n'y est pas un manque de confort,
  c'est une voie coupée — c'était le cas sur macOS jusqu'au 2026-08-05 ;
- l'annulation est annoncée à un seul endroit — « Annulable via Ctrl+Z. » dans la modale
  de mise à la corbeille (`frontend/library-detail.ts:352`) — et absente du bandeau
  d'indices clavier de la Revue (`frontend/report-view.ts:364`, qui liste SPACE, ENTER,
  BKSP, HAUT/BAS). Ce libellé nomme Ctrl sur les deux plateformes alors que macOS attend
  ⌘. Deux questions ouvertes, pas des défauts.

## Chargement Et Progression

HIG Loading + HIG Progress indicators.

Acquis : la progression est déterminée (`frontend/progress-zone.ts:114,124`), exposée en
`role="progressbar"` avec `aria-valuenow` (`:129`).

⚠️ **Non acquis, contrairement à ce qui était écrit ici jusqu'au 2026-08-05** : « le
travail lourd vit dans un pool de threads Rust, l'interface reste utilisable pendant ».
Jamais mesuré. Les commandes IPC sont toutes synchrones (zéro `pub async fn` dans les six
`ipc*.rs`), ce qui n'est pas un défaut en soi — mais dit qu'une commande faisant un
travail long en ligne gèlerait l'IPC. Voir E6 du chantier HIG.

Règles :

- préférer toujours une progression déterminée ; l'indéterminée ne dit rien d'utile ;
- montrer quelque chose immédiatement plutôt qu'un espace vide : l'absence se lit comme
  une panne. ⚠️ **Accueil viole cette règle**, et c'est le premier écran affiché :
  `home-sources.ts` n'a aucun « Chargement… », là où `bibliotheque-view.ts:254`,
  `ecartes-view.ts:108` et `queue-panel.ts:425` en ont un. Voir E7 ;
- ne jamais exiger la fin d'une opération pour rendre le reste utilisable ;
- une progression qui atteint 90 % en cinq secondes puis stagne est perçue comme
  mensongère — mieux vaut un rythme régulier qu'un rythme exact.

## Modalité

HIG Modality.

- un modal seulement quand le bénéfice est clair : il retire l'utilisateur de son
  contexte et exige une action pour en sortir ;
- tâche modale courte ; pas de hiérarchie de vues à l'intérieur, sinon l'utilisateur
  perd le chemin du retour ;
- éviter le modal qui devient une application dans l'application ;
- aucune action destructive ne passe par `window.confirm()` — garde-fou projet, qui ne
  dispense pas des trois points ci-dessus.

## Avertir, Ou Ne Pas Avertir

Tension réelle entre les HIG et un garde-fou né d'un incident. À lire avant de toucher à
une confirmation.

HIG Alerts : "avoid displaying alerts for common, undoable actions, even when they're
destructive". HIG Feedback : ne pas avertir quand la perte de données est le résultat
**attendu** de l'action.

Sift confirme les lots au-delà de `BATCH_CONFIRM_THRESHOLD`
(`frontend/batch-panel.ts:42`) alors que le rangement est annulable. Lu au pied de la
lettre, HIG demanderait de retirer cette confirmation.

Arbitrage, maintenant que le raccourci d'annulation fonctionne sur les deux cibles :
l'hypothèse des HIG — une annulation atteignable — est vérifiée, mais **la confirmation
reste**, parce qu'elle n'a jamais visé la réversibilité. Elle vise un clic qui n'est pas
humain : un clic synthétique a traversé un `window.confirm()` et rangé 265 pistes. Les
HIG raisonnent sur un utilisateur qui décide ; le garde-fou existe pour le cas où
personne ne décide. Les deux règles ne parlent pas de la même chose et coexistent.

Ce qui **peut** bouger, en revanche : le seuil, et le fait de confirmer une action déjà
annulable au même niveau qu'une action irréversible. Deux réglages, pas une suppression.

## Recherche

HIG Searching, pour Bibliothèque et Écartés.

- une seule zone de recherche clairement identifiée par écran ; la recherche locale n'a
  de sens que si elle filtre la vue courante et le dit ;
- afficher explicitement la **portée** courante : sans elle, un résultat vide est
  ambigu — rien ne correspond, ou on cherche au mauvais endroit ;
- si la recherche est importante sur un écran, elle occupe une position primaire, pas un
  coin ;
- un placeholder descriptif vaut mieux qu'une loupe seule.

## Réglages

HIG Settings, pour l'écran Réglages.

- des valeurs par défaut qui conviennent au plus grand nombre, pour que l'écran soit
  facultatif. Le thème `auto` en est l'exemple (`frontend/reglages-view.ts:46`) ;
- **minimiser le nombre de réglages** : trop d'options rendent l'app moins abordable et
  chaque réglage plus dur à trouver ;
- un réglage qui n'affecte qu'une tâche vit **dans** cette tâche, pas dans l'écran
  global ;
- convention macOS non implémentée : Cmd+, ouvre les réglages. Sift n'a pas de raccourci
  de réglages ; à décider, pas un défaut tant que Réglages est une vue de navigation et
  non une fenêtre séparée.

## Saisie

HIG Entering data, pour l'éditeur de métadonnées et le choix de destination.

- ne jamais demander ce que le système sait déjà — les tags lus dans le fichier sont
  cette information ;
- dire clairement quelle donnée est attendue, par un libellé ou un placeholder d'exemple ;
- pré-remplir avec une valeur par défaut raisonnable réduit la décision autant que la
  frappe ;
- proposer un choix plutôt qu'une saisie libre chaque fois que c'est possible : choisir
  est plus rapide et se trompe moins.

## Fichiers

HIG File management, pour le rangement et l'arbre de destination.

- l'utilisateur doit être certain que son travail est préservé tant qu'il ne le supprime
  pas lui-même ;
- un navigateur de fichiers maison doit rester cohérent avec le système : montrer
  d'abord l'endroit pertinent, mais **laisser accéder au reste** ;
- les commandes de fichier attendues sur macOS passent par le menu Fichier, absent ici
  (`decorations: false`) — le clavier et l'UI portent seuls cette charge.

## Graphiques

HIG Charting data, pour le spectrogramme et le graphique d'occupation.

- un graphique n'est pas la forme par défaut d'un jeu de données. S'il s'agit seulement
  de **fournir** la donnée, une liste triable et cherchable sert mieux ;
- un graphique attire l'œil par construction : ne l'employer que là où il y a quelque
  chose à comprendre. Le spectrogramme qualifie — c'est une preuve, pas une décoration ;
- garder le graphique simple et laisser l'utilisateur demander le détail. Sift le fait
  déjà par construction : la grille du spectrogramme ne voyage plus au repos et se
  recalcule à l'ouverture du collapse Diagnostic.

## Glisser-Déposer

HIG Drag and drop, pour la déclaration de sources.

- le supporter partout où il a du sens : les gens l'essaient partout ;
- toujours offrir une voie alternative — le glisser-déposer ne doit jamais être le seul
  chemin vers une action ;
- **convention système à ne pas contredire en silence** : déposer dans un autre
  conteneur copie, déposer entre deux apps copie toujours. Déposer un dossier sur Sift ne
  copie rien : cela déclare une source. L'écart est légitime, mais l'interface doit le
  dire, sinon l'utilisateur suppose une copie.

## Lancement Et Aide

HIG Launching + Onboarding + Offering help. État mesuré le 2026-08-05 :

- la **géométrie de fenêtre est restaurée** : `tauri-plugin-window-state`
  (`src-tauri/Cargo.toml:33`) est réellement branché (`src-tauri/src/lib.rs:176`) —
  vérifié, une dépendance déclarée sans `.plugin(…)` ne ferait rien ;
- **rien d'autre n'est restauré.** Aucun stockage d'état de vue dans `frontend/` : Sift
  redémarre sur Accueil, sans position de défilement ;
- **aucun onboarding, tutoriel ni écran de bienvenue** — zéro occurrence dans le dépôt ;
- toute l'aide tient dans le survol et l'accessibilité : 46 `title=` et 37 `aria-label` ;
- six modules rendent un état vide via `emptyStateHtml` : `home-sources.ts`,
  `bibliotheque-view.ts`, `ecartes-view.ts`, `filing.ts`, `journal.ts`,
  `rekordbox-view.ts`.

Règles :

- **restaurer l'état précédent**, pas seulement la fenêtre. Les HIG demandent le détail
  fin — vue courante, position de défilement. C'est le seul écart mesuré de cette
  section ;
- pas d'écran de lancement : ni macOS ni Windows n'en demandent. Pas de splash non plus
  tant qu'il n'y a pas d'onboarding à ouvrir ;
- **l'onboarding est un aveu.** « Ideally, people can understand your app or game simply
  by experiencing it. » Pour un outil expert, un flux d'accueil signale surtout qu'un
  écran n'est pas compréhensible seul — corriger l'écran d'abord ;
- si de l'aide est nécessaire, **préférer des astuces contextuelles à un flux unique**,
  chacune posée près de la zone qu'elle concerne. Cela ne contredit pas l'interdit projet
  du « texte pédagogique permanent dans une zone expert » (`content.md`) : ce qui est
  proscrit est le *permanent*, pas le contextuel ;
- la forme suit la tâche : une à deux étapes → texte en ligne ; tâche longue → guide.
  Toujours renvoyable ;
- **ne jamais expliquer comment marche un composant standard.** Décrire ce que cet
  élément fait *dans Sift*. Les seuls contrôles qui méritent une orientation sont ceux
  qui n'ont pas d'équivalent ailleurs — spectrogramme, key-lock, arbre de destination —
  et une image y vaut mieux qu'un paragraphe ;
- l'**état vide est le support d'aide principal** de Sift, et c'est conforme : il place
  l'explication exactement là où la tâche est bloquée.

## Lecture Audio

HIG Playing audio, pour la Revue son-d'abord.

- ajuster les niveaux **relatifs** de l'app si nécessaire, jamais le volume général du
  système ;
- le réglage de volume système gouverne tout le son ; ne pas s'en abstraire ;
- au débranchement d'un casque, la lecture doit s'interrompre immédiatement — comportement
  **non vérifié** dans Sift, à mesurer avant d'affirmer quoi que ce soit ;
- le son est ici le premier instrument de décision, pas un ornement : tout ce qui retarde
  l'écoute retarde le verdict.
