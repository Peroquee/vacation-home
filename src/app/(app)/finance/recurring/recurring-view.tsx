"use client";

import { Plus, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { type Column, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import type { toDto } from "@/lib/finance/recurring";
import { cn } from "@/lib/utils";

import { RuleDialog } from "./rule-dialog";

type RuleStatus = "active" | "paused" | "ended";
export type Rule = Omit<ReturnType<typeof toDto>, "status"> & { status: RuleStatus };
export type RuleProperty = { id: string; name: string; currency: string; archived: boolean };
export type RuleCategory = { id: string; name: string };
/** A new rule's starting values, e.g. from a ledger transaction. */
export type RulePrefill = {
  propertyId: string;
  categoryId: string;
  amountMinor: number;
  startDate: string;
  description: string;
};

const STATUS_STYLE: Record<RuleStatus, string> = {
  active: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ended: "bg-muted text-muted-foreground",
};

/**
 * The recurring costs (GitLab #104): every rule with what it costs, how
 * often, when it is next due and whether it runs; add, edit, pause, resume
 * and delete. Nothing here removes a transaction a rule already created.
 */
export function RecurringView({
  rules,
  properties,
  categories,
  prefill,
}: {
  rules: Rule[];
  properties: RuleProperty[];
  categories: RuleCategory[];
  prefill: RulePrefill | null;
}) {
  const t = useTranslations("finance.recurring");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const format = useFormat();
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { mode: "create"; prefill: RulePrefill | null } | { mode: "edit"; rule: Rule } | null
  >(prefill ? { mode: "create", prefill } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "–";
  const canAdd = properties.some((p) => !p.archived) && categories.length > 0;

  async function send(url: string, method: "POST" | "DELETE") {
    const response = await fetch(url, { method });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(api.message(body) ?? tCommon("serverAnswered", { status: response.status }));
    }
  }

  async function toggle(rule: Rule) {
    setBusy(rule.id);
    const pausing = rule.status !== "paused";
    try {
      await send(`/api/recurring-expenses/${rule.id}/${pausing ? "pause" : "resume"}`, "POST");
      toastSuccess(pausing ? t("paused") : t("resumed"), pausing ? t("pausedHint") : undefined);
      router.refresh();
    } catch (error) {
      toastError(error, t("changeFailed"));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Rule>[] = [
    {
      id: "what",
      header: t("columns.what"),
      cell: (rule) => (
        // The anchor the ledger's "recurring" badge links to.
        <span id={`rule-${rule.id}`} className="inline-flex scroll-mt-20 items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: rule.category.color }}
          />
          <span>
            <span className="block font-medium">{rule.description || rule.category.name}</span>
            {rule.description ? (
              <span className="text-muted-foreground block text-xs">{rule.category.name}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: "property",
      header: t("columns.property"),
      cell: (rule) => propertyName(rule.propertyId),
    },
    {
      id: "amount",
      header: t("columns.amount"),
      align: "end",
      cell: (rule) =>
        t(`every.${rule.interval}`, { amount: format.money(rule.amountMinor, rule.currency) }),
    },
    {
      id: "next",
      header: t("columns.next"),
      cell: (rule) =>
        rule.status === "paused"
          ? t("whenResumed")
          : rule.nextDueDate
            ? format.date(rule.nextDueDate)
            : "–",
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (rule) => (
        <span
          className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[rule.status])}
        >
          {t(`status.${rule.status}`)}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (rule) => {
        const name = rule.description || rule.category.name;
        return (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={t("editRule", { name })}
              onClick={() => setDialog({ mode: "edit", rule })}
            >
              {tCommon("edit")}
            </Button>
            {rule.status !== "ended" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === rule.id}
                aria-busy={busy === rule.id}
                aria-label={t(rule.status === "paused" ? "resumeRule" : "pauseRule", { name })}
                onClick={() => toggle(rule)}
              >
                {rule.status === "paused" ? t("resume") : t("pause")}
              </Button>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" aria-label={t("deleteRule", { name })}>
                  {tCommon("delete")}
                </Button>
              }
              title={t("deleteTitle", { name })}
              description={t("deleteDescription")}
              confirmLabel={tCommon("delete")}
              cancelLabel={t("keep")}
              destructive
              onConfirm={async () => {
                await send(`/api/recurring-expenses/${rule.id}`, "DELETE");
                toastSuccess(t("deleted", { name }));
                router.refresh();
              }}
            />
          </div>
        );
      },
    },
  ];

  const addButton = (
    <Button disabled={!canAdd} onClick={() => setDialog({ mode: "create", prefill: null })}>
      <Plus data-icon="inline-start" aria-hidden />
      {t("add")}
    </Button>
  );

  return (
    <>
      {rules.length > 0 ? <div className="mb-3 flex justify-end">{addButton}</div> : null}
      <DataTable
        caption={t("title")}
        columns={columns}
        rows={rules}
        rowKey={(rule) => rule.id}
        empty={
          <EmptyState
            icon={Repeat}
            title={t("emptyTitle")}
            description={canAdd ? t("emptyDescription") : t("needsSetup")}
            action={addButton}
          />
        }
      />
      {dialog ? (
        <RuleDialog
          key={dialog.mode === "edit" ? dialog.rule.id : "new"}
          rule={dialog.mode === "edit" ? dialog.rule : undefined}
          prefill={dialog.mode === "create" ? dialog.prefill : null}
          properties={properties}
          categories={categories}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
