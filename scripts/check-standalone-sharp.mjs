#!/usr/bin/env node
/**
 * Proves the production server can process photos (GitLab #106): loads
 * sharp from the standalone output - what the Docker image ships, without
 * the project's node_modules - and re-encodes a small picture with it.
 * Output file tracing can miss a native dependency; this catches that at
 * build time instead of at the first upload. Run after `npm run build`:
 *
 *   node scripts/check-standalone-sharp.mjs
 */
import { createRequire } from "node:module";
import { join } from "node:path";

const standalone = join(process.cwd(), ".next", "standalone");
// Resolve as the server would: from inside the standalone folder only.
const require = createRequire(join(standalone, "server.js"));
let sharp;
try {
  sharp = require("sharp");
} catch (error) {
  console.error(`sharp is missing from .next/standalone: ${error.message}`);
  process.exit(1);
}
if (!require.resolve("sharp").startsWith(standalone)) {
  console.error(`sharp resolved outside the standalone output: ${require.resolve("sharp")}`);
  process.exit(1);
}
const webp = await sharp({
  create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 40 } },
})
  .jpeg()
  .toBuffer()
  .then((jpeg) => sharp(jpeg).rotate().resize({ width: 32 }).webp().toBuffer());
const { format, width } = await sharp(webp).metadata();
if (format !== "webp" || width !== 32) {
  console.error(`unexpected result: ${format} ${width}px`);
  process.exit(1);
}
console.log(
  `sharp ${sharp.versions.sharp} (libvips ${sharp.versions.vips}) works from .next/standalone.`,
);
