ALTER TABLE "User" ADD COLUMN "personnelId" TEXT;
ALTER TABLE "User" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "User_companyId_username_key" ON "User"("companyId", "username");
CREATE UNIQUE INDEX "User_companyId_personnelId_key" ON "User"("companyId", "personnelId");
CREATE INDEX "User_companyId_personnelId_updatedAt_idx" ON "User"("companyId", "personnelId", "updatedAt");
