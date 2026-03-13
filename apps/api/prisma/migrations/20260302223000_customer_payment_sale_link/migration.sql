-- AlterTable
ALTER TABLE "CustomerPayment"
ADD COLUMN "saleId" TEXT;

-- CreateIndex
CREATE INDEX "CustomerPayment_companyId_saleId_postedAt_idx"
ON "CustomerPayment"("companyId", "saleId", "postedAt");

-- AddForeignKey
ALTER TABLE "CustomerPayment"
ADD CONSTRAINT "CustomerPayment_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
