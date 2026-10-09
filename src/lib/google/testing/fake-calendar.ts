/**
 * An in-memory Google Calendar for tests of inbound sync: events with
 * incremental listing by sync token (deleted events included, as Google
 * does), token expiry on demand, and push channels.
 */
import { type CalendarClient, type CalendarEvent, GoogleCalendarError } from "../calendar";

export function fakeInboundCalendar() {
  const events = new Map<string, CalendarEvent>();
  /** For each change, in order: the event id. Sync token "t<n>" = after n changes. */
  const changes: string[] = [];
  const expired = new Set<string>();
  const channels = new Map<string, { resourceId: string; token: string; address: string }>();
  const stopped: string[] = [];
  const lists: { syncToken?: string }[] = [];
  /** Event ids the app wrote (inserts and updates), in order. */
  const writes: string[] = [];
  let failures = 0;
  let version = 0;

  const put = (event: Partial<CalendarEvent> & { id: string }) => {
    // Like Google: every write gets a new etag.
    events.set(event.id, {
      status: "confirmed",
      start: { date: "2026-12-01" },
      end: { date: "2026-12-02" },
      ...event,
      etag: `"${++version}"`,
      updated: new Date().toISOString(),
    } as CalendarEvent);
    changes.push(event.id);
  };

  const calendar = {
    async listEvents(_calendarId: string, query: { syncToken?: string; pageToken?: string }) {
      lists.push({ syncToken: query.syncToken });
      if (failures > 0) {
        failures--;
        throw new GoogleCalendarError("server_error", 503, null, 5);
      }
      const token = `t${changes.length}`;
      if (query.syncToken) {
        if (expired.has(query.syncToken))
          throw new GoogleCalendarError("gone", 410, "fullSyncRequired", 1);
        const since = Number(query.syncToken.slice(1));
        const ids = [...new Set(changes.slice(since))];
        return { items: ids.map((id) => events.get(id)!), nextSyncToken: token };
      }
      // A full list: live events only, in two pages to exercise paging.
      const live = [...events.values()].filter((e) => e.status !== "cancelled");
      if (!query.pageToken && live.length > 1) {
        return { items: live.slice(0, 1), nextPageToken: "p2" };
      }
      return { items: query.pageToken ? live.slice(1) : live, nextSyncToken: token };
    },
    // Writes, as outbound sync makes them: they show up in later lists too.
    async insertEvent(_calendarId: string, input: { id: string }) {
      if (events.has(input.id)) throw new GoogleCalendarError("conflict", 409, "duplicate", 1);
      writes.push(input.id);
      put(input as CalendarEvent);
      return events.get(input.id)!;
    },
    async updateEvent(
      _calendarId: string,
      eventId: string,
      input: object,
      { etag }: { etag?: string } = {},
    ) {
      const current = events.get(eventId);
      if (!current || current.status === "cancelled") {
        throw new GoogleCalendarError("not_found", 404, "notFound", 1);
      }
      if (etag && etag !== current.etag) {
        throw new GoogleCalendarError("precondition_failed", 412, "conditionNotMet", 1);
      }
      writes.push(eventId);
      put({ ...(input as CalendarEvent), id: eventId });
      return events.get(eventId)!;
    },
    async getEvent(_calendarId: string, eventId: string) {
      const event = events.get(eventId);
      if (!event) throw new GoogleCalendarError("not_found", 404, "notFound", 1);
      return event;
    },
    async deleteEvent(_calendarId: string, eventId: string) {
      if (!events.has(eventId)) return "already_gone" as const;
      put({ ...events.get(eventId)!, status: "cancelled" });
      return "deleted" as const;
    },
    async watchEvents(
      _calendarId: string,
      channel: { id: string; token: string; address: string },
    ) {
      const resourceId = `res-${channel.id.slice(0, 8)}`;
      channels.set(channel.id, { resourceId, token: channel.token, address: channel.address });
      return { resourceId, expiresAt: new Date(Date.now() + 7 * 86_400_000) };
    },
    async stopChannel(channel: { id: string }) {
      stopped.push(channel.id);
      channels.delete(channel.id);
    },
  } as unknown as CalendarClient;

  return {
    calendar,
    events,
    channels,
    stopped,
    lists,
    writes,
    put,
    remove: (id: string) => put({ ...events.get(id)!, status: "cancelled" }),
    expireTokens: () => {
      for (let i = 0; i <= changes.length; i++) expired.add(`t${i}`);
    },
    failNext: (n = 1) => (failures = n),
  };
}
