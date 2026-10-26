import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * Keeps server code out of browser bundles (GitLab #148): a "use client"
 * file may not import zod, Prisma's client, the validated environment, the
 * database or Node's built-ins. Type-only imports are fine: they vanish in
 * the build. What a client file reaches through other modules is caught by
 * `import "server-only"` in the server modules, at build time.
 */
const SERVER_ONLY_IMPORTS = [
  /^zod(\/|$)/,
  /^@prisma\//,
  /^@\/generated\/prisma(\/|$)/,
  /^@\/env$/,
  /^@\/lib\/db$/,
  /^@\/auth$/,
  /^node:/,
];
const noServerImportsInClient = {
  meta: {
    type: "problem",
    messages: {
      server:
        'A "use client" file must not import {{source}}: it is server code, and would reach the browser bundle. Fetch it through an API route or pass it in as props.',
    },
    schema: [],
  },
  create(context) {
    const client = context.sourceCode.ast.body.some(
      (node) => node.type === "ExpressionStatement" && node.directive === "use client",
    );
    if (!client) return {};
    const check = (node, source, typeOnly) => {
      if (typeOnly || typeof source !== "string") return;
      if (SERVER_ONLY_IMPORTS.some((pattern) => pattern.test(source))) {
        context.report({ node, messageId: "server", data: { source } });
      }
    };
    const typeOnly = (node) =>
      node.importKind === "type" ||
      node.exportKind === "type" ||
      (node.specifiers?.length > 0 &&
        node.specifiers.every((s) => s.importKind === "type" || s.exportKind === "type"));
    return {
      ImportDeclaration: (node) => check(node, node.source.value, typeOnly(node)),
      ExportNamedDeclaration: (node) =>
        node.source && check(node, node.source.value, typeOnly(node)),
      ExportAllDeclaration: (node) => check(node, node.source.value, node.exportKind === "type"),
      ImportExpression: (node) => check(node, node.source.value, false),
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Switches off every rule that would fight Prettier. Must stay after the presets.
  prettier,
  {
    plugins: { local: { rules: { "no-server-imports-in-client": noServerImportsInClient } } },
    rules: { "local/no-server-imports-in-client": "error" },
  },
  {
    rules: {
      // The environment is read and validated in exactly one module; everything
      // else imports the typed `env` object so a missing variable cannot reach
      // production as `undefined`. Two cases legitimately need a literal read
      // and must carry an inline disable with a reason: `process.env.NODE_ENV`,
      // and any `process.env.NEXT_PUBLIC_*`, which Next can only inline when it
      // appears verbatim in the source.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Import the validated `env` object from `@/env` instead of reading process.env directly.",
        },
      ],
    },
  },
  {
    // "Today" is a date somewhere (GitLab #139): todayIn(timezone) or
    // appToday() from src/lib/today.ts and src/lib/app-today.ts. A bare
    // new Date() turned into a date is UTC's (or the browser's) day, which
    // between midnight and 02:00 in Berlin is still yesterday. Tests may.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^(slice|split|substring)$/][object.callee.property.name='toISOString'][object.callee.object.type='NewExpression'][object.callee.object.arguments.length=0]",
          message:
            "That is today in UTC. Use todayIn(timezone) from @/lib/today, or appToday() from @/lib/app-today.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^get(UTC)?(FullYear|Month|Date)$/][callee.object.type='NewExpression'][callee.object.arguments.length=0]",
          message:
            "That is today in UTC or in the browser. Use todayIn(timezone) from @/lib/today, or appToday() from @/lib/app-today.",
        },
      ],
    },
  },
  {
    // The config modules are the places allowed to touch the raw environment.
    // prisma.config.ts is read by the Prisma CLI, never by the app, so it
    // cannot use `@/env`.
    // Neither do the test tooling configs and the e2e harness, which run in
    // Node outside the app.
    files: [
      "src/env.ts",
      "prisma.config.ts",
      "next.config.ts",
      "playwright.config.ts",
      "playwright.ux.config.ts",
      "e2e/**/*.{ts,mjs}",
      "vitest.db.config.mts",
      "prisma/seed.ts",
      "scripts/ux/seed.ts",
      "vitest.db.setup.mts",
      "vitest.db.each-file.mts",
      "vitest.clock.ts",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // npm's download store, relocated here by CI so the cache can carry it.
    ".npm/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma client, generated by `prisma generate`.
    "src/generated/**",
    // Playwright output.
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    // Maintenance scripts bundled for the tools image (scripts/build-tools.mjs).
    "dist-tools/**",
    // Lighthouse reports.
    "lighthouse/**",
  ]),
]);

export default eslintConfig;
