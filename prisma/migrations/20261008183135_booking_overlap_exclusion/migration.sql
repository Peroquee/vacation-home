-- No two CONFIRMED bookings of the same property may share a night.
--
-- Enforced by PostgreSQL itself, so it holds under any concurrency: of two
-- simultaneous requests for overlapping dates, exactly one commits. Per
-- property (`property_id WITH =`), so different properties can be booked for
-- the same dates. The stay is half-open, `[check_in, check_out)`, so a guest
-- may arrive on the day another leaves. Inquiries and cancelled bookings are
-- outside the WHERE clause and never block.
--
-- Blocks live in their own table and cannot be part of this constraint; the
-- availability service checks them while holding a lock on the property row
-- (src/lib/availability/service.ts).
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
