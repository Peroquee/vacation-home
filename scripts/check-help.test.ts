import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-help.mjs");

/** A tiny project: one owner page, the guide, and the help files given. */
function project(help: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "check-help-"));
  mkdirSync(join(root, "src", "app", "(app)", "calendar"), { recursive: true });
  writeFileSync(join(root, "src", "app", "(app)", "calendar", "page.tsx"), "");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "user-guide.md"), "# Guide\n\n## The calendar\n");
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
});
