/**
 * The iCal routes (GitLab #99): feeds without their URLs, the export feed
 * off by default, on with a token, rotated, and carrying no guest data.
 */
import ICAL from "ical.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as exportFeed } from "@/app/api/ical/[token]/route";
import { DELETE as deleteFeed } from "@/app/api/ical-feeds/[id]/route";
import {
  DELETE as disableExport,
  GET as getExport,
  POST as enableExport,
} from "@/app/api/properties/[id]/ical-export/route";
import { GET as listFeeds, POST as addFeed } from "@/app/api/properties/[id]/ical-feeds/route";
import { createBooking } from "@/lib/bookings/service";
import { addDays, toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

/** `days` after today: the feed only carries what is recent or ahead (GitLab #147). */
const soon = (days: number) => addDays(new Date().toISOString().slice(0, 10), days);

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

let propertyId: string;

beforeEach(async () => {
  propertyId = (
    await db.property.create({
      data: { name: "Lake house", timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("feeds", () => {
  it("adds a feed, fetches it at once, and never shows its URL", async () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:a@airbnb",
      "DTSTART;VALUE=DATE:20261202",
      "DTEND;VALUE=DATE:20261205",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(feed)),
    );
    try {
      const created = await addFeed(
        json({ name: "Airbnb", url: "https://www.airbnb.test/calendar/ical/123.ics?s=SECRET" }),
        ctx({ id: propertyId }),
      );
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body).toMatchObject({ name: "Airbnb", host: "www.airbnb.test", eventCount: 1 });
      expect(JSON.stringify(body)).not.toContain("SECRET");

      const listed = await (
        await listFeeds(new Request("http://test"), ctx({ id: propertyId }))
      ).json();
      expect(JSON.stringify(listed)).not.toContain("SECRET");

      expect((await deleteFeed(new Request("http://test"), ctx({ id: body.id }))).status).toBe(204);
      expect(await db.block.count({ where: { propertyId } })).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a link that is not http(s)", async () => {
    const response = await addFeed(
      json({ name: "X", url: "file:///etc/passwd" }),
      ctx({ id: propertyId }),
    );
    expect(response.status).toBe(422);
  });
});

describe("the export feed", () => {
  it("is off by default, serves bookings and blocks once on, and dies when rotated", async () => {
    expect(
      await (await getExport(new Request("http://test"), ctx({ id: propertyId }))).json(),
    ).toEqual({
      enabled: false,
      url: null,
    });

    const guest = await db.guest.create({
      data: { name: "Ada Lovelace", email: "ada@example.test" },
    });
    await createBooking({
      propertyId,
      guestId: guest.id,
      checkIn: soon(30),
      checkOut: soon(33),
      status: "confirmed",
      source: "direct",
      guestCount: 2,
    });
    await db.block.create({
      data: {
        propertyId,
        startDate: toUtcDate(soon(39)),
        endDate: toUtcDate(soon(41)),
        reason: "Painting",
      },
    });

    const on = await (await enableExport(json({}), ctx({ id: propertyId }))).json();
    expect(on.enabled).toBe(true);
    const token = on.url.match(/ical\/(.+)$/)[1] as string;

    const response = await exportFeed(new Request(on.url), ctx({ token }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/calendar/);
    const text = await response.text();
    const events = new ICAL.Component(ICAL.parse(text))
      .getAllSubcomponents("vevent")
      .map((v) => new ICAL.Event(v));
    expect(events.map((e) => [e.summary, e.startDate.toString(), e.endDate.toString()])).toEqual([
      ["Booked", soon(30), soon(33)],
      ["Blocked", soon(39), soon(41)],
    ]);
    expect(text).not.toMatch(/Ada|Lovelace|example\.test|Painting/);

    const rotated = await (
      await enableExport(json({ rotate: true }), ctx({ id: propertyId }))
    ).json();
    expect(rotated.url).not.toBe(on.url);
    expect((await exportFeed(new Request(on.url), ctx({ token }))).status).toBe(404);

    await disableExport(new Request("http://test"), ctx({ id: propertyId }));
    const newToken = rotated.url.match(/ical\/(.+)$/)[1] as string;
    expect((await exportFeed(new Request(rotated.url), ctx({ token: newToken }))).status).toBe(404);
  });
});
