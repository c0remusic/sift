# Design — Réorganisation de docs/audit/ + index JSON

Date : 2026-07-04
Statut : approuvé (brainstorming), prêt pour writing-plans

## Problème

`docs/` et `audit/` accumulent des rapports datés sans structure cohérente :
- `docs/superpowers/{specs,plans,reviews}/` est déjà bien rangé (convention
  `YYYY-MM-DD-topic.md`, ~40 fichiers) — **ne pas toucher**.
- 11 fichiers trainent en vrac directement sous `docs/` (briefs, plans,
  handoffs, audits datés) mélangés avec les 3-4 vrais documents de référence
  vivants (`ressources-externes.md`, `design-system-states.md`,
  `skills-registre.md`, `plan-implementation.md`).
- Le dossier `audit/` (7 fichiers) fait doublon de rôle avec
  `docs/superpowers/reviews/` : ce sont des audits/revues UI/UX/produit datés,
  pas une catégorie à part.
- Il n'existe aucun moyen pour Claude de savoir "quel fichier parle de quoi"
  sans lister/grep `docs/` à chaque session.

## Décisions (validées avec Antoine)

1. **`docs/` racine** garde uniquement les documents vivants, activement
   référencés (par `@import` ou par chemin) dans `CLAUDE.md` ou en évolution
   continue : `ressources-externes.md`, `design-system-states.md`,
   `skills-registre.md`, `plan-implementation.md` (actif, modifié en cours),
   `brand-logo-direction.md` (référence de décision, pas daté one-off),
   `chat-project-instructions.md` (méta-projet, miroir CLAUDE.md pour Claude
   Chat).
2. Tout le reste (briefs, plans, handoffs, audits datés) part sous
   `docs/superpowers/{specs,plans,reviews}/`, convention
   `YYYY-MM-DD-topic.md` déjà en place — pas de nouvelle convention inventée.
3. **`audit/` fusionne dans `docs/superpowers/reviews/`** (même rôle : revue
   datée), renommé à la convention. Dossier `audit/` supprimé une fois vide.
4. **`docs/plans/`** (1 seul fichier, `2026-06-12-m0-scaffolding.md`) migre
   dans `docs/superpowers/plans/` pour éliminer le dossier parallèle
   redondant.
5. **Index JSON** : `docs/INDEX.json`, recense chaque document sous `docs/`
   (racine + `superpowers/*`) avec `{path, type, topic, summary, date}`.
   - `type` ∈ `reference | spec | plan | review`.
   - Pas d'outil de génération automatique (cohérent avec les évaluations
     précédentes sur les outils de sync, voir Évaluation 6 de
     `ressources-externes.md` — volume trop faible pour justifier une
     dépendance de tooling). Maintenu à la main, même discipline que
     `MEMORY.md`.
   - Chargé automatiquement via `@docs/INDEX.json` dans `CLAUDE.md`.
   - **Ne duplique pas** les listings `frontend/`/`src-tauri/src/` déjà en
     prose dans `CLAUDE.md` — scope strictement limité à `docs/`.

## Mapping des déplacements

