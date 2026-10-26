/**
 * scripts/deploy/deploy.sh when the new version does not come up (GitLab
 * #141): it goes back to the build that ran, checks it is ready, and fails.
 * Run in a fresh clone of this repository, with stubs on PATH: docker keeps
 * its image tags in a folder (a tag is a file holding an image id), and
 * curl answers /api/ready only while "current" is the image READY_ID names
 * ("any": every image; "none": no image).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

let root: string;
let checkout: string;
let state: string;
let calls: string;
let sha: string;

function stub(name: string, body: string) {
  writeFileSync(join(root, "bin", name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(root, "bin", name), 0o755);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deploy-"));
  checkout = join(root, "checkout");
  state = join(root, "images");
  calls = join(root, "docker-calls");
  mkdirSync(join(root, "bin"));
  mkdirSync(state);
  spawnSync("git", ["clone", "-q", process.cwd(), checkout]);
  // The scripts as they are in this working tree, not as last committed.
  for (const file of ["scripts/deploy/deploy.sh", "scripts/deploy/backup-dir.sh"]) {
    writeFileSync(join(checkout, file), readFileSync(file));
  }
  writeFileSync(join(checkout, ".env"), "COMPOSE_FILE=compose.prod.yml\n");
  sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).stdout.trim();

  // Running before the deploy: build "old1".
  for (const tag of ["vacation-home__old1", "vacation-home__current"]) {
    writeFileSync(join(state, tag), "id-old1\n");
  }
  for (const tag of ["vacation-home-tools__old1", "vacation-home-tools__current"]) {
    writeFileSync(join(state, tag), "id-tools-old1\n");
  }
  stub(
    "docker",
    [
      `echo "$*" >> "${calls}"`,
      `st="${state}"`,
      `key() { echo "$1" | sed 's/:/__/'; }`,
      `case "$1" in`,
      `  build)`,
      `    while [ $# -gt 0 ]; do`,
      `      if [ "$1" = -t ]; then echo "id-$(echo "$2" | tr ':' '-')" > "$st/$(key "$2")"; fi`,
      `      shift`,
      `    done ;;`,
      `  tag) cp "$st/$(key "$2")" "$st/$(key "$3")" ;;`,
      `  image)`,
      `    if [ "$2" = inspect ]; then`,
      `      [ -f "$st/$(key "$3")" ] || exit 1`,
      `      if [ "$4" = --format ]; then cat "$st/$(key "$3")"; fi`,
      `    fi ;;`,
      `  images)`,
      `    for f in "$st/$2__"*; do`,
      `      [ -f "$f" ] || continue`,
      `      tag="\${f##*__}"`,
      `      case "$*" in`,
      `        *CreatedAt*) printf '2026-10-26 00:00:00\\t%s\\n' "$tag" ;;`,
      `        *) printf '%s %s\\n' "$(cat "$f")" "$tag" ;;`,
      `      esac`,
      `    done ;;`,
      `  builder) [ "$3" = --help ] && echo "  --max-used-space bytes" ;;`,
      `esac`,
      `exit 0`,
    ].join("\n"),
  );
  stub(
    "curl",
    [
      `current="$(cat "${state}/vacation-home__current")"`,
      `[ "$READY_ID" = any ] && exit 0`,
      `[ "$current" = "$READY_ID" ]`,
    ].join("\n"),
  );
});

// eslint-disable-next-line no-restricted-properties -- the script needs PATH; this configures it, not the app
const baseEnv = process.env;
const deploy = (args: string[], readyId: string) =>
  spawnSync("bash", [join(checkout, "scripts/deploy/deploy.sh"), "--ref", "HEAD", ...args], {
    cwd: checkout,
    encoding: "utf8",
    env: {
      ...baseEnv,
      PATH: `${join(root, "bin")}:${baseEnv.PATH}`,
      READY_ID: readyId,
      DEPLOY_READY_TRIES: "2",
      DEPLOY_READY_INTERVAL: "0",
    },
  });
const current = () => readFileSync(join(state, "vacation-home__current"), "utf8").trim();

describe("a deploy whose new version does not become ready (GitLab #141)", () => {
  it("goes back to the build that ran, checks it is ready, and fails", () => {
    const result = deploy([], "id-old1");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`==> Rolling back to old1: ${sha} did not become ready`);
    expect(result.stderr).toContain(
      `Deploy of ${sha} FAILED: it did not become ready. old1 is running again.`,
    );
    expect(current()).toBe("id-old1");
    expect(readFileSync(join(state, "vacation-home-tools__current"), "utf8").trim()).toBe(
      "id-tools-old1",
    );
    // And it did not tidy up as after a success.
    expect(readFileSync(calls, "utf8")).not.toContain("builder prune --force");
  });

  it("says so when the build it went back to does not come up either", () => {
    const result = deploy([], "none");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`and old1 did not become ready either`);
    expect(current()).toBe("id-old1");
  });

  it("only says what it would do on a dry run", () => {
    const result = deploy(["--dry-run"], "none");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `[dry-run] if <new> does not become ready: back to old1, and exit 1`.replace("<new>", sha),
    );
    expect(current()).toBe("id-old1");
  });
});

describe("a deploy whose new version comes up", () => {
  it("stays on it", () => {
    const result = deploy([], "any");
    expect(result.status, result.stderr).toBe(0);
    expect(current()).toBe(`id-vacation-home-${sha}`);
    expect(result.stdout).toContain(
      `Deployed ${sha}. To go back: scripts/deploy/deploy.sh --rollback old1`,
    );
  });
});
