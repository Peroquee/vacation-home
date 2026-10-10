import { expect, test } from "@playwright/test";

// Auth.js's own URLs (GitLab #96): behind a reverse proxy the server only
// sees the address the proxy connects to (127.0.0.1, 0.0.0.0), and it must
// still hand out APP_URL's address for sign-in and the OAuth callback -
// whatever forwarded headers say.

test.use({ storageState: { cookies: [], origins: [] } });

test("Auth.js reports APP_URL's address however the request reaches it", async ({
  request,
  baseURL,
}) => {
  const direct = new URL(baseURL!);
  direct.hostname = "127.0.0.1";
  const response = await request.get(new URL("/api/auth/providers", direct).toString(), {
    headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https" },
  });
  expect(response.ok()).toBe(true);
  const { google } = await response.json();
  expect(google.signinUrl).toBe(`${baseURL}/api/auth/signin/google`);
  expect(google.callbackUrl).toBe(`${baseURL}/api/auth/callback/google`);
});
