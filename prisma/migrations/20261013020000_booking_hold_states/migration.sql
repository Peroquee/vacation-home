-- The booking flow by nights (GitLab #114): requested (inquiry) ->
-- reserved -> confirmed -> paid, or expired. On their own: a new enum value
-- cannot be used in the transaction that adds it, and the next migration
-- uses them.
ALTER TYPE "booking_status" ADD VALUE 'reserved' BEFORE 'confirmed';
ALTER TYPE "booking_status" ADD VALUE 'paid' AFTER 'confirmed';
ALTER TYPE "booking_status" ADD VALUE 'expired' AFTER 'paid';
