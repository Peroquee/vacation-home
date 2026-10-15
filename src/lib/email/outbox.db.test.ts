import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BookingEventKind } from "@/generated/prisma/client";
import { recordEvent } from "@/lib/bookings/hold";
import { createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { enqueue, type MailSetup, outboxStatus, sendDue } from "./outbox";
import type { MailTransport } from "./transport";

type Sent = Parameters<MailTransport["sendMail"]>[0];

/** A transport that keeps what it is given, or fails with `error`. */
function fakeTransport(error?: string) {
  const sent: Sent[] = [];
  const transport: MailTransport = {
    async sendMail(message) {
      if (error) throw new Error(error);
      sent.push(message);
      return {};
    },
  };
  return { sent, transport };
}

const setupWith = (
  transport: MailTransport | null,
  ownerEmail: string | null = "owner@example.test",
): MailSetup => ({
  transport,
  from: "Lake House <stay@example.test>",
  ownerEmail,
  appUrl: "http://localhost:3000",
});

let propertyId: string;
let guestId: string;

async function booking(guest = guestId) {
  const result = await createBooking({
    propertyId,
    guestId: guest,
    checkIn: "2027-03-01",
    checkOut: "2027-03-05",
    status: "inquiry",
    source: "direct",
    guestCount: 2,
  });
  if (!("booking" in result)) throw new Error(JSON.stringify(result));
  return result.booking;
}

/** A booking with the event recorded and queued. */
async function event(kind: BookingEventKind, key = "k", guest = guestId) {
  const { id } = await booking(guest);
  await recordEvent(db, id, kind, key);
  await enqueue();
  return id;
}

const rows = () =>
  db.emailOutbox.findMany({
    include: { event: { select: { kind: true } } },
    orderBy: [{ createdAt: "asc" }, { recipient: "asc" }],
  });

beforeAll(async () => {
  propertyId = (
    await db.property.create({
      data: {
        name: "Lake House",
        timezone: "Europe/Berlin",
        currency: "EUR",
        color: "#0f766e",
        defaultNightlyRateMinor: 25_000,
      },
    })
  ).id;
  guestId = (await db.guest.create({ data: { name: "Ada", email: "ada@example.test" } })).id;
});

beforeEach(async () => {
  await db.emailOutbox.deleteMany();
  await db.bookingEvent.deleteMany();
  await db.booking.deleteMany();
});

describe("the outbox", () => {
  it("queues each event once per recipient, however often it runs", async () => {
    await event("requested");
    expect(await enqueue()).toBe(0);
    expect((await rows()).map((r) => r.recipient)).toEqual(["guest", "owner"]);
  });

  it("sends each email once, to the guest and the owner, with a stable Message-ID", async () => {
    const id = await event("requested");
    const { sent, transport } = fakeTransport();
    expect(await sendDue(setupWith(transport))).toMatchObject({ sent: 2 });
    expect(await sendDue(setupWith(transport))).toMatchObject({ sent: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["ada@example.test", "owner@example.test"]);
    const toGuest = sent.find((m) => m.to === "ada@example.test")!;
    expect(toGuest.replyTo).toBe("owner@example.test");
    const eventId = (await db.bookingEvent.findFirstOrThrow({ where: { bookingId: id } })).id;
    expect(toGuest.messageId).toBe(`<${eventId}.guest@localhost>`);
    expect((await rows()).every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("waits without SMTP, and keeps the owner's emails waiting without OWNER_EMAIL", async () => {
    await event("requested");
    expect(await sendDue(setupWith(null))).toMatchObject({ sent: 0 });
    expect((await rows()).map((r) => r.status)).toEqual(["pending", "pending"]);

    const { sent, transport } = fakeTransport();
    await sendDue(setupWith(transport, null));
    expect(sent.map((m) => m.to)).toEqual(["ada@example.test"]);
    expect((await rows()).map((r) => `${r.recipient}:${r.status}`)).toEqual([
      "guest:sent",
      "owner:pending",
    ]);

    await sendDue(setupWith(transport));
    expect(sent.map((m) => m.to)).toEqual(["ada@example.test", "owner@example.test"]);
  });

  it("skips what is no longer true, too old, or has no address", async () => {
    // A reminder for a reservation that is not (or no longer) there.
    await event("deposit_reminder", "2027-02-01");
    const old = await event("declined");
    await db.bookingEvent.updateMany({
      where: { bookingId: old },
      data: { createdAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    const anonymous = (await db.guest.create({ data: { name: "No Mail" } })).id;
    await event("declined", "k", anonymous);

    const { sent, transport } = fakeTransport();
    expect(await sendDue(setupWith(transport))).toMatchObject({ sent: 0, skipped: 3 });
    expect(sent).toEqual([]);
    expect((await rows()).map((r) => r.skipReason)).toEqual([
      "no longer reserved",
      "older than 30 days",
      "no address",
    ]);
  });

  it("tries a failing server again later, and gives up after a day", async () => {
    await event("declined");
    const now = new Date();
    const failing = setupWith(fakeTransport("421 try again later").transport);
    expect(await sendDue(failing, now)).toMatchObject({ retried: 1 });
    let [row] = await rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "421 try again later" });
    expect(row!.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);

    // Not due yet; then due, and the next wait is longer.
    expect(await sendDue(failing, new Date(now.getTime() + 30_000))).toMatchObject({ retried: 0 });
    const later = new Date(now.getTime() + 2 * 60_000);
    expect(await sendDue(failing, later)).toMatchObject({ retried: 1 });
    [row] = await rows();
    expect(row!.nextAttemptAt.getTime()).toBe(later.getTime() + 5 * 60_000);

    const dayLater = new Date(row!.createdAt.getTime() + 86_400_000 + 60_000);
    expect(await sendDue(failing, dayLater)).toMatchObject({ failed: 1 });
    [row] = await rows();
    expect(row).toMatchObject({ status: "failed", attempts: 3 });

    const status = await outboxStatus(failing);
    expect(status.counts.failed).toBe(1);
    expect(status.problems[0]).toMatchObject({ kind: "declined", reason: "421 try again later" });
  });

  it("never sends one email twice when two runs overlap", async () => {
    for (let i = 0; i < 15; i++) await event("requested", `k${i}`);
    const a = fakeTransport();
    const b = fakeTransport();
    const runs = await Promise.all([
      sendDue(setupWith(a.transport)),
      sendDue(setupWith(b.transport)),
    ]);
    expect(runs[0]!.sent + runs[1]!.sent).toBe(30);
    const ids = [...a.sent, ...b.sent].map((m) => m.messageId);
    expect(new Set(ids).size).toBe(30);
    expect((await rows()).every((r) => r.status === "sent")).toBe(true);
  });
});
