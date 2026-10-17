import type { MetadataRoute } from "next";

/**
 * Search engines may index the public booking site and nothing else: the
 * start page at the root (GitLab #117) and /stay/. Only a request, not a
 * guard: the proxy's session check is what keeps the rest private. "$"
 * ends a path, so "/$" allows the root alone, not everything under it.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/$", "/stay"], disallow: "/" } };
}
