import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// An in-memory stand-in for `db.guest` that enforces the unique email and
// raises Prisma's own error codes.
const store = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  withHistory: new Set<string>(),
  /** When set, `create` behaves as if another request inserted this first. */
  raceWith: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => {
  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "test" });
  const emailTaken = (email: unknown, exceptId?: string) =>
    email != null && [...store.rows.values()].some((r) => r.email === email && r.id !== exceptId);
  const contains = (value: unknown, query: string) =>
    typeof value === "string" && value.toLowerCase().includes(query.toLowerCase());
  type Where = { OR?: { name?: { contains: string }; email?: { contains: string } }[] };

  return {
    db: {
      guest: {
        findMany: async ({ where, take }: { where?: Where; take: number }) => {
          // Undo the LIKE escaping, as PostgreSQL would.
          const query = where?.OR?.[0]?.name?.contains.replace(/\\(.)/g, "$1");
          return [...store.rows.values()]
            .filter((row) => !query || contains(row.name, query) || contains(row.email, query))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .slice(0, take);
        },
        findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
          where.id
            ? (store.rows.get(where.id) ?? null)
            : ([...store.rows.values()].find((row) => row.email === where.email) ?? null),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (store.raceWith) {
            store.rows.set(String(store.raceWith.id), store.raceWith);
            store.raceWith = null;
          }
          if (emailTaken(data.email)) throw knownError("P2002");
          const now = new Date();
          const row = {
            id: crypto.randomUUID(),
            email: null,
            phone: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
            ...data,
          };
          store.rows.set(row.id, row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.rows.get(where.id);
          if (!row) throw knownError("P2025");
          if ("email" in data && emailTaken(data.email, where.id)) throw knownError("P2002");
          const updated = { ...row, ...data, updatedAt: new Date() };
          store.rows.set(where.id, updated);
          return updated;
        },
        delete: async ({ where }: { where: { id: string } }) => {
          const row = store.rows.get(where.id);
          if (!row) throw knownError("P2025");
          if (store.withHistory.has(where.id)) throw knownError("P2003");
          store.rows.delete(where.id);
          return row;
        },
      },
    },
  };
});

import { DELETE, GET as getOne, PATCH } from "@/app/api/guests/[id]/route";
import { GET as search, POST as create } from "@/app/api/guests/route";

const BASE = "http://localhost/api/guests";
const MISSING = "00000000-0000-4000-8000-000000000000";
const send = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function createGuest(body: Record<string, unknown>) {
  const response = await create(new Request(BASE, send("POST", body)));
  return { response, guest: await response.json() };
}
async function searchNames(query: string) {
  const response = await search(new Request(`${BASE}?q=${encodeURIComponent(query)}`));
  return (await response.json()).map((g: { name: string }) => g.name);
}

beforeEach(() => {
  store.rows.clear();
  store.withHistory.clear();
  store.raceWith = null;
});

describe("create", () => {
  it("creates a guest, normalising the email and blank fields", async () => {
    const { response, guest } = await createGuest({
      name: " Ada Lovelace ",
      email: " Ada@Example.COM ",
      phone: "+44 20 7946 0000",
      notes: "",
    });
    expect(response.status).toBe(201);
    expect(guest).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+44 20 7946 0000",
      notes: null,
    });
  });

  it("returns the existing guest instead of a duplicate for a known email, in any case", async () => {
    const { guest: first } = await createGuest({ name: "Ada Lovelace", email: "ada@example.com" });
    const { response, guest: again } = await createGuest({
      name: "A. Lovelace",
      email: "ADA@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(again).toEqual(first);
    expect(store.rows.size).toBe(1);
  });

  it("returns the winner's record when a concurrent request created the same email first", async () => {
    store.raceWith = {
      id: crypto.randomUUID(),
      name: "Winner",
      email: "ada@example.com",
      phone: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { response, guest } = await createGuest({ name: "Loser", email: "ada@example.com" });
    expect(response.status).toBe(200);
    expect(guest.name).toBe("Winner");
  });

  it("allows any number of guests without an email", async () => {
    await createGuest({ name: "Walk-in" });
    const { response } = await createGuest({ name: "Walk-in" });
    expect(response.status).toBe(201);
    expect(store.rows.size).toBe(2);
  });

  it("rejects invalid input with a 422 per field", async () => {
    const { response, guest } = await createGuest({
      name: "",
      email: "not-an-email",
      phone: "call me",
      extra: 1,
    });
    expect(response.status).toBe(422);
    expect(Object.keys(guest.error.fields).sort()).toEqual(["_", "email", "name", "phone"]);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await createGuest({ name: "Ada Lovelace", email: "ada@example.com" });
    await createGuest({ name: "Grace Hopper", email: "grace@navy.example" });
    await createGuest({ name: "Alan Turing" });
  });

  it("matches partial, case-insensitive input on name or email", async () => {
    expect(await searchNames("LOVE")).toEqual(["Ada Lovelace"]);
    expect(await searchNames("navy")).toEqual(["Grace Hopper"]);
    expect(await searchNames("a")).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
    expect(await searchNames("nobody")).toEqual([]);
  });

  it("lists by name without a query, honouring the limit", async () => {
    const response = await search(new Request(`${BASE}?limit=2`));
    expect((await response.json()).map((g: { name: string }) => g.name)).toEqual([
      "Ada Lovelace",
      "Alan Turing",
    ]);
  });

  it("rejects an invalid limit, but treats an empty one as the default", async () => {
    expect((await search(new Request(`${BASE}?limit=0`))).status).toBe(422);
    expect((await search(new Request(`${BASE}?q=a&limit=`))).status).toBe(200);
  });
});

describe("read, update and delete", () => {
  it("reads one guest, or 404", async () => {
    const { guest } = await createGuest({ name: "Ada" });
    expect(await (await getOne(new Request(BASE), context(guest.id))).json()).toEqual(guest);
    expect((await getOne(new Request(BASE), context(MISSING))).status).toBe(404);
    expect((await getOne(new Request(BASE), context("x"))).status).toBe(404);
  });

  it("updates fields, refusing an email that belongs to another guest", async () => {
    await createGuest({ name: "Ada", email: "ada@example.com" });
    const { guest } = await createGuest({ name: "Grace", email: "grace@example.com" });

    const renamed = await PATCH(
      new Request(BASE, send("PATCH", { notes: "Late arrival" })),
      context(guest.id),
    );
    expect(await renamed.json()).toMatchObject({ name: "Grace", notes: "Late arrival" });

    const clash = await PATCH(
      new Request(BASE, send("PATCH", { email: "ADA@example.com" })),
      context(guest.id),
    );
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.fields.email).toEqual(["belongs to another guest"]);

    expect((await PATCH(new Request(BASE, send("PATCH", {})), context(guest.id))).status).toBe(422);
    expect(
      (await PATCH(new Request(BASE, send("PATCH", { name: "x" })), context(MISSING))).status,
    ).toBe(404);
  });

  it("deletes a guest without bookings, and refuses one with bookings", async () => {
    const { guest: free } = await createGuest({ name: "Free" });
    const { guest: booked } = await createGuest({ name: "Booked" });
    store.withHistory.add(booked.id);

    expect((await DELETE(new Request(BASE), context(free.id))).status).toBe(204);
    expect((await DELETE(new Request(BASE), context(booked.id))).status).toBe(409);
    expect((await DELETE(new Request(BASE), context(MISSING))).status).toBe(404);
  });
});
