import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldPreventDesktopClose } from '../src/app/desktop-close-policy';

describe('desktop authentication feedback regressions', () => {
  const startupSource = readFileSync(join(__dirname, '../src/screens/DesktopStartupScreen.tsx'), 'utf8');
  const appSource = readFileSync(join(__dirname, '../src/app/App.tsx'), 'utf8');

  it('uses email and password for a full sign-in and reserves PIN for local unlock', () => {
    expect(startupSource).not.toContain('placeholder="PIN (optional)"');
    expect(startupSource).not.toContain('PIN is optional.');
    expect(startupSource).toContain("void onLogin({ ...form, password, pin: '' });");
    expect(startupSource).toContain('placeholder="PIN"');
    expect(startupSource).toContain('Use Password Instead');
  });

  it('blocks close only while the active signed-in workspace is open', () => {
    expect(shouldPreventDesktopClose('READY', 'access-token')).toBe(true);
    expect(shouldPreventDesktopClose('READY', null)).toBe(false);
    expect(shouldPreventDesktopClose('LOGIN', 'stale-token')).toBe(false);
    expect(shouldPreventDesktopClose('UNLOCK', 'access-token')).toBe(false);
    expect(appSource).toContain('desktopCloseGuardRef.current');
  });
});
