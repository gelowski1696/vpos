ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "addonCustomerPricelistView" BOOLEAN NOT NULL DEFAULT false;
