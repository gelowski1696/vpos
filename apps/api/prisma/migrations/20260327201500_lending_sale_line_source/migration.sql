ALTER TABLE "LendingLine"
ADD COLUMN "sourceSaleLineId" TEXT;

CREATE INDEX "LendingLine_sourceSaleLineId_idx"
ON "LendingLine"("sourceSaleLineId");

ALTER TABLE "LendingLine"
ADD CONSTRAINT "LendingLine_sourceSaleLineId_fkey"
FOREIGN KEY ("sourceSaleLineId") REFERENCES "SaleLine"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
