#!/usr/bin/env node
/**
 * First-load JavaScript per page, gzipped, against budgets (GitLab #97).
 * Run after `npm run build`:
 *
 *   node scripts/bundle-report.mjs            table, exits 1 if a page is over budget
 *   node scripts/bundle-report.mjs --json     the same as JSON, for CI artifacts
 *
 * Reads Next's own per-route list of first-load chunks
 * (.next/diagnostics/route-bundle-stats.json) and gzips each chunk once, as
 * a browser receives it. Budgets are in bundle-budgets.json: a default and
 * per-route overrides, in KiB. Raise one only on purpose, in the same merge
 * request as the code that needs it.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const stats = JSON.parse(readFileSync(".next/diagnostics/route-bundle-stats.json", "utf8"));
const budgets = JSON.parse(readFileSync("bundle-budgets.json", "utf8"));

const gzipped = new Map();
const gzipSize = (path) => {
  if (!gzipped.has(path)) gzipped.set(path, gzipSync(readFileSync(path)).length);
  return gzipped.get(path);
};
const kib = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const rows = stats
  .map((route) => {
    const gzip = route.firstLoadChunkPaths.reduce((sum, path) => sum + gzipSize(path), 0);
    const budget = budgets.routes[route.route] ?? budgets.default;
    return { route: route.route, kib: kib(gzip), budget, over: kib(gzip) > budget };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const width = Math.max(...rows.map((r) => r.route.length));
  console.log(`${"Page".padEnd(width)}  First load (gzip)  Budget`);
  for (const r of rows) {
    console.log(
      `${r.route.padEnd(width)}  ${`${r.kib} KiB`.padStart(17)}  ${`${r.budget} KiB`.padStart(6)}${r.over ? "  OVER" : ""}`,
    );
  }
}
const over = rows.filter((r) => r.over);
if (over.length > 0) {
  console.error(`\n${over.length} page(s) over budget: ${over.map((r) => r.route).join(", ")}`);
  process.exit(1);
}
