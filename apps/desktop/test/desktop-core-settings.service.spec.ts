import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopSettingsService,
  type DesktopAppState,
  type DesktopStateRepository
} from '@vpos/desktop-core';

function cloneState(state: DesktopAppState = DEFAULT_DESKTOP_APP_STATE): DesktopAppState {
  return JSON.parse(JSON.stringify(state)) as DesktopAppState;
}

class MemoryStateRepository implements DesktopStateRepository {
  state = cloneState();
  saveCount = 0;
  resetCount = 0;

  async loadState(): Promise<DesktopAppState> {
    return cloneState(this.state);
  }

  async saveState(state: DesktopAppState): Promise<void> {
    this.state = cloneState(state);
    this.saveCount += 1;
  }

  async resetLocalData(): Promise<void> {
    this.state = cloneState();
    this.resetCount += 1;
  }
}

describe('DesktopSettingsService core orchestration', () => {
  it('completes setup without discarding unrelated persisted settings', async () => {
    const repository = new MemoryStateRepository();
    repository.state.receiptLayout.footerText = 'Existing footer';
    const service = new DesktopSettingsService(repository);

    const next = await service.completeSetup({
      ...repository.state.setup,
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'location-1',
      locationLabel: 'Front Counter'
    });

    expect(next.setupCompleted).toBe(true);
    expect(next.setup.branchLabel).toBe('Main Branch');
    expect(next.receiptLayout.footerText).toBe('Existing footer');
    expect(next.sync.lastSyncMessage).toContain('Ready for initial sync');
    expect(repository.saveCount).toBe(1);
  });

  it('merges sync state without replacing the other sync fields', async () => {
    const repository = new MemoryStateRepository();
    repository.state.sync.lastPullToken = 'pull-1';
    const service = new DesktopSettingsService(repository);

    const next = await service.updateSyncState({
      lastSyncStatus: 'success',
      lastSyncedAt: '2026-10-08T09:00:00.000Z'
    });

    expect(next.sync.lastPullToken).toBe('pull-1');
    expect(next.sync.lastSyncStatus).toBe('success');
    expect(next.sync.lastSyncedAt).toBe('2026-10-08T09:00:00.000Z');
  });

  it('persists receipt and walkthrough edits while preserving their defaults', async () => {
    const repository = new MemoryStateRepository();
    const service = new DesktopSettingsService(repository);

    const withReceipt = await service.saveReceiptLayoutSettings({
      ...repository.state.receiptLayout,
      headerLogoText: 'QA LPG',
      showSaleId: false
    });
    const withWalkthrough = await service.updateWalkthrough({
      completedAt: '2026-10-08T09:05:00.000Z'
    });

    expect(withReceipt.receiptLayout.headerLogoText).toBe('QA LPG');
    expect(withReceipt.receiptLayout.showReceiptNumber).toBe(true);
    expect(withWalkthrough.walkthrough.completedAt).toBe('2026-10-08T09:05:00.000Z');
    expect(withWalkthrough.walkthrough.dismissedAt).toBeNull();
  });

  it('delegates reset to the repository and returns the fresh state', async () => {
    const repository = new MemoryStateRepository();
    repository.state.setupCompleted = true;
    const service = new DesktopSettingsService(repository);

    const next = await service.resetLocalData();

    expect(repository.resetCount).toBe(1);
    expect(next.setupCompleted).toBe(false);
  });
});
