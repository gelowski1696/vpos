DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceFlowMode') THEN
    CREATE TYPE "PriceFlowMode" AS ENUM ('ANY', 'REFILL_EXCHANGE', 'NON_REFILL');
  END IF;
END $$;

ALTER TABLE "PriceRule"
ADD COLUMN IF NOT EXISTS "flowMode" "PriceFlowMode" NOT NULL DEFAULT 'ANY';

CREATE INDEX IF NOT EXISTS "PriceRule_companyId_productId_flowMode_priority_idx"
ON "PriceRule"("companyId", "productId", "flowMode", "priority");
