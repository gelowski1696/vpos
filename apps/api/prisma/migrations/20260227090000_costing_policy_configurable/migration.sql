-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('WAC', 'STANDARD', 'LAST_PURCHASE', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "CostAllocationBasis" AS ENUM ('PER_QUANTITY', 'PER_WEIGHT');

-- CreateEnum
CREATE TYPE "NegativeStockPolicy" AS ENUM ('BLOCK_POSTING', 'ALLOW_WITH_REVIEW');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "standardCost" DECIMAL(14,4);

-- Normalize legacy method values before type conversion
UPDATE "CostingConfig"
SET "method" = 'WAC'
WHERE "method" IS NULL
   OR "method" NOT IN ('WAC', 'STANDARD', 'LAST_PURCHASE', 'MANUAL_OVERRIDE');

-- AlterTable
ALTER TABLE "CostingConfig"
ALTER COLUMN "method" DROP DEFAULT,
ALTER COLUMN "method" TYPE "CostingMethod" USING ("method"::"CostingMethod"),
ALTER COLUMN "method" SET DEFAULT 'WAC',
ADD COLUMN "allowManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "negativeStockPolicy" "NegativeStockPolicy" NOT NULL DEFAULT 'BLOCK_POSTING',
ADD COLUMN "includeFreight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "includeHandling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "includeOtherLandedCost" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allocationBasis" "CostAllocationBasis" NOT NULL DEFAULT 'PER_QUANTITY',
ADD COLUMN "roundingScale" INTEGER NOT NULL DEFAULT 4,
ALTER COLUMN "locked" SET DEFAULT false;
