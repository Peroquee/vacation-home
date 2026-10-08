"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
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
import { formatDateRange } from "@/lib/format";
import { amountHint, inputToMinor, minorToInput } from "@/lib/properties/form";
import { cn } from "@/lib/utils";

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
};

type FieldErrors = Record<string, string[] | undefined>;
type BookingOption = { id: string; label: string };

function initial(
  transaction: EditableTransaction | undefined,
  defaults: { propertyId: string; date: string },
  currencyOf: (propertyId: string) => string,
) {
  if (transaction) {
    return {
      type: transaction.type,
      amount: minorToInput(transaction.amountMinor, currencyOf(transaction.propertyId)),
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
  const currencyOf = (id: string) => properties.find((p) => p.id === id)?.currency ?? "EUR";
  const [values, setValues] = useState(() => initial(transaction, defaults, currencyOf));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
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
              label: `${b.guest.name}, ${formatDateRange(b.checkIn, b.checkOut)}`,
            })),
          ),
      )
      .catch(() => {
        // The link is optional; without the list, it simply offers none.
      });
    return () => controller.abort();
  }, [values.propertyId, values.date]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountMinor = inputToMinor(values.amount, currency);
    const local: FieldErrors = {};
    if (amountMinor === null || amountMinor === 0) {
      local.amountMinor = [amountMinor === 0 ? "is required" : amountHint(currency)];
    }
    if (!values.categoryId) local.categoryId = ["is required"];
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
        setErrors(result.error.fields);
        return;
      }
      if (!response.ok) {
        throw new Error(result?.error?.message ?? `The server answered ${response.status}.`);
      }
      toastSuccess(
        transaction
          ? "Transaction saved"
          : `${values.type === "income" ? "Income" : "Expense"} added`,
      );
      onDone();
      router.refresh();
    } catch (error) {
      toastError(error, "Could not save the transaction");
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
        <FieldError errors={messages?.map((message) => ({ message: `${label} ${message}` }))} />
      </Field>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{transaction ? "Edit transaction" : "Add a transaction"}</DialogTitle>
        <DialogDescription>
          Amounts are in the property&apos;s currency ({currency}).
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2">
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
                  categoryId: categories.some((c) => c.id === current.categoryId && c.type === type)
                    ? current.categoryId
                    : "",
                }))
              }
            >
              {type === "expense" ? "Expense" : "Income"}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("amountMinor", "Amount", (props) => (
            <Input
              {...props}
              autoFocus
              inputMode="decimal"
              placeholder={minorToInput(0, currency)}
              value={values.amount}
              onChange={(event) => set("amount", event.target.value)}
            />
          ))}
          {field("categoryId", "Category", (props) => (
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
                Choose…
              </NativeSelectOption>
              {choices.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ))}
          {field("date", "Date", (props) => (
            <Input
              {...props}
              type="date"
              value={values.date}
              onChange={(event) => set("date", event.target.value)}
            />
          ))}
          {field("propertyId", "Property", (props) => (
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
        {field("bookingId", "Booking (optional)", (props) => (
          <NativeSelect
            {...props}
            className="w-full"
            value={values.bookingId}
            onChange={(event) => set("bookingId", event.target.value)}
          >
            <NativeSelectOption value="">No booking</NativeSelectOption>
            {bookings.map((b) => (
              <NativeSelectOption key={b.id} value={b.id}>
                {b.label}
              </NativeSelectOption>
            ))}
            {/* Keep a linked booking selectable even when it is outside the window. */}
            {values.bookingId && !bookings.some((b) => b.id === values.bookingId) ? (
              <NativeSelectOption value={values.bookingId}>Linked booking</NativeSelectOption>
            ) : null}
          </NativeSelect>
        ))}
        {field("description", "Description", (props) => (
          <Input
            {...props}
            maxLength={500}
            value={values.description}
            onChange={(event) => set("description", event.target.value)}
          />
        ))}
      </FieldGroup>
      <DialogFooter className={cn(transaction && "sm:justify-between")}>
        {transaction ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="destructive" disabled={pending}>
                Delete
              </Button>
            }
            title="Delete this transaction?"
            description="It is removed from the ledger and every total."
            confirmLabel="Delete"
            cancelLabel="Keep it"
            destructive
            onConfirm={async () => {
              const response = await fetch(`/api/transactions/${transaction.id}`, {
                method: "DELETE",
              });
              if (!response.ok) throw new Error(`The server answered ${response.status}.`);
              toastSuccess("Transaction deleted");
              onDone();
              router.refresh();
            }}
          />
        ) : null}
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : transaction ? "Save" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
