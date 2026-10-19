import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { SafeMarkdown } from "@/components/safe-markdown";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("help");
  return { title: t("guideTitle") };
}

/**
 * The user guide (docs/user-guide.md), in the app (GitLab #121): the help
 * panel's "more" links lead to its sections by their anchors. Rendered with
 * the safe renderer; next.config.ts traces the file into the build.
 */
export default async function GuidePage() {
  const [guide, t] = await Promise.all([
    readFile(join(process.cwd(), "docs", "user-guide.md"), "utf8"),
    getTranslations("help"),
  ]);
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
