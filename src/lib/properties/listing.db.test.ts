import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { fillLegal } from "@/lib/legal/testing/complete-legal";
import {
  createProperty,
  getListedProperty,
  setArchived,
  updateProperty,
} from "@/lib/properties/service";

const base = { name: "Lake House", timezone: "UTC", currency: "EUR", color: "#0f766e" };
const create = (data: Partial<Parameters<typeof createProperty>[0]> = {}) =>
  createProperty({
    ...base,
    defaultNightlyRateMinor: 0,
    defaultCleaningFeeMinor: 0,
    publiclyListed: false,
    ...data,
  });

beforeEach(async () => {
  await db.property.deleteMany();
  await fillLegal();
});

afterAll(async () => {
  await db.property.deleteMany();
  await db.$disconnect();
});

describe("the public listing", () => {
  it("is off by default, and a listed active property is found by its slug", async () => {
    const property = await create({ slug: "lake-house" });
    if (typeof property === "string") throw new Error(property);
    expect(property.publiclyListed).toBe(false);
    expect(await getListedProperty("lake-house")).toBeNull();

    await updateProperty(property.id, { publiclyListed: true });
    expect((await getListedProperty("lake-house"))?.id).toBe(property.id);
  });

  it("hides an archived property, whatever its switch says", async () => {
    const property = await create({ slug: "lake-house", publiclyListed: true });
    if (typeof property === "string") throw new Error(property);
    await setArchived(property.id, true);
    expect(await getListedProperty("lake-house")).toBeNull();
    await setArchived(property.id, false);
    expect(await getListedProperty("lake-house")).not.toBeNull();
  });

  it("never looks up something that is not a slug", async () => {
    expect(await getListedProperty("Lake House")).toBeNull();
    expect(await getListedProperty("../properties")).toBeNull();
  });

  it("gives each slug to one property", async () => {
    await create({ slug: "lake-house" });
    expect(await create({ name: "Other", slug: "lake-house" })).toBe("slug_taken");
    const other = await create({ name: "Other" });
    if (typeof other === "string") throw new Error(other);
    expect(await updateProperty(other.id, { slug: "lake-house" })).toBe("slug_taken");
  });

  it("refuses to list a property without a slug, or to take a listed one's slug away", async () => {
    const property = await create();
    if (typeof property === "string") throw new Error(property);
    expect(await updateProperty(property.id, { publiclyListed: true })).toBe("slug_required");

    await updateProperty(property.id, { slug: "lake-house", publiclyListed: true });
    expect(await updateProperty(property.id, { slug: null })).toBe("slug_required");
    // Unlisting and clearing together is fine.
    const cleared = await updateProperty(property.id, { slug: null, publiclyListed: false });
    expect(cleared).toMatchObject({ slug: null, publiclyListed: false });
  });

  it("is held to the same rules by the database itself", async () => {
    const property = await create();
    if (typeof property === "string") throw new Error(property);
    await expect(
      db.property.update({ where: { id: property.id }, data: { publiclyListed: true } }),
    ).rejects.toThrow(/properties_listed_has_slug/);
    await expect(
      db.property.update({ where: { id: property.id }, data: { slug: "Not A Slug" } }),
    ).rejects.toThrow(/properties_slug_format/);
    await expect(
      db.property.update({ where: { id: property.id }, data: { slug: "ab" } }),
    ).rejects.toThrow(/properties_slug_format/);
  });
});
