import { readFileSync } from 'fs';
import { join } from 'path';

describe('transfer tester feedback regressions', () => {
  const source = readFileSync(join(__dirname, '../src/screens/TransferScreen.tsx'), 'utf8');
  const historySource = readFileSync(join(__dirname, '../src/screens/TransferHistoryScreen.tsx'), 'utf8');

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
});
