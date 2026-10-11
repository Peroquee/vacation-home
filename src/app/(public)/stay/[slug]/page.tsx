import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache } from "react";

import { toPublicDto } from "@/lib/properties/public";
import { getListedProperty } from "@/lib/properties/service";

/** Once per request, for the metadata and the page alike. */
const listed = cache(async (slug: string) => {
  const property = await getListedProperty(slug);
  return property ? toPublicDto(property) : null;
});

export async function generateMetadata({ params }: PageProps<"/stay/[slug]">): Promise<Metadata> {
  const property = await listed((await params).slug);
  return property ? { title: property.name } : {};
}

/**
 * A listed property's public page. Unlisted, archived and unknown properties
 * are all the same 404. The listing profile and the availability calendar
 * fill it in (GitLab #106, #108).
 */
export default async function StayPage({ params }: PageProps<"/stay/[slug]">) {
  const property = await listed((await params).slug);
  if (!property) notFound();
  const t = await getTranslations("stay");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{property.name}</h1>
      <p className="text-muted-foreground mt-2">{t("intro")}</p>
    </main>
  );
}
