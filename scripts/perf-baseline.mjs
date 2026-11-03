// Mesure de base des budgets de performance (ticket #88, carte #87).
//
// Ce script ne modifie pas l'app : il s'attache par CDP à une fenêtre Sift déjà lancée (bac à
// sable, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`), injecte une
// instrumentation dans la page (enveloppe de `fetch` vers `ipc.localhost`, observateurs
// `long-animation-frame` et `longtask`, accroche des éléments média), mesure, et rend du JSON.
// L'instrumentation vit dans la page et disparaît au rechargement suivant.
//
// Usage (une fenêtre bac à sable par CLAUDE.md § « Deuxième instance dev », jamais celle d'Antoine) :
//   node scripts/perf-baseline.mjs rail    --port 9488 [--reps 3]
//   node scripts/perf-baseline.mjs open    --port 9488 [--n 24]
//   node scripts/perf-baseline.mjs freeze  --port 9488 [--seconds 120] [--view revue]
//   node scripts/perf-baseline.mjs startup --exe <sift.exe release> --port 9489 [--runs 5]
// Le fil de la fenêtre côté Win32 se mesure à part : scripts/perf-window-probe.ps1.
//
// Définitions, à relire avant de comparer deux chiffres :
// - « peint » : la première image présentée après la DERNIÈRE mutation du contenu, approchée par
//   `requestAnimationFrame` puis `setTimeout(0)` (le rappel de rAF tourne avant la peinture, la
//   tâche suivante après). La mesure s'arrête après 600 ms sans mutation ni IPC en vol.
// - « IPC » : l'union des intervalles des `invoke` lancés entre le clic et la peinture, vus de la
//   page, de l'envoi à la réception de la réponse (passage par le fil de la fenêtre compris, décodage
//   JSON non compris). « Rendu » = total − IPC.
// - « gel » : une image longue (`long-animation-frame`) de plus de 100 ms, ou un retard de minuterie
//   de la page de plus de 100 ms, ou un `invoke` témoin (`get_setting`) de plus de 100 ms.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const PORT = Number(opt("port", "9488"));
const OUT = opt("out", null);
const VIEWS = ["revue", "dups", "journal", "biblio", "resourcing", "trash", "rkb", "cle", "reglages"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// CDP minimal, avec contrôle d'identité : une cible dont le titre n'est pas Sift est refusée.
// ---------------------------------------------------------------------------------------------

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function connect(port, { waitMs = 0 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const page = (await listTargets(port)).find((t) => t.type === "page");
      if (page) return await openSession(page.webSocketDebuggerUrl);
    } catch {
      /* port pas encore ouvert */
    }
    if (Date.now() > deadline) throw new Error(`aucune page CDP sur le port ${port}`);
    await sleep(10);
  }
}

function openSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) listeners.forEach((l) => l(msg));
    };
    ws.onerror = (e) => reject(new Error(`websocket: ${e.message ?? e}`));
    ws.onopen = () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej });
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      const evaluate = async (expression, { timeoutMs = 120000 } = {}) => {
        const r = await send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: timeoutMs,
        });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
        return r.result.value;
      };
      resolve({ send, evaluate, on: (f) => listeners.push(f), close: () => ws.close() });
    };
  });
}

async function assertSift(s) {
  const title = await s.evaluate("document.title");
  if (!/Sift/.test(title)) throw new Error(`la cible n'est pas Sift : « ${title} »`);
  return title;
}

// ---------------------------------------------------------------------------------------------
// Instrumentation injectée dans la page. Idempotente : réinjectée après chaque rechargement.
// ---------------------------------------------------------------------------------------------

