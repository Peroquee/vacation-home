/** Arrival and departure times (GitLab #126): checked, kept and worded. */
import { describe, expect, it } from "vitest";

import { parseStayTimes, stayTimesSchema } from "./schema";
import { describeStayTimes, NO_STAY_TIMES } from "./stay-times";

const t = (key: string, values?: Record<string, string>) =>
  `${key}(${Object.values(values ?? {}).join(",")})`;

describe("the times", () => {
  it("are HH:MM or unset, blanks unset", () => {
    expect(
      stayTimesSchema.parse({ checkInTime: "15:00", earliestCheckOutTime: "", checkOutTime: null }),
    ).toEqual({ checkInTime: "15:00", earliestCheckOutTime: null, checkOutTime: null });
    expect(stayTimesSchema.parse({})).toEqual(NO_STAY_TIMES);
  });

  it("refuse what is no time, each on its own field", () => {
    const result = stayTimesSchema.safeParse({ checkInTime: "25:00", checkOutTime: "10" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "checkInTime",
      "checkOutTime",
    ]);
  });

  it("refuse an earliest departure after the latest, on the earliest", () => {
    const result = stayTimesSchema.safeParse({
      earliestCheckOutTime: "11:00",
      checkOutTime: "10:00",
    });
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "earliestCheckOutTime",
    ]);
    expect(
      stayTimesSchema.safeParse({ earliestCheckOutTime: "10:00", checkOutTime: "10:00" }).success,
    ).toBe(true);
  });

  it("are read back from a booking's snapshot, nothing else", () => {
    const times = { checkInTime: "15:00", earliestCheckOutTime: null, checkOutTime: "10:00" };
    expect(parseStayTimes(times)).toEqual(times);
    expect(parseStayTimes(null)).toBeNull();
    expect(parseStayTimes({ checkInTime: "3 pm" })).toBeNull();
  });
});

describe("their wording", () => {
  it("names what is set, the departure as a window when both ends are", () => {
    const all = { checkInTime: "15:00", earliestCheckOutTime: "08:00", checkOutTime: "10:00" };
    expect(describeStayTimes(t, all)).toBe("arrival(15:00) · departureBetween(08:00,10:00)");
    expect(describeStayTimes(t, { ...all, earliestCheckOutTime: "10:00" })).toBe(
      "arrival(15:00) · departureAt(10:00)",
    );
    expect(describeStayTimes(t, { ...all, checkOutTime: null })).toBe(
      "arrival(15:00) · departureFrom(08:00)",
    );
    expect(describeStayTimes(t, { ...all, checkInTime: null, earliestCheckOutTime: null })).toBe(
      "departureUntil(10:00)",
    );
    expect(describeStayTimes(t, NO_STAY_TIMES)).toBeNull();
  });
});
