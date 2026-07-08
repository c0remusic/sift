# Agent Operating Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a cross-project "agent operating model" (sizing, YAGNI+evidence, readability, per-chantier folder convention) as a global Claude Code convention, activating the previously-orphaned sizing spec and wiring it into `wrap-up` and Sift's own docs.

**Architecture:** One new global doc (`~/.claude/agent-operating-model.md`) holds the three generic mechanics + the folder convention. `~/.claude/CLAUDE.md` references it exactly like the existing `@RTK.md` pattern. The global `wrap-up` skill gets one generic new step (archive a finished `changes/` folder). Sift gets a short local pointer plus its project-specific "packs of context" migrated out of the orphaned spec into `docs/skills-registre.md`. Tuple and Tupline pointers are explicitly out of scope for this plan (deferred per the YAGNI mechanic this plan itself introduces).

**Tech Stack:** Markdown only. No code, no build, no test runner — "tests" in this plan are `grep`/`Read` verifications that the expected text landed in the expected file.

## Global Constraints

- New work only: do not rename, move, or migrate any existing file under `docs/superpowers/specs/`, `docs/superpowers/plans/`, or `docs/superpowers/reviews/` on any project. Confirmed explicitly in the spec's Non-objectifs section.
- `~/.claude/agent-operating-model.md` must be project-agnostic (no Sift-specific paths inside it) — Sift-specific content (packs of context, veille file name) goes only into Sift's own files (Task 4).
- Tuple and Tupline pointers are out of scope for this plan (spec section "Où ça vit", item 4: "seul le pointeur Sift est fait maintenant").
- Files under `~/.claude/` are NOT part of the Sift git repo — no `git commit` for Tasks 1–3. Files under the Sift repo (Tasks 4–5) get committed normally.
- Every step must show real content — no "TBD" placeholders anywhere (already true of the design; carry that discipline into the plan's own file bodies).

---

### Task 1: Write the global operating model doc

**Files:**
- Create: `C:\Users\LEETJ\.claude\agent-operating-model.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a file at `~/.claude/agent-operating-model.md` with four numbered sections (`1. Sizing`, `2. YAGNI + Evidence`, `3. Lisibilité`, `4. Convention de dossier`) — later tasks (2, 3, 4) reference this file by path and by section number, so the section numbering below must not change once written.

- [ ] **Step 1: Write the file**

Create `C:\Users\LEETJ\.claude\agent-operating-model.md` with exactly this content:

```markdown
# Agent Operating Model

Mécaniques génériques appliquées à tout projet Antoine (Sift, Tuple, Tupline,
futurs), en complément des skills `superpowers` déjà en place (`brainstorming`,
`writing-plans`, `executing-plans`, `subagent-driven-development`,
`dispatching-parallel-agents`). Ne remplace aucune skill existante — cadre
leur usage. Origine : évaluation de `testdouble/han` +
`compound-engineering-plugin` + `OpenSpec`, voir le spec complet dans le repo
Sift (`docs/superpowers/specs/2026-07-08-agent-operating-model-design.md`)
pour le détail des sources et des alternatives écartées.

## 1. Sizing — classifier avant de dispatcher

Avant tout fan-out d'agents (`subagent-driven-development`,
`dispatching-parallel-agents`, ou toute délégation via l'outil `Agent`),
classifier la tâche en un palier.

### Paliers

**Mini** — question ciblée, bug simple, édit dans 1-2 fichiers, vérification
rapide.
Règles : 1 agent seulement, pas de recherche docs large, sortie finale
courte.

**Normal** — feature ou fix non trivial, 3-8 fichiers, risque de régression.
Règles : 1 orchestrateur + 1 sous-agent ponctuel maximum, pas de fan-out,
vérification unique en fin de tranche.

**Large** — audit large, perf, sécurité, conformité spec/code, gros chantier
à tranches indépendantes.
Règles : 2-4 agents maximum, lecture seule par défaut, écriture parallèle →
worktree séparé obligatoire, périmètre de fichiers explicite et disjoint par
agent, l'orchestrateur relit/déduplique/priorise avant d'implémenter.

### Classification automatique

Avant de choisir un palier, lire ces signaux — pas à l'instinct :
- Nombre de fichiers probablement touchés (estimé depuis la demande).
- Nombre de sous-systèmes distincts touchés (ex. front + backend + DB).
- Présence d'une surface sensible définie par le projet courant (voir son
  `CLAUDE.md` — ex. écriture `master.db` Rekordbox live sur Sift).
