/**
 * The disposable database the end-to-end run uses. It lives on the same
 * server as the development database (the Compose `db` service, or the
 * `postgres` service in CI) and is reset by e2e/reset-database.mjs before
 * every run.
 *
 * Tests arrange data with plain `pg`, not the generated Prisma client: that
 * client is ESM, and Playwright loads TypeScript in this package as CommonJS.
 */
import { Client } from "pg";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://vacation:vacation@localhost:5433/vacation_home_e2e";

/** Runs `fn` with a connection to the e2e database, closing it afterwards. */
export async function withE2eDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** The signed-in user every e2e test runs as; on the e2e allow-list. */
export const E2E_USER = { name: "E2E Owner", email: "e2e-owner@example.test" };

/** Where the setup project saves the signed-in browser state. */
export const STORAGE_STATE = "e2e/.auth/session.json";

/**
 * A real database session for `email`, as Auth.js would create after a Google
 * sign-in. Returns the token for the session cookie. No test-only code path
 * exists in the app: the tests hold a genuine session, and a production
 * deployment has no way to mint one without Google.
 */
export async function createSession(
  user: { name: string; email: string },
  { days = 1 }: { days?: number } = {},
): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await withE2eDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (name, email, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [user.name, user.email],
    );
    await db.query(
      `INSERT INTO sessions (session_token, user_id, expires)
       VALUES ($1, $2, now() + make_interval(days => $3))`,
      [token, rows[0]!.id, days],
    );
  });
  return token;
}

/** Auth.js's session cookie, as set over plain http. */
export function sessionCookie(token: string, baseURL: string) {
  return {
    name: "authjs.session-token",
    value: token,
    domain: new URL(baseURL).hostname,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
    expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };
}

/**
 * Fills in the legal pages (GitLab #112), without which no property can be
 * listed: the setup project does it once, so specs can list properties;
 * e2e/legal.spec.ts empties and restores them.
 */
export async function fillLegal(db: Client): Promise<void> {
  await db.query(
    `INSERT INTO site_legal (id, imprint_name, imprint_address, imprint_email,
       privacy_policy_de, privacy_policy_en, updated_at)
     VALUES (1, 'E2E Owner', 'Seestraße 1\n12345 Seedorf', 'owner@e2e.example.test',
       '## Datenschutz\n\nE2E.', '## Privacy\n\nE2E.', now())
     ON CONFLICT (id) DO UPDATE SET imprint_name = EXCLUDED.imprint_name,
       imprint_address = EXCLUDED.imprint_address, imprint_email = EXCLUDED.imprint_email,
       privacy_policy_de = EXCLUDED.privacy_policy_de,
       privacy_policy_en = EXCLUDED.privacy_policy_en, updated_at = now()`,
  );
}
