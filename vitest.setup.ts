/**
 * Runs before every test file. The jest-dom matchers (`toBeInTheDocument`,
 * ...) only matter to component tests, but registering them is cheap.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Testing Library only unmounts automatically when test globals are enabled,
// which they are not here.
afterEach(cleanup);

/**
 * Components translate through next-intl. Tests run them in British English
 * with the real catalogue, through next-intl's own translator, so a test
 * sees exactly the text a user would, without a provider in every test.
 * A test that wants German overrides these mocks.
 */
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { default: messages } = await import("./messages/en-GB.json");
  return {
    ...actual,
    useLocale: () => "en-GB",
    useMessages: () => messages,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "en-GB", messages, namespace: namespace as never }),
  };
});
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("./messages/en-GB.json");
  return {
    getLocale: async () => "en-GB",
    getMessages: async () => messages,
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en-GB", messages, namespace: namespace as never }),
  };
});
