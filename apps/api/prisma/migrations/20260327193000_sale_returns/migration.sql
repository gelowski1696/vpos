-- CreateEnum
CREATE TYPE "public"."SaleReturnStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "public"."SaleReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "public"."SaleReturnStatus" NOT NULL DEFAULT 'POSTED',
    "reason" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "pointsReversed" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SaleReturnLine" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleReturn_companyId_saleId_createdAt_idx" ON "public"."SaleReturn"("companyId", "saleId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_companyId_branchId_createdAt_idx" ON "public"."SaleReturn"("companyId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_companyId_customerId_createdAt_idx" ON "public"."SaleReturn"("companyId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnLine_saleReturnId_idx" ON "public"."SaleReturnLine"("saleReturnId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_saleId_saleLineId_idx" ON "public"."SaleReturnLine"("saleId", "saleLineId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_productId_idx" ON "public"."SaleReturnLine"("productId");

-- AddForeignKey
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturn" ADD CONSTRAINT "SaleReturn_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "public"."SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "public"."Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "public"."SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
