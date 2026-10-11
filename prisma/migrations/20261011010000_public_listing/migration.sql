-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "publicly_listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "properties_slug_key" ON "properties"("slug");

-- Invariants of the public booking site (GitLab #105): a slug is lowercase
-- letters and digits in hyphen-separated runs, 3 to 60 characters, so it is
-- safe in a URL as it stands; and a property is listed only with a slug.
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_slug_format" CHECK (
    "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 60
  ),
  ADD CONSTRAINT "properties_listed_has_slug" CHECK (NOT "publicly_listed" OR "slug" IS NOT NULL);
