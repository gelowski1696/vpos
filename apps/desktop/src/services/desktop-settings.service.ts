import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopSetupState } from '../db/schema';

export class DesktopSettingsService {
  async getState(): Promise<DesktopAppState> {
    return desktopDb.loadState();
  }

  async saveState(state: DesktopAppState): Promise<DesktopAppState> {
    await desktopDb.saveState(state);
    return state;
  }

  async completeSetup(setup: DesktopSetupState): Promise<DesktopAppState> {
    const current = await desktopDb.loadState();
    const next: DesktopAppState = {
      ...current,
      setupCompleted: true,
      setup,
      sync: {
        ...current.sync,
        lastSyncMessage: 'Desktop setup saved. Ready for initial sync.'
      }
    };
    await desktopDb.saveState(next);
    return next;
  }

  async updateSyncState(nextSync: DesktopAppState['sync']): Promise<DesktopAppState> {
    const current = await desktopDb.loadState();
    const next = {
      ...current,
      sync: nextSync
    };
    await desktopDb.saveState(next);
    return next;
  }
}

export const desktopSettingsService = new DesktopSettingsService();
