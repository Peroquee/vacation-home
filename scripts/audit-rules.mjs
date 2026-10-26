/**
 * The rules of `npm run audit` (scripts/audit.mjs), apart from running npm
 * so they can be tested (scripts/audit.test.ts). GitLab #146: an allow-list
 * entry is a decision with an end date. Each needs a reason, the day it was
 * reviewed and an `until` at most MAX_DAYS after that; past `until`, or
 * without one, it fails the audit, so an ignored advisory is looked at again.
 */

/** The longest an advisory may stay accepted before it is reviewed again. */
export const MAX_DAYS = 120;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date as YYYY-MM-DD: 2027-02-30 is none. */
const isDate = (text) =>
  typeof text === "string" &&
  DATE.test(text) &&
  !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) &&
  new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * What the audit says about each advisory and allow-list entry, given the
 * reported high and critical advisories (id -> { package, severity, title })
 * and `today` (YYYY-MM-DD). `failures` fail the job; `notes` do not.
 */
export function judge(allowlist, advisories, today) {
  const failures = [];
  const notes = [];
  const accepted = [];
  const invalid = new Set();
  for (const [id, entry] of Object.entries(allowlist)) {
    const problems = [];
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") problems.push("no reason");
    if (!isDate(entry.reviewed)) problems.push("no `reviewed` date (YYYY-MM-DD)");
    if (!isDate(entry.until)) problems.push("no `until` date (YYYY-MM-DD)");
    else if (isDate(entry.reviewed) && daysBetween(entry.reviewed, entry.until) > MAX_DAYS) {
      problems.push(`\`until\` is more than ${MAX_DAYS} days after \`reviewed\``);
    } else if (entry.until < today) {
      problems.push(`expired on ${entry.until}; review it again`);
    }
    if (problems.length > 0) {
      invalid.add(id);
      failures.push(`allow-list entry ${id}: ${problems.join(", ")}`);
    }
  }
  for (const [id, advisory] of advisories) {
    const entry = allowlist[id];
    if (!entry) {
      failures.push(`${advisory.severity} ${id} ${advisory.package}: ${advisory.title}`);
    } else if (!invalid.has(id)) {
      accepted.push(`accepted ${id} ${advisory.package} (until ${entry.until})`);
    }
  }
  for (const id of Object.keys(allowlist)) {
    if (!advisories.has(id))
      notes.push(`note: ${id} no longer reported; remove it from the allow-list`);
  }
  return { failures, notes, accepted };
}
