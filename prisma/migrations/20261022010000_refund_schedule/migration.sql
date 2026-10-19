-- A refund schedule for the deposit (GitLab #123): free until some months
-- before arrival, then a share kept that rises day by day, as
-- {"freeMonthsBefore", "rampMonths", "startPercent", "endPercent"}
-- (src/lib/cancellation/policy.ts; validated by the API). NULL: the whole
-- deposit is kept, as before (#116). Bookings keep the schedule they were
-- requested under, in their cancellation_policy snapshot.
ALTER TABLE "payment_terms" ADD COLUMN "refund_schedule" JSONB;
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_refund_schedule_object"
  CHECK ("refund_schedule" IS NULL OR jsonb_typeof("refund_schedule") = 'object');