- Demande explicite d'audit/revue large ("audit complet", "revue
  exhaustive").

Règle de décision : 1 fichier + 0 signal sensible → mini. 3-8 fichiers OU 1
signal → normal. Sous-systèmes multiples, OU signal sensible avec fan-out
demandé, OU audit explicite → large.

Annoncer le palier choisi en une ligne avant de dispatcher, avec le signal
qui a décidé.

### Packs de contexte

Chaque projet définit ses propres "packs" (quels fichiers lire pour quel
type de tâche) dans son `CLAUDE.md` ou son `skills-registre.md` — ce ne sont
pas des blocs à coller intégralement, mais un menu dont l'orchestrateur
choisit 3-8 fichiers utiles. Voir le projet courant pour ses packs réels
(Sift : `docs/skills-registre.md`, section "Packs de contexte (sizing)").

### Templates de prompts

**Exécuteur borné :**

```text
Tu es un agent exécuteur borné sur <projet>.

N'utilise JAMAIS l'outil Agent ni de tâche de fond.
Implémente toi-même avec les outils directs.

Objectif:
<objectif précis et définition de fini>

Fichiers autorisés:
<liste exhaustive des fichiers modifiables>

Fichiers interdits:
<liste ou glob des zones hors scope>

Contexte à lire:
<fichiers et sections à lire, pas le repo entier>

Contraintes:
- Ne change pas le scope.
- Ne touche pas aux fichiers non listés.
- Ne lance pas de build/dev concurrent si un autre agent tourne dessus.
- Si une API externe est impliquée, vérifie la doc actuelle avant d'affirmer.

Vérification obligatoire:
<commande exacte à lancer, ou justification si aucune commande n'existe>

Retour attendu:
- fichiers modifiés
- commandes lancées et résultat
- risques restants
- pas plus de 30 lignes
```

**Reviewer adverse :**

```text
Tu es reviewer adverse, lecture seule.

N'utilise JAMAIS l'outil Agent ni de tâche de fond.
Ne modifie aucun fichier.

Spec:
<chemin de la spec ou extrait court>

Diff/fichiers à relire:
<git diff cible ou liste des fichiers>

Cherche uniquement:
- bug ou régression comportementale
- violation des conventions projet (CLAUDE.md/AGENTS.md)
- test/vérif manquante
- incohérence entre spec et code

Retour attendu:
- findings en premier
- format: sévérité, fichier:ligne, problème, preuve
- pas de compliments, pas de refactor hors scope
- si aucun finding: dis-le et liste le risque résiduel
```

**Agent lecture seule d'audit :**

```text
Tu es agent d'audit lecture seule sur un domaine unique.

Domaine:
<domaine unique de l'audit>

Contexte à lire:
<fichiers et sections à lire>

Hors scope:
<ce que l'agent doit ignorer>

Interdictions:
- aucune édition
- aucun sous-agent
- pas de build/dev sauf demande explicite

Retour attendu:
- 3-7 findings maximum
- chaque finding avec fichier:ligne et preuve
- signale "rien trouvé" si c'est le cas
- pas de recommandations générales sans preuve locale
```

## 2. YAGNI + Evidence — gate d'inclusion

S'applique à : specs/plans (`brainstorming`→`writing-plans`), fichier de
veille/décision du projet courant, rapports d'agents (fan-out).

Avant d'inclure un item (feature, étape de plan, recommandation) dans un
artefact :

