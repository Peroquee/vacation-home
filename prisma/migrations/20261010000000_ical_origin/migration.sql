-- AlterEnum
-- On their own: Postgres cannot use a new enum value in the transaction that
-- adds it, and the next migration's constraints name both.
ALTER TYPE "block_origin" ADD VALUE 'ical';

-- AlterEnum
ALTER TYPE "calendar_sync_issue_kind" ADD VALUE 'ical_overlap';
