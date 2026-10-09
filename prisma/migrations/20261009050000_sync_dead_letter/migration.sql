-- AlterEnum
ALTER TYPE "calendar_sync_state" ADD VALUE 'dead';

-- AlterTable
ALTER TABLE "calendar_event_links" ADD COLUMN     "failing_since" TIMESTAMP(3);
