-- The public site's legal pages (GitLab #112): the Impressum and the
-- privacy policy, one set for the whole site. A single row, id 1; no row
-- is the same as nothing filled in. Blank text is stored as NULL.
CREATE TABLE "site_legal" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "imprint_name" TEXT,
    "imprint_address" TEXT,
    "imprint_email" TEXT,
    "imprint_phone" TEXT,
    "imprint_vat_id" TEXT,
    "imprint_extra" TEXT,
    "privacy_policy_de" TEXT,
    "privacy_policy_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_legal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_legal_single_row" CHECK ("id" = 1),
    CONSTRAINT "site_legal_no_blank" CHECK (
      btrim(coalesce("imprint_name", 'x')) <> '' AND
      btrim(coalesce("imprint_address", 'x')) <> '' AND
      btrim(coalesce("imprint_email", 'x')) <> '' AND
      btrim(coalesce("imprint_phone", 'x')) <> '' AND
      btrim(coalesce("imprint_vat_id", 'x')) <> '' AND
      btrim(coalesce("imprint_extra", 'x')) <> '' AND
      btrim(coalesce("privacy_policy_de", 'x')) <> '' AND
      btrim(coalesce("privacy_policy_en", 'x')) <> ''
    )
);

-- Complete: what the public site cannot go live without. Kept in step with
-- legalComplete() in src/lib/legal/legal.ts.
CREATE FUNCTION "site_legal_row_complete"(r "site_legal") RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT r."imprint_name" IS NOT NULL AND r."imprint_address" IS NOT NULL
     AND r."imprint_email" IS NOT NULL
     AND r."privacy_policy_de" IS NOT NULL AND r."privacy_policy_en" IS NOT NULL
$$;

-- The gate holds from the first second: the legal pages start empty, so a
-- property listed before them is unlisted (none in production when this was
-- written). The owner lists it again once they are filled in.
DO $$
DECLARE
  unlisted integer;
BEGIN
  UPDATE "properties" SET "publicly_listed" = false WHERE "publicly_listed";
  GET DIAGNOSTICS unlisted = ROW_COUNT;
  RAISE NOTICE 'legal pages: unlisted % propert(y/ies) until the imprint and privacy policy are filled in', unlisted;
END
$$;

-- The go-live gate, both ways: no property becomes listed while the legal
-- pages are incomplete, and they cannot be emptied while any property is
-- listed (archived ones too: restoring one must not bypass the gate).
-- Both sides take one transaction-level advisory lock - shared for a
-- listing, exclusive for the legal pages - so a listing racing an edit
-- waits for it and then sees its outcome. Raised as check_violation with
-- "legal_required" / "legal_in_use" leading the message, which the driver
-- passes on.
CREATE FUNCTION "properties_require_legal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  complete boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(112112);
  SELECT "site_legal_row_complete"(l) INTO complete FROM "site_legal" l WHERE l."id" = 1;
  IF complete IS NOT TRUE THEN
    RAISE EXCEPTION 'legal_required: the imprint and privacy policy must be filled in before a property is listed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "properties_require_legal_insert"
  BEFORE INSERT ON "properties"
  FOR EACH ROW WHEN (NEW."publicly_listed")
  EXECUTE FUNCTION "properties_require_legal"();

CREATE TRIGGER "properties_require_legal_update"
  BEFORE UPDATE OF "publicly_listed" ON "properties"
  FOR EACH ROW WHEN (NEW."publicly_listed" AND NOT OLD."publicly_listed")
  EXECUTE FUNCTION "properties_require_legal"();

CREATE FUNCTION "site_legal_keep_while_listed"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(112112);
  IF TG_OP <> 'DELETE' AND "site_legal_row_complete"(NEW) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "properties" WHERE "publicly_listed") THEN
    RAISE EXCEPTION 'legal_in_use: the imprint and privacy policy cannot be emptied while a property is listed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER "site_legal_keep_while_listed"
  BEFORE INSERT OR UPDATE OR DELETE ON "site_legal"
  FOR EACH ROW EXECUTE FUNCTION "site_legal_keep_while_listed"();
