// CLI entry point for Claude (or anyone scripting this): propagates the tokens of
// frontend/styles.css (THE canonical store, v3) to the two push targets — Sift.dc.html's
// theme() literals and DESIGN.md's palette bullets — then shows where each changed token
// actually lands in the real frontend code. Edit styles.css directly (by hand or via the
// editor UI), then run this. Dry-run by default; --write to persist.
const stylesCss = require("./styles-css.cjs");
const generateThemeHtml = require("./generate-theme-html.cjs");
const generateDesignMd = require("./generate-design-md.cjs");
const { locate } = require("./locate.cjs");

const write = process.argv.includes("--write");

const results = {
  "Maquette (Sift.dc.html)": generateThemeHtml.run({ write }),
  "Documentation (DESIGN.md)": generateDesignMd.run({ write }),
};

for (const [name, result] of Object.entries(results)) {
  if (result.noOp) {
    console.log(`✓ ${name} — déjà à jour`);
  } else {
    console.log(`✎ ${name} — ${write ? "modifié" : "à modifier (dry-run)"}: ${result.changedKeys.join(", ")}`);
  }
}

// Consumer lookup only makes sense for keys named the way frontend/ code actually spells
// them (production names, e.g. "--color-nav-active"). The generators' changedKeys are
// legacy theme() names (e.g. "navActive") — map them back through alias-map.json.
const aliasMap = stylesCss.loadAliasMap();
const changedProdKeys = new Set();
for (const result of Object.values(results)) {
  for (const legacyKey of result.changedKeys) {
    // "ctaBg/ctaText" is DESIGN.md's combined CTA bullet key — split it.
    for (const part of legacyKey.split("/")) {
      const prodKey = aliasMap[part];
      if (prodKey) changedProdKeys.add(prodKey);
    }
  }
}

if (!write && changedProdKeys.size > 0) {
  console.log("\nDry run only — relance avec --write pour appliquer réellement.");
  process.exit(0);
}

if (changedProdKeys.size > 0) {
  console.log("\nConsommateurs réels (frontend/) pour les clés modifiées :");
  for (const key of changedProdKeys) {
    const matches = locate(key).slice(0, 5);
    console.log(`\n  ${key}`);
    if (matches.length === 0) console.log("    (aucun trouvé)");
    for (const m of matches) console.log(`    ${m.file}:${m.line}`);
  }
}
