-- CreateTable
CREATE TABLE "booking_rules" (
    "property_id" UUID NOT NULL,
    "min_nights" INTEGER NOT NULL DEFAULT 1,
    "max_nights" INTEGER,
    "min_lead_days" INTEGER NOT NULL DEFAULT 0,
    "horizon_days" INTEGER,
    "check_in_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "buffer_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_rules_pkey" PRIMARY KEY ("property_id")
);

-- AddForeignKey
ALTER TABLE "booking_rules" ADD CONSTRAINT "booking_rules_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The bounds src/lib/booking-rules/schema.ts validates, held by the
-- database too.
ALTER TABLE "booking_rules"
  ADD CONSTRAINT "booking_rules_min_nights" CHECK ("min_nights" BETWEEN 1 AND 365),
  ADD CONSTRAINT "booking_rules_max_nights" CHECK (
    "max_nights" IS NULL OR "max_nights" BETWEEN "min_nights" AND 365
  ),
  ADD CONSTRAINT "booking_rules_lead" CHECK ("min_lead_days" BETWEEN 0 AND 1095),
  ADD CONSTRAINT "booking_rules_horizon" CHECK (
    "horizon_days" IS NULL OR ("horizon_days" BETWEEN 1 AND 1095 AND "horizon_days" > "min_lead_days")
  ),
  ADD CONSTRAINT "booking_rules_weekdays" CHECK ("check_in_weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  ADD CONSTRAINT "booking_rules_buffer" CHECK ("buffer_days" BETWEEN 0 AND 30);
