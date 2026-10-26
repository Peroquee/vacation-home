/**
 * scripts/backup/restore.sh before it touches anything (GitLab #145): a live
 * restore carries the erased guests over, or stops. A stub `docker` on PATH
 * stands in for Compose and records every call: pg_isready and the database
 * lookup succeed, the erased-guests query fails when ERASED_QUERY=fail or
 * prints ERASED_IDS, and everything else succeeds silently. The script runs
 * from a copy in a temporary folder, so the files it writes stay there.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it } from "vitest";

let root: string;
let checkout: string;
let calls: string;
let backup: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "restore-"));
  checkout = join(root, "checkout");
  calls = join(root, "docker-calls");
  mkdirSync(join(checkout, "scripts/backup"), { recursive: true });
  writeFileSync(
    join(checkout, "scripts/backup/restore.sh"),
    readFileSync("scripts/backup/restore.sh"),
  );
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin/docker"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${calls}"`,
      'case "$*" in',
      "  *pg_isready*) exit 0 ;;",
      '  *"FROM pg_database"*) echo 1; exit 0 ;;',
      "  *audit_events*)",
      '    if [ "$ERASED_QUERY" = fail ]; then',
      `      echo 'ERROR:  permission denied for table audit_events' >&2; exit 1`,
      "    fi",
      '    for id in $ERASED_IDS; do echo "$id"; done; exit 0 ;;',
      "esac",
      "cat >/dev/null",
    ].join("\n"),
  );
  chmodSync(join(root, "bin/docker"), 0o755);
  backup = join(root, "vacation_home-20261020.sql.gz");
  writeFileSync(backup, gzipSync("SELECT 1;\n"));
});

// eslint-disable-next-line no-restricted-properties -- the script needs PATH; this configures it, not the app
const baseEnv = process.env;
const restore = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [join(checkout, "scripts/backup/restore.sh"), ...args, backup], {
    encoding: "utf8",
    env: { ...baseEnv, PATH: `${join(root, "bin")}:${baseEnv.PATH}`, ...env },
  });
const dockerCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
const LIVE = ["--yes", "--target", "vacation_home"];

describe("a live restore and the erased guests (GitLab #145)", () => {
  it("stops before changing anything when the erased guests cannot be read", () => {
    const result = restore(LIVE, { ERASED_QUERY: "fail" });
    expect(result.status).toBe(1);
    // The database's own reason is shown, not swallowed.
    expect(result.stderr).toContain("permission denied for table audit_events");
    expect(result.stderr).toContain("--without-erasure-check");
    expect(dockerCalls()).not.toMatch(/CREATE DATABASE|DROP DATABASE|RENAME|stop app/);
  });

  it("says so on a dry run as well", () => {
    const result = restore(["--dry-run", ...LIVE], { ERASED_QUERY: "fail" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--without-erasure-check");
    expect(result.stdout).not.toContain("Dry run finished");
  });

  it("goes ahead with --without-erasure-check, warning loudly", () => {
    const result = restore(["--without-erasure-check", ...LIVE], { ERASED_QUERY: "fail" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("WARNING");
    expect(result.stderr).toContain("After a restore");
    expect(dockerCalls()).toContain(
      'ALTER DATABASE "vacation_home_restoring" RENAME TO "vacation_home"',
    );
  });

  it("saves the erased guests' ids and goes ahead when they can be read", () => {
    const ids = ["0b6a7e52-6a43-4c51-9b5e-2f7f7c1d9a01", "1c7b8f63-7b54-4d62-8c6f-3a8a8d2eab12"];
    const result = restore(LIVE, { ERASED_IDS: ids.join(" ") });
    expect(result.status, result.stderr).toBe(0);
    const saved = readdirSync(join(checkout, "backups-restore"));
    expect(saved).toHaveLength(1);
    expect(readFileSync(join(checkout, "backups-restore", saved[0]), "utf8")).toBe(
      `${ids.join("\n")}\n`,
    );
  });

  it("does not ask for the erased guests on a rehearsal", () => {
    const result = restore([], { ERASED_QUERY: "fail" });
    expect(result.status, result.stderr).toBe(0);
    expect(dockerCalls()).not.toContain("audit_events");
  });
});

describe("a live restore and the database structure (GitLab #141)", () => {
  /** The order of the steps that matter here, from the docker calls. */
  const steps = () =>
    dockerCalls()
      .split("\n")
      .flatMap((call) =>
        /RENAME TO "vacation_home"/.test(call)
          ? ["swap"]
          : /compose run --rm migrate/.test(call)
            ? ["migrate"]
            : /compose start app/.test(call)
              ? ["start"]
              : /compose stop app/.test(call)
                ? ["stop"]
                : [],
      );

  it("applies the running version's migrations on production, before the app starts", () => {
    writeFileSync(join(checkout, ".env"), "COMPOSE_FILE=compose.prod.yml\n");
    const result = restore(LIVE, { ERASED_IDS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(steps()).toEqual(["stop", "swap", "migrate", "start"]);
  });

  it("only says so on a dry run", () => {
    writeFileSync(join(checkout, ".env"), "COMPOSE_FILE=compose.prod.yml\n");
    const result = restore(["--dry-run", ...LIVE], { ERASED_IDS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[dry-run] compose run --rm migrate");
    expect(steps()).toEqual([]);
  });

  it("leaves it to the app in development, which migrates on start", () => {
    const result = restore(LIVE, { ERASED_IDS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(steps()).toEqual(["stop", "swap", "start"]);
  });
});
