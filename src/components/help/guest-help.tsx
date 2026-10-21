import { getLocale } from "next-intl/server";

import { SafeMarkdown } from "@/components/safe-markdown";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import type { HelpFlags } from "@/lib/help/blocks";
import type { HelpValues } from "@/lib/help/fill";
import { type PublicHelpKey, readPublicHelp } from "@/lib/help/public";

/**
 * The guests' help on a public page (GitLab #127): its intro always shown,
 * each question folded away in a <details> - keyboard-usable without any
 * client JS, so the public pages stay light and cookie-free. Rendered on
 * the server, in the visitor's language.
 */
export async function GuestHelp({
  helpKey,
  help,
  id,
}: {
  helpKey: PublicHelpKey;
  help: { flags: HelpFlags; values: HelpValues };
  /** The heading's id, which names the region. */
  id: string;
}) {
  const locale = await getLocale();
  const page = await readPublicHelp(helpKey, isLocale(locale) ? locale : DEFAULT_LOCALE, help);
  return (
    <section aria-labelledby={id} className="bg-muted/50 space-y-3 rounded-xl p-4">
      <h2 id={id} className="text-lg font-semibold">
        {page.title}
      </h2>
      {page.intro ? (
        <div className="text-sm">
          <SafeMarkdown>{page.intro}</SafeMarkdown>
        </div>
      ) : null}
      {page.sections.length > 0 ? (
        <div className="divide-border divide-y border-t">
          {page.sections.map((section) => (
            <details key={section.heading} className="group py-2">
              <summary className="focus-visible:ring-ring cursor-pointer rounded-sm py-1 font-medium focus-visible:ring-2 focus-visible:outline-none">
                {section.heading}
              </summary>
              <div className="pt-1 pb-2 text-sm">
                <SafeMarkdown>{section.markdown}</SafeMarkdown>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
