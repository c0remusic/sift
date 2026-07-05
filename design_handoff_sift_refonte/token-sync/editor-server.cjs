// Local dev server for the token editor UI. No external dependencies (built-in http only).
// v3: frontend/styles.css IS the canonical token store — /tokens.json parses it on every
// request, and /validate writes it directly (via styles-css.cjs) then propagates to the
// two push targets (Sift.dc.html, DESIGN.md) and reports exactly what changed.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const stylesCss = require("./styles-css.cjs");

const tokenDir = __dirname;
const editorHtmlPath = path.join(tokenDir, "editor.html");
const mockupHtmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const supportJsPath = path.join(tokenDir, "..", "support.js");

const { locate } = require("./locate.cjs");
const generateThemeHtml = require("./generate-theme-html.cjs");
const generateDesignMd = require("./generate-design-md.cjs");

const PORT = 4756;

// Holds the browser's current unsaved edits (from the color/static form) so /preview.html
// can reflect them before "Valider" is ever clicked. Lost on server restart — that's fine,
// it's just a live-preview aid, not a persistence layer (styles.css is that).
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

function validateTokensShape(tokens) {
  if (!tokens || typeof tokens !== "object") {
    throw new Error("expected a JSON object with { colors, static }");
  }
  if (!tokens.colors || typeof tokens.colors !== "object") {
    throw new Error("expected tokens.colors to be an object");
  }
  for (const [key, value] of Object.entries(tokens.colors)) {
    if (!value || typeof value !== "object" || typeof value.light !== "string" || typeof value.dark !== "string") {
      throw new Error(`tokens.colors["${key}"] must be { light: string, dark: string }, got ${JSON.stringify(value)}`);
    }
  }
  if (!tokens.static || typeof tokens.static !== "object") {
    throw new Error("expected tokens.static to be an object");
  }
  for (const [key, value] of Object.entries(tokens.static)) {
    if (typeof value !== "string") {
      throw new Error(`tokens.static["${key}"] must be a string, got ${JSON.stringify(value)}`);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, fs.readFileSync(editorHtmlPath, "utf8"), "text/html");
      return;
    }

    if (req.method === "GET" && url.pathname === "/tokens.json") {
      sendJson(res, 200, stylesCss.parse());
      return;
    }

    if (req.method === "GET" && url.pathname === "/frontend-styles.css") {
      send(res, 200, stylesCss.readStyles(), "text/css");
      return;
    }

    if (req.method === "GET" && url.pathname === "/support.js") {
      send(res, 200, fs.readFileSync(supportJsPath, "utf8"), "text/javascript");
      return;
    }

    if (req.method === "POST" && url.pathname === "/preview-tokens") {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      validateTokensShape(parsed);
      pendingTokens = parsed;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/preview.html") {
      const aliasMap = stylesCss.loadAliasMap();
      const mockup = fs.readFileSync(mockupHtmlPath, "utf8");
      // pendingTokens (unsaved browser edits) already has the exact client shape
      // transform() consumes; otherwise reflect styles.css as it currently is.
      const tokens = pendingTokens || stylesCss.parse();
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
      validateTokensShape(edited);

      const results = {
        stylesCss: stylesCss.write(edited),
        themeHtml: generateThemeHtml.run({ write: true }),
        designMd: generateDesignMd.run({ write: true }),
      };

      // Consumer lookup only makes sense for production token names (the way
      // frontend/ code spells them) — styles.css's changedKeys are exactly that.
      const consumers = {};
      for (const key of results.stylesCss.changedKeys) {
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
