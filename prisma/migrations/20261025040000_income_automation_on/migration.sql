-- Booking income on by default (GitLab #137): every property without
-- settings gets them, switched on. A property switched off on purpose stays
-- off. Bookings confirmed so far get their entries from
-- `npm run income:backfill`, after its dry run.
INSERT INTO "income_automation" ("property_id", "enabled", "on_cancel", "updated_at")
SELECT p."id", true, 'delete', CURRENT_TIMESTAMP
FROM "properties" p
WHERE NOT EXISTS (SELECT 1 FROM "income_automation" a WHERE a."property_id" = p."id");
