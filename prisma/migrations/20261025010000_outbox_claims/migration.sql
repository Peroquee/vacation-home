-- The outbox claims rows instead of holding them locked while it sends
-- (GitLab #134): a run marks the rows it takes with `claimed_until`, commits,
-- and only then talks to the mail server. Until then no other run takes
-- them; after it, a run that died half-way no longer holds them up.
ALTER TABLE "email_outbox" ADD COLUMN "claimed_until" TIMESTAMP(3);

-- The outbox writes its times itself, in UTC like every other time the app
-- writes. These defaults took the database server's own timezone, which put
-- every new email hours into the future on a server not set to UTC.
ALTER TABLE "email_outbox"
  ALTER COLUMN "next_attempt_at" DROP DEFAULT,
  ALTER COLUMN "created_at" DROP DEFAULT;
