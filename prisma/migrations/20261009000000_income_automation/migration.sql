-- CreateEnum
CREATE TYPE "generated_entry" AS ENUM ('booking_accommodation', 'booking_cleaning');

-- CreateEnum
CREATE TYPE "cancelled_income" AS ENUM ('delete', 'zero');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "detached_at" TIMESTAMP(3),
ADD COLUMN     "generated" "generated_entry";

-- CreateTable
CREATE TABLE "income_automation" (
    "property_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "on_cancel" "cancelled_income" NOT NULL DEFAULT 'delete',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_automation_pkey" PRIMARY KEY ("property_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_booking_id_generated_key" ON "transactions"("booking_id", "generated");

-- AddForeignKey
ALTER TABLE "income_automation" ADD CONSTRAINT "income_automation_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A generated entry may be zeroed when its booking is cancelled (when the
-- property's setting says so); every other amount stays positive.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_positive";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive"
  CHECK ("amount_minor" > 0 OR ("amount_minor" = 0 AND "generated" IS NOT NULL));

-- Generated entries belong to a booking.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_generated_has_booking"
  CHECK ("generated" IS NULL OR "booking_id" IS NOT NULL);
