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
 * so building an image does not require production secrets. The build still
 * imports server modules to collect page data, so during the build phase the
 * export below is a stand-in that validates on first read instead: importing
 * it is harmless, while actually using a value at build time still fails
 * loudly.
 *
 * Server-side only: these are secrets. Next never inlines a variable without a
 * `NEXT_PUBLIC_` prefix into the client bundle, so importing this from a client
 * component produces a validation failure rather than a leak.
 */
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { z } from "zod";

import { EnvValidationError } from "./env-error";

/**
 * For optional settings: a blank value (`LOG_LEVEL=`) counts as unset, so the
 * default applies, and case does not matter (`INFO`).
 */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
    schema.optional(),
  );
}

/** Like `optional`, but keeping case: for keys and URLs. */
function optionalExact<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    schema.optional(),
  );
}

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

  /**
   * The Google accounts allowed to sign in, comma-separated. Checked at
   * sign-in and on every request, so removing an address locks it out at
   * once. Compared case-insensitively.
   */
  AUTH_ALLOWED_EMAILS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.email("must be a comma-separated list of email addresses"))
        .min(1, "must list at least one email address"),
    ),

  /** Public base URL of this app; OAuth redirect URIs are built from it. */
  APP_URL: z.url({
    protocol: /^https?$/,
    error: "must be an http(s) URL, e.g. http://localhost:3000",
  }),

  /**
   * 32 random bytes, base64: the key that encrypts Google tokens at rest
   * (src/lib/secrets.ts). Optional - without it, connecting Google Calendar
   * is unavailable. Generate one with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  TOKEN_ENCRYPTION_KEY: z.preprocess(
    // Blank means unset; case is kept - this is base64.
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").length === 32,
        "must be 32 random bytes, base64-encoded",
      )
      .optional(),
  ),

  /**
   * How often, in seconds, each synced Google Calendar is checked for changes
   * (inbound sync). At least 60; default 300. Polling needs no inbound
   * connection, so it works for an app that is only reachable on the LAN.
   */
  GOOGLE_CALENDAR_POLL_SECONDS: optional(
    z.coerce.number().int().min(60, "must be at least 60"),
  ).default(300),

  /**
   * How often each booking platform's iCal feed is fetched (src/lib/ical).
   * At least 5; default 30. The platforms themselves refresh their exports
   * only every so often, and some throttle frequent fetches.
   */
  ICAL_POLL_MINUTES: optional(z.coerce.number().int().min(5, "must be at least 5")).default(30),

  /**
   * Failed pushes of one booking's Google event in a row before it is given
   * up on (dead letter): shown as failed, retried only by hand or by a new
   * change to the booking. Default 8 (about 2 hours of backoff).
   */
  GOOGLE_SYNC_MAX_ATTEMPTS: optional(z.coerce.number().int().min(1, "must be at least 1")).default(
    8,
  ),

  /**
   * Inbound sync imports a timed Google event (one with times, not all-day)
   * as a block only if it lasts at least this many hours, so ordinary
   * meetings do not block nights. Default 12.
   */
  GOOGLE_IMPORT_MIN_TIMED_HOURS: optional(z.coerce.number().min(0, "cannot be negative")).default(
    12,
  ),

  /**
   * Optional: the public https base URL at which Google can reach this app,
   * e.g. https://vacation.example.com. When set, Google pushes change
   * notifications to <url>/api/google/webhook, so changes arrive in seconds;
   * polling continues, less often, as a safety net. Leave unset when the app
   * is only reachable on the LAN: polling alone then picks up changes.
   */
  /**
   * Optional: the public base URL at which booking platforms reach this
   * app's iCal export feeds (/api/ical/...), e.g. through a tunnel that
   * exposes only that path. The feed links in settings use it; without it
   * they use APP_URL, which on a LAN-only server the platforms cannot reach.
   */
  ICAL_PUBLIC_URL: optionalExact(
    z.url({
      protocol: /^https?$/,
      error: "must be a public URL, e.g. https://calendar.example.com",
    }),
  ),

  GOOGLE_WEBHOOK_URL: optionalExact(
    z.url({
      protocol: /^https$/,
      error: "must be a public https URL, e.g. https://vacation.example.com",
    }),
  ),

  /**
   * Set to "true" when the app runs behind a reverse proxy that sets
   * X-Forwarded-For: rate limits on sign-in and the webhook then count per
   * client address. Off by default, as the header is trivially forged when
   * clients reach the app directly; those limits then count per route.
   */
  TRUST_PROXY_HEADERS: optional(z.enum(["true", "false", "1", "0", "yes", "no"]))
    .default("false")
    .transform((value) => ["true", "1", "yes"].includes(value)),

  /**
   * Earlier TOKEN_ENCRYPTION_KEY values, comma-separated, kept readable
   * during a key rotation: tokens sealed under them still decrypt until
   * `npm run tokens:rotate` has sealed them all under the current key.
   * See docs/security.md.
   */
  TOKEN_ENCRYPTION_KEYS_OLD: optionalExact(
    z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z
            .string()
            .refine(
              (key) => Buffer.from(key, "base64").length === 32,
              "each must be 32 random bytes, base64-encoded",
            ),
        ),
      ),
  ).default([]),

  /**
   * Where receipts on transactions are kept (GitLab #82): files named by
   * their SHA-256. Default ./data/receipts, relative to where the app runs;
   * production mounts the `receipts` volume at /data/receipts.
   */
  RECEIPTS_DIR: optionalExact(z.string().min(1)).default("./data/receipts"),

  /** Minimum level written by the logger in src/lib/logger.ts. */
  LOG_LEVEL: optional(z.enum(["trace", "debug", "info", "warn", "error", "fatal"])).default("info"),

  /**
   * Enables GET /api/debug/error, which throws on purpose so the error
   * tracker can be checked end to end. Off unless set to "true" (or 1/yes).
   */
  ENABLE_ERROR_TEST_ROUTE: optional(z.enum(["true", "false", "1", "0", "yes", "no"]))
    .default("false")
    .transform((value) => ["true", "1", "yes"].includes(value)),
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
      .filter(([, value]) => JSON.stringify(value ?? "").includes("replace-me"))
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

/** Defers validation to the first time anything inspects the object. */
function loadOnFirstRead(): Env {
  let loaded: Env | undefined;
  const real = () => (loaded ??= loadEnv());
  return new Proxy({} as Env, {
    get: (_target, name) => Reflect.get(real(), name),
    has: (_target, name) => Reflect.has(real(), name),
    ownKeys: () => Reflect.ownKeys(real()),
    getOwnPropertyDescriptor: (_target, name) => Reflect.getOwnPropertyDescriptor(real(), name),
  });
}

export const env: Env =
  process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ? loadOnFirstRead() : loadEnv();