1. **Test de preuve** : y a-t-il une preuve concrète que c'est nécessaire
   maintenant (usage réel observé, bug reproduit, demande explicite) ?
2. **Test de simplicité** : existe-t-il une version strictement plus simple
   qui satisferait la même preuve ?

Si l'un des deux tests échoue → l'item n'est **pas supprimé silencieusement** :
il passe dans une section "Différé" de l'artefact, avec un déclencheur de
réouverture nommé (ex. "si un 2e cas d'usage apparaît", "si Antoine demande
X").

### Vocabulaire de preuve (3 tiers)

- **codebase** — preuve tirée d'une lecture/grep directe du code du projet.
  Le tier le plus fort.
- **provided** — déclaration directe d'Antoine dans la conversation.
- **web** — source externe (doc officielle, repo tiers, article). Nécessite
  corroboration : 2 sources indépendantes minimum avant d'être traité comme
  fiable ; une seule source web = signalé explicitement comme non corroboré.

### Différé vs Écarté

Deux états distincts, ne pas confondre :
- **Écarté** — tranché, raison donnée, ne sera pas reconsidéré sans un
  nouveau signal fort.
- **Différé** — pas assez de preuve *pour l'instant*, trigger de réouverture
  nommé, à reconsidérer dès que ce trigger se produit.

## 3. Lisibilité — checklist d'auto-relecture

Appliquée en fin de `brainstorming`/`writing-plans` avant d'écrire
`design.md`/`plan.md`, et aux rapports d'agents/audits destinés à être lus
par Antoine. Pas d'agent dédié séparé — une checklist en auto-relecture.

5 règles, vérifiées une à une avant de livrer :

1. Le point principal est-il énoncé dans la première phrase/le premier
   paragraphe (pas enterré après du contexte) ?
2. Chaque paragraphe porte-t-il une seule idée ?
3. Les titres décrivent-ils le contenu de la section (pas juste "Détails"
   ou "Suite") ?
4. Le langage est-il simple (mots courants, phrases courtes) plutôt que
   jargon inutile ?
5. Le détail technique est-il en couches (résumé d'abord, détail ensuite
   pour qui veut creuser) plutôt que tout au même niveau ?

Si un rapport échoue à une règle, la corriger avant de le livrer — pas une
relecture séparée, une correction inline.

## 4. Convention de dossier — un chantier, un dossier

Remplace `docs/superpowers/specs/` + `docs/superpowers/plans/` +
`docs/superpowers/reviews/` à plat, **pour les nouveaux chantiers
seulement** — aucun renommage rétroactif des fichiers existants sur aucun
projet.

```
docs/superpowers/changes/
  YYYY-MM-DD-<slug>/
    design.md      (sortie de brainstorming)
    plan.md         (sortie de writing-plans)
    review.md       (sortie de requesting-code-review, si applicable)
  archive/
    YYYY-MM-DD-<slug>/   ← déplacé une fois le chantier livré/mergé
```

- Préfixe date conservé sur le nom de dossier (tri chronologique gratuit).
- Un chantier = un dossier, tout son cycle de vie dedans (design → plan →
  review), au lieu de 3 fichiers séparés recoupés seulement via un index
  externe.
- Le catalogue existant du projet (`INDEX.json` ou équivalent) continue de
  cataloguer l'ancien flat à côté du nouveau `changes/` — pas de migration.
- Archivage : voir la skill `wrap-up`, Phase 1 — un chantier constaté
  livré/mergé pendant la session est proposé pour déplacement vers
  `archive/`.
```

- [ ] **Step 2: Verify the file landed correctly**

Run: `grep -c "^## " "C:\Users\LEETJ\.claude\agent-operating-model.md"`
Expected: `4` (four `##`-level sections: Sizing, YAGNI + Evidence,
Lisibilité, Convention de dossier).

