import { describe, expect, it } from "vitest";

import { initials } from "@/lib/initials";

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Grace Brewster Murray Hopper")).toBe("GB");
  });

  it("splits on any run of whitespace", () => {
    expect(initials("  ada \t lovelace\n")).toBe("AL");
  });

  it("keeps a single name to one letter", () => {
    expect(initials("Cher")).toBe("C");
  });

  it("falls back to a placeholder for a blank name", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
