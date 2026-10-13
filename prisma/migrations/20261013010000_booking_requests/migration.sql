-- Booking requests from the public site (GitLab #109).
ALTER TYPE "booking_source" ADD VALUE 'website';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "reference" TEXT,
ADD COLUMN     "guest_message" TEXT,
ADD COLUMN     "requester_name" TEXT,
ADD COLUMN     "requester_phone" TEXT,
ADD COLUMN     "guest_locale" TEXT,
ADD COLUMN     "privacy_consent_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- The reference is what the guest quotes (8 characters without the easily
-- confused I, L, O, 0 and 1); a request from the site always has one, and
-- the privacy consent the form asked for. `source::text`: the new enum value
-- cannot be used as such in the transaction that adds it.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_reference_format" CHECK ("reference" ~ '^[A-HJKMNP-Z2-9]{8}$'),
  ADD CONSTRAINT "bookings_guest_locale" CHECK ("guest_locale" IN ('en-GB', 'de-DE')),
  ADD CONSTRAINT "bookings_website_request" CHECK (
    "source"::text <> 'website' OR ("reference" IS NOT NULL AND "privacy_consent_at" IS NOT NULL)
  );

-- "legal" names the public site's legal pages (/stay/legal/...), so it can
-- never be a property's slug.
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_slug_not_reserved" CHECK ("slug" <> 'legal');
