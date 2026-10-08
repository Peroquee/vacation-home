/**
 * The locale every number, currency and date in the UI is formatted with.
 *
 * Configured by NEXT_PUBLIC_APP_LOCALE, a BCP 47 tag such as "en-GB" or
 * "de-DE". Public because client components format too, which also makes it
 * a **build-time** setting: Next inlines its value into every bundle when the
 * app is built, so changing it means rebuilding. next.config.ts validates it
 * with `resolveAppLocale` below, so a bad value fails `next dev` and
 * `next build` rather than quietly formatting in some other locale.
 *
 * The currency and timezone are not part of the locale: they belong to each
 * property, so the formatting helpers take them as arguments.
 */
export const DEFAULT_LOCALE = "en-US";

/**
 * The canonical locale for a configured value: unset or blank means the
 * default. Throws for anything that is not a well-formed locale this runtime
 * can format in, since `Intl` would otherwise quietly fall back to another.
 */
export function resolveAppLocale(raw: string | undefined): string {
  const tag = raw?.trim() || DEFAULT_LOCALE;

  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(tag)[0];
  } catch {
    // Malformed; reported below.
  }

  if (!canonical || Intl.NumberFormat.supportedLocalesOf(canonical).length === 0) {
    throw new RangeError(
      `NEXT_PUBLIC_APP_LOCALE: "${tag}" is not a supported locale - use a tag such as en-US or de-DE`,
    );
  }
  return canonical;
}

export const APP_LOCALE = resolveAppLocale(
  // Must be read literally, so Next can inline it into the client bundle.
  // eslint-disable-next-line no-restricted-properties
  process.env.NEXT_PUBLIC_APP_LOCALE,
);
