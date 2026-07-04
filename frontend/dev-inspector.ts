// Dev-only click-to-source inspector: Alt+Click any element in the running app to see
// which real file(s)/line(s) define or consume its class/id — for pointing Claude at an
// exact spot instead of describing it. Never active outside `import.meta.env.DEV` (see
// main.ts) and the backend command it calls (locate_source) refuses outside debug builds
// too (see src-tauri/src/dev_locate.rs) — belt and suspenders against shipping this.
import { invoke } from "@tauri-apps/api/core";

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

export function installDevInspector() {
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      const panel = buildPanel();
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "× fermer";
      closeBtn.style.cssText = "float:right;cursor:pointer;margin-bottom:6px";
      closeBtn.onclick = () => panel.remove();
      panel.appendChild(closeBtn);

      const idAttr = target.id;
      const classes = [...target.classList];
      const identifiers = idAttr ? [`#${idAttr}`, ...classes] : classes;

      if (identifiers.length === 0) {
        const none = document.createElement("div");
        none.textContent = `<${target.tagName.toLowerCase()}> — pas de classe/id, rien à chercher`;
        panel.appendChild(none);
        return;
      }

      const buttons = document.createElement("div");
      for (const id of identifiers) {
        const btn = document.createElement("button");
        btn.textContent = id;
        btn.style.cssText = "margin:2px;cursor:pointer";
        btn.onclick = () => void showMatches(panel, id);
        buttons.appendChild(btn);
      }
      panel.appendChild(buttons);

      // Auto-run the most specific (longest) identifier right away.
      const longest = identifiers.reduce((a, b) => (b.length > a.length ? b : a));
      void showMatches(panel, longest);
    },
    true,
  );
  console.log("Sift dev inspector: Alt+Click any element to locate its real source.");
}
