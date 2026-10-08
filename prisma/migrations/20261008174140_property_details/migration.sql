-- Property details. Hand-edited from the generated migration so that it also
-- applies to a table that already has rows: the new required columns are
-- added with a temporary default to backfill them, which is then dropped, so
-- new rows must always state their own timezone, currency and colour.

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "address" TEXT,
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "color" CHAR(7) NOT NULL DEFAULT '#0f766e',
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
ADD COLUMN     "default_cleaning_fee_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "default_nightly_rate_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "properties" ALTER COLUMN "color" DROP DEFAULT,
ALTER COLUMN "currency" DROP DEFAULT,
ALTER COLUMN "timezone" DROP DEFAULT;

-- Invariants the API validates, held by the database too, so a row written
-- any other way cannot break them. Prisma does not model CHECK constraints;
-- it leaves them alone.
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "properties_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "properties_color_format" CHECK ("color" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "properties_default_nightly_rate_non_negative" CHECK ("default_nightly_rate_minor" >= 0),
  ADD CONSTRAINT "properties_default_cleaning_fee_non_negative" CHECK ("default_cleaning_fee_minor" >= 0);
