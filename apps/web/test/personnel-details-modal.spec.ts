import { readFileSync } from 'fs';
import { join } from 'path';

describe('personnel details modal', () => {
  const pageSource = readFileSync(join(__dirname, '../src/app/(admin)/personnels/page.tsx'), 'utf8');
  const entityManagerSource = readFileSync(join(__dirname, '../src/components/entity-manager.tsx'), 'utf8');

  it('opens personnel details from a row click with Details and Transactions tabs', () => {
    expect(pageSource).toContain('onRowClick={openPersonnelDetails}');
    expect(pageSource).toContain("type PersonnelDetailTab = 'details' | 'transactions'");
    expect(pageSource).toContain("tab === 'details' ? 'Details' : 'Transactions'");
  });

  it('loads personnel product commission transactions from the API', () => {
    expect(pageSource).toContain('/master-data/personnels/${encodeURIComponent(personnelId)}/transactions');
    expect(pageSource).toContain('No product commission sales found for this personnel.');
    expect(pageSource).toContain('Total Commission');
  });

  it('keeps row click opt-in inside EntityManager', () => {
    expect(entityManagerSource).toContain('onRowClick?: (row: Record<string, unknown>) => void');
    expect(entityManagerSource).toContain('event.stopPropagation()');
    expect(entityManagerSource).toContain('handleRowKeyDown');
  });
});
