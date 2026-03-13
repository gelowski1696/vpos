-- CreateEnum
CREATE TYPE "TransferMode" AS ENUM (
  'SUPPLIER_RESTOCK_IN',
  'SUPPLIER_RESTOCK_OUT',
  'INTER_STORE_TRANSFER',
  'STORE_TO_WAREHOUSE',
  'WAREHOUSE_TO_STORE',
  'GENERAL'
);

-- AlterTable
ALTER TABLE "StockTransfer"
ADD COLUMN "transferMode" "TransferMode" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "supplierId" TEXT,
ADD COLUMN "supplierName" TEXT,
ADD COLUMN "sourceLocationLabel" TEXT,
ADD COLUMN "destinationLocationLabel" TEXT;

-- Index for transfer mode filtering in list/report workloads
CREATE INDEX "StockTransfer_companyId_transferMode_createdAt_idx"
ON "StockTransfer"("companyId", "transferMode", "createdAt");

