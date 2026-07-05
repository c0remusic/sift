// Dev-only click-to-source inspector: Alt+Click any element in the running app to see
// which real file(s)/line(s) define or consume its class/id — for pointing Claude at an
// exact spot instead of describing it. Never active outside `import.meta.env.DEV` (see
// main.ts) and the backend command it calls (locate_source) refuses outside debug builds
// too (see src-tauri/src/dev_locate.rs) — belt and suspenders against shipping this.
import { invoke } from "@tauri-apps/api/core";
import { buildAnnotation, sendAnnotation } from "./dev-annotate";

interface SourceMatch {
  file: string;
  line: number;
  excerpt: string;
}

function buildPanel(): HTMLElement {
  document.getElementById("sift-dev-inspector")?.remove();
  const panel = document.createElement("div");
  panel.id = "sift-dev-inspector";
  panel.style.cssText =
    "position:fixed;top:8px;right:8px;width:440px;max-height:75vh;overflow-y:auto;" +
    "background:#1e1e1e;color:#eee;font:11px 'JetBrains Mono',monospace;padding:10px;" +
    "border-radius:6px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.5)";
  document.body.appendChild(panel);
  return panel;
}

async function showMatches(panel: HTMLElement, identifier: string) {
  const heading = document.createElement("div");
  heading.textContent = `→ ${identifier}`;
  heading.style.cssText = "margin-top:8px;color:#9fe0af;font-weight:bold";
  panel.appendChild(heading);
  try {
    const matches = await invoke<SourceMatch[]>("locate_source", { identifier });
    if (matches.length === 0) {
      const none = document.createElement("div");
      none.textContent = "(aucun résultat dans frontend/)";
      panel.appendChild(none);
      return;
    }
    for (const m of matches.slice(0, 8)) {
      const row = document.createElement("div");
      row.style.cssText = "margin:4px 0;white-space:pre-wrap;color:#ccc";
      row.textContent = `${m.file}:${m.line}\n${m.excerpt}`;
      panel.appendChild(row);
    }
    if (matches.length > 8) {
      const more = document.createElement("div");
      more.style.color = "#847E75";
      more.textContent = `… ${matches.length - 8} de plus, non affichés`;
      panel.appendChild(more);
    }
  } catch (e) {
    const err = document.createElement("div");
    err.style.color = "#f2c274";
    err.textContent = String(e);
    panel.appendChild(err);
  }
}

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
