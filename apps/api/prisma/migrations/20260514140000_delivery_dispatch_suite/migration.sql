DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryStatus'
      AND e.enumlabel = 'COMPLETE'
  ) THEN
    ALTER TYPE "DeliveryStatus" ADD VALUE 'COMPLETE';
  END IF;
END $$;

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "cashierValidatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cashierValidatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DeliveryStatusEvent"
  ADD COLUMN IF NOT EXISTS "actorUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "DeliveryOrder_companyId_branchId_status_createdAt_idx"
  ON "DeliveryOrder"("companyId", "branchId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "DeliveryOrder_companyId_status_createdAt_idx"
  ON "DeliveryOrder"("companyId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "DeliveryOrder_cashierValidatedByUserId_idx"
  ON "DeliveryOrder"("cashierValidatedByUserId");

CREATE INDEX IF NOT EXISTS "DeliveryStatusEvent_deliveryOrderId_createdAt_idx"
  ON "DeliveryStatusEvent"("deliveryOrderId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DeliveryOrder_cashierValidatedByUserId_fkey'
  ) THEN
    ALTER TABLE "DeliveryOrder"
      ADD CONSTRAINT "DeliveryOrder_cashierValidatedByUserId_fkey"
      FOREIGN KEY ("cashierValidatedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DeliveryStatusEvent_actorUserId_fkey'
  ) THEN
    ALTER TABLE "DeliveryStatusEvent"
      ADD CONSTRAINT "DeliveryStatusEvent_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;