/**
 * Which help belongs to which owner page (GitLab #121). Pure and
 * client-safe: the help button maps the path it is on to a key, and the
 * server reads help/<locale>/<key>.md. scripts/check-help.mjs fails the
 * build when a page has no help file; a unit test keeps this list in step
 * with the page files.
 */
export const HELP_ROUTES = [
  "/calendar",
  "/bookings",
  "/bookings/requests",
  "/bookings/new",
  "/bookings/[id]",
  "/bookings/[id]/edit",
  "/guests/[id]",
  "/finance",
  "/finance/categories",
  "/finance/import",
  "/finance/recurring",
  "/finance/tourist-tax",
  "/dashboard",
  "/settings",
  "/settings/properties/[id]/listing",
  "/settings/properties/[id]/pricing",
] as const;

/** Owner pages that need none: the root only redirects; the gallery and the guide are help themselves. */
export const NO_HELP_ROUTES = ["/", "/dev/ui", "/help"] as const;

export type HelpKey = string;

/** "/bookings/[id]/edit" -> "bookings-[id]-edit": the help file's name. */
export const helpKey = (route: string): HelpKey => route.slice(1).replaceAll("/", "-");

const patterns = HELP_ROUTES.map((route) => ({
  key: helpKey(route),
  // A fixed segment wins over [id]: /bookings/requests is not a booking.
  fixed: route.split("/").filter((s) => s && !s.startsWith("[")).length,
  pattern: new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`),
})).sort((a, b) => b.fixed - a.fixed);

/** The help key for a path the browser is on, or null where there is none. */
export function helpKeyFor(pathname: string): HelpKey | null {
  return patterns.find((p) => p.pattern.test(pathname))?.key ?? null;
}

/** Help keys are only ever these: nothing from the URL reaches the file system. */
export const isHelpKey = (key: string) => patterns.some((p) => p.key === key);
