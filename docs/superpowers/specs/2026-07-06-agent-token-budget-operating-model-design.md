# Design — Agent Token Budget Operating Model

Date : 2026-07-06
Statut : activé le 2026-07-08 — paliers + templates de prompts migrés vers
`~/.claude/agent-operating-model.md` (global), packs de contexte migrés
vers `docs/skills-registre.md` (Sift). Ce fichier reste la trace de
décision d'origine, plus la source vive.

## Probleme

Le setup Codex local permet maintenant de lancer des agents et le sandbox CLI,
mais le multi-agent peut facilement couter plus cher qu'il ne rapporte :
- chaque agent relit une partie du contexte projet ;
- les gros blocs stables (`AGENTS.md`, registre skills, index docs) peuvent
  etre recopies inutilement ;
- les agents de revue/audit ont tendance a rendre des rapports longs ;
- Sift a deja connu un incident de delegation en cascade et d'agents qui
  ecrivent dans les memes fichiers.

Objectif : creer un mode operatoire qui permet d'utiliser plusieurs agents
quand c'est utile, tout en reduisant le nombre de tokens envoyes et produits.

## Sources externes

- Anthropic, "How we built our multi-agent research system" (2025-06-13) :
  recommande un pattern orchestrator-worker, des sous-agents a contexte isole,
  des artefacts persistants pour eviter le telephone arabe, et rappelle que le
  multi-agent consomme beaucoup plus qu'un chat classique.
  https://www.anthropic.com/engineering/multi-agent-research-system
- "Don't Break the Cache" (arXiv, 2026-01-09) : le prompt caching reduit les
  couts de 45-80% sur des taches agentiques longues quand le contexte stable
  est structure proprement et que le contenu dynamique ne casse pas le cache.
  https://arxiv.org/abs/2601.06007
- "Active Context Compression" (arXiv, 2026-01-12) : compression active de
  contexte sur taches SWE, environ 22.7% de tokens en moins sans perte
  d'exactitude sur l'evaluation decrite.
  https://arxiv.org/abs/2601.07190
- "AOrchestra" (arXiv, 2026-02-03) : modele chaque sous-agent par le tuple
  Instruction, Context, Tools, Model. Ce tuple devient la base des prompts
  bornes ci-dessous.
  https://arxiv.org/abs/2602.03786

## Decisions

1. **Un seul orchestrateur possede l'etat global.** Dans une session Sift,
   l'agent principal conserve la vision produit, les decisions, le suivi git
   et l'integration. Les autres agents ne recoivent qu'un paquet de contexte
   volontairement incomplet.
2. **Pas de multi-agent par defaut.** Une tache courte ou limitee a 1-2
   fichiers reste mono-agent. Le multi-agent est reserve a l'audit large, a la
   revue adverse, ou a l'execution de tranches vraiment independantes.
3. **Chaque delegation est un tuple explicite** :
   - `Instruction` : objectif et definition de fini.
   - `Context` : fichiers et extraits autorises, pas tout le repo.
   - `Tools` : lecture seule, edition bornee, tests autorises/interdits.
   - `Model` : niveau de raisonnement attendu, budget et format de sortie.
4. **Les sous-agents produisent court par defaut.** Rapport cible : 10-30
   lignes, avec fichiers touches, commandes lancees, risques restants. Les
   rapports longs vont dans un fichier sous `docs/superpowers/reviews/` ou
   `docs/superpowers/specs/`, puis l'agent ne renvoie qu'une reference.
5. **Les contextes stables sont references, pas recopies.** Un prompt d'agent
   cite le fichier de reference a lire et les sections utiles, au lieu de
   coller `AGENTS.md` ou `docs/skills-registre.md` en entier.
6. **Le fan-out d'ecriture exige isolation.** Soit les fichiers autorises sont
   disjoints, soit chaque agent travaille dans un worktree separe. Sinon,
   execution sequentielle avec review entre les tranches.

## Budgets de decision

### Budget mini

Usage : question ciblee, bug simple, edit dans 1-2 fichiers, verification
rapide.

Regles :
- 1 agent seulement.
- Pas de recherche docs large.
- Lire uniquement les fichiers touches et le registre skills si la tache est
  substantielle.
- Sortie finale courte.

### Budget normal

Usage : feature ou fix non trivial, 3-8 fichiers, risque de regression.

Regles :
- 1 orchestrateur + 1 sous-agent ponctuel maximum.
- Sous-agent typique : reviewer adverse, docs researcher, ou executeur borne.
- Pas de fan-out.
- Verification unique en fin de tranche (`npx tsc --noEmit`, `cargo test`,
  `cargo clippy`, ou commande specifique du plan).

### Budget large

Usage : audit large, perf, securite, conformite spec/code, gros chantier avec
tranches independantes.

Regles :
- 2-4 agents maximum.
- Lecture seule par defaut.
- Si ecriture parallele : worktree separe obligatoire.
- Chaque agent a un perimetre de fichiers explicite et disjoint.
- L'orchestrateur relit les findings, deduplique, priorise, puis seulement
  ensuite lance une implementation.

## Packs de contexte Sift

Les packs ci-dessous sont des menus, pas des blocs a coller integralement.
L'orchestrateur choisit les 3-8 fichiers utiles et cite les sections a lire.

### Pack UI live

- `AGENTS.md` : sections Vision, Front — evenements repetes, Front — CSS,
  Verification UI.
