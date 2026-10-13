-- Payment terms and the reservation hold (GitLab #114).

-- A booking holds its dates while reserved (accepted, awaiting payment),
-- confirmed (deposit received) or paid: the statuses of
-- HOLDING_STATUSES in src/lib/bookings/values.ts. The exclusion constraint
-- and the booking/block triggers of 20261008183135_booking_overlap_exclusion
-- covered `confirmed` only; they now cover all three. A DB test proves the
-- two lists agree.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlapping_confirmed";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_held"
  EXCLUDE USING gist (
    "property_id" WITH =,
    daterange("check_in", "check_out", '[)') WITH &&
  )
  WHERE ("status" IN ('reserved', 'confirmed', 'paid'));

CREATE OR REPLACE FUNCTION "assert_no_booking_block_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash uuid;
BEGIN
  -- FOR NO KEY UPDATE serialises these checks per property without
  -- blocking the foreign-key checks of unrelated inserts.
  PERFORM 1 FROM "properties" WHERE "id" = NEW."property_id" FOR NO KEY UPDATE;

  IF TG_TABLE_NAME = 'bookings' THEN
    IF NEW."status" NOT IN ('reserved', 'confirmed', 'paid') THEN
      RETURN NEW;
    END IF;
    SELECT "id" INTO clash FROM "blocks"
      WHERE "property_id" = NEW."property_id"
        AND daterange("start_date", "end_date", '[)')
            && daterange(NEW."check_in", NEW."check_out", '[)')
      LIMIT 1;
  ELSE
    SELECT "id" INTO clash FROM "bookings"
      WHERE "property_id" = NEW."property_id"
        AND "status" IN ('reserved', 'confirmed', 'paid')
        AND daterange("check_in", "check_out", '[)')
            && daterange(NEW."start_date", NEW."end_date", '[)')
      LIMIT 1;
  END IF;

  IF clash IS NOT NULL THEN
    -- The name leads the message as well: the driver passes the message on,
    -- but not the CONSTRAINT field.
    RAISE EXCEPTION 'bookings_blocks_no_overlap: dates overlap % on the same property', clash
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'bookings_blocks_no_overlap';
  END IF;
  RETURN NEW;
END;
$$;

-- CreateTable
CREATE TABLE "payment_terms" (
    "property_id" UUID NOT NULL,
    "deposit_percent" INTEGER DEFAULT 20,
    "deposit_fixed_minor" INTEGER,
    "deposit_due_days" INTEGER NOT NULL DEFAULT 7,
    "balance_due_days_before" INTEGER NOT NULL DEFAULT 30,
    "full_payment_due_days" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("property_id")
);

-- AddForeignKey
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The bounds src/lib/payment-terms/schema.ts validates, held by the
-- database too. The deposit is either a percentage or a fixed amount.
ALTER TABLE "payment_terms"
  ADD CONSTRAINT "payment_terms_deposit" CHECK (
    ("deposit_percent" IS NULL) <> ("deposit_fixed_minor" IS NULL)
  ),
  ADD CONSTRAINT "payment_terms_deposit_percent" CHECK ("deposit_percent" BETWEEN 1 AND 100),
  ADD CONSTRAINT "payment_terms_deposit_fixed" CHECK ("deposit_fixed_minor" >= 1),
  ADD CONSTRAINT "payment_terms_deposit_due" CHECK ("deposit_due_days" BETWEEN 1 AND 60),
  ADD CONSTRAINT "payment_terms_balance_due" CHECK ("balance_due_days_before" BETWEEN 0 AND 365),
  ADD CONSTRAINT "payment_terms_full_due" CHECK ("full_payment_due_days" BETWEEN 1 AND 60);

-- AlterTable: the hold of a reserved booking. Dates are calendar days in
-- the property's timezone; a deadline passes when that day has ended there.
ALTER TABLE "bookings" ADD COLUMN     "reserved_at" TIMESTAMP(3),
ADD COLUMN     "deposit_amount_minor" INTEGER,
ADD COLUMN     "deposit_due_on" DATE,
ADD COLUMN     "balance_due_on" DATE,
ADD COLUMN     "expired_at" TIMESTAMP(3);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_reserved_has_terms" CHECK (
    "status" <> 'reserved'
    OR ("reserved_at" IS NOT NULL AND "deposit_amount_minor" IS NOT NULL AND "deposit_due_on" IS NOT NULL)
  ),
  ADD CONSTRAINT "bookings_deposit_amount" CHECK (
    "deposit_amount_minor" IS NULL OR "deposit_amount_minor" >= 0
  ),
  ADD CONSTRAINT "bookings_expired_at" CHECK (("status" = 'expired') = ("expired_at" IS NOT NULL));

-- CreateEnum
CREATE TYPE "booking_event_kind" AS ENUM ('reserved', 'deposit_reminder', 'reservation_expired', 'balance_reminder', 'balance_overdue');

-- CreateTable: what happened to a booking that someone is to be told
-- about; GitLab #111 sends the emails from it. `key` makes each event once
-- per occasion (e.g. per deadline: an extended deadline gets its own
-- reminder), so the job that records them can run any number of times.
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "kind" "booking_event_kind" NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_events_booking_id_kind_key_key" ON "booking_events"("booking_id", "kind", "key");

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
