/**
 * Arrival and departure times (GitLab #126): per property, the earliest
 * arrival, the earliest departure and the latest departure, each "HH:MM" in
 * the property's timezone or unset. A booking keeps the times it was
 * reserved or made under; before that, the property's apply. Client-safe;
 * the validation is in ./schema.
 */
export type StayTimes = {
  /** Anreise frühestens ab. */
  checkInTime: string | null;
  /** Abreise frühestens ab. */
  earliestCheckOutTime: string | null;
  /** Abreise spätestens bis. */
  checkOutTime: string | null;
};

export const NO_STAY_TIMES: StayTimes = {
  checkInTime: null,
  earliestCheckOutTime: null,
  checkOutTime: null,
};

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * "Anreise ab 15:00 · Abreise zwischen 08:00 und 10:00", with the
 * `stayTimes` messages; null when no time is set.
 */
export function describeStayTimes(t: Translate, times: StayTimes): string | null {
  const parts: string[] = [];
  if (times.checkInTime) parts.push(t("arrival", { time: times.checkInTime }));
  const { earliestCheckOutTime: from, checkOutTime: until } = times;
  if (from && until) {
    parts.push(
      from === until ? t("departureAt", { time: until }) : t("departureBetween", { from, until }),
    );
  } else if (from) parts.push(t("departureFrom", { time: from }));
  else if (until) parts.push(t("departureUntil", { time: until }));
  return parts.length > 0 ? parts.join(" · ") : null;
}
