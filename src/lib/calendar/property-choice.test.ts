import { describe, expect, it } from "vitest";

import { choiceCookie, resolveChoice } from "./property-choice";

const propertyIds = ["lake", "sea"];

describe("resolveChoice", () => {
  it("follows the URL first", () => {
    expect(resolveChoice({ param: "sea", cookie: "u1:lake", userId: "u1", propertyIds })).toBe(
      "sea",
    );
    expect(resolveChoice({ param: "all", cookie: "u1:lake", userId: "u1", propertyIds })).toBe(
      "all",
    );
  });

  it("falls back to the user's own remembered choice", () => {
    expect(resolveChoice({ cookie: choiceCookie("u1", "lake"), userId: "u1", propertyIds })).toBe(
      "lake",
    );
    // Another user's cookie on the same browser is ignored.
    expect(resolveChoice({ cookie: "u2:lake", userId: "u1", propertyIds })).toBe("all");
  });

  it("ignores properties that no longer exist", () => {
    expect(resolveChoice({ param: "gone", cookie: "u1:gone", userId: "u1", propertyIds })).toBe(
      "all",
    );
  });

  it("shows all by default", () => {
    expect(resolveChoice({ propertyIds })).toBe("all");
  });
});
