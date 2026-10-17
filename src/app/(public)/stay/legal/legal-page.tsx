import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { SafeMarkdown } from "@/components/safe-markdown";
import { imprintComplete, policyFor } from "@/lib/legal/legal";
import { getLegal } from "@/lib/legal/service";

/**
 * The public site's legal pages (GitLab #112): the Impressum, from the
 * owner's details, and the privacy policy, their Markdown in the visitor's
 * language. Both written in settings; until then a short note, and no
 * property can be listed.
 */
export async function LegalPage({ page }: { page: "privacy" | "imprint" }) {
  // Read at request time: the owner edits them in settings.
  await connection();
  const [t, legal, locale] = await Promise.all([getTranslations("legal"), getLegal(), getLocale()]);
  const policy = policyFor(legal, locale);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t(`${page}.title`)}</h1>
      {page === "privacy" ? (
        policy ? (
          <SafeMarkdown>{policy}</SafeMarkdown>
        ) : (
          <p>{t("notYet")}</p>
        )
      ) : imprintComplete(legal) ? (
        <div className="space-y-4">
          <section aria-labelledby="imprint-provider" className="space-y-1">
            <h2 id="imprint-provider" className="text-lg font-semibold">
              {t("imprint.provider")}
            </h2>
            <p className="whitespace-pre-line">
              {legal.imprintName}
              {"\n"}
              {legal.imprintAddress}
            </p>
          </section>
          <section aria-labelledby="imprint-contact" className="space-y-1">
            <h2 id="imprint-contact" className="text-lg font-semibold">
              {t("imprint.contact")}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt>{t("imprint.email")}</dt>
              <dd>
                <a href={`mailto:${legal.imprintEmail}`} className="underline">
                  {legal.imprintEmail}
                </a>
              </dd>
              {legal.imprintPhone ? (
                <>
                  <dt>{t("imprint.phone")}</dt>
                  <dd>{legal.imprintPhone}</dd>
                </>
              ) : null}
              {legal.imprintVatId ? (
                <>
                  <dt>{t("imprint.vatId")}</dt>
                  <dd>{legal.imprintVatId}</dd>
                </>
              ) : null}
            </dl>
          </section>
          {legal.imprintExtra ? <SafeMarkdown>{legal.imprintExtra}</SafeMarkdown> : null}
        </div>
      ) : (
        <p>{t("notYet")}</p>
      )}
    </main>
  );
}

export async function legalMetadata(page: "privacy" | "imprint") {
  const t = await getTranslations("legal");
  return { title: t(`${page}.title`), robots: { index: false } };
}
