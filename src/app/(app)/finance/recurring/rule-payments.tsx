"use client";

import { Paperclip } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useFormat } from "@/i18n/use-format";
import type { RulePayments as Payments } from "@/lib/finance/recurring";

import { ACCEPT, useUploadReceipt } from "../receipt-picker";

type Payment = Payments["items"][number];

/**
 * The payments a recurring cost made (GitLab #130), newest first: each with
 * its receipts, and a quick way to add one - the invoice for that month
 * belongs on that month's transaction, not on the rule.
 */
export function RulePayments({ ruleId }: { ruleId: string }) {
  const t = useTranslations("finance.recurring.payments");
  const tReceipts = useTranslations("finance.receipts");
  const format = useFormat();
  const router = useRouter();
  const id = useId();
  const uploadReceipt = useUploadReceipt();
  const input = useRef<HTMLInputElement>(null);
  const [payments, setPayments] = useState<Payments | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<Payment | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(`/api/recurring-expenses/${ruleId}/payments`, { signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
        .then((body: Payments) => {
          setPayments(body);
          setFailed(false);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        }),
    [ruleId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function attach(payment: Payment, files: File[]) {
    setUploading(payment.id);
    try {
      for (const file of files) {
        const failure = await uploadReceipt(`/api/transactions/${payment.id}/attachments`, file);
        if (failure) throw new Error(failure);
      }
      toastSuccess(t("attached", { date: format.date(payment.date) }));
    } catch (error) {
      toastError(error, tReceipts("uploadFailed"));
    } finally {
      setUploading(null);
      await load();
      router.refresh();
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 border-t pt-4">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t("title")}
      </h3>
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      ) : payments === null ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : payments.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      ) : (
        <ul className="divide-y text-sm">
          {payments.items.map((payment) => {
            const date = format.date(payment.date);
            return (
              <li key={payment.id} className="flex items-center gap-2 py-1.5">
                <Link
                  href={`/finance?month=${payment.date.slice(0, 7)}`}
                  className="min-w-0 flex-1 hover:underline"
                >
                  {date}
                </Link>
                <span className="tabular-nums">
                  {format.money(payment.amountMinor, payment.currency)}
                </span>
                <span
                  className={
                    payment.receipts > 0
                      ? "inline-flex w-20 items-center justify-end gap-1"
                      : "text-muted-foreground inline-flex w-20 justify-end text-xs"
                  }
                >
                  {payment.receipts > 0 ? (
                    <>
                      <Paperclip aria-hidden className="size-3.5" />
                      {tReceipts("count", { count: payment.receipts })}
                    </>
                  ) : (
                    t("noReceipt")
                  )}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={uploading !== null}
                  aria-busy={uploading === payment.id}
                  aria-label={t("attach", { date })}
                  onClick={() => {
                    setTarget(payment);
                    input.current?.click();
                  }}
                >
                  <Paperclip aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {payments && payments.total > payments.items.length ? (
        <p className="text-muted-foreground text-xs">
          {t("more", { shown: payments.items.length, total: payments.total })}
        </p>
      ) : null}
      {/* One picker for every row: the row's button says which payment. */}
      <input
        ref={input}
        type="file"
        aria-label={t("attachFile")}
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (target && files.length > 0) void attach(target, files);
        }}
      />
    </section>
  );
}
