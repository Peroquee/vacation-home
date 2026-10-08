import type { NextConfig } from "next";

import { resolveAppLocale } from "./src/lib/locale";

// NEXT_PUBLIC_APP_LOCALE is inlined into the bundles at build time, so it is
// validated here - when `next dev` or `next build` starts - rather than with
// the runtime configuration in src/env.ts, which could only check a value the
// built app no longer reads. Throws with a message naming the variable.
resolveAppLocale(process.env.NEXT_PUBLIC_APP_LOCALE);

const nextConfig: NextConfig = {/* config options here */};

export default nextConfig;
