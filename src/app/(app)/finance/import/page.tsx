import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { listCategories } from "@/lib/finance/categories";
import { listProperties } from "@/lib/properties/service";

import { ImportWizard } from "./import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.csv");
  return { title: t("importTitle") };
}

/** Importing transactions from a CSV file (GitLab #83). */
export default async function ImportPage() {
  const [t, properties, categories] = await Promise.all([
    getTranslations("finance.csv"),
    listProperties(),
    listCategories(),
  ]);
  return (
    <>
      <PageHeader title={t("importTitle")} description={t("importDescription")} />
      <ImportWizard
        properties={properties.map((p) => ({ id: p.id, name: p.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
      />
    </>
  );
}
