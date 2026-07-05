# Refonte écran Revue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réorganiser l'écran Revue de Sift (`#mid`) en zones — Écoute / Diagnostic repliable /
Métadonnées repliable / Verdict conclusion — avec un badge de statut visible même repliée, un
CTA Discogs contextuel, et une sélection de candidat non-permanente.

**Architecture:** Aucun changement de composition de conteneurs (`.sift-fil-report` /
`.sift-fil-editor` / `.sift-fil-verdict`, `filing.ts::openFilingInto`) ni de contrat IPC — le
travail est structurel/visuel à l'intérieur de `report-view.ts` (Diagnostic) et `filing.ts`
(Métadonnées), plus des ajouts CSS partagés dans `styles.css`.

**Tech Stack:** Vanilla TypeScript (pas de framework), CSS custom properties (`styles.css`),
Vite/HMR (`tauri dev`).

## Global Constraints

- Aucun fichier Rust touché. Aucune commande IPC ajoutée/renommée.
- Tokens couleur/espacement/rayon existants uniquement — pas de nouvelle valeur littérale
  ajoutée sans passer par une variable `--color-*`/`--space-*`/`--border-radius-*` déjà déclarée
  dans `frontend/styles.css:11-56` (`:root`).
- Le rail (`#filfoot`, `filing.ts::renderFoot`) n'est PAS touché par ce plan — c'est un
  non-objectif explicite du spec (`docs/superpowers/specs/2026-07-05-revue-screen-redesign-design.md`).
- `npx tsc --noEmit` doit rester clean après chaque tâche.
- Vérification visuelle finale dans la vraie fenêtre `tauri dev` (jamais le serveur Vite nu —
  `report-view.ts`/`filing.ts` sont gated `inTauri`, voir CLAUDE.md section "Vérification UI").

---

## Task 1: Décision pencil-toggle + wrapper repliable Métadonnées

**Files:**
- Modify: `frontend/filing.ts:1033-1146` (`renderEditor`)
- Modify: `frontend/styles.css` (nouvelle classe partagée `.sift-zone-toggle`, voir Task 2 —
  cette tâche l'utilise mais ne la définit pas encore ; si exécutée avant Task 2, ajouter un
  stub minimal `.sift-zone-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;background:none;border:none;cursor:pointer;text-align:left}` puis le compléter en Task 2)

**Interfaces:**
- Consumes: `renderEditor(host: HTMLElement, mid: HTMLElement, rail: string, report: AnalysisReport | null)` — signature inchangée, appelé depuis `filing.ts:1137,1141,1626`.
- Produces: `renderEditor` enveloppe désormais tout son contenu existant dans un disclosure
  repliable ; un nouvel élément `#sift-meta-toggle` (bouton d'en-tête) et `#sift-meta-body`
  (conteneur du contenu actuel) apparaissent dans le DOM sous `host`. Task 3 s'appuie sur ces
  deux ids pour y ajouter le badge CDJ.

**Décision à trancher (ne pas sauter cette étape) :** le vrai `renderEditor` a aujourd'hui un
mode lecture-seule par défaut + bouton crayon (`identEditing`, `sift-ident-edit-btn`,
`filing.ts:1059-1078`) qui bascule vers un formulaire éditable. Deux options :

- **(a) Garder le pencil-toggle tel quel**, juste enveloppé dans le nouveau disclosure replié
  par défaut — changement minimal, ne remet pas en cause un comportement existant. **Ce plan
  implémente (a).**
- **(b) Aplatir en champs toujours éditables** (ce que faisait le prototype) — supprimerait
  `identEditing`, `sift-ident-edit-btn`, la branche `c.artist && c.title ? display : idle`. Pas
  fait ici : si (b) est préféré après relecture, c'est un plan séparé (touche la state machine
  d'édition, pas juste l'agencement visuel).

Si tu choisis (b) au lieu de (a), STOP — ce plan ne couvre pas ce refactor, écris un nouveau
spec/plan dédié avant de continuer sur les tâches suivantes (elles supposent (a)).

- [ ] **Step 1: Lire le rendu actuel de `renderEditor` en entier**

Ouvrir `frontend/filing.ts:1033-1146` et confirmer que le `host.innerHTML = ...` à la ligne 1056
est le seul point d'écriture du contenu de la carte (pas de mutation DOM ailleurs dans la
fonction avant la ligne 1108).

- [ ] **Step 2: Envelopper le contenu existant dans un disclosure replié par défaut**

