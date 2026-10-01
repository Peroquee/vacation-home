/**
 * Validated environment configuration.
 *
 * This is the only module that reads `process.env`. An ESLint rule
 * (`no-restricted-properties`) keeps direct reads out of the rest of the app —
 * a guard rail rather than a proof, since an indirect read such as
 * `const p = process; p.env.X` still slips past it.
 *
 * Validation runs when a server process boots, via `register()` in
 * `src/instrumentation.ts`. It deliberately does not run during `next build`,
 * so building an image does not require production secrets.
 *
 * Server-side only: these are secrets. Next never inlines a variable without a
 * `NEXT_PUBLIC_` prefix into the client bundle, so importing this from a client
 * component produces a validation failure rather than a leak.
 */
import { z } from "zod";

const envSchema = z.object({
  /** PostgreSQL connection string used by Prisma. */
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: "must be a postgres:// or postgresql:// connection string",
  }),

  /** Signing key for Auth.js sessions. Generate one with `npx auth secret`. */
  AUTH_SECRET: z.string().trim().min(32, "must be at least 32 characters"),

  /** Google OAuth client. The same client later requests the Calendar scopes. */
  AUTH_GOOGLE_ID: z.string().trim().min(1, "is required"),
  AUTH_GOOGLE_SECRET: z.string().trim().min(1, "is required"),

  /** Public base URL of this app; OAuth redirect URIs are built from it. */
  APP_URL: z.url({
    protocol: /^https?$/,
    error: "must be an http(s) URL, e.g. http://localhost:3000",
  }),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    // Thrown rather than `console.error` followed by `process.exit(1)`: an
    // uncaught throw reaches stderr synchronously, so the diagnostic cannot be
    // lost when stderr is a pipe (CI logs, `docker build`), and it works in the
    // Edge runtime, where `process.exit` does not exist.
    throw new Error(
      `Invalid environment configuration:\n\n${problems}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();
