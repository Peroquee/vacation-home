/**
 * Shared pieces for parsing list endpoints' query strings, so every list API
 * reads the same parameters the same way.
 */
import { z } from "zod";

import { isCalendarDate } from "@/lib/calendar-date";

/**
 * The query string as an object. A parameter given more than once
 * (`?categoryId=a&categoryId=b`, as URLSearchParams.append produces) is
 * joined with commas, the same as `?categoryId=a,b`.
 */
export function queryParams(request: Request): Record<string, string> {
  const params = new URL(request.url).searchParams;
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key).join(",")]),
  );
}

export const calendarDate = z
  .string()
  .trim()
  .refine(isCalendarDate, "must be a date as YYYY-MM-DD");

/** A comma-separated list of `item`; absent or empty means no filter. */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value !== ""
        ? value.split(",").map((part) => part.trim())
        : undefined,
    z.array(item).optional(),
  );

/** `?page=` with no value means the default, not zero. */
export const blankAsDefault = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

/** Page numbers stop somewhere sane: past this no list has rows anyway. */
export const page = blankAsDefault(z.coerce.number().int().min(1).max(10_000).default(1));
export const pageSize = (max: number, fallback: number) =>
  blankAsDefault(z.coerce.number().int().min(1).max(max).default(fallback));

/** Free text that may be blank, meaning none. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .nullable()
    .transform((value) => value || null);

/** For `.refine` on a query: `from` before `to` when both are valid dates. */
export const fromBeforeTo: [
  (q: { from?: unknown; to?: unknown }) => boolean,
  { path: PropertyKey[]; message: string },
] = [
  (q) =>
    typeof q.from !== "string" ||
    typeof q.to !== "string" ||
    !isCalendarDate(q.from) ||
    !isCalendarDate(q.to) ||
    q.from < q.to,
  { path: ["to"], message: "must be after from" },
];
