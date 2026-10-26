"use client";

import { Check, Repeat, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { bookingWindow } from "@/lib/finance/ledger";
import { MAX_RECEIPTS } from "@/lib/finance/receipt-files";
import { inputToMinor, minorToInput } from "@/lib/properties/form";
import { useAmountHint } from "@/i18n/use-amount-hint";
import { useFormat } from "@/i18n/use-format";
import { guestDisplayName } from "@/lib/guests/display";
import { cn } from "@/lib/utils";

import { ReceiptPicker, useUploadReceipt } from "./receipt-picker";
import { ReceiptsSection } from "./receipts-section";
import { useApiText } from "@/i18n/use-api-text";

export type LedgerProperty = { id: string; name: string; currency: string };
export type LedgerCategory = {
  id: string;
  name: string;
  type: "income" | "expense";
  color: string;
};
export type EditableTransaction = {
  id: string;
  propertyId: string;
  type: "income" | "expense";
  categoryId: string;
  amountMinor: number;
  date: string;
  description: string | null;
  bookingId: string | null;
  /** The recurring cost that entered it (GitLab #104), if any. */
  recurringExpenseId?: string | null;
};

type FieldErrors = Record<string, string[] | undefined>;
/** A receipt chosen for a new transaction, uploaded once it is saved (GitLab #131). */
type PendingReceipt = { key: number; file: File; error?: string; done?: true };
type BookingOption = { id: string; checkIn: string; checkOut: string; guest: string };

function initial(
  transaction: EditableTransaction | undefined,
  defaults: { propertyId: string; date: string },
  currencyOf: (propertyId: string) => string,
  locale: string,
) {
  if (transaction) {
    return {
      type: transaction.type,
      amount: minorToInput(transaction.amountMinor, currencyOf(transaction.propertyId), locale),
      categoryId: transaction.categoryId,
      date: transaction.date,
      propertyId: transaction.propertyId,
      bookingId: transaction.bookingId ?? "",
      description: transaction.description ?? "",
    };
  }
  return {
    // Expenses are what gets logged by hand; income mostly comes from bookings.
    type: "expense" as "income" | "expense",
    amount: "",
    categoryId: "",
    date: defaults.date,
    propertyId: defaults.propertyId,
    bookingId: "",
    description: "",
  };
}

/**
 * Records a transaction, or edits one when `transaction` is given. Built to
 * be quick: it opens on an expense for today with the amount focused, so
 * the usual entry is amount, category, Enter.
 *
 * A new one can take its receipts straight away (GitLab #131): they upload
 * once it is saved. Should one fail, the transaction stays saved, the form
 * says which file and offers to retry just those - never a second entry.
 */
export function TransactionDialog({
  open,
  onOpenChange,
  transaction,
  properties,
  categories,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: EditableTransaction;
  properties: LedgerProperty[];
  categories: LedgerCategory[];
  defaults: { propertyId: string; date: string };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? (
          <TransactionForm
            key={transaction?.id ?? "new"}
            transaction={transaction}
            properties={properties}
            categories={categories}
            defaults={defaults}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
        {open && transaction ? <ReceiptsSection transactionId={transaction.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  transaction,
  properties,
  categories,
  defaults,
  onDone,
}: {
  transaction?: EditableTransaction;
  properties: LedgerProperty[];
  categories: LedgerCategory[];
  defaults: { propertyId: string; date: string };
  onDone: () => void;
}) {
  const router = useRouter();
  const amountHint = useAmountHint();
  const t = useTranslations("finance.transaction");
  const tRecurring = useTranslations("finance.recurring");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const purgedName = useTranslations("guests")("purgedName");
  const format = useFormat();
  const locale = useLocale();
  const api = useApiText();
  const fail = (body: unknown, status: number) =>
    api.message(body) ?? tCommon("serverAnswered", { status });
  const currencyOf = (id: string) => properties.find((p) => p.id === id)?.currency ?? "EUR";
  const [values, setValues] = useState(() => initial(transaction, defaults, currencyOf, locale));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const uploadReceipt = useUploadReceipt();
  const tReceipts = useTranslations("finance.receipts");
  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const nextKey = useRef(0);
  /** The new transaction, once saved while some of its receipts are not. */
  const [created, setCreated] = useState<string | null>(null);
  const currency = currencyOf(values.propertyId);
  const choices = categories.filter((c) => c.type === values.type);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // Bookings of the property around the date, for the optional link.
  useEffect(() => {
    if (!values.propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) return;
    const controller = new AbortController();
    const { from, to } = bookingWindow(values.date);
    const params = new URLSearchParams({
      propertyId: values.propertyId,
      from,
      to,
      pageSize: "100",
    });
    fetch(`/api/bookings?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then(
        (body: {
          items: { id: string; checkIn: string; checkOut: string; guest: { name: string } }[];
        }) =>
          setBookings(
            body.items.map((b) => ({
              id: b.id,
              checkIn: b.checkIn,
              checkOut: b.checkOut,
              guest: b.guest.name,
            })),
          ),
      )
      .catch(() => {
        // The link is optional; without the list, it simply offers none.
      });
    return () => controller.abort();
  }, [values.propertyId, values.date]);

  /** A new rule with what is typed so far, starting on this date (GitLab #130). */
  function recurringHref() {
    const amountMinor = inputToMinor(values.amount, currency, locale);
    const params = new URLSearchParams({
      new: "1",
      propertyId: values.propertyId,
      date: values.date,
    });
    if (values.categoryId) params.set("categoryId", values.categoryId);
    if (amountMinor) params.set("amountMinor", String(amountMinor));
    if (values.description) params.set("description", values.description);
    return `/finance/recurring?${params}`;
  }

  /** Uploads the receipts not added yet; true when all of them are. */
  async function uploadReceipts(transactionId: string): Promise<boolean> {
    const results: PendingReceipt[] = [];
    for (const receipt of receipts) {
      if (receipt.done) {
        results.push(receipt);
        continue;
      }
      const error = await uploadReceipt(
        `/api/transactions/${transactionId}/attachments`,
        receipt.file,
      );
      results.push(
        error ? { ...receipt, error } : { key: receipt.key, file: receipt.file, done: true },
      );
    }
    setReceipts(results);
    return results.every((receipt) => receipt.done);
  }

  function added() {
    toastSuccess(values.type === "income" ? t("incomeAdded") : t("expenseAdded"));
    onDone();
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (created) {
      // Saved already: only the receipts that failed are tried again.
      setPending(true);
      try {
        if (await uploadReceipts(created)) added();
      } finally {
        setPending(false);
      }
      return;
    }
    const amountMinor = inputToMinor(values.amount, currency, locale);
    const local: FieldErrors = {};
    if (amountMinor === null || amountMinor === 0) {
      local.amountMinor = [amountMinor === 0 ? tForms("required") : amountHint(currency)];
    }
    if (!values.categoryId) local.categoryId = [tForms("required")];
    if (Object.keys(local).length > 0) return setErrors(local);

    const body = {
      ...(!transaction && { propertyId: values.propertyId }),
      type: values.type,
      categoryId: values.categoryId,
      amountMinor,
      date: values.date,
      description: values.description,
      bookingId: values.bookingId || null,
    };
    setPending(true);
    try {
      const response = await fetch(
        transaction ? `/api/transactions/${transaction.id}` : "/api/transactions",
        {
          method: transaction ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json().catch(() => null);
      if (response.status === 422 && result?.error?.fields) {
        setErrors(api.fields(result.error.fields));
        return;
      }
      if (!response.ok) {
        throw new Error(fail(result, response.status));
      }
      if (transaction) {
        toastSuccess(t("saved"));
        onDone();
        router.refresh();
        return;
      }
      if (receipts.length > 0 && !(await uploadReceipts(result.id))) {
        // Kept, and shown in the ledger; the form now offers the retry.
        setCreated(result.id);
        router.refresh();
        return;
      }
      added();
    } catch (error) {
      toastError(error, t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  function field(
    key: string,
    label: string,
    control: (props: { id: string; "aria-invalid"?: true }) => React.ReactNode,
  ) {
    const messages = errors[key];
    const id = `transaction-${key}`;
    return (
      <Field data-invalid={messages ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {control({ id, ...(messages && { "aria-invalid": true }) })}
        <FieldError
          errors={messages?.map((message) => ({
            message: tForms("fieldError", { label, message }),
          }))}
        />
      </Field>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{transaction ? t("editTitle") : t("addTitle")}</DialogTitle>
        <DialogDescription>{t("currencyHint", { currency })}</DialogDescription>
      </DialogHeader>
      {/* Once saved, the entry itself is done: only its receipts are left. */}
      <fieldset disabled={created !== null} className="contents">
        <FieldGroup className="gap-4">
          <div role="radiogroup" aria-label={t("type")} className="grid grid-cols-2 gap-2">
            {(["expense", "income"] as const).map((type) => (
              <Button
                key={type}
                type="button"
                role="radio"
                aria-checked={values.type === type}
                variant={values.type === type ? "default" : "outline"}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    type,
                    // A category belongs to one type.
                    categoryId: categories.some(
                      (c) => c.id === current.categoryId && c.type === type,
                    )
                      ? current.categoryId
                      : "",
                  }))
                }
              >
                {t(type)}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("amountMinor", t("amount"), (props) => (
              <Input
                {...props}
                autoFocus
                inputMode="decimal"
                placeholder={minorToInput(0, currency, locale)}
                value={values.amount}
                onChange={(event) => set("amount", event.target.value)}
              />
            ))}
            {field("categoryId", t("category"), (props) => (
              <NativeSelect
                {...props}
                className="w-full"
                value={values.categoryId}
                onChange={(event) => set("categoryId", event.target.value)}
                // Enter on a select submits nothing by itself; here it saves, so
                // the usual entry stays amount, category, Enter.
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              >
                <NativeSelectOption value="" disabled>
                  {t("choose")}
                </NativeSelectOption>
                {choices.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ))}
            {field("date", t("date"), (props) => (
              <Input
                {...props}
                type="date"
                value={values.date}
                onChange={(event) => set("date", event.target.value)}
              />
            ))}
            {field("propertyId", t("property"), (props) => (
              <NativeSelect
                {...props}
                className="w-full"
                value={values.propertyId}
                // The amount is in this property's currency, so it stays put.
                disabled={Boolean(transaction)}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    propertyId: event.target.value,
                    bookingId: "",
                  }))
                }
              >
                {properties.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ))}
          </div>
          {field("bookingId", t("booking"), (props) => (
            <NativeSelect
              {...props}
              className="w-full"
              value={values.bookingId}
              onChange={(event) => set("bookingId", event.target.value)}
            >
              <NativeSelectOption value="">{t("noBooking")}</NativeSelectOption>
              {bookings.map((b) => (
                <NativeSelectOption key={b.id} value={b.id}>
                  {t("bookingLabel", {
                    guest: guestDisplayName(b.guest, purgedName),
                    when: format.dateRange(b.checkIn, b.checkOut),
                  })}
                </NativeSelectOption>
              ))}
              {/* Keep a linked booking selectable even when it is outside the window. */}
              {values.bookingId && !bookings.some((b) => b.id === values.bookingId) ? (
                <NativeSelectOption value={values.bookingId}>
                  {t("linkedBooking")}
                </NativeSelectOption>
              ) : null}
            </NativeSelect>
          ))}
          {field("description", t("description"), (props) => (
            <Input
              {...props}
              maxLength={500}
              value={values.description}
              onChange={(event) => set("description", event.target.value)}
            />
          ))}
        </FieldGroup>
      </fieldset>
      {!transaction && !created && values.type === "expense" ? (
        // GitLab #130: a regular cost belongs in a rule, which enters it itself.
        <p className="text-muted-foreground text-sm">
          {tRecurring("regularHint")}{" "}
          <Link href={recurringHref()} className="text-foreground font-medium underline">
            {tRecurring("makeRecurring")}
          </Link>
        </p>
      ) : null}
      {transaction ? null : (
        <section aria-labelledby="new-receipts-title" className="space-y-2">
          <h3 id="new-receipts-title" className="text-sm font-medium">
            {tReceipts("title")}
          </h3>
          {created ? (
            <p role="alert" className="text-destructive text-sm">
              {tReceipts(
                values.type === "income" ? "incomeSavedSomeFailed" : "expenseSavedSomeFailed",
              )}
            </p>
          ) : null}
          {receipts.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {receipts.map((receipt) => (
                <li key={receipt.key} className="flex items-start gap-2">
                  {receipt.done ? (
                    <Check
                      aria-label={tReceipts("added")}
                      className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{receipt.file.name}</span>
                    {receipt.error ? (
                      <span className="text-destructive block text-xs">{receipt.error}</span>
                    ) : null}
                  </span>
                  {receipt.done ? null : (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={pending}
                      aria-label={tReceipts("unpick", { name: receipt.file.name })}
                      onClick={() =>
                        setReceipts((current) => current.filter((r) => r.key !== receipt.key))
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <ReceiptPicker
            onFiles={(files) =>
              setReceipts((current) =>
                [...current, ...files.map((file) => ({ key: nextKey.current++, file }))].slice(
                  0,
                  MAX_RECEIPTS,
                ),
              )
            }
            disabled={pending || receipts.length >= MAX_RECEIPTS}
            hint={
              receipts.length >= MAX_RECEIPTS
                ? tReceipts("full", { max: MAX_RECEIPTS })
                : tReceipts("hint", { max: MAX_RECEIPTS })
            }
          />
        </section>
      )}
      <DialogFooter className={cn(transaction && "sm:justify-between")}>
        {transaction ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="destructive" disabled={pending}>
                {tCommon("delete")}
              </Button>
            }
            title={t("deleteTitle")}
            description={t("deleteDescription")}
            confirmLabel={tCommon("delete")}
            cancelLabel={t("keep")}
            destructive
            onConfirm={async () => {
              const response = await fetch(`/api/transactions/${transaction.id}`, {
                method: "DELETE",
              });
              if (!response.ok) throw new Error(fail(null, response.status));
              toastSuccess(t("deleted"));
              onDone();
              router.refresh();
            }}
          />
        ) : null}
        {transaction?.type === "expense" && !transaction.recurringExpenseId ? (
          // A rule pre-filled from this expense, starting a month after it.
          <Link
            href={`/finance/recurring?from=${transaction.id}`}
            className={buttonVariants({ variant: "ghost" })}
          >
            <Repeat data-icon="inline-start" aria-hidden />
            {tRecurring("makeRecurring")}
          </Link>
        ) : null}
        {created ? (
          <Button type="button" variant="outline" disabled={pending} onClick={added}>
            {tReceipts("closeWithout")}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending
            ? tCommon("saving")
            : created
              ? tReceipts("retry")
              : transaction
                ? tCommon("save")
                : t("add")}
        </Button>
      </DialogFooter>
    </form>
  );
}