Remplacer (ligne 1056-1058) :

```ts
  host.innerHTML =
    `<div class="sift-ident-head">` +
    `<span class="col-h sift-editor-title">Identification · Discogs</span>` +
    `<button data-fil="ident-edit" class="sift-ident-edit-btn" title="Modifier manuellement" aria-label="Modifier manuellement"><i class="ti ti-pencil"></i></button>` +
    `</div>` +
```

par :

```ts
  host.innerHTML =
    `<button class="sift-zone-toggle" id="sift-meta-toggle" aria-expanded="false">` +
    `<span><span class="sift-zone-toggle-car">▸</span>Métadonnées</span>` +
    `<span class="sift-zone-toggle-right">` +
    `<span class="sift-chip-badge" id="sift-cdj-badge" hidden></span>` +
    `<span class="sift-zone-toggle-hint">afficher</span>` +
    `</span>` +
    `</button>` +
    `<div class="sift-zone-toggle-body" id="sift-meta-body">` +
    `<div class="sift-ident-head">` +
    `<span class="col-h sift-editor-title">Identification · Discogs</span>` +
    `<button data-fil="ident-edit" class="sift-ident-edit-btn" title="Modifier manuellement" aria-label="Modifier manuellement"><i class="ti ti-pencil"></i></button>` +
    `</div>` +
```

Le libellé de la carte reste "Identification · Discogs" en interne pour l'instant (renommage
générique "Métadonnées" traité en Task 3, où le badge CDJ est ajouté au même endroit — éviter
deux passes sur la même ligne).

- [ ] **Step 3: Fermer le wrapper body avant la fin de la fonction**

Le `host.innerHTML` est une seule grande chaîne concaténée qui se termine (ligne ~1108) par :

```ts
    `<div class="sift-match-row" hidden><span class="sift-match-q">Cette identification Discogs correspond-elle bien à ce fichier ?</span>${vchipHtml("CHECK MATCH", "warning")}</div>`;
```

Ajouter la fermeture du wrapper juste avant le point-virgule :

```ts
    `<div class="sift-match-row" hidden><span class="sift-match-q">Cette identification Discogs correspond-elle bien à ce fichier ?</span>${vchipHtml("CHECK MATCH", "warning")}</div>` +
    `</div>`; // ferme #sift-meta-body ouvert au début de host.innerHTML
```

- [ ] **Step 4: Câbler le toggle (replié par défaut) juste après `host.innerHTML = ...`**

Immédiatement après le bloc `host.innerHTML = ...` (avant la ligne `const upd = () => {`, actuelle
ligne ~1110), ajouter :

```ts
  const metaToggle = host.querySelector<HTMLButtonElement>("#sift-meta-toggle");
  const metaBody = host.querySelector<HTMLElement>("#sift-meta-body");
  const metaHint = host.querySelector<HTMLElement>(".sift-zone-toggle-hint");
  metaToggle?.addEventListener("click", () => {
    const open = metaBody?.classList.toggle("sift-zone-toggle-body-open") ?? false;
    metaToggle.classList.toggle("sift-zone-toggle-open", open);
    metaToggle.setAttribute("aria-expanded", String(open));
    if (metaHint) metaHint.textContent = open ? "masquer" : "afficher";
  });
```

Ne PAS ajouter la classe `sift-zone-toggle-body-open`/`sift-zone-toggle-open` par défaut dans le
markup du Step 2 — repliée par défaut est l'état initial voulu (spec, section "Style commun").

- [ ] **Step 5: Vérifier `npx tsc --noEmit`**

Run: `cd frontend && npx tsc --noEmit` (ou `npx tsc --noEmit` depuis la racine si le tsconfig
couvre `frontend/`, vérifier `tsconfig.json` à la racine du repo)
Expected: aucune erreur.

- [ ] **Step 6: Vérifier dans `tauri dev`**

