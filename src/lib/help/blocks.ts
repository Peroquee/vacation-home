/**
 * Conditional parts of the help texts (GitLab #121): a sentence that is
 * only true once something is set up, e.g. that the guest gets an email.
 *
 *   :::if-email          kept only when emails are sent (SMTP set up)
 *   :::if-no-email       kept only when they are not
 *   :::                  ends the block
 *
 * At any indentation, so a block can sit inside a list item; resolved line
 * by line before the Markdown is rendered. Pure; also used by the build's
 * check (scripts/check-help.mjs) through checkBlocks.
 */
const OPEN = /^\s*:::if-(no-)?email\s*$/;
const CLOSE = /^\s*:::\s*$/;

export type HelpFlags = { email: boolean };

/** The text with its blocks kept or dropped, and their marker lines gone. */
export function resolveBlocks(text: string, flags: HelpFlags): string {
  const out: string[] = [];
  let keep: boolean | null = null;
  for (const line of text.split("\n")) {
    const open = OPEN.exec(line);
    if (open) {
      keep = open[1] ? !flags.email : flags.email;
      continue;
    }
    if (keep !== null && CLOSE.test(line)) {
      keep = null;
      continue;
    }
    if (keep !== false) out.push(line);
  }
  return out.join("\n");
}

/** What is wrong with a text's blocks: unclosed, nested, or stray closings. */
export function checkBlocks(text: string): string[] {
  const problems: string[] = [];
  let openAt: number | null = null;
  text.split("\n").forEach((line, i) => {
    if (OPEN.test(line)) {
      if (openAt !== null)
        problems.push(`line ${i + 1}: a block opens inside the one from line ${openAt}`);
      openAt = i + 1;
    } else if (CLOSE.test(line)) {
      if (openAt === null) problems.push(`line ${i + 1}: ":::" closes no block`);
      openAt = null;
    } else if (/^\s*:::/.test(line)) {
      problems.push(`line ${i + 1}: unknown block "${line.trim()}"`);
    }
  });
  if (openAt !== null) problems.push(`line ${openAt}: the block is never closed`);
  return problems;
}

/** The front matter's guide anchor, and the text after it. */
export function splitFrontMatter(text: string): { guide: string | null; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return { guide: null, body: text };
  const guide = /^guide:\s*([a-z0-9-]+)\s*$/m.exec(match[1]!)?.[1] ?? null;
  return { guide, body: text.slice(match[0].length) };
}
