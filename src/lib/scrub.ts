/**
 * Removes personal data and credentials from anything about to leave the
 * process: log lines and error-tracker events.
 *
 * Two layers, because neither is enough alone:
 * - by key: the value of any property whose name says it is sensitive
 *   (email, token, password, authorization, cookie, ...) is replaced whole;
 * - by content: inside every string, email addresses, bearer tokens, JWTs,
 *   Google OAuth tokens and token-bearing query parameters are masked - so an
 *   error message such as "No guest ada@example.com" is caught too.
 *
 * Runs in the browser as well as on the server, so no Node APIs here.
 */

export const REDACTED = "[redacted]";

// Matched anywhere in the key, lower-cased with `_` and `-` removed, so
// `access_token`, `accessToken`, `Access-Token` and `guestEmail` all match.
// Over-matching (`tokenCount`) costs a redacted number; under-matching leaks.
const SENSITIVE_KEY =
  /email|phone|password|passwd|secret|token|authorization|cookie|apikey|credential|dsn/;

const SENSITIVE_STRINGS: [RegExp, string][] = [
  // OAuth tokens and codes passed in a URL or form body.
  [/\b(access_token|refresh_token|id_token|client_secret|code)=[^&\s"']+/gi, `$1=${REDACTED}`],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`],
  // JSON Web Tokens, e.g. Google ID tokens.
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
  // Google OAuth access tokens and refresh tokens.
  [/\bya29\.[\w.-]+/g, REDACTED],
  [/\b1\/\/[\w-]{20,}/g, REDACTED],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]"],
];

export function scrubString(value: string): string {
  return SENSITIVE_STRINGS.reduce((text, [pattern, mask]) => text.replace(pattern, mask), value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[-_]/g, ""));
}

const MAX_DEPTH = 12;

/**
 * Returns a scrubbed deep copy of `value`. Errors become plain
 * `{ type, message, stack }` objects (plus any own properties), scrubbed like
 * everything else; the input is never modified.
 */
export function scrub(value: unknown): unknown {
  return scrubValue(value, 0, new WeakSet());
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[too deep]";
  seen.add(value);

  if (value instanceof Date) return value;

  if (value instanceof Error) {
    const plain: Record<string, unknown> = {
      ...value,
      type: value.name,
      message: value.message,
      stack: value.stack,
    };
    if (value.cause !== undefined) plain.cause = value.cause;
    return scrubObject(plain, depth, seen);
  }

  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, seen));

  return scrubObject(value as Record<string, unknown>, depth, seen);
}

function scrubObject(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      isSensitiveKey(key) && item != null && item !== ""
        ? REDACTED
        : scrubValue(item, depth + 1, seen);
  }
  return out;
}
