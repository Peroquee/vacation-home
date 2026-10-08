import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/lib/logger";

import { createCalendarClient, GoogleCalendarError, type TokenSource } from "./calendar";
import { CalendarNotConnectedError } from "./connection";
import { GoogleOAuthError } from "./oauth";

type Answer = Response | Error | (() => Response | Promise<Response>);

/** A mocked transport: answers calls in order, recording each one. */
function transport(...answers: Answer[]) {
  const calls: { url: URL; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(url)),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error("unexpected call");
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  });
  return { fetchFn, calls };
}

const googleError = (status: number, reason?: string, headers?: Record<string, string>) =>
  Response.json(
    { error: { code: status, message: "x", ...(reason && { errors: [{ reason }] }) } },
    { status, headers },
  );

const event = { id: "ev1", etag: '"1"', status: "confirmed", start: {}, end: {}, updated: "" };

let sleeps: number[];
let lines: Record<string, unknown>[];
let tokens: TokenSource & { issued: number; invalidated: number };

function client(
  answers: Answer[],
  overrides: Parameters<typeof createCalendarClient>[0] | object = {},
) {
  const { fetchFn, calls } = transport(...answers);
  const log = createLogger({ write: (line: string) => void lines.push(JSON.parse(line)) }, "info");
  const calendar = createCalendarClient({
    userId: crypto.randomUUID(),
    fetch: fetchFn as typeof fetch,
    tokens,
    log,
    minIntervalMs: 0,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    ...overrides,
  });
  return { calendar, calls, fetchFn };
}

beforeEach(() => {
  sleeps = [];
  lines = [];
  tokens = {
    issued: 0,
    invalidated: 0,
    async get() {
      return `token-${++this.issued - this.invalidated > 0 ? this.invalidated : 0}`;
    },
    async invalidate() {
      this.invalidated++;
    },
  };
});

