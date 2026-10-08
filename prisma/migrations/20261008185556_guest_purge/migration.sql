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
ALTER TABLE "guests"
  ADD CONSTRAINT "guests_purged_hold_no_personal_data" CHECK (
    "purged_at" IS NULL OR ("email" IS NULL AND "phone" IS NULL AND "notes" IS NULL)
  );

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
