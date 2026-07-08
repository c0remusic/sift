# Design — Agent Operating Model (sizing + YAGNI/evidence + lisibilité)

Date : 2026-07-08
Statut : approuvé (brainstorming), prêt pour writing-plans
Portée : **globale** (tous projets Antoine — Sift, Tuple, Tupline, futurs), pas
seulement Sift. Ce spec est écrit dans Sift car c'est ici que la décision se
prend (même précédent que la purge de plugins cross-projet du 2026-07-03,
`docs/ressources-externes.md`).

## Problème

Antoine a demandé de regarder l'architecture du plugin `testdouble/han`
(skills qui dispatchent des agents, sizing small/medium/large, gate YAGNI +
evidence, standard de lisibilité) et d'en tirer une amélioration pour son
propre setup. Investigation menée avant de proposer quoi que ce soit :

- Installer `han@han` ferait doublon réel avec `superpowers` (planning/TDD/
  review) déjà en place sur les 3 projets — refusé.
- Un vrai trou existait déjà en partie comblé : un spec antérieur,
  `2026-07-06-agent-token-budget-operating-model-design.md`, avait déjà conçu
  l'équivalent du "sizing" de Han (mini/normal/large) mais était **resté
  orphelin** — jamais référencé nulle part, jamais activé.
- YAGNI+evidence et lisibilité n'avaient aucun équivalent formalisé, mais
  existent déjà *en pratique* de façon informelle (`ressources-externes.md`
  section "Écarté", évaluations sourcées).
- 4 autres ressources lues en cours de route
  (`compound-engineering-plugin`, `sandcastle`, `claude-opus-dev-workbench`,
  `OpenSpec`, le post `files-are-the-memory`) ont chacune apporté soit une
  confirmation (mémoire déjà en place), soit un rejet motivé (Docker
  disproportionné, repo spam), soit une seule vraie idée retenue : la
  structure "un dossier par chantier" d'OpenSpec, en réponse à la plainte
  concrète d'Antoine sur `docs/superpowers/specs|plans|reviews/` — trop de
  fichiers datés à plat, dur à parcourir humainement.

Objectif final, élargi en cours de brainstorm à la demande d'Antoine :
un mode opératoire **adopté sur tous ses projets actuels et futurs**, pas
une convention Sift-only.

## Sources évaluées

