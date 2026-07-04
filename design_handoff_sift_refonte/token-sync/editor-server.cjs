// Local dev server for the token editor UI. No external dependencies (built-in http only).
// Serves editor.html, proxies the real frontend/styles.css for live preview fidelity, exposes
// /locate for "where is this token consumed", and /validate which writes design-tokens.json
// then runs the 3 push generators (--write) and reports exactly what changed.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { loadCanonical, resolveTheme, hexToComponents, parseColorValue, cssColorLiteral, loadAliasMap } = require("./sync-core.cjs");

const tokenDir = __dirname;
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const editorHtmlPath = path.join(tokenDir, "editor.html");
const mockupHtmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const supportJsPath = path.join(tokenDir, "..", "support.js");

const { locate } = require("./locate.cjs");
const generateStylesCss = require("./generate-styles-css.cjs");
const generateThemeHtml = require("./generate-theme-html.cjs");
const generateDesignMd = require("./generate-design-md.cjs");

const GROUP_TO_PREFIX = { radius: "--border-radius-", shadow: "--shadow-", font: "--font-", text: "--text-", space: "--space-", height: "--h-" };
function colorProdKey(dtcgPath) {
  const prefix = (dtcgPath.startsWith("hover") || dtcgPath.startsWith("selected") || dtcgPath.startsWith("bar") || dtcgPath.startsWith("badge")) ? "--overlay-" : "--color-";
  return `${prefix}${dtcgPath}`;
}

// DTCG (2 files) -> the simple {colors, static} shape editor.html has always used.
function toClientShape() {
  const { light, dark } = loadCanonical();
  const resolvedDark = resolveTheme(light, dark, "dark");
  const colors = {};
  for (const [p, entry] of Object.entries(light.color)) {
    colors[colorProdKey(p)] = { light: cssColorLiteral(entry), dark: cssColorLiteral(resolvedDark.color[p]) };
  }
  const static_ = {};
  for (const [group, entries] of Object.entries(light)) {
    if (group === "color") continue;
    for (const [name, entry] of Object.entries(entries)) {
      const value = entry.$type === "dimension" ? `${entry.$value.value}${entry.$value.unit}` : entry.$value;
      static_[`${GROUP_TO_PREFIX[group]}${name}`] = value;
    }
  }
  return { colors, static: static_ };
}

// The simple {colors, static} shape (from the browser) -> writes both DTCG
// files, applying the hex-is-authoritative rule and the dark.json pruning rule.
function fromClientShape(clientTokens) {
  const { light, dark } = loadCanonical(); // preserves $type and any fields we don't touch
  for (const [prodKey, { light: lightHex, dark: darkHex }] of Object.entries(clientTokens.colors)) {
    const p = prodKey.replace(/^--(color|overlay)-/, "");
    light.color[p] = parseColorValue(lightHex);
    if (darkHex === lightHex) {
      delete dark.color[p]; // pruning: no longer diverges, don't keep a redundant override
    } else {
      dark.color[p] = parseColorValue(darkHex);
    }
  }
  for (const [prodKey, value] of Object.entries(clientTokens.static)) {
    for (const [group, prefix] of Object.entries(GROUP_TO_PREFIX)) {
      if (prodKey.startsWith(prefix)) {
        const name = prodKey.slice(prefix.length);
        const isDimension = light[group][name].$type === "dimension";
        light[group][name].$value = isDimension ? { value: parseFloat(value), unit: value.replace(/[\d.]+/, "") } : value;
        break;
      }
    }
  }
  fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
  fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
}

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
      sendJson(res, 200, toClientShape());
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
      const parsed = JSON.parse(body);
      validateTokensShape(parsed);
      pendingTokens = parsed;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/preview.html") {
      const aliasMap = loadAliasMap();
      const mockup = fs.readFileSync(mockupHtmlPath, "utf8");
      let resolvedLight, resolvedDark;
      if (pendingTokens) {
        // Build ephemeral DTCG trees from the in-memory client-shape edits, without
        // touching disk (matches the existing "never writes to disk" preview contract).
        const { light, dark } = loadCanonical();
        for (const [prodKey, { light: lightHex, dark: darkHex }] of Object.entries(pendingTokens.colors)) {
          const p = prodKey.replace(/^--(color|overlay)-/, "");
          light.color[p] = parseColorValue(lightHex);
          if (darkHex === lightHex) delete dark.color[p];
          else dark.color[p] = parseColorValue(darkHex);
        }
        resolvedLight = resolveTheme(light, dark, "light");
        resolvedDark = resolveTheme(light, dark, "dark");
      } else {
        const { light, dark } = loadCanonical();
        resolvedLight = resolveTheme(light, dark, "light");
        resolvedDark = resolveTheme(light, dark, "dark");
      }
      const { html } = generateThemeHtml.transform(mockup, resolvedLight, resolvedDark, aliasMap);
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
      fromClientShape(edited);

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
