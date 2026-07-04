# Design — Éditeur de tokens : mode sombre permanent + 2 fixes UX (2026-07-04)

> Suite de l'implémentation token-sync tool v2 (8 tâches, terminée le
> 2026-07-04) et de l'audit UX/UI qui a suivi. Portée : uniquement
> `design_handoff_sift_refonte/token-sync/editor.html` (outil de dev interne,
> pas l'app Sift elle-même).

## 1. Mode sombre permanent (remplacement, pas un toggle)

**Décision actée avec Antoine** : pas de bascule clair/sombre, pas de
détection `prefers-color-scheme` — l'outil devient sombre en permanence, le
CSS clair actuel est **remplacé**, pas conservé en réserve.

**Base de la palette** : snapshot des valeurs sombres réelles de Sift
(`design-tokens.dark.json` / `design-tokens.light.json` via `sync-core.cjs`,
lu au moment de la conception — pas généré dynamiquement à chaque requête).
Un snapshot figé, pas un couplage live : si les tokens sombres de Sift
changent plus tard, cette palette peut dériver et nécessiter une resynchro
manuelle — accepté comme compromis YAGNI (outil interne solo, même logique
que l'abandon du polling cron pour la sync de tokens).

**Scope explicite** : uniquement le chrome de l'outil (page, header, sidebar,
panneaux, bordures, boutons, texte d'aide). **Exclu** : les color pickers,
swatches et champs texte hex à l'intérieur de `makeModeSlot()` — ils
affichent la vraie valeur claire/sombre du token en cours d'édition, pas le
thème de l'outil. Les recolorer serait mentir sur ce qu'ils montrent.

**Mapping (vérifié par calcul de contraste WCAG, pas supposé)** :

| Rôle chrome | Token Sift (dark) | Valeur |
|---|---|---|
| Fond page | `--color-background-primary` | `#282825` |
| Fond panneaux (header/form-col) | `--color-background-secondary` | `#3B3A35` |
| Fond sidebar | `--color-background-tertiary` | `#323230` |
| Texte principal | `--color-text-primary` | `#F5F1E9` |
| Texte muté (hints, labels, counts, noms de variable) | `--color-text-secondary` | `#C9C2B7` |
| Bordures | `--color-border-tertiary` / `--color-border-secondary` | `rgba(255,255,255,0.12)` / `rgba(255,255,255,0.22)` (littéral, pas de conversion hex) |
| Survol ligne/sidebar | `--overlay-hover` / `--color-row-active` | `rgba(255,255,255,.03)` / `#413F38` |
| Sidebar actif (`.sidebar-group.on`) | déjà proche de `--color-nav-active`/`--color-text-info` | gardé tel quel (`#3A352F`/`#F7F4EF`, 11.06:1) |

**Correction faite pendant la conception** : `--color-text-tertiary`
(`#9C968D`) était le candidat initial pour le texte muté, mais échoue AA sur
les deux fonds réels où il serait utilisé — `3.89:1` sur fond secondaire,
`4.38:1` sur fond sidebar (seuil AA texte normal = 4.5:1). **Décision : tout
le texte muté actuellement en `#6b6459` (light) passe à `--color-text-secondary`
à la place**, pas à `-tertiary` — vérifié `6.45:1`–`8.37:1` selon le fond,
confortable partout. `text-tertiary` n'est utilisé nulle part dans ce
mapping (aucun besoin réel identifié dans le fichier actuel).

**Ratios vérifiés (calcul WCAG relative luminance, pas estimation)** :
texte principal/fond page `13.12:1` · texte principal/fond secondaire
`10.12:1` · texte principal/sidebar `11.40:1` · texte secondaire/fond page
`8.37:1` · texte secondaire/fond secondaire `6.45:1` · texte secondaire/sidebar
`7.27:1` · sidebar actif `11.06:1`. Tous ≥ AAA (7:1) sauf texte
secondaire/fond secondaire à `6.45:1` qui reste solidement AA (4.5:1).

## 2. Fix UX 1 — hint de groupe réapparaît

Avant Task 7 (sidebar+recherche), chaque groupe de couleurs affichait un
sous-titre d'une ligne (`.group-hint`, ex. "Fonds — *surfaces de l'app*").
Task 7 a porté la donnée (`ALL_GROUPS[i].hint`) mais ne l'affiche plus nulle
part — perte de contexte réelle, dont un hint documente une règle de design
("Bouton Identifier" → "seule 3e teinte autorisée").

**Fix** : afficher `group.hint` sous le titre dans `renderGroupPanel()`,
réutilisant la classe CSS `.group-hint` déjà présente (orpheline
actuellement) — recolorée en `--color-text-secondary` par le fix #1.

## 3. Fix UX 2 — highlight sidebar figé pendant la recherche

Le listener de `#sidebar-search` appelle `renderSearchResults(q)` mais
jamais `renderSidebar()` — le `.on` reste visuellement figé sur le groupe
actif d'avant la recherche, alors que les résultats couvrent les 12 groupes.
Testé en direct : recherche "zzzznotfound" avec "Fonds" actif → "Fonds"
reste surligné pendant toute la recherche.

**Fix** : pendant une recherche active, retirer la classe `.on` de tous les
boutons sidebar (aucun groupe n'est "actif" au sens propre pendant une vue
transversale) — appel à `renderSidebar()` avec un état "aucun actif" au
moment où la query devient non-vide, restauration de l'état actif normal
quand la query est vidée (comportement déjà correct aujourd'hui).

## Non-goals

- Pas de toggle, pas de persistance, pas de détection OS.
- Pas de génération dynamique de la palette depuis le JSON à chaque requête.
- Pas de retouche des CSS/pickers qui affichent les valeurs réelles des tokens.
