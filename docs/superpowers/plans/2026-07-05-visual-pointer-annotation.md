# Pointeur visuel d'annotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alt+Clic dans la vraie app (`tauri dev`) → cadre de sélection + note libre → annotation JSON (styles calculés + localisation code) appendue dans `docs/annotations.jsonl`, que Claude lit et traite en session.

**Architecture:** Extension du couple dev-only existant `frontend/dev-inspector.ts` (UI Alt+Clic) + `src-tauri/src/dev_locate.rs` (localisation). Un nouveau module Rust `dev_annotate.rs` (commande `save_annotation`, append JSONL, gated `debug_assertions`) et une refonte du panneau de `dev-inspector.ts` (highlight overlay, remontée au parent, note + envoi). Aucun serveur, aucune écriture dans les sources.

**Tech Stack:** Rust (Tauri v2, serde_json déjà en deps), vanilla TS (pas de lib), `@tauri-apps/api/core` invoke.

**Spec:** `docs/superpowers/specs/2026-07-05-visual-pointer-annotation-design.md`

## Global Constraints

- Dev-only, double garde-fou : `import.meta.env.DEV` côté TS (pattern `main.ts:43-45`), `cfg!(debug_assertions)` côté Rust (pattern `dev_locate.rs:38`).
- Aucune écriture dans les fichiers sources depuis cet outil — seule cible d'écriture : `docs/annotations.jsonl` (append). Non gitignoré (volontaire : visible dans `git status` tant que non traité).
- Textes UI du panneau en français.
- Pas d'`innerHTML =` dans un handler répété (règle CLAUDE.md) — le handler ici est un clic ponctuel, mais construire les nœuds via `document.createElement` comme le fait déjà `dev-inspector.ts`.
- Vérifications : `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `npx tsc --noEmit`. Ne PAS lancer cargo pendant qu'un `tauri dev` tourne (mémoire `avoid-concurrent-cargo-tauri-dev`).

---

### Task 1: Commande Rust `save_annotation`

**Files:**
- Create: `src-tauri/src/dev_annotate.rs`
- Modify: `src-tauri/src/lib.rs` (ajout `mod dev_annotate;` après la ligne 5 `mod dev_locate;`, et `dev_annotate::save_annotation` dans le handler après `dev_locate::locate_source` ligne 131)

**Interfaces:**
- Consumes: rien (module autonome).
- Produces: commande Tauri `save_annotation(annotation: serde_json::Value) -> Result<(), String>` — appelée par le frontend Task 2. Ajoute côté Rust un champ `ts` (epoch secondes) à l'objet reçu et l'appende en une ligne JSON compacte dans `docs/annotations.jsonl` (chemin résolu depuis `CARGO_MANIFEST_DIR/../docs`, même convention que `frontend_dir()` de `dev_locate.rs:20-22`).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src-tauri/src/dev_annotate.rs` avec seulement le module de tests (l'implémentation viendra au Step 3 — le fichier doit compiler, donc poser la signature vide n'est pas possible en TDD strict Rust ; on écrit tests + implémentation minimale dans le même fichier mais on vérifie d'abord que les tests échouent avec un `todo!()`) :

```rust
//! Dev-only: persiste les annotations du pointeur visuel (Alt+Clic) dans
//! docs/annotations.jsonl — une ligne JSON par annotation, append seul.
//! Jamais d'écriture dans les sources. Gated debug comme dev_locate.
use std::io::Write;
use std::path::{Path, PathBuf};

fn annotations_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("docs")
        .join("annotations.jsonl")
}

fn append_line(path: &Path, mut annotation: serde_json::Value) -> Result<(), String> {
    todo!()
}

#[tauri::command]
pub fn save_annotation(annotation: serde_json::Value) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("save_annotation is a dev-only command".into());
    }
    append_line(&annotations_path(), annotation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("sift-annot-test-{name}.jsonl"));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn appends_one_json_line_per_call() {
        let path = tmp_file("append");
        append_line(&path, serde_json::json!({"note": "trop tassé"})).unwrap();
        append_line(&path, serde_json::json!({"note": "couleur \"bizarre\"\nsur 2 lignes"})).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "2 appels -> 2 lignes");
        for line in &lines {
            let v: serde_json::Value = serde_json::from_str(line).expect("chaque ligne est du JSON valide");
            assert!(v.get("note").is_some());
            assert!(v.get("ts").and_then(|t| t.as_u64()).is_some(), "ts epoch ajouté côté Rust");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_non_object_annotation() {
        let path = tmp_file("nonobj");
        let err = append_line(&path, serde_json::json!("just a string")).unwrap_err();
        assert!(err.contains("objet"), "message d'erreur explicite: {err}");
        assert!(!path.exists(), "rien écrit en cas de refus");
    }
}
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dev_annotate`
Expected: FAIL (panic `not yet implemented` sur les 2 tests).

- [ ] **Step 3: Implémentation minimale**

Remplacer le `todo!()` de `append_line` :

```rust
fn append_line(path: &Path, mut annotation: serde_json::Value) -> Result<(), String> {
    let Some(obj) = annotation.as_object_mut() else {
        return Err("annotation doit être un objet JSON".into());
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    obj.insert("ts".into(), serde_json::Value::from(ts));
    let line = serde_json::to_string(&annotation).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("ouverture {}: {e}", path.display()))?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dev_annotate`
Expected: PASS (2 tests).

- [ ] **Step 5: Enregistrer la commande**

Dans `src-tauri/src/lib.rs` : ajouter `mod dev_annotate;` sous `mod dev_locate;` (ligne 5), et dans `generate_handler![...]` ajouter `dev_annotate::save_annotation` après `dev_locate::locate_source` (ligne 131, ajouter une virgule à la ligne existante).

- [ ] **Step 6: Vérifier build + clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean (0 warning).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/dev_annotate.rs src-tauri/src/lib.rs
git commit -m "feat(dev): commande save_annotation (append docs/annotations.jsonl, dev-only)"
```

---

### Task 2: Capture frontend — module `dev-annotate.ts`

**Files:**
- Create: `frontend/dev-annotate.ts`
- Test: vérification par `npx tsc --noEmit` + tests manuels Task 3 (pas de harnais de test JS dans ce repo — convention existante : `selftest.ts` smoke tests, tsc comme garde).

**Interfaces:**
- Consumes: `invoke` de `@tauri-apps/api/core` ; commandes Tauri `locate_source(identifier: string) -> SourceMatch[]` (existante) et `save_annotation(annotation: object) -> void` (Task 1).
- Produces: `captureElement(el: HTMLElement): ElementCapture` et `buildAnnotation(el: HTMLElement, note: string): Promise<Annotation>` — consommés par le panneau Task 3. Formes exactes :

```ts
export interface ElementCapture {
  tag: string;                       // "button"
  id: string | null;                 // "sift-tb-close" ou null
  classes: string[];                 // ["sift-settings-btn"]
  text: string;                      // texte visible, tronqué à 120 chars
  styles: Record<string, string>;    // propriétés filtrées (voir STYLE_PROPS)
  rect: { w: number; h: number };    // arrondi au px
}

export interface Annotation {
  note: string;
  view: string | null;               // écran actif ("accueil", "revue"...) ou null
  element: ElementCapture;
  ancestors: { tag: string; id: string | null; classes: string[] }[]; // jusqu'à body exclu, max 8
  siblings: ElementCapture[];        // frères directs éléments, max 6
  code: { file: string; line: number; excerpt: string }[]; // locate_source, max 20
}
```

- [ ] **Step 1: Écrire le module**

Créer `frontend/dev-annotate.ts` :

```ts
// Dev-only: capture de contexte pour le pointeur visuel d'annotation (Alt+Clic).
// Produit des VALEURS exactes (getComputedStyle) plutôt qu'une image — voir
// docs/superpowers/specs/2026-07-05-visual-pointer-annotation-design.md.
import { invoke } from "@tauri-apps/api/core";

export interface ElementCapture {
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  styles: Record<string, string>;
  rect: { w: number; h: number };
}

export interface Annotation {
  note: string;
  view: string | null;
  element: ElementCapture;
  ancestors: { tag: string; id: string | null; classes: string[] }[];
  siblings: ElementCapture[];
  code: { file: string; line: number; excerpt: string }[];
}

// Propriétés pertinentes pour un problème visuel — pas les ~350 brutes.
const STYLE_PROPS = [
  "color", "background-color",
  "font-family", "font-size", "font-weight", "line-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-top-color", "border-radius",
  "gap", "display", "align-items", "justify-content",
  "opacity", "box-shadow",
] as const;

export function captureElement(el: HTMLElement): ElementCapture {
  const cs = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const p of STYLE_PROPS) styles[p] = cs.getPropertyValue(p);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: [...el.classList],
    text: (el.textContent ?? "").trim().slice(0, 120),
    styles,
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
  };
}

