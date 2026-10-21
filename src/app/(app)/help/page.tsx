import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { SafeMarkdown } from "@/components/safe-markdown";
import { readGuide } from "@/lib/help/guide";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("guideTitle") };
}

/**
 * The user guide, in the app (GitLab #121) and in the user's language
 * (GitLab #128, src/lib/help/guide.ts): the help panel's "more" links lead
 * to its sections by their anchors, the same in both languages. Rendered
 * with the safe renderer; next.config.ts traces the files into the build.
 */
export default async function GuidePage() {
  const [guide, t] = await Promise.all([readGuide(await getLocale()), getTranslations("help")]);
  // Its own title is the page's; the rest follows.
  const body = guide.replace(/^# .*\n/, "");
  return (
    <>
      <PageHeader title={t("guideTitle")} description={t("guideDescription")} />
      <article className="max-w-3xl [&_table]:my-3 [&_table]:text-sm [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
        <SafeMarkdown anchors>{body}</SafeMarkdown>
      </article>
    </>
  );
}
