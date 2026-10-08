-- Inbound changes seen before the import existed (GitLab #73) were never
-- turned into blocks: start every watched calendar over with a full list.
UPDATE "calendar_watches" SET "sync_token" = NULL, "next_poll_at" = CURRENT_TIMESTAMP;
