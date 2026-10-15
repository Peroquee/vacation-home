-- Emails to guests and the owner (GitLab #111), sent from booking events.

-- CreateEnum
CREATE TYPE "email_recipient" AS ENUM ('guest', 'owner');
CREATE TYPE "email_status" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateTable: one row per (event, recipient) - so each event is mailed
-- once to each, whatever runs again. No address, subject or body is kept:
-- the mail is written when it is sent, from the booking as it then is, so
-- the guest's link token never rests here and an erased guest leaves no
-- copy behind.
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "recipient" "email_recipient" NOT NULL,
    "status" "email_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "skip_reason" TEXT,
    "message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_outbox_event_id_recipient_key" ON "email_outbox"("event_id", "recipient");
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_sent" CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL)),
  ADD CONSTRAINT "email_outbox_last_error" CHECK (char_length("last_error") <= 500);

-- AlterTable: what only the guest who has paid in full is told, in the
-- final confirmation - never on the public page.
ALTER TABLE "property_listings" ADD COLUMN "exact_address" TEXT NOT NULL DEFAULT '',
ADD COLUMN "arrival_notes" TEXT NOT NULL DEFAULT '';
