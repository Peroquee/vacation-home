-- Seasonal prices and the shared price breakdown (GitLab #118).

-- Seasons per property: a name, a start and an end day (both included) as
-- month and day, every year (year NULL) or once (in that year, the end in
-- the next one when it comes before the start), and the nightly rate.
-- src/lib/pricing/seasons.ts has the rest: a one-off season beats a yearly
-- one, and seasons of one kind may not overlap (checked by the API, under
-- the property's lock).
CREATE TABLE "property_seasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_month" SMALLINT NOT NULL,
    "start_day" SMALLINT NOT NULL,
    "end_month" SMALLINT NOT NULL,
    "end_day" SMALLINT NOT NULL,
    "year" SMALLINT,
    "rate_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_seasons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "property_seasons_name" CHECK (btrim("name") <> '' AND length("name") <= 60),
    CONSTRAINT "property_seasons_month_day" CHECK (
      "start_month" BETWEEN 1 AND 12 AND "end_month" BETWEEN 1 AND 12 AND
      "start_day" BETWEEN 1 AND 31 AND "end_day" BETWEEN 1 AND 31
    ),
    CONSTRAINT "property_seasons_year" CHECK ("year" IS NULL OR "year" BETWEEN 2000 AND 2100),
    CONSTRAINT "property_seasons_rate" CHECK ("rate_minor" >= 0)
);

CREATE INDEX "property_seasons_property_id_idx" ON "property_seasons"("property_id");

ALTER TABLE "property_seasons" ADD CONSTRAINT "property_seasons_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A booking's own nightly rate becomes optional: NULL prices its nights by
-- the property's seasons. Bookings so far keep the rate they were copied,
-- so re-pricing one (new dates) prices it flat, as before.
ALTER TABLE "bookings" ALTER COLUMN "nightly_rate_minor" DROP NOT NULL;

-- The price as it was worked out, kept with the booking so later season
-- changes never move an agreed total (src/lib/pricing/engine.ts). The
-- bookings so far get a "legacy" breakdown of their total: nothing changes
-- for them. NULL (rows written outside the app) reads as legacy too.
ALTER TABLE "bookings" ADD COLUMN "price_breakdown" JSONB;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_breakdown_object"
  CHECK ("price_breakdown" IS NULL OR jsonb_typeof("price_breakdown") = 'object');

UPDATE "bookings" SET "price_breakdown" = jsonb_build_object(
  'version', 1, 'kind', 'legacy', 'currency', "currency", 'totalMinor', "total_amount_minor"
);