describe("calls", () => {
  it("lists calendars across pages, with their access role", async () => {
    const { calendar, calls } = client([
      Response.json({
        items: [{ id: "a", summary: "A", accessRole: "owner" }],
        nextPageToken: "p2",
      }),
      Response.json({ items: [{ id: "b", summary: "B", accessRole: "reader" }] }),
    ]);
    expect((await calendar.listCalendars()).map((c) => [c.id, c.accessRole])).toEqual([
      ["a", "owner"],
      ["b", "reader"],
    ]);
    expect(calls[1].url.searchParams.get("pageToken")).toBe("p2");
    expect(calls[0].headers.authorization).toMatch(/^Bearer token-/);
  });

  it("lists events with filters, escaping the calendar id", async () => {
    const { calendar, calls } = client([
      Response.json({ items: [event], nextSyncToken: "sync-2" }),
    ]);
    const page = await calendar.listEvents("family#holiday@group.calendar.google.com", {
      syncToken: "sync-1",
      showDeleted: true,
      privateExtendedProperty: ["vacationHome=1", "bookingId=b1"],
    });
    expect(page).toEqual({ items: [event], nextSyncToken: "sync-2" });
    expect(calls[0].url.pathname).toBe(
      "/calendar/v3/calendars/family%23holiday%40group.calendar.google.com/events",
    );
    expect(calls[0].url.searchParams.getAll("privateExtendedProperty")).toEqual([
      "vacationHome=1",
      "bookingId=b1",
    ]);
    expect(calls[0].url.searchParams.get("showDeleted")).toBe("true");
  });

  it("inserts, updates with If-Match, and deletes", async () => {
    const { calendar, calls } = client([
      Response.json(event),
      Response.json({ ...event, etag: '"2"' }),
      new Response(null, { status: 204 }),
    ]);
    const input = {
      summary: "Booking · Lake house",
      start: { date: "2026-10-01" },
      end: { date: "2026-10-04" },
    };
    expect(await calendar.insertEvent("primary", input)).toEqual(event);
    expect(calls[0]).toMatchObject({ method: "POST", body: input });
    await calendar.updateEvent("primary", "ev1", input, { etag: '"1"' });
    expect(calls[1]).toMatchObject({ method: "PUT", headers: { "if-match": '"1"' } });
    expect(calls[1].url.pathname).toBe("/calendar/v3/calendars/primary/events/ev1");
    expect(await calendar.deleteEvent("primary", "ev1")).toBe("deleted");
    expect(calls[2].method).toBe("DELETE");
  });

  it("logs every call with its calendar and event id, never the body", async () => {
    const { calendar } = client([Response.json(event)]);
    await calendar.insertEvent("primary", {
      id: "ev1",
      summary: "secret summary",
      start: { date: "2026-10-01" },
      end: { date: "2026-10-02" },
    });
    expect(lines).toEqual([
      expect.objectContaining({
        component: "gcal",
        op: "events.insert",
        calendarId: "primary",
        eventId: "ev1",
        status: 200,
        attempt: 1,
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("secret summary");
  });
});

describe("retries", () => {
  it("backs off exponentially with jitter on rate limits and 5xx", async () => {
    const { calendar, calls } = client([
      googleError(403, "rateLimitExceeded"),
      googleError(429),
      googleError(503),
      googleError(500, "backendError"),
      Response.json({ items: [] }),
    ]);
    expect(await calendar.listEvents("primary")).toEqual({ items: [] });
    expect(calls).toHaveLength(5);
    // random() = 0.5 of 500, 1000, 2000, 4000 ms.
    expect(sleeps).toEqual([250, 500, 1000, 2000]);
  });

  it("caps the delay, and honours Retry-After", async () => {
    const { calendar } = client(
      [
        googleError(503),
        googleError(503),
        googleError(429, undefined, { "retry-after": "7" }),
        Response.json({ items: [] }),
      ],
      { maxDelayMs: 800, random: () => 0.99 },
    );
    await calendar.listEvents("primary");
    // 0.99 of 500, 1000 capped to 800; Retry-After 7 s capped to 800.
    expect(sleeps).toEqual([495, 792, 800]);

    const { calendar: patient } = client([
      googleError(429, undefined, { "retry-after": "3" }),
      Response.json({ items: [] }),
    ]);
    sleeps = [];
    await patient.listEvents("primary");
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after maxAttempts with a typed, transient error", async () => {
    const { calendar, calls } = client(
      [
        googleError(403, "userRateLimitExceeded"),
        googleError(403, "userRateLimitExceeded"),
        googleError(403, "userRateLimitExceeded"),
      ],
      { maxAttempts: 3 },
    );
    const error = await calendar.listCalendars().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleCalendarError);
    expect(error).toMatchObject({
      kind: "rate_limited",
      status: 403,
      reason: "userRateLimitExceeded",
      attempts: 3,
      transient: true,
    });
    expect(calls).toHaveLength(3);
    expect(lines.at(-1)).toMatchObject({ level: "error", msg: "google calendar call failed" });
  });

  it("does not retry a daily quota, but reports it as transient", async () => {
    const { calendar, calls } = client([googleError(403, "dailyLimitExceeded")]);
    await expect(calendar.listCalendars()).rejects.toMatchObject({
      kind: "quota_exceeded",
      transient: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("does not retry client errors", async () => {
    for (const [status, reason, kind] of [
      [400, "invalid", "bad_request"],
      [403, "forbiddenForNonOrganizer", "forbidden"],
      [404, "notFound", "not_found"],
      [410, "fullSyncRequired", "gone"],
      [412, "conditionNotMet", "precondition_failed"],
    ] as const) {
      const { calendar, calls } = client([googleError(status, reason)]);
      const error = await calendar.listEvents("primary").catch((e: unknown) => e);
      expect(error, `${status}`).toMatchObject({ kind, status, reason, transient: false });
      expect(calls).toHaveLength(1);
    }
    expect(sleeps).toEqual([]);
  });

  it("retries network failures and timeouts, then gives up typed", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const { calendar } = client([
      new TypeError("fetch failed"),
      timeout,
      Response.json({ items: [] }),
    ]);
    await expect(calendar.listEvents("primary")).resolves.toEqual({ items: [] });

    const { calendar: offline } = client(
      [new TypeError("fetch failed"), new TypeError("fetch failed")],
      { maxAttempts: 2 },
    );
    await expect(offline.listEvents("primary")).rejects.toMatchObject({
      kind: "network_error",
      status: 0,
      attempts: 2,
    });
  });

  it("refreshes the token once on a 401", async () => {
    const { calendar, calls } = client([googleError(401), Response.json({ items: [] })]);
    await calendar.listEvents("primary");
    expect(tokens.invalidated).toBe(1);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([]);

    const { calendar: rejected } = client([googleError(401), googleError(401)]);
    await expect(rejected.listEvents("primary")).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("passes a revoked grant through, and types a failed token refresh", async () => {
    tokens.get = async () => {
      throw new CalendarNotConnectedError("revoked");
    };
    const { calendar, fetchFn } = client([]);
    await expect(calendar.listCalendars()).rejects.toBeInstanceOf(CalendarNotConnectedError);
    expect(fetchFn).not.toHaveBeenCalled();

    let failures = 2;
    tokens.get = async () => {
      if (failures-- > 0) throw new GoogleOAuthError("unknown_error", 503);
      return "token";
    };
    const { calendar: recovering } = client([Response.json({ items: [] })]);
    await expect(recovering.listCalendars()).resolves.toEqual([]);
    expect(sleeps).toEqual([250, 500]);
  });
});

describe("idempotency", () => {
  it("returns the existing event when a retried insert finds it already created", async () => {
    const { calendar, calls } = client([
      googleError(503),
      googleError(409, "duplicate"),
      Response.json(event),
    ]);
    const created = await calendar.insertEvent("primary", {
      id: "ev1",
      summary: "Booking",
      start: { date: "2026-10-01" },
      end: { date: "2026-10-02" },
    });
    expect(created).toEqual(event);
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST", "GET"]);
  });

  it("reports a conflict on a first attempt: the id is taken by something else", async () => {
    const { calendar } = client([googleError(409, "duplicate")]);
    await expect(
      calendar.insertEvent("primary", { id: "ev1", summary: "B", start: {}, end: {} }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("treats deleting an event that is already gone as done", async () => {
    const { calendar } = client([googleError(410, "deleted"), googleError(404, "notFound")]);
    expect(await calendar.deleteEvent("primary", "ev1")).toBe("already_gone");
    expect(await calendar.deleteEvent("primary", "ev1")).toBe("already_gone");
  });
});

describe("rate limiting", () => {
  it("spaces one user's requests at least minIntervalMs apart", async () => {
    let clock = 1_000;
    const userId = crypto.randomUUID();
    const { calendar } = client(
      Array.from({ length: 3 }, () => Response.json({ items: [] })),
      {
        userId,
        minIntervalMs: 100,
        now: () => clock,
        sleep: async (ms: number) => {
          sleeps.push(ms);
          clock += ms;
        },
      },
    );
    await Promise.all([
      calendar.listEvents("a"),
      calendar.listEvents("b"),
      calendar.listEvents("c"),
    ]);
    // Started at 1000, 1100 and 1200.
    expect(sleeps).toEqual([100, 100]);
    expect(clock).toBe(1_200);
  });
});
