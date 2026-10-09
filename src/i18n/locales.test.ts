import { describe, expect, it } from "vitest";

import { resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("follows the cookie first", () => {
    expect(resolveLocale({ cookie: "en-GB", acceptLanguage: "de-DE" })).toBe("en-GB");
  });

  it("ignores an unknown cookie", () => {
    expect(resolveLocale({ cookie: "fr-FR", acceptLanguage: "en-US" })).toBe("en-GB");
  });

  it("matches the browser's languages by language, in order of preference", () => {
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en-GB");
    expect(resolveLocale({ acceptLanguage: "de-AT,de;q=0.9,en;q=0.8" })).toBe("de-DE");
    expect(resolveLocale({ acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.7,de;q=0.8" })).toBe("de-DE");
    expect(resolveLocale({ acceptLanguage: "en;q=0,de;q=0.5" })).toBe("de-DE");
  });

  it("speaks German when nothing else is known", () => {
    expect(resolveLocale({})).toBe("de-DE");
    expect(resolveLocale({ acceptLanguage: "fr-FR,*" })).toBe("de-DE");
  });
});
