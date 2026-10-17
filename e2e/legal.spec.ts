import { expect, test } from "@playwright/test";

import { fillLegal, withE2eDb } from "./database";

// The legal pages and the go-live gate (GitLab #112), on the built server:
// with them empty, no property can be listed; the owner fills them in in
// settings (the privacy policy from the template), the public pages show
// them, and listing works. The setup project fills them in for every other
// spec, so this one empties them first and puts them back afterwards.

test.beforeEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM site_legal");
  });
});

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.query("UPDATE properties SET publicly_listed = false");
    await db.query("DELETE FROM properties");
    await fillLegal(db);
  });
});

test("the site goes live once the imprint and privacy policy are filled in", async ({
  page,
  request,
  browser,
}) => {
  const property = (await (
    await request.post("/api/properties", {
      data: { name: "Legal Lake", timezone: "UTC", currency: "EUR", slug: "legal-lake" },
    })
  ).json()) as { id: string };

  // Nothing to show yet, and listing is refused.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const publicPage = await visitor.newPage();
  await publicPage.goto("/stay/legal/imprint");
  await expect(publicPage.getByText("This page is not available yet.")).toBeVisible();
  const refused = await request.patch(`/api/properties/${property.id}`, {
    data: { publiclyListed: true },
  });
  expect(refused.status()).toBe(422);

  await page.goto("/settings");
  const checklist = page.locator("#go-live");
  await expect(checklist).toContainText("no property can be listed");
  await expect(checklist).toContainText("Legal Lake: no bank details");
  await page.getByRole("button", { name: "Edit Legal Lake" }).click();
  const propertyDialog = page.getByRole("dialog");
  await expect(
    propertyDialog.getByRole("checkbox", { name: "Show on the public booking site" }),
  ).toBeDisabled();
  await propertyDialog.getByRole("button", { name: "Cancel" }).click();

  // The imprint...
  await page.getByRole("button", { name: "Edit imprint" }).click();
  const imprint = page.getByRole("dialog");
  await imprint.getByLabel("Name", { exact: true }).fill("Ada Owner");
  await imprint.getByLabel("Address", { exact: true }).fill("Seestraße 1\n12345 Seedorf");
  await imprint.getByLabel("Email", { exact: true }).fill("ada@e2e.example.test");
  await imprint.getByLabel("VAT ID (optional)").fill("DE123456789");
  await imprint.getByRole("button", { name: "Save" }).click();
  await expect(imprint).toBeHidden();

  // ...and the privacy policy, from the template, which names the owner.
  await page.getByRole("button", { name: "Edit privacy policy" }).click();
  const privacy = page.getByRole("dialog");
  await expect(privacy.getByLabel("English", { exact: true })).toHaveValue(
    /Template, not legal advice/,
  );
  await expect(privacy.getByLabel("English", { exact: true })).toHaveValue(
    /Ada Owner {2}\nSeestraße 1/,
  );
  await expect(privacy.getByLabel("German", { exact: true })).toHaveValue(
    /Vorlage, keine Rechtsberatung/,
  );
  await privacy.getByRole("button", { name: "Save" }).click();
  await expect(privacy).toBeHidden();
  await expect(checklist).toContainText("The public booking site has what it needs");
  await expect(checklist).toContainText("still has the template's note");

  // The public pages show them, linked from every page's footer.
  await publicPage.goto("/stay/legal/imprint");
  await expect(publicPage.getByRole("heading", { name: "Imprint", level: 1 })).toBeVisible();
  await expect(publicPage.getByText("Ada Owner")).toBeVisible();
  await expect(publicPage.getByRole("link", { name: "ada@e2e.example.test" })).toHaveAttribute(
    "href",
    "mailto:ada@e2e.example.test",
  );
  await expect(publicPage.getByText("DE123456789")).toBeVisible();
  await publicPage.getByRole("link", { name: "Privacy policy" }).click();
  await expect(publicPage).toHaveURL(/\/stay\/legal\/privacy$/);
  await expect(publicPage.getByRole("heading", { name: "1. Controller" })).toBeVisible();
  // The template's marker is an HTML comment, which is never rendered.
  expect(await publicPage.content()).not.toContain("<!-- template -->");

  const german = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    locale: "de-DE",
  });
  const germanPage = await german.newPage();
  await germanPage.goto("/stay/legal/privacy");
  await expect(
    germanPage.getByRole("heading", { name: "Datenschutzerklärung", level: 1 }),
  ).toBeVisible();
  await expect(germanPage.getByRole("heading", { name: "1. Verantwortlicher" })).toBeVisible();
  await german.close();

  // Now the property can be listed - and the legal pages not emptied.
  await page.reload();
  await page.getByRole("button", { name: "Edit Legal Lake" }).click();
  const listing = page.getByRole("dialog");
  await listing.getByRole("checkbox", { name: "Show on the public booking site" }).click();
  await listing.getByRole("button", { name: "Save" }).click();
  await expect(listing).toBeHidden();
  expect((await publicPage.goto("/stay/legal-lake"))?.status()).toBe(200);

  const emptied = await request.put("/api/legal", {
    data: { imprintName: "Ada Owner", imprintAddress: "Seestraße 1", imprintEmail: null },
  });
  expect(emptied.status()).toBe(422);
  expect((await emptied.json()).error.fields).toMatchObject({
    imprintEmail: ["is required while a property is listed"],
    privacyPolicyDe: ["is required while a property is listed"],
  });
  await visitor.close();
});

test("owner-written Markdown is shown without HTML or unsafe links", async ({
  request,
  browser,
}) => {
  const saved = await request.put("/api/legal", {
    data: {
      imprintName: "Ada Owner",
      imprintAddress: "Seestraße 1",
      imprintEmail: "ada@e2e.example.test",
      imprintExtra: "[Authority](https://authority.example.test) <b onclick=alert(1)>x</b>",
      privacyPolicyDe: "## Datenschutz",
      privacyPolicyEn:
        '## Privacy\n\n<script>window.pwned = true</script>\n\n[bad](javascript:window.pwned=true) <img src="https://tracker.example.test/p.png">',
    },
  });
  expect(saved.status()).toBe(200);

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await visitor.newPage();
  await page.goto("/stay/legal/privacy");
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.locator("script, img, [onclick]")).toHaveCount(0);
  await expect(main.getByRole("link")).toHaveCount(0);
  await expect(main.getByText("bad")).toBeVisible();
  expect(await page.evaluate(() => (window as { pwned?: boolean }).pwned)).toBeUndefined();

  await page.goto("/stay/legal/imprint");
  await expect(page.getByRole("link", { name: "Authority" })).toHaveAttribute(
    "href",
    "https://authority.example.test",
  );
  await expect(page.getByRole("main").locator("[onclick], b")).toHaveCount(0);
  await visitor.close();
});
