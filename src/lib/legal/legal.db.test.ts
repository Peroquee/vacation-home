/**
 * The go-live gate (GitLab #112) against a real PostgreSQL: no property is
 * listed while the legal pages are incomplete, and they cannot be emptied
 * while one is listed - through the services and API, and in the database
 * itself, also when the two race.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PUT as putLegal } from "@/app/api/legal/route";
import { PATCH as patchProperty } from "@/app/api/properties/[id]/route";
import { POST as postProperty } from "@/app/api/properties/route";
import { db } from "@/lib/db";
import { raisedByDatabase } from "@/lib/db-errors";
import { createProperty, setArchived, updateProperty } from "@/lib/properties/service";

import { EMPTY_LEGAL } from "./legal";
import type { LegalInput } from "./schema";
import { getLegal, isLegalComplete, saveLegal } from "./service";
import { COMPLETE_LEGAL } from "./testing/complete-legal";

const PROPERTY = {
  name: "Lake House",
  timezone: "UTC",
  currency: "EUR",
  color: "#0f766e",
  defaultNightlyRateMinor: 0,
  defaultCleaningFeeMinor: 0,
};

const unlisted = async (slug = "lake-house") => {
  const property = await createProperty({ ...PROPERTY, slug, publiclyListed: false });
  if (typeof property === "string") throw new Error(property);
  return property;
};

/** Refused by the schema's own trigger, its message led by `marker`. */
const refusedWith = (marker: string) => (error: unknown) => raisedByDatabase(error, marker);

const send = (method: string, body: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await db.property.updateMany({ data: { publiclyListed: false } });
  await db.property.deleteMany();
  await db.siteLegal.deleteMany();
});

afterAll(async () => {
  await db.property.deleteMany();
  await db.siteLegal.deleteMany();
  await db.$disconnect();
});