const INSTRUMENT = `(() => {
  if (window.__perf) return "deja";
  const P = (window.__perf = { inv: [], loaf: [], lt: [], media: [] });
  // \`__TAURI_INTERNALS__.invoke\` et \`.ipc\` sont non inscriptibles et non configurables : on
  // ne peut pas les envelopper. Sous Windows, \`ipc\` passe par \`fetch("http://ipc.localhost/<cmd>")\`,
  // résolu par le protocole personnalisé de Tauri : c'est \`fetch\` qu'on enveloppe. \`t1\` est la
  // réception de la réponse ; le décodage JSON qui suit appartient au rendu.
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!/^https?:\\/\\/ipc\\.localhost\\//.test(url)) return origFetch(input, init);
    const cmd = decodeURIComponent(new URL(url).pathname.slice(1));
    const e = { cmd, t0: performance.now(), t1: null, ok: null };
    P.inv.push(e);
    const p = origFetch(input, init);
    p.then((r) => { e.t1 = performance.now(); e.ok = r.ok; },
           () => { e.t1 = performance.now(); e.ok = false; });
    return p;
  };
  try {
    new PerformanceObserver((l) => {
      for (const x of l.getEntries()) P.loaf.push({
        t0: x.startTime, dur: x.duration, block: x.blockingDuration,
        render: x.renderStart ? x.startTime + x.duration - x.renderStart : 0,
        scripts: (x.scripts || []).map((s) => ({
          dur: s.duration, inv: s.invoker, type: s.invokerType,
          src: (s.sourceURL || "").replace(/^.*\\/\\/[^/]+/, "") + (s.sourceFunctionName ? "#" + s.sourceFunctionName : ""),
        })),
      });
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch (e) { P.loafError = String(e); }
  try {
    new PerformanceObserver((l) => {
      for (const x of l.getEntries()) P.lt.push({ t0: x.startTime, dur: x.duration });
    }).observe({ type: "longtask", buffered: false });
  } catch (e) { P.ltError = String(e); }
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) {
      const m = { t0: performance.now(), meta: null, canplay: null, err: null };
      P.media.push(m);
      this.addEventListener("loadedmetadata", () => { m.meta ??= performance.now(); }, { once: true });
      this.addEventListener("canplay", () => { m.canplay ??= performance.now(); }, { once: true });
      this.addEventListener("error", () => { m.err ??= performance.now(); }, { once: true });
      desc.set.call(this, v);
    },
  });
  // Attend qu'un sélecteur de contenu soit calme : 600 ms sans mutation ni IPC en vol.
  // Rend l'instant de la dernière peinture suivant la dernière mutation.
  P.settle = (root, since, { quietMs = 600, maxMs = 20000 } = {}) => new Promise((resolve) => {
    let painted = since, lastMut = since, muts = 0;
    const steps = [];
    const onMut = () => {
      muts++;
      lastMut = performance.now();
      const step = { t: lastMut, nodes: root.querySelectorAll("*").length, painted: null };
      steps.push(step);
      requestAnimationFrame(() => setTimeout(() => { painted = step.painted = performance.now(); }, 0));
    };
    const mo = new MutationObserver(onMut);
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    const tick = () => {
      const now = performance.now();
      const inflight = P.inv.some((e) => e.t0 >= since && e.t1 == null);
      if ((!inflight && now - lastMut >= quietMs && now - painted >= 0 && painted >= lastMut) || now - since > maxMs) {
        mo.disconnect();
        // « 90 % peint » : la première peinture où #content porte au moins 90 % de ses nœuds
        // finaux. Distingue un écran peint vite puis complété (aperçu différé, rafraîchissement
        // après le cache) d'un écran qui attend tout avant de peindre.
        const final = root.querySelectorAll("*").length;
        const s90 = steps.find((s) => s.nodes >= 0.9 * final);
        resolve({ painted, lastMut, muts, p90: s90 ? s90.painted ?? painted : painted, timedOut: now - since > maxMs });
      } else setTimeout(tick, 20);
    };
    setTimeout(tick, 20);
  });
  P.union = (list) => {
    const iv = list.filter((e) => e.t1 != null).map((e) => [e.t0, e.t1]).sort((a, b) => a[0] - b[0]);
    let tot = 0, cur = null;
    for (const [a, b] of iv) {
      if (!cur || a > cur[1]) { if (cur) tot += cur[1] - cur[0]; cur = [a, b]; }
      else cur[1] = Math.max(cur[1], b);
    }
    if (cur) tot += cur[1] - cur[0];
    return tot;
  };
  return "ok";
})()`;

