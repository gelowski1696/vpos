-- AlterEnum
ALTER TYPE "public"."CustomerPointsSourceType" ADD VALUE IF NOT EXISTS 'REWARD';

-- CreateEnum
CREATE TYPE "public"."RewardType" AS ENUM ('DISCOUNT_FIXED', 'DISCOUNT_PERCENT', 'FREE_PRODUCT', 'FREE_DELIVERY', 'FREE_SERVICE', 'FREE_REFILL', 'VOUCHER');

-- CreateEnum
CREATE TYPE "public"."RewardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."RewardRedemptionStatus" AS ENUM ('RESERVED', 'APPLIED', 'CANCELLED', 'VOIDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "public"."RedeemableReward" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rewardType" "public"."RewardType" NOT NULL,
    "status" "public"."RewardStatus" NOT NULL DEFAULT 'DRAFT',
    "pointsCost" INTEGER NOT NULL,
    "productId" TEXT,
    "freeQty" DECIMAL(12,2),
    "discountValue" DECIMAL(12,2),
    "minSpend" DECIMAL(12,2),
    "maxDiscountAmount" DECIMAL(12,2),
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "perCustomerLimit" INTEGER,
    "dailyLimit" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedeemableReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RedeemableRewardScope" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemableRewardScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerRewardRedemption" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cardInventoryId" TEXT,
    "rewardId" TEXT NOT NULL,
    "saleId" TEXT,
    "status" "public"."RewardRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "pointsSpent" INTEGER NOT NULL,
    "valueApplied" DECIMAL(12,2),
    "remarks" TEXT,
    "metadata" JSONB,
    "redeemedByUserId" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedeemableReward_companyId_code_key" ON "public"."RedeemableReward"("companyId", "code");

-- CreateIndex
CREATE INDEX "RedeemableReward_companyId_status_updatedAt_idx" ON "public"."RedeemableReward"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RedeemableReward_companyId_rewardType_status_updatedAt_idx" ON "public"."RedeemableReward"("companyId", "rewardType", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RedeemableRewardScope_rewardId_createdAt_idx" ON "public"."RedeemableRewardScope"("rewardId", "createdAt");

-- CreateIndex
CREATE INDEX "RedeemableRewardScope_branchId_locationId_idx" ON "public"."RedeemableRewardScope"("branchId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemableRewardScope_rewardId_branchId_locationId_key" ON "public"."RedeemableRewardScope"("rewardId", "branchId", "locationId");

-- CreateIndex
CREATE INDEX "CustomerRewardRedemption_companyId_customerId_redeemedAt_idx" ON "public"."CustomerRewardRedemption"("companyId", "customerId", "redeemedAt");

-- CreateIndex
CREATE INDEX "CustomerRewardRedemption_companyId_rewardId_redeemedAt_idx" ON "public"."CustomerRewardRedemption"("companyId", "rewardId", "redeemedAt");

-- CreateIndex
CREATE INDEX "CustomerRewardRedemption_companyId_status_redeemedAt_idx" ON "public"."CustomerRewardRedemption"("companyId", "status", "redeemedAt");

-- CreateIndex
CREATE INDEX "CustomerRewardRedemption_cardInventoryId_redeemedAt_idx" ON "public"."CustomerRewardRedemption"("cardInventoryId", "redeemedAt");

-- AddForeignKey
ALTER TABLE "public"."RedeemableReward" ADD CONSTRAINT "RedeemableReward_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RedeemableReward" ADD CONSTRAINT "RedeemableReward_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RedeemableReward" ADD CONSTRAINT "RedeemableReward_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RedeemableRewardScope" ADD CONSTRAINT "RedeemableRewardScope_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "public"."RedeemableReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RedeemableRewardScope" ADD CONSTRAINT "RedeemableRewardScope_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RedeemableRewardScope" ADD CONSTRAINT "RedeemableRewardScope_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerRewardRedemption" ADD CONSTRAINT "CustomerRewardRedemption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerRewardRedemption" ADD CONSTRAINT "CustomerRewardRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerRewardRedemption" ADD CONSTRAINT "CustomerRewardRedemption_cardInventoryId_fkey" FOREIGN KEY ("cardInventoryId") REFERENCES "public"."CardInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerRewardRedemption" ADD CONSTRAINT "CustomerRewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "public"."RedeemableReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerRewardRedemption" ADD CONSTRAINT "CustomerRewardRedemption_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