function activeView(): string | null {
  const on = document.querySelector<HTMLElement>("#nav .nv.on");
  return on?.dataset.view ?? null;
}

export async function buildAnnotation(el: HTMLElement, note: string): Promise<Annotation> {
  const ancestors: Annotation["ancestors"] = [];
  for (let a = el.parentElement; a && a !== document.body && ancestors.length < 8; a = a.parentElement) {
    ancestors.push({ tag: a.tagName.toLowerCase(), id: a.id || null, classes: [...a.classList] });
  }
  const siblings = [...(el.parentElement?.children ?? [])]
    .filter((s): s is HTMLElement => s !== el && s instanceof HTMLElement)
    .slice(0, 6)
    .map(captureElement);

  // Localisation code : même identifiants que l'inspecteur (id d'abord, puis classes).
  const identifiers = el.id ? [`#${el.id}`, ...el.classList] : [...el.classList];
  const code: Annotation["code"] = [];
  for (const ident of identifiers.slice(0, 3)) {
    try {
      const matches = await invoke<{ file: string; line: number; excerpt: string }[]>(
        "locate_source", { identifier: ident },
      );
      code.push(...matches);
    } catch {
      // fail-fast affiché au moment de l'envoi si TOUT échoue ; un identifiant
      // sans résultat n'est pas une erreur (spec: localisation vide tolérée).
    }
    if (code.length >= 20) break;
  }

  return { note, view: activeView(), element: captureElement(el), ancestors, siblings, code: code.slice(0, 20) };
}

