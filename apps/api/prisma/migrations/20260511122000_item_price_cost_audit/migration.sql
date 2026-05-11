CREATE TABLE IF NOT EXISTS "ItemPriceCostAudit" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "skuSnapshot" TEXT NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "oldPrice" DECIMAL(12,2),
  "newPrice" DECIMAL(12,2),
  "oldCost" DECIMAL(14,4),
  "newCost" DECIMAL(14,4),
  "changeReason" TEXT,
  "changedByUserId" TEXT,
  "changedByRole" TEXT,
  "sourceChannel" TEXT,
  "requestId" TEXT,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ItemPriceCostAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ItemPriceCostAudit_companyId_productId_createdAt_idx"
  ON "ItemPriceCostAudit"("companyId", "productId", "createdAt");

CREATE INDEX IF NOT EXISTS "ItemPriceCostAudit_companyId_createdAt_idx"
  ON "ItemPriceCostAudit"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "ItemPriceCostAudit_companyId_contextType_createdAt_idx"
  ON "ItemPriceCostAudit"("companyId", "contextType", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ItemPriceCostAudit_companyId_fkey'
  ) THEN
    ALTER TABLE "ItemPriceCostAudit"
      ADD CONSTRAINT "ItemPriceCostAudit_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ItemPriceCostAudit_productId_fkey'
  ) THEN
    ALTER TABLE "ItemPriceCostAudit"
      ADD CONSTRAINT "ItemPriceCostAudit_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
