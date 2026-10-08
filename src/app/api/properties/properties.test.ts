import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// An in-memory stand-in for `db.property`, raising the same Prisma errors the
// real client does, so the handlers are tested through the service layer.
const store = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  /** Ids that have bookings, so deleting them violates a foreign key. */
  withHistory: new Set<string>(),
}));

vi.mock("@/lib/db", () => {
  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "test" });
  const existing = (id: string) => {
    const row = store.rows.get(id);
    if (!row) throw knownError("P2025");
    return row;
  };
  return {
    db: {
      property: {
        findMany: async ({ where }: { where?: { archivedAt: null } }) =>
          [...store.rows.values()]
            .filter((row) => !where || row.archivedAt === null)
            .sort(
              (a, b) =>
                String(a.name).localeCompare(String(b.name)) ||
                (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
            ),
        findUnique: async ({ where }: { where: { id: string } }) =>
          store.rows.get(where.id) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const now = new Date();
          const row = {
            id: crypto.randomUUID(),
            address: null,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            ...data,
          };
          store.rows.set(row.id, row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: object }) => {
          const row = { ...existing(where.id), ...data, updatedAt: new Date() };
          store.rows.set(where.id, row);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; archivedAt: null | { not: null } };
          data: object;
        }) => {
          const row = store.rows.get(where.id);
          const matches =
            row && (where.archivedAt === null ? row.archivedAt === null : row.archivedAt !== null);
          if (matches) store.rows.set(where.id, { ...row, ...data, updatedAt: new Date() });
          return { count: matches ? 1 : 0 };
        },
        delete: async ({ where }: { where: { id: string } }) => {
          const row = existing(where.id);
          if (store.withHistory.has(where.id)) throw knownError("P2003");
          store.rows.delete(where.id);
          return row;
        },
      },
    },
  };
});

import { POST as archive } from "@/app/api/properties/[id]/archive/route";
import { DELETE, GET as getOne, PATCH } from "@/app/api/properties/[id]/route";
import { POST as unarchive } from "@/app/api/properties/[id]/unarchive/route";
import { GET as list, POST as create } from "@/app/api/properties/route";

const URL_BASE = "http://localhost/api/properties";
const MISSING = "00000000-0000-4000-8000-000000000000";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function createOne(body: Record<string, unknown> = {}) {
  const response = await create(
    new Request(
      URL_BASE,
      json({ name: "Lake House", timezone: "Europe/Lisbon", currency: "eur", ...body }),
    ),
  );
  return { response, property: await response.json() };
}

beforeEach(() => {
  store.rows.clear();
  store.withHistory.clear();
});

