/**
 * Which property the calendar shows: one, or all of them combined. The URL
 * says it (`?property=<id>` or `?property=all`); without that, the user's
 * last choice, remembered in a cookie; otherwise all. Client-safe.
 *
 * The cookie is tagged with the user's id, so on a shared browser one
 * user's choice is never applied to another.
 */
export const CALENDAR_PROPERTY_COOKIE = "calendar-property";

export type PropertyChoice = "all" | (string & {});

/** The cookie's value for a user's choice. */
export function choiceCookie(userId: string, choice: PropertyChoice): string {
  return `${userId}:${choice}`;
}

/** The choice to show, among the properties that exist. */
export function resolveChoice({
  param,
  cookie,
  userId,
  propertyIds,
}: {
  param?: string;
  cookie?: string;
  userId?: string;
  propertyIds: string[];
}): PropertyChoice {
  const valid = (choice: string | undefined): choice is PropertyChoice =>
    choice === "all" || (choice !== undefined && propertyIds.includes(choice));
  if (valid(param)) return param;
  if (cookie && userId && cookie.startsWith(`${userId}:`)) {
    const remembered = cookie.slice(userId.length + 1);
    if (valid(remembered)) return remembered;
  }
  return "all";
}
