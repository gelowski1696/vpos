ALTER TYPE "PriceScope" ADD VALUE IF NOT EXISTS 'CUSTOMER_GROUP';

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "addonCustomPricing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "addonCustomerCategory" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CustomerCategory" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCategory_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerCategory"
    ADD CONSTRAINT "CustomerCategory_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerCategory_companyId_code_key"
  ON "CustomerCategory"("companyId", "code");

CREATE INDEX IF NOT EXISTS "CustomerCategory_companyId_updatedAt_idx"
  ON "CustomerCategory"("companyId", "updatedAt");

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "customerCategoryId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_customerCategoryId_fkey"
    FOREIGN KEY ("customerCategoryId") REFERENCES "CustomerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Customer_companyId_customerCategoryId_idx"
  ON "Customer"("companyId", "customerCategoryId");

ALTER TABLE "PriceList"
  ADD COLUMN IF NOT EXISTS "customerCategoryId" TEXT;

DO $$ BEGIN
  ALTER TABLE "PriceList"
    ADD CONSTRAINT "PriceList_customerCategoryId_fkey"
    FOREIGN KEY ("customerCategoryId") REFERENCES "CustomerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PriceList_companyId_customerCategoryId_idx"
  ON "PriceList"("companyId", "customerCategoryId");
