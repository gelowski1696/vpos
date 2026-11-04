import {
  DEFAULT_DESKTOP_APP_STATE,
  DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS,
  type DesktopAppState
} from '../src/db/schema';
import { DesktopReceiptService } from '../src/services/desktop-receipt.service';

const invokeMock = jest.fn();

jest.mock('@tauri-apps/api/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

type TestWindow = {
  __TAURI_IPC__?: unknown;
  open: jest.Mock;
  setTimeout: (callback: () => void, delay?: number) => number;
};

function buildUsbState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      branchLabel: 'VMJAM Main',
      locationLabel: 'Front Counter',
      printerMode: 'USB',
      printerName: 'XP-58'
    }
  };
}

function installTauriWindow(): jest.Mock {
  const openMock = jest.fn(() => ({
    document: {
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn()
    },
    focus: jest.fn(),
    print: jest.fn()
  }));

  Object.defineProperty(globalThis, 'window', {
    value: {
      __TAURI_IPC__: {},
      open: openMock,
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      }
    } satisfies TestWindow,
    configurable: true,
    writable: true
  });

  return openMock;
}

describe('DesktopReceiptService settings test prints', () => {
  const service = new DesktopReceiptService();

  afterEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('surfaces native printer failures for printer settings test print without browser fallback', async () => {
    const openMock = installTauriWindow();
    invokeMock.mockRejectedValueOnce(new Error('Unable to open the selected Windows printer.'));

    await expect(service.testPrinter(buildUsbState())).rejects.toThrow('Unable to open the selected Windows printer.');

    expect(openMock).not.toHaveBeenCalled();
  });

  it('surfaces native printer failures for receipt layout test print without browser fallback', async () => {
    const openMock = installTauriWindow();
    invokeMock.mockRejectedValueOnce(new Error('Unable to write receipt bytes to the selected Windows printer.'));

    await expect(
      service.testReceiptLayout(DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS, buildUsbState())
    ).rejects.toThrow('Unable to write receipt bytes to the selected Windows printer.');

    expect(openMock).not.toHaveBeenCalled();
  });
});
