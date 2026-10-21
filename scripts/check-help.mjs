#!/usr/bin/env node
/**
 * Every owner page has its help (GitLab #121), like the message catalogues
 * have every key: for each page under src/app/(app), a help file in each
 * language (help/<locale>/<key>.md), whose ":::if-..." blocks are balanced
 * and whose `guide:` anchor is a section of docs/user-guide.md. The guests'
 * help on the public pages (GitLab #127) too, in each language, its blocks
 * balanced and both languages naming the same flags and values (which ones
 * the page provides, src/lib/help/help.test.ts checks). Fails the lint and
 * the build otherwise. Read-only: safe to run any time.
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
// The guests' help on the public pages (src/lib/help/public.ts).
const PUBLIC_HELP = ["public-stay", "public-booking"];

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

const OPEN = /^\s*:::if-(no-)?([a-z][a-z0-9-]*)\s*$/;
const CLOSE = /^\s*:::\s*$/;
/** Unbalanced blocks, and flags not among `known` (any, without it). */
function blockProblems(text, known) {
  const problems = [];
  let openAt = null;
  text.split("\n").forEach((line, i) => {
    const open = OPEN.exec(line);
    if (open && known && !known.includes(open[2])) {
      problems.push(`line ${i + 1}: unknown block "${line.trim()}"`);
    } else if (open) {
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
    for (const problem of blockProblems(text, ["email"])) failures.push(`${file}: ${problem}`);
  }
}

/** The flags and values a text names, sorted, to compare the languages. */
const vocabulary = (text) => ({
  flags: [
    ...new Set([...text.matchAll(/^\s*:::if-(?:no-)?([a-z][a-z0-9-]*)\s*$/gm)].map((m) => m[1])),
  ].sort(),
  values: [...new Set([...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]))].sort(),
});
for (const key of PUBLIC_HELP) {
  const named = [];
  for (const locale of LOCALES) {
    const file = join("help", locale, `${key}.md`);
    if (!existsSync(join(ROOT, file))) {
      failures.push(`${key}: no help in ${locale} (${file})`);
      continue;
    }
    const text = readFileSync(join(ROOT, file), "utf8");
    if (!/^# \S/m.test(text)) failures.push(`${file}: no "# " title`);
    for (const problem of blockProblems(text)) failures.push(`${file}: ${problem}`);
    named.push({ file, ...vocabulary(text) });
  }
  const [first, ...rest] = named;
  for (const other of rest) {
    for (const kind of ["flags", "values"]) {
      if (first[kind].join() !== other[kind].join()) {
        failures.push(
          `${other.file}: names the ${kind} ${other[kind].join(", ")}; ${first.file}: ${first[kind].join(", ")}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Help texts incomplete:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `Help texts complete (${pages.length} pages, ${PUBLIC_HELP.length} public, ${LOCALES.length} languages).`,
);
