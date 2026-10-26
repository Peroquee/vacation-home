/**
 * Server code stays out of browser bundles (GitLab #148): the lint rule for
 * "use client" files, and the `import "server-only"` marker in the server
 * modules, which fails the build if a client bundle reaches one of them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const lint = async (code: string, filePath = "src/components/example.tsx") => {
  const [result] = await new ESLint({ cwd: process.cwd() }).lintText(code, { filePath });
  return result!.messages
    .filter((m) => m.ruleId === "local/no-server-imports-in-client")
    .map((m) => m.message);
};

describe('a "use client" file', () => {
  it("may not import server code", async () => {
    for (const source of [
      "@/lib/db",
      "@/env",
      "@/auth",
      "zod",
      "@/generated/prisma/client",
      "@prisma/adapter-pg",
      "node:fs",
    ]) {
      const messages = await lint(
        `"use client";\nimport { x } from "${source}";\nexport const y = x;\n`,
      );
      expect(messages, source).toEqual([expect.stringContaining(`must not import ${source}`)]);
    }
    expect(
      await lint(`"use client";\nexport async function f() {\n  return import("@/lib/db");\n}\n`),
    ).toHaveLength(1);
  });

  it("may import types from it, and anything else", async () => {
    expect(
      await lint(
        `"use client";\nimport type { Booking } from "@/generated/prisma/client";\nimport { useState } from "react";\nexport type B = Booking;\nexport const s = useState;\n`,
      ),
    ).toEqual([]);
  });

  it("is the only kind of file the rule checks", async () => {
    expect(await lint(`import { db } from "@/lib/db";\nexport const d = db;\n`)).toEqual([]);
  });
});

describe("the server modules", () => {
  it("are marked server-only, so the build fails if a client bundle reaches one", () => {
    const services = readdirSync("src/lib", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("src/lib", entry.name, "service.ts"))
      .filter((file) => {
        try {
          readFileSync(file);
          return true;
        } catch {
          return false;
        }
      });
    const marked = [
      "src/lib/db.ts",
      "src/env.ts",
      "src/auth.ts",
      "src/lib/payments/guest-link.ts",
      ...services,
    ];
    expect(services.length).toBeGreaterThan(10);
    for (const file of marked) {
      expect(readFileSync(file, "utf8"), file).toMatch(/^import "server-only";$/m);
    }
  });
});
