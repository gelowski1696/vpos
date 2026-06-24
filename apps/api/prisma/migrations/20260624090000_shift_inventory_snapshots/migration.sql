ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "openingInventorySnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "closingInventorySnapshot" JSONB;
