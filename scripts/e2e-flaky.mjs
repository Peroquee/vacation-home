#!/usr/bin/env node
/**
 * Flakiness measurement for the e2e suite (GitLab #133): runs it several
 * times, each a full run from a fresh database exactly as CI runs it, and
 * lists every test that failed at least once, with its slowest timings.
 *
 *   npm run e2e:flaky                  5 runs, then the summary
 *   npm run e2e:flaky -- --runs 3      another number of runs
 *   npm run e2e:flaky -- --report      only summarise the runs already saved
 *   npm run e2e:flaky -- --dry-run     print what would run, run nothing
 *
 * A measurement, not a gate: it exits 0 whatever the tests did, unless a run
 * produced no report at all. Each run's report is kept in
 * test-results-flaky/run-<n>.json, so an interrupted measurement can be
 * summarised as it stands, and starting again adds the next numbers instead
 * of overwriting what is there. Delete the folder to start from scratch.
 *
 * Runs are sequential and slow (every run rebuilds the app, see webServer in
 * playwright.config.ts): with --repeat-each in one run the tests would see
 * each other's rows, since the database is reset once per run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "test-results-flaky";
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const runsIndex = args.indexOf("--runs");
const runs = runsIndex >= 0 ? Number(args[runsIndex + 1]) : 5;
if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs needs a whole number of 1 or more");
  process.exit(2);
}

const saved = () =>
  existsSync(DIR)
    ? readdirSync(DIR)
        .map((name) => /^run-(\d+)\.json$/.exec(name)?.[1])
        .filter(Boolean)
        .map(Number)
        .sort((a, b) => a - b)
    : [];

if (!flag("--report")) {
  mkdirSync(DIR, { recursive: true });
  const first = (saved().at(-1) ?? 0) + 1;
  for (let n = first; n < first + runs; n++) {
    const output = join(DIR, `run-${n}.json`);
    const command = ["playwright", "test", "--project=chromium", "--reporter=json,list"];
    console.log(`run ${n}: npx ${command.join(" ")} > ${output}`);
    if (flag("--dry-run")) continue;
    const started = Date.now();
    const result = spawnSync("npx", command, {
      stdio: "inherit",
      // eslint-disable-next-line no-restricted-properties -- Playwright's environment, not the app's
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: output },
    });
    if (!existsSync(output)) {
      console.error(`run ${n} wrote no report (exit ${result.status}); stopping`);
      process.exit(1);
    }
    console.log(`run ${n}: exit ${result.status}, ${Math.round((Date.now() - started) / 1000)} s`);
  }
  if (flag("--dry-run")) process.exit(0);
}

/** Every test result of one report: file, title, status, duration. */
function results(report) {
  const out = [];
  const walk = (suite, file) => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          out.push({
            key: `${test.projectName} › ${here} › ${spec.title}`,
            status: result.status,
            ms: result.duration,
            error: result.error?.message?.split("\n")[0],
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites) walk(suite);
  return out;
}

const numbers = saved();
if (numbers.length === 0) {
  console.error(`no runs saved in ${DIR}/`);
  process.exit(1);
}
const byTest = new Map();
const runSummaries = [];
for (const n of numbers) {
  const report = JSON.parse(readFileSync(join(DIR, `run-${n}.json`), "utf8"));
  const all = results(report);
  runSummaries.push({
    run: n,
    seconds: Math.round(report.stats.duration / 1000),
    failed: all.filter((r) => r.status !== "passed" && r.status !== "skipped").length,
    errors: (report.errors ?? []).map((e) => e.message.split("\n")[0]),
  });
  for (const r of all) {
    const entry = byTest.get(r.key) ?? { key: r.key, runs: 0, failures: [], ms: [] };
    entry.runs += 1;
    entry.ms.push(r.ms);
    if (r.status !== "passed" && r.status !== "skipped")
      entry.failures.push(`run ${n}: ${r.error}`);
    byTest.set(r.key, entry);
  }
}

const tests = [...byTest.values()];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const flaky = tests.filter((t) => t.failures.length > 0);
const slowest = tests.sort((a, b) => median(b.ms) - median(a.ms)).slice(0, 15);
const summary = {
  runs: runSummaries,
  tests: tests.length,
  everFailed: flaky.map((t) => ({
    test: t.key,
    failed: t.failures.length,
    of: t.runs,
    failures: t.failures,
  })),
  slowest: slowest.map((t) => ({ test: t.key, medianSeconds: median(t.ms) / 1000 })),
};
writeFileSync(join(DIR, "summary.json"), JSON.stringify(summary, null, 2));

for (const r of runSummaries) {
  console.log(
    `run ${r.run}: ${r.seconds} s, ${r.failed} failed${r.errors.length ? `, ${r.errors.join("; ")}` : ""}`,
  );
}
console.log(`\n${tests.length} tests over ${numbers.length} runs; ${flaky.length} ever failed`);
for (const t of flaky) {
  console.log(`  ${t.failures.length}/${t.runs}  ${t.key}`);
  for (const f of t.failures) console.log(`        ${f}`);
}
console.log("\nslowest (median):");
for (const t of slowest)
  console.log(`  ${(median(t.ms) / 1000).toFixed(1).padStart(6)} s  ${t.key}`);
console.log(`\nsummary: ${join(DIR, "summary.json")}`);
