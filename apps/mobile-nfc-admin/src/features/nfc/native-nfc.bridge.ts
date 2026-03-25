import { NativeEventEmitter, NativeModules } from 'react-native';

export type NativeNfcCapabilities = {
  moduleAvailable: boolean;
  platform: string;
  isAndroid: boolean;
  hasNfcHardware: boolean;
  isNfcEnabled: boolean;
  isScanning: boolean;
  deviceModel: string;
  deviceManufacturer: string;
  deviceBrand: string;
};

export type NfcTagEvent = {
  uidHex: string;
  techList: string[];
  timestamp: number;
  timestampIso: string;
};

type NativeNfcBridgeModule = {
  getCapabilities(): Promise<NativeNfcCapabilities>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const MODULE_NAME = 'VposNfcBridge';
const TAG_EVENT_NAME = 'VPOS_NFC_TAG';

function getNativeModule(): NativeNfcBridgeModule | null {
  const module = NativeModules[MODULE_NAME];
  if (!module || typeof module !== 'object') {
    return null;
  }
  return module as NativeNfcBridgeModule;
}

function fallbackCapabilities(): NativeNfcCapabilities {
  return {
    moduleAvailable: false,
    platform: 'unknown',
    isAndroid: false,
    hasNfcHardware: false,
    isNfcEnabled: false,
    isScanning: false,
    deviceModel: 'Unknown',
    deviceManufacturer: 'Unknown',
    deviceBrand: 'Unknown'
  };
}

export async function getNativeNfcCapabilities(): Promise<NativeNfcCapabilities> {
  const module = getNativeModule();
  if (!module) {
    return fallbackCapabilities();
  }
  try {
    return await module.getCapabilities();
  } catch {
    return fallbackCapabilities();
  }
}

export async function startNativeNfcScan(): Promise<void> {
  const module = getNativeModule();
  if (!module) {
    throw new Error('Native NFC bridge is unavailable. Build Android dev client with VposNfcBridge.');
  }
  await module.startScan();
}

export async function stopNativeNfcScan(): Promise<void> {
  const module = getNativeModule();
  if (!module) {
    return;
  }
  await module.stopScan();
}

export function subscribeToNfcTagEvents(
  onTag: (tag: NfcTagEvent) => void
): { remove: () => void } {
  const module = getNativeModule();
  if (!module) {
    return { remove: () => undefined };
  }
  const emitter = new NativeEventEmitter(module);
  const subscription = emitter.addListener(TAG_EVENT_NAME, (payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const map = payload as Record<string, unknown>;
    const techList = Array.isArray(map.techList)
      ? map.techList.map((item) => String(item))
      : [];
    onTag({
      uidHex: String(map.uidHex ?? ''),
      techList,
      timestamp: Number(map.timestamp ?? Date.now()),
      timestampIso: String(map.timestampIso ?? new Date().toISOString())
    });
  });
  return {
    remove: () => subscription.remove()
  };
}