export async function sendAnnotation(annotation: Annotation): Promise<void> {
  await invoke("save_annotation", { annotation });
}
```

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/dev-annotate.ts
git commit -m "feat(dev): capture de contexte (styles calculés + localisation) pour annotations"
```

---

### Task 3: Panneau d'annotation dans `dev-inspector.ts` (highlight, parent, note, envoi)

**Files:**
- Modify: `frontend/dev-inspector.ts` (le fichier fait 103 lignes ; le handler Alt+Clic `installDevInspector` lignes 59-103 et le panneau `buildPanel` lignes 14-24 évoluent)

**Interfaces:**
- Consumes: `buildAnnotation`, `sendAnnotation` de `./dev-annotate` (Task 2) ; `showMatches`/`buildPanel` existants conservés.
- Produces: rien de nouveau pour d'autres modules — `installDevInspector()` garde sa signature (appelée depuis `main.ts:44`).

Comportement cible du geste Alt+Clic (remplace le flux actuel, qui reste accessible dans le même panneau) :
1. Cadre de highlight (`position:fixed`, contour 2px, `pointer-events:none`, `z-index:99998`) posé sur le rect de l'élément sélectionné.
2. Bouton « ⬆ bloc parent » : re-sélectionne `parentElement` (s'arrête à `document.body`), redessine le cadre, met à jour l'entête du panneau.
3. `<textarea>` note libre + bouton « Envoyer » : appelle `buildAnnotation(sel, note)` puis `sendAnnotation`, affiche « ✓ envoyée » ou l'erreur (fail-fast, pas de retry).
4. Les boutons d'identifiants existants (localisation `showMatches`) restent en dessous — même panneau, deux usages.
5. Fermer le panneau retire aussi le cadre.

- [ ] **Step 1: Modifier `dev-inspector.ts`**

Remplacer intégralement `installDevInspector` (lignes 59-103) et ajouter les helpers, en gardant `buildPanel`/`showMatches`/`SourceMatch` inchangés :

```ts
import { buildAnnotation, sendAnnotation } from "./dev-annotate";

function buildHighlight(): HTMLElement {
  document.getElementById("sift-dev-highlight")?.remove();
  const box = document.createElement("div");
  box.id = "sift-dev-highlight";
  box.style.cssText =
    "position:fixed;pointer-events:none;z-index:99998;" +
    "border:2px solid #f2c274;border-radius:3px;box-shadow:0 0 0 2px rgba(0,0,0,.35)";
  document.body.appendChild(box);
  return box;
}

function moveHighlight(box: HTMLElement, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  box.style.left = `${r.left - 2}px`;
  box.style.top = `${r.top - 2}px`;
  box.style.width = `${r.width}px`;
  box.style.height = `${r.height}px`;
}

function describe(el: HTMLElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length ? `.${[...el.classList].join(".")}` : "";
  return `<${el.tagName.toLowerCase()}>${id}${cls}`;
}

export function installDevInspector() {
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();

      let sel = e.target as HTMLElement;
      const panel = buildPanel();
      const highlight = buildHighlight();
      moveHighlight(highlight, sel);

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "× fermer";
      closeBtn.style.cssText = "float:right;cursor:pointer;margin-bottom:6px";
      closeBtn.onclick = () => { panel.remove(); highlight.remove(); };
      panel.appendChild(closeBtn);

      const header = document.createElement("div");
      header.style.cssText = "color:#9fe0af;font-weight:bold;margin-bottom:6px";
      header.textContent = describe(sel);
      panel.appendChild(header);

      const parentBtn = document.createElement("button");
      parentBtn.textContent = "⬆ bloc parent";
      parentBtn.style.cssText = "cursor:pointer;margin-bottom:6px";
      panel.appendChild(parentBtn);

      const note = document.createElement("textarea");
      note.placeholder = "Remarque libre (« trop tassé », « pas cohérent avec la Bibliothèque »...)";
      note.style.cssText =
        "width:100%;min-height:56px;box-sizing:border-box;margin-bottom:4px;" +
        "background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:4px;padding:6px;font:inherit";
      panel.appendChild(note);

      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Envoyer";
      sendBtn.style.cssText = "cursor:pointer;margin-bottom:8px";
      panel.appendChild(sendBtn);

      const status = document.createElement("div");
      status.style.cssText = "margin-bottom:8px;color:#847E75";
      panel.appendChild(status);

      const locateZone = document.createElement("div");
      panel.appendChild(locateZone);

      const refreshLocateButtons = () => {
        locateZone.replaceChildren();
        const identifiers = sel.id ? [`#${sel.id}`, ...sel.classList] : [...sel.classList];
        if (identifiers.length === 0) {
          const none = document.createElement("div");
          none.textContent = "pas de classe/id — capture par contexte seulement";
          locateZone.appendChild(none);
          return;
        }
        for (const id of identifiers) {
          const btn = document.createElement("button");
          btn.textContent = id;
          btn.style.cssText = "margin:2px;cursor:pointer";
          btn.onclick = () => void showMatches(locateZone, id);
          locateZone.appendChild(btn);
        }
      };

      parentBtn.onclick = () => {
        const p = sel.parentElement;
        if (!p || p === document.body) return;
        sel = p;
        moveHighlight(highlight, sel);
        header.textContent = describe(sel);
        refreshLocateButtons();
      };

      sendBtn.onclick = () => {
        const text = note.value.trim();
        if (!text) { status.textContent = "note vide — écris d'abord ta remarque"; return; }
        sendBtn.disabled = true;
        status.textContent = "envoi…";
        void buildAnnotation(sel, text)
          .then(sendAnnotation)
          .then(() => {
            status.textContent = "✓ envoyée (docs/annotations.jsonl)";
            note.value = "";
          })
          .catch((err) => { status.textContent = `échec : ${String(err)}`; })
          .finally(() => { sendBtn.disabled = false; });
      };

      refreshLocateButtons();
    },
    true,
  );
  console.log("Sift dev inspector: Alt+Click = annoter / localiser un élément.");
}
```

Note : `showMatches(panel, ...)` prend désormais `locateZone` comme conteneur — sa signature `(panel: HTMLElement, identifier: string)` est déjà générique, aucun changement nécessaire. L'auto-run du plus long identifiant (ancien comportement, ligne 96-98) est retiré : l'usage principal devient l'annotation, la localisation reste à la demande via les boutons.

- [ ] **Step 2: Vérifier le type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/dev-inspector.ts
git commit -m "feat(dev): panneau d'annotation Alt+Clic (highlight, bloc parent, note, envoi)"
```

