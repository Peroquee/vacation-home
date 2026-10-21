/**
 * The guests' help on the public pages (GitLab #127) is Markdown with the
 * property's real settings filled in: `{deposit}`, `{depositDue}` and so on.
 * A setting the property does not have leaves its sentence out - so a
 * sentence that depends on one sits on a line of its own, and a line
 * naming a value that is missing is dropped. A section left empty goes too.
 *
 * Pure: the values come from the caller (src/lib/help/public.ts), already
 * worded in the visitor's language.
 */

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** By placeholder name; null or absent: the property has no such setting. */
export type HelpValues = Record<string, string | null | undefined>;

/** The placeholders a text names, each once, in order. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]!))];
}

/** A value as plain text in Markdown: nothing in it formats, links or nests. */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`);
}

/** The text with its values in, and the lines naming a missing one dropped. */
export function fillValues(text: string, values: HelpValues): string {
  return text
    .split("\n")
    .filter((line) => placeholdersIn(line).every((name) => typeof values[name] === "string"))
    .map((line) => line.replace(PLACEHOLDER, (_, name: string) => escapeMarkdown(values[name]!)))
    .join("\n");
}

export type HelpSection = { heading: string; markdown: string };

export type HelpPage = {
  /** The "# " heading. */
  title: string;
  /** Before the first section: always shown. */
  intro: string;
  /** One per "## " heading: the questions, each folded away. */
  sections: HelpSection[];
};

/** A filled text, by its headings; sections with nothing left in them are dropped. */
export function splitSections(markdown: string): HelpPage {
  let title = "";
  const intro: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of markdown.split("\n")) {
    const h1 = /^# (.+)$/.exec(line);
    const h2 = /^## (.+)$/.exec(line);
    if (h1 && !title && sections.length === 0) title = h1[1]!.trim();
    else if (h2) sections.push({ heading: h2[1]!.trim(), lines: [] });
    else (sections.at(-1)?.lines ?? intro).push(line);
  }
  return {
    title,
    intro: intro.join("\n").trim(),
    sections: sections
      .map(({ heading, lines }) => ({ heading, markdown: lines.join("\n").trim() }))
      .filter((section) => section.markdown !== ""),
  };
}
