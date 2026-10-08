-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('inquiry', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "booking_source" AS ENUM ('direct', 'airbnb', 'booking.com', 'other');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'inquiry',
    "source" "booking_source" NOT NULL DEFAULT 'direct',
    "guest_count" INTEGER NOT NULL DEFAULT 1,
    "nightly_rate_minor" INTEGER NOT NULL,
    "cleaning_fee_minor" INTEGER NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "total_is_manual" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_property_id_check_in_check_out_idx" ON "bookings"("property_id", "check_in", "check_out");

-- CreateIndex
CREATE INDEX "bookings_guest_id_idx" ON "bookings"("guest_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants, held by the database as well as the API.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_check_out_after_check_in" CHECK ("check_out" > "check_in"),
  ADD CONSTRAINT "bookings_guest_count_positive" CHECK ("guest_count" >= 1),
  ADD CONSTRAINT "bookings_nightly_rate_non_negative" CHECK ("nightly_rate_minor" >= 0),
  ADD CONSTRAINT "bookings_cleaning_fee_non_negative" CHECK ("cleaning_fee_minor" >= 0),
  ADD CONSTRAINT "bookings_total_non_negative" CHECK ("total_amount_minor" >= 0),
  ADD CONSTRAINT "bookings_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

-- The date rule, for anyone reading the database rather than the Prisma schema.
COMMENT ON COLUMN "bookings"."check_in" IS
  'First night of the stay: a calendar date in the property''s timezone.';
COMMENT ON COLUMN "bookings"."check_out" IS
  'Departure day, EXCLUSIVE: the stay occupies [check_in, check_out), so this day is free for the next arrival. Nights = check_out - check_in.';
COMMENT ON COLUMN "bookings"."total_amount_minor" IS
  'Integer minor units of "currency". Normally nights * nightly_rate_minor + cleaning_fee_minor; total_is_manual marks a hand-set total.';
