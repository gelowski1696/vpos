-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "public"."CustomerPaymentPurpose" AS ENUM ('SALE_BALANCE', 'LENDING_DEPOSIT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "public"."CustomerPayment"
ADD COLUMN IF NOT EXISTS "purpose" "public"."CustomerPaymentPurpose" NOT NULL DEFAULT 'SALE_BALANCE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerPayment_companyId_purpose_postedAt_idx"
ON "public"."CustomerPayment"("companyId", "purpose", "postedAt");
