
-- CreateTable
CREATE TABLE "transaction_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "thumbnail_sha256" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_attachments_transaction_id_idx" ON "transaction_attachments"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_attachments_sha256_idx" ON "transaction_attachments"("sha256");

-- AddForeignKey
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants: a file is named by its SHA-256, is at most 10 MB, and is one
-- of the types the upload accepts (src/lib/finance/receipts.ts).
ALTER TABLE "transaction_attachments"
  ADD CONSTRAINT "transaction_attachments_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "transaction_attachments_thumbnail_hex" CHECK (
    "thumbnail_sha256" IS NULL OR "thumbnail_sha256" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "transaction_attachments_size" CHECK ("size" > 0 AND "size" <= 10485760),
  ADD CONSTRAINT "transaction_attachments_media_type" CHECK (
    "media_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')
  ),
  ADD CONSTRAINT "transaction_attachments_file_name" CHECK (
    btrim("file_name") <> '' AND length("file_name") <= 200
  );
