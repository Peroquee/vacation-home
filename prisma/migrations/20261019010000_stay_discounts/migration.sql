-- Length-of-stay discounts (GitLab #119): per property, from a number of
-- nights the nights cost a percentage less. The highest tier a stay
-- reaches applies to its nights' sum (src/lib/pricing/engine.ts); none
-- means no discount. One tier per night count.
CREATE TABLE "property_stay_discounts" (
    "property_id" UUID NOT NULL,
    "min_nights" SMALLINT NOT NULL,
    "percent" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_stay_discounts_pkey" PRIMARY KEY ("property_id", "min_nights"),
    CONSTRAINT "property_stay_discounts_nights" CHECK ("min_nights" BETWEEN 2 AND 365),
    CONSTRAINT "property_stay_discounts_percent" CHECK ("percent" BETWEEN 1 AND 90)
);

ALTER TABLE "property_stay_discounts" ADD CONSTRAINT "property_stay_discounts_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