describe("create", () => {
  it("creates a property with defaults and normalised codes", async () => {
    const { response, property } = await createOne({ color: "#ABCDEF", address: "  " });

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/properties/${property.id}`);
    expect(property).toMatchObject({
      name: "Lake House",
      address: null,
      timezone: "Europe/Lisbon",
      currency: "EUR",
      color: "#abcdef",
      defaultNightlyRateMinor: 0,
      defaultCleaningFeeMinor: 0,
      archived: false,
      archivedAt: null,
    });
  });

  it("rejects invalid input with a 422 and a message per field", async () => {
    const response = await create(
      new Request(
        URL_BASE,
        json({
          name: " ",
          timezone: "Mars/Olympus",
          currency: "EURO",
          defaultNightlyRateMinor: 12.5,
          defaultCleaningFeeMinor: -1,
          color: "teal",
          surprise: true,
        }),
      ),
    );

    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("validation_failed");
    expect(Object.keys(error.fields).sort()).toEqual([
      "_",
      "color",
      "currency",
      "defaultCleaningFeeMinor",
      "defaultNightlyRateMinor",
      "name",
      "timezone",
    ]);
    expect(error.fields.name).toEqual(["is required"]);
    expect(error.fields.timezone).toEqual(["must be an IANA timezone, e.g. Europe/Lisbon"]);
  });

  it("stores the canonical timezone name and refuses bare UTC offsets", async () => {
    const { property } = await createOne({ timezone: "us/eastern" });
    expect(property.timezone).toBe("America/New_York");

    const { response } = await createOne({ timezone: "+05:30" });
    expect(response.status).toBe(422);
  });

  it("reports missing required fields", async () => {
    const response = await create(new Request(URL_BASE, json({})));
    const { error } = await response.json();
    expect(response.status).toBe(422);
    expect(Object.keys(error.fields).sort()).toEqual(["currency", "name", "timezone"]);
  });

  it("answers a body that is not JSON with a 400", async () => {
    const response = await create(new Request(URL_BASE, json("{name:")));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
  });
});

describe("read", () => {
  it("returns one property, and 404 for an unknown or malformed id", async () => {
    const { property } = await createOne();

    const found = await getOne(new Request(`${URL_BASE}/${property.id}`), context(property.id));
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(property);

    expect((await getOne(new Request(URL_BASE), context(MISSING))).status).toBe(404);
    expect((await getOne(new Request(URL_BASE), context("not-a-uuid"))).status).toBe(404);
  });

  it("lists active properties by name, and archived ones only on request", async () => {
    await createOne({ name: "Sea View" });
    const { property: archived } = await createOne({ name: "Barn" });
    await archive(new Request(URL_BASE), context(archived.id));
    await createOne({ name: "Attic" });

    const active = await (await list(new Request(URL_BASE))).json();
    expect(active.map((p: { name: string }) => p.name)).toEqual(["Attic", "Sea View"]);

    const all = await (await list(new Request(`${URL_BASE}?includeArchived=true`))).json();
    expect(all.map((p: { name: string }) => p.name)).toEqual(["Attic", "Barn", "Sea View"]);
  });
});

describe("update", () => {
  it("changes only the fields given", async () => {
    const { property } = await createOne({ defaultNightlyRateMinor: 12000 });

    const response = await PATCH(
      new Request(`${URL_BASE}/${property.id}`, {
        ...json({ defaultCleaningFeeMinor: 4500 }),
        method: "PATCH",
      }),
      context(property.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Lake House",
      defaultNightlyRateMinor: 12000,
      defaultCleaningFeeMinor: 4500,
    });
  });

  it("rejects an empty or invalid update with a 422", async () => {
    const { property } = await createOne();
    const patch = (body: unknown) =>
      PATCH(new Request(URL_BASE, { ...json(body), method: "PATCH" }), context(property.id));

    const empty = await patch({});
    expect(empty.status).toBe(422);
    expect((await empty.json()).error.fields._).toEqual(["at least one field is required"]);

    const invalid = await patch({ currency: "XYZ1" });
    expect((await invalid.json()).error.fields.currency).toBeDefined();
  });

  it("changes the currency only with both defaults restated in it", async () => {
    const { property } = await createOne({ defaultNightlyRateMinor: 18000 });
    const patch = (body: unknown) =>
      PATCH(new Request(URL_BASE, { ...json(body), method: "PATCH" }), context(property.id));

    const alone = await patch({ currency: "JPY" });
    expect(alone.status).toBe(422);
    expect((await alone.json()).error.fields.currency[0]).toMatch(/in the same request/);

    const restated = await patch({
      currency: "JPY",
      defaultNightlyRateMinor: 25000,
      defaultCleaningFeeMinor: 5000,
    });
    expect(await restated.json()).toMatchObject({
      currency: "JPY",
      defaultNightlyRateMinor: 25000,
    });

    // Restating the current currency is not a change.
    expect((await patch({ currency: "jpy" })).status).toBe(200);
  });

  it("returns 404 for an unknown property", async () => {
    const response = await PATCH(
      new Request(URL_BASE, { ...json({ name: "x" }), method: "PATCH" }),
      context(MISSING),
    );
    expect(response.status).toBe(404);
  });
});

describe("archive", () => {
  it("archives and restores, keeping the original archive time when repeated", async () => {
    const { property } = await createOne();

    const first = await (await archive(new Request(URL_BASE), context(property.id))).json();
    expect(first.archived).toBe(true);
    expect(first.archivedAt).toEqual(expect.any(String));

    const again = await (await archive(new Request(URL_BASE), context(property.id))).json();
    expect(again.archivedAt).toBe(first.archivedAt);

    const restored = await (await unarchive(new Request(URL_BASE), context(property.id))).json();
    expect(restored).toMatchObject({ archived: false, archivedAt: null });
  });

  it("returns 404 for an unknown property", async () => {
    expect((await archive(new Request(URL_BASE), context(MISSING))).status).toBe(404);
    expect((await unarchive(new Request(URL_BASE), context("nope"))).status).toBe(404);
  });
});

describe("delete", () => {
  it("deletes a property with no history", async () => {
    const { property } = await createOne();
    const response = await DELETE(new Request(URL_BASE), context(property.id));
    expect(response.status).toBe(204);
    expect(store.rows.has(property.id)).toBe(false);
  });

  it("refuses a property with bookings, pointing to archiving instead", async () => {
    const { property } = await createOne();
    store.withHistory.add(property.id);

    const response = await DELETE(new Request(URL_BASE), context(property.id));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/Archive it instead/);
    expect(store.rows.has(property.id)).toBe(true);
  });

  it("returns 404 for an unknown property", async () => {
    expect((await DELETE(new Request(URL_BASE), context(MISSING))).status).toBe(404);
  });
});
