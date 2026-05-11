CREATE TABLE IF NOT EXISTS "PettyCashAttachment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "pettyCashEntryId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "sourceChannel" TEXT,
  "retentionUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PettyCashAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PettyCashAttachment_companyId_pettyCashEntryId_createdAt_idx"
  ON "PettyCashAttachment"("companyId", "pettyCashEntryId", "createdAt");

CREATE INDEX IF NOT EXISTS "PettyCashAttachment_companyId_createdAt_idx"
  ON "PettyCashAttachment"("companyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PettyCashAttachment_companyId_fkey'
  ) THEN
    ALTER TABLE "PettyCashAttachment"
      ADD CONSTRAINT "PettyCashAttachment_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PettyCashAttachment_pettyCashEntryId_fkey'
  ) THEN
    ALTER TABLE "PettyCashAttachment"
      ADD CONSTRAINT "PettyCashAttachment_pettyCashEntryId_fkey"
      FOREIGN KEY ("pettyCashEntryId") REFERENCES "PettyCashEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
