import { getTranslations } from "next-intl/server";

/**
 * The public site's legal pages, Datenschutz and Impressum: placeholders
 * until their content is written (GitLab #112). Listing a property for the
 * public waits for that too.
 */
export async function LegalPage({ page }: { page: "privacy" | "imprint" }) {
  const t = await getTranslations("legal");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t(`${page}.title`)}</h1>
      <p>{t("notYet")}</p>
    </main>
  );
}

export async function legalMetadata(page: "privacy" | "imprint") {
  const t = await getTranslations("legal");
  return { title: t(`${page}.title`), robots: { index: false } };
}
