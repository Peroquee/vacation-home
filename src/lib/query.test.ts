import { describe, expect, it } from "vitest";

import { queryParams } from "@/lib/query";

describe("queryParams", () => {
  it("joins a repeated parameter with commas, like the comma form", () => {
    expect(queryParams(new Request("http://x/?c=a&c=b&d=1"))).toEqual({ c: "a,b", d: "1" });
    expect(queryParams(new Request("http://x/?c=a,b"))).toEqual({ c: "a,b" });
  });
});
