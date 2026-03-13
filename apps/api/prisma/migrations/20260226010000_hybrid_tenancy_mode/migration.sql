DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenancyDatastoreMode') THEN
    CREATE TYPE "TenancyDatastoreMode" AS ENUM ('SHARED_DB', 'DEDICATED_DB');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenancyMigrationState') THEN
    CREATE TYPE "TenancyMigrationState" AS ENUM ('NONE', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
  END IF;
END$$;

ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "datastoreMode" "TenancyDatastoreMode" NOT NULL DEFAULT 'SHARED_DB',
  ADD COLUMN IF NOT EXISTS "datastoreRef" TEXT,
  ADD COLUMN IF NOT EXISTS "datastoreMigrationState" "TenancyMigrationState" NOT NULL DEFAULT 'NONE';

CREATE INDEX IF NOT EXISTS "Company_datastoreMode_idx" ON "Company"("datastoreMode");
