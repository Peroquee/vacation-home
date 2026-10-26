/**
 * The audit's allow-list rules (GitLab #146), scripts/audit-rules.mjs: an
 * accepted advisory has a reason, a review date and an end at most
 * MAX_DAYS later; without one, or past it, the audit fails.
 */
import { describe, expect, it } from "vitest";

import { judge, MAX_DAYS } from "./audit-rules.mjs";

const TODAY = "2026-10-26";
const advisory = { package: "deepmerge-ts", severity: "high", title: "Stack exhaustion" };
const reported = new Map([["GHSA-1", advisory]]);
const entry = (over: Record<string, unknown> = {}) => ({
  "GHSA-1": {
    reason: "Only our own config reaches it.",
    reviewed: "2026-10-09",
    until: "2027-01-31",
    ...over,
  },
});

describe("the audit allow-list", () => {
  it("accepts a reported advisory with a reason, a review date and an end not yet reached", () => {
    expect(judge(entry(), reported, TODAY)).toEqual({
      failures: [],
      notes: [],
      accepted: ["accepted GHSA-1 deepmerge-ts (until 2027-01-31)"],
    });
  });

  it("fails on an entry without an end, never accepting it for good", () => {
    const { failures, accepted } = judge(entry({ until: undefined }), reported, TODAY);
    expect(failures).toEqual(["allow-list entry GHSA-1: no `until` date (YYYY-MM-DD)"]);
    expect(accepted).toEqual([]);
  });

  it("fails on an expired entry, and on one meant for longer than MAX_DAYS", () => {
    expect(judge(entry({ until: "2026-10-25" }), reported, TODAY).failures).toEqual([
      "allow-list entry GHSA-1: expired on 2026-10-25; review it again",
    ]);
    expect(MAX_DAYS).toBe(120);
    expect(judge(entry({ until: "2027-02-07" }), reported, TODAY).failures).toEqual([
      `allow-list entry GHSA-1: \`until\` is more than ${MAX_DAYS} days after \`reviewed\``,
    ]);
    // The 120th day itself is fine.
    expect(judge(entry({ until: "2027-02-06" }), reported, TODAY).failures).toEqual([]);
  });

  it("fails on an entry without a reason or a review date, or with a date that is no date", () => {
    expect(
      judge(entry({ reason: " ", reviewed: "9 Oct", until: "2027-02-30" }), reported, TODAY)
        .failures,
    ).toEqual([
      "allow-list entry GHSA-1: no reason, no `reviewed` date (YYYY-MM-DD), no `until` date (YYYY-MM-DD)",
    ]);
  });

  it("fails on a reported advisory that is not on the list, and notes an entry no longer needed", () => {
    expect(judge({}, reported, TODAY).failures).toEqual([
      "high GHSA-1 deepmerge-ts: Stack exhaustion",
    ]);
    expect(judge(entry(), new Map(), TODAY)).toMatchObject({
      failures: [],
      notes: ["note: GHSA-1 no longer reported; remove it from the allow-list"],
    });
  });
});
