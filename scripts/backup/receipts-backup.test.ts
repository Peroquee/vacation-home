/**
 * The receipts backup scripts (GitLab #82), run with `sh` on temporary
 * folders: the daily mirror, its pruning, and a restore from the mirror
 * into an empty volume, file for file.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

const here = join(process.cwd(), "scripts/backup");
let root: string;
let receipts: string;
let mirror: string;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function store(dir: string, text: string): string {
  const name = sha(text);
  mkdirSync(join(dir, name.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, name.slice(0, 2), name), text);
  return name;
}
const at = (dir: string, name: string) => join(dir, name.slice(0, 2), name);
const run = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("sh", [join(here, script), ...args], {
    encoding: "utf8",
    // The child shell needs PATH; this test configures a script, not the app.
    // eslint-disable-next-line no-restricted-properties
    env: { ...process.env, RECEIPTS_DIR: receipts, MIRROR_DIR: mirror, ...env },
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "receipts-"));
  receipts = join(root, "receipts");
  mirror = join(root, "backups", "receipts");
  mkdirSync(receipts);
});

describe("receipts-mirror.sh", () => {
  it("copies new receipts, and only those", () => {
    const a = store(receipts, "invoice A");
    const first = run("receipts-mirror.sh", []);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("1 copied, 0 already there, 0 broken");
    expect(readFileSync(at(join(mirror, "files"), a), "utf8")).toBe("invoice A");

    store(receipts, "invoice B");
    expect(run("receipts-mirror.sh", []).stdout).toContain("1 copied, 1 already there");
  });

  it("changes nothing on a dry run", () => {
    const a = store(receipts, "invoice A");
    const dry = run("receipts-mirror.sh", ["--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(`Would copy ${a.slice(0, 2)}/${a}`);
    expect(existsSync(mirror)).toBe(false);
  });

  it("skips unfinished uploads, and reports a broken file without copying it", () => {
    store(receipts, "invoice A");
    const broken = sha("what it should be");
    mkdirSync(join(receipts, broken.slice(0, 2)), { recursive: true });
    writeFileSync(at(receipts, broken), "something else");
    writeFileSync(join(receipts, broken.slice(0, 2), `${broken}.1234.tmp`), "half");

    const result = run("receipts-mirror.sh", []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Broken, not copied: ${broken.slice(0, 2)}/${broken}`);
    expect(result.stdout).toContain("1 copied, 0 already there, 1 broken");
    expect(existsSync(at(join(mirror, "files"), broken))).toBe(false);
  });

  it("keeps a receipt deleted in the app for KEEP_DAYS, then drops it", () => {
    const a = store(receipts, "invoice A");
    run("receipts-mirror.sh", []);
    spawnSync("rm", [at(receipts, a)]);

    run("receipts-mirror.sh", [], { KEEP_DAYS: "30" });
    const marker = join(mirror, "gone", a);
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(at(join(mirror, "files"), a))).toBe(true);

    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    utimesSync(marker, longAgo, longAgo);
    expect(run("receipts-mirror.sh", [], { KEEP_DAYS: "30" }).stdout).toContain(
      "1 removed after 30 days",
    );
    expect(existsSync(at(join(mirror, "files"), a))).toBe(false);
  });
});

describe("restoring from the mirror (receipts-copy.sh)", () => {
  it("brings every receipt back into an empty volume, byte for byte", () => {
    const names = ["invoice A", "photo B", "receipt C"].map((text) => store(receipts, text));
    run("receipts-mirror.sh", []);

    const volume = join(root, "restored");
    const restore = spawnSync(
      "sh",
      [join(here, "receipts-copy.sh"), join(mirror, "files"), volume],
      {
        encoding: "utf8",
      },
    );
    expect(restore.status).toBe(0);
    expect(restore.stdout).toContain("3 copied, 0 already there, 0 broken");
    for (const name of names) {
      expect(readFileSync(at(volume, name))).toEqual(readFileSync(at(receipts, name)));
    }
    // Again: nothing to do.
    const again = spawnSync("sh", [join(here, "receipts-copy.sh"), join(mirror, "files"), volume], {
      encoding: "utf8",
    });
    expect(again.stdout).toContain("0 copied, 3 already there");
  });
});
