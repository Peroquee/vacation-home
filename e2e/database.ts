/**
 * The disposable database the end-to-end run uses. It lives on the same
 * server as the development database (the Compose `db` service, or the
 * `postgres` service in CI) and is dropped and recreated before every run.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://vacation:vacation@localhost:5433/vacation_home_e2e";
