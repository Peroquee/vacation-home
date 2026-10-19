import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Hint } from "@/components/help/hint";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { imprintComplete, type Legal, policyUnchecked } from "@/lib/legal/legal";

type Item = { state: "done" | "missing" | "warning"; text: string; href: string };

const ICONS = {
  done: <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />,
  missing: <CircleX className="text-destructive size-4 shrink-0" aria-hidden />,
  warning: <CircleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />,
};

/**
 * What the public site needs before it goes live (GitLab #112). The legal
 * pages are required - no property can be listed without them; the rest
 * only warns: a property without bank details can be listed, but its
 * guests are not told where to transfer.
 */
export async function GoLiveChecklist({
  legal,
  withoutBankDetails,
}: {
  legal: Legal;
  /** Names of the active properties that have none. */
  withoutBankDetails: string[];
}) {
  const t = await getTranslations("settings.goLive");
  const items: Item[] = [
    {
      state: imprintComplete(legal) ? "done" : "missing",
      text: t("imprint"),
      href: "#legal",
    },
    {
      state: legal.privacyPolicyDe ? "done" : "missing",
      text: t("privacyDe"),
      href: "#legal",
    },
    {
      state: legal.privacyPolicyEn ? "done" : "missing",
      text: t("privacyEn"),
      href: "#legal",
    },
    ...(policyUnchecked(legal)
      ? [{ state: "warning" as const, text: t("templateNote"), href: "#legal" }]
      : []),
    ...withoutBankDetails.map((name) => ({
      state: "warning" as const,
      text: t("bankDetails", { name }),
      href: "#bank-details",
    })),
  ];
  const ready = items.every((item) => item.state !== "missing");
  return (
    <Card id="go-live">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {ready ? t("ready") : t("notReady")}
          <Hint label={t("hintLabel")}>{t("hintText")}</Hint>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.text} className="flex items-start gap-2">
              {ICONS[item.state]}
              <span>
                <span className="sr-only">{t(`state.${item.state}`)}: </span>
                <a href={item.href} className="underline-offset-2 hover:underline">
                  {item.text}
                </a>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
