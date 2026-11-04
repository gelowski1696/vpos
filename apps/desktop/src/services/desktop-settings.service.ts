import { DesktopSettingsService } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';

export { DesktopSettingsService } from '@vpos/desktop-core';

// The shared service owns state transitions; this application adapter supplies Tauri/localStorage.
export const desktopSettingsService = new DesktopSettingsService(desktopDb);
