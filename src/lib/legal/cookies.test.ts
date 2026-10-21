import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALE_COOKIE } from "@/i18n/locales";
import { CALENDAR_PROPERTY_COOKIE } from "@/lib/calendar/property-choice";
import { STATE_COOKIE } from "@/lib/google/state";

import { COOKIE_NAMES, COOKIES } from "./cookies";

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("the cookie notice's list (GitLab #124)", () => {
  it("names the app's own cookies by the names the code uses", () => {
    for (const name of [STATE_COOKIE, LOCALE_COOKIE, CALENDAR_PROPERTY_COOKIE]) {
      expect(COOKIE_NAMES, name).toContain(name);
    }
  });

  it("names the Auth.js cookies the sign-in uses, as Auth.js names them", () => {
    // Auth.js's defaults (not exported): every cookie it may set, by option.
    const source = read("node_modules", "@auth", "core", "lib", "utils", "cookie.js");
    const names = (key: string) => {
      const block = new RegExp(`${key}: \\{[\\s\\S]*?name: \`([^\`]+)\``).exec(source)?.[1];
      if (!block) throw new Error(`Auth.js has no ${key} cookie any more`);
      return [
        block
          .replace("${cookiePrefix}", "__Secure-")
          .replace('${useSecureCookies ? "__Host-" : ""}', "__Host-"),
        block.replace("${cookiePrefix}", "").replace('${useSecureCookies ? "__Host-" : ""}', ""),
      ];
    };
    // Database sessions, the CSRF token, the return address, and PKCE -
    // Google's default check, as long as src/auth.ts sets no others.
    for (const key of ["sessionToken", "csrfToken", "callbackUrl", "pkceCodeVerifier"]) {
      for (const name of names(key)) expect(COOKIE_NAMES, `${key}: ${name}`).toContain(name);
    }
    expect(read("node_modules", "@auth", "core", "lib", "utils", "providers.js")).toContain(
      'c.checks ?? ["pkce"]',
    );
    const auth = read("src", "auth.ts");
    expect(auth).not.toMatch(/checks:/);
    expect(auth).not.toMatch(/cookies:/);
  });

  it("finds no cookie set in the app's code that it does not name", () => {
    // Every literal cookie written by the app's own code, by name.
    const written = [
      ...read("src", "lib", "google", "state.ts").matchAll(/`\$\{(\w+)\}=/g),
      ...read("src", "components", "shell", "user-menu.tsx").matchAll(/`\$\{(\w+)\}=/g),
      ...read("src", "app", "(app)", "calendar", "calendar-view.tsx").matchAll(/`\$\{(\w+)\}=/g),
    ].map((m) => m[1]);
    expect(written.sort()).toEqual([
      "CALENDAR_PROPERTY_COOKIE",
      "LOCALE_COOKIE",
      "STATE_COOKIE",
      "STATE_COOKIE",
    ]);
  });

  it("are all strictly necessary: no consent to ask for", () => {
    expect(COOKIES.every((c) => c.necessary)).toBe(true);
  });
});