describe("the legal pages", () => {
  it("start empty, and store blank text as nothing", async () => {
    expect(await getLegal()).toEqual(EMPTY_LEGAL);
    const saved = await saveLegal({ ...COMPLETE_LEGAL, imprintPhone: null });
    expect(saved).toEqual({ legal: COMPLETE_LEGAL });

    // The API trims and turns blanks into null; the database refuses blanks too.
    const response = await putLegal(
      send("PUT", { ...COMPLETE_LEGAL, imprintName: "  Ada  ", imprintVatId: "   " }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imprintName: "Ada", imprintVatId: null });
    await expect(
      db.siteLegal.update({ where: { id: 1 }, data: { imprintName: " " } }),
    ).rejects.toThrow();
  });

  it("are complete with name, address, email and the policy in both languages", async () => {
    expect(await isLegalComplete()).toBe(false);
    for (const missing of [
      "imprintName",
      "imprintAddress",
      "imprintEmail",
      "privacyPolicyDe",
      "privacyPolicyEn",
    ] as const) {
      await saveLegal({ ...COMPLETE_LEGAL, [missing]: null });
      expect(await isLegalComplete(), missing).toBe(false);
    }
    await saveLegal({ ...COMPLETE_LEGAL, imprintPhone: null, imprintVatId: null });
    expect(await isLegalComplete()).toBe(true);
  });

  it("refuse an invalid email", async () => {
    const response = await putLegal(send("PUT", { ...COMPLETE_LEGAL, imprintEmail: "nope" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields).toEqual({
      imprintEmail: ["must be a valid email address"],
    });
  });
});

describe("listing a property", () => {
  it("waits for the legal pages, when made or changed", async () => {
    expect(await createProperty({ ...PROPERTY, slug: "lake-house", publiclyListed: true })).toBe(
      "legal_required",
    );
    const property = await unlisted();
    expect(await updateProperty(property.id, { publiclyListed: true })).toBe("legal_required");

    await saveLegal({ ...COMPLETE_LEGAL, privacyPolicyEn: null });
    expect(await updateProperty(property.id, { publiclyListed: true })).toBe("legal_required");

    await saveLegal(COMPLETE_LEGAL);
    expect(await updateProperty(property.id, { publiclyListed: true })).toMatchObject({
      publiclyListed: true,
    });
  });

  it("is refused by the API with a field error", async () => {
    const created = await postProperty(
      send("POST", { ...PROPERTY, slug: "sea-view", publiclyListed: true }),
    );
    expect(created.status).toBe(422);
    expect((await created.json()).error.fields).toEqual({
      publiclyListed: ["needs the imprint and privacy policy first"],
    });

    const property = await unlisted();
    const patched = await patchProperty(send("PATCH", { publiclyListed: true }), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(patched.status).toBe(422);
    expect((await patched.json()).error.fields).toEqual({
      publiclyListed: ["needs the imprint and privacy policy first"],
    });
    // Anything else about the property can still be changed.
    expect((await updateProperty(property.id, { name: "Lake Lodge" })) as object).toMatchObject({
      name: "Lake Lodge",
    });
  });

  it("is refused by the database itself", async () => {
    const property = await unlisted();
    await expect(
      db.property.update({ where: { id: property.id }, data: { publiclyListed: true } }),
    ).rejects.toSatisfy(refusedWith("legal_required"));
    await expect(
      db.property.create({ data: { ...PROPERTY, slug: "sea-view", publiclyListed: true } }),
    ).rejects.toSatisfy(refusedWith("legal_required"));
  });
});

describe("emptying the legal pages", () => {
  const listed = async () => {
    await saveLegal(COMPLETE_LEGAL);
    const property = await unlisted();
    await updateProperty(property.id, { publiclyListed: true });
    return property;
  };

  it("is refused while a property is listed, naming what is required", async () => {
    await listed();
    const emptied: LegalInput = { ...COMPLETE_LEGAL, imprintEmail: null, privacyPolicyDe: null };
    expect(await saveLegal(emptied)).toEqual({
      error: "in_use",
      fields: ["imprintEmail", "privacyPolicyDe"],
    });
    const response = await putLegal(send("PUT", emptied));
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields).toEqual({
      imprintEmail: ["is required while a property is listed"],
      privacyPolicyDe: ["is required while a property is listed"],
    });
    // The optional parts can be emptied, and the rest edited.
    expect(
      await saveLegal({ ...COMPLETE_LEGAL, imprintPhone: null, imprintName: "Ada Lovelace" }),
    ).toMatchObject({ legal: { imprintName: "Ada Lovelace" } });
    expect(await isLegalComplete()).toBe(true);
  });

  it("is refused by the database itself, also by deleting the row", async () => {
    await listed();
    await expect(
      db.siteLegal.update({ where: { id: 1 }, data: { privacyPolicyEn: null } }),
    ).rejects.toSatisfy(refusedWith("legal_in_use"));
    await expect(db.siteLegal.delete({ where: { id: 1 } })).rejects.toSatisfy(
      refusedWith("legal_in_use"),
    );
  });

  it("counts an archived listed property too, so restoring it cannot bypass the gate", async () => {
    const property = await listed();
    await setArchived(property.id, true);
    expect(await saveLegal({ ...COMPLETE_LEGAL, imprintName: null })).toMatchObject({
      error: "in_use",
    });
  });

  it("is allowed once nothing is listed", async () => {
    const property = await listed();
    await updateProperty(property.id, { publiclyListed: false });
    expect(await saveLegal({ ...EMPTY_LEGAL })).toEqual({ legal: EMPTY_LEGAL });
  });

  it("waits for a listing in progress, then is refused", async () => {
    await saveLegal(COMPLETE_LEGAL);
    const property = await unlisted();
    let listedInTransaction!: () => void;
    const listing = new Promise<void>((resolve) => (listedInTransaction = resolve));
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));

    // A listing that has passed the gate but not committed yet...
    const transaction = db.$transaction(async (tx) => {
      await tx.property.update({ where: { id: property.id }, data: { publiclyListed: true } });
      listedInTransaction();
      await committed;
    });
    await listing;
    // ...makes emptying wait (the service's own check cannot see it yet)...
    const emptying = saveLegal({ ...COMPLETE_LEGAL, privacyPolicyDe: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    commit();
    await transaction;
    // ...and then refuse, seeing it.
    expect(await emptying).toMatchObject({ error: "in_use" });
    expect(await isLegalComplete()).toBe(true);
  });
});
