#!/usr/bin/env node
/**
 * Every owner page has its help (GitLab #121), like the message catalogues
 * have every key: for each page under src/app/(app), a help file in each
 * language (help/<locale>/<key>.md), whose ":::if-..." blocks are balanced
 * and whose `guide:` anchor is a section of docs/user-guide.md. Fails the
 * lint and the build otherwise. Read-only: safe to run any time.
 *
 *   node scripts/check-help.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "src", "app", "(app)");
const LOCALES = ["de-DE", "en-GB"];
// The root only redirects; the gallery is for development; /help is the guide itself.
const NO_HELP = new Set(["/", "/dev/ui", "/help"]);

/** Owner pages as routes, e.g. "/bookings/[id]/edit". */
function routes(dir = APP) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routes(path));
    else if (entry.name === "page.tsx") {
      const segments = relative(APP, dir)
        .split(sep)
        .filter((s) => s && !s.startsWith("("));
      found.push(`/${segments.join("/")}`);
    }
  }
  return found;
}

const OPEN = /^\s*:::if-(no-)?email\s*$/;
const CLOSE = /^\s*:::\s*$/;
function blockProblems(text) {
  const problems = [];
  let openAt = null;
  text.split("\n").forEach((line, i) => {
    if (OPEN.test(line)) {
      if (openAt !== null)
        problems.push(`line ${i + 1}: opens inside the block from line ${openAt}`);
      openAt = i + 1;
    } else if (CLOSE.test(line)) {
      if (openAt === null) problems.push(`line ${i + 1}: ":::" closes no block`);
      openAt = null;
    } else if (/^\s*:::/.test(line)) problems.push(`line ${i + 1}: unknown block "${line.trim()}"`);
  });
  if (openAt !== null) problems.push(`line ${openAt}: the block is never closed`);
  return problems;
}

// The guide's sections, as their anchors (as GitHub and /help make them).
const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const sections = new Set(
  readFileSync(join(ROOT, "docs", "user-guide.md"), "utf8")
    .split("\n")
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => anchor(line.replace(/^#+ /, ""))),
);

const failures = [];
const pages = routes()
  .filter((route) => !NO_HELP.has(route))
  .sort();
for (const route of pages) {
  const key = route.slice(1).replaceAll("/", "-");
  for (const locale of LOCALES) {
    const file = join("help", locale, `${key}.md`);
    if (!existsSync(join(ROOT, file))) {
      failures.push(`${route}: no help in ${locale} (${file})`);
      continue;
    }
    const text = readFileSync(join(ROOT, file), "utf8");
    const guide = /^---\n[\s\S]*?^guide:\s*([a-z0-9-]+)\s*$[\s\S]*?^---$/m.exec(text)?.[1];
    if (!guide) failures.push(`${file}: no "guide:" in its front matter`);
    else if (!sections.has(guide))
      failures.push(`${file}: guide "${guide}" is no section of docs/user-guide.md`);
    for (const problem of blockProblems(text)) failures.push(`${file}: ${problem}`);
  }
}

if (failures.length > 0) {
  console.error(`Help texts incomplete:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Help texts complete (${pages.length} pages, ${LOCALES.length} languages).`);
