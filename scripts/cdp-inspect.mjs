#!/usr/bin/env node
// Inspect the real running `tauri dev` window via Chrome DevTools Protocol — the
// gated `inTauri` code (sift-live.ts, filing.ts, report-view.ts, etc.) never runs
// in a plain browser preview, so this is the way to verify it live instead of
// guessing from a screenshot or a description. See CLAUDE.md "Vérification UI" /
// memory `sift-cdp-webview2-verification` for the full story.
//
// Prerequisite: tauri dev must be launched with the debug port open, e.g.
//   cmd /c "set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 && npm run tauri dev"
//
// Usage:
//   node scripts/cdp-inspect.mjs "document.title"                  # eval + print result
//   node scripts/cdp-inspect.mjs --screenshot out.png              # screenshot only
//   node scripts/cdp-inspect.mjs --reload "document.title"         # full reload first
//   node scripts/cdp-inspect.mjs --port 9222 "1+1"                 # explicit port
//
// The expression runs inside an IIFE via Runtime.evaluate with returnByValue —
// return a JSON-serializable value (or JSON.stringify(...) it yourself for
// nested objects/arrays if you need guaranteed shape).

const args = process.argv.slice(2);
let port = 9222;
let reload = false;
let screenshotPath = null;
let expression = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = Number(args[++i]);
  } else if (args[i] === "--reload") {
    reload = true;
  } else if (args[i] === "--screenshot") {
    screenshotPath = args[++i];
  } else {
    expression = args[i];
  }
}

if (!expression && !screenshotPath) {
  console.error(
    'Usage: node scripts/cdp-inspect.mjs [--port 9222] [--reload] [--screenshot out.png] "<js expression>"',
  );
  process.exit(1);
}

async function main() {
  const listRes = await fetch(`http://localhost:${port}/json`);
  const targets = await listRes.json();
  const target = targets.find((t) => t.url.includes("localhost:5173")) || targets[0];
  if (!target) {
    console.error("No CDP target found — is tauri dev running with the debug port open?");
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  function send(method, params) {
    return new Promise((resolve) => {
      const myId = id++;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  await send("Runtime.enable", {});
  await send("Page.enable", {});

  if (reload) {
    await send("Page.reload", { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (expression) {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (res.exceptionDetails) {
      console.error(res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails));
      process.exitCode = 1;
    } else {
      console.log(typeof res.result.value === "string" ? res.result.value : JSON.stringify(res.result.value));
    }
  }

  if (screenshotPath) {
    const { writeFileSync } = await import("node:fs");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
    console.error(`Screenshot saved: ${screenshotPath}`);
  }

  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
