ALTER TABLE "Sale"
ADD COLUMN "recreatedFromSaleId" TEXT,
ADD COLUMN "recreatedBySaleId" TEXT;

CREATE UNIQUE INDEX "Sale_recreatedBySaleId_key" ON "Sale"("recreatedBySaleId");
CREATE INDEX "Sale_companyId_recreatedFromSaleId_idx" ON "Sale"("companyId", "recreatedFromSaleId");
CREATE INDEX "Sale_companyId_recreatedBySaleId_idx" ON "Sale"("companyId", "recreatedBySaleId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_recreatedFromSaleId_fkey"
FOREIGN KEY ("recreatedFromSaleId") REFERENCES "Sale"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_recreatedBySaleId_fkey"
FOREIGN KEY ("recreatedBySaleId") REFERENCES "Sale"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