async function instrument(s) {
  await assertSift(s);
  return s.evaluate(INSTRUMENT);
}

/** Recharge la page et attend que le routeur ait posé sa première vue (rail peint). */
async function reloadOn(s, view) {
  await s.evaluate(`sessionStorage.setItem("sift:view-after-reload", ${JSON.stringify(view)}); location.reload(); 1`);
  await sleep(300);
  for (let i = 0; i < 300; i++) {
    try {
      const ok = await s.evaluate(
        `!!document.querySelector('#nav .nv.on[data-view="${view}"]') && document.readyState === "complete"`,
      );
      if (ok) break;
    } catch {
      /* contexte en cours de remplacement */
    }
    await sleep(50);
  }
  await instrument(s);
  // Laisse retomber le rendu de démarrage de la vue d'accueil.
  await s.evaluate(`window.__perf.settle(document.getElementById("content"), performance.now(), { quietMs: 1000 })`);
}

// ---------------------------------------------------------------------------------------------
// 1. Les 9 destinations du rail
// ---------------------------------------------------------------------------------------------

const NAV = (view) => `(async () => {
  const P = window.__perf;
  const el = document.querySelector('#nav .nv[data-view="${view}"]');
  if (!el) throw new Error("destination absente : ${view}");
  const content = document.getElementById("content");
  const i0 = P.inv.length, l0 = P.loaf.length;
  const t0 = performance.now();
  // L'observateur se pose AVANT le clic : le routeur remplace \`#content\` de façon synchrone,
  // et une mutation faite avant l'observation serait perdue.
  const settled = P.settle(content, t0);
  el.click();
  const tClickDone = performance.now();
  const r = await settled;
  const inv = P.inv.slice(i0).filter((e) => e.t0 <= r.painted);
  const loaf = P.loaf.slice(l0).filter((x) => x.t0 >= t0 - 5 && x.t0 <= r.painted);
  const total = r.painted - t0;
  const ipc = P.union(inv);
  return {
    view: "${view}", at: performance.timeOrigin + t0, total, p90: r.p90 - t0, ipc, render: total - ipc, clickHandler: tClickDone - t0,
    timedOut: r.timedOut, muts: r.muts,
    cmds: inv.map((e) => ({ cmd: e.cmd, start: e.t0 - t0, dur: e.t1 == null ? null : e.t1 - e.t0 })),
    longFrames: loaf.map((x) => ({ start: x.t0 - t0, dur: x.dur, block: x.block, render: x.render,
      scripts: x.scripts.filter((s) => s.dur >= 10) })),
    nodes: content.querySelectorAll("*").length,
  };
})()`;

async function modeRail() {
  const reps = Number(opt("reps", "3"));
  const s = await connect(PORT);
  const title = await assertSift(s);
  const runs = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const view of VIEWS) {
      const base = view === "reglages" ? "journal" : "reglages";
      await reloadOn(s, base);
      const cold = await s.evaluate(NAV(view));
      await s.evaluate(NAV(base));
      const back = await s.evaluate(NAV(view));
      runs.push({ rep, view, cold, back });
      process.stderr.write(
        `${rep} ${view.padEnd(10)} froid ${cold.total.toFixed(0).padStart(6)} ms (ipc ${cold.ipc.toFixed(0)})` +
          `  retour ${back.total.toFixed(0).padStart(6)} ms (ipc ${back.ipc.toFixed(0)})\n`,
      );
    }
  }
  s.close();
  return { mode: "rail", title, reps, runs };
}

