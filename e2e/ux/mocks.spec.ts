/**
 * The UX review's mock of the public property page in the proposed visual
 * direction (GitLab #132), a static file, photographed beside the
 * screenshots: docs/ux-review/mocks/property.html.
 */
import { resolve } from "node:path";

import { test } from "@playwright/test";

import { save } from "./shared";

const MOCK = `file://${resolve("docs/ux-review/mocks/property.html")}`;

for (const [name, width, height, fullPage] of [
  ["desktop", 1440, 900, true],
  ["phone", 390, 844, false],
  ["phone-full", 390, 844, true],
] as const) {
  test(`mock ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(MOCK);
    await page.evaluate(() => document.fonts.ready);
    await save(page, `../mocks/property-${name}`, fullPage);
  });
}
