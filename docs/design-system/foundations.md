# Sift Design System - Foundations

> Couche de lecture du systeme reel. La source de verite reste
> `frontend/styles.css` pour les tokens et `docs/design-system-states.md` pour les
> etats de composants. Ce dossier documente comment les utiliser, sans creer de
> theme parallele.

## Produit

Sift est un outil desktop de controle qualite et de preparation de musique pour
DJ. Il sert avant le set, pas pendant le live : analyser un fichier, identifier
ses metadonnees, choisir ou il doit aller, puis convertir et ranger.

Le principe produit central reste :

> Deplacer = encoder + ranger.

L'ecran Revue est donc un poste de decision. Il doit aider l'utilisateur a
repondre vite a quatre questions :

1. Est-ce que le fichier audio est sain pour jouer en club ?
2. Est-ce que l'identification est fiable ?
3. Ou dois-je ranger ce morceau ?
4. Sous quel format et sous quel nom final part-il ?

## Utilisateur

L'utilisateur cible est un DJ serieux qui traite de gros volumes. Il accepte une
interface dense si elle est lisible, stable et honnete. Il n'a pas besoin d'une
interface marketing ou educative ; il a besoin d'un outil qui lui donne confiance
dans une decision repetitive.

Implications directes :

- densite avant decoration ;
- libelles courts, vocabulaire metier, pas de ton ludique ;
- signal clair entre pret, douteux, bloque et actionnable ;
- etats persistants sobres, transitions visibles seulement au moment utile ;
- aucune information critique cachee derriere une couleur seule.

## Personnalite Visuelle

Sift doit ressembler a un outil de preparation pro : calme, precis, technique,
mais pas austere. La surface doit rester proche d'un espace de travail continu,
avec des panneaux uniquement quand ils ont une vraie fonction structurelle.

Direction actuelle :

- gris chauds comme base ;
- vert pour succes/compatibilite ;
- ambre pour attention/decision ;
- rouge pour risque reel ;
- bleu/info uniquement quand l'action ou l'etat est informationnel ;
- accents categoriels reserves aux taxonomies, pas aux titres de section.

Anti-references :

- dashboard SaaS decoratif ;
- landing page ;
- suite audio trop complexe ;
- interface consumer coloree ;
- empilement de cartes sans hierarchie.

## Sources De Verite

| Sujet | Source canonique |
|---|---|
| Tokens, couleurs, typo, espacements | `frontend/styles.css` |
| Etats reels des composants | `docs/design-system-states.md` |
| Vision produit | `PRODUCT.md` |
| Routage skills/agents | `docs/skills/sift-ui-design-governance.md` |
| Regles projet | `AGENTS.md` |
| Maquettes exploratoires | `docs/mockups/` uniquement pour explorer |

`docs/mockups/` peut servir a tester une direction, mais l'app reelle est la
surface de design. Toute decision durable doit finir dans les fichiers de
production et dans la documentation canonique concernee.

## Principe De Travail

Ordre obligatoire :

1. besoin utilisateur ;
2. parcours ;
3. UX ;
4. UI ;
5. performance ;
6. code.

Pour une retouche visuelle, ne pas commencer par "quelle couleur". Commencer par
ce que l'utilisateur doit comprendre ou decider a cet endroit.