| Source | Destination | Type |
|---|---|---|
| `audit/AUDIT-SIFT-PROMPT.md` | `docs/superpowers/reviews/2026-06-30-audit-sift-prompt.md` | review |
| `audit/RAPPORT-direction.md` | `docs/superpowers/reviews/2026-06-25-rapport-direction-verdict.md` | review |
| `audit/PLAN-SIFT.md` | `docs/superpowers/plans/2026-06-28-plan-sift-implementation.md` | plan |
| `audit/DESIGN-REVIEW-2026-07-01.md` | `docs/superpowers/reviews/2026-07-01-design-review-revue-reskin.md` | review |
| `docs/brief-refonte-ui-2026-07-01.md` | `docs/superpowers/specs/2026-07-01-brief-refonte-ui.md` | spec |
| `docs/session-handoff-2026-06-30.md` | `docs/superpowers/reviews/2026-06-30-session-handoff.md` | review |
| `docs/audit-fidelite-2026-07-02.md` | `docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md` | review |
| `docs/refonte-ui-plan.md` | `docs/superpowers/plans/2026-07-02-refonte-ui-plan.md` | plan |
| `audit/RAPPORT-FINAL.md` | `docs/superpowers/reviews/2026-07-02-rapport-final-audit-sift.md` | review |
| `audit/PLAN-FIX-2026-07-02.md` | `docs/superpowers/plans/2026-07-02-plan-fix-post-audit.md` | plan |
| `audit/HANDOFF-FIX1-2026-07-02.md` | `docs/superpowers/reviews/2026-07-02-handoff-fix1-anti-upscale.md` | review |
| `docs/audit-conformite-m6b-2026-07-03.md` | `docs/superpowers/reviews/2026-07-03-audit-conformite-m6b-lot5.md` | review |
| `docs/handoff-verdict-card-titlebar.md` | `docs/superpowers/reviews/2026-07-03-handoff-verdict-card-titlebar.md` | review |
| `audit/REVUE-UI-UX-2026-07-03.md` | `docs/superpowers/reviews/2026-07-03-revue-ui-ux-parcours.md` | review |
| `docs/plans/2026-06-12-m0-scaffolding.md` | `docs/superpowers/plans/2026-06-12-m0-scaffolding.md` | plan |

Restent à `docs/` racine (inchangés) : `ressources-externes.md`,
`design-system-states.md`, `skills-registre.md`, `plan-implementation.md`,
`brand-logo-direction.md`, `chat-project-instructions.md`, `INDEX.json`
(nouveau).

Dossiers supprimés une fois vides : `audit/`, `docs/plans/`.

## Impact sur les références existantes

- `CLAUDE.md` référence déjà `docs/ressources-externes.md` (`@import`) et
  `docs/design-system-states.md` (`@import`) — chemins inchangés, aucune
  modif nécessaire sur ces deux lignes.
- `CLAUDE.md` mentionne `docs/skills-registre.md` en texte (pas `@import`) —
  chemin inchangé.
- Ajouter une ligne `@docs/INDEX.json` dans la section Documentation de
  `CLAUDE.md`.
- Rechercher (`grep -rn`) toute référence croisée aux anciens chemins
  (`audit/`, `docs/plans/`, les 11 fichiers déplacés) dans le reste du repo
  (autres docs, code, `docs/skills-registre.md`) et les mettre à jour.

## Schéma `docs/INDEX.json`

```json
{
  "reference": [
    {"path": "docs/ressources-externes.md", "topic": "veille technique / décisions libs", "summary": "..."},
    ...
  ],
  "specs": [
    {"path": "docs/superpowers/specs/2026-07-01-brief-refonte-ui.md", "date": "2026-07-01", "topic": "...", "summary": "..."},
    ...
  ],
  "plans": [...],
  "reviews": [...]
}
```

Un objet par catégorie plutôt qu'une liste plate avec champ `type` répété —
plus lisible à parcourir manuellement, et le regroupement matche l'arborescence
réelle (`specs/`, `plans/`, `reviews/`, racine).

## Maintenance future

Quand un nouveau document est créé sous `docs/` (via brainstorming/
writing-plans/code-review ou manuellement), l'entrée correspondante est
ajoutée à `docs/INDEX.json` dans le même geste — pas une passe de rattrapage
différée. Documenté dans une note `CLAUDE.md` à côté de l'`@import`.

## Hors scope

- Pas de script de génération/validation de l'index (sur-ingénierie pour
  ~40 fichiers qui bougent de quelques unités par semaine).
- Pas de réorganisation de `docs/superpowers/{specs,plans,reviews}/`
  eux-mêmes — déjà cohérents.
- Pas de changement de contenu des documents déplacés, seulement de chemin
  (sauf mise à jour des références croisées cassées par le déplacement).
