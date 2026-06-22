-- Create tenant-wide POS settings policy table.
CREATE TABLE "CompanyPosSettings" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "reportsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "inventoryReportsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "customersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "itemsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "transferEnabled" BOOLEAN NOT NULL DEFAULT true,
  "lendingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "expenseEnabled" BOOLEAN NOT NULL DEFAULT true,
  "shiftEnabled" BOOLEAN NOT NULL DEFAULT true,
  "settingsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "purchaseOrdersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "deliveryDispatchEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyPosSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPosSettings_companyId_key" ON "CompanyPosSettings"("companyId");
CREATE INDEX "CompanyPosSettings_companyId_updatedAt_idx" ON "CompanyPosSettings"("companyId", "updatedAt");

ALTER TABLE "CompanyPosSettings"
  ADD CONSTRAINT "CompanyPosSettings_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
