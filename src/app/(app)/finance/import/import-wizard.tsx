"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { useId, useState } from "react";

import { toastError } from "@/components/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useApiText } from "@/i18n/use-api-text";
import { useFormat } from "@/i18n/use-format";
import {
  type ColumnMapping,
  guessMapping,
  IMPORT_FIELDS,
  type ImportField,
} from "@/lib/finance/csv";
import type { ImportRow } from "@/lib/finance/import";

type Option = { id: string; name: string };
type CategoryOption = Option & { type: "income" | "expense" };
type Result = { rows: ImportRow[]; summary: Record<ImportRow["status"], number> };

const MAX_ROWS = 5000;
/** Ready rows shown in the preview; the rest are counted. */
const SHOWN_READY = 50;

/**
 * Importing transactions from a CSV file in four steps (GitLab #83): pick
 * the file (read here, in the browser), say which column holds what, look
 * at every row the server checked, then import. Malformed rows are listed
 * by line and left out; duplicates wait for a tick each.
 */
export function ImportWizard({
  properties,
  categories,
}: {
  properties: Option[];
  categories: CategoryOption[];
}) {
  const t = useTranslations("finance.csv");
  const tCommon = useTranslations("common");
  const api = useApiText();
  const router = useRouter();
  const id = useId();

  const [table, setTable] = useState<string[][] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaults, setDefaults] = useState({
    propertyId: properties.length === 1 ? properties[0]!.id : "",
    incomeCategoryId: "",
    expenseCategoryId: "",
  });
  const [preview, setPreview] = useState<Result | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  const header = table && hasHeader ? table[0]! : null;
  const dataRows = table ? (hasHeader ? table.slice(1) : table) : [];
  const columns = table ? Math.max(...table.map((r) => r.length)) : 0;
  const columnName = (i: number) => header?.[i]?.trim() || t("column", { n: i + 1 });

  function readFile(file: File) {
    setFileError(null);
    setPreview(null);
    setDone(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: ({ data }) => {
        const rows = data.map((row) => row.map((value) => value.replace(/^﻿/, "")));
        if (rows.length === 0) return setFileError(t("fileEmpty"));
        if (rows.length - 1 > MAX_ROWS) return setFileError(t("fileTooLong", { max: MAX_ROWS }));
        setTable(rows);
        setMapping(guessMapping(rows[0]!));
      },
      error: () => setFileError(t("fileUnreadable")),
    });
  }

  async function send(commit: boolean): Promise<Result | null> {
    setPending(true);
    try {
      const response = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: dataRows,
          firstLine: hasHeader ? 2 : 1,
          mapping,
          defaults: Object.fromEntries(Object.entries(defaults).filter(([, v]) => v)),
          commit,
          include: [...include],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          api.message(body) ?? tCommon("serverAnswered", { status: response.status }),
        );
      }
      return body as Result;
    } catch (error) {
      toastError(error, commit ? t("importFailed") : t("checkFailed"));
      return null;
    } finally {
      setPending(false);
    }
  }

  const fieldLabel = (field: ImportField) => t(`fields.${field}`);
  const ready = mapping.date !== undefined && mapping.amount !== undefined;
  const needsProperty = mapping.property === undefined && !defaults.propertyId;

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("doneTitle")}</CardTitle>
          <CardDescription>
            {t("doneSummary", {
              imported: done.summary.imported,
              skipped: done.summary.skipped,
              invalid: done.summary.invalid,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Link href="/finance" className={buttonVariants()}>
            {t("toLedger")}
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              setDone(null);
              setPreview(null);
              setTable(null);
            }}
          >
            {t("another")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step1")}</CardTitle>
          <CardDescription>{t("step1Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field>
            <FieldLabel htmlFor={`${id}-file`}>{t("file")}</FieldLabel>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file);
              }}
            />
            {fileError ? (
              <p role="alert" className="text-destructive text-sm">
                {fileError}
              </p>
            ) : table ? (
              <FieldDescription>{t("fileRead", { count: dataRows.length })}</FieldDescription>
            ) : null}
          </Field>
          {table ? (
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id={`${id}-header`}
                checked={hasHeader}
                onCheckedChange={(checked) => {
                  setHasHeader(checked);
                  setPreview(null);
                }}
              />
              <FieldLabel htmlFor={`${id}-header`}>{t("hasHeader")}</FieldLabel>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      {table ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("step2")}</CardTitle>
            <CardDescription>{t("step2Hint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <Field key={field}>
                  <FieldLabel htmlFor={`${id}-map-${field}`}>
                    {fieldLabel(field)}
                    {field === "date" || field === "amount" ? " *" : ""}
                  </FieldLabel>
                  <NativeSelect
                    id={`${id}-map-${field}`}
                    className="w-full"
                    value={mapping[field] === undefined ? "" : String(mapping[field])}
                    onChange={(event) => {
                      const value = event.target.value;
                      setMapping((m) => {
                        const next = { ...m };
                        if (value === "") delete next[field];
                        else next[field] = Number(value);
                        return next;
                      });
                      setPreview(null);
                    }}
                  >
                    <NativeSelectOption value="">{t("notInFile")}</NativeSelectOption>
                    {Array.from({ length: columns }, (_, i) => (
                      <NativeSelectOption key={i} value={String(i)}>
                        {columnName(i)}
                        {dataRows[0]?.[i]
                          ? ` (${t("example", { value: dataRows[0][i]!.slice(0, 30) })})`
                          : ""}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {field === "type" && mapping.type === undefined ? (
                    <FieldDescription>{t("typeBySign")}</FieldDescription>
                  ) : null}
                </Field>
              ))}
            </div>

            <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
              {mapping.property === undefined ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-property`}>{t("defaultProperty")}</FieldLabel>
                  <NativeSelect
                    id={`${id}-property`}
                    className="w-full"
                    value={defaults.propertyId}
                    onChange={(event) =>
                      setDefaults((d) => ({ ...d, propertyId: event.target.value }))
                    }
                  >
                    <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
                    {properties.map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {(["income", "expense"] as const).map((type) => {
                const key = type === "income" ? "incomeCategoryId" : "expenseCategoryId";
                return (
                  <Field key={type}>
                    <FieldLabel htmlFor={`${id}-${key}`}>
                      {type === "income" ? t("defaultIncome") : t("defaultExpense")}
                    </FieldLabel>
                    <NativeSelect
                      id={`${id}-${key}`}
                      className="w-full"
                      value={defaults[key]}
                      onChange={(event) =>
                        setDefaults((d) => ({ ...d, [key]: event.target.value }))
                      }
                    >
                      <NativeSelectOption value="">{t("none")}</NativeSelectOption>
                      {categories
                        .filter((c) => c.type === type)
                        .map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                    <FieldDescription>{t("defaultCategoryHint")}</FieldDescription>
                  </Field>
                );
              })}
            </div>

            <Button
              disabled={!ready || needsProperty || pending || dataRows.length === 0}
              aria-busy={pending}
              onClick={async () => {
                setInclude(new Set());
                setPreview(await send(false));
              }}
            >
              {pending && !preview ? t("checking") : t("check")}
            </Button>
            {!ready ? <p className="text-muted-foreground text-sm">{t("needDateAmount")}</p> : null}
            {ready && needsProperty ? (
              <p className="text-muted-foreground text-sm">{t("needProperty")}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <Preview
          result={preview}
          include={include}
          onToggle={(line, on) =>
            setInclude((set) => {
              const next = new Set(set);
              if (on) next.add(line);
              else next.delete(line);
              return next;
            })
          }
          pending={pending}
          onImport={async () => {
            const result = await send(true);
            if (result) {
              setDone(result);
              router.refresh();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function Preview({
  result,
  include,
  onToggle,
  pending,
  onImport,
}: {
  result: Result;
  include: Set<number>;
  onToggle: (line: number, on: boolean) => void;
  pending: boolean;
  onImport: () => void;
}) {
  const t = useTranslations("finance.csv");
  const tForms = useTranslations("forms");
  const tTypes = useTranslations("finance.transaction");
  const api = useApiText();
  const format = useFormat();
  const { summary } = result;
  const count = summary.ready + include.size;

  const problems = result.rows.filter((r) => r.status === "invalid");
  const duplicates = result.rows.filter((r) => r.status === "duplicate");
  const ready = result.rows.filter((r) => r.status === "ready");

  const describeDuplicate = (row: ImportRow) =>
    row.duplicateOf && "line" in row.duplicateOf
      ? t("duplicateOfLine", { line: row.duplicateOf.line })
      : t("duplicateOfLedger");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("step3")}</CardTitle>
        <CardDescription>
          {t("previewSummary", {
            ready: summary.ready,
            duplicate: summary.duplicate,
            invalid: summary.invalid,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {problems.length > 0 ? (
          <section aria-labelledby="import-problems" className="space-y-2">
            <h3 id="import-problems" className="text-destructive text-sm font-medium">
              {t("problems", { count: problems.length })}
            </h3>
            <ul className="divide-y rounded-lg border text-sm">
              {problems.map((row) => (
                <li key={row.line} className="p-2">
                  <span className="font-medium">{t("line", { line: row.line })}</span>{" "}
                  {row.errors
                    .map((e) =>
                      tForms("fieldError", {
                        label: t(`fields.${e.field as ImportField}`),
                        message: api.text(e.message),
                      }),
                    )
                    .join("; ")}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {duplicates.length > 0 ? (
          <section aria-labelledby="import-duplicates" className="space-y-2">
            <h3 id="import-duplicates" className="text-sm font-medium">
              {t("duplicates", { count: duplicates.length })}
            </h3>
            <p className="text-muted-foreground text-sm">{t("duplicatesHint")}</p>
            <ul className="divide-y rounded-lg border text-sm">
              {duplicates.map((row) => (
                <li key={row.line} className="flex items-start gap-2 p-2">
                  <Checkbox
                    id={`dup-${row.line}`}
                    checked={include.has(row.line)}
                    onCheckedChange={(checked) => onToggle(row.line, checked)}
                  />
                  <label htmlFor={`dup-${row.line}`} className="min-w-0">
                    <span className="font-medium">{t("line", { line: row.line })}</span>{" "}
                    {draftText(row)} ·{" "}
                    <span className="text-muted-foreground">{describeDuplicate(row)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {ready.length > 0 ? (
          <section aria-labelledby="import-ready" className="space-y-2">
            <h3 id="import-ready" className="text-sm font-medium">
              {t("readyRows", { count: ready.length })}
            </h3>
            <ul className="divide-y rounded-lg border text-sm">
              {ready.slice(0, SHOWN_READY).map((row) => (
                <li key={row.line} className="p-2">
                  <span className="font-medium">{t("line", { line: row.line })}</span>{" "}
                  {draftText(row)}
                </li>
              ))}
            </ul>
            {ready.length > SHOWN_READY ? (
              <p className="text-muted-foreground text-sm">
                {t("andMore", { count: ready.length - SHOWN_READY })}
              </p>
            ) : null}
          </section>
        ) : null}

        <Button disabled={count === 0 || pending} aria-busy={pending} onClick={onImport}>
          {pending ? t("importing") : t("importCount", { count })}
        </Button>
      </CardContent>
    </Card>
  );

  function draftText(row: ImportRow) {
    const d = row.draft!;
    return [
      format.date(d.date),
      tTypes(d.type),
      format.money(d.amountMinor, d.currency),
      d.category,
      d.property,
      d.description,
    ]
      .filter(Boolean)
      .join(" · ");
  }
}
