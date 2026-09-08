/**
 * Validated environment configuration.
 *
 * This is the only module allowed to read `process.env` — an ESLint rule
 * (`no-restricted-properties`) enforces that everywhere else. Every other
 * module imports the typed `env` object below, so a missing or malformed
 * variable fails loudly here at boot instead of surfacing as `undefined` at
 * the first database query or Google API call.
 *
 * Server-only: these values include secrets and must never be imported from a
 * client component.
 */
import { z } from "zod";

const envSchema = z.object({
  /** PostgreSQL connection string used by Prisma. */
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: "must be a postgres:// or postgresql:// connection string",
  }),

  /** Signing key for Auth.js sessions. Generate one with `npx auth secret`. */
  AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),

  /** Google OAuth client. The same client later requests the Calendar scopes. */
  AUTH_GOOGLE_ID: z.string().min(1, "is required"),
  AUTH_GOOGLE_SECRET: z.string().min(1, "is required"),

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

    console.error(
      `\nInvalid environment configuration:\n\n${problems}\n\n` +
        `Copy .env.example to .env and fill in the missing values.\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
