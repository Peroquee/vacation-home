/**
 * The expense breakdown's rows: the largest categories, with the long tail
 * folded into one "Other" row so no category becomes an unreadable sliver.
 * Client-safe.
 */
export type CategoryShare = {
  categoryId: string;
  name: string;
  color: string;
  amountMinor: number;
  /** 0-1 of all expenses; null when there were none. */
  share: number | null;
};

export type BreakdownRow =
  | (CategoryShare & { kind: "category" })
  | {
      kind: "other";
      name: string;
      amountMinor: number;
      share: number;
      /** The folded categories, for the tooltip and the table. */
      categories: CategoryShare[];
    };

/** Below this share of all expenses a category joins "Other". */
export const OTHER_THRESHOLD = 0.03;
/** At most this many categories of their own; the rest join "Other". */
export const MAX_CATEGORIES = 7;

/**
 * Largest first. A category gets its own row when its share is at least
 * `threshold` and it is among the `max` largest; everything else is summed
 * into "Other", which is only shown when it holds more than one category
 * (a single small category keeps its own name instead).
 */
export function breakdownRows(
  rows: CategoryShare[],
  { threshold = OTHER_THRESHOLD, max = MAX_CATEGORIES } = {},
): BreakdownRow[] {
  const sorted = rows
    .filter((r) => r.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const own = sorted.filter((r, i) => i < max && (r.share ?? 0) >= threshold);
  const rest = sorted.filter((r) => !own.includes(r));
  if (rest.length === 1) own.push(rest.pop()!);
  const result: BreakdownRow[] = own.map((r) => ({ ...r, kind: "category" }));
  if (rest.length > 0) {
    result.push({
      kind: "other",
      name: "Other",
      amountMinor: rest.reduce((sum, r) => sum + r.amountMinor, 0),
      share: rest.reduce((sum, r) => sum + (r.share ?? 0), 0),
      categories: rest,
    });
  }
  return result;
}
