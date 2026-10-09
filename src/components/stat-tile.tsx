import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatDelta = {
  /** "+12.5%", "-3 pts". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Whether the direction is good news; null for neither. Colours the change. */
  good: boolean | null;
  /** What it is compared with: "vs the same dates last year". */
  against: string;
};

const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

/**
 * One headline figure: a label, the value, and optionally its change against
 * a named earlier period and a short note. The change carries an arrow and
 * words as well as colour, so it never relies on colour alone; green and red
 * follow whether the direction is good news, not just its sign.
 */
export function StatTile({
  label,
  value,
  delta,
  note,
  className,
}: {
  label: string;
  value: string;
  delta?: StatDelta | null;
  note?: string;
  className?: string;
}) {
  const t = useTranslations("statTile");
  const Arrow = delta ? ARROWS[delta.direction] : null;
  return (
    <Card size="sm" className={className}>
      <CardContent className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{label}</p>
        {/* Proportional figures: tabular ones look loose at this size. */}
        <p className="text-2xl font-semibold">{value}</p>
        {delta && Arrow ? (
          <p
            className={cn(
              "flex items-center gap-1 text-xs",
              delta.good === true && "text-emerald-700 dark:text-emerald-400",
              delta.good === false && "text-destructive",
              delta.good === null && "text-muted-foreground",
            )}
          >
            <Arrow aria-hidden className="size-3.5" />
            <span className="sr-only">{t(delta.direction)} </span>
            <span className="font-medium">{delta.text}</span>{" "}
            <span className="text-muted-foreground">{delta.against}</span>
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{note ?? t("noComparison")}</p>
        )}
      </CardContent>
    </Card>
  );
}
