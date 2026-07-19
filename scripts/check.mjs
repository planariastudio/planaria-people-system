// Syntax gate for the whole repo. Run by CI and locally via `npm run check`.
//
// Why this exists: `node --check worker/index.js` FALSELY PASSES on this file
// because it is an ES module (top-level import/export) and plain --check misreads
// it. That gap let a real syntax error reach production once (the 2026-07-17
// broken-.join() incident). The reliable check is `--input-type=module --check`
// fed over stdin, which is what this script does for the worker.
//
// Categories:
//   - worker/index.js        -> ESM check via stdin (the reliable path)
//   - kpi_card.js/peer_card.js -> classic scripts (IIFE), plain --check
//   - *.html inline <script>  -> classic scripts, extracted and plain --check
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const node = process.execPath;
let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m, detail) => { failures++; console.log("FAIL   " + m + (detail ? "\n" + detail : "")); };

// 1. Worker — ESM syntax check over stdin (the check that actually catches errors here).
{
  const src = readFileSync("worker/index.js", "utf8");
  const r = spawnSync(node, ["--input-type=module", "--check"], { input: src, encoding: "utf8" });
  r.status === 0 ? ok("worker/index.js (ESM)") : fail("worker/index.js (ESM)", (r.stderr || "").slice(0, 500));
}

// 2. Shared browser modules — classic scripts, plain --check is reliable (no import/export).
for (const f of ["kpi_card.js", "peer_card.js"]) {
  const r = spawnSync(node, ["--check", f], { encoding: "utf8" });
  r.status === 0 ? ok(f) : fail(f, (r.stderr || "").slice(0, 500));
}

// 3. Every page's inline scripts — extract non-src <script> blocks, check as one classic script.
const tmp = mkdtempSync(join(tmpdir(), "pps-check-"));
for (const f of readdirSync(".").filter((n) => n.endsWith(".html")).sort()) {
  const html = readFileSync(f, "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) { ok(f + " (no inline script)"); continue; }
  const out = join(tmp, f.replace(/[^\w.-]/g, "_") + ".js");
  writeFileSync(out, blocks.join("\n;\n"));
  const r = spawnSync(node, ["--check", out], { encoding: "utf8" });
  r.status === 0 ? ok(f) : fail(f, (r.stderr || "").slice(0, 500));
}

console.log(failures ? `\n${failures} FILE(S) FAILED SYNTAX CHECK` : "\nAll files pass syntax check.");
process.exit(failures ? 1 : 0);
