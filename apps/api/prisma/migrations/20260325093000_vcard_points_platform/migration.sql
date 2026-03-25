-- CreateEnum
CREATE TYPE "public"."CardInventoryStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'INACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."CardTagType" AS ENUM ('NFC', 'RFID_UID');

-- CreateEnum
CREATE TYPE "public"."CustomerCardStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."CustomerPointsTxnType" AS ENUM ('EARN', 'REDEEM', 'ADJUST_UP', 'ADJUST_DOWN', 'EXPIRE');

-- CreateEnum
CREATE TYPE "public"."CustomerPointsSourceType" AS ENUM ('SALE', 'MANUAL', 'SYSTEM');

-- AlterTable
ALTER TABLE "public"."Customer"
ADD COLUMN "pointsBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."CardInventory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationId" TEXT,
    "cardUid" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "serialNumber" TEXT,
    "cardUrl" TEXT,
    "status" "public"."CardInventoryStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "tagType" "public"."CardTagType" NOT NULL DEFAULT 'NFC',
    "writable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "assignedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerCard" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cardInventoryId" TEXT NOT NULL,
    "status" "public"."CustomerCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerPointsLedger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cardInventoryId" TEXT,
    "txnType" "public"."CustomerPointsTxnType" NOT NULL,
    "sourceType" "public"."CustomerPointsSourceType" NOT NULL,
    "sourceId" TEXT,
    "points" INTEGER NOT NULL,
    "remarks" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardInventory_companyId_cardUid_key" ON "public"."CardInventory"("companyId", "cardUid");

-- CreateIndex
CREATE UNIQUE INDEX "CardInventory_companyId_cardNumber_key" ON "public"."CardInventory"("companyId", "cardNumber");

-- CreateIndex
CREATE INDEX "CardInventory_companyId_status_updatedAt_idx" ON "public"."CardInventory"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CardInventory_companyId_branchId_locationId_status_idx" ON "public"."CardInventory"("companyId", "branchId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCard_cardInventoryId_key" ON "public"."CustomerCard"("cardInventoryId");

-- CreateIndex
CREATE INDEX "CustomerCard_companyId_customerId_status_updatedAt_idx" ON "public"."CustomerCard"("companyId", "customerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CustomerCard_companyId_status_updatedAt_idx" ON "public"."CustomerCard"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CustomerPointsLedger_companyId_customerId_createdAt_idx" ON "public"."CustomerPointsLedger"("companyId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerPointsLedger_companyId_txnType_createdAt_idx" ON "public"."CustomerPointsLedger"("companyId", "txnType", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerPointsLedger_cardInventoryId_createdAt_idx" ON "public"."CustomerPointsLedger"("cardInventoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."CardInventory" ADD CONSTRAINT "CardInventory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CardInventory" ADD CONSTRAINT "CardInventory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CardInventory" ADD CONSTRAINT "CardInventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerCard" ADD CONSTRAINT "CustomerCard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerCard" ADD CONSTRAINT "CustomerCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerCard" ADD CONSTRAINT "CustomerCard_cardInventoryId_fkey" FOREIGN KEY ("cardInventoryId") REFERENCES "public"."CardInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerCard" ADD CONSTRAINT "CustomerCard_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerPointsLedger" ADD CONSTRAINT "CustomerPointsLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerPointsLedger" ADD CONSTRAINT "CustomerPointsLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerPointsLedger" ADD CONSTRAINT "CustomerPointsLedger_cardInventoryId_fkey" FOREIGN KEY ("cardInventoryId") REFERENCES "public"."CardInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerPointsLedger" ADD CONSTRAINT "CustomerPointsLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
