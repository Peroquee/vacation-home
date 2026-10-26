/**
 * The pipeline's deploy job waits for every check (GitLab #143): `needs`
 * lets it start as soon as the jobs it names are done, so a gating job left
 * out could fail after main was already deployed. On the serial runner the
 * job order varies, so this is no theory: lighthouse once ran first.
 */
import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Job = { stage?: string; extends?: string | string[]; when?: string; needs?: unknown[] };

const ci = parse(readFileSync(".gitlab-ci.yml", "utf8"), { merge: true }) as Record<
  string,
  unknown
>;
/** Top-level keys that are settings, not jobs. */
const SETTINGS = new Set([
  "stages",
  "workflow",
  "variables",
  "default",
  "include",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
]);
const jobs = Object.entries(ci).filter(([name]) => !SETTINGS.has(name) && !name.startsWith("."));

/** A job's setting, following `extends` as GitLab does. */
function setting<K extends keyof Job>(job: Job, key: K): Job[K] {
  if (job[key] !== undefined) return job[key];
  const parents = job.extends === undefined ? [] : [job.extends].flat();
  for (const parent of parents.reverse()) {
    const value = setting(ci[parent] as Job, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

describe("the deploy job", () => {
  it("needs every job of the quality, test and build stages that runs by itself", () => {
    const gating = jobs
      .filter(([, job]) =>
        ["quality", "test", "build"].includes(setting(job as Job, "stage") ?? ""),
      )
      .filter(([, job]) => setting(job as Job, "when") !== "manual")
      .map(([name]) => name)
      .sort();
    expect(gating).toContain("lighthouse");
    const needs = ((ci.deploy as Job).needs ?? []).map((need) =>
      typeof need === "string" ? need : (need as { job: string }).job,
    );
    expect([...needs].sort()).toEqual(gating);
  });
});
