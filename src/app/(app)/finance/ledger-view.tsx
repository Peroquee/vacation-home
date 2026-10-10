"use client";

import { Paperclip, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { runningNet, signedMinor } from "@/lib/finance/ledger";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";

import {
  type EditableTransaction,
  type LedgerCategory,
  type LedgerProperty,
  TransactionDialog,
} from "./transaction-dialog";

export type LedgerRow = EditableTransaction & {
  currency: string;
  category: { id: string; name: string; color: string };
  /** How many receipts it has (GitLab #82). */
  receipts: number;
};

export type PeriodTotal = {
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
};

/**
 * The ledger for one period: totals for income, expenses and net (one set
 * per currency), then every transaction oldest first with the running net,
 * like a bank statement. Rows open in the same form used to add them.
 * `?add=1` opens the quick-add form; the T shortcut leads here with it.
 */
export function LedgerView({
  rows,
  totals,
  truncated,
  properties,
  categories,
  defaults,
}: {
  rows: LedgerRow[];
  totals: PeriodTotal[];
  /** More transactions match than the statement shows. */
  truncated: boolean;
  properties: LedgerProperty[];
  categories: LedgerCategory[];
  defaults: { propertyId: string; date: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const text = useTranslations("finance.ledger");
  const tReceipts = useTranslations("finance.receipts");
  const tRecurring = useTranslations("finance.recurring");
  const receiptsText = (count: number) => tReceipts("count", { count });
  const format = useFormat();
  const adding = searchParams.get("add") === "1";

  function setAdding(open: boolean) {
    const next = new URLSearchParams(searchParams);
    if (open) next.set("add", "1");
    else next.delete("add");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const after = runningNet(rows);
  const names = new Map(properties.map((p) => [p.id, p.name]));
  const columns: Column<LedgerRow>[] = [
    { id: "date", header: text("columns.date"), cell: (t) => format.date(t.date) },
    {
      id: "what",
      header: text("columns.description"),
      cell: (t) => (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <button
            type="button"
            className="text-left hover:underline"
            onClick={() => setEditing(t)}
            aria-label={text("editRow", {
              what: t.description || t.category.name,
              date: format.date(t.date),
            })}
          >
            {t.description || <span className="text-muted-foreground">{t.category.name}</span>}
            {t.receipts > 0 ? (
              <span className="text-muted-foreground ml-1.5 inline-flex items-center align-middle">
                <Paperclip aria-hidden className="size-3.5" />
                <span className="sr-only">, {receiptsText(t.receipts)}</span>
              </span>
            ) : null}
          </button>
          {t.recurringExpenseId ? (
            // Entered by a recurring cost (GitLab #104): leads to its rule.
            <Link
              href={`/finance/recurring#rule-${t.recurringExpenseId}`}
              className="bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              aria-label={tRecurring("badgeLabel")}
            >
              <Repeat aria-hidden className="size-3" />
              {tRecurring("badge")}
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      id: "category",
      header: text("columns.category"),
      cell: (t) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: t.category.color }}
          />
          {t.category.name}
        </span>
      ),
    },
    {
      id: "property",
      header: text("columns.property"),
      cell: (t) => names.get(t.propertyId) ?? "–",
    },
    {
      id: "booking",
      header: text("columns.booking"),
      cell: (t) =>
        t.bookingId ? (
          <Link href={`/bookings/${t.bookingId}`} className="underline">
            {text("view")}
          </Link>
        ) : null,
    },
    {
      id: "amount",
      header: text("columns.amount"),
      align: "end",
      cell: (t) => (
        <span className={cn(t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "")}>
          {/* The sign says the direction; the green only repeats it. */}
          {t.type === "income" ? "+" : ""}
          {format.money(signedMinor(t), t.currency)}
        </span>
      ),
    },
    {
      id: "running",
      header: text("columns.running"),
      align: "end",
      cell: (t) => (
        <span className="text-muted-foreground">{format.money(after.get(t.id)!, t.currency)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(totals.length > 0 ? totals : [null]).map((total, i) => (
          <PeriodTotals key={total?.currency ?? i} total={total} />
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {text("count", { count: rows.length })}
          {truncated ? text("truncated") : ""}
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          {text("add")}
          <kbd className="bg-primary-foreground/20 ml-1 rounded px-1 text-[10px]">T</kbd>
        </Button>
      </div>

      <DataTable
        caption={text("caption")}
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        empty={
          <EmptyState
            title={text("emptyTitle")}
            description={text("emptyDescription")}
            action={<Button onClick={() => setAdding(true)}>{text("addTransaction")}</Button>}
          />
        }
      />

      <TransactionDialog
        open={adding}
        onOpenChange={setAdding}
        properties={properties}
        categories={categories}
        defaults={defaults}
      />
      <TransactionDialog
        open={editing !== null}
        onOpenChange={(open) => (open ? null : setEditing(null))}
        transaction={editing ?? undefined}
        properties={properties}
        categories={categories}
        defaults={defaults}
      />
    </>
  );
}

/** Income, expenses and net for one currency (or zeros for an empty period). */
function PeriodTotals({ total }: { total: PeriodTotal | null }) {
  const text = useTranslations("finance.ledger");
  const format = useFormat();
  const money = (minor: number) => (total ? format.money(minor, total.currency) : "–");
  return (
    <Card size="sm" className="sm:col-span-3">
      <CardHeader>
        <CardTitle>
          {total ? text("periodTotalsIn", { currency: total.currency }) : text("periodTotals")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{text("income")}</dt>
            <dd className="font-medium tabular-nums">{money(total?.incomeMinor ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{text("expenses")}</dt>
            <dd className="font-medium tabular-nums">{money(total?.expenseMinor ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{text("net")}</dt>
            <dd className="font-medium tabular-nums">{money(total?.netMinor ?? 0)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
