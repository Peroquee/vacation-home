/**
 * `npm run audit`: fails when a production dependency has a high or critical
 * advisory that is not in security/audit-allowlist.json - or is there past
 * its `until` date. Each allow-listed advisory names why it does not apply
 * and when to look again (see docs/security.md). Run in CI.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

const failures = [];
for (const [id, advisory] of advisories) {
  const allowed = allowlist[id];
  if (!allowed) failures.push(`${advisory.severity} ${id} ${advisory.package}: ${advisory.title}`);
  else if (allowed.until < today)
    failures.push(
      `${id} ${advisory.package}: allow-list entry expired on ${allowed.until}; review it again`,
    );
  else console.log(`accepted ${id} ${advisory.package} (until ${allowed.until})`);
}
for (const id of Object.keys(allowlist)) {
  if (!advisories.has(id))
    console.log(`note: ${id} no longer reported; remove it from the allow-list`);
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} unaccepted advisory(ies) in production dependencies:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`npm audit: no unaccepted high or critical advisories (${advisories.size} accepted).`);
