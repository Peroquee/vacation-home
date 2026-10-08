-- DropIndex
DROP INDEX "calendar_event_links_sync_state_idx";

-- AlterTable
ALTER TABLE "calendar_event_links" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "change_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimed_until" TIMESTAMP(3),
ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" UUID;

-- CreateTable
CREATE TABLE "property_calendars" (
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "calendar_name" TEXT,
    "outbound" BOOLEAN NOT NULL DEFAULT true,
    "inbound" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_calendars_pkey" PRIMARY KEY ("property_id")
);

-- CreateIndex
CREATE INDEX "calendar_event_links_sync_state_next_attempt_at_idx" ON "calendar_event_links"("sync_state", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_calendars" ADD CONSTRAINT "property_calendars_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_calendars" ADD CONSTRAINT "property_calendars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

