import { readFileSync } from 'fs';
import { join } from 'path';

describe('tester feedback regressions', () => {
  it('shows all item movement history by default instead of today only', () => {
    const source = readFileSync(join(__dirname, '../src/app/(admin)/products/page.tsx'), 'utf8');

    expect(source).toContain("const [movementFromDate, setMovementFromDate] = useState('')");
    expect(source).toContain("const [movementToDate, setMovementToDate] = useState('')");
  });

  it('loads all sync review statuses for accurate totals and explains an empty result', () => {
    const source = readFileSync(join(__dirname, '../src/app/(admin)/sync-reviews/page.tsx'), 'utf8');

    expect(source).toContain("apiRequest<{ rows: SyncReviewRow[] }>('/reviews?limit=300')");
    expect(source).toContain('Successful syncs do not create review rows.');
  });

  it('filters cancelled sales out of dashboard trends and credit balances', () => {
    const source = readFileSync(join(__dirname, '../src/app/(admin)/dashboard/page.tsx'), 'utf8');

    expect(source).toContain("sales.filter((row) => row.status === 'ACTIVE')");
    expect(source).toContain('buildDailyTotals(activeSales');
    expect(source).toContain('return activeSales');
  });
});
