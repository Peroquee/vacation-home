-- A platform feed may no longer free many dates at once, or free the dates
-- of a stay it can't read (GitLab #144). The feed keeps what it held back
-- and what it couldn't read, for the settings page.
ALTER TABLE "ical_feeds"
  ADD COLUMN "dropped_event_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "held_removals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "held_since" TIMESTAMP(3);
