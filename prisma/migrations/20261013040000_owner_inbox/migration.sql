-- The owner's inbox for booking requests (GitLab #110). The new event
-- kinds are only added here, not used, so one migration will do.
ALTER TYPE "booking_event_kind" ADD VALUE 'requested' BEFORE 'reserved';
ALTER TYPE "booking_event_kind" ADD VALUE 'declined';
ALTER TYPE "booking_event_kind" ADD VALUE 'request_expired';

-- AlterTable: a declined request keeps when and, if given, why. The reason
-- goes to the guest; it is cleared by the DSGVO purge like the other text.
ALTER TABLE "bookings" ADD COLUMN     "declined_at" TIMESTAMP(3),
ADD COLUMN     "decline_reason" TEXT;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_decline_reason" CHECK (char_length("decline_reason") <= 1000),
  ADD CONSTRAINT "bookings_declined_cancelled" CHECK ("declined_at" IS NULL OR "status" = 'cancelled');

-- CreateTable: how requests are handled, per property. No row means the
-- defaults: unanswered requests expire after 3 days; declined and expired
-- ones are anonymised after 6 months.
CREATE TABLE "request_settings" (
    "property_id" UUID NOT NULL,
    "expiry_days" INTEGER NOT NULL DEFAULT 3,
    "retention_months" INTEGER NOT NULL DEFAULT 6,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_settings_pkey" PRIMARY KEY ("property_id")
);

-- AddForeignKey
ALTER TABLE "request_settings" ADD CONSTRAINT "request_settings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "request_settings"
  ADD CONSTRAINT "request_settings_expiry" CHECK ("expiry_days" BETWEEN 1 AND 30),
  ADD CONSTRAINT "request_settings_retention" CHECK ("retention_months" BETWEEN 1 AND 36);
