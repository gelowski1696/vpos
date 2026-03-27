-- CreateEnum
CREATE TYPE "public"."SaleStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'VOIDED');

-- AlterTable
ALTER TABLE "public"."Sale"
ADD COLUMN "status" "public"."SaleStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByUserId" TEXT,
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedByUserId" TEXT,
ADD COLUMN "voidReason" TEXT;

-- CreateIndex
CREATE INDEX "Sale_companyId_status_createdAt_idx" ON "public"."Sale"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_companyId_branchId_status_createdAt_idx" ON "public"."Sale"("companyId", "branchId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Sale" ADD CONSTRAINT "Sale_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Sale" ADD CONSTRAINT "Sale_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
