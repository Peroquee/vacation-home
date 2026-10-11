/**
 * Every route the app serves, read from the route files under src/app, so a
 * route added later is covered without anyone remembering to list it. Used
 * by the access tests (src/lib/access.routes.test.ts and e2e/access.spec.ts)
 * to prove that only the intended routes are reachable without a session.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type AppRoute = {
  /** The route as Next names it, e.g. "/api/properties/[id]". */
  route: string;
  /** A concrete URL path for it, dynamic segments filled with sample values. */
  path: string;
  kind: "page" | "api";
  /** The HTTP methods it answers: GET for a page, the exported ones for a handler. */
  methods: string[];
  /** The file, relative to the repository root. */
  file: string;
};

/**
 * The full list of routes reachable without a session (src/lib/access.ts).
 * Adding one here is a security decision: say why there.
 */
export const PUBLIC_ROUTES = [
  // The public booking site (GitLab #105).
  "/api/public/properties/[slug]",
  "/api/public/properties/[slug]/stay-check",
  "/robots.txt",
  "/stay/[slug]",
  // Signing in, and what has its own secret or reveals nothing.
  "/api/auth/[...nextauth]",
  "/api/google/webhook",
  "/api/health",
  "/api/ical/[token]",
  "/api/ready",
  "/signin",
].sort();

// From the working directory: both Vitest and Playwright run from the
// repository root, and Playwright loads this file as CommonJS, where
// import.meta does not exist.
const APP_DIR = join(process.cwd(), "src", "app");

/** Files that are routes of their own. Layouts, error pages and the like are not. */
const ROUTE_FILES: Record<
  string,
  (segments: string[]) => { route: string; kind: AppRoute["kind"] }
> = {
  "page.tsx": (segments) => ({ route: `/${segments.join("/")}`, kind: "page" }),
  "route.ts": (segments) => ({ route: `/${segments.join("/")}`, kind: "api" }),
  // Next's metadata route: served as /robots.txt.
  "robots.ts": (segments) => ({ route: `/${[...segments, "robots.txt"].join("/")}`, kind: "page" }),
};

/** File names under src/app that never define a route. */
const NOT_ROUTES =
  /^(layout|template|error|global-error|not-found|loading|default)\.tsx$|\.test\.tsx?$/;

/** Next metadata files that would add routes this list does not know how to name. */
const UNSUPPORTED = /^(sitemap|manifest|icon|apple-icon|opengraph-image|twitter-image)\./;

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** A sample value per dynamic segment, so the path can be requested. */
function sample(segment: string): string {
  if (segment.startsWith("[[...") || segment.startsWith("[...")) return "a/b";
  if (segment === "[id]") return "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  if (segment === "[slug]") return "lake-house";
  return "sample";
}

/**
 * The methods a route handler exports, in the forms this app writes them:
 * `export (async) function GET`, `export const GET` and
 * `export const { GET, POST } = ...`.
 */
function exportedMethods(source: string): string[] {
  const destructured = [...source.matchAll(/export\s+const\s*\{([^}]*)\}/g)].flatMap((m) =>
    m[1]!.split(",").map((name) => name.trim()),
  );
  return METHODS.filter(
    (method) =>
      destructured.includes(method) ||
      new RegExp(`export\\s+((async\\s+)?function|const)\\s+${method}\\b`).test(source),
  );
}

export function appRoutes(): AppRoute[] {
  const routes: AppRoute[] = [];
  const entries = readdirSync(APP_DIR, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dir = relative(APP_DIR, entry.parentPath);
    const parts = dir === "" ? [] : dir.split(sep);
    // Private folders (_x) hold no routes.
    if (parts.some((part) => part.startsWith("_"))) continue;
    if (parts.some((part) => part.startsWith("@"))) {
      throw new Error(`parallel route in ${dir}: teach e2e/app-routes.ts about it`);
    }
    if (UNSUPPORTED.test(entry.name)) {
      throw new Error(`${join(dir, entry.name)}: teach e2e/app-routes.ts about this route file`);
    }
    const make = ROUTE_FILES[entry.name];
    if (!make || NOT_ROUTES.test(entry.name)) continue;

    // Route groups, "(app)", shape layouts but not URLs.
    const segments = parts.filter((part) => !/^\(.+\)$/.test(part));
    const { route, kind } = make(segments);
    const file = relative(join(APP_DIR, "..", ".."), join(entry.parentPath, entry.name));
    const methods =
      entry.name === "route.ts"
        ? exportedMethods(readFileSync(join(entry.parentPath, entry.name), "utf8"))
        : ["GET"];
    if (methods.length === 0) throw new Error(`${file} exports no HTTP method`);
    const path = route.replace(
      /\/\[{1,2}(\.\.\.)?[^\]]+\]{1,2}/g,
      (match) => `/${sample(match.slice(1))}`,
    );
    routes.push({ route, path, kind, methods, file });
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}
