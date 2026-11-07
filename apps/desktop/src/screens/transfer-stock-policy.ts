import type { DesktopTransferMode } from '../db/schema';

export type TransferModeSelection = DesktopTransferMode | '';
export type TransferStockBucket = 'full' | 'empty';

export function transferBucketConsumesStock(
  mode: TransferModeSelection,
  bucket: TransferStockBucket
): boolean {
  if (!mode || mode === 'SUPPLIER_RESTOCK_IN') {
    return false;
  }
  if (mode === 'CREATE' || mode === 'CONVERT') {
    return bucket === 'empty';
  }
  if (mode === 'USED') {
    return bucket === 'full';
  }
  return true;
}

export function hasConsumableTransferStock(
  mode: TransferModeSelection,
  availableFull: number,
  availableEmpty: number
): boolean {
  return (
    (transferBucketConsumesStock(mode, 'full') && availableFull > 0.0001) ||
    (transferBucketConsumesStock(mode, 'empty') && availableEmpty > 0.0001)
  );
}

export function canSelectTransferProduct(
  mode: TransferModeSelection,
  requiresSourceStockCheck: boolean,
  availableFull: number,
  availableEmpty: number
): boolean {
  if (!requiresSourceStockCheck) {
    return true;
  }
  if (mode === 'CREATE' || mode === 'USED' || mode === 'CONVERT') {
    return true;
  }
  return hasConsumableTransferStock(mode, availableFull, availableEmpty);
}
