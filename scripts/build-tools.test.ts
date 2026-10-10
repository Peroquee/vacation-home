/**
 * The tools image's bundles (scripts/build-tools.mjs, GitLab #96): they
 * build, and they run with no node_modules beside them, as in the image.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

it("bundles the maintenance scripts into files that run on their own", () => {
  const built = spawnSync("node", ["scripts/build-tools.mjs"], { encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);

  const alone = mkdtempSync(join(tmpdir(), "tools-"));
  cpSync("dist-tools", join(alone, "dist-tools"), { recursive: true });
  const run = spawnSync("node", ["dist-tools/guests-repurge.mjs"], {
    cwd: alone,
    encoding: "utf8",
  });
  // Without a file it explains itself: everything it needs was found.
  expect(run.stderr).toContain("Usage: npm run guests:repurge -- <ids-file>");
  expect(run.status).toBe(2);
}, 60_000);
