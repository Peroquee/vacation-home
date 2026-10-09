-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "ical_export_token" TEXT;

-- AlterTable
ALTER TABLE "blocks" ADD COLUMN     "feed_id" UUID;

-- CreateTable
CREATE TABLE "ical_feeds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "next_fetch_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_fetched_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "conflict_count" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "last_modified" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ical_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ical_feeds_property_id_idx" ON "ical_feeds"("property_id");

-- CreateIndex
CREATE INDEX "ical_feeds_next_fetch_at_idx" ON "ical_feeds"("next_fetch_at");

-- CreateIndex
CREATE UNIQUE INDEX "properties_ical_export_token_key" ON "properties"("ical_export_token");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "ical_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants. Every imported block names its event; only an iCal block, and
-- every iCal block, names its feed.
ALTER TABLE "blocks"
  DROP CONSTRAINT "blocks_external_event_matches_origin",
  ADD CONSTRAINT "blocks_external_event_matches_origin" CHECK (
    ("origin" <> 'manual') = ("external_event_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "blocks_feed_matches_origin" CHECK (
    ("origin" = 'ical') = ("feed_id" IS NOT NULL)
  );

ALTER TABLE "ical_feeds"
  ADD CONSTRAINT "ical_feeds_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "ical_feeds_url_is_http" CHECK ("url" ~ '^https?://');
