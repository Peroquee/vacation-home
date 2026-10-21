import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { isUuid } from "@/lib/api";
import { fromUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";
import { listCategories } from "@/lib/finance/categories";
import { listRecurringExpenses, occurrenceDate, toDto } from "@/lib/finance/recurring";
import { newRulePrefill } from "@/lib/finance/rule-prefill";
import { listProperties } from "@/lib/properties/service";

import { type Rule, type RulePrefill, RecurringView } from "./recurring-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.recurring");
  return { title: t("title") };
}

/**
 * Recurring costs (GitLab #104): the rules that turn a mortgage, the
 * utilities' prepayments and the like into ledger entries by themselves.
 * `?from=<transaction id>` opens a new rule pre-filled from that expense,
 * starting one month after it, so the expense itself is not made twice.
 * `?new=1` opens a new rule pre-filled from the expense dialog's values
 * instead (GitLab #130): `propertyId`, `categoryId`, `amountMinor`, `date`
 * and `description`, each only if it is valid; the rule then starts on
 * that date and enters that expense itself.
 */
export default async function RecurringPage({ searchParams }: PageProps<"/finance/recurring">) {
  const params = await searchParams;
  // Read at request time: rules change with every edit and every due date.
  await connection();
  const t = await getTranslations("finance.recurring");
  const [rules, properties, categories] = await Promise.all([
    listRecurringExpenses({}),
    // Archived ones too: their rules still list, by name.
    listProperties({ includeArchived: true }),
    listCategories({ type: "expense" }),
  ]);

  let prefill: RulePrefill | null = null;
  const from = typeof params.from === "string" ? params.from : undefined;
  if (from && isUuid(from)) {
    const transaction = await db.transaction.findUnique({ where: { id: from } });
    if (transaction?.type === "expense") {
      prefill = {
        propertyId: transaction.propertyId,
        categoryId: transaction.categoryId,
        amountMinor: transaction.amountMinor,
        startDate: occurrenceDate(fromUtcDate(transaction.date), "monthly", 1),
        description: transaction.description ?? "",
      };
    }
  }

  if (!prefill && params.new === "1") prefill = newRulePrefill(params);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
            {t("backToLedger")}
          </Link>
        }
      />
      <RecurringView
        rules={rules.map((rule) => toDto(rule) as Rule)}
        properties={properties.map((p) => ({
          id: p.id,
          name: p.name,
          currency: p.currency,
          archived: p.archivedAt !== null,
        }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        prefill={prefill}
      />
    </>
  );
}
