-- No two CONFIRMED bookings of the same property may share a night.
--
-- Enforced by PostgreSQL itself, so it holds under any concurrency: of two
-- simultaneous requests for overlapping dates, exactly one commits. Per
-- property (`property_id WITH =`), so different properties can be booked for
-- the same dates. The stay is half-open, `[check_in, check_out)`, so a guest
-- may arrive on the day another leaves. Inquiries and cancelled bookings are
-- outside the WHERE clause and never block.
--
-- Blocks live in their own table and cannot be part of this constraint;
-- the triggers further down cover bookings against blocks.
--
-- btree_gist lets the GiST index compare the uuid with `=`. It is a trusted
-- extension, so the database owner can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_confirmed"
  EXCLUDE USING gist (
    "property_id" WITH =,
    daterange("check_in", "check_out", '[)') WITH &&
  )
  WHERE ("status" = 'confirmed');

-- Bookings against blocks. A constraint cannot span two tables, so triggers
-- enforce it, and they take the property row lock themselves: concurrent
-- writers of the same property queue up, and each check sees what the one
-- before it committed. The rule therefore holds for every write, whether or
-- not the application remembered to lock. Violations are raised as
-- exclusion_violation (23P01) naming "bookings_blocks_no_overlap".
CREATE FUNCTION "assert_no_booking_block_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash uuid;
BEGIN
  -- FOR NO KEY UPDATE serialises these checks per property without
  -- blocking the foreign-key checks of unrelated inserts.
  PERFORM 1 FROM "properties" WHERE "id" = NEW."property_id" FOR NO KEY UPDATE;

  IF TG_TABLE_NAME = 'bookings' THEN
    IF NEW."status" <> 'confirmed' THEN
      RETURN NEW;
    END IF;
    SELECT "id" INTO clash FROM "blocks"
      WHERE "property_id" = NEW."property_id"
        AND daterange("start_date", "end_date", '[)')
            && daterange(NEW."check_in", NEW."check_out", '[)')
      LIMIT 1;
  ELSE
    SELECT "id" INTO clash FROM "bookings"
      WHERE "property_id" = NEW."property_id"
        AND "status" = 'confirmed'
        AND daterange("check_in", "check_out", '[)')
            && daterange(NEW."start_date", NEW."end_date", '[)')
      LIMIT 1;
  END IF;

  IF clash IS NOT NULL THEN
    -- The name leads the message as well: the driver passes the message on,
    -- but not the CONSTRAINT field.
    RAISE EXCEPTION 'bookings_blocks_no_overlap: dates overlap % on the same property', clash
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'bookings_blocks_no_overlap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bookings_no_block_overlap"
  BEFORE INSERT OR UPDATE OF "property_id", "check_in", "check_out", "status" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "assert_no_booking_block_overlap"();

CREATE TRIGGER "blocks_no_booking_overlap"
  BEFORE INSERT OR UPDATE OF "property_id", "start_date", "end_date" ON "blocks"
  FOR EACH ROW EXECUTE FUNCTION "assert_no_booking_block_overlap"();
