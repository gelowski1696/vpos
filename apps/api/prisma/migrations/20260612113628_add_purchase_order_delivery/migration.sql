-- CreateEnum
CREATE TYPE "PurchaseOrderPulloutReason" AS ENUM ('EXPIRED', 'DAMAGED', 'WRONG_ITEM', 'OVERDELIVERY', 'EMPTIES', 'OTHER');

-- DropIndex
DROP INDEX "DeliveryOrder_cashierValidatedByUserId_idx";

-- AlterTable
ALTER TABLE "CustomerCategory" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DeliveryOrder" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MobileEnrollmentToken" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PriceListVersion" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PriceListVersionRule" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrderPullout" ADD COLUMN     "deliveryId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderPulloutLine" ADD COLUMN     "pulloutReason" "PurchaseOrderPulloutReason";

-- AlterTable
ALTER TABLE "PurchaseOrderReceipt" ADD COLUMN     "deliveryId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PurchaseOrderDelivery" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "postedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderDelivery_companyId_createdAt_idx" ON "PurchaseOrderDelivery"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderDelivery_purchaseOrderId_createdAt_idx" ON "PurchaseOrderDelivery"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderPullout_deliveryId_idx" ON "PurchaseOrderPullout"("deliveryId");

-- CreateIndex
CREATE INDEX "PurchaseOrderReceipt_deliveryId_idx" ON "PurchaseOrderReceipt"("deliveryId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderReceipt" ADD CONSTRAINT "PurchaseOrderReceipt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "PurchaseOrderDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPullout" ADD CONSTRAINT "PurchaseOrderPullout_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "PurchaseOrderDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDelivery" ADD CONSTRAINT "PurchaseOrderDelivery_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDelivery" ADD CONSTRAINT "PurchaseOrderDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDelivery" ADD CONSTRAINT "PurchaseOrderDelivery_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
