-- CreateTable
CREATE TABLE "TenantDatastoreRegistry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "datastoreRef" TEXT NOT NULL,
    "encryptedUrl" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantDatastoreRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantDatastoreRegistry_companyId_datastoreRef_key" ON "TenantDatastoreRegistry"("companyId", "datastoreRef");

-- CreateIndex
CREATE INDEX "TenantDatastoreRegistry_datastoreRef_idx" ON "TenantDatastoreRegistry"("datastoreRef");

-- CreateIndex
CREATE INDEX "TenantDatastoreRegistry_companyId_updatedAt_idx" ON "TenantDatastoreRegistry"("companyId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TenantDatastoreRegistry" ADD CONSTRAINT "TenantDatastoreRegistry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
