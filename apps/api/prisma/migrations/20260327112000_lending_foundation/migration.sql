-- AlterEnum
ALTER TYPE "public"."InventoryMovementType" ADD VALUE IF NOT EXISTS 'LENDING_OUT';

-- AlterEnum
ALTER TYPE "public"."InventoryMovementType" ADD VALUE IF NOT EXISTS 'LENDING_RETURN';

-- CreateEnum
CREATE TYPE "public"."LendingStatus" AS ENUM ('OPEN', 'PARTIALLY_RETURNED', 'CLOSED', 'OVERDUE', 'CANCELLED', 'FORCE_CLOSED');

-- CreateEnum
CREATE TYPE "public"."LendingReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "public"."LendingSettlementType" AS ENUM ('NONE', 'DEPOSIT_HELD', 'CHARGED_TO_CUSTOMER', 'WAIVED', 'WRITE_OFF');

-- AlterTable
ALTER TABLE "public"."Product"
ADD COLUMN "isLendable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requiresReturn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requiresDeposit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "defaultDepositAmount" DECIMAL(12,2),
ADD COLUMN "lendingUnitType" TEXT;

-- CreateTable
CREATE TABLE "public"."LendingTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "status" "public"."LendingStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "remarks" TEXT,
    "settlementType" "public"."LendingSettlementType" NOT NULL DEFAULT 'NONE',
    "settlementAmount" DECIMAL(12,2),
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LendingLine" (
    "id" TEXT NOT NULL,
    "lendingTransactionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityLent" DECIMAL(14,3) NOT NULL,
    "quantityReturned" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "depositAmount" DECIMAL(12,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LendingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LendingReturn" (
    "id" TEXT NOT NULL,
    "lendingTransactionId" TEXT NOT NULL,
    "lendingLineId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "returnedQty" DECIMAL(14,3) NOT NULL,
    "condition" "public"."LendingReturnCondition" NOT NULL DEFAULT 'GOOD',
    "remarks" TEXT,
    "receivedByUserId" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LendingTransaction_companyId_branchId_status_openedAt_idx" ON "public"."LendingTransaction"("companyId", "branchId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "LendingTransaction_companyId_customerId_status_openedAt_idx" ON "public"."LendingTransaction"("companyId", "customerId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "LendingTransaction_companyId_saleId_idx" ON "public"."LendingTransaction"("companyId", "saleId");

-- CreateIndex
CREATE INDEX "LendingLine_companyId_productId_idx" ON "public"."LendingLine"("companyId", "productId");

-- CreateIndex
CREATE INDEX "LendingLine_lendingTransactionId_idx" ON "public"."LendingLine"("lendingTransactionId");

-- CreateIndex
CREATE INDEX "LendingReturn_companyId_returnedAt_idx" ON "public"."LendingReturn"("companyId", "returnedAt");

-- CreateIndex
CREATE INDEX "LendingReturn_lendingTransactionId_idx" ON "public"."LendingReturn"("lendingTransactionId");

-- CreateIndex
CREATE INDEX "LendingReturn_lendingLineId_idx" ON "public"."LendingReturn"("lendingLineId");

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingTransaction" ADD CONSTRAINT "LendingTransaction_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingLine" ADD CONSTRAINT "LendingLine_lendingTransactionId_fkey" FOREIGN KEY ("lendingTransactionId") REFERENCES "public"."LendingTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingLine" ADD CONSTRAINT "LendingLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingLine" ADD CONSTRAINT "LendingLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingReturn" ADD CONSTRAINT "LendingReturn_lendingTransactionId_fkey" FOREIGN KEY ("lendingTransactionId") REFERENCES "public"."LendingTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingReturn" ADD CONSTRAINT "LendingReturn_lendingLineId_fkey" FOREIGN KEY ("lendingLineId") REFERENCES "public"."LendingLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingReturn" ADD CONSTRAINT "LendingReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LendingReturn" ADD CONSTRAINT "LendingReturn_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
