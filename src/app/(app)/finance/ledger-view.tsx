"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { runningNet, signedMinor } from "@/lib/finance/ledger";
import { formatDate, formatMoney } from "@/lib/format";
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
    { id: "date", header: "Date", cell: (t) => formatDate(t.date) },
    {
      id: "what",
      header: "Description",
      cell: (t) => (
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => setEditing(t)}
          aria-label={`Edit: ${t.description || t.category.name}, ${formatDate(t.date)}`}
        >
          {t.description || <span className="text-muted-foreground">{t.category.name}</span>}
        </button>
      ),
    },
    {
      id: "category",
      header: "Category",
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
    { id: "property", header: "Property", cell: (t) => names.get(t.propertyId) ?? "–" },
    {
      id: "booking",
      header: "Booking",
      cell: (t) =>
        t.bookingId ? (
          <Link href={`/bookings/${t.bookingId}`} className="underline">
            View
          </Link>
        ) : null,
    },
    {
      id: "amount",
      header: "Amount",
      align: "end",
      cell: (t) => (
        <span className={cn(t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "")}>
          {/* The sign says the direction; the green only repeats it. */}
          {t.type === "income" ? "+" : ""}
          {formatMoney(signedMinor(t), t.currency)}
        </span>
      ),
    },
    {
      id: "running",
      header: "Running net",
      align: "end",
      cell: (t) => (
        <span className="text-muted-foreground">{formatMoney(after.get(t.id)!, t.currency)}</span>
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
          {rows.length} {rows.length === 1 ? "transaction" : "transactions"}
          {truncated ? " (the first 200; narrow the filters to see the rest)" : ""}
        </p>
        <Button onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          Add
          <kbd className="bg-primary-foreground/20 ml-1 rounded px-1 text-[10px]">T</kbd>
        </Button>
      </div>

      <DataTable
        caption="Transactions"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        empty={
          <EmptyState
            title="No transactions in this period"
            description="Add an expense or income, or pick another month."
            action={<Button onClick={() => setAdding(true)}>Add a transaction</Button>}
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
  const money = (minor: number) => (total ? formatMoney(minor, total.currency) : "–");
  return (
    <Card size="sm" className="sm:col-span-3">
      <CardHeader>
        <CardTitle>Period totals{total ? ` (${total.currency})` : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Income</dt>
            <dd className="font-medium tabular-nums">{money(total?.incomeMinor ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Expenses</dt>
            <dd className="font-medium tabular-nums">{money(total?.expenseMinor ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Net</dt>
            <dd className="font-medium tabular-nums">{money(total?.netMinor ?? 0)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
