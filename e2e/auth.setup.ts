import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { test as setup } from "@playwright/test";

import { createSession, E2E_USER, sessionCookie, STORAGE_STATE } from "./database";

/** Signs the e2e user in once, for every test that does not opt out. */
setup("sign in", async ({ baseURL }) => {
  const token = await createSession(E2E_USER);
  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  await writeFile(
    STORAGE_STATE,
    JSON.stringify({ cookies: [sessionCookie(token, baseURL!)], origins: [] }),
  );
});
