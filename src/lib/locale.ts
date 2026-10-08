/**
 * The locale every number, currency and date in the UI is formatted with.
 *
 * Configured by NEXT_PUBLIC_APP_LOCALE (a BCP 47 tag such as "en-GB" or
 * "de-DE"), which src/env.ts validates at boot. It is public because client
 * components format too, and it is read here rather than through `@/env`
 * because that module is server-only.
 *
 * The currency and timezone are not part of the locale: they belong to each
 * property, so the formatting helpers take them as arguments.
 */
export const DEFAULT_LOCALE = "en-US";

/** The canonical form of `tag`, or null when it is not a valid locale. */
export function canonicalLocale(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

export const APP_LOCALE =
  // Must be read literally, so Next can inline it into the client bundle.
  // eslint-disable-next-line no-restricted-properties
  canonicalLocale(process.env.NEXT_PUBLIC_APP_LOCALE || DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
