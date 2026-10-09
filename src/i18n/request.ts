import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { LOCALE_COOKIE, resolveLocale } from "./locales";

/**
 * The language of each request (next-intl's request configuration): the
 * user's choice from the cookie, else the browser's, else German. There is
 * no locale in the URL; one address serves both languages.
 */
export default getRequestConfig(async () => {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: jar.get(LOCALE_COOKIE)?.value,
    acceptLanguage: list.get("accept-language"),
  });
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
