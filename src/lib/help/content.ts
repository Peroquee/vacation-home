/**
 * The help texts (GitLab #121): Markdown per owner page and language in
 * help/<locale>/<key>.md, so they can be improved without touching code.
 * Server-side: read when the panel opens, never part of a page's bundle.
 * next.config.ts traces the folder into the standalone build.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { env } from "@/env";
import type { Locale } from "@/i18n/locales";

import { resolveBlocks, splitFrontMatter } from "./blocks";
import { isHelpKey } from "./routes";

export type HelpText = {
  /** Markdown, its conditional parts resolved. */
  markdown: string;
  /** The user guide's section, an anchor on /help. */
  guide: string | null;
};

const HELP_DIR = join(process.cwd(), "help");

/** Whether the app sends emails: the help says what happens then, or what to do instead. */
export const emailsSent = () => Boolean(env.SMTP_HOST && env.SMTP_FROM);

/** The help for `key` in `locale`, or null for a key that is not a page's. */
export async function readHelp(key: string, locale: Locale): Promise<HelpText | null> {
  // Only the known keys: the URL never names a file.
  if (!isHelpKey(key)) return null;
  const text = await readFile(join(HELP_DIR, locale, `${key}.md`), "utf8");
  const { guide, body } = splitFrontMatter(text);
  return { markdown: resolveBlocks(body, { email: emailsSent() }), guide };
}