Run: `grep -n "Sift-spécifique\|docs/ressources-externes.md\|master.db Rekordbox" "C:\Users\LEETJ\.claude\agent-operating-model.md" | grep -v "voir son"`
Expected: only the one line mentioning `master.db Rekordbox` as an
*example* of a sensitive-surface signal (it's illustrative, not a
Sift-only path) — no other Sift-specific file paths. If any other
Sift-only path appears, remove it; this file must stay project-agnostic.

No commit — `~/.claude/` is outside the Sift git repo.

---

### Task 2: Reference the operating model from global CLAUDE.md

**Files:**
- Modify: `C:\Users\LEETJ\.claude\CLAUDE.md`

**Interfaces:**
- Consumes: `C:\Users\LEETJ\.claude\agent-operating-model.md` (Task 1) must
  already exist at this exact path.
- Produces: `~/.claude/CLAUDE.md` ends with an `@agent-operating-model.md`
  reference line, loaded on every session across every project (same
  mechanism as the existing `@RTK.md` line).

- [ ] **Step 1: Read the current file to confirm the exact ending**

Read `C:\Users\LEETJ\.claude\CLAUDE.md`. Confirm the file's last non-empty
line is exactly `@RTK.md`. If it is not (the file changed since this plan
was written), find the `@RTK.md` line wherever it is instead.

- [ ] **Step 2: Add the reference line**

Using the Edit tool, replace:

```
@RTK.md
```

with:

```
@RTK.md
@agent-operating-model.md
```

(This must be an exact, minimal edit — do not touch any other line in the
file.)

- [ ] **Step 3: Verify**

Run: `grep -n "@agent-operating-model.md" "C:\Users\LEETJ\.claude\CLAUDE.md"`
Expected: one match, on the line immediately after `@RTK.md`.

No commit — `~/.claude/` is outside the Sift git repo.

---

### Task 3: Add the archive step to the global `wrap-up` skill

**Files:**
- Modify: `C:\Users\LEETJ\.claude\skills\wrap-up\SKILL.md`

**Interfaces:**
- Consumes: the folder convention from Task 1, section 4
  (`docs/superpowers/changes/<slug>/` and `changes/archive/<slug>/`).
- Produces: `wrap-up` Phase 1 gains a new step 10 ("Archivage de chantier")
  that runs on every project using `wrap-up`, not just Sift — must stay
  generic (no Sift-only paths).

- [ ] **Step 1: Read the current file to confirm the exact anchor**

Read `C:\Users\LEETJ\.claude\skills\wrap-up\SKILL.md`. Confirm Phase 1 ends
with:

```
**Tâches :**
9. Passe en revue la liste de tâches : marque les faites, signale les
   orphelines ou périmées.

---

## Phase 2 : Remember It
```

If the numbering or exact text has drifted since this plan was written,
locate the equivalent anchor (end of Phase 1, just before the `## Phase 2`
heading) instead.

- [ ] **Step 2: Insert the archive step**

Using the Edit tool, replace:

```
**Tâches :**
9. Passe en revue la liste de tâches : marque les faites, signale les
   orphelines ou périmées.

---

## Phase 2 : Remember It
```

with:

```
**Tâches :**
9. Passe en revue la liste de tâches : marque les faites, signale les
   orphelines ou périmées.

**Archivage de chantier (règle ajoutée 2026-07-08, tous repos) :**
10. Si le repo suit la convention `docs/superpowers/changes/<slug>/`
    (voir `~/.claude/agent-operating-model.md`, section 4) et qu'un
    chantier de ce type a été livré/mergé pendant la session, propose de
    déplacer `docs/superpowers/changes/<slug>/` vers
    `docs/superpowers/changes/archive/<slug>/`. Applique après accord (pas
    automatique — un chantier "livré" peut encore avoir un suivi ouvert).
    Si le repo n'utilise pas cette convention (ancien flat
    `specs/`/`plans/`/`reviews/`, ou pas encore migré), ignore cette étape.

---

## Phase 2 : Remember It
```

- [ ] **Step 3: Verify**

