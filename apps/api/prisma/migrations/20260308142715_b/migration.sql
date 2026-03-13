-- DropIndex
DROP INDEX "Company_datastoreMode_idx";

-- DropIndex
DROP INDEX "PriceRule_companyId_productId_priority_idx";

-- AlterTable
ALTER TABLE "ProductBrand" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductCategory" ALTER COLUMN "updatedAt" DROP DEFAULT;
