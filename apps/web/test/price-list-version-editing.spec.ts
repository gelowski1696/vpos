import { readFileSync } from 'fs';
import { join } from 'path';

describe('price-list version editing', () => {
  const source = readFileSync(join(__dirname, '../src/app/(admin)/price-lists/page.tsx'), 'utf8');

  it('saves item price and cost changes through draft-version rules', () => {
    expect(source).toContain('/versions/${selectedVersionId}/rules');
    expect(source).toContain("selectedVersionDetail?.status !== 'DRAFT'");
    expect(source).toContain('Save Draft Prices');
  });

  it('keeps the regular edit dialog limited to metadata and operational status', () => {
    expect(source).toContain('Published pricing remains unchanged.');
    expect(source).toContain('Only the name, reference code, and operational status will be updated.');
    expect(source).toContain('Version-controlled pricing');
  });
});
