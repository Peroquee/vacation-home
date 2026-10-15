"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/use-format";
import type { OutboxStatus } from "@/lib/email/outbox";

/**
 * The guest and owner emails (GitLab #111): whether they can go out, what
 * waits, and what went wrong or was left unsent on purpose - like the
 * calendar sync's problems.
 */
export function EmailSection({ status }: { status: OutboxStatus }) {
  const t = useTranslations("settings.email");
  const tCommon = useTranslations("common");
  const format = useFormat();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function sendNow() {
    setPending(true);
    try {
      const response = await fetch("/api/email/send-now", { method: "POST" });
      if (!response.ok) throw new Error(tCommon("serverAnswered", { status: response.status }));
      toastSuccess(t("ran"));
      router.refresh();
    } catch (error) {
      toastError(error, t("runFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="email">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!status.smtp ? (
          <p role="alert" className="text-destructive">
            {t("noSmtp")}
          </p>
        ) : null}
        {!status.ownerEmail ? (
          <p role="alert" className="text-destructive">
            {t("noOwnerEmail")}
          </p>
        ) : null}
        <p>
          {t("counts", {
            pending: status.counts.pending,
            sent: status.counts.sent,
            failed: status.counts.failed,
            skipped: status.counts.skipped,
          })}
        </p>
        {status.problems.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {status.problems.map((problem) => (
              <li key={problem.id} className="p-2">
                <div>
                  <Link href={`/bookings/${problem.bookingId}`} className="font-medium underline">
                    {t(`kind.${problem.kind}` as Parameters<typeof t>[0])}
                  </Link>{" "}
                  · {t(`recipient.${problem.recipient}` as Parameters<typeof t>[0])} ·{" "}
                  {t(`status.${problem.status}` as Parameters<typeof t>[0])}
                  {problem.attempts > 0 ? ` · ${t("attempts", { count: problem.attempts })}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {format.dateTime(problem.updatedAt, "UTC")}
                  {problem.reason ? ` · ${problem.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={sendNow}
        >
          {t("sendNow")}
        </Button>
      </CardContent>
    </Card>
  );
}
