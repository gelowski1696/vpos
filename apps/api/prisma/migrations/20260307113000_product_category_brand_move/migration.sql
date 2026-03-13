ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "category" TEXT,
ADD COLUMN IF NOT EXISTS "brand" TEXT;

UPDATE "Product" AS p
SET "brand" = ct."brand"
FROM "CylinderType" AS ct
WHERE p."cylinderTypeId" = ct."id"
  AND (p."brand" IS NULL OR btrim(p."brand") = '');

ALTER TABLE "CylinderType"
DROP COLUMN IF EXISTS "brand";
