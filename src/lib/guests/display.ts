/** How a guest's name reads on screen. Client-safe. */

/**
 * The name stored for a purged guest. Not personal data by design. On
 * screen it shows in the page's language (`guests.purgedName`).
 */
export const PURGED_GUEST_NAME = "Deleted guest";

/** The guest's name, or the translated stand-in for an erased guest. */
export function guestDisplayName(name: string, purgedName: string): string {
  return name === PURGED_GUEST_NAME ? purgedName : name;
}
