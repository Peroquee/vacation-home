-- AlterEnum
-- On its own: Postgres cannot use a new enum value in the transaction that
-- adds it, and the next migration's constraints name 'ical'.
ALTER TYPE "block_origin" ADD VALUE 'ical';
