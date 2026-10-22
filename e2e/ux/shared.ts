/** What the UX review's specs share (GitLab #132). */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Page } from "@playwright/test";
import sharp from "sharp";

export type Seeded = {
  today: string;
  lake: { id: string; slug: string };
  cabin: { id: string; slug: string };
  bookings: { current: string; reserved: string; confirmed: string; cancelled: string };
  guest: string;
  guestPath: string;
};

export const SCREENS = "docs/ux-review/screens";

export const seeded = (): Seeded => JSON.parse(readFileSync("e2e/.auth/ux-seed.json", "utf8"));

export const VARIANTS = [
  { name: "phone", viewport: { width: 390, height: 844 }, dark: false },
  { name: "phone-dark", viewport: { width: 390, height: 844 }, dark: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, dark: false },
  { name: "desktop-dark", viewport: { width: 1440, height: 900 }, dark: true },
] as const;

/** Waits for the page to settle and photographs all of it. */
export async function shoot(
  page: Page,
  file: string,
  dark: boolean,
  fullPage = true,
): Promise<void> {
  await page.waitForLoadState("networkidle");
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  // Fonts and lazy pictures above the fold.
  await page.evaluate(() => document.fonts.ready);
  await save(page, file, fullPage);
}

const WEBP_MAX = 16_383;

/**
 * Photographs the page into SCREENS/<file>.webp: WebP rather than PNG keeps
 * the committed set a few megabytes, and GitLab shows it inline.
 */
export async function save(page: Page, file: string, fullPage: boolean): Promise<void> {
  const png = await page.screenshot({ fullPage, animations: "disabled" });
  const path = `${SCREENS}/${file}.webp`;
  mkdirSync(dirname(path), { recursive: true });
  // WebP stops at 16383 pixels a side; a page that long is cut there.
  const { height = 0 } = await sharp(png).metadata();
  const image = sharp(png);
  if (height > WEBP_MAX) {
    console.log(`${file}: ${height} px tall, cut at ${WEBP_MAX}`);
    image.extract({ left: 0, top: 0, width: page.viewportSize()!.width, height: WEBP_MAX });
  }
  await image.webp({ quality: 80 }).toFile(path);
}
