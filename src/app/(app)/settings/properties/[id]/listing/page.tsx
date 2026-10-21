import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { isUuid } from "@/lib/api";
import { getListing, getStayTimes, listPhotos } from "@/lib/listing/service";
import { getProperty } from "@/lib/properties/service";

import { ListingForm } from "./listing-form";
import { PhotoManager } from "./photo-manager";
import { StayTimesCard } from "./stay-times-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("listing.page");
  return { title: t("title") };
}

/**
 * A property's public profile and photos (GitLab #106): what guests see on
 * its page on the booking site, /stay/<slug>; and its arrival and departure
 * times (GitLab #126).
 */
export default async function ListingPage({
  params,
}: PageProps<"/settings/properties/[id]/listing">) {
  await connection();
  const { id } = await params;
  const property = isUuid(id) ? await getProperty(id) : null;
  if (!property) notFound();
  const [listing, photos, times] = await Promise.all([
    getListing(id),
    listPhotos(id),
    getStayTimes(id),
  ]);
  const t = await getTranslations("listing.page");

  return (
    <>
      <PageHeader
        title={t("heading", { name: property.name })}
        description={
          property.publiclyListed && property.slug
            ? t("listed", { path: `/stay/${property.slug}` })
            : t("notListed")
        }
        actions={
          <>
            {property.publiclyListed && property.slug && !property.archivedAt ? (
              <Link
                href={`/stay/${property.slug}`}
                target="_blank"
                className={buttonVariants({ variant: "outline" })}
              >
                {t("view")}
              </Link>
            ) : null}
            <Link href="/settings" className={buttonVariants({ variant: "outline" })}>
              {t("back")}
            </Link>
          </>
        }
      />
      <div className="space-y-6">
        <PhotoManager propertyId={id} initial={photos} />
        <ListingForm propertyId={id} initial={listing} />
        <StayTimesCard propertyId={id} initial={times} />
      </div>
    </>
  );
}
