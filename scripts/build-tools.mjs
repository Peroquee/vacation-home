#!/usr/bin/env node
/**
 * Bundles the maintenance scripts for the production tools image
 * (GitLab #96): each becomes one self-contained file in dist-tools/, with
 * the app code and its packages (Prisma's client included) inside, so the
 * image needs no node_modules for them. `npm run build:tools`.
 */
import { build } from "esbuild";

await build({
  entryPoints: [
    "scripts/guests-repurge.ts",
    "scripts/tokens-rotate.ts",
    "scripts/bookings-check.ts",
  ],
  outdir: "dist-tools",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // pg's optional native binding, required only if installed.
  external: ["pg-native"],
  logLevel: "warning",
  // CommonJS packages inside an ES module bundle expect these.
  banner: {
    js: [
      'import { createRequire } from "node:module";',
      'import { fileURLToPath as __toPath } from "node:url";',
      'import { dirname as __dirnameOf } from "node:path";',
      "const require = createRequire(import.meta.url);",
      "const __filename = __toPath(import.meta.url);",
      "const __dirname = __dirnameOf(__filename);",
    ].join("\n"),
  },
});