Run: `grep -n "Archivage de chantier" "C:\Users\LEETJ\.claude\skills\wrap-up\SKILL.md"`
Expected: one match.

Run: `grep -c "^9\.\|^10\." "C:\Users\LEETJ\.claude\skills\wrap-up\SKILL.md"`
Expected: `2` (step 9 and the new step 10 both present, nothing duplicated).

No commit — `~/.claude/` is outside the Sift git repo.

---

### Task 4: Wire Sift's own docs into the operating model

**Files:**
- Modify: `C:\Users\LEETJ\Desktop\dj-assistant-m6a\CLAUDE.md`
- Modify: `C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\skills-registre.md`
- Modify: `C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\superpowers\specs\2026-07-06-agent-token-budget-operating-model-design.md`

**Interfaces:**
- Consumes: `~/.claude/agent-operating-model.md` (Task 1) — Sift's pointer
  references this exact path.
- Produces: Sift's `CLAUDE.md` has a short "Sizing / YAGNI+evidence /
  lisibilité" paragraph; `docs/skills-registre.md` has a new
  `## Packs de contexte (sizing)` section (the content migrated out of the
  2026-07-06 spec); the 2026-07-06 spec's status line is updated so it no
  longer reads as orphaned.

- [ ] **Step 1: Add the pointer paragraph to Sift's `CLAUDE.md`**

Read `C:\Users\LEETJ\Desktop\dj-assistant-m6a\CLAUDE.md`. Find this exact
paragraph (in the `## Méthode` section):

```
**Routage skills** : procédure complète (5 étapes) déjà posée dans
`~/.claude/CLAUDE.md` (RÈGLE IMPÉRATIVE, s'applique tous projets) — ne pas la
redupliquer ici. Spécifique à Sift : consulter `docs/skills-registre.md` (pas
un registre générique) pour le verdict par domaine.
```

Using the Edit tool, replace it with:

```
**Routage skills** : procédure complète (5 étapes) déjà posée dans
`~/.claude/CLAUDE.md` (RÈGLE IMPÉRATIVE, s'applique tous projets) — ne pas la
redupliquer ici. Spécifique à Sift : consulter `docs/skills-registre.md` (pas
un registre générique) pour le verdict par domaine.

**Sizing / YAGNI+evidence / lisibilité** : mécaniques génériques posées dans
`~/.claude/agent-operating-model.md` (s'applique tous projets, voir
`docs/superpowers/specs/2026-07-08-agent-operating-model-design.md` pour le
détail de la décision) — classifier mini/normal/large avant tout fan-out
d'agents, gate de preuve avant d'inclure un item dans un artefact, checklist
lisibilité avant de livrer un `design.md`/`plan.md`. Sur Sift : veille/
décision = `docs/ressources-externes.md` (section "Écarté" = tranché ;
nouvelle section "Différé" = pas assez de preuve pour l'instant, avec
trigger de réouverture nommé — ne pas confondre les deux) ; packs de
contexte = `docs/skills-registre.md`, section "Packs de contexte (sizing)".
Nouveaux chantiers → `docs/superpowers/changes/<date>-<slug>/`
(`design.md`/`plan.md`/`review.md` dans un seul dossier) au lieu de
`specs/`+`plans/`+`reviews/` à plat — fichiers existants non migrés.
```

- [ ] **Step 2: Migrate the context packs into `docs/skills-registre.md`**

Read `C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\skills-registre.md`. Find
this exact anchor (right before the "## Méthode / développement" section):

```
Si un agent revient avec un rapport qui décrit un travail "lancé" plutôt que
"fait" (verbes au futur/en cours, pas de sortie de commande citée), le
relancer immédiatement via SendMessage avec ces 4 clauses rappelées — ne pas
attendre une notification qui ne viendra pas.

---

## Méthode / développement (à utiliser sur Sift)
```

Using the Edit tool, replace it with:

