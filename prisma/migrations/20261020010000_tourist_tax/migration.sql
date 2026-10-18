-- The Kurtaxe (GitLab #120): rules per property, the guests by age group
-- on a booking, and a pass-through ledger category.

-- The pass-through entry of the income automation.
ALTER TYPE "generated_entry" ADD VALUE 'booking_tourist_tax';

-- A property's Kurtaxe rules, as src/lib/pricing/tourist-tax.ts reads
-- them (validated by src/lib/pricing/schema.ts). No row: no Kurtaxe.
CREATE TABLE "property_tourist_tax" (
    "property_id" UUID NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_tourist_tax_pkey" PRIMARY KEY ("property_id"),
    CONSTRAINT "property_tourist_tax_rules_object" CHECK (jsonb_typeof("rules") = 'object')
);

ALTER TABLE "property_tourist_tax" ADD CONSTRAINT "property_tourist_tax_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- On the booking: who stays by age group ({"adults": n, "children":
-- [{"fromAge", "toAge", "count"}]}; NULL: guest_count adults, as before),
-- the Kurtaxe in its total (copied from the breakdown, for the ledger and
-- the reports), and the owner's own amount for it with a note (an
-- exemption or reduction; NULL: worked out by the rules).
ALTER TABLE "bookings"
  ADD COLUMN "guest_split" JSONB,
  ADD COLUMN "tourist_tax_minor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tourist_tax_manual_minor" INTEGER,
  ADD COLUMN "tourist_tax_note" TEXT;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_guest_split_object"
    CHECK ("guest_split" IS NULL OR jsonb_typeof("guest_split") = 'object'),
  ADD CONSTRAINT "bookings_tourist_tax" CHECK ("tourist_tax_minor" >= 0),
  ADD CONSTRAINT "bookings_tourist_tax_manual"
    CHECK ("tourist_tax_manual_minor" IS NULL OR "tourist_tax_manual_minor" >= 0),
  ADD CONSTRAINT "bookings_tourist_tax_note" CHECK (length("tourist_tax_note") <= 500);

-- Money collected for someone else: income on the books, but not revenue.
-- The dashboard, the PDF report and the nightly figures leave pass-through
-- categories out.
ALTER TABLE "categories" ADD COLUMN "pass_through" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "categories" ("name", "type", "color", "is_system", "system_key", "pass_through", "updated_at")
VALUES ('Kurtaxe (durchlaufend)', 'income', '#a3a3a3', true, 'tourist_tax', true, now());

-- A payment with Kurtaxe in it is entered twice: the owner's part in its
-- category, the Kurtaxe in the pass-through one. So one entry per payment
-- and category, no longer one per payment.
DROP INDEX "transactions_payment_id_key";
CREATE UNIQUE INDEX "transactions_payment_id_category_id_key" ON "transactions"("payment_id", "category_id");
