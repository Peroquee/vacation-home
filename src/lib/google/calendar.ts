/**
 * A thin client for the Google Calendar API: list calendars, and list,
 * insert, update and delete events. Quota handling and error semantics live
 * here, so sync code never sees a raw HTTP response. Server-side only.
 *
 * - **Retries**: rate limiting (429, or 403 `rateLimitExceeded` /
 *   `userRateLimitExceeded`), 5xx and network failures are retried with
 *   exponential backoff and full jitter, honouring `Retry-After`, up to
 *   `maxAttempts` in all. A 401 refreshes the access token once.
 * - **Rate limiting**: requests for one user are spaced at least
 *   `minIntervalMs` apart within this process, so a resync of many bookings
 *   does not burst into Google's per-user quota.
 * - **Errors**: every failure is a `GoogleCalendarError` subclass - never an
 *   unhandled HTTP or network error - and a revoked grant is the
 *   CalendarNotConnectedError from ./connection.
 * - **Logging**: one line per call with the operation, calendar id, event id,
 *   status, attempt and duration. Never a request or response body.
 */
import { type Logger, logger as rootLogger } from "@/lib/logger";

import { getAccessToken, invalidateAccessToken } from "./connection";
import { type Fetch, GoogleOAuthError } from "./oauth";

const API = "https://www.googleapis.com/calendar/v3";

// --- Errors -------------------------------------------------------------------

export type CalendarErrorKind =
  | "rate_limited"
  | "quota_exceeded"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "gone"
  | "conflict"
  | "precondition_failed"
  | "bad_request"
  | "server_error"
  | "network_error";

