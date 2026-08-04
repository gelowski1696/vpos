CREATE TABLE "DeliveryLocationPing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "riderUserId" TEXT,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy" DECIMAL(10,2),
    "heading" DECIMAL(10,2),
    "speed" DECIMAL(10,2),
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocationPing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryLocationPing_companyId_deliveryOrderId_recordedAt_idx" ON "DeliveryLocationPing"("companyId", "deliveryOrderId", "recordedAt");
CREATE INDEX "DeliveryLocationPing_companyId_riderUserId_recordedAt_idx" ON "DeliveryLocationPing"("companyId", "riderUserId", "recordedAt");

ALTER TABLE "DeliveryLocationPing" ADD CONSTRAINT "DeliveryLocationPing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryLocationPing" ADD CONSTRAINT "DeliveryLocationPing_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
