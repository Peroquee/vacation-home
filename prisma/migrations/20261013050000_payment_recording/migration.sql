-- Payment recording (GitLab #115): bank transfer details, payments on a
-- booking, their ledger entries, and the guest's link to their booking.

-- Events for the emails (GitLab #111); only added here, not used.
ALTER TYPE "booking_event_kind" ADD VALUE 'deposit_received';
ALTER TYPE "booking_event_kind" ADD VALUE 'fully_paid';

-- CreateTable: where guests transfer to, per property.
CREATE TABLE "bank_details" (
    "property_id" UUID NOT NULL,
    "account_holder" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "bank_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_details_pkey" PRIMARY KEY ("property_id")
);

ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Stored as validated (src/lib/payments/iban.ts): no spaces, upper case.
-- The holder fits a GiroCode (70 characters).
ALTER TABLE "bank_details"
  ADD CONSTRAINT "bank_details_iban" CHECK ("iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  ADD CONSTRAINT "bank_details_bic" CHECK ("bic" ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  ADD CONSTRAINT "bank_details_holder" CHECK (char_length("account_holder") BETWEEN 1 AND 70),
  ADD CONSTRAINT "bank_details_bank_name" CHECK (char_length("bank_name") <= 100);

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('deposit', 'balance', 'full', 'other', 'refund');
CREATE TYPE "payment_method" AS ENUM ('bank_transfer', 'cash', 'card', 'other');

-- CreateTable: money received for a booking, or paid back (a refund). The
-- amount is always positive; the kind says which way.
CREATE TABLE "booking_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "method" "payment_method" NOT NULL DEFAULT 'bank_transfer',
    "amount_minor" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_payments_booking_id_idx" ON "booking_payments"("booking_id");

-- Restrict: a booking with payments is an accounting record.
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_payments"
  ADD CONSTRAINT "booking_payments_amount" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "booking_payments_note" CHECK (char_length("note") <= 500);

-- A payment's ledger entry: income, a refund negative income. One each;
-- the entry goes with the payment.
ALTER TABLE "transactions" ADD COLUMN "payment_id" UUID;
CREATE UNIQUE INDEX "transactions_payment_id_key" ON "transactions"("payment_id");
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "booking_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A refund is income given back: a negative income entry in the payment's
-- own category, so revenue is net of it and costs are untouched. Only a
-- payment's entry may be negative.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_positive";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK (
  "amount_minor" > 0
  OR ("amount_minor" = 0 AND "generated" IS NOT NULL)
  OR ("amount_minor" < 0 AND "payment_id" IS NOT NULL AND "type" = 'income')
);

-- CreateTable: links that let a guest see their booking (status, what to
-- pay, the bank details). Only a hash of each token is stored: the token
-- itself (128 random bits) exists only in the link given to the guest.
-- Never the booking's reference, which is printed on transfers.
CREATE TABLE "guest_access_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guest_access_tokens_token_hash_key" ON "guest_access_tokens"("token_hash");
CREATE INDEX "guest_access_tokens_booking_id_idx" ON "guest_access_tokens"("booking_id");

ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_access_tokens"
  ADD CONSTRAINT "guest_access_tokens_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- /stay/booking/<token> is the guest's page: "booking" can never be a slug.
ALTER TABLE "properties" DROP CONSTRAINT "properties_slug_not_reserved";
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_slug_not_reserved" CHECK ("slug" NOT IN ('legal', 'booking'));