// ---------------------------------------------------------------------------------------------
// 2. Ouverture d'une piste en Revue
// ---------------------------------------------------------------------------------------------

const OPEN = (id) => `(async () => {
  const P = window.__perf;
  const row = document.querySelector('#ql .qi[data-id="${id}"]');
  if (!row) throw new Error("ligne absente : ${id}");
  const mid = document.getElementById("mid");
  const i0 = P.inv.length, l0 = P.loaf.length, m0 = P.media.length;
  const t0 = performance.now();
  row.click();
  // Verdict peint : le mot de verdict existe et une image a suivi sa pose.
  let verdictAt = null;
  await new Promise((resolve) => {
    const tick = () => {
      const w = mid.querySelector(".sift-player-verdict-word");
      const fail = mid.parentElement.querySelector(".sift-analysis-fail");
      if ((w && w.textContent) || fail) {
        requestAnimationFrame(() => setTimeout(() => { verdictAt = performance.now(); resolve(); }, 0));
      } else if (performance.now() - t0 > 120000) resolve();
      else setTimeout(tick, 4);
    };
    tick();
  });
  // Lecteur prêt : l'élément média a reçu « canplay ».
  for (let k = 0; k < 3000; k++) {
    const m = P.media.slice(m0).at(-1);
    if (m && (m.canplay || m.err)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const inv = P.inv.slice(i0);
  const pick = (c) => inv.find((e) => e.cmd === c);
  const az = pick("analyze_path"), pb = pick("playback_url");
  const media = P.media.slice(m0).at(-1) ?? null;
  const ready = Math.max(verdictAt ?? Infinity, media?.canplay ?? Infinity);
  const loaf = P.loaf.slice(l0).filter((x) => x.t0 >= t0 - 5 && x.t0 <= ready);
  const rel = (x) => (x == null ? null : x - t0);
  return {
    id: ${id},
    at: performance.timeOrigin + t0,
    total: rel(ready),
    verdict: rel(verdictAt),
    analyzePath: az ? { start: rel(az.t0), dur: az.t1 == null ? null : az.t1 - az.t0, ok: az.ok } : null,
    boxRender: az && az.t1 && verdictAt ? verdictAt - az.t1 : null,
    playbackUrl: pb ? { start: rel(pb.t0), dur: pb.t1 == null ? null : pb.t1 - pb.t0 } : null,
    media: media ? { srcSet: rel(media.t0), meta: rel(media.meta), canplay: rel(media.canplay), err: rel(media.err) } : null,
    cmds: inv.map((e) => ({ cmd: e.cmd, start: e.t0 - t0, dur: e.t1 == null ? null : e.t1 - e.t0 })),
    longFrames: loaf.map((x) => ({ start: x.t0 - t0, dur: x.dur, block: x.block,
      scripts: x.scripts.filter((s) => s.dur >= 10) })),
  };
})()`;

/** Fait défiler la file jusqu'à rendre la ligne `id` visible (liste virtualisée), puis rend vrai. */
const SCROLL_TO = (index) => `(async () => {
  const ql = document.getElementById("ql");
  const row = ql.querySelector(".qi[data-id]");
  const h = row ? row.getBoundingClientRect().height : 34;
  ql.scrollTop = Math.max(0, ${index} * h - ql.clientHeight / 2);
  ql.dispatchEvent(new Event("scroll"));
  await new Promise((r) => setTimeout(r, 250));
  return [...ql.querySelectorAll(".qi[data-id]")].map((e) => Number(e.dataset.id));
})()`;

