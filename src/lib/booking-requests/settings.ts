/**
 * How booking requests are handled, per property (GitLab #110): how long a
 * request waits for an answer, and how long declined and expired ones are
 * kept before they are anonymised. Server-side only.
 */
import { z } from "zod";

import type { RequestSettings as Row } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type RequestSettings = { expiryDays: number; retentionMonths: number };

export const DEFAULT_REQUEST_SETTINGS: RequestSettings = { expiryDays: 3, retentionMonths: 6 };

const whole = (min: number, max: number) =>
  z
    .int({ error: `must be a whole number from ${min} to ${max}` })
    .min(min, `must be a whole number from ${min} to ${max}`)
    .max(max, `must be a whole number from ${min} to ${max}`);

/** PUT /api/properties/:id/request-settings; the database checks the same. */
export const requestSettingsSchema = z.strictObject({
  expiryDays: whole(1, 30),
  retentionMonths: whole(1, 36),
});

const toSettings = (row: Row | null): RequestSettings =>
  row
    ? { expiryDays: row.expiryDays, retentionMonths: row.retentionMonths }
    : DEFAULT_REQUEST_SETTINGS;

export async function getRequestSettings(propertyId: string): Promise<RequestSettings> {
  return toSettings(await db.requestSettings.findUnique({ where: { propertyId } }));
}

/** Settings for several properties at once, by property id. */
export async function getRequestSettingsFor(
  propertyIds: string[],
): Promise<Map<string, RequestSettings>> {
  const rows = await db.requestSettings.findMany({ where: { propertyId: { in: propertyIds } } });
  const byProperty = new Map(rows.map((row) => [row.propertyId, toSettings(row)]));
  return new Map(propertyIds.map((id) => [id, byProperty.get(id) ?? DEFAULT_REQUEST_SETTINGS]));
}

export async function saveRequestSettings(
  propertyId: string,
  input: RequestSettings,
): Promise<RequestSettings> {
  return toSettings(
    await db.requestSettings.upsert({
      where: { propertyId },
      create: { propertyId, ...input },
      update: input,
    }),
  );
}
