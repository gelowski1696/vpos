-- CreateTable
CREATE TABLE "public"."VcardPointsPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "earnPesoPerPoint" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "redeemPesoPerPoint" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "minSpendForEarn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxRedeemPointsPerTxn" INTEGER,
    "pointsExpiryDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VcardPointsPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VcardPointsPolicy_companyId_key" ON "public"."VcardPointsPolicy"("companyId");

-- AddForeignKey
ALTER TABLE "public"."VcardPointsPolicy" ADD CONSTRAINT "VcardPointsPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
