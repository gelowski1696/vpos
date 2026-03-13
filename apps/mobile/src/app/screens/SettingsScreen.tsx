import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PrinterType } from '@vpos/printing-core';
import type { AppTheme } from '../theme';
import type { MobilePrinterRuntimeCapabilities } from '../../features/printer/mobile-printer.service';
import type { ReceiptLayoutSettings } from '../receipt-layout-settings';
import { PinCodeInput } from '../components/PinCodeInput';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

const PRINTER_OPTIONS: Array<{ type: PrinterType; label: string }> = [
  { type: 'IMIN', label: 'iMin Built-in' },
  { type: 'GENERIC_BUILTIN', label: 'TCP ESC/POS' },
  { type: 'BLUETOOTH', label: 'Bluetooth ESC/POS' },
  { type: 'NONE', label: 'No Printer' }
];

type Props = {
  theme: AppTheme;
  themeMode: 'LIGHT' | 'DARK';
  onChangeThemeMode: (mode: 'LIGHT' | 'DARK') => void;
  posDefaultLpgFlow: 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  onChangePosDefaultLpgFlow: (flow: 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL') => Promise<void> | void;
  pinConfigured: boolean;
  onChangePin: (input: { currentPin: string; nextPin: string }) => Promise<void>;
  selectedBranchName: string | null;
  selectedBranchId: string;
  lastMasterDataSyncAt: string | null;
  updateAvailable: boolean;
  branchDataBusy: boolean;
  onCheckBranchUpdates: () => Promise<void>;
  onRedownloadBranchData: () => Promise<void>;
  printerType: PrinterType;
  printerBluetoothMac: string;
  printerTcpHost: string;
  printerTcpPort: string;
  printerCapabilities: MobilePrinterRuntimeCapabilities | null;
  printerBusy: boolean;
  printerMessage: string | null;
  onChangeBluetoothMac: (value: string) => void;
  onChangeTcpHost: (value: string) => void;
  onChangeTcpPort: (value: string) => void;
  onSelectPrinterType: (type: PrinterType) => Promise<void>;
  onSavePrinterConfig: () => Promise<void>;
  onTestPrint: () => Promise<void>;
  receiptLayoutSettings: ReceiptLayoutSettings;
  onSaveReceiptLayoutSettings: (value: ReceiptLayoutSettings) => Promise<void>;
  onTestReceiptLayout: (value: ReceiptLayoutSettings) => Promise<void>;
  onStartAppWalkthrough: () => void;
  onResetTutorials: () => Promise<void> | void;
};

type LayoutToggleItem = {
  key: keyof ReceiptLayoutSettings;
  label: string;
  hint: string;
};

const LAYOUT_TOGGLE_ITEMS: LayoutToggleItem[] = [
  { key: 'showHeaderLogoImage', label: 'Show Header Logo Image', hint: 'Display uploaded logo image at top of receipt.' },
  { key: 'showHeaderLogoText', label: 'Show Header Text', hint: 'Display brand text/logo line at top.' },
  { key: 'showReceiptNumber', label: 'Show Receipt Number', hint: 'Include receipt no. in receipt details.' },
  { key: 'showSaleId', label: 'Show Sale ID', hint: 'Include sale ID reference for support.' },
  { key: 'showDateTime', label: 'Show Date/Time', hint: 'Print transaction date and time.' },
  { key: 'showBranch', label: 'Show Branch', hint: 'Print branch name.' },
  { key: 'showLocation', label: 'Show Location', hint: 'Print location name.' },
  { key: 'showCashier', label: 'Show Cashier', hint: 'Print cashier full name from current login session.' },
  { key: 'showCashierRole', label: 'Show Cashier Role', hint: 'Print cashier role label from layout setting.' },
  { key: 'showOrderType', label: 'Show Order Type', hint: 'Pickup/Delivery label.' },
  { key: 'showCustomer', label: 'Show Customer', hint: 'Print customer name.' },
  { key: 'showPersonnel', label: 'Show Personnel', hint: 'Print assigned personnel.' },
  { key: 'showHelper', label: 'Show Helper', hint: 'Print helper name if available.' },
  { key: 'showItemCode', label: 'Show Item Code', hint: 'Display item code together with item name.' },
  { key: 'showPaymentMode', label: 'Show Payment Mode', hint: 'Full or partial payment mode.' },
  { key: 'showSubtotal', label: 'Show Subtotal', hint: 'Print subtotal value.' },
  { key: 'showDiscount', label: 'Show Discount', hint: 'Print discount value.' },
  { key: 'showTotal', label: 'Show Total', hint: 'Print final total.' },
  { key: 'showPaid', label: 'Show Paid Amount', hint: 'Print paid amount.' },
  { key: 'showChange', label: 'Show Change', hint: 'Print change amount.' },
  { key: 'showCreditDue', label: 'Show Credit Due', hint: 'Print remaining credit due.' },
  { key: 'showFooter', label: 'Show Footer', hint: 'Show footer thank-you text.' }
];

const LOGO_PLACEMENTS: Array<ReceiptLayoutSettings['headerLogoPlacement']> = ['LEFT', 'CENTER', 'RIGHT'];
const POS_FLOW_OPTIONS: Array<{ value: 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL'; label: string }> = [
  { value: 'NONE', label: 'Require per item' },
  { value: 'REFILL_EXCHANGE', label: 'Refill Exchange' },
  { value: 'NON_REFILL', label: 'Non-Refill' }
];

type ImagePickerRuntimeModule = {
  requestMediaLibraryPermissionsAsync: () => Promise<{ granted: boolean }>;
  launchImageLibraryAsync: (options: {
    mediaTypes: string[];
    allowsEditing: boolean;
    aspect: [number, number];
    quality: number;
    base64: boolean;
  }) => Promise<{
    canceled: boolean;
    assets?: Array<{ base64?: string | null; mimeType?: string | null }>;
  }>;
};

type NativeImagePickerBridgeModule = {
  pickImage: () => Promise<{ base64?: string | null; mimeType?: string | null }>;
};

function getNativeImagePickerBridge(): NativeImagePickerBridgeModule | null {
  try {
    const rn = require('react-native') as {
      NativeModules?: Record<string, unknown>;
    };
    const module = rn.NativeModules?.VposImagePickerBridge as NativeImagePickerBridgeModule | undefined;
    if (!module || typeof module.pickImage !== 'function') {
      return null;
    }
    return module;
  } catch {
    return null;
  }
}

function hasRuntimeImagePickerModule(): boolean {
  try {
    const expoModulesCore = require('expo-modules-core') as {
      NativeModulesProxy?: Record<string, unknown>;
    };
    const proxy = expoModulesCore.NativeModulesProxy ?? {};
    if (proxy.ExponentImagePicker || proxy.ExpoImagePicker) {
      return true;
    }
  } catch {
    // ignore
  }

  try {
    const rn = require('react-native') as {
      NativeModules?: Record<string, unknown>;
    };
    const modules = rn.NativeModules ?? {};
    return Boolean(modules.ExponentImagePicker || modules.ExpoImagePicker);
  } catch {
    return false;
  }
}

function clampPadding(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 12) {
    return 12;
  }
  return rounded;
}

