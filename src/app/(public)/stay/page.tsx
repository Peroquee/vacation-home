import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { getFormat } from "@/i18n/get-format";
import { listPublicProperties } from "@/lib/listing/public";
import { pickText, shortened } from "@/lib/properties/public";

import { Photo } from "./photo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("start");
  return { title: t("title"), description: t("description") };
}

/**
 * The public start page (GitLab #117): what a guest sees at the domain's
 * root - src/proxy.ts serves it there to whoever is signed out, and the
 * owner signed in gets the calendar. One listed property: straight to its
 * page. Several: a card for each. None: a neutral note.
 */
export default async function StartPage() {
  // Read at request time: listings change in settings.
  await connection();
  const properties = await listPublicProperties();
  if (properties.length === 1) redirect(`/stay/${properties[0]!.slug}`);
  const [t, tStay, tPricing, locale, format] = await Promise.all([
    getTranslations("start"),
    getTranslations("stay"),
    getTranslations("pricing"),
    getLocale(),
    getFormat(),
  ]);

  if (properties.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-2 px-4 py-16 text-center sm:py-24">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("soonTitle")}</h1>
        <p className="text-muted-foreground">{t("soon")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
      <ul className="grid gap-6 sm:grid-cols-2">
        {properties.map((property, i) => {
          const title = pickText(property.title, locale);
          const description = shortened(pickText(property.description, locale));
          const cover = property.photos[0];
          return (
            <li key={property.slug}>
              <article className="group relative space-y-2">
                {cover ? (
                  <Photo
                    photo={cover}
                    alt={pickText(cover.alt, locale) || tStay("photoOf", { n: 1, title })}
                    sizes="(min-width: 64rem) 30rem, (min-width: 40rem) 50vw, 100vw"
                    className="aspect-[3/2] rounded-xl"
                    // The first card's photo is the page's largest paint.
                    priority={i === 0}
                  />
                ) : (
                  <div aria-hidden className="bg-muted aspect-[3/2] rounded-xl" />
                )}
                <h2 className="text-lg font-semibold">
                  {/* The whole card is the link; the title names it. */}
                  <Link
                    href={`/stay/${property.slug}`}
                    className="after:absolute after:inset-0 group-hover:underline"
                  >
                    {title}
                  </Link>
                </h2>
                {property.location ? (
                  <p className="text-muted-foreground text-sm">{property.location}</p>
                ) : null}
                {description ? <p className="text-sm">{description}</p> : null}
                {property.nightlyRateFromMinor !== null ? (
                  <p className="font-medium">
                    {tStay("fromRate", {
                      rate: format.money(property.nightlyRateFromMinor, property.currency),
                    })}
                    {property.touristTax
                      ? ` · ${tPricing(property.touristTax === "plus" ? "plusTax" : "includedTax")}`
                      : null}
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
