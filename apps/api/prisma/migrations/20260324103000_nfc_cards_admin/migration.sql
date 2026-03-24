-- CreateEnum
CREATE TYPE "public"."NfcCardOwnerType" AS ENUM ('USER');

-- CreateEnum
CREATE TYPE "public"."NfcCardStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."NfcCardEventType" AS ENUM ('BIND', 'REASSIGN', 'DEACTIVATE', 'REACTIVATE', 'REVOKE');

-- CreateTable
CREATE TABLE "public"."NfcCard" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "ownerType" "public"."NfcCardOwnerType" NOT NULL DEFAULT 'USER',
    "ownerId" TEXT NOT NULL,
    "status" "public"."NfcCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfcCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NfcCardEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "eventType" "public"."NfcCardEventType" NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NfcCardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NfcCard_companyId_uid_key" ON "public"."NfcCard"("companyId", "uid");

-- CreateIndex
CREATE INDEX "NfcCard_companyId_status_updatedAt_idx" ON "public"."NfcCard"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "NfcCard_companyId_ownerId_status_idx" ON "public"."NfcCard"("companyId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "NfcCardEvent_companyId_createdAt_idx" ON "public"."NfcCardEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "NfcCardEvent_cardId_createdAt_idx" ON "public"."NfcCardEvent"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."NfcCard" ADD CONSTRAINT "NfcCard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NfcCard" ADD CONSTRAINT "NfcCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NfcCardEvent" ADD CONSTRAINT "NfcCardEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NfcCardEvent" ADD CONSTRAINT "NfcCardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "public"."NfcCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NfcCardEvent" ADD CONSTRAINT "NfcCardEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
