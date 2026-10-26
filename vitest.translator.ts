/**
 * The translator the component tests render with (GitLab #146): the real
 * catalogue, through next-intl's own createTranslator, but strict. A key
 * missing in English, or in German, or a message given the wrong values,
 * fails the test instead of rendering "namespace.key" as next-intl does by
 * default, so a missing translation cannot pass. See vitest.setup.ts.
 */
import type { createTranslator as CreateTranslator } from "next-intl";

type Messages = Record<string, unknown>;
type Call = (key: string, ...rest: unknown[]) => unknown;

export function strictTranslator(
  createTranslator: typeof CreateTranslator,
  english: Messages,
  german: Messages,
  namespace?: string,
) {
  const fail = (error: Error) => {
    throw error;
  };
  const make = (locale: "en-GB" | "de-DE", messages: Messages) =>
    createTranslator({
      locale,
      messages: messages as never,
      namespace: namespace as never,
      onError: fail,
    }) as unknown as Call & { rich: Call; markup: Call; raw: Call; has: (key: string) => boolean };
  const en = make("en-GB", english);
  const de = make("de-DE", german);
  const inGerman = (key: string) => {
    if (!de.has(key)) {
      throw new Error(`MISSING_MESSAGE: ${namespace ? `${namespace}.` : ""}${key} (de-DE)`);
    }
  };
  const t = (key: string, ...rest: unknown[]) => {
    inGerman(key);
    return en(key, ...rest);
  };
  return Object.assign(t, {
    rich: (key: string, ...rest: unknown[]) => (inGerman(key), en.rich(key, ...rest)),
    markup: (key: string, ...rest: unknown[]) => (inGerman(key), en.markup(key, ...rest)),
    raw: (key: string, ...rest: unknown[]) => (inGerman(key), en.raw(key, ...rest)),
    has: (key: string) => en.has(key),
  });
}
