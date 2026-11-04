import { normalizeDesktopAppState } from '@vpos/desktop-core';

describe('normalizeDesktopAppState', () => {
  it('fills fields missing from older Tauri state payloads', () => {
    const state = normalizeDesktopAppState({
      version: 1,
      setupCompleted: true,
      setup: {
        deviceId: 'desktop-branch-1',
        branchId: 'branch-1',
        locationId: 'location-1'
      },
      auth: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1'
      },
      sync: {
        lastSyncedAt: '2026-05-12T00:00:00.000Z',
        lastSyncStatus: 'success',
        lastSyncMessage: 'ok'
      }
    });

    expect(state.setup.deviceId).toBe('desktop-branch-1');
    expect(state.setup.posDefaultLpgFlow).toBe('NONE');
    expect(state.auth.accessToken).toBe('access-1');
    expect(state.auth.userEmail).toBeNull();
    expect(state.receiptLayout.showReceiptNumber).toBe(true);
    expect(state.walkthrough.completedAt).toBeNull();
    expect(state.sync.lastPullToken).toBeNull();
  });

  it('preserves the last pull token used by desktop sync', () => {
    const state = normalizeDesktopAppState({
      sync: {
        lastSyncedAt: null,
        lastSyncStatus: 'success',
        lastSyncMessage: 'ok',
        lastPullToken: 'pull-token-123'
      }
    });

    expect(state.sync.lastPullToken).toBe('pull-token-123');
  });
});
