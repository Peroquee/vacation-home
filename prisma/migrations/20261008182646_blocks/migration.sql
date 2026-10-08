-- CreateEnum
CREATE TYPE "block_origin" AS ENUM ('manual', 'google');

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "origin" "block_origin" NOT NULL DEFAULT 'manual',
    "external_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blocks_property_id_start_date_end_date_idx" ON "blocks"("property_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_property_id_external_event_id_key" ON "blocks"("property_id", "external_event_id");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants, held by the database as well as the API.
ALTER TABLE "blocks"
  ADD CONSTRAINT "blocks_end_after_start" CHECK ("end_date" > "start_date"),
  -- An imported block always names its event; a manual one never does.
  ADD CONSTRAINT "blocks_external_event_matches_origin" CHECK (
    ("origin" = 'google') = ("external_event_id" IS NOT NULL)
  ),
  -- An empty id would make every id-less event "the same" event on re-import.
  ADD CONSTRAINT "blocks_external_event_not_blank" CHECK (btrim("external_event_id") <> '');

COMMENT ON COLUMN "blocks"."end_date" IS
  'EXCLUSIVE, like bookings.check_out: the block covers [start_date, end_date).';
