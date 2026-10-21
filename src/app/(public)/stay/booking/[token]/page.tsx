import type { Metadata } from "next";

import { PriceLines } from "@/components/price-lines";
import { describePolicy } from "@/lib/cancellation/describe";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { getFormat } from "@/i18n/get-format";
import { formatReference } from "@/lib/booking-requests/values";
import { guestView } from "@/lib/payments/guest-view";
import { pickText } from "@/lib/properties/public";
import { daysBetween } from "@/lib/calendar-date";
import { describeStayTimes } from "@/lib/listing/stay-times";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stay.booking");
  // The address holds the guest's key: kept out of search engines and
  // out of the Referer of anything this page loads.
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * The guest's own page for their booking (GitLab #115), opened by the link
 * they were given: its status, what to pay next, by when, to whom, with the
 * GiroCode their banking app can scan. An unknown link is a plain 404.
 */
export default async function GuestBookingPage({ params }: PageProps<"/stay/booking/[token]">) {
  const view = await guestView((await params).token);
  if (!view) notFound();
  const [t, tCancellation, tTimes, locale, format] = await Promise.all([
    getTranslations("stay.booking"),
    getTranslations("cancellation"),
    getTranslations("stayTimes"),
    getLocale(),
    getFormat(),
  ]);
  const money = (minor: number) => format.money(minor, view.currency);
  const times = describeStayTimes(
    (key, values) => tTimes(key as Parameters<typeof tTimes>[0], values),
    view.times,
  );

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-6 sm:py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{pickText(view.title, locale)}</p>
      </header>

      <section aria-labelledby="booking-status" className="space-y-1 rounded-xl border p-4">
        <h2 id="booking-status" className="font-semibold">
          {t(`status.${view.status}`)}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {view.reference ? (
            <>
              <dt className="text-muted-foreground">{t("reference")}</dt>
              <dd className="font-mono">{formatReference(view.reference)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("dates")}</dt>
          <dd>
            {format.dateRange(view.checkIn, view.checkOut)} ·{" "}
            {t("nights", { count: daysBetween(view.checkIn, view.checkOut) })}
          </dd>
          {times ? (
            <>
              <dt className="text-muted-foreground">{t("times")}</dt>
              <dd>{times}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("guests")}</dt>
          <dd>{view.guestCount}</dd>
          {/* The lines it is made of follow, when there are any (GitLab #118). */}
          <dt className="text-muted-foreground">{t("total")}</dt>
          <dd>{money(view.totalAmountMinor)}</dd>
          {view.receivedMinor > 0 ? (
            <>
              <dt className="text-muted-foreground">{t("received")}</dt>
              <dd>{money(view.receivedMinor)}</dd>
            </>
          ) : null}
        </dl>
        {view.price.kind === "computed" ? (
          <PriceLines breakdown={view.price} className="border-t pt-3" />
        ) : null}
      </section>

      {view.next && view.next.amountMinor > 0 ? (
        <section aria-labelledby="booking-pay" className="space-y-3 rounded-xl border p-4">
          <h2 id="booking-pay" className="font-semibold">
            {t(`next.${view.next.kind}`, {
              amount: money(view.next.amountMinor),
              date: format.date(view.next.dueOn, { style: "full" }),
            })}
          </h2>
          {view.next.kind !== "balance" ? <p className="text-sm">{t("holdNote")}</p> : null}
          {view.transfer ? (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("holder")}</dt>
                <dd>{view.transfer.accountHolder}</dd>
                <dt className="text-muted-foreground">IBAN</dt>
                <dd className="font-mono">{view.transfer.iban}</dd>
                {view.transfer.bic ? (
                  <>
                    <dt className="text-muted-foreground">BIC</dt>
                    <dd className="font-mono">{view.transfer.bic}</dd>
                  </>
                ) : null}
                {view.transfer.bankName ? (
                  <>
                    <dt className="text-muted-foreground">{t("bank")}</dt>
                    <dd>{view.transfer.bankName}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">{t("amount")}</dt>
                <dd>{money(view.next.amountMinor)}</dd>
                <dt className="text-muted-foreground">{t("remittance")}</dt>
                <dd className="font-mono">{view.transfer.remittance}</dd>
              </dl>
              {view.transfer.girocode ? (
                <figure className="space-y-1 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI */}
                  <img
                    src={view.transfer.girocode}
                    alt={t("girocodeAlt")}
                    width={180}
                    height={180}
                    className="mx-auto bg-white"
                  />
                  <figcaption className="text-muted-foreground text-xs">{t("girocode")}</figcaption>
                </figure>
              ) : null}
            </div>
          ) : (
            <p className="text-sm">{t("noBankDetails")}</p>
          )}
        </section>
      ) : null}

      {view.status !== "cancelled" && view.status !== "expired" ? (
        <section aria-labelledby="booking-cancellation" className="space-y-1 rounded-xl border p-4">
          <h2 id="booking-cancellation" className="font-semibold">
            {tCancellation("title")}
          </h2>
          <p className="text-sm">
            {/* With this stay's dates (GitLab #123). */}
            {describePolicy(
              (key, values) => tCancellation(key as Parameters<typeof tCancellation>[0], values),
              (date) => format.date(date, { style: "long" }),
              view.policy,
              money(view.policy.depositAmountMinor),
              view.checkIn,
            )}
          </p>
        </section>
      ) : null}
    </main>
  );
}
