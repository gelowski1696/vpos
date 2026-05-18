DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceListVersionStatus') THEN
    CREATE TYPE "PriceListVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActorChannel') THEN
    CREATE TYPE "ActorChannel" AS ENUM ('WEB', 'MOBILE', 'DESKTOP', 'SYNC', 'API');
  END IF;
END $$;

ALTER TABLE "PriceList"
ADD COLUMN IF NOT EXISTS "activeVersionId" TEXT;

CREATE TABLE IF NOT EXISTS "PriceListVersion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "status" "PriceListVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "basedOnVersionId" TEXT,
  "publishedFromVersionId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "notes" TEXT,
  "rollbackReason" TEXT,
  "createdByUserId" TEXT,
  "publishedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceListVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PriceListVersionRule" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "priceListVersionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "flowMode" "PriceFlowMode" NOT NULL DEFAULT 'ANY',
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "unitCost" DECIMAL(14,4),
  "discountCapPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceListVersionRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PriceListRollbackAudit" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "fromVersionId" TEXT NOT NULL,
  "toVersionId" TEXT NOT NULL,
  "reason" TEXT,
  "triggeredByUserId" TEXT,
  "channel" "ActorChannel" NOT NULL DEFAULT 'API',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceListRollbackAudit_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceList_activeVersionId_fkey'
  ) THEN
    ALTER TABLE "PriceList"
    ADD CONSTRAINT "PriceList_activeVersionId_fkey"
    FOREIGN KEY ("activeVersionId") REFERENCES "PriceListVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListVersion_companyId_fkey'
  ) THEN
    ALTER TABLE "PriceListVersion"
    ADD CONSTRAINT "PriceListVersion_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListVersion_priceListId_fkey'
  ) THEN
    ALTER TABLE "PriceListVersion"
    ADD CONSTRAINT "PriceListVersion_priceListId_fkey"
    FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListVersionRule_companyId_fkey'
  ) THEN
    ALTER TABLE "PriceListVersionRule"
    ADD CONSTRAINT "PriceListVersionRule_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListVersionRule_priceListVersionId_fkey'
  ) THEN
    ALTER TABLE "PriceListVersionRule"
    ADD CONSTRAINT "PriceListVersionRule_priceListVersionId_fkey"
    FOREIGN KEY ("priceListVersionId") REFERENCES "PriceListVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListVersionRule_productId_fkey'
  ) THEN
    ALTER TABLE "PriceListVersionRule"
    ADD CONSTRAINT "PriceListVersionRule_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListRollbackAudit_companyId_fkey'
  ) THEN
    ALTER TABLE "PriceListRollbackAudit"
    ADD CONSTRAINT "PriceListRollbackAudit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListRollbackAudit_priceListId_fkey'
  ) THEN
    ALTER TABLE "PriceListRollbackAudit"
    ADD CONSTRAINT "PriceListRollbackAudit_priceListId_fkey"
    FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListRollbackAudit_fromVersionId_fkey'
  ) THEN
    ALTER TABLE "PriceListRollbackAudit"
    ADD CONSTRAINT "PriceListRollbackAudit_fromVersionId_fkey"
    FOREIGN KEY ("fromVersionId") REFERENCES "PriceListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PriceListRollbackAudit_toVersionId_fkey'
  ) THEN
    ALTER TABLE "PriceListRollbackAudit"
    ADD CONSTRAINT "PriceListRollbackAudit_toVersionId_fkey"
    FOREIGN KEY ("toVersionId") REFERENCES "PriceListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PriceListVersion_priceListId_versionNo_key"
ON "PriceListVersion"("priceListId", "versionNo");

CREATE INDEX IF NOT EXISTS "PriceListVersion_companyId_status_effectiveFrom_idx"
ON "PriceListVersion"("companyId", "status", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "PriceListVersion_companyId_createdAt_idx"
ON "PriceListVersion"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "PriceListVersionRule_companyId_productId_flowMode_priority_idx"
ON "PriceListVersionRule"("companyId", "productId", "flowMode", "priority");

CREATE INDEX IF NOT EXISTS "PriceListVersionRule_priceListVersionId_productId_idx"
ON "PriceListVersionRule"("priceListVersionId", "productId");

CREATE INDEX IF NOT EXISTS "PriceListRollbackAudit_companyId_priceListId_createdAt_idx"
ON "PriceListRollbackAudit"("companyId", "priceListId", "createdAt");

INSERT INTO "PriceListVersion" (
  "id",
  "companyId",
  "priceListId",
  "versionNo",
  "status",
  "effectiveFrom",
  "effectiveTo",
  "createdAt",
  "publishedAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  pl."companyId",
  pl."id",
  1,
  'PUBLISHED'::"PriceListVersionStatus",
  pl."startsAt",
  pl."endsAt",
  pl."createdAt",
  pl."createdAt",
  pl."updatedAt"
FROM "PriceList" pl
WHERE NOT EXISTS (
  SELECT 1
  FROM "PriceListVersion" pv
  WHERE pv."priceListId" = pl."id"
);

INSERT INTO "PriceListVersionRule" (
  "id",
  "companyId",
  "priceListVersionId",
  "productId",
  "flowMode",
  "unitPrice",
  "unitCost",
  "discountCapPct",
  "priority",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  pr."companyId",
  pv."id",
  pr."productId",
  pr."flowMode",
  pr."unitPrice",
  COALESCE(pr."unitCost", p."standardCost"),
  pr."discountCapPct",
  pr."priority",
  NOW(),
  NOW()
FROM "PriceRule" pr
JOIN "PriceListVersion" pv
  ON pv."priceListId" = pr."priceListId"
  AND pv."versionNo" = 1
LEFT JOIN "Product" p
  ON p."id" = pr."productId"
  AND p."companyId" = pr."companyId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "PriceListVersionRule" pvr
  WHERE pvr."priceListVersionId" = pv."id"
    AND pvr."productId" = pr."productId"
    AND pvr."flowMode" = pr."flowMode"
    AND pvr."priority" = pr."priority"
);

UPDATE "PriceList" pl
SET "activeVersionId" = pv."id"
FROM (
  SELECT DISTINCT ON (v."priceListId")
    v."priceListId",
    v."id"
  FROM "PriceListVersion" v
  WHERE v."status" = 'PUBLISHED'::"PriceListVersionStatus"
  ORDER BY v."priceListId", v."versionNo" DESC
) pv
WHERE pl."id" = pv."priceListId"
  AND pl."activeVersionId" IS NULL;

UPDATE "PriceList" pl
SET "activeVersionId" = pv."id"
FROM (
  SELECT DISTINCT ON (v."priceListId")
    v."priceListId",
    v."id"
  FROM "PriceListVersion" v
  ORDER BY v."priceListId", v."versionNo" DESC
) pv
WHERE pl."id" = pv."priceListId"
  AND pl."activeVersionId" IS NULL;
