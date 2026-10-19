import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PriceLines } from "@/components/price-lines";
import { describePolicy } from "@/lib/cancellation/describe";
import { bookingPolicy } from "@/lib/cancellation/service";
import { SyncBadge } from "@/components/sync-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/api";
import { getApiText } from "@/i18n/get-api-text";
import { getFormat } from "@/i18n/get-format";
import { SOURCE_KEYS } from "@/lib/bookings/labels";
import { breakdownOf, getBooking, toDto } from "@/lib/bookings/service";
import { guestsOf } from "@/lib/pricing/booking-price";
import { bookingSyncStatus } from "@/lib/google/sync-status";
import { guestDisplayName } from "@/lib/guests/display";
import { getGuest } from "@/lib/guests/service";
import { todayIn } from "@/lib/finance/recurring";
import { getProperty } from "@/lib/properties/service";
import { refundOutstanding } from "@/lib/cancellation/preview";
import { listPayments, netReceived, nextDue } from "@/lib/payments/service";
import { cn } from "@/lib/utils";

import { BookingActions } from "./booking-actions";
import { PaymentHold } from "./payment-hold";
import { Payments } from "./payments";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings.detail");
  return { title: t("title") };
}

/** A label and its value, as one row of a definition list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default async function BookingPage({ params }: PageProps<"/bookings/[id]">) {
  const { id } = await params;
  // Looked up before anything streams, so a missing booking is a real 404.
  const record = isUuid(id) ? await getBooking(id) : null;
  if (!record) notFound();

  const booking = toDto(record);
  const [guest, syncStatus, payments, refundDue] = await Promise.all([
    getGuest(booking.guestId),
    bookingSyncStatus([booking.id]),
    listPayments(booking.id),
    refundOutstanding(record),
  ]);
  const received = netReceived(payments);
  const timezone = (await getProperty(booking.propertyId))?.timezone ?? "UTC";
  // Money is recorded on bookings that hold their dates, and refunds on any
  // that took some.
  const payable = ["reserved", "confirmed", "paid"].includes(booking.status) || payments.length > 0;
  const sync = syncStatus[booking.id];
  const t = await getTranslations("bookings");
  const tCommon = await getTranslations("common");
  const format = await getFormat();
  const apiText = await getApiText();
  const guestName = guestDisplayName(
    booking.guest.name,
    (await getTranslations("guests"))("purgedName"),
  );
  const money = (minor: number) => format.money(minor, booking.currency);
  // As the engine worked it out when the price was set (GitLab #118).
  const breakdown = breakdownOf(booking);
  // The cancellation policy the guest agreed to, in this stay's dates (GitLab #123).
  const [policy, tCancellation] = await Promise.all([
    bookingPolicy(booking),
    getTranslations("cancellation"),
  ]);
  const guests = guestsOf(booking);
  const tGuests = await getTranslations("guestFields");

  return (
    <>
      <PageHeader
        title={guestName}
        description={`${booking.property.name}, ${format.dateRange(booking.checkIn, booking.checkOut)}`}
        actions={
          <Link
            href={`/bookings/${booking.id}/edit`}
            className={buttonVariants({ variant: "outline" })}
          >
            {tCommon("edit")}
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm">
          {t("detail.statusLabel")}{" "}
          <span
            className={cn(
              "font-medium",
              booking.status === "cancelled" && "text-muted-foreground line-through",
            )}
          >
            {t(`status.${booking.status}`)}
          </span>
          {booking.status === "inquiry" ? (
            <span className="text-muted-foreground">{t("detail.notHolding")}</span>
          ) : null}
        </p>
        {sync && sync.state !== "not_synced" ? (
          <div className="text-sm">
            <SyncBadge
              state={sync.state}
              title={
                sync.lastSyncedAt
                  ? t("detail.lastSynced", { time: format.dateTime(sync.lastSyncedAt, "UTC") })
                  : undefined
              }
            />
            {sync.error ? (
              <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                {apiText(sync.error)}{" "}
                <Link href="/settings#google-sync" className="underline">
                  {t("detail.seeProblems")}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        <BookingActions id={booking.id} status={booking.status} currency={booking.currency} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.stay")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Fact label={t("detail.property")}>{booking.property.name}</Fact>
              <Fact label={t("detail.checkIn")}>
                {format.date(booking.checkIn, { style: "full" })}
              </Fact>
              <Fact label={t("detail.checkOut")}>
                {format.date(booking.checkOut, { style: "full" })}
              </Fact>
              <Fact label={t("detail.nights")}>{booking.nights}</Fact>
              <Fact label={t("detail.guests")}>
                {/* By age group, where the Kurtaxe asked (GitLab #120). */}
                {guests.children.length > 0
                  ? [
                      tGuests("summaryAdults", { count: guests.adults }),
                      ...guests.children.map((c) =>
                        tGuests("summaryChildren", {
                          count: c.count,
                          from: c.fromAge,
                          to: c.toAge,
                        }),
                      ),
                    ].join(", ")
                  : booking.guestCount}
              </Fact>
              <Fact label={t("detail.source")}>{t(`source.${SOURCE_KEYS[booking.source]}`)}</Fact>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("detail.guest")}</CardTitle>
          </CardHeader>
          <CardContent>
            {guest?.purgedAt ? (
              <p className="text-muted-foreground text-sm">{t("detail.erased")}</p>
            ) : (
              <dl className="divide-y text-sm">
                <Fact label={t("detail.name")}>{guestName}</Fact>
                <Fact label={t("detail.email")}>
                  {guest?.email ? (
                    <a href={`mailto:${guest.email}`} className="underline">
                      {guest.email}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
                <Fact label={t("detail.phone")}>
                  {guest?.phone ? (
                    <a href={`tel:${guest.phone.replace(/[^0-9+]/g, "")}`} className="underline">
                      {guest.phone}
                    </a>
                  ) : (
                    "–"
                  )}
                </Fact>
              </dl>
            )}
            <Link
              href={`/guests/${booking.guestId}`}
              className={cn(buttonVariants({ variant: "link" }), "mt-2 px-0")}
            >
              {t("detail.aboutGuest")}
            </Link>
          </CardContent>
        </Card>

        {payable ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("hold.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {booking.depositAmountMinor !== null && booking.depositDueOn ? (
                <PaymentHold
                  id={booking.id}
                  hold={{
                    status: booking.status,
                    currency: booking.currency,
                    totalAmountMinor: booking.totalAmountMinor,
                    depositAmountMinor: booking.depositAmountMinor,
                    depositDueOn: booking.depositDueOn,
                    balanceDueOn: booking.balanceDueOn,
                  }}
                />
              ) : null}
              <Payments
                id={booking.id}
                currency={booking.currency}
                totalAmountMinor={booking.totalAmountMinor}
                payments={payments}
                received={received}
                next={nextDue(booking, received)}
                refundDue={refundDue}
                today={todayIn(timezone)}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("detail.price")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PriceLines breakdown={breakdown} totalMinor={booking.totalAmountMinor} />
            {booking.status !== "cancelled" && booking.status !== "expired" ? (
              <p className="text-muted-foreground mt-3 text-sm">
                <span className="text-foreground font-medium">{tCancellation("title")}:</span>{" "}
                {describePolicy(
                  (key, values) =>
                    tCancellation(key as Parameters<typeof tCancellation>[0], values),
                  (date) => format.date(date, { style: "long" }),
                  policy,
                  money(policy.depositAmountMinor),
                  booking.checkIn,
                )}
              </p>
            ) : null}
            {booking.totalIsManual ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {breakdown.kind === "computed" && breakdown.totalMinor !== booking.totalAmountMinor
                  ? t("detail.manualTotalDiffers", { amount: money(breakdown.totalMinor) })
                  : t("detail.manualTotal")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("detail.notes")}</CardTitle>
          </CardHeader>
          <CardContent>
            {booking.notes ? (
              <p className="text-sm whitespace-pre-wrap">{booking.notes}</p>
            ) : (
              <p className="text-muted-foreground text-sm">{t("detail.noNotes")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
