// Shared primitive: find where an identifier (CSS custom property name, or a CSS
// class/id selector) is actually used in the real frontend code, with context.
// Plain text search + line context — no AST, no CSS parser. Good enough for pointing,
// not a guaranteed source-map. Used by editor-server.cjs (token consumers) and, in spirit,
// by the real-app inspector (same responsibility, reimplemented in Rust there since that
// one runs inside the compiled Tauri app, not in a Node process).
const fs = require("fs");
const path = require("path");

const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");
const EXTENSIONS = [".ts", ".css"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function locate(identifier, { contextLines = 1 } = {}) {
  const files = walk(FRONTEND_DIR);
  const matches = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes(identifier)) return;
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length - 1, i + contextLines);
      matches.push({
        file: path.relative(path.join(__dirname, "..", ".."), file).replace(/\\/g, "/"),
        line: i + 1,
        excerpt: lines.slice(start, end + 1).join("\n"),
      });
    });
  }
  return matches;
}

module.exports = { locate };

if (require.main === module) {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error("Usage: node locate.cjs <identifier>");
    process.exit(1);
  }
  const results = locate(identifier);
  if (results.length === 0) {
    console.log(`No occurrences of "${identifier}" found in frontend/.`);
  }
  for (const r of results) {
    console.log(`\n${r.file}:${r.line}`);
    console.log(r.excerpt);
  }
}