async function modeOpen() {
  const n = Number(opt("n", "24"));
  const s = await connect(PORT);
  const title = await assertSift(s);
  await reloadOn(s, "revue");
  // Ordre de la file tel que la page le tient : les lignes visibles après défilement le disent.
  const queue = await s.evaluate(
    `window.__TAURI_INTERNALS__.invoke("list_queue").then((q) => q.map((x) => ({ id: x.id, path: x.path, verdict: x.verdict })))`,
  );
  const ext = (p) => p.split(".").pop().toLowerCase();
  const byId = new Map(queue.map((q) => [q.id, q]));
  // Quotas par format : la bibliothèque est surtout AIFF ; on force la variété.
  const quota = { aiff: 6, aif: 5, mp3: 5, flac: 4, wav: 3, m4a: 1, ogg: 1 };
  const results = [];
  const used = new Set();
  const total = queue.length;
  let probe = 0;
  while (results.length < n && probe < 400) {
    const index = Math.floor(((probe * 0.6180339887) % 1) * total);
    probe++;
    const visible = await s.evaluate(SCROLL_TO(index));
    const cand = visible.find((id) => {
      const q = byId.get(id);
      if (!q || used.has(id) || used.has(id - 1) || used.has(id + 1)) return false;
      const e = ext(q.path);
      return (quota[e] ?? 0) > 0;
    });
    if (cand == null) continue;
    const q = byId.get(cand);
    quota[ext(q.path)]--;
    used.add(cand);
    const r = await s.evaluate(OPEN(cand));
    r.ext = ext(q.path);
    r.verdictKind = q.verdict;
    results.push(r);
    process.stderr.write(
      `${String(results.length).padStart(2)} ${r.ext.padEnd(4)} total ${r.total?.toFixed(0).padStart(6)} ms` +
        `  analyze_path ${r.analyzePath?.dur?.toFixed(0).padStart(5)}  boîte ${r.boxRender?.toFixed(0).padStart(4)}` +
        `  canplay ${r.media?.canplay?.toFixed(0).padStart(5)}\n`,
    );
    await sleep(400);
  }
  // Ouvertures « piste suivante » : la ligne juste sous la dernière ouverte a été préchargée.
  const next = [];
  for (const r of results.slice(0, 6)) {
    await s.evaluate(SCROLL_TO(queue.findIndex((q) => q.id === r.id)));
    await s.evaluate(OPEN(r.id));
    await sleep(1500);
    const visible = await s.evaluate(`[...document.querySelectorAll("#ql .qi[data-id]")].map((e) => Number(e.dataset.id))`);
    const i = visible.indexOf(r.id);
    if (i < 0 || i + 1 >= visible.length) continue;
    const nx = await s.evaluate(OPEN(visible[i + 1]));
    nx.ext = ext(byId.get(visible[i + 1])?.path ?? "");
    next.push(nx);
    await sleep(400);
  }
  // Toutes les commandes de la session, y compris celles lancées APRÈS qu'une ouverture a rendu
  // la main (préchargement de la piste suivante) : la corrélation avec la sonde en a besoin.
  const allCmds = await s.evaluate(
    `window.__perf.inv.map((e) => ({ cmd: e.cmd, a: performance.timeOrigin + e.t0, b: e.t1 == null ? null : performance.timeOrigin + e.t1 }))`,
  );
  s.close();
  return { mode: "open", title, results, next, allCmds };
}

// ---------------------------------------------------------------------------------------------
// 3. Gels de la fenêtre
// ---------------------------------------------------------------------------------------------

