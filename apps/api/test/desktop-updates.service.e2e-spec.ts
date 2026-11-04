import { DesktopUpdatesService } from '../src/modules/desktop-updates/desktop-updates.service';

describe('DesktopUpdatesService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns an optional Windows update policy', () => {
    process.env.DESKTOP_WINDOWS_UPDATES_ENABLED = 'true';
    process.env.DESKTOP_WINDOWS_LATEST_VERSION = '0.1.3';
    process.env.DESKTOP_WINDOWS_MIN_SUPPORTED_VERSION = '0.1.1';
    process.env.DESKTOP_WINDOWS_ROLLOUT_PERCENTAGE = '100';
    const policy = new DesktopUpdatesService().getPolicy({ version: '0.1.2', deviceId: 'station-1' });
    expect(policy).toMatchObject({ enabled: true, latestVersion: '0.1.3', required: false, eligible: true });
  });

  it('requires an update below the minimum supported version regardless of rollout', () => {
    process.env.DESKTOP_WINDOWS_UPDATES_ENABLED = 'true';
    process.env.DESKTOP_WINDOWS_LATEST_VERSION = '0.2.0';
    process.env.DESKTOP_WINDOWS_MIN_SUPPORTED_VERSION = '0.1.5';
    process.env.DESKTOP_WINDOWS_ROLLOUT_PERCENTAGE = '0';
    const policy = new DesktopUpdatesService().getPolicy({ version: '0.1.2', deviceId: 'station-2' });
    expect(policy.required).toBe(true);
    expect(policy.eligible).toBe(true);
  });

  it('rejects malformed policy values safely', () => {
    process.env.DESKTOP_WINDOWS_UPDATES_ENABLED = 'true';
    process.env.DESKTOP_WINDOWS_LATEST_VERSION = 'not-a-version';
    process.env.DESKTOP_WINDOWS_SUPPORT_URL = 'http://insecure.example.test';
    const policy = new DesktopUpdatesService().getPolicy({ version: 'invalid' });
    expect(policy.latestVersion).toBeNull();
    expect(policy.supportUrl).toBeNull();
    expect(policy.currentVersion).toBeNull();
  });

  it('does not offer the Windows artifact to an unsupported target', () => {
    process.env.DESKTOP_WINDOWS_UPDATES_ENABLED = 'true';
    process.env.DESKTOP_WINDOWS_LATEST_VERSION = '0.1.3';
    const policy = new DesktopUpdatesService().getPolicy({ platform: 'linux', arch: 'x86_64', version: '0.1.2' });
    expect(policy.enabled).toBe(false);
    expect(policy.eligible).toBe(false);
  });
});
