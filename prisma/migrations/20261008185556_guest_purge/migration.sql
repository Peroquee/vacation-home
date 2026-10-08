-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "purged_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_subject_type_subject_id_idx" ON "audit_events"("subject_type", "subject_id");

-- A purged guest holds no personal data, whatever writes to the row later.
-- The placeholder name is fixed in src/lib/guests/purge.ts as well.
ALTER TABLE "guests"
  ADD CONSTRAINT "guests_purged_hold_no_personal_data" CHECK (
    "purged_at" IS NULL OR (
      "name" = 'Deleted guest' AND "email" IS NULL AND "phone" IS NULL AND "notes" IS NULL
    )
  );

-- Nor can personal data reach a purged guest through a booking: no new
-- booking for them, no booking moved to them, no notes written on theirs.
-- The guest row is share-locked first, so a write racing a purge waits for
-- it (the purge holds the row FOR UPDATE) and then sees the outcome.
-- Raised as check_violation with "guest_purged" leading the message, which
-- the driver passes on.
CREATE FUNCTION "bookings_refuse_purged_guest"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  purged timestamp(3);
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."guest_id" = OLD."guest_id"
     AND NEW."notes" IS NOT DISTINCT FROM OLD."notes" THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."guest_id" = OLD."guest_id" AND NEW."notes" IS NULL THEN
    RETURN NEW; -- clearing notes is always allowed; the purge itself does it
  END IF;

  SELECT "purged_at" INTO purged FROM "guests" WHERE "id" = NEW."guest_id" FOR SHARE;
  IF purged IS NOT NULL THEN
    RAISE EXCEPTION 'guest_purged: guest % was erased', NEW."guest_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bookings_no_purged_guest"
  BEFORE INSERT OR UPDATE OF "guest_id", "notes" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "bookings_refuse_purged_guest"();

-- The audit trail is append-only for the application.
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER "audit_events_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
