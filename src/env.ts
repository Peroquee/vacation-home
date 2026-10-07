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

import { EnvValidationError } from "./env-error";

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

    // Thrown rather than written and exited here: this module has no business
    // deciding how the process dies, and throwing keeps it usable from any
    // runtime. src/instrumentation.ts turns this into a clean boot failure.
    throw new EnvValidationError(
      `Invalid environment configuration:\n\n${problems}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  // The placeholders in .env.example are valid on purpose, so that a fresh
  // checkout can boot before Google OAuth exists. They must never reach a
  // deployed environment: a known AUTH_SECRET means forgeable sessions.
  if (process.env.NODE_ENV === "production") {
    const unreplaced = Object.entries(parsed.data)
      .filter(([, value]) => value.includes("replace-me"))
      .map(([name]) => `  ${name}: still set to the .env.example placeholder`);

    if (unreplaced.length > 0) {
      throw new EnvValidationError(
        [
          "Invalid environment configuration:",
          "",
          ...unreplaced,
          "",
          "Replace the placeholder values before running in production.",
        ].join("\n"),
      );
    }
  }

  return parsed.data;
}

export const env = loadEnv();
