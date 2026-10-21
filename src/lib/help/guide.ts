/**
 * The user guide at /help (GitLab #121), in the user's language (GitLab
 * #128): docs/user-guide.md in English, docs/user-guide.de-DE.md in German,
 * English where a language has none. The German headings carry the English
 * anchors (`## Finanzen {#finance}`), so the help panels' links and the
 * guide's own links are the same in both; scripts/check-help.mjs keeps the
 * two outlines equal. Server-side only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const GUIDE_FILES: Record<string, string> = {
  "en-GB": "user-guide.md",
  "de-DE": "user-guide.de-DE.md",
};
const FALLBACK = GUIDE_FILES["en-GB"]!;

/** The guide's Markdown for `locale`; English when that language has none. */
export async function readGuide(locale: string): Promise<string> {
  const docs = join(process.cwd(), "docs");
  const file = GUIDE_FILES[locale] ?? FALLBACK;
  try {
    return await readFile(join(docs, file), "utf8");
  } catch (error) {
    if (file === FALLBACK) throw error;
    return readFile(join(docs, FALLBACK), "utf8");
  }
}
