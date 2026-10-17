import { describe, expect, it } from "vitest";

import { pickText, shortened } from "./public";

describe("a description on the start page", () => {
  it("is kept whole when short, on one line", () => {
    expect(shortened("A quiet home.\n\nBy the water.")).toBe("A quiet home. By the water.");
  });

  it("is cut at a word, with an ellipsis, when long", () => {
    const text = `${"word ".repeat(40)}end`;
    const short = shortened(text, 30);
    expect(short).toBe("word word word word word word…");
    expect(short.length).toBeLessThanOrEqual(31);
  });

  it("drops punctuation left at the cut", () => {
    expect(shortened("First part, second part, third part", 12)).toBe("First part…");
  });

  it("cuts mid-word only when there is no space to cut at", () => {
    expect(shortened("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("text in the visitor's language", () => {
  it("falls back to the other language", () => {
    expect(pickText({ en: "Lake", de: "" }, "de-DE")).toBe("Lake");
    expect(pickText({ en: "", de: "See" }, "en-GB")).toBe("See");
  });
});