Lancer `npm run tauri dev`, ouvrir un morceau en Revue. Confirmer : la carte
"Identification · Discogs" apparaît repliée (juste le bouton d'en-tête + hint "afficher"), un
clic la déplie et montre le contenu inchangé (CTA Discogs, champs, genres, ID3, bouton
Appliquer, bandeau).

- [ ] **Step 7: Commit**

```bash
git add frontend/filing.ts
git commit -m "feat(revue): wrap Identification card in a collapsible disclosure, collapsed by default"
```

---

## Task 2: CSS partagée — toggle de zone, badge de chip, highlight discret, flash candidat, CTA contextuel

**Files:**
- Modify: `frontend/styles.css`

**Interfaces:**
- Consumes: rien (CSS pure) — mais les noms de classes ci-dessous DOIVENT correspondre
  exactement à ceux utilisés en Task 1, 3, 4 (`.sift-zone-toggle`, `.sift-zone-toggle-right`,
  `.sift-zone-toggle-car`, `.sift-zone-toggle-hint`, `.sift-zone-toggle-body`,
  `.sift-zone-toggle-body-open`, `.sift-zone-toggle-open`, `.sift-chip-badge`,
  `.sift-highlight-flash`, `.sift-identified-flash`, `.sift-id-btn-neutral`).
- Produces: ces classes, consommées par Task 1 (déjà écrit ci-dessus), Task 3, Task 4.

- [ ] **Step 1: Ajouter le style de toggle de zone partagé**

Ajouter dans `frontend/styles.css`, à la suite du bloc `.sift-spectro-toggle` (après la ligne
`432` actuelle, `.sift-spectro-declared{...}`) :

```css
/* Toggle de zone partagé (Diagnostic ET Métadonnées) — un seul style pour les deux disclosures,
   pour qu'elles lisent comme le même composant (retour utilisateur 2026-07-05 : elles avaient
   deux styles différents et une seule des deux zones avait un fond teinté). */
.sift-zone-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;
  background:none;border:none;cursor:pointer;text-align:left;padding:2px 0 10px;
  font-size:var(--text-sm);color:var(--color-text-secondary);font-family:inherit}
.sift-zone-toggle-car{display:inline-block;margin-right:6px;color:var(--color-text-tertiary);
  transition:transform .15s ease}
.sift-zone-toggle-open .sift-zone-toggle-car{transform:rotate(90deg)}
.sift-zone-toggle-right{display:flex;align-items:center;gap:8px}
.sift-zone-toggle-hint{font-size:var(--text-xs);color:var(--color-text-tertiary)}
.sift-zone-toggle-body{display:none}
.sift-zone-toggle-body.sift-zone-toggle-body-open{display:block}
```

- [ ] **Step 2: Ajouter le style de badge d'en-tête (chip générique dans un toggle)**

À la suite du bloc précédent :

```css
/* Badge d'en-tête (ex. "MP3 ≈ X kbps", "CDJ incompatible") — visible replié, cohérent avec
   .sift-vchip existant mais sans dépendre de sa mise en page en ligne de "Preuves". */
.sift-chip-badge{font-size:var(--text-2xs);font-weight:600;padding:4px 9px;
  border-radius:var(--border-radius-pill);border:none;font-family:inherit}
```

- [ ] **Step 3: Ajouter l'animation de mise en évidence discrète**

À la suite :

```css
/* Halo discret (pas de changement de couleur de fond — trop voyant sur un bouton entier) pour
   attirer l'œil vers un fix ailleurs dans la même zone (ex. bouton Appliquer les tags). Classe
   retirée par JS après `animationend` (voir filing.ts) pour ne rien laisser traîner. */
.sift-highlight-flash{animation:sift-highlight .6s ease-out forwards}
@keyframes sift-highlight{
  0%{box-shadow:0 0 0 2px var(--overlay-selected)}
  100%{box-shadow:0 0 0 0 transparent}
}
```

- [ ] **Step 4: Ajouter le flash de confirmation sur la ligne "Identifié"**

**Ne PAS** créer de classe "candidat sélectionné" (`.sift-cand-on`) : le vrai code remplace toute
la liste de candidats par une ligne de confirmation unique dès qu'un choix est appliqué
(`identifiedLineHtml`, câblée en Task 4 Step 5) — il n'y a pas de ligne de liste qui survit pour
porter un état "sélectionné".

D'abord, vérifier le fond réel de repos de `.sift-identified-line` pour ne pas écrire une valeur
finale d'animation inventée :
Run: `grep -n "sift-identified-line" frontend/styles.css`
Noter la valeur `background` trouvée (probablement absente/transparente, ou héritée de
`.sift-fil-editor.sift-fil-editor-margin` — `styles.css:556`, `--color-background-secondary`).
Utiliser cette valeur exacte comme état final ci-dessous (remplacer `transparent` si la vraie
valeur diffère) :

```css
/* Flash de confirmation sur .sift-identified-line au moment où un choix Discogs vient d'être
   appliqué (onIdentityApplied, Task 4 Step 5) — jamais sur une réouverture
   (restoreIdentifiedLine). Le vert n'apparaît qu'un instant, pas un état permanent (retour
   utilisateur : un aplat vert en continu est trop appuyé une fois le travail fait). */
.sift-identified-flash{animation:sift-identified-flash .7s ease}
@keyframes sift-identified-flash{
  0%{background:var(--color-surface-raised)}
  30%{background:var(--color-text-success)}
  100%{background:transparent}
}
```

- [ ] **Step 5: Ajouter la variante neutre du CTA Discogs**

À la suite du bloc `.sift-id-btn`/`.sift-id-btn:hover` existant (`styles.css:254-255`) :

```css
/* CTA Discogs contextuel : gold plein (.sift-id-btn, existant) réservé à "rien identifié pour
   l'instant" ; neutre ici une fois une identité déjà appliquée — re-rechercher est une action
   secondaire de correction, pas le focus de l'écran (retour utilisateur 2026-07-05). */
.sift-id-btn-neutral{background:var(--color-surface-raised);border-color:var(--color-border-tertiary);
  color:var(--color-text-secondary);font-weight:500}
.sift-id-btn-neutral:hover{background:var(--color-row-active)}
```

- [ ] **Step 6: Vérifier `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: aucune erreur (fichier CSS pur, ce check confirme juste qu'aucun autre fichier n'a été
cassé par erreur d'édition).

- [ ] **Step 7: Commit**

```bash
git add frontend/styles.css
git commit -m "style(revue): shared zone-toggle, badge, discreet highlight, candidate flash, neutral CTA tokens"
```

---

## Task 3: Diagnostic (`report-view.ts`) — badge qualité dans l'en-tête, retrait du chip CDJ

**Files:**
- Modify: `frontend/report-view.ts:283-340` (`evidenceChipsHtml`, `spectroAndTagsHtml`)
- Modify: `frontend/report-view.ts:661-699` (`wireSpectrogram`)

**Interfaces:**
- Consumes: `.sift-zone-toggle`/`.sift-chip-badge` (Task 2), `AnalysisReport.tags_cdj_ok` déjà
  présent (`shared/contracts.ts:100`) — plus utilisé dans ce fichier après cette tâche (voir
  Task 4, où il est utilisé pour le badge CDJ de Métadonnées à la place).
- Produces: `spectroAndTagsHtml(r: AnalysisReport): string` — signature inchangée, mais son
  markup change (le chip CDJ n'y apparaît plus).

- [ ] **Step 1: Retirer le chip CDJ de `evidenceChipsHtml`**

Remplacer (`report-view.ts:287-303`) :

```ts
function evidenceChipsHtml(r: AnalysisReport): string {
  const rq = realQuality(r);
  const qualityChip =
    r.verdict === "ok" && r.declared_rail === "lossless"
      ? vchipHtml("LOSSLESS", "success")
      : vchipHtml(rq.label, r.verdict === "fake" ? "danger" : r.verdict === "grey" ? "warning" : "neutral");
  // FIX-4: name CDJ explicitly right under the verdict — no audited competitor targets CDJ
  // compatibility, it's the differentiator, and it used to be a generic yes/no row buried under
  // Genres in the Identification card (filing.ts) with no mention of "CDJ" nearby.
  const cdjChip = vchipHtml(r.tags_cdj_ok ? "CDJ compatible" : "CDJ incompatible", r.tags_cdj_ok ? "success" : "warning");
  return (
    `<div class="sift-evidence">` +
    `<div class="sift-evidence-label">Preuves</div>` +
    `<div class="sift-vchips sift-vchips-row">${qualityChip}${cdjChip}</div>` +
    `</div>`
  );
}
```

par :

```ts
/** Quality label + tone, reused by both the standalone chip (below) and the new header badge —
 *  single source so the two never drift (report-view.ts's own qualityChipHtml() vs a copy). */
function qualityChipTone(r: AnalysisReport): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
  const rq = realQuality(r);
  if (r.verdict === "ok" && r.declared_rail === "lossless") return { label: "LOSSLESS", tone: "success" };
  return { label: rq.label, tone: r.verdict === "fake" ? "danger" : r.verdict === "grey" ? "warning" : "neutral" };
}
```

(`realQuality` est déjà défini plus haut dans le fichier, `report-view.ts:57-78` — inchangé.)

- [ ] **Step 2: Retirer l'appel à `evidenceChipsHtml` et déplacer le badge qualité dans l'en-tête du toggle**

Remplacer (`report-view.ts:305-317`, début de `spectroAndTagsHtml`) :

```ts
function spectroAndTagsHtml(r: AnalysisReport): string {
  const yn = (b: boolean) => (b ? "oui" : "non");
  return (
    evidenceChipsHtml(r) +
    `<div class="sift-spectro-box">` +
    `<button class="sift-sg-toggle sift-spectro-toggle">` +
    `<span class="sift-spectro-toggle-label"><span class="sift-sg-caret sift-spectro-caret">▸</span> Preuve (spectre)</span>` +
    `<span class="sift-sg-hint sift-spectro-hint">afficher</span>` +
    `</button>` +
    `<div class="sift-sg-body sift-spectro-body">` +
```

par :

```ts
function spectroAndTagsHtml(r: AnalysisReport): string {
  const yn = (b: boolean) => (b ? "oui" : "non");
  const { label: qualityLabel, tone: qualityTone } = qualityChipTone(r);
  return (
    `<div class="sift-spectro-box">` +
    `<button class="sift-sg-toggle sift-spectro-toggle sift-zone-toggle">` +
    `<span class="sift-spectro-toggle-label"><span class="sift-sg-caret sift-spectro-caret sift-zone-toggle-car">▸</span> Preuve (spectre)</span>` +
    `<span class="sift-zone-toggle-right">` +
    `${vchipHtml(qualityLabel, qualityTone).replace('class="sift-vchip"', 'class="sift-vchip sift-chip-badge" id="sift-quality-badge"')}` +
    `<span class="sift-sg-hint sift-spectro-hint sift-zone-toggle-hint">afficher</span>` +
    `</span>` +
    `</button>` +
    `<div class="sift-sg-body sift-spectro-body">` +
```

`.replace(...)` est un raccourci lisible ici (`vchipHtml` retourne un seul `<span class="sift-vchip" ...>`) — pas de risque d'ambiguïté puisque son propre code (`report-view.ts:243-253`) ne produit qu'une seule occurrence de `class="sift-vchip"` par appel.

- [ ] **Step 3: Câbler l'affichage du badge selon l'état replié/déplié dans `wireSpectrogram`**

Modifier `wireSpectrogram` (`report-view.ts:661-699`). Remplacer :

```ts
function wireSpectrogram(root: HTMLElement, r: AnalysisReport) {
  const sg = root.querySelector<HTMLCanvasElement>(".sift-sg");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  if (!sg || !toggle || !body || !caret || !hint) return;

  let open = false, loaded = false, busy = false;
  toggle.addEventListener("click", async () => {
    if (busy) return;
    if (open) {
      open = false;
      body.classList.remove("is-open");
      caret.style.transform = "";
      hint.textContent = "afficher";
      return;
    }
```

par :

```ts
function wireSpectrogram(root: HTMLElement, r: AnalysisReport) {
  const sg = root.querySelector<HTMLCanvasElement>(".sift-sg");
  const toggle = root.querySelector<HTMLButtonElement>(".sift-sg-toggle");
  const body = root.querySelector<HTMLElement>(".sift-sg-body");
  const caret = root.querySelector<HTMLElement>(".sift-sg-caret");
  const hint = root.querySelector<HTMLElement>(".sift-sg-hint");
  const qualityBadge = root.querySelector<HTMLElement>("#sift-quality-badge");
  if (!sg || !toggle || !body || !caret || !hint) return;

  let open = false, loaded = false, busy = false;
  toggle.addEventListener("click", async () => {
    if (busy) return;
    if (open) {
      open = false;
      body.classList.remove("is-open");
      caret.style.transform = "";
      hint.textContent = "afficher";
      if (qualityBadge) qualityBadge.hidden = false;
      return;
    }
```

Puis, dans la branche qui déplie (plus bas dans la même fonction, juste avant la fin — actuelle
séquence `open = true; caret.style.transform = "rotate(90deg)"; hint.textContent = "masquer"; body.classList.add("is-open");`), ajouter la ligne symétrique :

```ts
    open = true;
    caret.style.transform = "rotate(90deg)";
    hint.textContent = "masquer";
    if (qualityBadge) qualityBadge.hidden = true;
    body.classList.add("is-open");
```

- [ ] **Step 4: Retirer le CSS `.sift-evidence`/`.sift-evidence-label` devenu mort**

Dans `frontend/styles.css`, supprimer les deux règles (lignes 419-420) :

```css
.sift-evidence{margin-bottom:11px}
.sift-evidence-label{font-size:var(--text-xs);letter-spacing:.11em;text-transform:uppercase;color:var(--color-text-tertiary);margin-bottom:8px}
```

Confirmer avant suppression qu'aucun autre fichier ne les référence :
Run: `grep -rn "sift-evidence" frontend/`
Expected: aucune occurrence restante après la suppression du Step 1-2 ci-dessus.

- [ ] **Step 5: Vérifier `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérifier dans `tauri dev`**

Ouvrir un morceau `fake` (sur-encodé) en Revue. Confirmer : le badge qualité ("MP3 ≈ X kbps",
teinte ambre/danger) est visible dans l'en-tête "Preuve (spectre)" tant que la zone est repliée,
disparaît une fois dépliée (le contenu détaillé suffit alors), pas de chip CDJ nulle part dans
cette zone.

- [ ] **Step 7: Commit**

```bash
git add frontend/report-view.ts frontend/styles.css
git commit -m "refactor(revue): move quality chip into the spectral disclosure header, drop CDJ chip from Diagnostic"
```

---

## Task 4: Métadonnées (`filing.ts`) — badge CDJ, bandeau explicite, CTA contextuel, sélection candidat

**Files:**
- Modify: `frontend/filing.ts:1033-1146` (`renderEditor`, poursuite de Task 1)
- Modify: `frontend/filing.ts` (fonction de sélection de candidat — localiser via
  `grep -n "sift-cand" frontend/filing.ts`, le handler de clic candidat vit dans `doIdentify`
  ou une fonction voisine appelée depuis `filing.ts:1128-1130`)

**Interfaces:**
- Consumes: `.sift-chip-badge`/`.sift-highlight-flash`/`.sift-identified-flash`/
  `.sift-id-btn-neutral` (Task 2), `#sift-meta-toggle`/`#sift-meta-body` (Task 1),
  `AnalysisReport.tags_cdj_ok` (`shared/contracts.ts:100`).
- Produces: rien consommé par une tâche suivante (dernière tâche fonctionnelle avant
  vérification).

- [ ] **Step 1: Ajouter le badge CDJ dans l'en-tête du toggle (posé en Task 1)**

Dans le markup ajouté au Task 1 Step 2, le `<span class="sift-chip-badge" id="sift-cdj-badge" hidden></span>` existe déjà mais vide. Après le bloc `host.innerHTML = ...` (donc après le
câblage du Step 4 de Task 1), ajouter le remplissage dépendant de `report` :

```ts
  const cdjBadge = host.querySelector<HTMLElement>("#sift-cdj-badge");
  if (cdjBadge && report) {
    const ok = report.tags_cdj_ok;
    cdjBadge.textContent = ok ? "CDJ compatible" : "CDJ incompatible";
    cdjBadge.style.background = ok ? "var(--color-background-success)" : "var(--color-background-warning)";
    cdjBadge.style.color = ok ? "var(--color-text-success)" : "var(--color-text-warning)";
    cdjBadge.title = "Un CDJ a besoin d'Artiste + Titre gravés dans les tags du fichier";
    // Visible uniquement repliée (le corps affiche déjà la même info en détail une fois ouvert)
    cdjBadge.hidden = metaBody?.classList.contains("sift-zone-toggle-body-open") ?? false;
  }
```

Placer ce bloc juste après le bloc `metaToggle?.addEventListener(...)` du Task 1 Step 4, et
étendre ce même listener pour resynchroniser la visibilité du badge à chaque clic :

```ts
  metaToggle?.addEventListener("click", () => {
    const open = metaBody?.classList.toggle("sift-zone-toggle-body-open") ?? false;
    metaToggle.classList.toggle("sift-zone-toggle-open", open);
    metaToggle.setAttribute("aria-expanded", String(open));
    if (metaHint) metaHint.textContent = open ? "masquer" : "afficher";
    if (cdjBadge) cdjBadge.hidden = open;
  });
```

- [ ] **Step 2: Renommer le titre affiché "Identification · Discogs" → "Métadonnées"**

Dans le markup du Task 1 Step 2, le bouton de toggle affiche déjà `Métadonnées` — rien à changer
ici. En revanche, le `<span class="col-h sift-editor-title">Identification · Discogs</span>`
interne (juste sous le toggle, dans `.sift-ident-head`) reste tel quel : c'est un sous-titre
"source" (Discogs précisément), pas le nom de la zone — cohérent avec le spec ("· via Discogs"
reste un détail de provenance, pas le nom de la zone). Ne pas le supprimer.

- [ ] **Step 3: Reformuler le bandeau "tags non écrits" pour nommer Artiste/Titre explicitement**

Localiser le bandeau actuel :
Run: `grep -n "sift-tag-warn" frontend/filing.ts`
Expected: une ligne autour de `filing.ts:1104` avec le texte `Tags non écrits dans le fichier — <strong>Ranger</strong> ou <strong>Appliquer</strong> pour les graver`.

Remplacer ce texte par :

```ts
    `<div class="sift-tag-warn" style="display:none"><i class="ti ti-alert-triangle sift-icon-inline-md sift-icon-flex-none"></i><span>Artiste et Titre pas encore gravés dans le fichier (seulement identifiés ci-dessus) — un CDJ ne peut pas les lire tant que ce n'est pas fait. <strong>Ranger</strong> ou <strong>Appliquer les tags</strong> pour corriger.</span></div>` +
```

- [ ] **Step 4: CTA Discogs contextuel (neutre si déjà identifié, gold sinon)**

Localiser le bouton (`filing.ts:1063`) :

```ts
        `<button data-fil="identifier" class="sift-id-btn sift-id-btn-full" title="Rechercher les métadonnées sur Discogs (pochette, label, année, genres)"><i class="ti ti-search sift-icon-inline-sm"></i> Récupérer les métadonnées Discogs <span class="kbd sift-kbd-hint-id">I</span></button>` +
```

Ce bouton n'apparaît que dans la branche `identEditing` (édition active). Vérifier le contexte
exact autour de lignes 1061-1070 (`c.artist && c.title` détermine déjà si une identité existe).
Remplacer par une classe conditionnelle :

```ts
        `<button data-fil="identifier" class="sift-id-btn sift-id-btn-full${c.artist && c.title ? " sift-id-btn-neutral" : ""}" title="Rechercher les métadonnées sur Discogs (pochette, label, année, genres)"><i class="ti ti-search sift-icon-inline-sm"></i> ${c.artist && c.title ? "Rechercher à nouveau" : "Récupérer les métadonnées Discogs"} <span class="kbd sift-kbd-hint-id">I</span></button>` +
```

- [ ] **Step 5: Flash de confirmation sur la ligne "Identifié" — pas un état "sélectionné" persistant**

Correction par rapport au spec initial : le vrai code n'a **pas** de candidat qui reste dans une
liste avec un style "sélectionné" — un clic sur `[data-cand]` (`wireCandidateClicks`,
`filing.ts:805-837`) appelle `applyIdentity` puis, en cas de succès,
`onIdentityApplied(applied, editor, mid, host, candidates, idBtn)` (`filing.ts:655-748`), qui
**remplace tout le host** par `identifiedLineHtml(...)` (`filing.ts:753-766`, une seule ligne de
confirmation avec pochette + "Identifié : Artiste — Titre" + bouton "modifier") — il n'y a donc
aucun élément `.sift-cand` qui survit à la sélection pour porter une classe de repos. La classe
`.sift-identified-flash` ajoutée en Task 2 Step 4 cible cette ligne de confirmation, pas un
candidat de liste.

Le flash de confirmation doit cibler `.sift-identified-line`, au moment précis où elle apparaît
suite à un CHOIX FRAIS (`onIdentityApplied`), pas à une réouverture d'un morceau déjà identifié
(`restoreIdentifiedLine`, qui ne doit jamais flasher — ce n'est pas une action qu'on vient de
faire).

Remplacer (`filing.ts:727-728`) :

```ts
  host.hidden = false;
  host.innerHTML = identifiedLineHtml(applied.canonical.artist, applied.canonical.title, applied.cover_path);
```

par :

```ts
  host.hidden = false;
  host.innerHTML = identifiedLineHtml(applied.canonical.artist, applied.canonical.title, applied.cover_path);
  const identifiedLineEl = host.querySelector<HTMLElement>(".sift-identified-line");
  if (identifiedLineEl) {
    identifiedLineEl.classList.add("sift-identified-flash");
    identifiedLineEl.addEventListener(
      "animationend",
      () => identifiedLineEl.classList.remove("sift-identified-flash"),
      { once: true },
    );
  }
```

Le CSS `.sift-identified-flash` a déjà été ajouté en Task 2 Step 4 (avec la valeur de fond de
repos vérifiée à ce moment-là) — rien à ajouter ici, seulement le câblage JS ci-dessus.

- [ ] **Step 6: Mise en évidence "Appliquer les tags" depuis le bandeau (optionnel, cohérent avec le spec)**

Si le bandeau `.sift-tag-warn` et le bouton `.sift-applytags-btn` sont déjà côte à côte dans le
DOM (vérifié Task 1 — les deux sont dans le même `.sift-fil-editor`), aucune action
supplémentaire n'est nécessaire : contrairement au prototype, il n'y a plus besoin de mécanisme
de saut puisque badge/critère/fix sont déjà colocalisés dans la même zone repliable. Ne PAS
réintroduire de lien de saut ici (le spec le dit explicitement : c'était un pansement pour un
problème qui disparaît une fois colocalisé).

- [ ] **Step 7: Rafraîchir le badge CDJ quand les tags sont appliqués**

Localiser le handler du bouton Appliquer (`data-fil="applytags"`, `filing.ts:1132-1133`,
fonction `setApplyIdle`/le call site de `doApplyTags` si elle existe — chercher :
Run: `grep -n "applytags\|doApplyTags\|setApplyIdle" frontend/filing.ts`

Dans le callback de succès de cette action (là où le bandeau `.sift-tag-warn` est masqué après
écriture réussie), ajouter la mise à jour du badge :

```ts
  const cdjBadgeAfterApply = document.querySelector<HTMLElement>("#sift-cdj-badge");
  if (cdjBadgeAfterApply) {
    cdjBadgeAfterApply.textContent = "CDJ compatible";
    cdjBadgeAfterApply.style.background = "var(--color-background-success)";
    cdjBadgeAfterApply.style.color = "var(--color-text-success)";
  }
```

Insérer cet appel au même endroit où le code existant masque `.sift-tag-warn` après une
application de tags réussie (le grep ci-dessus localise la fonction exacte — pas de duplication
de la logique d'appel IPC, uniquement l'ajout de ces lignes après le succès).

- [ ] **Step 8: Vérifier `npx tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 9: Vérifier dans `tauri dev` sur 3 états**

1. Morceau non identifié : CTA Discogs gold plein, badge CDJ absent (pas de `report.tags_cdj_ok`
   pertinent tant qu'aucune identité n'existe — vérifier que `cdjBadge` gère `report === null`
   sans planter, cf. Step 1 `if (cdjBadge && report)`).
2. Morceau identifié, `tags_cdj_ok=false` : CTA neutre "Rechercher à nouveau", badge ambre
   "CDJ incompatible" visible replié, bandeau explicite visible déplié, clic Appliquer bascule
   le badge en vert "CDJ compatible" immédiatement.
3. Morceau identifié, `tags_cdj_ok=true` : badge vert d'emblée, pas de bandeau, rien à corriger.

Vérifier aussi en thème sombre (toggle Réglages).

- [ ] **Step 10: Commit**

```bash
git add frontend/filing.ts
git commit -m "feat(revue): CDJ badge in Métadonnées header, explicit tag-warn wording, contextual CTA, neutral candidate selection"
```

---

## Task 5: Revue finale

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: `npx tsc --noEmit` sur l'ensemble**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: `grep` de contrôle — aucune classe orpheline**

Run: `grep -rn "sift-evidence\b" frontend/` (doit être vide, supprimé Task 3)
Run: `grep -rn "sift-sg-toggle\|sift-spectro-toggle" frontend/report-view.ts` (doit montrer la
classe combinée avec `sift-zone-toggle`, Task 3 Step 2)

- [ ] **Step 3: Confirmer que `verdictCardHtml` n'a pas dérivé**

Run: `grep -n "sift-verdict-card\|sift-verdict-label\|sift-verdict-finalname" frontend/report-view.ts`
Expected: le bandeau plein coloré (icône + label + nom final, `report-view.ts:259-281`) est
inchangé — ce plan ne le touche pas, c'est déjà la conclusion en dernière position dans
`.sift-fil-verdict` (`filing.ts:1540,1546`). Si une des tâches précédentes l'a modifié par
erreur (aucune ne devrait), revenir dessus avant de continuer.

- [ ] **Step 4: Design review**

Invoquer la skill `design-review` sur l'écran Revue (morceau fake identifié), comme pour les
précédents chantiers UI Sift (voir `docs/superpowers/reviews/`).

- [ ] **Step 5: Commit final si des ajustements ont été faits en Step 4**

```bash
git add -A
git commit -m "fix(revue): design-review adjustments"
```
