import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Switches off every rule that would fight Prettier. Must stay after the presets.
  prettier,
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
    // The config module itself is the one place allowed to touch the raw environment.
    files: ["src/env.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
