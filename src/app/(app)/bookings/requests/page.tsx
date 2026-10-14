import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFormat } from "@/i18n/get-format";
import { listAwaitingPayment, listOpenRequests } from "@/lib/booking-requests/inbox";
import { formatReference } from "@/lib/booking-requests/values";
import { daysBetween } from "@/lib/calendar-date";

import { RequestActions } from "./request-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings.requests");
  return { title: t("title") };
}

/**
 * The owner's inbox (GitLab #110): requests from the public site waiting
 * for an answer, each accepted (reserved) or declined here; then the
 * bookings with a payment still to come and its deadline.
 */
export default async function RequestsPage() {
  await connection();
  const [requests, awaiting, t, format] = await Promise.all([
    listOpenRequests(),
    listAwaitingPayment(),
    getTranslations("bookings.requests"),
    getFormat(),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <section aria-labelledby="open-requests" className="mb-8 space-y-3">
        <h2 id="open-requests" className="text-lg font-medium">
          {t("open", { count: requests.length })}
        </h2>
        {requests.length === 0 ? (
          <EmptyState title={t("none")} description={t("noneHint")} />
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li key={request.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/bookings/${request.id}`} className="hover:underline">
                        {request.name}
                      </Link>
                      <span className="text-muted-foreground text-sm font-normal">
                        {request.property.name}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>
                      <span className="font-medium">
                        {format.dateRange(request.checkIn, request.checkOut)}
                      </span>{" "}
                      · {t("nights", { count: daysBetween(request.checkIn, request.checkOut) })} ·{" "}
                      {t("guests", { count: request.guestCount })} ·{" "}
                      {t("estimate", {
                        total: format.money(request.totalAmountMinor, request.currency),
                      })}
                    </p>
                    {request.message ? (
                      <blockquote className="border-l-2 pl-3 whitespace-pre-line">
                        {request.message}
                      </blockquote>
                    ) : null}
                    <p className="text-muted-foreground">
                      {[
                        request.email,
                        request.phone,
                        request.reference &&
                          t("reference", { reference: formatReference(request.reference) }),
                        t("received", { date: format.date(request.receivedAt.slice(0, 10)) }),
                        t("answerBy", { date: format.date(request.answerBy) }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <RequestActions id={request.id} name={request.name} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="awaiting-payment" className="space-y-3">
        <h2 id="awaiting-payment" className="text-lg font-medium">
          {t("awaiting", { count: awaiting.length })}
        </h2>
        {awaiting.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noneAwaiting")}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {awaiting.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
              >
                <div>
                  <Link href={`/bookings/${booking.id}`} className="font-medium hover:underline">
                    {booking.guest}
                  </Link>
                  <div className="text-muted-foreground">
                    {booking.property.name} · {format.dateRange(booking.checkIn, booking.checkOut)}
                  </div>
                </div>
                <div className="text-right">
                  <div>
                    {t(`due.${booking.due}`, {
                      amount: format.money(booking.amountMinor, booking.currency),
                    })}
                  </div>
                  <div className="text-muted-foreground">
                    {t("dueOn", { date: format.date(booking.dueOn) })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
