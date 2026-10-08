-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guests_email_key" ON "guests"("email");

-- CreateIndex
CREATE INDEX "guests_name_idx" ON "guests"("name");

-- Invariants the API validates, held by the database too.
ALTER TABLE "guests"
  ADD CONSTRAINT "guests_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "guests_email_normalised" CHECK ("email" = lower(btrim("email")));