export class GoogleCalendarError extends Error {
  constructor(
    readonly kind: CalendarErrorKind,
    /** HTTP status, or 0 when Google could not be reached. */
    readonly status: number,
    /** Google's own reason code (`rateLimitExceeded`, `notFound`, ...), if any. */
    readonly reason: string | null,
    readonly attempts: number,
  ) {
    super(
      `Google Calendar ${kind}` +
        (status ? ` (HTTP ${status}${reason ? `, ${reason}` : ""})` : "") +
        ` after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
    );
    this.name = "GoogleCalendarError";
  }

  /** Worth trying again later - a queued job should retry, not give up. */
  get transient(): boolean {
    return ["rate_limited", "quota_exceeded", "server_error", "network_error"].includes(this.kind);
  }
}

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

function kindOf(status: number, reason: string | null): CalendarErrorKind {
  if (status === 429 || (status === 403 && reason && RATE_LIMIT_REASONS.has(reason))) {
    return "rate_limited";
  }
  if (status === 403 && reason && QUOTA_REASONS.has(reason)) return "quota_exceeded";
  if (status >= 500) return "server_error";
  const byStatus: Record<number, CalendarErrorKind> = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    410: "gone",
    412: "precondition_failed",
  };
  return byStatus[status] ?? "bad_request";
}

const RETRYABLE = new Set<CalendarErrorKind>(["rate_limited", "server_error", "network_error"]);

// --- Types (the subset of Google's resources the app uses) ---------------------

export type CalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  /** Only `owner` and `writer` calendars can take the app's events. */
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  timeZone?: string;
};

/** All-day events use `date` (YYYY-MM-DD, end exclusive); timed ones `dateTime`. */
export type EventTime = { date?: string; dateTime?: string; timeZone?: string };

export type CalendarEvent = {
  id: string;
  etag: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start: EventTime;
  end: EventTime;
  updated: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  transparency?: "opaque" | "transparent";
};

export type EventInput = {
  /**
   * Optional id chosen by the caller (base32hex: a-v and 0-9, 5-1024 chars).
   * With one, a retried insert that Google had already applied is
   * recognised instead of duplicated.
   */
  id?: string;
  summary: string;
  description?: string;
  start: EventTime;
  end: EventTime;
  extendedProperties?: { private?: Record<string, string> };
  transparency?: "opaque" | "transparent";
};

export type ListEventsQuery = {
  timeMin?: string;
  timeMax?: string;
  /** For an incremental list; an expired one fails with kind `gone` - do a full resync. */
  syncToken?: string;
  pageToken?: string;
  showDeleted?: boolean;
  /**
   * Expand recurring events into their instances. Must be the same in the
   * full list and every incremental list that uses its sync token.
   */
  singleEvents?: boolean;
  /** `key=value` filters on private extended properties. */
  privateExtendedProperty?: string[];
  maxResults?: number;
};

export type EventPage = {
  items: CalendarEvent[];
  nextPageToken?: string;
  /** On the last page: the token for the next incremental list. */
  nextSyncToken?: string;
};

// --- Client -------------------------------------------------------------------

export type TokenSource = {
  get(): Promise<string>;
  /** Google rejected the token: make the next `get` fetch a new one. */
  invalidate(): Promise<void>;
};

export type CalendarClientOptions = {
  /** Whose calendar: tokens come from their Google connection. */
  userId: string;
  fetch?: Fetch;
  /** Overrides the connection's tokens (tests). */
  tokens?: TokenSource;
  log?: Logger;
  /** Attempts in all, including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Per attempt; a timeout is retried like a network failure. */
  timeoutMs?: number;
};

export type CalendarClient = ReturnType<typeof createCalendarClient>;

/** When each user's next request may start, in this process. */
const nextSlot = new Map<string, number>();

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Call = {
  op: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  calendarId?: string;
  eventId?: string;
  query?: URLSearchParams;
  body?: unknown;
  headers?: Record<string, string>;
};

export function createCalendarClient(options: CalendarClientOptions) {
  const {
    userId,
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 32_000,
    minIntervalMs = 100,
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
    timeoutMs = 30_000,
  } = options;
  const fetchFn = options.fetch ?? fetch;
  const log = (options.log ?? rootLogger).child({ component: "gcal" });
  const tokens: TokenSource = options.tokens ?? {
    get: () => getAccessToken(userId, { fetch: fetchFn }),
    invalidate: () => invalidateAccessToken(userId),
  };

  /** Waits for this user's next slot, reserving the one after it. */
  async function throttle() {
    const at = Math.max(now(), nextSlot.get(userId) ?? 0);
    nextSlot.set(userId, at + minIntervalMs);
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  }

  function backoff(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs);
    // Full jitter: anywhere up to the exponential ceiling.
    return Math.floor(random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)));
  }

  async function request<T>(call: Call): Promise<{ status: number; data: T | null }> {
    const ids = { op: call.op, calendarId: call.calendarId, eventId: call.eventId };
    const url = `${API}${call.path}${call.query?.size ? `?${call.query}` : ""}`;
    let refreshedToken = false;

    for (let attempt = 1; ; attempt++) {
      await throttle();
      const started = now();
      let response: Response;
      try {
        const token = await tokens.get();
        response = await fetchFn(url, {
          method: call.method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(call.body !== undefined && { "content-type": "application/json" }),
            ...call.headers,
          },
          body: call.body === undefined ? undefined : JSON.stringify(call.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const failure = transportFailure(error, attempt);
        // A revoked grant (CalendarNotConnectedError) and the like pass through.
        if (!failure) throw error;
        const ms = now() - started;
        if (!RETRYABLE.has(failure.kind) || attempt >= maxAttempts) {
          log.error({ ...ids, kind: failure.kind, attempt, ms }, "google calendar call failed");
          throw failure;
        }
        const delay = backoff(attempt, null);
        log.warn(
          { ...ids, kind: failure.kind, attempt, ms, retryInMs: delay },
          "google calendar call failed; retrying",
        );
        await sleep(delay);
        continue;
      }

      const ms = now() - started;
      if (response.ok) {
        log.info({ ...ids, status: response.status, attempt, ms }, "google calendar call");
        const text = await response.text();
        try {
          return { status: response.status, data: text ? (JSON.parse(text) as T) : null };
        } catch {
          throw new GoogleCalendarError("server_error", response.status, "invalid_json", attempt);
        }
      }

      const reason = await errorReason(response);
      const kind = kindOf(response.status, reason);
      const fields = { ...ids, status: response.status, reason, attempt, ms };

      if (kind === "unauthorized" && !refreshedToken) {
        // Rejected before it expired: refresh once. Does not count as an attempt.
        refreshedToken = true;
        attempt--;
        log.warn(fields, "google calendar rejected the access token; refreshing");
        await tokens.invalidate();
        continue;
      }
      if (RETRYABLE.has(kind) && attempt < maxAttempts) {
        const delay = backoff(attempt, response.headers.get("retry-after"));
        log.warn({ ...fields, retryInMs: delay }, "google calendar call failed; retrying");
        await sleep(delay);
        continue;
      }
      // Expected outcomes the caller handles are not errors in the log.
      const level =
        kind === "not_found" || kind === "gone" || kind === "conflict" ? "info" : "error";
      log[level](fields, "google calendar call failed");
      throw new GoogleCalendarError(kind, response.status, reason, attempt);
    }
  }

  const calendarPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`;
  const eventPath = (calendarId: string, eventId: string) =>
    `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`;

  return {
    /** Every calendar in the user's list, all pages. */
    async listCalendars(): Promise<CalendarListEntry[]> {
      const calendars: CalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ maxResults: "250" });
        if (pageToken) query.set("pageToken", pageToken);
        const { data } = await request<{ items?: CalendarListEntry[]; nextPageToken?: string }>({
          op: "calendarList.list",
          method: "GET",
          path: "/users/me/calendarList",
          query,
        });
        calendars.push(...(data?.items ?? []));
        pageToken = data?.nextPageToken;
      } while (pageToken);
      return calendars;
    },

