import { describe, expect, it } from "vitest";

import { readGuide } from "./guide";

// GitLab #128: /help shows the guide in the user's language, English otherwise.
describe("readGuide", () => {
  it("reads the guide of each language", async () => {
    expect(await readGuide("de-DE")).toMatch(/^# Benutzerhandbuch\n/);
    expect(await readGuide("en-GB")).toMatch(/^# User guide\n/);
  });

  it("falls back to English for a language without one", async () => {
    expect(await readGuide("fr-FR")).toMatch(/^# User guide\n/);
  });
});
