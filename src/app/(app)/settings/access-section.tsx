"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useApiText } from "@/i18n/use-api-text";

export type AccessAccount = { id: string | null; email: string; fixed: boolean };

/**
 * Who may sign in (GitLab #122): the accounts fixed in the server's
 * settings (AUTH_ALLOWED_EMAILS), which cannot be removed here, and those
 * added here. Removing one ends its sessions at once. The owner's own
 * account and the last one stay.
 */
export function AccessSection({
  accounts,
  currentEmail,
}: {
  accounts: AccessAccount[];
  currentEmail: string;
}) {
  const t = useTranslations("settings.access");
  const tCommon = useTranslations("common");
  const tForms = useTranslations("forms");
  const api = useApiText();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const own = currentEmail.trim().toLowerCase();

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/access/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 422 && body?.error?.fields?.email) {
          setErrors(api.fields(body.error.fields).email ?? []);
          return;
        }
        if (response.status === 409) {
          setErrors([api.message(body) ?? t("exists")]);
          return;
        }
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      toastSuccess(t("added"));
      setEmail("");
      setErrors([]);
      router.refresh();
    } catch (error) {
      toastError(error, t("addFailed"));
    } finally {
      setPending(false);
    }
  }

  async function remove(account: AccessAccount) {
    const response = await fetch(`/api/access/accounts/${account.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      const body = await response.json().catch(() => null);
      throw new Error(api.message(body) ?? tCommon("serverAnswered", { status: response.status }));
    }
    toastSuccess(t("removed"));
    router.refresh();
  }

  const label = t("email");
  return (
    <Card id="access">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border text-sm">
          {accounts.map((account) => (
            <li
              key={account.email}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div>
                <div className="font-medium">{account.email}</div>
                <div className="text-muted-foreground">
                  {[account.fixed ? t("fixed") : null, account.email === own ? t("you") : null]
                    .filter(Boolean)
                    .join(" · ") || t("addedHere")}
                </div>
              </div>
              {!account.fixed && account.id && account.email !== own ? (
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("remove", { email: account.email })}
                    >
                      {t("removeShort")}
                    </Button>
                  }
                  title={t("removeTitle", { email: account.email })}
                  description={t("removeDescription")}
                  confirmLabel={t("removeShort")}
                  destructive
                  onConfirm={() => remove(account)}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2">
          <Field className="max-w-sm flex-1" data-invalid={errors.length ? true : undefined}>
            <FieldLabel htmlFor="access-email">{label}</FieldLabel>
            <Input
              id="access-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...(errors.length && { "aria-invalid": true })}
            />
            <FieldDescription>{t("hint")}</FieldDescription>
            <FieldError
              errors={errors.map((message) => ({
                message: tForms("fieldError", { label, message }),
              }))}
            />
          </Field>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {t("add")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
