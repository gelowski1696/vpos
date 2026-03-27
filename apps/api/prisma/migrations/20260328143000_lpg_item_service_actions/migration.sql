-- CreateEnum
CREATE TYPE "LpgItemServiceActionType" AS ENUM ('DISPOSE', 'REPLACE', 'JUNK');

-- CreateTable
CREATE TABLE "LpgItemServiceAction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "actionType" "LpgItemServiceActionType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "referenceActionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LpgItemServiceAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LpgItemServiceAction_companyId_createdAt_idx" ON "LpgItemServiceAction"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LpgItemServiceAction_companyId_branchId_createdAt_idx" ON "LpgItemServiceAction"("companyId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "LpgItemServiceAction_companyId_locationId_createdAt_idx" ON "LpgItemServiceAction"("companyId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "LpgItemServiceAction_companyId_productId_createdAt_idx" ON "LpgItemServiceAction"("companyId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "LpgItemServiceAction_companyId_actionType_createdAt_idx" ON "LpgItemServiceAction"("companyId", "actionType", "createdAt");

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_referenceActionId_fkey" FOREIGN KEY ("referenceActionId") REFERENCES "LpgItemServiceAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpgItemServiceAction" ADD CONSTRAINT "LpgItemServiceAction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
