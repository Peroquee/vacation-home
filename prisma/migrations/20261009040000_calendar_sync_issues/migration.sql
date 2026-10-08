-- CreateEnum
CREATE TYPE "calendar_sync_issue_kind" AS ENUM ('inbound_overlap');

-- CreateTable
CREATE TABLE "calendar_sync_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "kind" "calendar_sync_issue_kind" NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "booking_ids" UUID[],
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sync_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_sync_issues_property_id_resolved_at_idx" ON "calendar_sync_issues"("property_id", "resolved_at");

-- AddForeignKey
ALTER TABLE "calendar_sync_issues" ADD CONSTRAINT "calendar_sync_issues_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one open issue per event and kind; a resolved one is history.
CREATE UNIQUE INDEX "calendar_sync_issues_one_open"
  ON "calendar_sync_issues" ("property_id", "google_event_id", "kind")
  WHERE "resolved_at" IS NULL;

ALTER TABLE "calendar_sync_issues"
  ADD CONSTRAINT "calendar_sync_issues_resolution" CHECK (
    ("resolved_at" IS NULL AND "resolution" IS NULL)
    OR ("resolved_at" IS NOT NULL AND "resolution" IN ('gone', 'dismissed'))
  );
