import { expect, test } from "@playwright/test";

import { appRoutes, PUBLIC_ROUTES, START_PAGE_ROOT } from "./app-routes";
import { withE2eDb } from "./database";

// The public booking site's boundary (GitLab #105): without a session, only
// the allow-listed routes answer, and the public pages never set a session
// cookie or show an unlisted property.

const ROUTES = appRoutes();

test.afterEach(async () => {
  await withE2eDb((db) => db.query("DELETE FROM properties WHERE name LIKE 'Public site %'"));
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every route outside the allow-list refuses a visitor", async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    let checked = 0;
    const closed = ROUTES.filter(
      (r) => !PUBLIC_ROUTES.includes(r.route) && r.route !== START_PAGE_ROOT,
    );
    for (const route of closed) {
      for (const method of route.methods) {
        const response = await request.fetch(route.path, {
          method,
          maxRedirects: 0,
          // Same-origin, so the CSRF check lets it reach the session check.
          headers: { origin, "sec-fetch-site": "same-origin" },
        });
        const label = `${method} ${route.route}`;
        if (route.kind === "api") {
          expect(response.status(), label).toBe(401);
        } else {
          expect(response.status(), label).toBe(307);
          expect(response.headers().location, label).toMatch(/\/signin\?callbackUrl=/);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  test("the root is the public start page, without any session cookie", async ({ request }) => {
    await withE2eDb((db) => db.query("UPDATE properties SET publicly_listed = false"));
    // The API context sends no Accept-Language; the page would be German.
    const response = await request.get(START_PAGE_ROOT, {
      maxRedirects: 0,
      headers: { "accept-language": "en-GB" },
    });
    // No property is listed here: the start page's neutral note, not sign-in.
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.headers()["content-security-policy"]).toContain("nonce-");
    expect(await response.text()).toContain("Coming soon");
  });

  test("a dead session at the root gets the start page and only that session cleared", async ({
    playwright,
    baseURL,
  }) => {
    await withE2eDb((db) => db.query("UPDATE properties SET publicly_listed = false"));
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        cookie: "authjs.session-token=no-such-session",
        "accept-language": "en-GB",
      },
    });
    const response = await request.get(START_PAGE_ROOT, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Coming soon");
    // No Auth.js helper cookie (CSRF token, callback URL); at most the dead
    // session's own cookie, emptied.
    const cookies = response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
    for (const { value } of cookies) expect(value).toMatch(/^(__Secure-)?authjs\.session-token=;/);
    await request.dispose();
  });

  test("robots.txt lets search engines see the public pages only", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("Allow: /$");
    expect(text).toContain("Allow: /stay");
    expect(text).toContain("Disallow: /");
  });
});

test.describe("a listed property", () => {
  test("has a public page and API answer, without any session cookie", async ({
    request,
    browser,
  }) => {
    const created = await request.post("/api/properties", {
      data: {
        name: "Public site Lake House",
        address: "Seestraße 1, 12345 Secretville",
        timezone: "Europe/Berlin",
        currency: "EUR",
        slug: "public-site-lake-house",
        publiclyListed: true,
      },
    });
    expect(created.status()).toBe(201);

    // A stranger: no cookies at all.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/.test(message.text()))
        violations.push(message.text());
    });
    const response = await page.goto("/stay/public-site-lake-house");
    expect(response!.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Public site Lake House" }),
    ).toBeVisible();
    // No app shell - neither its navigation nor the account menu - and
    // nothing private. Only the public footer's legal links.
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /account/i })).toHaveCount(0);
    const legal = page.getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link")).toHaveText(["Imprint", "Privacy policy"]);
    // The owner's way in, beside the legal links rather than among them.
    await expect(page.getByRole("link", { name: "Owner sign-in" })).toHaveAttribute(
      "href",
      "/signin",
    );
    await expect(page.getByText("Secretville")).toHaveCount(0);
    const headers = response!.headers();
    expect(headers["set-cookie"]).toBeUndefined();
    expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(headers["content-security-policy"]).toContain("form-action 'self';");
    expect(headers["content-security-policy"]).not.toContain("googleusercontent");
    expect(await context.cookies()).toEqual([]);
    expect(violations).toEqual([]);

    const api = await context.request.get("/api/public/properties/public-site-lake-house");
    expect(api.status()).toBe(200);
    const body = await api.json();
    // Untitled yet: the property's name stands in (GitLab #106 adds the profile).
    expect(body).toMatchObject({
      slug: "public-site-lake-house",
      title: { en: "Public site Lake House", de: "" },
      currency: "EUR",
      photos: [],
    });
    expect(JSON.stringify(body)).not.toContain("Secretville");
    expect(api.headers()["set-cookie"]).toBeUndefined();
    await context.close();
  });

  test("never refreshes or sets the owner's session cookie either", async ({ request }) => {
    await request.post("/api/properties", {
      data: {
        name: "Public site Sea View",
        timezone: "Europe/Berlin",
        currency: "EUR",
        slug: "public-site-sea-view",
        publiclyListed: true,
      },
    });
    // `request` carries the owner's session.
    for (const path of [
      "/stay/public-site-sea-view",
      "/api/public/properties/public-site-sea-view",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["set-cookie"], path).toBeUndefined();
    }
  });
});

test("an unlisted, archived or unknown property is the same 404", async ({ request, browser }) => {
  const property = await (
    await request.post("/api/properties", {
      data: {
        name: "Public site Hidden",
        timezone: "Europe/Berlin",
        currency: "EUR",
        slug: "public-site-hidden",
      },
    })
  ).json();
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const expectHidden = async () => {
    for (const path of ["/stay/public-site-hidden", "/api/public/properties/public-site-hidden"]) {
      expect((await stranger.request.get(path)).status(), path).toBe(404);
    }
  };

  // Unlisted (the default).
  await expectHidden();

  // Listed, then archived.
  const listed = await request.patch(`/api/properties/${property.id}`, {
    data: { publiclyListed: true },
  });
  expect((await listed.json()).publiclyListed).toBe(true);
  expect((await stranger.request.get("/stay/public-site-hidden")).status()).toBe(200);
  await request.post(`/api/properties/${property.id}/archive`);
  await expectHidden();

  // Unknown, and not a slug at all.
  expect((await stranger.request.get("/stay/no-such-place")).status()).toBe(404);
  expect((await stranger.request.get("/api/public/properties/..%2Fproperties")).status()).toBe(404);
  await stranger.close();
});

test("listing needs a slug, and a slug belongs to one property", async ({ request }) => {
  const property = await (
    await request.post("/api/properties", {
      data: { name: "Public site First", timezone: "Europe/Berlin", currency: "EUR" },
    })
  ).json();
  const unlisted = await request.patch(`/api/properties/${property.id}`, {
    data: { publiclyListed: true },
  });
  expect(unlisted.status()).toBe(422);
  expect((await unlisted.json()).error.fields.publiclyListed).toEqual([
    "needs a web address (slug) first",
  ]);

  await request.patch(`/api/properties/${property.id}`, { data: { slug: "Public-Site-First" } });
  expect((await (await request.get(`/api/properties/${property.id}`)).json()).slug).toBe(
    "public-site-first",
  );
  const taken = await request.post("/api/properties", {
    data: {
      name: "Public site Second",
      timezone: "Europe/Berlin",
      currency: "EUR",
      slug: "public-site-first",
    },
  });
  expect(taken.status()).toBe(422);
  expect((await taken.json()).error.fields.slug).toEqual(["is already used by another property"]);
});
