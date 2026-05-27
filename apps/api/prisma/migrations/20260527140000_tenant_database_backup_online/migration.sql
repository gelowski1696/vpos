CREATE TABLE IF NOT EXISTS "TenantDatabaseBackup" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "label" TEXT,
  "retentionMonths" INTEGER NOT NULL DEFAULT 3,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "tableCount" INTEGER NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantDatabaseBackup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TenantDatabaseBackup"
  ADD COLUMN IF NOT EXISTS "retentionMonths" INTEGER,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

UPDATE "TenantDatabaseBackup"
SET
  "retentionMonths" = COALESCE("retentionMonths", 3),
  "expiresAt" = COALESCE("expiresAt", ("createdAt" + INTERVAL '3 months'));

ALTER TABLE "TenantDatabaseBackup"
  ALTER COLUMN "retentionMonths" SET NOT NULL,
  ALTER COLUMN "retentionMonths" SET DEFAULT 3,
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "TenantDatabaseBackup_companyId_createdAt_idx"
  ON "TenantDatabaseBackup"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "TenantDatabaseBackup_companyId_expiresAt_idx"
  ON "TenantDatabaseBackup"("companyId", "expiresAt");

CREATE INDEX IF NOT EXISTS "TenantDatabaseBackup_companyId_createdByUserId_createdAt_idx"
  ON "TenantDatabaseBackup"("companyId", "createdByUserId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TenantDatabaseBackup_companyId_fkey'
  ) THEN
    ALTER TABLE "TenantDatabaseBackup"
      ADD CONSTRAINT "TenantDatabaseBackup_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TenantDatabaseBackup_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "TenantDatabaseBackup"
      ADD CONSTRAINT "TenantDatabaseBackup_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
