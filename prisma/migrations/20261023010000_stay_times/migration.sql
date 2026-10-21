-- Arrival and departure times per property (GitLab #126). The listing's
-- check_in_time is the earliest arrival and its check_out_time the latest
-- departure, both kept as they are; the earliest departure is new.
ALTER TABLE "property_listings" ADD COLUMN "earliest_check_out_time" TEXT;
ALTER TABLE "property_listings"
  ADD CONSTRAINT "property_listings_earliest_check_out_time" CHECK (
    "earliest_check_out_time" IS NULL
    OR "earliest_check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  -- "HH:MM" compares as text in time order.
  ADD CONSTRAINT "property_listings_departure_order" CHECK (
    "earliest_check_out_time" IS NULL OR "check_out_time" IS NULL
    OR "earliest_check_out_time" <= "check_out_time"
  );

-- The times a booking was reserved under, as
-- {"checkInTime", "earliestCheckOutTime", "checkOutTime"} (each "HH:MM" or
-- null; src/lib/listing/stay-times.ts). NULL: not reserved yet, the
-- property's times apply.
ALTER TABLE "bookings" ADD COLUMN "stay_times" JSONB;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stay_times_object"
  CHECK ("stay_times" IS NULL OR jsonb_typeof("stay_times") = 'object');

-- backfill: the bookings reserved or made already keep the times as they
-- are now (src/lib/listing/stay-times.migration.db.test.ts runs this).
UPDATE "bookings" b
SET "stay_times" = jsonb_build_object(
  'checkInTime', l."check_in_time",
  'earliestCheckOutTime', NULL,
  'checkOutTime', l."check_out_time"
)
FROM "property_listings" l
WHERE l."property_id" = b."property_id"
  AND (b."reserved_at" IS NOT NULL OR b."status" IN ('reserved', 'confirmed', 'paid'))
  AND b."stay_times" IS NULL;
