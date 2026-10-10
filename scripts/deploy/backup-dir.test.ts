/**
 * scripts/deploy/backup-dir.sh and its call in deploy.sh (GitLab #96): the
 * backup folder ends up writable by the backup services' user. Stubs on
 * PATH stand in for sudo (records, and refuses unless SUDO_OK=1), for
 * `stat -f` (FAKE_FS=nfs pretends a network share), for `id -u` (FAKE_EUID:
 * the tests run as a normal user, 1000, even where CI runs them as root)
 * and for docker.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/deploy/backup-dir.sh");
const me = String(process.getuid!());
let root: string;
let stubs: string;
let calls: string;

function stub(name: string, body: string) {
  writeFileSync(join(stubs, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(stubs, name), 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "backup-dir-"));
  stubs = join(root, "bin");
  calls = join(root, "sudo-calls");
  mkdirSync(stubs);
  stub(
    "sudo",
    [
      `if [ "$1" = -n ] && [ "$2" = true ]; then [ "$SUDO_OK" = 1 ]; exit $?; fi`,
      `shift`, // -n
      `echo "$*" >> "${calls}"`,
      // Creating works without root here; chown to another user would not.
      `if [ "$1" = mkdir ]; then "$@"; fi`,
    ].join("\n"),
  );
  stub(
    "id",
    `if [ "$1" = -u ] && [ -n "$FAKE_EUID" ]; then echo "$FAKE_EUID"; exit 0; fi\nexec /usr/bin/id "$@"`,
  );
  stub(
    "stat",
    `if [ "$1" = -f ] && [ -n "$FAKE_FS" ]; then echo "$FAKE_FS"; exit 0; fi\nexec /usr/bin/stat "$@"`,
  );
});

// eslint-disable-next-line no-restricted-properties -- the scripts need PATH; this configures them, not the app
const baseEnv = process.env;
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...baseEnv, PATH: `${stubs}:${baseEnv.PATH}`, FAKE_EUID: "1000", ...env },
  });
const sudoCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);

describe("a local folder", () => {
  it("is created for user 999 with mode 750", () => {
    const dir = join(root, "backups");
    const result = run([dir], { SUDO_OK: "1" });
    expect(result.status).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect(sudoCalls()).toEqual([`mkdir -p ${dir}`, `chown 999:999 ${dir}`, `chmod 750 ${dir}`]);
  });

  it("stops with the commands to run when there is no sudo without a password", () => {
    const dir = join(root, "backups");
    const result = run([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`sudo chown 999:999 '${dir}'`);
    expect(result.stderr).toContain(`sudo chmod 750 '${dir}'`);
  });

  it("is left alone when the backup user owns it", () => {
    const dir = join(root, "backups");
    mkdirSync(dir);
    const result = run([dir], { SUDO_OK: "1", BACKUP_UID: me });
    expect(result.status).toBe(0);
    expect(sudoCalls()).toEqual([]);
  });

  it("is given to the backup user when someone else owns it, as Docker leaves it", () => {
    const dir = join(root, "backups");
    mkdirSync(dir);
    const result = run([dir], { SUDO_OK: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("giving the backup folder");
    expect(sudoCalls()).toEqual([`chown 999:999 ${dir}`, `chmod 750 ${dir}`]);
  });

  it("as root, needs no sudo", () => {
    const dir = join(root, "backups");
    const result = run(["--dry-run", dir], { FAKE_EUID: "0" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`[dry-run] mkdir -p ${dir}`);
    expect(result.stdout).toContain(`[dry-run] chown 999:999 ${dir}`);
    expect(result.stdout).not.toContain("sudo");
  });

  it("only says what it would do on a dry run", () => {
    const dir = join(root, "backups");
    const result = run(["--dry-run", dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`[dry-run] sudo -n mkdir -p ${dir}`);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("a network share", () => {
  it("stops when the folder is missing: it is created on the NAS", () => {
    const result = run([join(root, "nas", "backups")], { FAKE_FS: "nfs" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Create it on the NAS");
    expect(sudoCalls()).toEqual([]);
  });

  it("warns, without changing anything, when user 999 cannot write", () => {
    const dir = join(root, "backups");
    mkdirSync(dir, { mode: 0o750 });
    const result = run([dir], { FAKE_FS: "nfs", SUDO_OK: "1" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WARNING");
    expect(sudoCalls()).toEqual([]);
  });

  it("is fine when everyone may write", () => {
    const dir = join(root, "backups");
    mkdirSync(dir);
    chmodSync(dir, 0o777);
    const result = run([dir], { FAKE_FS: "nfs" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});

describe("deploy.sh", () => {
  it("checks the backup folder when the backup profile is on (stub docker, dry run)", () => {
    stub(
      "docker",
      [
        `if [ "$1" = images ]; then exit 0; fi`,
        `if [ "$1" = image ] && [ "$2" = inspect ]; then exit 1; fi`,
        `exit 0`,
      ].join("\n"),
    );
    const checkout = join(root, "checkout");
    spawnSync("git", ["clone", "-q", process.cwd(), checkout]);
    for (const file of ["scripts/deploy/deploy.sh", "scripts/deploy/backup-dir.sh"]) {
      writeFileSync(join(checkout, file), readFileSync(file));
    }
    writeFileSync(
      join(checkout, ".env"),
      'COMPOSE_FILE=compose.prod.yml\nCOMPOSE_PROFILES="backup"\nBACKUP_HOST_DIR="./backups"\n',
    );
    const result = spawnSync("bash", [join(checkout, "scripts/deploy/deploy.sh"), "--dry-run"], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...baseEnv, PATH: `${stubs}:${baseEnv.PATH}`, FAKE_EUID: "1000" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("==> Checking the backup folder");
    expect(result.stdout).toContain("[dry-run] sudo -n mkdir -p ./backups");
    expect(result.stdout).toContain("[dry-run] docker compose up -d db");
  });
});
