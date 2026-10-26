/**
 * `npm run audit`: fails when a production dependency has a high or critical
 * advisory that is not in security/audit-allowlist.json - or is there past
 * its `until` date, or without one. Each allow-listed advisory names why it
 * does not apply and when to look again (see docs/security.md); the rules
 * are in ./audit-rules.mjs. Run in CI.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { judge } from "./audit-rules.mjs";

const allowlist = JSON.parse(
  readFileSync(new URL("../security/audit-allowlist.json", import.meta.url), "utf8"),
);
const today = new Date().toISOString().slice(0, 10);

let output;
try {
  output = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds anything; the report is still on stdout.
  output = error.stdout;
}
const report = JSON.parse(output);
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  process.exit(2);
}

const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = via.url?.split("/").pop() ?? via.title;
    advisories.set(id, { package: via.name, severity: via.severity, title: via.title });
  }
}

const { failures, notes, accepted } = judge(allowlist, advisories, today);
for (const line of [...accepted, ...notes]) console.log(line);

if (failures.length > 0) {
  console.error(
    `\n${failures.length} problem(s) with production dependencies' advisories:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`npm audit: no unaccepted high or critical advisories (${accepted.length} accepted).`);