const FREEZE = (seconds) => `(async () => {
  const P = window.__perf;
  const i0 = P.inv.length, l0 = P.loaf.length;
  const t0 = performance.now();
  const lags = [], pings = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (now - last > 150) lags.push({ at: last - t0, lag: now - last - 50 });
    last = now;
  }, 50);
  let stop = false;
  const pinger = (async () => {
    while (!stop) {
      const a = performance.now();
      await window.__TAURI_INTERNALS__.invoke("get_setting", { key: "ui_lang" });
      const d = performance.now() - a;
      pings.push(d);
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  await new Promise((r) => setTimeout(r, ${seconds} * 1000));
  stop = true;
  clearInterval(timer);
  await pinger;
  const inv = P.inv.slice(i0);
  const overlap = (a, b) => inv.filter((e) => e.cmd !== "get_setting" && e.t0 <= b && (e.t1 ?? Infinity) >= a)
    .map((e) => ({ cmd: e.cmd, start: e.t0 - t0, dur: e.t1 == null ? null : e.t1 - e.t0 }));
  const loaf = P.loaf.slice(l0).filter((x) => x.dur > 100).map((x) => ({
    at: x.t0 - t0, dur: x.dur, block: x.block, render: x.render,
    scripts: x.scripts.filter((s) => s.dur >= 10), during: overlap(x.t0, x.t0 + x.dur),
  }));
  const sorted = [...pings].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const counts = {};
  for (const e of inv) counts[e.cmd] = (counts[e.cmd] || 0) + 1;
  const slowCmds = inv.filter((e) => e.t1 != null && e.t1 - e.t0 > 100 && e.cmd !== "get_setting")
    .map((e) => ({ cmd: e.cmd, at: e.t0 - t0, dur: e.t1 - e.t0 }));
  return {
    seconds: ${seconds},
    origin: performance.timeOrigin + t0,
    longFrames: loaf,
    timerLags: lags.filter((l) => l.lag > 100),
    ping: { n: pings.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1), over100: pings.filter((d) => d > 100).length },
    cmdCounts: counts,
    slowCmds,
    allCmds: inv.map((e) => ({ cmd: e.cmd, a: performance.timeOrigin + e.t0, b: e.t1 == null ? null : performance.timeOrigin + e.t1 })),
  };
})()`;

async function modeFreeze() {
  const seconds = Number(opt("seconds", "120"));
  const view = opt("view", "revue");
  const s = await connect(PORT);
  const title = await assertSift(s);
  await reloadOn(s, view);
  const t = Date.now();
  const r = await s.evaluate(FREEZE(seconds), { timeoutMs: (seconds + 60) * 1000 });
  const progress = await s.evaluate(`window.__TAURI_INTERNALS__.invoke("analysis_progress").catch((e) => String(e))`);
  s.close();
  return { mode: "freeze", title, view, startedAt: t, progressAtEnd: progress, ...r };
}

// ---------------------------------------------------------------------------------------------
// 4. Démarrage d'un build release
// ---------------------------------------------------------------------------------------------

/** Instant (horloge murale, ms) où une fenêtre du PID reçu sur l'entrée devient visible, lu par
 *  user32 dans un PowerShell compagnon qui sonde toutes les 2 ms, puis les blocages du fil de la
 *  fenêtre pendant les 4 s qui suivent. */
