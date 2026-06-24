ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "addonCashierEndOfDayInventoryCount" BOOLEAN NOT NULL DEFAULT false;
