/**
 * The iCal feeds of a property, both ways (GitLab #99). Server-side only.
 *
 * - **Import feeds**: a platform's export URL per feed. The URL carries the
 *   platform's secret, so the API shows only its host.
 * - **Export**: off until switched on. Switching it on makes a random token,
 *   the feed's only secret (/api/ical/<token>.ics); regenerating replaces
 *   it, so the old URL stops working at once; switching off removes it.
 */
import { randomBytes } from "node:crypto";

import { z } from "zod";

import { env } from "@/env";
import type { IcalFeed } from "@/generated/prisma/client";
import { invalidateWindows } from "@/lib/availability/cache";
import { db } from "@/lib/db";

export const createFeedSchema = z.object({
  name: z.string().trim().min(1, "is required").max(60, "must be at most 60 characters"),
  url: z
    .string()
    .trim()
    .max(2000, "must be at most 2000 characters")
    .refine((value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "must be an http(s) link to the platform's calendar export"),
});

/** A feed as the API shows it: never its full URL. */
export function toFeedDto(feed: IcalFeed) {
  return {
    id: feed.id,
    propertyId: feed.propertyId,
    name: feed.name,
    host: new URL(feed.url).host,
    lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    lastSuccessAt: feed.lastSuccessAt?.toISOString() ?? null,
    /** A code (src/lib/ical/fetch.ts, or `not_ical`); null after a success. */
    lastError: feed.lastError,
    eventCount: feed.eventCount,
    conflictCount: feed.conflictCount,
    nextFetchAt: feed.nextFetchAt.toISOString(),
  };
}

export type FeedDto = ReturnType<typeof toFeedDto>;

export function listFeeds(propertyId: string) {
  return db.icalFeed.findMany({
    where: { propertyId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function createFeed(propertyId: string, input: z.infer<typeof createFeedSchema>) {
  return db.icalFeed.create({ data: { propertyId, ...input } });
}

/** Deletes a feed with its blocks and issues. False when there is none. */
export async function deleteFeed(id: string): Promise<boolean> {
  const feed = await db.icalFeed.findUnique({ where: { id }, select: { propertyId: true } });
  if (!feed) return false;
  await db.icalFeed.delete({ where: { id } });
  invalidateWindows(feed.propertyId);
  return true;
}

// --- Export ---------------------------------------------------------------------

export type ExportDto = { enabled: false; url: null } | { enabled: true; url: string };

export function exportUrl(token: string): string {
  return new URL(`/api/ical/${token}.ics`, env.APP_URL).toString();
}

const toExportDto = (token: string | null): ExportDto =>
  token ? { enabled: true, url: exportUrl(token) } : { enabled: false, url: null };

export async function getExport(propertyId: string): Promise<ExportDto | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { icalExportToken: true },
  });
  return property ? toExportDto(property.icalExportToken) : null;
}

/**
 * Switches the export on (keeping an existing token), or with `rotate` gives
 * it a new token, so the old URL stops working.
 */
export async function enableExport(propertyId: string, rotate: boolean): Promise<ExportDto | null> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { icalExportToken: true },
  });
  if (!property) return null;
  if (property.icalExportToken && !rotate) return toExportDto(property.icalExportToken);
  const token = randomBytes(24).toString("base64url");
  await db.property.update({ where: { id: propertyId }, data: { icalExportToken: token } });
  return toExportDto(token);
}

export async function disableExport(propertyId: string): Promise<ExportDto | null> {
  const updated = await db.property.updateMany({
    where: { id: propertyId },
    data: { icalExportToken: null },
  });
  return updated.count > 0 ? toExportDto(null) : null;
}

/** The property behind an export token, or null for an unknown or malformed one. */
export function propertyForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return Promise.resolve(null);
  return db.property.findUnique({
    where: { icalExportToken: token },
    select: { id: true, name: true, timezone: true },
  });
}
