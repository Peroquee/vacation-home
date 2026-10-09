/**
 * The languages the app speaks, and how a request picks one. Client-safe.
 *
 * A locale is a full tag (de-DE, en-GB) because it also decides number,
 * date and currency formats and the first day of the week. The choice is a
 * cookie, set from the user menu; without it, the browser's preferred
 * languages; without those, German.
 */
export const LOCALES = ["de-DE", "en-GB"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de-DE";
export const LOCALE_COOKIE = "locale";

/** Each locale's name in its own language, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  "de-DE": "Deutsch",
  "en-GB": "English",
};

export function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? "");
}

/**
 * The browser's languages from an Accept-Language header, most preferred
 * first, e.g. "de-AT,de;q=0.9,en;q=0.8" -> ["de-AT", "de", "en"].
 */
function preferred(header: string): string[] {
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/**
 * The locale for a request: a valid cookie, else the first browser language
 * we speak (by language, so en-US gets en-GB and de-AT gets de-DE), else
 * German.
 */
export function resolveLocale({
  cookie,
  acceptLanguage,
}: {
  cookie?: string;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(cookie)) return cookie;
  for (const tag of preferred(acceptLanguage ?? "")) {
    const language = tag.split("-")[0]!.toLowerCase();
    const match = LOCALES.find((locale) => locale.split("-")[0] === language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