---

### Task 4: Vérification réelle + doc

**Files:**
- Modify: `docs/design-system-states.md` — rien (outil, pas composant produit). À la place : `CLAUDE.md` section « Outillage » n'est PAS modifiée non plus (l'inspecteur y est déjà implicite via ressources-externes) ; ajouter l'usage dans `docs/ressources-externes.md` (section Évaluation 8-10, nouvelle entrée courte) uniquement si Antoine valide l'outil au test réel.

**Interfaces:**
- Consumes: tout ce qui précède, en conditions réelles.
- Produces: verdict d'utilisabilité + entrée doc.

- [ ] **Step 1: Suite de vérification complète (app fermée, pas de tauri dev en cours)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml` → attendu : tous verts (sauf échecs pré-existants documentés : fixtures decode si absentes).
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` → attendu : clean.
Run: `npx tsc --noEmit` → attendu : 0 erreur.

- [ ] **Step 2: Test du geste par Antoine (pas par Claude — mémoire `prefer-ask-user-to-test-over-computeruse`)**

Demander à Antoine de lancer `npm run tauri dev` et de vérifier :
1. Alt+Clic sur un élément → cadre visible + panneau.
2. « ⬆ bloc parent » remonte la sélection et déplace le cadre.
3. Note + « Envoyer » → « ✓ envoyée ».
4. `docs/annotations.jsonl` contient une ligne JSON lisible.

