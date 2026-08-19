// Pseudo-états RÉELS sur la fenêtre WebView2 de Sift — :hover et :focus-visible ne se déclenchent
// PAS depuis la page (un MouseEvent dispatché ne passe pas le hit-testing du moteur ; un focus()
// programmatique n'est « focus-visible » que si la dernière interaction était clavier). Seuls des
// événements injectés par le protocole (Input.dispatchMouseEvent / Input.dispatchKeyEvent) le font,
// et il leur faut une session WebSocket CONTINUE — c'est pourquoi ce module ne passe pas par
// cdp.cjs (un process par appel) : l'état du pointeur virtuel ne doit pas retomber entre deux
// commandes. Invoqué par driver.mjs (`hover` / `focus`), utilisable seul :
//   node probe.mjs <port> hover  <selector> [idx] [outDir]
//   node probe.mjs <port> focus  <selector> [outDir]
// Sortie : JSON sur stdout (mesures repos/état/retour) ; captures recadrées 1:1 si outDir fourni.
// Pièges documentés (mémoire cdp-real-pseudo-states-for-verification) : une modale ouverte VOLE le
// focus (son piège Tab) — fermer d'abord ; une classe d'état posée à la main est balayée par le
// premier re-render.
import fs from "node:fs";
import path from "node:path";

const [, , portArg, mode, sel, ...restArgs] = process.argv;
const PORT = Number(portArg);
if (!PORT || !mode || !sel) {
  console.error("usage: node probe.mjs <port> hover <selector> [idx] [outDir] | focus <selector> [outDir]");
  process.exit(1);
}
const idx = mode === "hover" && /^\d+$/.test(restArgs[0] || "") ? Number(restArgs.shift()) : 0;
const OUT = restArgs[0] || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");
// Le port est squattable par un projet Tauri voisin : l'identité se vérifie AVANT toute mesure.
if (!/Sift/i.test(page.title || "")) throw new Error(`target is NOT Sift: ${page.title}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROPS = ["background-color", "color", "outline-color", "outline-width", "outline-style", "border-color", "opacity", "filter"];
async function styleOf() {
  return evalJs(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${idx}];if(!e)return null;
    const c=getComputedStyle(e);const o={};${JSON.stringify(PROPS)}.forEach(p=>o[p]=c.getPropertyValue(p));
    o.hovered=e.matches(":hover");o.focusVisible=e.matches(":focus-visible");
    o.isActive=document.activeElement===e;return o;})()`);
}
async function rectOf() {
  return evalJs(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${idx}];if(!e)return null;
    const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vis:r.width>0&&r.height>0};})()`);
}
async function shot(file, rect, pad = 6) {
  if (!OUT) return null;
  const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2, scale: 1 };
  const r = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
  const p = path.join(OUT, file);
  fs.writeFileSync(p, Buffer.from(r.data, "base64"));
  return p;
}
const slug = sel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

await send("Page.enable");
const rect = await rectOf();
if (!rect || !rect.vis) {
  console.log(JSON.stringify({ sel, idx, status: "ABSENT ou invisible — naviguer vers l'écran d'abord" }));
  ws.close();
  process.exit(2);
}

let out;
if (mode === "hover") {
  // repos → survol (vrai mouseMoved, hit-testing moteur) → repos. 260ms > --duration-base :
  // toute transition restante a fini avant la mesure.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
  await sleep(260);
  const rest = await styleOf();
  const shotRest = await shot(`probe-${slug}-rest.png`, rect);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, button: "none", buttons: 0 });
  await sleep(260);
  const hover = await styleOf();
  const shotHover = await shot(`probe-${slug}-hover.png`, rect);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
  await sleep(260);
  const back = await styleOf();
  out = { sel, idx, engineHoverMatched: hover.hovered, changed: rest["background-color"] !== hover["background-color"],
    restored: back["background-color"] === rest["background-color"], rest, hover, shots: [shotRest, shotHover].filter(Boolean) };
} else if (mode === "focus") {
  // Une VRAIE touche d'abord : Chromium ne marque :focus-visible que si la dernière interaction
  // était clavier — sans elle, le focus() qui suit ne compte pas.
  await evalJs(`document.activeElement?.blur()`);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await sleep(80);
  await evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[${idx}]?.focus()`);
  await sleep(200);
  const focused = await styleOf();
  const shotFocus = await shot(`probe-${slug}-focus.png`, rect);
  await evalJs(`document.activeElement?.blur()`);
  out = { sel, idx, ...focused, shots: [shotFocus].filter(Boolean) };
  if (!focused.isActive) out.warning = "focus() n'a pas pris — modale à piège de focus ouverte, ou nœud re-rendu entre-temps";
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}
console.log(JSON.stringify(out, null, 2));
ws.close();