```
Si un agent revient avec un rapport qui décrit un travail "lancé" plutôt que
"fait" (verbes au futur/en cours, pas de sortie de commande citée), le
relancer immédiatement via SendMessage avec ces 4 clauses rappelées — ne pas
attendre une notification qui ne viendra pas.

---

## Packs de contexte (sizing, ajouté 2026-07-08)

Instanciation Sift du "sizing" décrit dans `~/.claude/agent-operating-model.md`.
Ces packs sont des menus, pas des blocs à coller intégralement — l'orchestrateur
choisit les 3-8 fichiers utiles et cite les sections à lire. Migré depuis
`docs/superpowers/specs/2026-07-06-agent-token-budget-operating-model-design.md`
(le spec sizing d'origine, resté orphelin — désormais activé via ce fichier).

### Pack UI live

- `CLAUDE.md` : sections Vision, Front — événements répétés, Front — CSS,
  Vérification UI.
- `docs/design-system-states.md` : composants concernés seulement.
- `frontend/styles.css`.
- Fichiers frontend touchés (`report-view.ts`, `filing.ts`,
  `batch-tracklist.ts`, etc.).
- Commande de vérification par défaut : `npx tsc --noEmit`.

### Pack Rust backend

- `CLAUDE.md` : sections Stack, Commandes, Documentation lookups, Méthode.
- `docs/skills-registre.md` : lignes Rust/backend (section ci-dessus).
- Fichiers `src-tauri/src/*.rs` concernés seulement.
- `src-tauri/Cargo.toml` si dépendances/features.
- Commandes : `cargo test --manifest-path src-tauri/Cargo.toml` et/ou
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

### Pack Rekordbox / master.db

- `CLAUDE.md` : garde-fou "Jamais une écriture sur un système live".
- `docs/ressources-externes.md` : évaluations Rekordbox pertinentes.
- Specs/plans M8 actifs uniquement.
- Fichiers Rust/TS concernés.
- Toute vérification dans le vrai Rekordbox reste manuelle par Antoine.

### Pack docs / planning

- `docs/INDEX.json`.
- Spec/plan cible.
- `docs/skills-registre.md` si routage skills.
- Pas de lecture large de `frontend/` ou `src-tauri/` sauf question précise.

### Pack review adverse

- La spec approuvée.
- Le diff (`git diff -- <fichiers>`).
- Les fichiers modifiés uniquement.
- Les règles `CLAUDE.md` strictement pertinentes.
- Sortie : findings file:line, sévérité, test manquant, pas de résumé long.

---

## Méthode / développement (à utiliser sur Sift)
```

- [ ] **Step 3: Update the orphaned spec's status line**

Read `C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\superpowers\specs\2026-07-06-agent-token-budget-operating-model-design.md`.
Find this exact line near the top:

```
Statut : approuve (brainstorming), pret pour writing-plans
```

Using the Edit tool, replace it with:

```
Statut : activé le 2026-07-08 — paliers + templates de prompts migrés vers
`~/.claude/agent-operating-model.md` (global), packs de contexte migrés
vers `docs/skills-registre.md` (Sift). Ce fichier reste la trace de
décision d'origine, plus la source vive.
```

- [ ] **Step 4: Verify all three edits**

Run: `grep -n "agent-operating-model.md" "C:\Users\LEETJ\Desktop\dj-assistant-m6a\CLAUDE.md"`
Expected: at least 2 matches (the pointer paragraph references the file
twice — once as the mechanic source, once implicitly via the spec
reference; if only 1 match appears, that's fine too, just confirm at least
1).

Run: `grep -n "## Packs de contexte (sizing" "C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\skills-registre.md"`
Expected: one match.

Run: `grep -n "activé le 2026-07-08" "C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\superpowers\specs\2026-07-06-agent-token-budget-operating-model-design.md"`
Expected: one match.

- [ ] **Step 5: Update `docs/INDEX.json`**

Read `C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\INDEX.json`. In the
`"plans"` array, find the entry for
`docs/superpowers/plans/2026-07-06-m8-tier1-ipc-wiring.md` (or any
existing entry) to copy the exact JSON formatting style, then add a new
entry to the `"plans"` array (comma-separated, matching the existing
`{"path": ..., "date": ..., "topic": ..., "summary": ...}` shape) for this
very plan:

```json
{"path": "docs/superpowers/plans/2026-07-08-agent-operating-model.md", "date": "2026-07-08", "topic": "agent operating model cross-projet (sizing/YAGNI/lisibilité)", "summary": "Active le spec sizing orphelin, formalise YAGNI+evidence et une checklist de lisibilité, introduit la convention docs/superpowers/changes/<slug>/ pour les nouveaux chantiers — écrit dans ~/.claude/agent-operating-model.md pour s'appliquer à tous les projets, pas seulement Sift."}
```

Also add a matching entry to the `"specs"` array for the design doc already
committed in this session:

```json
{"path": "docs/superpowers/specs/2026-07-08-agent-operating-model-design.md", "date": "2026-07-08", "topic": "agent operating model cross-projet", "summary": "Évalue testdouble/han, compound-engineering-plugin, sandcastle, OpenSpec ; active le spec sizing orphelin du 2026-07-06, ajoute YAGNI+evidence et lisibilité, propose la convention docs/superpowers/changes/. Portée globale, pas Sift-only."}
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/skills-registre.md docs/superpowers/specs/2026-07-06-agent-token-budget-operating-model-design.md docs/superpowers/plans/2026-07-08-agent-operating-model.md docs/INDEX.json
git commit -m "docs: wire Sift into the cross-project agent operating model

Activates the orphaned 2026-07-06 sizing spec (packs of context moved to
skills-registre.md), points CLAUDE.md at ~/.claude/agent-operating-model.md,
and catalogs the new plan/spec in INDEX.json."
```

---

### Task 5: End-to-end verification

**Files:**
- None created or modified — verification only.

**Interfaces:**
- Consumes: the output of Tasks 1–4 (all five files touched or created).
- Produces: a pass/fail confirmation that the whole chain is wired
  correctly; no new artifacts.

- [ ] **Step 1: Confirm the global doc is referenced and self-consistent**

Run: `grep -n "@agent-operating-model.md" "C:\Users\LEETJ\.claude\CLAUDE.md"`
Expected: 1 match.

Run: `grep -c "^## " "C:\Users\LEETJ\.claude\agent-operating-model.md"`
Expected: `4`.

- [ ] **Step 2: Confirm `wrap-up` picks up the archive step without breaking phase order**

Run: `grep -n "^## Phase" "C:\Users\LEETJ\.claude\skills\wrap-up\SKILL.md"`
Expected: exactly 3 matches, in order — `## Phase 1 : Ship It`,
`## Phase 2 : Remember It`, `## Phase 3 : Review & Apply` — confirming the
inserted step 10 did not disturb the phase boundaries.

- [ ] **Step 3: Confirm Sift's chain is complete**

Run: `grep -n "changes/<date>-<slug>" "C:\Users\LEETJ\Desktop\dj-assistant-m6a\CLAUDE.md"`
Expected: 1 match.

Run: `grep -c "^### Pack " "C:\Users\LEETJ\Desktop\dj-assistant-m6a\docs\skills-registre.md"`
Expected: `5` (the five packs migrated in Task 4).

Run: `git -C "C:\Users\LEETJ\Desktop\dj-assistant-m6a" log --oneline -3`
Expected: the Task 4 commit appears at the top, and the earlier
`docs(spec): design agent operating model...` commit (`1302a44`) is still
present below it.

- [ ] **Step 4: Report**

Summarize in the final message: which files were created/modified globally
(outside git, Tasks 1–3) vs. inside the Sift repo (Task 4, committed), and
that Tuple/Tupline pointers remain explicitly deferred (per this plan's own
Global Constraints) until a future session opens work on either repo.

No commit for this task (verification only).
