ALTER TYPE "public"."CylinderStatus" ADD VALUE IF NOT EXISTS 'JUNKED';
ALTER TYPE "public"."CylinderStatus" ADD VALUE IF NOT EXISTS 'DISPOSED';

ALTER TYPE "public"."CylinderEventType" ADD VALUE IF NOT EXISTS 'JUNK';
ALTER TYPE "public"."CylinderEventType" ADD VALUE IF NOT EXISTS 'DISPOSE';
ALTER TYPE "public"."CylinderEventType" ADD VALUE IF NOT EXISTS 'REPLACE';

CREATE TYPE "public"."CylinderServiceActionType" AS ENUM ('JUNK', 'DISPOSE', 'REPLACE');

CREATE TABLE "public"."CylinderServiceAction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "actionType" "public"."CylinderServiceActionType" NOT NULL,
    "sourceCylinderId" TEXT,
    "replacementCylinderId" TEXT,
    "customerId" TEXT,
    "saleId" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CylinderServiceAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CylinderServiceAction_companyId_actionType_createdAt_idx" ON "public"."CylinderServiceAction"("companyId", "actionType", "createdAt");
CREATE INDEX "CylinderServiceAction_companyId_branchId_createdAt_idx" ON "public"."CylinderServiceAction"("companyId", "branchId", "createdAt");
CREATE INDEX "CylinderServiceAction_companyId_sourceCylinderId_createdAt_idx" ON "public"."CylinderServiceAction"("companyId", "sourceCylinderId", "createdAt");
CREATE INDEX "CylinderServiceAction_companyId_replacementCylinderId_createdAt_idx" ON "public"."CylinderServiceAction"("companyId", "replacementCylinderId", "createdAt");

ALTER TABLE "public"."CylinderServiceAction" ADD CONSTRAINT "CylinderServiceAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CylinderServiceAction" ADD CONSTRAINT "CylinderServiceAction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."CylinderServiceAction" ADD CONSTRAINT "CylinderServiceAction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."CylinderServiceAction" ADD CONSTRAINT "CylinderServiceAction_sourceCylinderId_fkey" FOREIGN KEY ("sourceCylinderId") REFERENCES "public"."Cylinder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."CylinderServiceAction" ADD CONSTRAINT "CylinderServiceAction_replacementCylinderId_fkey" FOREIGN KEY ("replacementCylinderId") REFERENCES "public"."Cylinder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
