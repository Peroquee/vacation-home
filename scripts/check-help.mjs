#!/usr/bin/env node
/**
 * Every owner page has its help (GitLab #121), like the message catalogues
 * have every key: for each page under src/app/(app), a help file in each
 * language (help/<locale>/<key>.md), whose ":::if-..." blocks are balanced
 * and whose `guide:` anchor is a section of docs/user-guide.md. The guests'
 * help on the public pages (GitLab #127) too, in each language, its blocks
 * balanced and both languages naming the same flags and values (which ones
 * the page provides, src/lib/help/help.test.ts checks). The user guide in
 * each language (GitLab #128): docs/user-guide.md and
 * docs/user-guide.de-DE.md have the same outline - the same headings at the
 * same levels with the same anchors, the German ones written out as
 * `## Finanzen {#finance}` - and their links to a section, here or in
 * another doc, lead to one. Fails the lint and the build otherwise.
 * Read-only: safe to run any time.
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
const EXPLICIT = /\s*\{#([a-z0-9-]+)\}\s*$/;
/** A Markdown file's h2 and h3, in order: level, anchor, and whether it was written out. */
function outline(text) {
  return text
    .split("\n")
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => {
      const heading = line.replace(/^#+ /, "");
      const explicit = EXPLICIT.exec(heading);
      return {
        level: line.indexOf(" "),
        anchor: explicit ? explicit[1] : anchor(heading),
        explicit: Boolean(explicit),
        line: heading,
      };
    });
}
/** The guide in each language; English is the reference. */
const GUIDES = { "en-GB": "user-guide.md", "de-DE": "user-guide.de-DE.md" };
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const guides = Object.fromEntries(
  Object.entries(GUIDES).map(([locale, file]) => [locale, read(join(ROOT, "docs", file))]),
);
const sections = new Set(outline(guides["en-GB"] ?? "").map((h) => h.anchor));
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

// The two guides: one outline, and links that lead somewhere.
const english = outline(guides["en-GB"] ?? "");
for (const [locale, file] of Object.entries(GUIDES)) {
  const text = guides[locale];
  const path = `docs/${file}`;
  if (text === null) {
    failures.push(`${path}: missing (the user guide in ${locale})`);
    continue;
  }
  if (locale !== "en-GB") {
    const own = outline(text);
    for (const heading of own.filter((h) => !h.explicit)) {
      failures.push(`${path}: "${heading.line}" needs its English anchor, as {#...}`);
    }
    const shape = (list) => list.map((h) => `${"#".repeat(h.level)} {#${h.anchor}}`);
    const [ours, theirs] = [shape(own), shape(english)];
    const at = ours.findIndex((h, i) => h !== theirs[i]);
    if (at !== -1 || ours.length !== theirs.length) {
      const i = at === -1 ? Math.min(ours.length, theirs.length) : at;
      failures.push(
        `${path}: its sections differ from docs/user-guide.md at section ${i + 1}: ${ours[i] ?? "(none)"} here, ${theirs[i] ?? "(none)"} there`,
      );
    }
  }
  // Links to a section: of this guide, or of a doc next to it.
  const anchorsOf = new Map([["", new Set(outline(text).map((h) => h.anchor))]]);
  for (const [, target, hash] of text.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    if (!anchorsOf.has(target)) {
      const other = read(join(ROOT, "docs", target));
      anchorsOf.set(
        target,
        other === null
          ? null
          : new Set(
              other
                .split("\n")
                .filter((line) => /^#{1,6} /.test(line))
                .map((line) => anchor(line.replace(/^#+ /, ""))),
            ),
      );
    }
    const known = anchorsOf.get(target);
    if (known === null) failures.push(`${path}: links to ${target}, which does not exist`);
    else if (!known.has(hash))
      failures.push(`${path}: links to ${target}#${hash}, no such section`);
  }
}

if (failures.length > 0) {
  console.error(`Help texts incomplete:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `Help texts complete (${pages.length} pages, ${PUBLIC_HELP.length} public, ${LOCALES.length} languages; the guide in ${Object.keys(GUIDES).length}, ${english.length} sections each).`,
);
