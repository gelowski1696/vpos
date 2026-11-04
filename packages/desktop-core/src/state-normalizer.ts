import {
  DEFAULT_DESKTOP_APP_STATE,
  type DesktopAppState,
  type DesktopPrinterProfile
} from './schema';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizePrinterProfiles(value: unknown): DesktopPrinterProfile[] {
  if (!Array.isArray(value)) {
    return DEFAULT_DESKTOP_APP_STATE.printerProfiles;
  }

  return value.map((profile) => {
    const row = asRecord(profile);
    return {
      id: String(row.id ?? ''),
      label: String(row.label ?? ''),
      mode: row.mode === 'LAN' ? 'LAN' : 'USB',
      printerName: String(row.printerName ?? ''),
      printerHost: String(row.printerHost ?? ''),
      printerPort: String(row.printerPort ?? ''),
      lastTestedAt: typeof row.lastTestedAt === 'string' ? row.lastTestedAt : null,
      lastSuccessAt: typeof row.lastSuccessAt === 'string' ? row.lastSuccessAt : null,
      lastTestStatus:
        row.lastTestStatus === 'success' || row.lastTestStatus === 'error' ? row.lastTestStatus : 'idle',
      lastTestMessage: typeof row.lastTestMessage === 'string' ? row.lastTestMessage : null
    };
  });
}

export function normalizeDesktopAppState(input: unknown): DesktopAppState {
  const parsed = asRecord(input);
  const setup = asRecord(parsed.setup);
  const auth = asRecord(parsed.auth);
  const receiptLayout = asRecord(parsed.receiptLayout);
  const walkthrough = asRecord(parsed.walkthrough);
  const sync = asRecord(parsed.sync);

  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    ...parsed,
    version: 1,
    setupCompleted: Boolean(parsed.setupCompleted ?? DEFAULT_DESKTOP_APP_STATE.setupCompleted),
    printerProfiles: normalizePrinterProfiles(parsed.printerProfiles),
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      ...setup
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      ...auth
    },
    receiptLayout: {
      ...DEFAULT_DESKTOP_APP_STATE.receiptLayout,
      ...receiptLayout
    },
    walkthrough: {
      ...DEFAULT_DESKTOP_APP_STATE.walkthrough,
      ...walkthrough
    },
    sync: {
      ...DEFAULT_DESKTOP_APP_STATE.sync,
      ...sync
    }
  } as DesktopAppState;
}
