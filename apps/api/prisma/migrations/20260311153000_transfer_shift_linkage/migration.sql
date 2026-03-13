-- Add shift linkage to transfers so transfer posting can be traced to duty ownership.
ALTER TABLE "public"."StockTransfer"
ADD COLUMN "shiftId" TEXT;

ALTER TABLE "public"."StockTransfer"
ADD CONSTRAINT "StockTransfer_shiftId_fkey"
FOREIGN KEY ("shiftId") REFERENCES "public"."Shift"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "StockTransfer_shiftId_idx" ON "public"."StockTransfer"("shiftId");