function watchWindow() {
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  public static IntPtr Visible(uint target) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == target && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$now = { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
[void][W]::Visible(0)
[Console]::Out.WriteLine("ready"); [Console]::Out.Flush()
$target = [uint32][Console]::In.ReadLine()
$deadline = (& $now) + 30000
$h = [IntPtr]::Zero
while ((& $now) -lt $deadline) { $h = [W]::Visible($target); if ($h -ne [IntPtr]::Zero) { break }; Start-Sleep -Milliseconds 2 }
if ($h -eq [IntPtr]::Zero) { "timeout"; exit 0 }
$visible = & $now
# Fil de la fenêtre après l'apparition : WM_NULL toutes les 10 ms pendant 4 s, chaque réponse
# lente notée. Révèle le travail de démarrage fait sur le fil de la fenêtre une fois visible.
$sw = [System.Diagnostics.Stopwatch]::new(); $blocks = @(); $end = $visible + 4000
while ((& $now) -lt $end) {
  $at = & $now; $sw.Restart(); $r = [IntPtr]::Zero
  [void][W]::SendMessageTimeout($h, 0, [IntPtr]::Zero, [IntPtr]::Zero, 0, 10000, [ref]$r)
  $ms = $sw.Elapsed.TotalMilliseconds
  if ($ms -gt 50) { $blocks += '{"at":' + $at + ',"ms":' + [math]::Round($ms) + '}' }
  Start-Sleep -Milliseconds 10
}
'{"visible":' + $visible + ',"blocks":[' + ($blocks -join ',') + ']}'`;
  // Le compagnon compile son Add-Type AVANT le lancement de l'app, dit « ready », puis attend le
  // PID sur son entrée : son temps de démarrage ne peut pas retarder la détection de la fenêtre.
  const p = spawn("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: ["pipe", "pipe", "inherit"] });
  let out = "";
  let onReady;
  const ready = new Promise((r) => (onReady = r));
  p.stdout.on("data", (d) => {
    out += d;
    if (out.includes("ready")) onReady();
  });
  const done = new Promise((resolve) =>
    p.on("close", () => {
      const json = out.replace(/^[\s\S]*?ready\s*/, "").trim();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ error: json });
      }
    }),
  );
  return { ready, sendPid: (pid) => p.stdin.end(`${pid}\n`), done };
}

async function modeStartup() {
  const exe = opt("exe", null);
  if (!exe) throw new Error("--exe <chemin du sift.exe release> manquant");
  const runs = Number(opt("runs", "5"));
  const out = [];
  for (let k = 0; k < runs; k++) {
    const watcher = watchWindow();
    await watcher.ready;
    const tLaunch = Date.now();
    const app = spawn(exe, [], {
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
      stdio: "ignore",
    });
    watcher.sendPid(app.pid);
    const visibleP = watcher.done;
    const s = await connect(PORT, { waitMs: 30000 });
    const tAttach = Date.now();
    // Les commandes du démarrage se lisent dans le Resource Timing (`fetch` vers `ipc.localhost`) :
    // un script posé par `Page.addScriptToEvaluateOnNewDocument` n'atteint pas le document de
    // l'app release (vérifié : rien n'y est exécuté), l'instrumentation ne peut pas les voir.
    // Utilisable : la file de Revue a des lignes ET un invoke témoin revient en moins de 100 ms.
    // La première page vue est souvent `about:blank` : sa navigation détruit le contexte, on
    // recommence alors sur le document suivant.
    const USABLE = `(async () => {
      for (;;) {
        if (document.readyState !== "loading" && document.querySelector("#ql .qi[data-id]")) {
          const a = performance.now();
          await window.__TAURI_INTERNALS__.invoke("get_setting", { key: "ui_lang" });
          if (performance.now() - a < 100) break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      const nav = performance.getEntriesByType("navigation")[0];
      const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, p.startTime]));
      return { origin: performance.timeOrigin, usable: performance.now(), dcl: nav?.domContentLoadedEventEnd,
        load: nav?.loadEventEnd, fp: paint["first-paint"], fcp: paint["first-contentful-paint"], title: document.title,
        cmds: performance.getEntriesByType("resource").filter((e) => /^https?:\\/\\/ipc\\.localhost\\//.test(e.name))
          .map((e) => ({ cmd: decodeURIComponent(new URL(e.name).pathname.slice(1)), a: performance.timeOrigin + e.startTime, b: performance.timeOrigin + e.responseEnd })) };
    })()`;
    let usable = null;
    for (let tries = 0; !usable && tries < 200; tries++) {
      try {
        const href = await s.evaluate("location.href");
        if (!href.startsWith("http")) throw new Error("page de démarrage");
        usable = await s.evaluate(USABLE, { timeoutMs: 60000 });
      } catch {
        // Même session : la fermer perdrait le script posé pour le document suivant.
        await sleep(20);
      }
    }
    if (!usable) throw new Error("fenêtre jamais utilisable");
    const win = await visibleP;
    const visibleAt = Number(win.visible);
    const rel = (x) => (x == null ? null : Math.round(x));
    const r = {
      run: k,
      title: usable.title,
      windowVisible: Number.isFinite(visibleAt) ? visibleAt - tLaunch : win,
      windowThreadBlocks: (win.blocks ?? []).map((b) => ({
        at: b.at - tLaunch,
        ms: b.ms,
        during: [...new Set(usable.cmds.filter((c) => c.a <= b.at + b.ms && (c.b ?? Infinity) >= b.at).map((c) => c.cmd))],
      })),
      bootCmds: usable.cmds.map((c) => ({ cmd: c.cmd, start: Math.round(c.a - tLaunch), dur: c.b == null ? null : Math.round(c.b - c.a) })),
      webviewOrigin: rel(usable.origin - tLaunch),
      firstPaint: rel(usable.origin + usable.fp - tLaunch),
      firstContentfulPaint: rel(usable.origin + usable.fcp - tLaunch),
      domContentLoaded: rel(usable.origin + usable.dcl - tLaunch),
      usable: rel(usable.origin + usable.usable - tLaunch),
      cdpAttached: tAttach - tLaunch,
    };
    r.ghostMs = Number.isFinite(visibleAt) && r.firstContentfulPaint != null ? r.firstContentfulPaint - r.windowVisible : null;
    out.push(r);
    process.stderr.write(JSON.stringify(r) + "\n");
    s.close();
    // Arrêt par le PID de NOTRE processus, jamais par nom d'image.
    spawn("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    await sleep(4000);
  }
  return { mode: "startup", exe, runs: out };
}

// ---------------------------------------------------------------------------------------------
// Coût propre des commandes : chacune SEULE, l'app au repos, en série. Sépare ce qu'une
// commande coûte de ce qu'elle attend derrière les autres pendant une navigation.
// ---------------------------------------------------------------------------------------------

const CMDS = (reps) => `(async () => {
  const P = window.__perf;
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  const q = await inv("list_queue");
  const t = q.find((x) => x.verdict) ?? q[0];
  const calls = [
    ["list_queue", {}], ["list_ecartes", {}], ["list_removable_drives", {}], ["list_sources", {}],
    ["rekordbox_status", {}], ["list_duplicate_groups", {}], ["list_bins", {}],
    ["list_library", {}], ["find_duplicate", { trackId: t.id }], ["reconcile", { trackId: t.id }],
    ["track_release", { trackId: t.id }], ["track_file_tags", { trackId: t.id }],
    ["playback_url", { path: t.path }],
    ["analyze_path", { path: t.path, withSpectrogram: false, allowForget: false, grid: null }],
    ["get_setting", { key: "ui_lang" }], ["analysis_progress", {}],
  ];
  const out = {};
  for (let k = 0; k < ${reps}; k++)
    for (const [c, a] of calls) {
      const t0 = performance.now();
      let ok = true;
      try { await inv(c, a); } catch { ok = false; }
      (out[c] ??= []).push({ ms: performance.now() - t0, ok, at: performance.timeOrigin + t0 });
      await new Promise((r) => setTimeout(r, 50));
    }
  return { trackId: t.id, ext: t.path.split(".").pop(), queueLength: q.length, out };
})()`;

async function modeCmds() {
  const reps = Number(opt("reps", "5"));
  const s = await connect(PORT);
  const title = await assertSift(s);
  await reloadOn(s, "journal");
  const r = await s.evaluate(CMDS(reps), { timeoutMs: 600000 });
  s.close();
  return { mode: "cmds", title, reps, ...r };
}

const modes = { rail: modeRail, open: modeOpen, freeze: modeFreeze, startup: modeStartup, cmds: modeCmds };
if (!modes[mode]) {
  console.error("usage : node scripts/perf-baseline.mjs rail|open|freeze|startup --port <cdp> …");
  process.exit(2);
}
const result = await modes[mode]();
const json = JSON.stringify(result, null, 1);
if (OUT) writeFileSync(OUT, json);
else console.log(json);
