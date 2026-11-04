import type { DesktopPaymentMode, DesktopSaleRecord } from './schema';

function inferDesktopPaymentMode(record: DesktopSaleRecord): DesktopPaymentMode {
  const total = Number(record.payload.totalAmount ?? 0);
  const paid = Number(record.payload.paidAmount ?? total);
  const creditBalance = Number(record.payload.creditBalance ?? Math.max(0, total - paid));

  if (Number.isFinite(creditBalance) && creditBalance > 0.0001) {
    return 'PARTIAL';
  }

  if (Number.isFinite(total) && Number.isFinite(paid) && paid + 0.0001 < total) {
    return 'PARTIAL';
  }

  return 'FULL';
}

export function normalizeDesktopSaleRecord(record: DesktopSaleRecord): DesktopSaleRecord {
  if (record.payload.paymentMode) {
    return record;
  }

  return {
    ...record,
    payload: {
      ...record.payload,
      paymentMode: inferDesktopPaymentMode(record)
    }
  };
}
