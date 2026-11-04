import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { listNativePrinters, printEscPosNative } from '../src/services/desktop-printer.bridge';

const invokeMock = jest.fn();

jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

type MutableWindow = {
  __TAURI_IPC__?: unknown;
  __TAURI__?: unknown;
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
};

function installWindow(windowValue: MutableWindow): void {
  Object.defineProperty(globalThis, 'window', {
    value: windowValue,
    configurable: true,
    writable: true
  });
}

describe('desktop tauri runtime detection', () => {
  afterEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('uses native printer commands when __TAURI_IPC__ is available', async () => {
    invokeMock.mockResolvedValueOnce(['XP-58']);
    installWindow({
      __TAURI_IPC__: {}
    });

    await expect(listNativePrinters()).resolves.toEqual(['XP-58']);
    await expect(
      printEscPosNative([{ text: 'Printer test' }], {
        mode: 'USB',
        printerName: 'XP-58'
      })
    ).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith('desktop_list_printers');
    expect(invokeMock).toHaveBeenCalledWith('desktop_print_esc_pos', {
      lines: [{ text: 'Printer test' }],
      config: {
        mode: 'USB',
        printerName: 'XP-58'
      }
    });
  });

  it('loads desktop state through Tauri when __TAURI__ is available', async () => {
    const tauriState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        printerMode: 'USB' as const,
        printerName: 'XP-58'
      }
    };
    invokeMock.mockResolvedValueOnce(tauriState);
    installWindow({
      __TAURI__: {},
      localStorage: {
        getItem: () => JSON.stringify(DEFAULT_DESKTOP_APP_STATE),
        setItem: () => undefined,
        removeItem: () => undefined
      }
    });

    await expect(desktopDb.loadState()).resolves.toMatchObject({
      setupCompleted: true,
      setup: {
        printerMode: 'USB',
        printerName: 'XP-58'
      }
    });

    expect(invokeMock).toHaveBeenCalledWith('desktop_load_state');
  });
});
