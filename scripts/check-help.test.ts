import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-help.mjs");

const GUIDE_EN =
  "# Guide\n\n## The calendar\n\n### Moving a stay\n\nSee [the calendar](#the-calendar).\n";
const GUIDE_DE =
  "# Handbuch\n\n## Der Kalender {#the-calendar}\n\n### Einen Aufenthalt verschieben {#moving-a-stay}\n";

/** A tiny project: one owner page, the guide in both languages, and the help files given. */
function project(
  help: Record<string, string>,
  guides: { en?: string | null; de?: string | null } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "check-help-"));
  mkdirSync(join(root, "src", "app", "(app)", "calendar"), { recursive: true });
  writeFileSync(join(root, "src", "app", "(app)", "calendar", "page.tsx"), "");
  mkdirSync(join(root, "docs"));
  const { en = GUIDE_EN, de = GUIDE_DE } = guides;
  if (en !== null) writeFileSync(join(root, "docs", "user-guide.md"), en);
  if (de !== null) writeFileSync(join(root, "docs", "user-guide.de-DE.md"), de);
  for (const [file, text] of Object.entries(help)) {
    mkdirSync(join(root, "help", file.split("/")[0]!), { recursive: true });
    writeFileSync(join(root, "help", file), text);
  }
  return root;
}

function run(root: string): { ok: boolean; output: string } {
  try {
    return {
      ok: true,
      output: execFileSync("node", [SCRIPT], {
        cwd: root,
        encoding: "utf8",
        // Captured for the assertions, not printed into the test run.
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, output: String((error as { stderr?: string }).stderr) };
  }
}

const GOOD = "---\nguide: the-calendar\n---\n\n# Calendar\n";
// The guests' help on the public pages (GitLab #127), in both languages.
const PUBLIC = "# Booking\n\nDue {deposit}.\n:::if-girocode\nScan it.\n:::\n";
const PUBLIC_FILES = Object.fromEntries(
  ["de-DE", "en-GB"].flatMap((locale) =>
    ["public-stay", "public-booking"].map((key) => [`${locale}/${key}.md`, PUBLIC]),
  ),
);

describe("the help check (scripts/check-help.mjs)", () => {
  it("passes when every page has its help in both languages", () => {
    expect(
      run(project({ "de-DE/calendar.md": GOOD, "en-GB/calendar.md": GOOD, ...PUBLIC_FILES })).ok,
    ).toBe(true);
  });

  it("fails for a page without help in a language", () => {
    const result = run(project({ "de-DE/calendar.md": GOOD, ...PUBLIC_FILES }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain("/calendar: no help in en-GB");
  });

  it("fails for an unbalanced block or a guide section that does not exist", () => {
    const result = run(
      project({
        "de-DE/calendar.md": `${GOOD}\n:::if-email\nnever closed\n`,
        "en-GB/calendar.md": "---\nguide: nowhere\n---\n",
        ...PUBLIC_FILES,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("the block is never closed");
    expect(result.output).toContain('guide "nowhere" is no section');
  });

  it("fails for a guests' help missing in a language, or naming other values there", () => {
    const rest = { ...PUBLIC_FILES };
    delete rest["en-GB/public-booking.md"];
    const result = run(
      project({
        "de-DE/calendar.md": GOOD,
        "en-GB/calendar.md": GOOD,
        ...rest,
        "en-GB/public-stay.md": PUBLIC.replace("{deposit}", "{depost}"),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("public-booking: no help in en-GB");
    expect(result.output).toContain("help/en-GB/public-stay.md: names the values depost");
  });

  // GitLab #128: the user guide in both languages, with one outline.
  describe("the user guide", () => {
    const HELP = { "de-DE/calendar.md": GOOD, "en-GB/calendar.md": GOOD, ...PUBLIC_FILES };

    it("fails when the German guide is missing", () => {
      const result = run(project(HELP, { de: null }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain("docs/user-guide.de-DE.md: missing");
    });

    it("fails for a section added in one language only", () => {
      const result = run(project(HELP, { en: `${GUIDE_EN}\n## Finance\n` }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain(
        "docs/user-guide.de-DE.md: its sections differ from docs/user-guide.md at section 3: (none) here, ## {#finance} there",
      );
      const german = run(project(HELP, { de: `${GUIDE_DE}\n## Finanzen {#finance}\n` }));
      expect(german.ok).toBe(false);
      expect(german.output).toContain("## {#finance} here, (none) there");
    });

    it("fails for a section at another level, or under another anchor", () => {
      const level = run(project(HELP, { de: GUIDE_DE.replace("### Einen", "## Einen") }));
      expect(level.output).toContain(
        "at section 2: ## {#moving-a-stay} here, ### {#moving-a-stay} there",
      );
      const renamed = run(project(HELP, { de: GUIDE_DE.replace("{#moving-a-stay}", "{#move}") }));
      expect(renamed.output).toContain("### {#move} here, ### {#moving-a-stay} there");
    });

    it("needs the German headings to carry their English anchors", () => {
      const result = run(project(HELP, { de: GUIDE_DE.replace(" {#the-calendar}", "") }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('"Der Kalender" needs its English anchor');
    });

    it("fails for a link to a section that does not exist, here or in another doc", () => {
      const result = run(
        project(HELP, {
          de: `${GUIDE_DE}\nSiehe [Finanzen](#finance) und [Backups](backup.md#restore).\n`,
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain(
        "docs/user-guide.de-DE.md: links to #finance, no such section",
      );
      expect(result.output).toContain("links to backup.md, which does not exist");
    });

    it("passes with both outlines equal and every link landing", () => {
      const result = run(project(HELP, { de: `${GUIDE_DE}\nSiehe [oben](#the-calendar).\n` }));
      expect(result.ok).toBe(true);
      expect(result.output).toContain("the guide in 2, 2 sections each");
    });
  });
});