    /** One page of events; follow `nextPageToken` for more. */
    async listEvents(calendarId: string, list: ListEventsQuery = {}): Promise<EventPage> {
      const query = new URLSearchParams();
      for (const key of ["timeMin", "timeMax", "syncToken", "pageToken"] as const) {
        if (list[key]) query.set(key, list[key]);
      }
      if (list.showDeleted !== undefined) query.set("showDeleted", String(list.showDeleted));
      if (list.singleEvents !== undefined) query.set("singleEvents", String(list.singleEvents));
      if (list.maxResults) query.set("maxResults", String(list.maxResults));
      for (const filter of list.privateExtendedProperty ?? []) {
        query.append("privateExtendedProperty", filter);
      }
      const { data } = await request<EventPage>({
        op: "events.list",
        method: "GET",
        path: `${calendarPath(calendarId)}/events`,
        calendarId,
        query,
      });
      return { items: data?.items ?? [], ...pick(data, "nextPageToken", "nextSyncToken") };
    },

    async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
      const { data } = await request<CalendarEvent>({
        op: "events.get",
        method: "GET",
        path: eventPath(calendarId, eventId),
        calendarId,
        eventId,
      });
      return data!;
    },

    /**
     * Creates an event. With a caller-chosen `id`, an insert whose earlier
     * attempt reached Google (409 on the retry) returns the existing event.
     */
    async insertEvent(calendarId: string, event: EventInput): Promise<CalendarEvent> {
      try {
        const { data } = await request<CalendarEvent>({
          op: "events.insert",
          method: "POST",
          path: `${calendarPath(calendarId)}/events`,
          calendarId,
          eventId: event.id,
          body: event,
        });
        return data!;
      } catch (error) {
        if (
          event.id &&
          error instanceof GoogleCalendarError &&
          error.kind === "conflict" &&
          error.attempts > 1
        ) {
          return this.getEvent(calendarId, event.id);
        }
        throw error;
      }
    },

    /**
     * Replaces an event. With `etag`, only if it is unchanged since then
     * (else kind `precondition_failed`).
     */
    async updateEvent(
      calendarId: string,
      eventId: string,
      event: EventInput,
      { etag }: { etag?: string } = {},
    ): Promise<CalendarEvent> {
      const { data } = await request<CalendarEvent>({
        op: "events.update",
        method: "PUT",
        path: eventPath(calendarId, eventId),
        calendarId,
        eventId,
        body: event,
        headers: etag ? { "if-match": etag } : undefined,
      });
      return data!;
    },

    /**
     * Deletes an event. One that is already gone counts as deleted, so a
     * retried or repeated delete is harmless: `"deleted"` or `"already_gone"`.
     */
    async deleteEvent(calendarId: string, eventId: string): Promise<"deleted" | "already_gone"> {
      try {
        await request({
          op: "events.delete",
          method: "DELETE",
          path: eventPath(calendarId, eventId),
          calendarId,
          eventId,
        });
        return "deleted";
      } catch (error) {
        if (
          error instanceof GoogleCalendarError &&
          (error.kind === "not_found" || error.kind === "gone")
        ) {
          return "already_gone";
        }
        throw error;
      }
    },

    /**
     * Asks Google to push a notification to `address` whenever an event in
     * the calendar changes (a push channel). Google echoes `token` in the
     * `X-Goog-Channel-Token` header of every notification.
     */
    async watchEvents(
      calendarId: string,
      channel: { id: string; token: string; address: string; ttlSeconds: number },
    ): Promise<{ resourceId: string; expiresAt: Date }> {
      const { data } = await request<{ resourceId: string; expiration: string }>({
        op: "events.watch",
        method: "POST",
        path: `${calendarPath(calendarId)}/events/watch`,
        calendarId,
        body: {
          id: channel.id,
          type: "web_hook",
          address: channel.address,
          token: channel.token,
          params: { ttl: String(channel.ttlSeconds) },
        },
      });
      return { resourceId: data!.resourceId, expiresAt: new Date(Number(data!.expiration)) };
    },

    /** Stops a push channel. One Google no longer knows counts as stopped. */
    async stopChannel(channel: { id: string; resourceId: string }): Promise<void> {
      try {
        await request({
          op: "channels.stop",
          method: "POST",
          path: "/channels/stop",
          body: { id: channel.id, resourceId: channel.resourceId },
        });
      } catch (error) {
        if (error instanceof GoogleCalendarError && error.kind === "not_found") return;
        throw error;
      }
    },
  };
}

/**
 * A failure before Google answered the API call, as a calendar error: the
 * network (or a timeout), or refreshing the access token. Null for anything
 * else, such as a revoked grant.
 */
function transportFailure(error: unknown, attempts: number): GoogleCalendarError | null {
  if (error instanceof GoogleOAuthError) {
    // Not `invalid_grant`: getAccessToken turns that into CalendarNotConnectedError.
    const kind = error.status >= 500 ? "server_error" : "unauthorized";
    return new GoogleCalendarError(kind, error.status, error.code, attempts);
  }
  if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
    return new GoogleCalendarError("network_error", 0, null, attempts);
  }
  return null;
}

function pick<T extends object, K extends keyof T>(value: T | null, ...keys: K[]): Partial<T> {
  const picked: Partial<T> = {};
  for (const key of keys) if (value?.[key] !== undefined) picked[key] = value[key];
  return picked;
}

/** Google's reason code from an error body, e.g. `rateLimitExceeded`. */
async function errorReason(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[]; status?: string };
  } | null;
  return body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? null;
}
