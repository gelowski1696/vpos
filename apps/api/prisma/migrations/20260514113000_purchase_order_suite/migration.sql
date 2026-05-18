DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'PurchaseOrderStatus'
  ) THEN
    CREATE TYPE "PurchaseOrderStatus" AS ENUM (
      'DRAFT',
      'SUBMITTED',
      'PARTIALLY_RECEIVED',
      'COMPLETED',
      'CANCELLED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdByUserId" TEXT,
  "submittedByUserId" TEXT,
  "completedByUserId" TEXT,
  "cancelledByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderedQty" DECIMAL(14,4) NOT NULL,
  "receivedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderReceipt" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "receivedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderReceiptLine" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "ledgerReferenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderPullout" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "pulledOutByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderPullout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderPulloutLine" (
  "id" TEXT NOT NULL,
  "pulloutId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unitCost" DECIMAL(14,4) NOT NULL,
  "ledgerReferenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderPulloutLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseOrderAttachment" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "sourceChannel" TEXT,
  "retentionUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_companyId_poNumber_key"
  ON "PurchaseOrder"("companyId", "poNumber");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_companyId_status_createdAt_idx"
  ON "PurchaseOrder"("companyId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_companyId_supplierId_createdAt_idx"
  ON "PurchaseOrder"("companyId", "supplierId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_companyId_branchId_createdAt_idx"
  ON "PurchaseOrder"("companyId", "branchId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx"
  ON "PurchaseOrderLine"("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_companyId_productId_idx"
  ON "PurchaseOrderLine"("companyId", "productId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderReceipt_companyId_createdAt_idx"
  ON "PurchaseOrderReceipt"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderReceipt_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderReceipt"("purchaseOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderReceiptLine_receiptId_createdAt_idx"
  ON "PurchaseOrderReceiptLine"("receiptId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderReceiptLine_purchaseOrderLineId_idx"
  ON "PurchaseOrderReceiptLine"("purchaseOrderLineId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderReceiptLine_companyId_productId_idx"
  ON "PurchaseOrderReceiptLine"("companyId", "productId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderPullout_companyId_createdAt_idx"
  ON "PurchaseOrderPullout"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderPullout_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderPullout"("purchaseOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderPulloutLine_pulloutId_createdAt_idx"
  ON "PurchaseOrderPulloutLine"("pulloutId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderPulloutLine_purchaseOrderLineId_idx"
  ON "PurchaseOrderPulloutLine"("purchaseOrderLineId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderPulloutLine_companyId_productId_idx"
  ON "PurchaseOrderPulloutLine"("companyId", "productId");

CREATE INDEX IF NOT EXISTS "PurchaseOrderAttachment_companyId_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderAttachment"("companyId", "purchaseOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseOrderAttachment_companyId_createdAt_idx"
  ON "PurchaseOrderAttachment"("companyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrder_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrder"
      ADD CONSTRAINT "PurchaseOrder_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrder_branchId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrder"
      ADD CONSTRAINT "PurchaseOrder_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrder_locationId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrder"
      ADD CONSTRAINT "PurchaseOrder_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrder_supplierId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrder"
      ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderLine_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderLine"
      ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderLine_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderLine"
      ADD CONSTRAINT "PurchaseOrderLine_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderLine_productId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderLine"
      ADD CONSTRAINT "PurchaseOrderLine_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceipt_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceipt"
      ADD CONSTRAINT "PurchaseOrderReceipt_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceipt_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceipt"
      ADD CONSTRAINT "PurchaseOrderReceipt_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceipt_locationId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceipt"
      ADD CONSTRAINT "PurchaseOrderReceipt_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceiptLine_receiptId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceiptLine"
      ADD CONSTRAINT "PurchaseOrderReceiptLine_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "PurchaseOrderReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceiptLine_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceiptLine"
      ADD CONSTRAINT "PurchaseOrderReceiptLine_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceiptLine_purchaseOrderLineId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceiptLine"
      ADD CONSTRAINT "PurchaseOrderReceiptLine_purchaseOrderLineId_fkey"
      FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderReceiptLine_productId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderReceiptLine"
      ADD CONSTRAINT "PurchaseOrderReceiptLine_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPullout_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPullout"
      ADD CONSTRAINT "PurchaseOrderPullout_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPullout_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPullout"
      ADD CONSTRAINT "PurchaseOrderPullout_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPullout_locationId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPullout"
      ADD CONSTRAINT "PurchaseOrderPullout_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPulloutLine_pulloutId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPulloutLine"
      ADD CONSTRAINT "PurchaseOrderPulloutLine_pulloutId_fkey"
      FOREIGN KEY ("pulloutId") REFERENCES "PurchaseOrderPullout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPulloutLine_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPulloutLine"
      ADD CONSTRAINT "PurchaseOrderPulloutLine_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPulloutLine_purchaseOrderLineId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPulloutLine"
      ADD CONSTRAINT "PurchaseOrderPulloutLine_purchaseOrderLineId_fkey"
      FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderPulloutLine_productId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderPulloutLine"
      ADD CONSTRAINT "PurchaseOrderPulloutLine_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderAttachment_purchaseOrderId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderAttachment"
      ADD CONSTRAINT "PurchaseOrderAttachment_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderAttachment_companyId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderAttachment"
      ADD CONSTRAINT "PurchaseOrderAttachment_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
