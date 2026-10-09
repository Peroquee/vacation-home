/**
 * Fetches a booking platform's iCal feed. Server-side only.
 *
 * - **Conditional**: sends the stored ETag / Last-Modified, so an unchanged
 *   feed costs a 304 and no parsing.
 * - **Bounded**: 20 seconds and 5 MB at most; a year of stays is a few KB.
 * - **Failures are codes**, stored on the feed and worded by the settings
 *   page: `unreachable`, `timeout`, `http_<status>`, `too_large`.
 *   (`not_ical` is the parser's: src/lib/ical/import.ts.)
 * - **The URL is never logged**: it carries the platform's secret token.
 */
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;

export type FetchOutcome =
  | { kind: "unchanged" }
  | { kind: "fetched"; text: string; etag: string | null; lastModified: string | null }
  | { kind: "failed"; code: string };

export async function fetchFeed(
  url: string,
  validators: { etag: string | null; lastModified: string | null },
  fetcher: typeof fetch = fetch,
): Promise<FetchOutcome> {
  const headers: Record<string, string> = {
    Accept: "text/calendar, */*;q=0.5",
    "User-Agent": "VacationHome-iCal/1.0",
  };
  if (validators.etag) headers["If-None-Match"] = validators.etag;
  if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;

  let response: Response;
  try {
    response = await fetcher(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return { kind: "failed", code: name === "TimeoutError" ? "timeout" : "unreachable" };
  }

  if (response.status === 304) return { kind: "unchanged" };
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: "failed", code: `http_${response.status}` };
  }

  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: "failed", code: "too_large" };
  }
  const text = await readCapped(response, MAX_BYTES);
  if (text === null) return { kind: "failed", code: "too_large" };
  return {
    kind: "fetched",
    text,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

/** The body as text, or null once it passes `limit` bytes. */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
