/**
 * Seasons and the pricing rules of a property (GitLab #118). Server-side.
 * Season writes run under the property's lock, so two edits cannot both
 * pass the overlap check.
 */
import type { Prisma, Property, PropertySeason } from "@/generated/prisma/client";
import { withPropertyLock } from "@/lib/availability/service";
import { db, type DbClient } from "@/lib/db";

import type { PricingRules, StayDiscount } from "./engine";
import type { TouristTaxRules } from "./tourist-tax";
import { type SeasonInput, touristTaxSchema } from "./schema";
import { overlapping, type Season, seasonRule } from "./seasons";

export type SeasonDto = Season;

export const toSeason = (row: PropertySeason): Season => ({
  id: row.id,
  name: row.name,
  startMonth: row.startMonth,
  startDay: row.startDay,
  endMonth: row.endMonth,
  endDay: row.endDay,
  year: row.year,
  rateMinor: row.rateMinor,
});

/**
 * Chronological, and total: by first day (month, day), a yearly season
 * before a one-off one starting the same day (the one-off then wins on its
 * days, as in the 12-month strip), then by name, then by id.
 */
const ORDER: Prisma.PropertySeasonOrderByWithRelationInput[] = [
  { startMonth: "asc" },
  { startDay: "asc" },
  { year: { sort: "asc", nulls: "first" } },
  { name: "asc" },
  { id: "asc" },
];

export async function listSeasons(propertyId: string, client: DbClient = db): Promise<Season[]> {
  const rows = await client.propertySeason.findMany({ where: { propertyId }, orderBy: ORDER });
  return rows.map(toSeason);
}

/** Seasons of several properties at once, by property id. */
export async function listSeasonsFor(propertyIds: string[]): Promise<Map<string, Season[]>> {
  const rows = await db.propertySeason.findMany({
    where: { propertyId: { in: propertyIds } },
    orderBy: ORDER,
  });
  const by = new Map<string, Season[]>(propertyIds.map((id) => [id, []]));
  for (const row of rows) by.get(row.propertyId)?.push(toSeason(row));
  return by;
}

type Priced = Pick<
  Property,
  "id" | "currency" | "defaultNightlyRateMinor" | "defaultCleaningFeeMinor"
>;

/** What the engine prices a property's stays by. */
export async function pricingRulesFor(
  property: Priced,
  client: DbClient = db,
): Promise<PricingRules> {
  const [seasons, discounts, touristTax] = await Promise.all([
    listSeasons(property.id, client),
    listDiscounts(property.id, client),
    getTouristTax(property.id, client),
  ]);
  return rulesOf(property, seasons, discounts, touristTax);
}

/** The pricing rules of several properties at once, by property id. */
export async function pricingRulesForMany(
  properties: Priced[],
): Promise<Map<string, PricingRules>> {
  const ids = properties.map((p) => p.id);
  const [seasons, discounts, taxes] = await Promise.all([
    listSeasonsFor(ids),
    db.propertyStayDiscount.findMany({
      where: { propertyId: { in: ids } },
      orderBy: { minNights: "asc" },
    }),
    db.propertyTouristTax.findMany({ where: { propertyId: { in: ids } } }),
  ]);
  return new Map(
    properties.map((p) => [
      p.id,
      rulesOf(
        p,
        seasons.get(p.id) ?? [],
        discounts.filter((d) => d.propertyId === p.id).map(toDiscount),
        parseTouristTax(taxes.find((t) => t.propertyId === p.id)?.rules),
      ),
    ]),
  );
}

const rulesOf = (
  property: Priced,
  seasons: Season[],
  discounts: StayDiscount[],
  touristTax: TouristTaxRules | null,
): PricingRules => ({
  currency: property.currency,
  defaultNightlyRateMinor: property.defaultNightlyRateMinor,
  defaultCleaningFeeMinor: property.defaultCleaningFeeMinor,
  seasons: seasons.map(seasonRule),
  discounts,
  touristTax,
});

/** Stored rules, read back through the API's own validation; null for none. */
function parseTouristTax(value: unknown): TouristTaxRules | null {
  if (value === undefined || value === null) return null;
  const parsed = touristTaxSchema.safeParse({ rules: value });
  return parsed.success ? parsed.data.rules : null;
}

/** The property's Kurtaxe rules (GitLab #120), or null: no Kurtaxe. */
export async function getTouristTax(
  propertyId: string,
  client: DbClient = db,
): Promise<TouristTaxRules | null> {
  const row = await client.propertyTouristTax.findUnique({ where: { propertyId } });
  return parseTouristTax(row?.rules);
}

/**
 * Replaces the property's Kurtaxe rules, or removes them with null. Null
 * when there is no such property. Bookings keep the Kurtaxe they were given.
 */
export async function saveTouristTax(
  propertyId: string,
  rules: TouristTaxRules | null,
): Promise<{ rules: TouristTaxRules | null } | null> {
  return withPropertyLock(propertyId, async (tx) => {
    if (rules === null) {
      await tx.propertyTouristTax.deleteMany({ where: { propertyId } });
    } else {
      await tx.propertyTouristTax.upsert({
        where: { propertyId },
        create: { propertyId, rules },
        update: { rules },
      });
    }
    return { rules: await getTouristTax(propertyId, tx) };
  });
}

const toDiscount = (row: { minNights: number; percent: number }): StayDiscount => ({
  minNights: row.minNights,
  percent: row.percent,
});

/** The property's length-of-stay discounts (GitLab #119), fewest nights first. */
export async function listDiscounts(
  propertyId: string,
  client: DbClient = db,
): Promise<StayDiscount[]> {
  const rows = await client.propertyStayDiscount.findMany({
    where: { propertyId },
    orderBy: { minNights: "asc" },
  });
  return rows.map(toDiscount);
}

/**
 * Replaces the property's discount tiers (validated by stayDiscountsSchema:
 * one per night count). Null when there is no such property. Bookings keep
 * the price they were given.
 */
export async function saveDiscounts(
  propertyId: string,
  tiers: StayDiscount[],
): Promise<StayDiscount[] | null> {
  return withPropertyLock(propertyId, async (tx) => {
    await tx.propertyStayDiscount.deleteMany({ where: { propertyId } });
    if (tiers.length > 0) {
      await tx.propertyStayDiscount.createMany({
        data: tiers.map((tier) => ({ propertyId, ...tier })),
      });
    }
    return listDiscounts(propertyId, tx);
  });
}

export type SeasonWrite =
  { season: Season } | { error: "not_found" } | { error: "overlaps"; with: string };

/** Adds a season, or replaces `seasonId`'s; refused when it would overlap one. */
export async function saveSeason(
  propertyId: string,
  input: SeasonInput,
  seasonId?: string,
): Promise<SeasonWrite> {
  const result = await withPropertyLock(propertyId, async (tx): Promise<SeasonWrite> => {
    const others = await listSeasons(propertyId, tx);
    if (seasonId && !others.some((s) => s.id === seasonId)) return { error: "not_found" };
    const clash = overlapping({ ...input, id: seasonId }, others);
    if (clash) return { error: "overlaps", with: clash.name };
    const row = seasonId
      ? await tx.propertySeason.update({ where: { id: seasonId }, data: input })
      : await tx.propertySeason.create({ data: { propertyId, ...input } });
    return { season: toSeason(row) };
  });
  return result ?? { error: "not_found" };
}

export async function deleteSeason(propertyId: string, seasonId: string): Promise<boolean> {
  const { count } = await db.propertySeason.deleteMany({ where: { id: seasonId, propertyId } });
  return count > 0;
}
