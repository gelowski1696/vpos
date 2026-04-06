ALTER TABLE "InventoryBalance"
ADD COLUMN "qtyFull" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN "qtyEmpty" DECIMAL(14,4) NOT NULL DEFAULT 0;

UPDATE "InventoryBalance"
SET
  "qtyFull" = "qtyOnHand",
  "qtyEmpty" = 0;
