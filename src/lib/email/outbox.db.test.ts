import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookingEventKind } from "@/generated/prisma/client";
import { recordEvent } from "@/lib/bookings/hold";
import { createBooking } from "@/lib/bookings/service";
import { db } from "@/lib/db";

import { enqueue, type MailSetup, outboxStatus, sendDue } from "./outbox";
import { renderEmail } from "./render";
import type { MailTransport } from "./transport";

// The real renderer, which a test can make fail for one email.
vi.mock("./render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./render")>();
  return { ...actual, renderEmail: vi.fn(actual.renderEmail) };
});

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

// Back to the real renderer, which `vi.fn` was given.
afterEach(() => vi.mocked(renderEmail).mockReset());

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

  // GitLab #134: the database's sessions run 14 hours from UTC in this suite
  // (vitest.db.config.mts), so a time the database fills in itself shows.
  it("dates its rows by the app's clock, whatever the database's timezone", async () => {
    const { id } = await booking();
    await recordEvent(db, id, "declined", "k");
    const now = new Date("2026-10-24T22:30:00.000Z");
    expect(await enqueue(now)).toBe(1);
    const [row] = await rows();
    expect(row!.createdAt.toISOString()).toBe(now.toISOString());
    expect(row!.nextAttemptAt.toISOString()).toBe(now.toISOString());
  });

  it("sends the others when one email can't be written, and sends none twice", async () => {
    await event("declined", "a");
    const bad = await event("declined", "b");
    await event("declined", "c");
    const { renderEmail: real } = await vi.importActual<typeof import("./render")>("./render");
    vi.mocked(renderEmail).mockImplementation(async (context) => {
      if (context.booking.id === bad) throw new Error("template broke");
      return real(context);
    });
    const { sent, transport } = fakeTransport();
    const now = new Date();

    await expect(sendDue(setupWith(transport), now)).resolves.toMatchObject({
      sent: 2,
      retried: 1,
    });
    const failed = (await rows()).find((r) => r.status !== "sent")!;
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "template broke" });

    // Not due yet, then due and failing again: the sent ones stay sent.
    expect(await sendDue(setupWith(transport), new Date(now.getTime() + 30_000))).toMatchObject({
      sent: 0,
      retried: 0,
    });
    expect(await sendDue(setupWith(transport), new Date(now.getTime() + 2 * 60_000))).toMatchObject(
      { sent: 0, retried: 1 },
    );
    expect(sent).toHaveLength(2);

    // Fixed: it goes out once, and nothing else goes out again.
    vi.mocked(renderEmail).mockReset();
    expect(
      await sendDue(setupWith(transport), new Date(now.getTime() + 10 * 60_000)),
    ).toMatchObject({ sent: 1 });
    expect(new Set(sent.map((m) => m.messageId)).size).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it("lets a slow send finish without a later run taking the same email", async () => {
    await event("declined");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => (begin = resolve));
    const slowSent: Sent[] = [];
    const slow: MailTransport = {
      async sendMail(message) {
        begin();
        await gate;
        slowSent.push(message);
        return {};
      },
    };
    const now = new Date();
    const first = sendDue(setupWith(slow), now);
    await begun;

    // A run five minutes on, while the first still waits for the server.
    const other = fakeTransport();
    expect(
      await sendDue(setupWith(other.transport), new Date(now.getTime() + 5 * 60_000)),
    ).toMatchObject({ sent: 0 });
    release();
    expect(await first).toMatchObject({ sent: 1 });
    expect(other.sent).toEqual([]);
    expect(slowSent).toHaveLength(1);
    expect((await rows()).map((r) => r.status)).toEqual(["sent"]);
  });

  it("takes over an email whose sender stopped, once its claim has run out", async () => {
    await event("declined");
    const now = new Date();
    // As a run that claimed it and then died would leave it.
    await db.$executeRaw`UPDATE email_outbox SET claimed_until = ${new Date(now.getTime() + 60_000)}`;
    const { sent, transport } = fakeTransport();
    expect(await sendDue(setupWith(transport), now)).toMatchObject({ sent: 0 });
    expect(await sendDue(setupWith(transport), new Date(now.getTime() + 2 * 60_000))).toMatchObject(
      { sent: 1 },
    );
    expect(sent).toHaveLength(1);
  });
});
