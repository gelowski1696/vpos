import { readFileSync } from 'fs';
import { join } from 'path';

describe('personnel rider users modal', () => {
  const source = readFileSync(join(__dirname, '../src/app/(admin)/personnels/page.tsx'), 'utf8');

  it('wires rider user management to the Personnel page toolbar', () => {
    expect(source).toContain('Rider Users');
    expect(source).toContain('openRiderUsersModal');
    expect(source).toContain('/master-data/rider-users');
  });

  it('supports create, update, deactivate, and delete controls', () => {
    expect(source).toContain('Create Rider User');
    expect(source).toContain('Update Rider User');
    expect(source).toContain('Deactivate');
    expect(source).toContain('Reactivate');
    expect(source).toContain('Delete rider user');
  });
});
