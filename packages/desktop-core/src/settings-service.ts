import type {
  DesktopAppState,
  DesktopReceiptLayoutSettings,
  DesktopSetupState
} from './schema';

export interface DesktopStateRepository {
  loadState(): Promise<DesktopAppState>;
  saveState(state: DesktopAppState): Promise<void>;
  resetLocalData(): Promise<void>;
}

export class DesktopSettingsService {
  constructor(private readonly repository: DesktopStateRepository) {}

  async getState(): Promise<DesktopAppState> {
    return this.repository.loadState();
  }

  async saveState(state: DesktopAppState): Promise<DesktopAppState> {
    await this.repository.saveState(state);
    return state;
  }

  async completeSetup(setup: DesktopSetupState): Promise<DesktopAppState> {
    const current = await this.repository.loadState();
    const next: DesktopAppState = {
      ...current,
      setupCompleted: true,
      setup,
      sync: {
        ...current.sync,
        lastSyncMessage: 'Desktop setup saved. Ready for initial sync.'
      }
    };
    await this.repository.saveState(next);
    return next;
  }

  async updateSyncState(nextSync: Partial<DesktopAppState['sync']>): Promise<DesktopAppState> {
    const current = await this.repository.loadState();
    const next = {
      ...current,
      sync: {
        ...current.sync,
        ...nextSync
      }
    };
    await this.repository.saveState(next);
    return next;
  }

  async saveReceiptLayoutSettings(settings: DesktopReceiptLayoutSettings): Promise<DesktopAppState> {
    const current = await this.repository.loadState();
    const next: DesktopAppState = {
      ...current,
      receiptLayout: {
        ...current.receiptLayout,
        ...settings
      }
    };
    await this.repository.saveState(next);
    return next;
  }

  async updateWalkthrough(
    patch: Partial<DesktopAppState['walkthrough']>
  ): Promise<DesktopAppState> {
    const current = await this.repository.loadState();
    const next: DesktopAppState = {
      ...current,
      walkthrough: {
        ...current.walkthrough,
        ...patch
      }
    };
    await this.repository.saveState(next);
    return next;
  }

  async resetLocalData(): Promise<DesktopAppState> {
    await this.repository.resetLocalData();
    return this.repository.loadState();
  }
}