- `docs/design-system-states.md` : composants concernes seulement.
- `frontend/styles.css`.
- Fichiers frontend touches (`report-view.ts`, `filing.ts`,
  `batch-tracklist.ts`, etc.).
- Commande de verification par defaut : `npx tsc --noEmit`.

### Pack Rust backend

- `AGENTS.md` : sections Stack, Commandes, Documentation lookups, Methode.
- `docs/skills-registre.md` : lignes Rust/backend.
- Fichiers `src-tauri/src/*.rs` concernes seulement.
- `src-tauri/Cargo.toml` si dependances/features.
- Commandes : `cargo test --manifest-path src-tauri/Cargo.toml` et/ou
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

### Pack Rekordbox / master.db

- `AGENTS.md` : garde-fou "Jamais une ecriture sur un systeme live".
- `docs/ressources-externes.md` : evaluations Rekordbox pertinentes.
- Specs/plans M8 actifs uniquement.
- Fichiers Rust/TS concernes.
- Toute verification dans le vrai Rekordbox reste manuelle par Antoine.

### Pack docs / planning

- `docs/INDEX.json`.
- Spec/plan cible.
- `docs/skills-registre.md` si routage skills.
- Pas de lecture large de `frontend/` ou `src-tauri/` sauf question precise.

### Pack review adverse

- La spec approuvee.
- Le diff (`git diff -- <fichiers>`).
- Les fichiers modifies uniquement.
- Les regles AGENTS strictement pertinentes.
- Sortie : findings file:line, severite, test manquant, pas de resume long.

## Templates de prompts

### Executeur borne

```text
Tu es un agent executeur borne sur Sift.

N'utilise JAMAIS l'outil Agent ni de tache de fond.
Implemente toi-meme avec les outils directs.

Objectif:
<objectif precis et definition de fini>

Fichiers autorises:
<liste exhaustive des fichiers modifiables>

Fichiers interdits:
<liste ou glob des zones hors scope>

Contexte a lire:
<fichiers et sections a lire, pas le repo entier>

Contraintes:
- Ne change pas le scope.
- Ne touche pas aux fichiers non listes.
- Ne lance pas cargo/tauri dev si un autre agent Rust tourne.
- Si une API externe est impliquee, verifie la doc actuelle avant d'affirmer.

Verification obligatoire:
<commande exacte a lancer, ou justification si aucune commande n'existe>

Retour attendu:
- fichiers modifies
- commandes lancees et resultat
- risques restants
- pas plus de 30 lignes
```

### Reviewer adverse

```text
Tu es reviewer adverse, lecture seule.

N'utilise JAMAIS l'outil Agent ni de tache de fond.
Ne modifie aucun fichier.

Spec:
<chemin de la spec ou extrait court>

Diff/fichiers a relire:
<git diff cible ou liste des fichiers>

Cherche uniquement:
- bug ou regression comportementale
- violation d'AGENTS.md
- test/verif manquante
- incoherence entre spec et code

Retour attendu:
- findings en premier
- format: severite, fichier:ligne, probleme, preuve
- pas de compliments, pas de refactor hors scope
- si aucun finding: dis-le et liste le risque residuel
```

### Agent lecture seule d'audit

```text
Tu es agent d'audit lecture seule sur un domaine unique.

Domaine:
<domaine unique de l'audit>

Contexte a lire:
<fichiers et sections a lire>

Hors scope:
<ce que l'agent doit ignorer>

Interdictions:
- aucune edition
- aucun sous-agent
- pas de cargo/tauri dev sauf demande explicite

Retour attendu:
- 3-7 findings maximum
- chaque finding avec fichier:ligne et preuve
- signale "rien trouve" si c'est le cas
- pas de recommandations generales sans preuve locale
```

## Workflow recommande

### 1. Choisir le budget

Avant toute delegation, l'orchestrateur choisit `mini`, `normal` ou `large`.
Si le choix est `large`, il explique pourquoi le gain justifie le cout.

### 2. Construire le pack

L'orchestrateur liste les fichiers et sections utiles. Tout fichier de plus de
100 KB est evite sauf necessite prouvee.

### 3. Lancer les agents

Les agents partent avec un prompt self-contained et borne. Sur Sift, inclure
systematiquement les garde-fous anti-delegation en cascade du registre skills.

### 4. Integrer en deux passes

Premiere passe : deduplication des retours, rejet des findings non prouves,
identification des conflits de fichiers.

Deuxieme passe : plan d'action sequentiel. Les agents ne mergent pas leurs
propres decisions dans le produit sans relecture de l'orchestrateur.

### 5. Compresser l'etat

Apres une tache longue, l'orchestrateur ecrit un resume court :
- decisions prises ;
- fichiers modifies ;
- commandes vertes/rouges ;
- risques restants ;
- prochain pas.

Ce resume remplace l'historique brut pour les agents suivants.

## Non-objectifs

- Pas de framework multi-agent automatique.
- Pas de spawn libre d'agents depuis des sous-agents.
- Pas de mesure fine des tokens par API tant que Codex Desktop ne l'expose pas
  proprement dans le workflow local.
- Pas de migration de tout le repo vers un systeme de prompts generes.

## Verification de la spec

- Aucun changement runtime Sift.
- Les templates respectent les garde-fous deja documentes dans
  `docs/skills-registre.md`.
- Le modele favorise la reduction de contexte repete avant l'ajout d'agents.
- Le scope est assez petit pour un plan d'implementation documentaire :
  ajouter 2-3 documents courts et une section de routage dans `AGENTS.md` ou
  `docs/skills-registre.md`.
