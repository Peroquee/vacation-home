import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getFormat } from "@/i18n/get-format";
import { getPublicProperty } from "@/lib/listing/public";
import { monthOf } from "@/lib/calendar/month";
import { pickText, type PublicPhotoDto } from "@/lib/properties/public";

import { StayPicker } from "./stay-picker";

/** Once per request, for the metadata and the page alike. */
const listed = cache(getPublicProperty);

export async function generateMetadata({ params }: PageProps<"/stay/[slug]">): Promise<Metadata> {
  const property = await listed((await params).slug);
  if (!property) return {};
  const locale = await getLocale();
  const description = pickText(property.description, locale).slice(0, 160);
  return { title: pickText(property.title, locale), ...(description && { description }) };
}

/**
 * A listed property's public page (GitLab #106), in the visitor's language
 * with the other as a fallback. Server-rendered: plain images with
 * `srcset`, the cover loaded first. Unlisted,
 * archived and unknown properties are all the same 404. The availability
 * calendar and price estimate (GitLab #108) are the one client component.
 */
export default async function StayPage({ params }: PageProps<"/stay/[slug]">) {
  const property = await listed((await params).slug);
  if (!property) notFound();
  const [t, tAmenities, locale, format] = await Promise.all([
    getTranslations("stay"),
    getTranslations("listing.amenities"),
    getLocale(),
    getFormat(),
  ]);
  const title = pickText(property.title, locale);
  const description = pickText(property.description, locale);
  const rules = pickText(property.houseRules, locale);
  const facts = [
    property.maxGuests !== null && t("guests", { count: property.maxGuests }),
    property.bedrooms !== null && t("bedrooms", { count: property.bedrooms }),
    property.bathrooms !== null && t("bathrooms", { count: property.bathrooms }),
  ].filter(Boolean);
  const [cover, ...more] = property.photos;
  const alt = (photo: PublicPhotoDto, n: number) =>
    pickText(photo.alt, locale) || t("photoOf", { n, title });

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:py-10">
      {cover ? (
        <Photo
          photo={cover}
          alt={alt(cover, 1)}
          sizes="(min-width: 48rem) 48rem, 100vw"
          className="aspect-[3/2] rounded-xl"
          priority
        />
      ) : null}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {property.location ? <p className="text-muted-foreground">{property.location}</p> : null}
        {facts.length > 0 ? <p className="text-sm">{facts.join(" · ")}</p> : null}
        {property.nightlyRateFromMinor !== null ? (
          <p className="text-lg font-medium">
            {t("fromRate", {
              rate: format.money(property.nightlyRateFromMinor, property.currency),
            })}
          </p>
        ) : null}
      </header>

      {more.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {more.map((photo, i) => (
            <li key={photo.sizes[0]!.url}>
              <Photo
                photo={photo}
                alt={alt(photo, i + 2)}
                sizes="(min-width: 48rem) 16rem, 50vw"
                className="aspect-[4/3] rounded-lg"
              />
            </li>
          ))}
        </ul>
      ) : null}

      <StayPicker
        slug={property.slug}
        firstMonth={monthOf(new Date().toISOString().slice(0, 10))}
        maxGuests={property.maxGuests}
      />

      {description ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("about")}</h2>
          <p className="whitespace-pre-line">{description}</p>
        </section>
      ) : null}

      {property.amenities.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("amenities")}</h2>
          <ul className="grid list-disc grid-cols-2 gap-x-6 gap-y-1 pl-5 sm:grid-cols-3">
            {property.amenities.map((amenity) => (
              <li key={amenity}>{tAmenities(amenity as Parameters<typeof tAmenities>[0])}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {rules || property.checkInTime || property.checkOutTime ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("rules")}</h2>
          {property.checkInTime || property.checkOutTime ? (
            <p>
              {[
                property.checkInTime && t("checkIn", { time: property.checkInTime }),
                property.checkOutTime && t("checkOut", { time: property.checkOutTime }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {rules ? <p className="whitespace-pre-line">{rules}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

/** A responsive photo: the browser picks the size it needs from `srcset`. */
function Photo({
  photo,
  alt,
  sizes,
  className,
  priority = false,
}: {
  photo: PublicPhotoDto;
  alt: string;
  sizes: string;
  className: string;
  priority?: boolean;
}) {
  const largest = photo.sizes.at(-1)!;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to fixed widths; next/image would resize again
    <img
      src={largest.url}
      srcSet={photo.sizes.map((s) => `${s.url} ${s.width}w`).join(", ")}
      sizes={sizes}
      width={largest.width}
      height={largest.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`bg-muted w-full object-cover ${className}`}
    />
  );
}
