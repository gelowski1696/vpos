-- CreateTable
CREATE TABLE "public"."PersonnelRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Personnel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "personnelRoleId" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelRole_companyId_code_key" ON "public"."PersonnelRole"("companyId", "code");

-- CreateIndex
CREATE INDEX "PersonnelRole_companyId_updatedAt_idx" ON "public"."PersonnelRole"("companyId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Personnel_companyId_code_key" ON "public"."Personnel"("companyId", "code");

-- CreateIndex
CREATE INDEX "Personnel_companyId_branchId_updatedAt_idx" ON "public"."Personnel"("companyId", "branchId", "updatedAt");

-- CreateIndex
CREATE INDEX "Personnel_personnelRoleId_idx" ON "public"."Personnel"("personnelRoleId");

-- AddForeignKey
ALTER TABLE "public"."PersonnelRole" ADD CONSTRAINT "PersonnelRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Personnel" ADD CONSTRAINT "Personnel_personnelRoleId_fkey" FOREIGN KEY ("personnelRoleId") REFERENCES "public"."PersonnelRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