- [ ] **Step 3: Claude lit et traite une annotation de test**

Lire `docs/annotations.jsonl`, vérifier que note + view + element.styles + code suffisent à localiser l'élément sans question, puis vider le fichier (les entrées traitées se retirent).

- [ ] **Step 4: Documenter et committer**

Ajouter une entrée courte dans `docs/ressources-externes.md` (après l'Évaluation 10) décrivant l'outil et le workflow (« Alt+Clic → note → "regarde" en session »), puis :

```bash
git add docs/ressources-externes.md
git commit -m "docs: workflow du pointeur visuel d'annotation"
```

---

## Self-Review (fait à l'écriture)

- Spec coverage : geste (T3), capture données (T2), persistance (T1), boucle de traitement + vérif réelle (T4), gating debug (T1/T3 via pattern existant), erreurs (note vide, échec IPC, non-objet). Hors scope respecté (pas d'image, pas d'édition, pas de watcher).
- Placeholders : aucun — code complet dans chaque step.
- Cohérence de types : `Annotation`/`ElementCapture` (T2) = ce que consomme T3 ; `save_annotation(annotation: serde_json::Value)` (T1) reçoit l'objet `Annotation` sérialisé par invoke (clé `annotation`, camelCase conservé par serde_json::Value sans renommage).
