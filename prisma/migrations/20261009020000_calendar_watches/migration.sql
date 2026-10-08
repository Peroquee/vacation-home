-- CreateTable
CREATE TABLE "calendar_watches" (
    "property_id" UUID NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "sync_token" TEXT,
    "next_poll_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_polled_at" TIMESTAMP(3),
    "last_full_sync_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_until" TIMESTAMP(3),
    "channel_id" TEXT,
    "channel_resource_id" TEXT,
    "channel_token_hash" TEXT,
    "channel_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_watches_pkey" PRIMARY KEY ("property_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_watches_channel_id_key" ON "calendar_watches"("channel_id");

-- CreateIndex
CREATE INDEX "calendar_watches_next_poll_at_idx" ON "calendar_watches"("next_poll_at");

-- AddForeignKey
ALTER TABLE "calendar_watches" ADD CONSTRAINT "calendar_watches_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
