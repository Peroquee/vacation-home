import type { Metadata } from "next";
import Link from "next/link";

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

export const metadata: Metadata = { title: "Categories" };

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

  const columns: Column<CategoryRow>[] = [
    {
      id: "name",
      header: "Category",
      cell: (c) => (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: c.color }}
          />
          <span className={c.hidden ? "text-muted-foreground" : "font-medium"}>{c.name}</span>
          {c.isSystem ? <span className="text-muted-foreground text-xs">default</span> : null}
          {c.hidden ? <span className="text-muted-foreground text-xs">hidden</span> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (c) => (
        <div className="flex justify-end gap-2">
          <CategoryFormDialog
            category={c}
            trigger={
              <Button variant="outline" size="sm" aria-label={`Edit ${c.name}`}>
                Edit
              </Button>
            }
          />
          <HideToggle category={c} />
          {c.isSystem ? null : (
            <DeleteCategory
              category={c}
              targets={rows.filter((t) => t.type === c.type && t.id !== c.id && !t.hidden)}
            />
          )}
        </div>
      ),
    },
  ];

  const section = (type: CategoryRow["type"], title: string, description: string) => (
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
          empty={<EmptyState title={`No ${title.toLowerCase()} categories`} />}
        />
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Categories"
        description="How income and expenses are grouped. Colours carry over to the charts."
        actions={
          <>
            <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
              Back to the ledger
            </Link>
            <CategoryFormDialog trigger={<Button>Add category</Button>} />
          </>
        }
      />
      <div className="space-y-6">
        {section("expense", "Expense", "What the properties cost.")}
        {section("income", "Income", "What they earn.")}
      </div>
    </>
  );
}
