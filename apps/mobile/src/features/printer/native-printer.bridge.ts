import type { NativePrinterTransport, PrinterType, ReceiptLine } from '@vpos/printing-core';

type NativePrinterCapabilities = {
  moduleAvailable: boolean;
  platform: string;
  isAndroid: boolean;
  hasIminSdk: boolean;
  hasBluetooth: boolean;
  supportsTcpEscPos: boolean;
};

type NativePrinterBridgeModule = {
  getCapabilities(): Promise<NativePrinterCapabilities>;
  printImin(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void>;
  printEscPos(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void>;
  testPrint(printerType: PrinterType, config?: Record<string, unknown> | null): Promise<void>;
};

const MODULE_NAME = 'VposPrinterBridge';
let didLogMissingBridge = false;

function loadReactNativeRuntime(): {
  NativeModules: Record<string, unknown>;
  Platform: { OS?: string };
} | null {
  try {
    const runtime = require('react-native') as {
      NativeModules: Record<string, unknown>;
      Platform: { OS?: string };
    };
    if (!runtime || typeof runtime !== 'object') {
      return null;
    }
    return runtime;
  } catch {
    return null;
  }
}

function getNativeModule(): NativePrinterBridgeModule | null {
  const runtime = loadReactNativeRuntime();
  if (!runtime) {
    if (!didLogMissingBridge) {
      didLogMissingBridge = true;
      // eslint-disable-next-line no-console
      console.log('[VPOS][PRINTER] Native runtime is unavailable.');
    }
    return null;
  }

  const modules = runtime.NativeModules;
  const module = modules[MODULE_NAME];
  if (!module || typeof module !== 'object') {
    if (!didLogMissingBridge) {
      didLogMissingBridge = true;
      const moduleKeys = Object.keys(modules ?? {}).slice(0, 25);
      // eslint-disable-next-line no-console
      console.log('[VPOS][PRINTER] Native bridge module not found.', {
        expectedModule: MODULE_NAME,
        availableModuleCount: Object.keys(modules ?? {}).length,
        sampleModules: moduleKeys
      });
    }
    return null;
  }
  didLogMissingBridge = false;
  return module as NativePrinterBridgeModule;
}

function assertNativeBridgeAvailable(): NativePrinterBridgeModule {
  const module = getNativeModule();
  if (module) {
    return module;
  }

  throw new Error(
    'Native printer bridge is unavailable. Use an Android Dev Client build with VposPrinterBridge included.'
  );
}

export async function getNativePrinterCapabilities(): Promise<NativePrinterCapabilities> {
  const runtime = loadReactNativeRuntime();
  const platformOs = runtime?.Platform?.OS ?? 'unknown';
  const fallback: NativePrinterCapabilities = {
    moduleAvailable: false,
    platform: platformOs,
    isAndroid: platformOs === 'android',
    hasIminSdk: false,
    hasBluetooth: false,
    supportsTcpEscPos: false
  };

  const module = getNativeModule();
  if (!module) {
    return fallback;
  }

  try {
    return await module.getCapabilities();
  } catch {
    return fallback;
  }
}

export function createNativePrinterTransport(): NativePrinterTransport {
  return {
    async printEscPos(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void> {
      const module = assertNativeBridgeAvailable();
      await module.printEscPos(lines, config ?? null);
    },
    async printIMin(lines: ReceiptLine[], config?: Record<string, unknown> | null): Promise<void> {
      const module = assertNativeBridgeAvailable();
      await module.printImin(lines, config ?? null);
    },
    async testPrint(printerType: PrinterType, config?: Record<string, unknown> | null): Promise<void> {
      const module = assertNativeBridgeAvailable();
      await module.testPrint(printerType, config ?? null);
    }
  };
}
