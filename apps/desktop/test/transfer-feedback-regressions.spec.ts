import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canSelectTransferProduct,
  hasConsumableTransferStock,
  transferBucketConsumesStock
} from '../src/screens/transfer-stock-policy';

describe('transfer tester feedback regressions', () => {
  const source = readFileSync(join(__dirname, '../src/screens/TransferScreen.tsx'), 'utf8');
  const historySource = readFileSync(join(__dirname, '../src/screens/TransferHistoryScreen.tsx'), 'utf8');
  const stockPolicySource = readFileSync(join(__dirname, '../src/screens/transfer-stock-policy.ts'), 'utf8');

  it('keeps non-LPG items in the transfer catalog', () => {
    expect(source).toContain('setCatalog(projectedCatalog)');
    expect(source).not.toContain('setCatalog(lpgCatalog.length ? lpgCatalog : projectedCatalog)');
    expect(source).toContain("product.isLpg ? 'Full' : 'Quantity'");
  });

  it('requires a separate received confirmation after transfer confirmation', () => {
    expect(historySource).toContain('Mark Received');
    expect(historySource).toContain('Destination confirmation');
    expect(historySource).toContain('markTransferReceived');
  });

  it('offers authorized locations across branches as transfer destinations', () => {
    expect(source).not.toContain(".filter((row) => !row.branchId || row.branchId === appState.setup.branchId)");
    expect(source).toContain('const localSourceLocations');
    expect(source).toContain("case 'INTER_STORE_TRANSFER':");
    expect(source).toContain("return stores.filter((location) => location.id !== sourceId)");
  });

  it('validates only the stock bucket consumed by each adjustment mode', () => {
    expect(stockPolicySource).toContain('function transferBucketConsumesStock');
    expect(source).toContain('transferBucketConsumesStock(mode, stockBucket)');
    expect(transferBucketConsumesStock('CREATE', 'empty')).toBe(true);
    expect(transferBucketConsumesStock('CREATE', 'full')).toBe(false);
    expect(transferBucketConsumesStock('USED', 'full')).toBe(true);
    expect(transferBucketConsumesStock('USED', 'empty')).toBe(false);
    expect(transferBucketConsumesStock('CONVERT', 'empty')).toBe(true);
    expect(transferBucketConsumesStock('CONVERT', 'full')).toBe(false);
    expect(transferBucketConsumesStock('GENERAL', 'full')).toBe(true);
    expect(transferBucketConsumesStock('GENERAL', 'empty')).toBe(true);
  });

  it('allows adjustment items to be selected before validating the entered quantity', () => {
    expect(hasConsumableTransferStock('CREATE', 10, 0)).toBe(false);
    expect(hasConsumableTransferStock('CREATE', 0, 10)).toBe(true);
    expect(hasConsumableTransferStock('USED', 10, 0)).toBe(true);
    expect(hasConsumableTransferStock('USED', 0, 10)).toBe(false);
    expect(canSelectTransferProduct('CREATE', true, 10, 0)).toBe(true);
    expect(canSelectTransferProduct('USED', true, 0, 10)).toBe(true);
    expect(canSelectTransferProduct('CONVERT', true, 10, 0)).toBe(true);
    expect(canSelectTransferProduct('GENERAL', true, 0, 0)).toBe(false);
    expect(canSelectTransferProduct('GENERAL', true, 1, 0)).toBe(true);
    expect(canSelectTransferProduct('GENERAL', false, 0, 0)).toBe(true);
  });

  it('prompts the cashier to start duty when Save Transfer is clicked', () => {
    expect(source).toContain('const openSaveConfirmation');
    expect(source).toContain('Start Duty in Shift before saving a transfer.');
    expect(source).toContain('onClick={openSaveConfirmation}');
  });

  it('labels regular inventory quantity clearly', () => {
    expect(source).toContain('<span>Full / Qty</span>');
    expect(source).not.toContain('Full / Regular');
    expect(historySource).not.toContain('Full / Regular');
  });
});
