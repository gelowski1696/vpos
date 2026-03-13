CREATE TABLE IF NOT EXISTS "ProductCategory" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductBrand" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductBrand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductBrand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_companyId_code_key" ON "ProductCategory"("companyId", "code");
CREATE INDEX IF NOT EXISTS "ProductCategory_companyId_updatedAt_idx" ON "ProductCategory"("companyId", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductBrand_companyId_code_key" ON "ProductBrand"("companyId", "code");
CREATE INDEX IF NOT EXISTS "ProductBrand_companyId_updatedAt_idx" ON "ProductBrand"("companyId", "updatedAt");
