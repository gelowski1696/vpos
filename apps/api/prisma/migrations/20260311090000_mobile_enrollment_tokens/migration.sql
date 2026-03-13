CREATE TABLE IF NOT EXISTS "MobileEnrollmentToken" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "claimedDeviceId" TEXT,
  "claimedIp" TEXT,
  "claimedUserAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobileEnrollmentToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MobileEnrollmentToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MobileEnrollmentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MobileEnrollmentToken_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MobileEnrollmentToken_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MobileEnrollmentToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileEnrollmentToken_tokenHash_key" ON "MobileEnrollmentToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "MobileEnrollmentToken_companyId_userId_createdAt_idx" ON "MobileEnrollmentToken"("companyId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "MobileEnrollmentToken_companyId_expiresAt_usedAt_revokedAt_idx" ON "MobileEnrollmentToken"("companyId", "expiresAt", "usedAt", "revokedAt");
