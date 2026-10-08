-- CreateEnum
CREATE TYPE "calendar_sync_state" AS ENUM ('pending', 'synced', 'failed', 'pending_delete');

-- CreateTable
CREATE TABLE "calendar_event_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID,
    "block_id" UUID,
    "calendar_id" TEXT NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "etag" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "sync_state" "calendar_sync_state" NOT NULL DEFAULT 'pending',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_event_links_sync_state_idx" ON "calendar_event_links"("sync_state");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_calendar_id_google_event_id_key" ON "calendar_event_links"("calendar_id", "google_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_booking_id_calendar_id_key" ON "calendar_event_links"("booking_id", "calendar_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_links_block_id_calendar_id_key" ON "calendar_event_links"("block_id", "calendar_id");

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A link points at exactly one booking or block - or, once that is deleted,
-- at nothing, and then only to get the Google event deleted.
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_one_target"
  CHECK (
    num_nonnulls("booking_id", "block_id") = 1
    OR (num_nonnulls("booking_id", "block_id") = 0 AND "sync_state" = 'pending_delete')
  );

-- Event ids the app chooses: Google's base32hex alphabet, 5 to 1024 characters.
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_event_id_format"
  CHECK ("google_event_id" ~ '^[a-v0-9]+$' AND length("google_event_id") BETWEEN 5 AND 1024);

-- Deleting the booking or block sets its foreign key to null (ON DELETE SET
-- NULL); this turns that into "delete the remote event".
CREATE FUNCTION calendar_event_links_target_deleted() RETURNS trigger AS $$
BEGIN
  IF NEW."booking_id" IS NULL AND NEW."block_id" IS NULL
     AND (OLD."booking_id" IS NOT NULL OR OLD."block_id" IS NOT NULL) THEN
    NEW."sync_state" := 'pending_delete';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_event_links_target_deleted"
  BEFORE UPDATE OF "booking_id", "block_id" ON "calendar_event_links"
  FOR EACH ROW EXECUTE FUNCTION calendar_event_links_target_deleted();