- [testdouble/han](https://github.com/testdouble/han) — plugin Claude Code
  réel. Skill = flowchart déterministe (`/commande`) ; agent = persona à
  jugement, dispatché par une skill. Sizing (small/medium/large) calibre le
  nombre d'agents avant tout fan-out. YAGNI = gate d'inclusion à 2 tests
  (preuve maintenant ? version plus simple suffirait ?), items sans preuve
  différés (jamais supprimés silencieusement) sous une section dédiée avec
  trigger de réouverture. Evidence = 3 tiers de confiance (codebase/web/
  provided) + corroboration à 2 sources pour le web. Lisibilité = standard
  partagé pour toute sortie lue par un humain (point principal en tête, une
  idée par paragraphe, détail en couches).
- [EveryInc/compound-engineering-plugin](https://github.com/everyinc/compound-engineering-plugin) —
  boucle brainstorm→plan→work→simplify→review→**compound**, ce dernier
  écrivant l'apprentissage pour que le prochain brainstorm le relise. Sift a
  déjà presque toute la boucle (`brainstorming`→`writing-plans`→
  `executing-plans`→skill `simplify`→`code-review`) sauf cette clôture
  explicite. **Écarté après examen** : `wrap-up` (skill globale existante,
  phase "Remember It") couvre déjà l'essentiel du même geste ; ajouter une
  4e mécanique aurait été de la cérémonie pour un gain marginal.
- [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) —
  orchestration d'agents en sandbox Docker/Podman/Vercel avec stratégies de
  branche. **Écarté** : Sift a déjà une isolation native suffisante
  (`Agent isolation:"worktree"`, `superpowers:using-git-worktrees`) sans
  dépendance Docker ; disproportionné pour du dev desktop Windows solo.
- [ilhamnurrachman/claude-opus-dev-workbench](https://github.com/ilhamnurrachman/claude-opus-dev-workbench) —
  **repo spam/SEO-bait**, pas de vrai code (section "SEO-Friendly Keywords"
  explicite, bouton "Download" vers une page externe). Exclu de l'analyse,
  jamais suivi le lien de téléchargement.
- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — dossier par
  changement (`proposal.md`+`specs/`+`design.md`+`tasks.md`), archivé après
  merge, plus un `specs/` vivant séparé de l'historique pour la coordination
  multi-repo (`Stores`, en beta). Le multi-repo ne concerne pas Antoine (dev
  solo) — **seule l'idée retenue : dossier par chantier au lieu de fichiers
  plats**, en réponse directe à la plainte de lisibilité.
- [twyoon.com/writings/files-are-the-memory](https://twyoon.com/writings/files-are-the-memory/) —
  thèse : les fichiers sont la seule couche de mémoire durable pour un agent
  sans état ; écriture systématique + relecture disciplinée. **Confirme, ne
  change rien** : Sift a déjà ce pattern via `.remember/` + mémoire MCP
  (dual-write, `CLAUDE.md` comme mémoire durable).

## Architecture

Pas de nouveau système parallèle, pas de roster d'agents nommés façon Han
(`adversarial-security-analyst`, `structural-analyst`...) — écarté
explicitement en cours de brainstorm : Antoine reste sur ses agents
génériques (`rust-engineer`, `architect`, `Explore`, sous-agents `Agent` ad
hoc typés par prompt). Trois mécaniques génériques, un doc global, une
convention de dossier, un point de couture dans une skill existante.

### 1. Sizing — activer et compléter le spec existant

`2026-07-06-agent-token-budget-operating-model-design.md` (déjà écrit,
statut "approuvé, prêt pour writing-plans", jamais référencé) définit déjà 3
paliers **mini/normal/large** avec templates de prompts bornés et "packs de
contexte" par domaine. Ce qui manque, comparé au sizing de Han : la
**classification automatique par signaux** (nombre de fichiers touchés,
sous-systèmes, présence de surface sensible définie par projet — ex.
`master.db` Rekordbox pour Sift) plutôt que "à l'instinct de l'orchestrateur".

Le contenu générique (3 paliers, templates de prompts, workflow en 5 étapes)
va dans le doc global `~/.claude/agent-operating-model.md`. Les "packs de
contexte" restent **par projet** (Pack UI live / Rust backend / Rekordbox
sont spécifiques à Sift) — chaque projet garde sa propre liste de packs dans
son `CLAUDE.md` ou son `skills-registre.md`, référencée depuis le doc global
comme un menu à instancier, pas un contenu à copier.

### 2. YAGNI + Evidence — formaliser un pattern déjà pratiqué

Deux tests avant d'inclure un item (feature, étape de plan, recommandation
de veille) dans un artefact : *preuve requise maintenant ?* et *existe-t-il
une version strictement plus simple qui satisfait la même preuve ?* Item
sans preuve → état **Différé** (pas supprimé), noté avec un déclencheur de
réouverture nommé.

Vocabulaire à 3 tiers de confiance : **codebase** (grep/lecture directe du
code) > **provided** (déclaration directe d'Antoine) > **web** (nécessite
corroboration — 2 sources indépendantes minimum).

Ceci **formalise** ce que `ressources-externes.md` (Sift) / `decisions.md`
(Tuple) font déjà à la main depuis des mois — les entrées "Évaluation N"
citent déjà leurs preuves, la section "Écarté" existe déjà. Le changement
réel : distinguer explicitement **Écarté** (tranché, raison donnée, ne sera
pas reconsidéré sans nouveau signal) de **Différé** (pas assez de preuve
*pour l'instant*, trigger de réouverture nommé) — ces deux états sont
aujourd'hui confondus sous "Écarté".

S'applique à 3 cibles (validées explicitement en brainstorm) :
specs/plans (`brainstorming`→`writing-plans`), veille technique (fichier de
décision par projet), rapports d'agents (le template "reviewer adverse" du
spec sizing a déjà un champ "preuve" — aligner le vocabulaire).

### 3. Lisibilité — checklist légère, pas d'agent dédié

5 règles en auto-relecture (pas un `readability-editor` séparé façon Han,
disproportionné pour un solo dev) : mener par le point principal, une idée
par paragraphe, titres descriptifs, langage simple, détail en couches.
Appliquée en fin de `brainstorming`/`writing-plans` avant d'écrire
`design.md`/`plan.md`, et aux rapports d'agents/audits.

### 4. Convention de dossier — `changes/` au lieu de `specs/`+`plans/`+`reviews/` à plat

```
docs/superpowers/changes/
  2026-07-08-<slug>/
    design.md      (ex specs/*-design.md)
    plan.md         (ex plans/*.md)
    review.md       (ex reviews/*.md, si applicable)
  archive/
    2026-07-05-visual-pointer-annotation/   ← déplacé une fois livré
```

- Préfixe date conservé (tri chronologique gratuit dans l'explorateur de
  fichiers, cohérent avec le pattern déjà en place dans
  `ressources-externes.md`) — pas de renommage total façon OpenSpec.
- **Nouveaux chantiers seulement.** Aucun renommage rétroactif des fichiers
  existants (~80+ sur Sift) sur aucun des 3 projets. `INDEX.json` (ou
  équivalent) continue de cataloguer l'ancien flat à côté du nouveau
  `changes/`.
- Archivage déclenché par `wrap-up` (voir plus bas) une fois un chantier
  constaté livré/mergé.

## Où ça vit

1. **`~/.claude/agent-operating-model.md`** (nouveau) — les 3 mécaniques
   génériques + la convention `changes/`, écrit projet-agnostique. Suit le
   même pattern que `RTK.md` (fichier séparé référencé, pas inline dans
   `CLAUDE.md` — trop volumineux pour être empilé).
2. **`~/.claude/CLAUDE.md`** — une ligne `@agent-operating-model.md`, ajoutée
   au même endroit que `@RTK.md`.
3. **`~/.claude/skills/wrap-up/SKILL.md`** — Phase 1 ("Ship It") gagne une
   étape générique : si un dossier `docs/superpowers/changes/<slug>/` est
   constaté livré/mergé pendant la session, proposer son déplacement vers
   `changes/archive/<slug>/`. Reste générique (lit la convention du repo
   courant comme le fait déjà toute la skill) — pas de chemin Sift codé en
   dur dans une skill partagée.
4. **Par projet, au fil de l'eau (pas tout d'un coup)** — un pointeur court
   dans le `CLAUDE.md` local vers le fichier de veille/décision réel du
   projet (`ressources-externes.md` pour Sift, `decisions.md` pour Tuple,
   à créer pour Tupline) et, si le projet a déjà des "packs de contexte"
   spécifiques (Sift en a), les garder localement.

   Scope explicite pour le plan issu de ce spec : **seul le pointeur Sift
   est fait maintenant** (repo courant). Tuple et Tupline sont **différés**
   au sens de la mécanique YAGNI définie ci-dessus, pas oubliés — trigger de
   réouverture nommé : la prochaine session de travail ouverte sur chacun
   de ces repos, où le pointeur s'ajoute en 2 minutes une fois
   `~/.claude/agent-operating-model.md` déjà en place.

## Non-objectifs

- Pas d'installation de `han@han` ni d'aucun plugin tiers.
- Pas de roster d'agents nommés façon Han — agents génériques existants
  inchangés.
- Pas de 4e mécanique "compound" — `wrap-up` Phase 2 ("Remember It") couvre
  déjà ce geste.
- Pas de sandboxing Docker/Podman (`sandcastle`) — isolation worktree déjà
  suffisante.
- Pas de migration rétroactive des fichiers `specs/`/`plans/`/`reviews/`
  existants sur aucun projet.
- Pas d'outil CLI dédié (`openspec init`, etc.) — convention de dossier
  suivie à la main comme le reste des conventions Claude Code d'Antoine.

## Vérification de la spec

- Aucun changement runtime sur aucun des 3 projets (documentaire uniquement).
- Le spec sizing existant (`2026-07-06-...`) est réutilisé, pas réécrit
  depuis zéro — son contenu "packs de contexte Sift" reste dans Sift.
- Cohérent avec les garde-fous anti-cascade déjà documentés dans
  `docs/skills-registre.md` (Sift) — non dupliqués ici.
- Scope assez petit pour un plan d'implémentation documentaire : créer
  1 fichier global, éditer 2 fichiers globaux (`CLAUDE.md`, `wrap-up`),
  ajouter un pointeur court par projet (3 projets), au fil de l'eau.
