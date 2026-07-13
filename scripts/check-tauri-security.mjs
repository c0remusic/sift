import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const security = config.app?.security ?? {};
const scope = security.assetProtocol?.scope ?? [];
const csp = security.csp ?? "";
const scriptSrc = csp
  .split(";")
  .map((directive) => directive.trim())
  .find((directive) => directive.startsWith("script-src ")) ?? "";

assert.ok(!scope.includes("**"), "asset protocol must not expose the whole filesystem");
assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src must not allow unsafe-inline");
assert.ok(!scriptSrc.includes("'unsafe-eval'"), "script-src must not allow unsafe-eval");

console.log("Tauri asset scope and script CSP are restricted");
