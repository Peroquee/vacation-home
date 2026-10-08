-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('income', 'expense');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "transaction_type" NOT NULL,
    "color" CHAR(7) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_key" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "booking_id" UUID,
    "type" "transaction_type" NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_system_key_key" ON "categories"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "categories_id_type_key" ON "categories"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_type_name_key" ON "categories"("type", "name");

-- CreateIndex
CREATE INDEX "transactions_property_id_date_idx" ON "transactions"("property_id", "date");

-- CreateIndex
CREATE INDEX "transactions_booking_id_idx" ON "transactions"("booking_id");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_id_property_id_key" ON "bookings"("id", "property_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_type_fkey" FOREIGN KEY ("category_id", "type") REFERENCES "categories"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_booking_id_property_id_fkey" FOREIGN KEY ("booking_id", "property_id") REFERENCES "bookings"("id", "property_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants, held by the database as well as the API.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "categories_color_format" CHECK ("color" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "categories_system_key_iff_system" CHECK ("is_system" = ("system_key" IS NOT NULL));

ALTER TABLE "transactions"
  -- Positive: the type gives the direction.
  ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "transactions_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

-- The default categories. Their names and colours are a starting point and
-- may be changed; their system_key is how the app finds them.
INSERT INTO "categories" ("name", "type", "color", "is_system", "system_key", "updated_at") VALUES
  ('Booking income', 'income',  '#0f766e', true, 'booking_income', now()),
  ('Cleaning fees',  'income',  '#14b8a6', true, 'cleaning_fees',  now()),
  ('Other income',   'income',  '#5eead4', true, 'other_income',   now()),
  ('Cleaning',       'expense', '#7c3aed', true, 'cleaning',       now()),
  ('Maintenance',    'expense', '#db2777', true, 'maintenance',    now()),
  ('Utilities',      'expense', '#ea580c', true, 'utilities',      now()),
  ('Platform fees',  'expense', '#ca8a04', true, 'platform_fees',  now()),
  ('Supplies',       'expense', '#65a30d', true, 'supplies',       now()),
  ('Insurance',      'expense', '#0284c7', true, 'insurance',      now()),
  ('Taxes',          'expense', '#4f46e5', true, 'taxes',          now()),
  ('Other expenses', 'expense', '#64748b', true, 'other_expenses', now());

-- System categories can be hidden, never deleted, and stay system categories.
CREATE FUNCTION "categories_protect_system"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."is_system" THEN
    RAISE EXCEPTION 'system_category: "%" is a system category; hide it instead', OLD."name"
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."is_system" <> NEW."is_system"
                           OR OLD."system_key" IS DISTINCT FROM NEW."system_key"
                           OR OLD."type" <> NEW."type") THEN
    RAISE EXCEPTION 'system_category: a category''s system flag, key and type cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "categories_system_protected"
  BEFORE UPDATE OR DELETE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "categories_protect_system"();
