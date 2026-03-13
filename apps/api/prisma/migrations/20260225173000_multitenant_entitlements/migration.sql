-- Create enums for entitlement domain.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementStatus') THEN
    CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementBranchMode') THEN
    CREATE TYPE "EntitlementBranchMode" AS ENUM ('SINGLE', 'MULTI');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementInventoryMode') THEN
    CREATE TYPE "EntitlementInventoryMode" AS ENUM ('STORE_ONLY', 'STORE_WAREHOUSE');
  END IF;
END$$;

-- Company linkage to external subscription client/tenant.
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "externalClientId" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "entitlementUpdatedAt" TIMESTAMP(3);

-- Backfill external client id from tenant code.
UPDATE "Company"
SET "externalClientId" = "code"
WHERE "externalClientId" IS NULL;

-- Uniqueness for external tenant mapping.
CREATE UNIQUE INDEX IF NOT EXISTS "Company_externalClientId_key" ON "Company"("externalClientId");

-- Current entitlement snapshot per company.
CREATE TABLE IF NOT EXISTS "CompanyEntitlement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "externalClientId" TEXT NOT NULL,
  "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "maxBranches" INTEGER NOT NULL DEFAULT 1,
  "branchMode" "EntitlementBranchMode" NOT NULL DEFAULT 'SINGLE',
  "inventoryMode" "EntitlementInventoryMode" NOT NULL DEFAULT 'STORE_ONLY',
  "allowDelivery" BOOLEAN NOT NULL DEFAULT false,
  "allowTransfers" BOOLEAN NOT NULL DEFAULT false,
  "allowMobile" BOOLEAN NOT NULL DEFAULT true,
  "graceUntil" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyEntitlement_companyId_key" ON "CompanyEntitlement"("companyId");
CREATE INDEX IF NOT EXISTS "CompanyEntitlement_externalClientId_status_idx" ON "CompanyEntitlement"("externalClientId", "status");

ALTER TABLE "CompanyEntitlement"
  ADD CONSTRAINT "CompanyEntitlement_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only entitlement change log.
CREATE TABLE IF NOT EXISTS "CompanyEntitlementEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entitlementId" TEXT,
  "externalEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'WEBHOOK',
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyEntitlementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyEntitlementEvent_externalEventId_key" ON "CompanyEntitlementEvent"("externalEventId");
CREATE INDEX IF NOT EXISTS "CompanyEntitlementEvent_companyId_createdAt_idx" ON "CompanyEntitlementEvent"("companyId", "createdAt");

ALTER TABLE "CompanyEntitlementEvent"
  ADD CONSTRAINT "CompanyEntitlementEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyEntitlementEvent"
  ADD CONSTRAINT "CompanyEntitlementEvent_entitlementId_fkey"
  FOREIGN KEY ("entitlementId") REFERENCES "CompanyEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

