import type { MetadataRoute } from "next";

/**
 * Search engines may index the public booking site and nothing else. Only a
 * request, not a guard: the proxy's session check is what keeps the rest
 * private.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/stay/", disallow: "/" } };
}