function buildImageDataUrl(base64: string, mimeType?: string | null): string {
  const type = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : 'image/png';
  return `data:${type};base64,${base64}`;
}

function ToggleRow(props: {
  theme: AppTheme;
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <View style={[styles.toggleRow, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.inputBg }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleTitle, { color: props.theme.heading }]}>{props.title}</Text>
        <Text style={[styles.toggleHint, { color: props.theme.subtext }]}>{props.hint}</Text>
      </View>
      <View style={styles.toggleButtons}>
        <Pressable
          onPress={() => props.onChange(true)}
          style={[styles.toggleBtn, { backgroundColor: props.value ? props.theme.primary : props.theme.pillBg }]}
        >
          <Text style={[styles.toggleBtnText, { color: props.value ? '#FFFFFF' : props.theme.pillText }]}>ON</Text>
        </Pressable>
        <Pressable
          onPress={() => props.onChange(false)}
          style={[styles.toggleBtn, { backgroundColor: !props.value ? props.theme.primary : props.theme.pillBg }]}
        >
          <Text style={[styles.toggleBtnText, { color: !props.value ? '#FFFFFF' : props.theme.pillText }]}>OFF</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function SettingsScreen(props: Props): JSX.Element {
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<ReceiptLayoutSettings>(props.receiptLayoutSettings);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [nextPinInput, setNextPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [tutorialResetBusy, setTutorialResetBusy] = useState(false);
  const [pinFocusEpoch, setPinFocusEpoch] = useState(0);
  const tutorialSetPin = useTutorialTarget('settings-set-pin');
  const tutorialOpenLayout = useTutorialTarget('settings-open-layout');
  const tutorialRedownloadData = useTutorialTarget('settings-redownload-data');
  const tutorialSavePrinter = useTutorialTarget('settings-save-printer');

  const layoutSummary = useMemo(() => {
    const extraToggleKeys: Array<keyof ReceiptLayoutSettings> = [
      'showStoreContact',
      'showStoreAddress',
      'showBusinessTin',
      'showPermitOrInfo',
      'showTerminalName'
    ];
    const enabledCount =
      LAYOUT_TOGGLE_ITEMS.reduce((sum, item) => sum + (layoutDraft[item.key] ? 1 : 0), 0) +
      extraToggleKeys.reduce((sum, key) => sum + (layoutDraft[key] ? 1 : 0), 0);
    const total = LAYOUT_TOGGLE_ITEMS.length + extraToggleKeys.length;
    return `${enabledCount}/${total} fields enabled`;
  }, [layoutDraft]);

  const openLayoutModal = (): void => {
    setLayoutDraft(props.receiptLayoutSettings);
    setLayoutModalOpen(true);
  };

  const closeLayoutModal = (): void => {
    if (layoutSaving) {
      return;
    }
    setLayoutModalOpen(false);
  };

  const updateDraft = <K extends keyof ReceiptLayoutSettings>(
    key: K,
    value: ReceiptLayoutSettings[K]
  ): void => {
    setLayoutDraft((current) => ({ ...current, [key]: value }));
  };

  const pickReceiptLogo = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[VPOS][RECEIPT] LOGO_PICKER_START');

    const nativeBridge = getNativeImagePickerBridge();
    if (nativeBridge) {
      // eslint-disable-next-line no-console
      console.log('[VPOS][RECEIPT] LOGO_PICKER_USING_NATIVE_BRIDGE');
      try {
        const result = await nativeBridge.pickImage();
        const base64 = result?.base64?.trim();
        if (!base64) {
          return;
        }
        updateDraft('headerLogoImageDataUrl', buildImageDataUrl(base64, result?.mimeType));
        updateDraft('showHeaderLogoImage', true);
        return;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause ?? '');
        if (message.includes('PICKER_CANCELED')) {
          return;
        }
        Alert.alert('Logo Upload Failed', message || 'Unable to load selected image.');
        return;
      }
    }

    if (!hasRuntimeImagePickerModule()) {
      // eslint-disable-next-line no-console
      console.log('[VPOS][RECEIPT] LOGO_PICKER_NATIVE_MODULE_NOT_FOUND_PRECHECK');
      Alert.alert(
        'Logo Upload Unavailable',
        'Image picker native module is not available in this app runtime. Reinstall latest dev build to enable upload.',
      );
      return;
    }

    let picker: ImagePickerRuntimeModule | null = null;
    try {
      picker = require('expo-image-picker') as ImagePickerRuntimeModule;
      // eslint-disable-next-line no-console
      console.log('[VPOS][RECEIPT] LOGO_PICKER_MODULE_LOADED');
    } catch {
      // eslint-disable-next-line no-console
      console.log('[VPOS][RECEIPT] LOGO_PICKER_MODULE_MISSING');
      Alert.alert(
        'Logo Upload Unavailable',
        'Image picker native module is not installed in this app build. Rebuild the Android app to enable logo upload.',
      );
      return;
    }

    try {
      const permission = await picker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return;
      }

      const result = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64 || !asset.base64.trim()) {
        return;
      }

      updateDraft('headerLogoImageDataUrl', buildImageDataUrl(asset.base64, asset.mimeType));
      updateDraft('showHeaderLogoImage', true);
    } catch {
      // eslint-disable-next-line no-console
      console.log('[VPOS][RECEIPT] LOGO_PICKER_RUNTIME_ERROR');
      Alert.alert(
        'Logo Upload Unavailable',
        'Image picker native module is missing in this running app instance. Reinstall the latest dev build, then try Upload Logo again.',
      );
    }
  };

  const saveLayout = async (): Promise<void> => {
    setLayoutSaving(true);
    try {
      await props.onSaveReceiptLayoutSettings(layoutDraft);
      setLayoutModalOpen(false);
    } finally {
      setLayoutSaving(false);
    }
  };

  const testLayout = async (): Promise<void> => {
    setLayoutSaving(true);
    try {
      await props.onTestReceiptLayout(layoutDraft);
    } finally {
      setLayoutSaving(false);
    }
  };

  const normalizePin = (value: string): string => value.replace(/\D/g, '').slice(0, 4);
  const openPinModal = (): void => {
    setCurrentPinInput('');
    setNextPinInput('');
    setConfirmPinInput('');
    setPinFocusEpoch((value) => value + 1);
    setPinModalOpen(true);
  };

  const closePinModal = (): void => {
    if (pinSaving) {
      return;
    }
    setPinModalOpen(false);
  };

  const savePin = async (): Promise<void> => {
    const currentPin = currentPinInput.trim();
    const nextPin = nextPinInput.trim();
    const confirmPin = confirmPinInput.trim();
    if (!nextPin || nextPin.length !== 4) {
      Alert.alert('PIN Required', 'New PIN must be exactly 4 digits.');
      return;
    }
    if (props.pinConfigured && currentPin.length !== 4) {
      Alert.alert('Current PIN Required', 'Current PIN must be exactly 4 digits.');
      return;
    }
    if (nextPin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'New PIN and confirm PIN do not match.');
      return;
    }
    setPinSaving(true);
    try {
      await props.onChangePin({ currentPin, nextPin });
      setCurrentPinInput('');
      setNextPinInput('');
      setConfirmPinInput('');
      setPinModalOpen(false);
      Alert.alert('PIN Saved', props.pinConfigured ? 'PIN has been changed.' : 'PIN has been configured.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to update PIN.';
      Alert.alert('PIN Update Failed', message);
    } finally {
      setPinSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }]}>
      <Text style={[styles.title, { color: props.theme.heading }]}>Settings</Text>
      <Text style={[styles.sub, { color: props.theme.subtext }]}>Configure printer, receipt format, and device options.</Text>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Onboarding</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          Replay walkthrough or reset tutorial progress for this device.
        </Text>
        <View style={styles.rowWrap}>
          <Pressable
            onPress={props.onStartAppWalkthrough}
            style={[styles.actionBtn, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg }]}
          >
            <Text style={[styles.actionBtnText, { color: props.theme.pillText }]}>Start App Walkthrough</Text>
          </Pressable>
          <Pressable
            disabled={tutorialResetBusy}
            onPress={() => {
              setTutorialResetBusy(true);
              Promise.resolve(props.onResetTutorials()).finally(() => setTutorialResetBusy(false));
            }}
            style={[
              styles.actionBtn,
              { borderColor: props.theme.cardBorder, backgroundColor: tutorialResetBusy ? props.theme.primaryMuted : props.theme.pillBg }
            ]}
          >
            <Text style={[styles.actionBtnText, { color: tutorialResetBusy ? '#FFFFFF' : props.theme.pillText }]}>
              {tutorialResetBusy ? 'Resetting...' : 'Reset Tutorials'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Appearance</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>Choose app theme mode.</Text>
        <View style={styles.chipWrap}>
          {(['LIGHT', 'DARK'] as const).map((mode) => {
            const selected = props.themeMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => props.onChangeThemeMode(mode)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? props.theme.pillActive : props.theme.pillBg
                  }
                ]}
              >
                <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : props.theme.pillText }]}>
                  {mode === 'LIGHT' ? 'Light' : 'Dark'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>POS Defaults</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          Default LPG flow for newly added cart lines.
        </Text>
        <View style={styles.chipWrap}>
          {POS_FLOW_OPTIONS.map((option) => {
            const selected = props.posDefaultLpgFlow === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => void props.onChangePosDefaultLpgFlow(option.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? props.theme.pillActive : props.theme.pillBg
                  }
                ]}
              >
                <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : props.theme.pillText }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Security PIN</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          {props.pinConfigured ? 'Change your 4-digit offline unlock PIN.' : 'Set your 4-digit offline unlock PIN.'}
        </Text>
        <View ref={tutorialSetPin.ref} onLayout={tutorialSetPin.onLayout}>
          <Pressable
            onPress={openPinModal}
            style={[
              styles.primaryBtn,
              { backgroundColor: props.theme.primary },
              tutorialSetPin.active ? styles.tutorialTargetFocus : null
            ]}
          >
            <Text style={styles.primaryText}>{props.pinConfigured ? 'Change PIN' : 'Set PIN'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Receipt Layout</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          {layoutSummary}. Configure optional fields, spacing, and footer.
        </Text>
        <View ref={tutorialOpenLayout.ref} onLayout={tutorialOpenLayout.onLayout}>
          <Pressable
            onPress={openLayoutModal}
            style={[
              styles.secondaryBtn,
              { borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg },
              tutorialOpenLayout.active ? styles.tutorialTargetFocus : null
            ]}
          >
            <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>Open Receipt Layout Settings</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
        <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Branch Master Data</Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          Branch: {(props.selectedBranchName ?? props.selectedBranchId) || 'Not selected'}
        </Text>
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          Last Download: {props.lastMasterDataSyncAt ? new Date(props.lastMasterDataSyncAt).toLocaleString() : 'Not yet'}
        </Text>
        <Text style={[styles.helper, { color: props.updateAvailable ? '#F59E0B' : props.theme.subtext }]}>
          {props.updateAvailable ? 'Update available from admin changes.' : 'Master data is up to date.'}
        </Text>
        <View style={styles.stack}>
          <Pressable
            disabled={props.branchDataBusy}
            onPress={() => void props.onCheckBranchUpdates()}
            style={[styles.secondaryBtn, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg }]}
          >
            <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>
              {props.branchDataBusy ? 'Checking...' : 'Check for Updates'}
            </Text>
          </Pressable>
          <View
            ref={tutorialRedownloadData.ref}
            onLayout={tutorialRedownloadData.onLayout}
          >
            <Pressable
              disabled={props.branchDataBusy}
              onPress={() => void props.onRedownloadBranchData()}
              style={[
                styles.primaryBtn,
                { backgroundColor: props.branchDataBusy ? props.theme.primaryMuted : props.theme.primary },
                tutorialRedownloadData.active ? styles.tutorialTargetFocus : null
              ]}
            >
              <Text style={styles.primaryText}>{props.branchDataBusy ? 'Downloading...' : 'Redownload Branch Data'}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Text style={[styles.sub, { color: props.theme.subtext }]}>Current printer: {props.printerType}</Text>
      <Text style={[styles.sub, { color: props.theme.subtext }]}>
        Native Bridge: {props.printerCapabilities?.moduleAvailable ? 'Available' : 'Unavailable'}
      </Text>
      <Text style={[styles.sub, { color: props.theme.subtext }]}>
        iMin SDK: {props.printerCapabilities?.hasIminSdk ? 'Detected' : 'Not detected'}
      </Text>

      <View style={styles.chipWrap}>
        {PRINTER_OPTIONS.map((option) => {
          const selected = props.printerType === option.type;
          return (
            <Pressable
              key={option.type}
              disabled={props.printerBusy}
              onPress={() => void props.onSelectPrinterType(option.type)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? props.theme.pillActive : props.theme.pillBg,
                  opacity: props.printerBusy ? 0.7 : 1
                }
              ]}
            >
              <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : props.theme.pillText }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {props.printerType === 'BLUETOOTH' && (
        <View style={styles.stack}>
          <TextInput
            value={props.printerBluetoothMac}
            onChangeText={props.onChangeBluetoothMac}
            autoCapitalize="characters"
            editable={!props.printerBusy}
            placeholder="Bluetooth MAC (AA:BB:CC:DD:EE:FF)"
            placeholderTextColor={props.theme.inputPlaceholder}
            style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
          />
          <Text style={[styles.helper, { color: props.theme.subtext }]}>Format example: `00:11:22:33:44:55`.</Text>
        </View>
      )}

      {props.printerType === 'GENERIC_BUILTIN' && (
        <View style={styles.stack}>
          <TextInput
            value={props.printerTcpHost}
            onChangeText={props.onChangeTcpHost}
            autoCapitalize="none"
            editable={!props.printerBusy}
            placeholder="TCP Host (e.g. 192.168.1.50 or 192.168.1.50:9100)"
            placeholderTextColor={props.theme.inputPlaceholder}
            style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
          />
          <TextInput
            value={props.printerTcpPort}
            onChangeText={props.onChangeTcpPort}
            keyboardType="number-pad"
            editable={!props.printerBusy}
            placeholder="TCP Port (default 9100)"
            placeholderTextColor={props.theme.inputPlaceholder}
            style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
          />
          <Text style={[styles.helper, { color: props.theme.subtext }]}>
            Use TCP when printer is on the same network. If host already includes `:port`, port field is ignored.
          </Text>
        </View>
      )}

      {props.printerType === 'IMIN' && !props.printerCapabilities?.hasIminSdk ? (
        <Text style={[styles.helper, { color: props.theme.subtext }]}>
          iMin SDK is not detected in this build. Use Bluetooth/TCP ESC-POS or rebuild Dev Client with iMin SDK.
        </Text>
      ) : null}

      <View ref={tutorialSavePrinter.ref} onLayout={tutorialSavePrinter.onLayout}>
        <Pressable
          disabled={props.printerBusy}
          onPress={() => void props.onSavePrinterConfig()}
          style={[
            styles.secondaryBtn,
            { borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg },
            tutorialSavePrinter.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>{props.printerBusy ? 'Saving...' : 'Save Printer Settings'}</Text>
        </Pressable>
      </View>

      <Pressable
        disabled={props.printerBusy}
        onPress={() => void props.onTestPrint()}
        style={[styles.primaryBtn, { backgroundColor: props.printerBusy ? props.theme.primaryMuted : props.theme.primary }]}
      >
        <Text style={styles.primaryText}>{props.printerBusy ? 'Testing...' : 'Test Print (Current Layout)'}</Text>
      </Pressable>

      {props.printerMessage ? <Text style={[styles.helper, { color: props.theme.subtext }]}>{props.printerMessage}</Text> : null}

      <Modal visible={layoutModalOpen} transparent animationType="slide" onRequestClose={closeLayoutModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeLayoutModal} />
          <View style={[styles.modalCard, { backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: props.theme.heading }]}>Receipt Layout Settings</Text>
              <Pressable
                onPress={closeLayoutModal}
                disabled={layoutSaving}
                style={[styles.modalCloseBtn, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.inputBg }]}
              >
                <Text style={[styles.modalCloseText, { color: props.theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator>
              <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
                <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Header & Footer</Text>
                <ToggleRow
                  theme={props.theme}
                  title="Show Header Logo Image"
                  hint="Upload logo and print it at the top of receipt."
                  value={layoutDraft.showHeaderLogoImage}
                  onChange={(next) => updateDraft('showHeaderLogoImage', next)}
                />
                <View style={styles.logoActionsRow}>
                  <Pressable
                    onPress={() => void pickReceiptLogo()}
                    disabled={layoutSaving}
                    style={[styles.secondaryBtn, { flex: 1, borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg }]}
                  >
                    <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>
                      {layoutDraft.headerLogoImageDataUrl ? 'Replace Logo' : 'Upload Logo'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      updateDraft('headerLogoImageDataUrl', '');
                      updateDraft('showHeaderLogoImage', false);
                    }}
                    disabled={layoutSaving || !layoutDraft.headerLogoImageDataUrl}
                    style={[
                      styles.secondaryBtn,
                      {
                        minWidth: 92,
                        borderColor: props.theme.cardBorder,
                        backgroundColor: layoutDraft.headerLogoImageDataUrl ? props.theme.pillBg : props.theme.inputBg
                      }
                    ]}
                  >
                    <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>Remove</Text>
                  </Pressable>
                </View>
                {layoutDraft.headerLogoImageDataUrl ? (
                  <View style={[styles.logoPreviewWrap, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.inputBg }]}>
                    <Image source={{ uri: layoutDraft.headerLogoImageDataUrl }} style={styles.logoPreview} resizeMode="contain" />
                    <Text style={[styles.logoPreviewHint, { color: props.theme.subtext }]}>Logo preview</Text>
                  </View>
                ) : null}
                <View style={styles.logoPlacementWrap}>
                  {LOGO_PLACEMENTS.map((placement) => {
                    const selected = layoutDraft.headerLogoPlacement === placement;
                    return (
                      <Pressable
                        key={placement}
                        onPress={() => updateDraft('headerLogoPlacement', placement)}
                        style={[
                          styles.chip,
                          {
                            flex: 1,
                            minHeight: 36,
                            backgroundColor: selected ? props.theme.pillActive : props.theme.pillBg
                          }
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : props.theme.pillText }]}>
                          {placement.charAt(0) + placement.slice(1).toLowerCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <ToggleRow
                  theme={props.theme}
                  title="Show Header Text"
                  hint="Print branding text at the top."
                  value={layoutDraft.showHeaderLogoText}
                  onChange={(next) => updateDraft('showHeaderLogoText', next)}
                />
                <TextInput
                  value={layoutDraft.headerLogoText}
                  onChangeText={(value) => updateDraft('headerLogoText', value)}
                  placeholder="Header text (e.g. VMJAM LPG)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Store Contact"
                  hint="Print contact number or hotline near the header."
                  value={layoutDraft.showStoreContact}
                  onChange={(next) => updateDraft('showStoreContact', next)}
                />
                <TextInput
                  value={layoutDraft.storeContactInfo}
                  onChangeText={(value) => updateDraft('storeContactInfo', value)}
                  placeholder="Store contact (e.g. 0917-000-0000 / 02-1234-5678)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Store Address"
                  hint="Print store address under the header area."
                  value={layoutDraft.showStoreAddress}
                  onChange={(next) => updateDraft('showStoreAddress', next)}
                />
                <TextInput
                  value={layoutDraft.storeAddress}
                  onChangeText={(value) => updateDraft('storeAddress', value)}
                  placeholder="Store address"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  multiline
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText, minHeight: 68 }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Business TIN"
                  hint="Print tax ID or business TIN info."
                  value={layoutDraft.showBusinessTin}
                  onChange={(next) => updateDraft('showBusinessTin', next)}
                />
                <TextInput
                  value={layoutDraft.businessTin}
                  onChangeText={(value) => updateDraft('businessTin', value)}
                  placeholder="Business TIN (optional)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Permit / OR Info"
                  hint="Print permit, OR, or registration details."
                  value={layoutDraft.showPermitOrInfo}
                  onChange={(next) => updateDraft('showPermitOrInfo', next)}
                />
                <TextInput
                  value={layoutDraft.permitOrInfo}
                  onChangeText={(value) => updateDraft('permitOrInfo', value)}
                  placeholder="Permit / OR info (optional)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  multiline
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText, minHeight: 52 }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Terminal Name"
                  hint="Print device or terminal label."
                  value={layoutDraft.showTerminalName}
                  onChange={(next) => updateDraft('showTerminalName', next)}
                />
                <TextInput
                  value={layoutDraft.terminalName}
                  onChangeText={(value) => updateDraft('terminalName', value)}
                  placeholder="Terminal name (e.g. Counter 1)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Cashier Role"
                  hint="Print role title below cashier line."
                  value={layoutDraft.showCashierRole}
                  onChange={(next) => updateDraft('showCashierRole', next)}
                />
                <TextInput
                  value={layoutDraft.cashierRoleLabel}
                  onChangeText={(value) => updateDraft('cashierRoleLabel', value)}
                  placeholder="Cashier role label (e.g. Senior Cashier)"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
                <ToggleRow
                  theme={props.theme}
                  title="Show Footer"
                  hint="Print footer message."
                  value={layoutDraft.showFooter}
                  onChange={(next) => updateDraft('showFooter', next)}
                />
                <TextInput
                  value={layoutDraft.footerText}
                  onChangeText={(value) => updateDraft('footerText', value)}
                  placeholder="Footer message"
                  placeholderTextColor={props.theme.inputPlaceholder}
                  style={[styles.input, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
                />
              </View>

              <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
                <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Receipt Spacing</Text>
                <View style={styles.paddingRow}>
                  <Text style={[styles.paddingLabel, { color: props.theme.subtext }]}>Top Margin Lines</Text>
                  <View style={styles.paddingControl}>
                    <Pressable
                      style={[styles.padBtn, { backgroundColor: props.theme.pillBg }]}
                      onPress={() => updateDraft('topPaddingLines', clampPadding(layoutDraft.topPaddingLines - 1))}
                    >
                      <Text style={[styles.padBtnText, { color: props.theme.pillText }]}>-</Text>
                    </Pressable>
                    <Text style={[styles.padValue, { color: props.theme.heading }]}>{layoutDraft.topPaddingLines}</Text>
                    <Pressable
                      style={[styles.padBtn, { backgroundColor: props.theme.pillBg }]}
                      onPress={() => updateDraft('topPaddingLines', clampPadding(layoutDraft.topPaddingLines + 1))}
                    >
                      <Text style={[styles.padBtnText, { color: props.theme.pillText }]}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.paddingRow}>
                  <Text style={[styles.paddingLabel, { color: props.theme.subtext }]}>Bottom Margin Lines</Text>
                  <View style={styles.paddingControl}>
                    <Pressable
                      style={[styles.padBtn, { backgroundColor: props.theme.pillBg }]}
                      onPress={() => updateDraft('bottomPaddingLines', clampPadding(layoutDraft.bottomPaddingLines - 1))}
                    >
                      <Text style={[styles.padBtnText, { color: props.theme.pillText }]}>-</Text>
                    </Pressable>
                    <Text style={[styles.padValue, { color: props.theme.heading }]}>{layoutDraft.bottomPaddingLines}</Text>
                    <Pressable
                      style={[styles.padBtn, { backgroundColor: props.theme.pillBg }]}
                      onPress={() => updateDraft('bottomPaddingLines', clampPadding(layoutDraft.bottomPaddingLines + 1))}
                    >
                      <Text style={[styles.padBtnText, { color: props.theme.pillText }]}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={[styles.group, { borderColor: props.theme.cardBorder }]}>
                <Text style={[styles.groupTitle, { color: props.theme.heading }]}>Optional Fields</Text>
                {LAYOUT_TOGGLE_ITEMS.filter(
                  (item) =>
                    item.key !== 'showHeaderLogoText' &&
                    item.key !== 'showHeaderLogoImage' &&
                    item.key !== 'showFooter' &&
                    item.key !== 'showCashierRole'
                ).map((item) => (
                  <ToggleRow
                    key={item.key}
                    theme={props.theme}
                    title={item.label}
                    hint={item.hint}
                    value={Boolean(layoutDraft[item.key])}
                    onChange={(next) => updateDraft(item.key, next as never)}
                  />
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => void testLayout()}
                disabled={layoutSaving || props.printerBusy}
                style={[styles.secondaryBtn, { flex: 1, borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg }]}
              >
                <Text style={[styles.secondaryText, { color: props.theme.pillText }]}>
                  {layoutSaving ? 'Testing...' : 'Test Layout Print'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void saveLayout()}
                disabled={layoutSaving}
                style={[styles.primaryBtn, { flex: 1, backgroundColor: layoutSaving ? props.theme.primaryMuted : props.theme.primary }]}
              >
                <Text style={styles.primaryText}>{layoutSaving ? 'Saving...' : 'Save Layout'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pinModalOpen} transparent animationType="fade" onRequestClose={closePinModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closePinModal} />
          <View style={[styles.pinModalCard, { backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: props.theme.heading }]}>
                {props.pinConfigured ? 'Change PIN' : 'Set PIN'}
              </Text>
              <Pressable
                onPress={closePinModal}
                disabled={pinSaving}
                style={[styles.modalCloseBtn, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.inputBg }]}
              >
                <Text style={[styles.modalCloseText, { color: props.theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <Text style={[styles.helper, { color: props.theme.subtext }]}>
              Use a 4-digit PIN for fast offline unlock.
            </Text>

            {props.pinConfigured ? (
              <View>
                <Text style={[styles.pinFieldLabel, { color: props.theme.subtext }]}>Current PIN</Text>
                <PinCodeInput
                  key={`pin-current-${pinFocusEpoch}`}
                  value={currentPinInput}
                  onChange={(value) => setCurrentPinInput(normalizePin(value))}
                  editable={!pinSaving}
                  autoFocus
                  theme={props.theme}
                />
              </View>
            ) : null}

            <View>
              <Text style={[styles.pinFieldLabel, { color: props.theme.subtext }]}>New PIN (4 digits)</Text>
              <PinCodeInput
                key={`pin-next-${pinFocusEpoch}`}
                value={nextPinInput}
                onChange={(value) => setNextPinInput(normalizePin(value))}
                editable={!pinSaving}
                autoFocus={!props.pinConfigured}
                theme={props.theme}
              />
            </View>
            <View>
              <Text style={[styles.pinFieldLabel, { color: props.theme.subtext }]}>Confirm New PIN</Text>
              <PinCodeInput
                value={confirmPinInput}
                onChange={(value) => setConfirmPinInput(normalizePin(value))}
                editable={!pinSaving}
                theme={props.theme}
              />
            </View>

            <Pressable
              onPress={() => void savePin()}
              disabled={pinSaving}
              style={[styles.primaryBtn, { backgroundColor: pinSaving ? props.theme.primaryMuted : props.theme.primary }]}
            >
              <Text style={styles.primaryText}>
                {pinSaving ? 'Saving PIN...' : props.pinConfigured ? 'Save New PIN' : 'Save PIN'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  group: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '800'
  },
  stack: {
    gap: 8
  },
  helper: {
    fontSize: 12
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  actionBtn: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700'
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    borderRadius: 999,
    minHeight: 40,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700'
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14
  },
  primaryBtn: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondaryText: {
    fontWeight: '700',
    fontSize: 13
  },
  primaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 15, 27, 0.62)'
  },
  modalCard: {
    maxHeight: '90%',
    minHeight: '72%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800'
  },
  modalCloseBtn: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  modalScroll: {
    flex: 1
  },
  modalContent: {
    gap: 10,
    paddingBottom: 8
  },
  toggleRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  toggleTitle: {
    fontSize: 12,
    fontWeight: '700'
  },
  toggleHint: {
    marginTop: 1,
    fontSize: 11
  },
  toggleButtons: {
    flexDirection: 'row',
    gap: 6
  },
  toggleBtn: {
    minWidth: 46,
    minHeight: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: '800'
  },
  paddingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  paddingLabel: {
    fontSize: 12,
    fontWeight: '700'
  },
  paddingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  padBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  padBtnText: {
    fontSize: 16,
    fontWeight: '800'
  },
  padValue: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8
  },
  pinModalCard: {
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 14,
    marginBottom: 24,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  pinFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6
  },
  logoActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  logoPreviewWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4
  },
  logoPreview: {
    width: 120,
    height: 60
  },
  logoPreviewHint: {
    fontSize: 11
  },
  logoPlacementWrap: {
    flexDirection: 'row',
    gap: 8
  }
});

