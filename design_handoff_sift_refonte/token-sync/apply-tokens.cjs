// CLI entry point for Claude (or anyone scripting this): does exactly what the editor UI's
// "Valider" button does, without a browser or a running server. Edit design-tokens.json
// directly (by hand or via Edit), then run this to propagate + see where it lands.
const generateStylesCss = require("./generate-styles-css.cjs");
const generateThemeHtml = require("./generate-theme-html.cjs");
const generateDesignMd = require("./generate-design-md.cjs");
const { locate } = require("./locate.cjs");

const write = process.argv.includes("--write");

const results = {
  "Sift (styles.css)": generateStylesCss.run({ write }),
  "Maquette (Sift.dc.html)": generateThemeHtml.run({ write }),
  "Documentation (DESIGN.md)": generateDesignMd.run({ write }),
};

// Consumer lookup only makes sense for keys named the way frontend/ code actually spells
// them (production names, e.g. "--color-nav-active") — styles.css's changedKeys are always
// production names; theme.html's and DESIGN.md's are legacy names (e.g. "navActive") that
// never appear literally in frontend/*.ts, so including them here would just print noise.
const allChanged = new Set(results["Sift (styles.css)"].changedKeys);
for (const [name, result] of Object.entries(results)) {
  if (result.noOp) {
    console.log(`✓ ${name} — déjà à jour`);
  } else {
    console.log(`✎ ${name} — ${write ? "modifié" : "à modifier (dry-run)"}: ${result.changedKeys.join(", ")}`);
  }
}

if (!write && allChanged.size > 0) {
  console.log("\nDry run only — relance avec --write pour appliquer réellement.");
  process.exit(0);
}

if (allChanged.size > 0) {
  console.log("\nConsommateurs réels (frontend/) pour les clés modifiées :");
  for (const key of allChanged) {
    const matches = locate(key).slice(0, 5);
    console.log(`\n  ${key}`);
    if (matches.length === 0) console.log("    (aucun trouvé)");
    for (const m of matches) console.log(`    ${m.file}:${m.line}`);
  }
}
