import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { type Column, DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listCategories } from "@/lib/finance/categories";

import {
  CategoryFormDialog,
  type CategoryRow,
  DeleteCategory,
  HideToggle,
} from "./category-dialogs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.categories");
  return { title: t("title") };
}

/**
 * Income and expense categories: add, rename, recolour, hide and delete.
 * The defaults can be renamed, recoloured and hidden but not deleted; a
 * category in use can be deleted after moving its transactions elsewhere.
 */
export default async function CategoriesPage() {
  const rows: CategoryRow[] = (await listCategories({ includeHidden: true })).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    color: c.color,
    isSystem: c.isSystem,
    hidden: c.hidden,
  }));
  const t = await getTranslations("finance.categories");
  const tCommon = await getTranslations("common");

  const columns: Column<CategoryRow>[] = [
    {
      id: "name",
      header: t("category"),
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: c.color }}
          />
          <span className={c.hidden ? "text-muted-foreground" : "font-medium"}>{c.name}</span>
          {c.isSystem ? (
            <span className="text-muted-foreground text-xs">{t("default")}</span>
          ) : null}
          {c.hidden ? <span className="text-muted-foreground text-xs">{t("hidden")}</span> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      cell: (c) => (
        <div className="flex justify-end gap-2">
          <CategoryFormDialog
            category={c}
            trigger={
              <Button variant="outline" size="sm" aria-label={t("edit", { name: c.name })}>
                {tCommon("edit")}
              </Button>
            }
          />
          <HideToggle category={c} />
          {c.isSystem ? null : (
            <DeleteCategory
              category={c}
              targets={rows.filter((r) => r.type === c.type && r.id !== c.id && !r.hidden)}
            />
          )}
        </div>
      ),
    },
  ];

  const section = (
    type: CategoryRow["type"],
    title: string,
    description: string,
    empty: string,
  ) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          caption={title}
          columns={columns}
          rows={rows.filter((c) => c.type === type)}
          rowKey={(c) => c.id}
          empty={<EmptyState title={empty} />}
        />
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
              {t("back")}
            </Link>
            <CategoryFormDialog trigger={<Button>{t("add")}</Button>} />
          </>
        }
      />
      <div className="space-y-6">
        {section("expense", t("expense"), t("expenseHint"), t("noExpense"))}
        {section("income", t("income"), t("incomeHint"), t("noIncome"))}
      </div>
    </>
  );
}
