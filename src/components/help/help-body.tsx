"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { SafeMarkdown } from "@/components/safe-markdown";
import type { HelpText } from "@/lib/help/content";

/**
 * The help text for one page (GitLab #121), fetched when the panel opens,
 * rendered with the safe Markdown renderer, and a link to the matching
 * section of the user guide. Loaded on demand by ./help-button.tsx.
 */
export function HelpBody({
  helpKey,
  onLeave,
}: {
  helpKey: string;
  /** Called on the way to the guide, so the panel does not stay over it. */
  onLeave?: () => void;
}) {
  const t = useTranslations("help");
  const [state, setState] = useState<
    { key: string; help: HelpText } | { key: string; failed: true } | null
  >(null);

  useEffect(() => {
    let current = true;
    fetch(`/api/help/${encodeURIComponent(helpKey)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((help: HelpText) => current && setState({ key: helpKey, help }))
      .catch(() => current && setState({ key: helpKey, failed: true }));
    return () => {
      current = false;
    };
  }, [helpKey]);

  if (!state || state.key !== helpKey) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("loading")}
      </p>
    );
  }
  if ("failed" in state)
    return (
      <p role="alert" className="text-sm">
        {t("failed")}
      </p>
    );
  return (
    <div className="space-y-4 text-sm" data-testid="help-text">
      <SafeMarkdown>{state.help.markdown}</SafeMarkdown>
      {state.help.guide ? (
        <p>
          <Link href={`/help#${state.help.guide}`} className="underline" onClick={onLeave}>
            {t("more")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
