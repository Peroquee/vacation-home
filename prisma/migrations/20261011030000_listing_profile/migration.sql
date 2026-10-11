-- CreateTable
CREATE TABLE "property_listings" (
    "property_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL DEFAULT '',
    "title_de" TEXT NOT NULL DEFAULT '',
    "description_en" TEXT NOT NULL DEFAULT '',
    "description_de" TEXT NOT NULL DEFAULT '',
    "house_rules_en" TEXT NOT NULL DEFAULT '',
    "house_rules_de" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "max_guests" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "check_in_time" TEXT,
    "check_out_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "property_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "alt_en" TEXT NOT NULL DEFAULT '',
    "alt_de" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_photo_sizes" (
    "photo_id" UUID NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,

    CONSTRAINT "property_photo_sizes_pkey" PRIMARY KEY ("photo_id","width")
);

-- CreateIndex
CREATE INDEX "property_photos_property_id_position_idx" ON "property_photos"("property_id", "position");

-- CreateIndex
CREATE INDEX "property_photo_sizes_sha256_idx" ON "property_photo_sizes"("sha256");

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photo_sizes" ADD CONSTRAINT "property_photo_sizes_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "property_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants (src/lib/listing/schema.ts validates the same).
ALTER TABLE "property_listings"
  ADD CONSTRAINT "property_listings_counts" CHECK (
    ("max_guests" IS NULL OR "max_guests" BETWEEN 1 AND 50)
    AND ("bedrooms" IS NULL OR "bedrooms" BETWEEN 0 AND 50)
    AND ("bathrooms" IS NULL OR "bathrooms" BETWEEN 0 AND 50)
  ),
  ADD CONSTRAINT "property_listings_times" CHECK (
    ("check_in_time" IS NULL OR "check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND ("check_out_time" IS NULL OR "check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  );

ALTER TABLE "property_photo_sizes"
  ADD CONSTRAINT "property_photo_sizes_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "property_photo_sizes_dimensions" CHECK ("width" > 0 AND "height" > 0);
