/**
 * The seed script wipes the app's data before writing demo data, so it runs
 * only against a development database: never in production, only on this
 * machine or the Compose network, and never on the test databases the test
 * suites reset themselves.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "db"];

export function seedRefusal(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  if (nodeEnv === "production") return "NODE_ENV is production";
  if (!databaseUrl) return "DATABASE_URL is not set";

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  // The pg driver lets these query parameters override the host and database
  // in the URL, which would let a URL look local while connecting elsewhere.
  const overrides = ["host", "hostaddr", "dbname", "database"].filter((p) =>
    url.searchParams.has(p),
  );
  if (overrides.length > 0) {
    return `DATABASE_URL overrides the connection with ?${overrides.join(", ?")}`;
  }
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    return `the database host "${url.hostname}" is not local (${LOCAL_HOSTS.join(", ")})`;
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (/_(test|e2e)$/.test(name)) return `"${name}" is a test database`;
  return null;
}
