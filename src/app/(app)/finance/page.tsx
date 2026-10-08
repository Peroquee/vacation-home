import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { todayUtc } from "@/lib/bookings/list-params";
import { addMonths } from "@/lib/calendar/month";
import { listCategories } from "@/lib/finance/categories";
import { ledgerHref, ledgerMonth, ledgerParams, monthRange } from "@/lib/finance/ledger";
import { listTransactions, listTransactionsSchema, toDto } from "@/lib/finance/transactions";
import { listProperties } from "@/lib/properties/service";

import { LedgerView, type LedgerRow } from "./ledger-view";

export const metadata: Metadata = { title: "Finance" };

/** The statement shows at most this many transactions, the API's page limit. */
const STATEMENT_SIZE = 200;

/**
 * The ledger for a month (`?month=2026-07`, the current one by default),
 * filtered by `propertyId`, `type` and `categoryId`, all in the URL.
 */
export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const params = ledgerParams(await searchParams);
  const today = todayUtc();
  const month = ledgerMonth(params, today);
  const [properties, categories] = await Promise.all([listProperties(), listCategories()]);

  const header = (
    <PageHeader
      title="Finance"
      description="Income and expenses, month by month."
      actions={
        <Link href="/finance/categories" className={buttonVariants({ variant: "outline" })}>
          Categories
        </Link>
      }
    />
  );
  if (properties.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No properties yet"
          description="Add a property before recording its income and expenses."
          action={
            <Link href="/settings" className={buttonVariants()}>
              Add a property
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
    ...monthRange(month),
    pageSize: String(STATEMENT_SIZE),
    // Oldest first: the running net reads like a statement.
    sort: "date",
  });

  const filters = (
    <Form action="/finance" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <Field>
        <FieldLabel htmlFor="ledger-month">Month</FieldLabel>
        <Input id="ledger-month" name="month" type="month" defaultValue={month} />
      </Field>
      <Field>
        <FieldLabel htmlFor="ledger-property">Property</FieldLabel>
        <NativeSelect
          id="ledger-property"
          name="propertyId"
          className="w-full"
          defaultValue={params.propertyId ?? ""}
        >
          <NativeSelectOption value="">All properties</NativeSelectOption>
          {properties.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="ledger-type">Type</FieldLabel>
        <NativeSelect
          id="ledger-type"
          name="type"
          className="w-full"
          defaultValue={params.type ?? ""}
        >
          <NativeSelectOption value="">Income and expenses</NativeSelectOption>
          <NativeSelectOption value="income">Income</NativeSelectOption>
          <NativeSelectOption value="expense">Expenses</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="ledger-category">Category</FieldLabel>
        <NativeSelect
          id="ledger-category"
          name="categoryId"
          className="w-full"
          defaultValue={params.categoryId ?? ""}
        >
          <NativeSelectOption value="">Any category</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.name} ({c.type === "income" ? "income" : "expense"})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex gap-2">
        <Button type="submit">Apply</Button>
        <Link
          href={ledgerHref({ ...params, month: addMonths(month, -1) }, {})}
          className={buttonVariants({ variant: "ghost" })}
          aria-label="Previous month"
        >
          ‹
        </Link>
        <Link
          href={ledgerHref({ ...params, month: addMonths(month, 1) }, {})}
          className={buttonVariants({ variant: "ghost" })}
          aria-label="Next month"
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
          title="These filters don't work together"
          description={query.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}
        />
      </>
    );
  }

  const { items, total, totals } = await listTransactions(query.data);
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
      currency: t.currency,
      category: t.category,
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
          date: today.startsWith(month) ? today : `${month}-01`,
        }}
      />
    </>
  );
}
