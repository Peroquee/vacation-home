/**
 * Seasons and the pricing rules of a property (GitLab #118). Server-side.
 * Season writes run under the property's lock, so two edits cannot both
 * pass the overlap check.
 */
import type { Prisma, Property, PropertySeason } from "@/generated/prisma/client";
import { withPropertyLock } from "@/lib/availability/service";
import { db, type DbClient } from "@/lib/db";

import type { PricingRules } from "./engine";
import type { SeasonInput } from "./schema";
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

/** What the engine prices a property's stays by. */
export async function pricingRulesFor(
  property: Pick<
    Property,
    "id" | "currency" | "defaultNightlyRateMinor" | "defaultCleaningFeeMinor"
  >,
  client: DbClient = db,
): Promise<PricingRules> {
  return {
    currency: property.currency,
    defaultNightlyRateMinor: property.defaultNightlyRateMinor,
    defaultCleaningFeeMinor: property.defaultCleaningFeeMinor,
    seasons: (await listSeasons(property.id, client)).map(seasonRule),
  };
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
