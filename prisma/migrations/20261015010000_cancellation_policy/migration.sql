-- Cancellation policy and guest cancellations (GitLab #116).

-- The emails for a cancellation (GitLab #111); only added here, not used.
ALTER TYPE "booking_event_kind" ADD VALUE 'cancelled';

-- CreateEnum
CREATE TYPE "cancelled_by" AS ENUM ('guest', 'owner');

-- The policy, per property with the payment terms: is the deposit kept
-- when a guest cancels? Anything paid beyond it is refunded in full; there
-- is no fee and no tier by days. A property without terms of its own: yes.
ALTER TABLE "payment_terms" ADD COLUMN "deposit_non_refundable" BOOLEAN NOT NULL DEFAULT true;

-- On the booking: the policy the guest agreed to, as
-- {"depositNonRefundable": bool, "depositAmountMinor": int} (taken when
-- they sent the request, or when a booking without one is reserved or
-- made), and who cancelled, when, and what is to be paid back.
ALTER TABLE "bookings"
  ADD COLUMN "cancellation_policy" JSONB,
  ADD COLUMN "cancelled_by" "cancelled_by",
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "refund_due_minor" INTEGER;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_refund_due" CHECK ("refund_due_minor" >= 0),
  ADD CONSTRAINT "bookings_cancellation_policy" CHECK (jsonb_typeof("cancellation_policy") = 'object');
