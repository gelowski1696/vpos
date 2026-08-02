-- CreateEnum
CREATE TYPE "public"."PersonnelSalaryType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY', 'PER_TRANSACTION');

-- AlterTable
ALTER TABLE "public"."Personnel"
ADD COLUMN "salaryType" "public"."PersonnelSalaryType" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "salaryRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "commissionEligible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Product"
ADD COLUMN "pickupCommissionRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "deliveryCommissionRate" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."SalePersonnelCommission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "personnelId" TEXT,
    "personnelCodeSnapshot" TEXT,
    "personnelNameSnapshot" TEXT NOT NULL,
    "personnelRoleSnapshot" TEXT,
    "saleType" "public"."SaleType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "commissionRate" DECIMAL(12,2) NOT NULL,
    "splitPercent" DECIMAL(7,4) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePersonnelCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalePersonnelCommission_companyId_saleId_idx" ON "public"."SalePersonnelCommission"("companyId", "saleId");

-- CreateIndex
CREATE INDEX "SalePersonnelCommission_companyId_personnelId_createdAt_idx" ON "public"."SalePersonnelCommission"("companyId", "personnelId", "createdAt");

-- CreateIndex
CREATE INDEX "SalePersonnelCommission_saleLineId_idx" ON "public"."SalePersonnelCommission"("saleLineId");

-- AddForeignKey
ALTER TABLE "public"."SalePersonnelCommission" ADD CONSTRAINT "SalePersonnelCommission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalePersonnelCommission" ADD CONSTRAINT "SalePersonnelCommission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalePersonnelCommission" ADD CONSTRAINT "SalePersonnelCommission_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "public"."SaleLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalePersonnelCommission" ADD CONSTRAINT "SalePersonnelCommission_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalePersonnelCommission" ADD CONSTRAINT "SalePersonnelCommission_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "public"."Personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
