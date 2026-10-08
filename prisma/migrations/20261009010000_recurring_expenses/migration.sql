-- CreateEnum
CREATE TYPE "recurrence_interval" AS ENUM ('monthly', 'quarterly', 'annual');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "recurring_expense_id" UUID;

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL DEFAULT 'expense',
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" "recurrence_interval" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "description" TEXT,
    "next_occurrence" INTEGER NOT NULL DEFAULT 0,
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_expenses_property_id_idx" ON "recurring_expenses"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_recurring_expense_id_date_key" ON "transactions"("recurring_expense_id", "date");

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_property_id_currency_fkey" FOREIGN KEY ("property_id", "currency") REFERENCES "properties"("id", "currency") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_type_fkey" FOREIGN KEY ("category_id", "type") REFERENCES "categories"("id", "type") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recurring_expenses"
  ADD CONSTRAINT "recurring_expenses_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "recurring_expenses_is_expense" CHECK ("type" = 'expense'),
  ADD CONSTRAINT "recurring_expenses_end_after_start" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "recurring_expenses_next_occurrence" CHECK ("next_occurrence" >= 0);
