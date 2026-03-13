CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "locationId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactPerson" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Supplier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_companyId_code_key" ON "Supplier"("companyId", "code");
CREATE INDEX IF NOT EXISTS "Supplier_companyId_updatedAt_idx" ON "Supplier"("companyId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Supplier_companyId_locationId_idx" ON "Supplier"("companyId", "locationId");
