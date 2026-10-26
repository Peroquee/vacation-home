import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getFormat } from "@/i18n/get-format";
import { appToday } from "@/lib/app-today";
import { touristTaxReport } from "@/lib/finance/tourist-tax-report";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.touristTax");
  return { title: t("title") };
}

/**
 * The Kurtaxe owed to the municipality and collected for it, per month of
 * a year (GitLab #120). `?year=` picks the year; this year by default.
 */
export default async function TouristTaxPage({ searchParams }: PageProps<"/finance/tourist-tax">) {
  await connection();
  const raw = (await searchParams).year;
  const thisYear = Number(appToday().slice(0, 4));
  const year =
    typeof raw === "string" && /^\d{4}$/.test(raw) && Number(raw) >= 2000 && Number(raw) <= 2100
      ? Number(raw)
      : thisYear;
  const [report, t, format, locale] = await Promise.all([
    touristTaxReport(year),
    getTranslations("finance.touristTax"),
    getFormat(),
    getLocale(),
  ]);
  const monthName = (month: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(`${month}-01T00:00:00Z`),
    );

  return (
    <>
      <PageHeader
        title={t("heading", { year })}
        description={t("description")}
        actions={
          <>
            <Link
              href={`/finance/tourist-tax?year=${year - 1}`}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("previous", { year: year - 1 })}
            </Link>
            {year < thisYear ? (
              <Link
                href={`/finance/tourist-tax?year=${year + 1}`}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("next", { year: year + 1 })}
              </Link>
            ) : null}
            <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
              {t("back")}
            </Link>
          </>
        }
      />
      {report.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none", { year })}</p>
      ) : (
        report.map(({ currency, months }) => {
          const sum = (key: "owedMinor" | "collectedMinor" | "stays") =>
            months.reduce((total, m) => total + m[key], 0);
          return (
            <Card key={currency} className="mb-6">
              <CardContent>
                <Table>
                  <TableCaption>{t("caption", { year, currency })}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("month")}</TableHead>
                      <TableHead className="text-end">{t("stays")}</TableHead>
                      <TableHead className="text-end">{t("owed")}</TableHead>
                      <TableHead className="text-end">{t("collected")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell>{monthName(m.month)}</TableCell>
                        <TableCell className="text-end tabular-nums">{m.stays}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.money(m.owedMinor, currency)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.money(m.collectedMinor, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>{t("total")}</TableCell>
                      <TableCell className="text-end tabular-nums">{sum("stays")}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {format.money(sum("owedMinor"), currency)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {format.money(sum("collectedMinor"), currency)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </>
  );
}
