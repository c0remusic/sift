// Local dev server for the token editor UI. No external dependencies (built-in http only).
// Serves editor.html, proxies the real frontend/styles.css for live preview fidelity, exposes
// /locate for "where is this token consumed", and /validate which writes design-tokens.json
// then runs the 3 push generators (--write) and reports exactly what changed.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const tokenDir = __dirname;
const tokensPath = path.join(tokenDir, "design-tokens.json");
const aliasPath = path.join(tokenDir, "alias-map.json");
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const editorHtmlPath = path.join(tokenDir, "editor.html");
const mockupHtmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const supportJsPath = path.join(tokenDir, "..", "support.js");

const { locate } = require("./locate.cjs");
const generateStylesCss = require("./generate-styles-css.cjs");
const generateThemeHtml = require("./generate-theme-html.cjs");
const generateDesignMd = require("./generate-design-md.cjs");

const PORT = 4756;

// Holds the browser's current unsaved edits (from the color/static form) so /preview.html
// can reflect them before "Valider" is ever clicked. Lost on server restart — that's fine,
// it's just a live-preview aid, not a persistence layer (design-tokens.json is that).
let pendingTokens = null;

function send(res, status, body, contentType) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), "application/json");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, fs.readFileSync(editorHtmlPath, "utf8"), "text/html");
      return;
    }

    if (req.method === "GET" && url.pathname === "/tokens.json") {
      send(res, 200, fs.readFileSync(tokensPath, "utf8"), "application/json");
      return;
    }

    if (req.method === "GET" && url.pathname === "/frontend-styles.css") {
      send(res, 200, fs.readFileSync(stylesPath, "utf8"), "text/css");
      return;
    }

    if (req.method === "GET" && url.pathname === "/support.js") {
      send(res, 200, fs.readFileSync(supportJsPath, "utf8"), "text/javascript");
      return;
    }

    if (req.method === "POST" && url.pathname === "/preview-tokens") {
      const body = await readBody(req);
      pendingTokens = JSON.parse(body);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/preview.html") {
      const tokens = pendingTokens || JSON.parse(fs.readFileSync(tokensPath, "utf8"));
      const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
      const mockup = fs.readFileSync(mockupHtmlPath, "utf8");
      const { html } = generateThemeHtml.transform(mockup, tokens, aliasMap);
      send(res, 200, html, "text/html");
      return;
    }

    if (req.method === "GET" && url.pathname === "/locate") {
      const id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "missing ?id=" });
      return sendJson(res, 200, { matches: locate(id) });
    }

    if (req.method === "POST" && url.pathname === "/validate") {
      const body = await readBody(req);
      const edited = JSON.parse(body);
      if (!edited.colors || !edited.static) {
        return sendJson(res, 400, { error: "expected { colors, static }" });
      }
      fs.writeFileSync(tokensPath, JSON.stringify(edited, null, 2), "utf8");

      const results = {
        stylesCss: generateStylesCss.run({ write: true }),
        themeHtml: generateThemeHtml.run({ write: true }),
        designMd: generateDesignMd.run({ write: true }),
      };

      const allChanged = new Set([
        ...results.stylesCss.changedKeys,
        ...results.themeHtml.changedKeys,
      ]);
      const consumers = {};
      for (const key of allChanged) {
        consumers[key] = locate(key).slice(0, 5);
      }

      return sendJson(res, 200, { results, consumers });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Token editor running at http://localhost:${PORT}`);
});
