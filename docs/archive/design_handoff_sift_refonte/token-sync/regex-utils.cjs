// Shared by every generator/pull script that builds a RegExp from a runtime string
// (a token name or legacy key) — one escaping implementation instead of N copies.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { escapeRegex };
