import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { COOKIES } from "@/lib/legal/cookies";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.cookies");
  return { title: t("title"), robots: { index: false } };
}

/**
 * The cookie notice (GitLab #124): which cookies the app sets and why,
 * from src/lib/legal/cookies.ts. Guests get none; the owner's sign-in and
 * pages set only strictly necessary ones, so there is no consent banner.
 */
export default async function CookiesPage() {
  const t = await getTranslations("legal.cookies");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <p>{t("guests")}</p>
      <p>{t("owner")}</p>
      <p>{t("noTracking")}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 pe-4 font-medium">
                {t("columns.name")}
              </th>
              <th scope="col" className="py-2 pe-4 font-medium">
                {t("columns.purpose")}
              </th>
              <th scope="col" className="py-2 pe-4 font-medium">
                {t("columns.duration")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("columns.necessary")}
              </th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((cookie) => (
              <tr key={cookie.name} className="border-b align-top">
                <td className="py-2 pe-4 font-mono text-xs break-all">
                  {cookie.name}
                  {cookie.alsoAs ? (
                    <span className="text-muted-foreground block">{cookie.alsoAs}</span>
                  ) : null}
                </td>
                <td className="py-2 pe-4">{t(`purposes.${cookie.purpose}`)}</td>
                <td className="py-2 pe-4">{t(`durations.${cookie.duration}`)}</td>
                <td className="py-2">{t("yes")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-sm">{t("why")}</p>
    </main>
  );
}
