import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { appToday } from "@/lib/app-today";
import { addDays } from "@/lib/calendar-date";
import { addMonths } from "@/lib/calendar/month";
import { db } from "@/lib/db";
import { listCategories } from "@/lib/finance/categories";
import { categoriesOfType, ledgerHref, ledgerParams, ledgerPeriod } from "@/lib/finance/ledger";
import { listTransactions, listTransactionsSchema, toDto } from "@/lib/finance/transactions";
import { getApiText } from "@/i18n/get-api-text";
import { getFormat } from "@/i18n/get-format";
import { listProperties } from "@/lib/properties/service";

import { CsvActions } from "./csv-actions";
import { LedgerView, type LedgerRow } from "./ledger-view";
import { TypeCategoryFilter } from "./type-category-filter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.page");
  return { title: t("title") };
}

/** The statement shows at most this many transactions, the API's page limit. */
const STATEMENT_SIZE = 200;

/**
 * The ledger for a month (`?month=2026-07`, the current one by default),
 * filtered by `propertyId`, `type`, `categoryId` and `receipts` (`none`:
 * without a receipt, GitLab #131), all in the URL.
 */
export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const asked = ledgerParams(await searchParams);
  const today = appToday();
  const period = ledgerPeriod(asked, today);
  // Month navigation starts from the period's month, also for a custom range.
  const month = period.month ?? period.from.slice(0, 7);
  const [properties, categories] = await Promise.all([listProperties(), listCategories()]);
  // A category of the other type matches nothing (GitLab #129): dropped, so
  // the list, the export and the filter agree.
  const params = {
    ...asked,
    categoryId: categoriesOfType(asked.categoryId, asked.type, categories),
  };
  const t = await getTranslations("finance.page");
  const format = await getFormat();
  const apiText = await getApiText();

  const header = (
    <PageHeader
      title={t("title")}
      description={
        period.month
          ? t("monthly")
          : t("range", { range: format.dateRange(period.from, addDays(period.to, -1)) })
      }
      actions={
        <>
          <CsvActions
            query={{
              from: period.from,
              to: period.to,
              propertyId: params.propertyId,
              type: params.type,
              categoryId: params.categoryId,
              receipts: params.receipts,
            }}
          />
        </>
      }
    />
  );
  if (properties.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title={t("noProperties")}
          description={t("noPropertiesHint")}
          action={
            <Link href="/settings" className={buttonVariants()}>
              {t("addProperty")}
            </Link>
          }
        />
      </>
    );
  }

  const query = listTransactionsSchema.safeParse({
    propertyId: params.propertyId,
    type: params.type,
    categoryId: params.categoryId,
    receipts: params.receipts,
    from: period.from,
    to: period.to,
    pageSize: String(STATEMENT_SIZE),
    // Oldest first: the running net reads like a statement.
    sort: "date",
  });

  const filters = (
    <Form action="/finance" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      <Field>
        <FieldLabel htmlFor="ledger-month">{t("month")}</FieldLabel>
        {/* Choosing a month replaces a custom range. */}
        <Input id="ledger-month" name="month" type="month" defaultValue={month} />
      </Field>
      <Field>
        <FieldLabel htmlFor="ledger-property">{t("property")}</FieldLabel>
        <NativeSelect
          id="ledger-property"
          name="propertyId"
          className="w-full"
          defaultValue={params.propertyId ?? ""}
        >
          <NativeSelectOption value="">{t("allProperties")}</NativeSelectOption>
          {properties.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <TypeCategoryFilter
        categories={categories.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
        type={params.type === "income" || params.type === "expense" ? params.type : undefined}
        categoryId={params.categoryId}
      />
      <Field>
        <FieldLabel htmlFor="ledger-receipts">{t("receipts")}</FieldLabel>
        <NativeSelect
          id="ledger-receipts"
          name="receipts"
          className="w-full"
          defaultValue={params.receipts ?? ""}
        >
          <NativeSelectOption value="">{t("anyReceipts")}</NativeSelectOption>
          <NativeSelectOption value="none">{t("withoutReceipt")}</NativeSelectOption>
          <NativeSelectOption value="some">{t("withReceipt")}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <div className="flex gap-2">
        <Button type="submit">{t("apply")}</Button>
        <Link
          href={ledgerHref(params, {
            month: addMonths(month, -1),
            from: undefined,
            until: undefined,
          })}
          className={buttonVariants({ variant: "ghost" })}
          aria-label={t("previous")}
        >
          ‹
        </Link>
        <Link
          href={ledgerHref(params, {
            month: addMonths(month, 1),
            from: undefined,
            until: undefined,
          })}
          className={buttonVariants({ variant: "ghost" })}
          aria-label={t("next")}
        >
          ›
        </Link>
      </div>
    </Form>
  );

  if (!query.success) {
    return (
      <>
        {header}
        {filters}
        <ErrorState
          title={t("badFilters")}
          description={query.error.issues
            .map((issue) => `${issue.path.join(".")} ${apiText(issue.message)}`)
            .join("; ")}
        />
      </>
    );
  }

  const { items, total, totals } = await listTransactions(query.data);
  // Which rows have receipts (GitLab #82), in one query.
  const receiptCounts = new Map(
    (
      await db.transactionAttachment.groupBy({
        by: ["transactionId"],
        where: { transactionId: { in: items.map((item) => item.id) } },
        _count: true,
      })
    ).map((row) => [row.transactionId, row._count]),
  );
  const rows: LedgerRow[] = items.map((item) => {
    const t = toDto(item);
    return {
      id: t.id,
      propertyId: t.propertyId,
      type: t.type,
      categoryId: t.categoryId,
      amountMinor: t.amountMinor,
      date: t.date,
      description: t.description,
      bookingId: t.bookingId,
      recurringExpenseId: t.recurringExpenseId,
      currency: t.currency,
      category: t.category,
      receipts: receiptCounts.get(t.id) ?? 0,
    };
  });
  // A transaction's own (possibly hidden) category stays selectable when editing it.
  const choices = [
    ...categories,
    ...rows
      .filter((r) => !categories.some((c) => c.id === r.categoryId))
      .map((r) => ({ ...r.category, type: r.type, hidden: true })),
  ].map((c) => ({ id: c.id, name: c.name, type: c.type, color: c.color }));

  return (
    <>
      {header}
      {filters}
      <LedgerView
        rows={rows}
        totals={totals}
        truncated={total > rows.length}
        properties={properties.map((p) => ({ id: p.id, name: p.name, currency: p.currency }))}
        categories={choices}
        defaults={{
          propertyId: params.propertyId ?? properties[0]!.id,
          // Today, or the first of an earlier or later month being looked at.
          date: today >= period.from && today < period.to ? today : period.from,
        }}
      />
    </>
  );
}
