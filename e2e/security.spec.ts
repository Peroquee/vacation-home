import { expect, test } from "@playwright/test";

test("pages carry a nonce-based CSP that the app runs under without violations", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto("/calendar");
  const csp = response!.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  // Interactive, so its scripts ran: open the account menu.
  await page
    .getByRole("button", { name: /Account menu for/ })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  for (const path of ["/bookings", "/finance", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test("every response carries the security headers, a nonce new each time", async ({ request }) => {
  const [first, second, api] = await Promise.all([
    request.get("/calendar"),
    request.get("/calendar"),
    request.get("/api/properties"),
  ]);
  const nonce = (r: typeof first) =>
    /'nonce-([^']+)'/.exec(r.headers()["content-security-policy"])?.[1];
  expect(nonce(first)).toBeTruthy();
  expect(nonce(first)).not.toBe(nonce(second));
  expect(api.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  for (const response of [first, api]) {
    expect(response.headers()).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
  }
});

test("a cross-site write to the API is refused, a same-origin one is not", async ({
  request,
  baseURL,
}) => {
  const forged = await request.post("/api/properties", {
    data: { name: "Cross-site", timezone: "UTC", currency: "EUR" },
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  expect(forged.status()).toBe(403);
  expect((await forged.json()).error.code).toBe("forbidden");

  // Same origin: past the CSRF check, so the body is judged (and refused,
  // leaving nothing behind for other tests).
  const own = await request.post("/api/properties", {
    data: { name: "" },
    headers: { origin: new URL(baseURL!).origin, "sec-fetch-site": "same-origin" },
  });
  expect(own.status()).toBe(422);
});
