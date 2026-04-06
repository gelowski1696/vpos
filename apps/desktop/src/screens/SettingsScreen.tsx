import { useEffect, useMemo, useState } from 'react';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import type {
  DesktopAppState,
  DesktopOption,
  DesktopPrinterProfile,
  DesktopReceiptLayoutSettings,
  DesktopSetupState
} from '../db/schema';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { listNativePrinters } from '../services/desktop-printer.bridge';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSessionService } from '../services/desktop-session.service';
import { desktopSettingsService } from '../services/desktop-settings.service';
import { desktopUpdaterService, type DesktopUpdateCheckResult } from '../services/desktop-updater.service';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { DesktopPinCodeInput } from '../components/feedback/DesktopPinCodeInput';
import { useDesktopTutorialTarget } from '../tutorial/tutorial-provider';

type Props = {
  state: DesktopAppState;
  onStateReload: () => Promise<void>;
  onStartWalkthrough?: () => void;
  onResetLocalData?: () => Promise<void>;
};

function copySetup(setup: DesktopSetupState): DesktopSetupState {
  return { ...setup };
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not tested yet';
  }
  return new Date(value).toLocaleString();
}

function copyProfileToSetup(profile: DesktopPrinterProfile, setup: DesktopSetupState): DesktopSetupState {
  return {
    ...setup,
    printerMode: profile.mode,
    printerName: profile.printerName,
    printerHost: profile.printerHost,
    printerPort: profile.printerPort
  };
}

const RECEIPT_TOGGLE_ITEMS: Array<{
  key:
    | 'showHeaderLogoText'
    | 'showBranch'
    | 'showLocation'
    | 'showCashier'
    | 'showCashierRole'
    | 'showOrderType'
    | 'showCustomer'
    | 'showPersonnel'
    | 'showHelper'
    | 'showItemCode'
    | 'showPaymentMode'
    | 'showSubtotal'
    | 'showDiscount'
    | 'showTotal'
    | 'showPaid'
    | 'showChange'
    | 'showCreditDue'
    | 'showFooter';
  label: string;
}> = [
  { key: 'showHeaderLogoText', label: 'Header Text' },
  { key: 'showBranch', label: 'Branch' },
  { key: 'showLocation', label: 'Location' },
  { key: 'showCashier', label: 'Cashier' },
  { key: 'showCashierRole', label: 'Cashier Role' },
  { key: 'showOrderType', label: 'Order Type' },
  { key: 'showCustomer', label: 'Customer' },
  { key: 'showPersonnel', label: 'Personnel' },
  { key: 'showHelper', label: 'Helper' },
  { key: 'showItemCode', label: 'Item Code' },
  { key: 'showPaymentMode', label: 'Payment Mode' },
  { key: 'showSubtotal', label: 'Subtotal' },
  { key: 'showDiscount', label: 'Discount' },
  { key: 'showTotal', label: 'Total' },
  { key: 'showPaid', label: 'Paid' },
  { key: 'showChange', label: 'Change' },
  { key: 'showCreditDue', label: 'Credit Due' },
  { key: 'showFooter', label: 'Footer' }
];

const POS_FLOW_OPTIONS = [
  { value: 'NONE', label: 'Require per item' },
  { value: 'REFILL_EXCHANGE', label: 'Refill' },
  { value: 'NON_REFILL', label: 'Non-Refill' }
] as const;

const PRINTER_MODE_OPTIONS = [
  { value: 'USB', label: 'USB' },
  { value: 'LAN', label: 'LAN' },
  { value: 'NONE', label: 'None Yet' }
] as const;

const screenStackClass = 'flex flex-col gap-5';
const settingsStackClass = 'flex flex-col gap-5';
const settingsSectionClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const settingsHeadClass = 'flex flex-col gap-2';
const settingsHelperClass = 'text-[0.94rem] leading-6 text-[var(--muted)]';
const settingsCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_24px_rgba(17,40,58,0.04)]';
const settingsSubheadClass = 'grid gap-1';
const settingsStatusRowClass = 'grid gap-3';
const settingsStatusGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const settingsActionRowClass = 'flex flex-wrap gap-3';
const settingsChipRowClass = 'flex flex-wrap gap-2';
const settingsModalBackdropClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm';
const settingsModalCardClass =
  'flex max-h-[min(90vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-strong)]';
const settingsModalToolbarClass =
  'flex shrink-0 flex-col gap-4 border-b border-[var(--border-soft)] bg-[rgba(248,251,255,0.98)] px-5 py-4';

export function SettingsScreen({ state, onStateReload, onStartWalkthrough, onResetLocalData }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const pinTarget = useDesktopTutorialTarget('settings-set-pin');
  const layoutTarget = useDesktopTutorialTarget('settings-open-layout');
  const redownloadTarget = useDesktopTutorialTarget('settings-redownload-data');
  const printerSaveTarget = useDesktopTutorialTarget('settings-save-printer');
  const [form, setForm] = useState<DesktopSetupState>(copySetup(state.setup));
  const [password, setPassword] = useState('');
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinFocusEpoch, setPinFocusEpoch] = useState(0);
  const [pinSaving, setPinSaving] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<DesktopReceiptLayoutSettings>(state.receiptLayout);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [tutorialResetBusy, setTutorialResetBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [branchOptions, setBranchOptions] = useState<DesktopOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<DesktopOption[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [discoveringPrinters, setDiscoveringPrinters] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<string[]>([]);
  const [profileLabel, setProfileLabel] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [appVersion, setAppVersion] = useState(state.version.toString());
  const [updateResult, setUpdateResult] = useState<DesktopUpdateCheckResult | null>(null);
  const [message, setMessage] = useState('Sign in once on this device, then refresh the local branch data for desktop POS.');

  const announce = (nextMessage: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone });
  };

  useEffect(() => {
    setForm(copySetup(state.setup));
  }, [state.setup]);

  useEffect(() => {
    setLayoutDraft(state.receiptLayout);
  }, [state.receiptLayout]);

  useEffect(() => {
    if (signingIn) {
      desktopUi.setLoading({ visible: true, label: 'Signing in desktop workstation...' });
      return;
    }
    if (syncingCatalog) {
      desktopUi.setLoading({ visible: true, label: 'Refreshing branch data...' });
      return;
    }
    if (testingPrinter) {
      desktopUi.setLoading({ visible: true, label: 'Testing printer path...' });
      return;
    }
    if (checkingForUpdate) {
      desktopUi.setLoading({ visible: true, label: 'Checking for desktop updates...' });
      return;
    }
    if (installingUpdate) {
      desktopUi.setLoading({ visible: true, label: 'Installing desktop update...' });
      return;
    }
    if (discoveringPrinters) {
      desktopUi.setLoading({ visible: true, label: 'Discovering installed printers...' });
      return;
    }
    if (savingProfile) {
      desktopUi.setLoading({ visible: true, label: 'Saving printer profile...' });
      return;
    }
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving workstation setup...' });
      return;
    }
    if (pinSaving) {
      desktopUi.setLoading({ visible: true, label: 'Saving PIN...' });
      return;
    }
    if (layoutSaving) {
      desktopUi.setLoading({ visible: true, label: 'Saving receipt layout...' });
      return;
    }
    if (resetBusy) {
      desktopUi.setLoading({ visible: true, label: 'Clearing local desktop data...' });
      return;
    }
    desktopUi.clearLoading();
  }, [checkingForUpdate, desktopUi, discoveringPrinters, installingUpdate, layoutSaving, pinSaving, resetBusy, saving, savingProfile, signingIn, syncingCatalog, testingPrinter]);

  useEffect(() => {
    return () => {
      desktopUi.clearLoading();
    };
  }, [desktopUi]);

  useEffect(() => {
    let active = true;
    async function loadVersion(): Promise<void> {
      try {
        const version = await desktopUpdaterService.getCurrentVersion();
        if (active) {
          setAppVersion(version);
        }
      } catch {
        if (active) {
          setAppVersion(state.version.toString());
        }
      }
    }
    void loadVersion();
    return () => {
      active = false;
    };
  }, [state.version]);

  useEffect(() => {
    let active = true;
    async function loadBranches(): Promise<void> {
      if (!state.auth.accessToken || !form.clientId || !form.apiBaseUrl) {
        if (active) {
          setBranchOptions([]);
        }
        return;
      }
      try {
        const result = await desktopMasterDataService.fetchBranchOptions({
          ...state,
          setup: {
            ...state.setup,
            ...form
          }
        });
        if (active) {
          setBranchOptions(result.options);
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Unable to load branches.');
        }
      }
    }
    void loadBranches();
    return () => {
      active = false;
    };
  }, [state.auth.accessToken, form.clientId, form.apiBaseUrl, form.branchId, form.locationId]);

  useEffect(() => {
    let active = true;
    async function loadLocations(): Promise<void> {
      if (!state.auth.accessToken || !form.clientId || !form.apiBaseUrl || !form.branchId) {
        if (active) {
          setLocationOptions([]);
        }
        return;
      }
      try {
        const result = await desktopMasterDataService.fetchLocationOptions(
          {
            ...state,
            setup: {
              ...state.setup,
              ...form
            }
          },
          form.branchId
        );
        if (active) {
          setLocationOptions(result.options);
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Unable to load locations.');
        }
      }
    }
    void loadLocations();
    return () => {
      active = false;
    };
  }, [state.auth.accessToken, form.clientId, form.apiBaseUrl, form.branchId]);

  const branchLabel = useMemo(
    () => branchOptions.find((option) => option.id === form.branchId)?.label ?? form.branchLabel,
    [branchOptions, form.branchId, form.branchLabel]
  );
  const locationLabel = useMemo(
    () => locationOptions.find((option) => option.id === form.locationId)?.label ?? form.locationLabel,
    [locationOptions, form.locationId, form.locationLabel]
  );

  const selectedProfile = state.printerProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const pinConfigured = desktopSessionService.hasPinConfigured(state);
  const needsSetupAttention =
    !state.auth.accessToken ||
    !form.apiBaseUrl ||
    !form.clientId ||
    !form.branchId ||
    !form.locationId ||
    !form.deviceId ||
    !form.authEmail;

  const buildProfile = (existing?: DesktopPrinterProfile | null): DesktopPrinterProfile => ({
    id: existing?.id ?? `printer-profile-${Date.now()}`,
    label: profileLabel.trim(),
    mode: form.printerMode === 'LAN' ? 'LAN' : 'USB',
    printerName: form.printerName,
    printerHost: form.printerHost,
    printerPort: form.printerPort,
    lastTestedAt: existing?.lastTestedAt ?? null,
    lastSuccessAt: existing?.lastSuccessAt ?? null,
    lastTestStatus: existing?.lastTestStatus ?? 'idle',
    lastTestMessage: existing?.lastTestMessage ?? null
  });

  const saveProfilesState = async (profiles: DesktopPrinterProfile[], syncMessage?: string): Promise<void> => {
    const current = await desktopSettingsService.getState();
    const nextState: DesktopAppState = {
      ...current,
      setup: {
        ...current.setup,
        ...form,
        branchLabel,
        locationLabel
      },
      printerProfiles: profiles,
      sync: syncMessage
        ? {
            ...current.sync,
            lastSyncMessage: syncMessage
          }
        : current.sync
    };
    await desktopSettingsService.saveState(nextState);
    await onStateReload();
  };

  const persistProfile = async (): Promise<DesktopPrinterProfile | null> => {
    const trimmed = profileLabel.trim();
    if (!trimmed) {
      setMessage('Enter a printer profile name first.');
      return null;
    }
    if (form.printerMode === 'NONE') {
      setMessage('Choose USB or LAN before saving a printer profile.');
      return null;
    }
    if (form.printerMode === 'USB' && !form.printerName.trim()) {
      setMessage('Select or enter a USB printer name before saving this profile.');
      return null;
    }
    if (form.printerMode === 'LAN' && !form.printerHost.trim()) {
      setMessage('Enter the LAN printer host before saving this profile.');
      return null;
    }

    setSavingProfile(true);
    try {
      const current = await desktopSettingsService.getState();
      const existing = current.printerProfiles.find((entry) => entry.id === selectedProfileId) ??
        current.printerProfiles.find((entry) => entry.label.toLowerCase() === trimmed.toLowerCase()) ??
        null;
      const profile = buildProfile(existing);
      const nextProfiles = [...current.printerProfiles.filter((entry) => entry.id !== profile.id && entry.label.toLowerCase() !== trimmed.toLowerCase()), profile];
      await saveProfilesState(nextProfiles, `Saved printer profile "${profile.label}" for this desktop station.`);
      setSelectedProfileId(profile.id);
      setMessage(`Saved printer profile "${profile.label}" for this desktop station.`);
      return profile;
    } finally {
      setSavingProfile(false);
    }
  };

  const recordPrinterTestResult = async (
    profileId: string | null,
    success: boolean,
    resultMessage: string
  ): Promise<void> => {
    if (!profileId) {
      return;
    }
    const current = await desktopSettingsService.getState();
    const testedAt = new Date().toISOString();
    const nextProfiles = current.printerProfiles.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            lastTestedAt: testedAt,
            lastSuccessAt: success ? testedAt : profile.lastSuccessAt,
            lastTestStatus: (success ? 'success' : 'error') as DesktopPrinterProfile['lastTestStatus'],
            lastTestMessage: resultMessage
          }
        : profile
    );
    await saveProfilesState(nextProfiles);
  };

  const runPrinterTest = async (overrideProfile?: DesktopPrinterProfile | null): Promise<void> => {
    setTestingPrinter(true);
    const draftState: DesktopAppState = {
      ...state,
      setup: {
        ...state.setup,
        ...form,
        ...(overrideProfile ? copyProfileToSetup(overrideProfile, form) : {}),
        branchLabel,
        locationLabel
      }
    };
    try {
      await desktopReceiptService.testPrinter(draftState);
      const successMessage = overrideProfile
        ? `Printer test was sent using "${overrideProfile.label}".`
        : 'Printer test was sent. If nothing came out, check the selected USB printer name or LAN host and port.';
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), true, successMessage);
      setMessage(successMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to run printer test on this desktop station.';
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), false, errorMessage);
      setMessage(errorMessage);
    } finally {
      setTestingPrinter(false);
    }
  };

  const normalizePin = (value: string): string => value.replace(/\D/g, '').slice(0, 4);

  const openPinModal = (): void => {
    setCurrentPin('');
    setNextPin('');
    setConfirmPin('');
    setPinFocusEpoch((value) => value + 1);
    setPinModalOpen(true);
  };

  const handleSavePin = async (): Promise<void> => {
    const normalizedCurrent = currentPin.trim();
    const normalizedNext = nextPin.trim();
    const normalizedConfirm = confirmPin.trim();

    if (normalizedNext.length !== 4) {
      announce('New PIN must be exactly 4 digits.', 'warning');
      return;
    }
    if (pinConfigured && normalizedCurrent.length !== 4) {
      announce('Current PIN is required before changing it.', 'warning');
      return;
    }
    if (normalizedNext !== normalizedConfirm) {
      announce('New PIN and confirm PIN do not match.', 'warning');
      return;
    }

    setPinSaving(true);
    try {
      if (pinConfigured) {
        const valid = await desktopSessionService.unlock(state, normalizedCurrent);
        if (!valid) {
          announce('Current PIN is incorrect.', 'error');
          return;
        }
      }
      const nextState = await desktopSessionService.setPin(state, normalizedNext);
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setPinModalOpen(false);
      setCurrentPin('');
      setNextPin('');
      setConfirmPin('');
      announce(pinConfigured ? 'PIN was updated for this workstation.' : 'PIN was added for this workstation.', 'success');
    } finally {
      setPinSaving(false);
    }
  };

  const updateLayoutDraft = <K extends keyof DesktopReceiptLayoutSettings>(
    key: K,
    value: DesktopReceiptLayoutSettings[K]
  ): void => {
    setLayoutDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const clampPadding = (value: number): number => {
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
  };

  const handleSaveLayout = async (): Promise<void> => {
    setLayoutSaving(true);
    try {
      await desktopSettingsService.saveReceiptLayoutSettings(layoutDraft);
      await onStateReload();
      setLayoutModalOpen(false);
      announce('Receipt layout was saved for this workstation.', 'success');
    } finally {
      setLayoutSaving(false);
    }
  };

  const handleTestLayout = async (): Promise<void> => {
    setLayoutSaving(true);
    try {
      await desktopReceiptService.testReceiptLayout(layoutDraft, {
        ...state,
        setup: {
          ...state.setup,
          ...form,
          branchLabel,
          locationLabel
        },
        receiptLayout: layoutDraft
      });
      announce('Layout test was sent to the current printer path.', 'success');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to test this receipt layout.', 'error');
    } finally {
      setLayoutSaving(false);
    }
  };

  const handleResetWalkthrough = async (): Promise<void> => {
    setTutorialResetBusy(true);
    try {
      await desktopSettingsService.updateWalkthrough({
        completedAt: null,
        dismissedAt: null
      });
      await onStateReload();
      announce('Desktop walkthrough progress was reset.', 'success');
    } finally {
      setTutorialResetBusy(false);
    }
  };

  const handleSignIn = async (): Promise<void> => {
    if (!form.apiBaseUrl || !form.authEmail || !password || !form.deviceId) {
      setMessage('Fill in API URL, email, password, and device ID first.');
      return;
    }

    setSigningIn(true);
    try {
      const session = await desktopAuthService.login(
        form.apiBaseUrl,
        form.authEmail,
        password,
        form.clientId,
        form.deviceId
      );
      const nextState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          ...form,
          clientId: session.clientId || form.clientId,
          branchLabel,
          locationLabel
        },
        auth: {
          ...state.auth,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          signedInAt: session.signedInAt,
          userEmail: form.authEmail.trim() || state.auth.userEmail,
          userFullName: state.auth.userFullName
        },
        sync: {
          ...state.sync,
          lastSyncStatus: 'idle',
          lastSyncMessage: 'Desktop sign-in succeeded. You can now refresh branch master data.'
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setPassword('');
      setMessage('Desktop sign-in succeeded. Next step: choose branch/location and refresh the local branch data.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Desktop sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleRefreshCatalog = async (): Promise<void> => {
    if (!state.auth.accessToken) {
      setMessage('Sign in first so the desktop app can load protected master data.');
      return;
    }
    if (!form.branchId) {
      setMessage('Choose a branch before refreshing the desktop branch data.');
      return;
    }
    setSyncingCatalog(true);
    try {
      const result = await desktopMasterDataService.syncCatalog(
        {
          ...state,
          setup: {
            ...state.setup,
            ...form
          }
        },
        form.branchId
      );
      const nextState: DesktopAppState = {
        ...result.state,
        setup: {
          ...result.state.setup,
          ...form,
          branchLabel,
          locationLabel
        },
        sync: {
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
            lastSyncMessage: `Desktop branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, ${result.salesCount} sales, and ${result.transferCount} transfers were cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setMessage(
        `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, ${result.lendingCount} lending records, ${result.salesCount} sales, and ${result.transferCount} transfers are now available offline on this desktop.`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to refresh branch data.';
      const nextState: DesktopAppState = {
        ...state,
        sync: {
          lastSyncedAt: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncMessage: detail
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      setMessage(detail);
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleDiscoverPrinters = async (): Promise<void> => {
    setDiscoveringPrinters(true);
    try {
      const printers = await listNativePrinters();
      setDiscoveredPrinters(printers);
      setMessage(
        printers.length > 0
          ? `Found ${printers.length} installed printer${printers.length === 1 ? '' : 's'} on this desktop station.`
          : 'No installed printers were discovered on this desktop station.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to discover installed printers on this desktop.');
    } finally {
      setDiscoveringPrinters(false);
    }
  };

  const applyProfile = (profile: DesktopPrinterProfile): void => {
    setForm((prev) => copyProfileToSetup(profile, prev));
    setProfileLabel(profile.label);
    setSelectedProfileId(profile.id);
    setMessage(`Applied printer profile "${profile.label}" to this desktop setup form.`);
  };

  const handleDeletePrinterProfile = async (profileId: string): Promise<void> => {
    const current = await desktopSettingsService.getState();
    const nextProfiles = current.printerProfiles.filter((entry) => entry.id !== profileId);
    await saveProfilesState(nextProfiles);
    if (selectedProfileId === profileId) {
      setSelectedProfileId('');
    }
    setMessage('Removed the selected printer profile from this desktop station.');
  };

  const handleSaveSetup = async (): Promise<void> => {
    setSaving(true);
    try {
      await desktopSettingsService.completeSetup({
        ...form,
        branchLabel,
        locationLabel
      });
      await onStateReload();
      setMessage('Desktop setup saved. The POS screen will now use your selected branch and local product/customer cache.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePosDefaults = async (): Promise<void> => {
    setSaving(true);
    try {
      const current = await desktopSettingsService.getState();
      const nextState: DesktopAppState = {
        ...current,
        setup: {
          ...current.setup,
          ...form,
          branchLabel,
          locationLabel
        }
      };
      await desktopSettingsService.saveState(nextState);
      await onStateReload();
      announce('POS defaults were saved for this workstation.', 'success');
    } finally {
      setSaving(false);
    }
  };

  const handleResetLocalData = async (): Promise<void> => {
    if (!onResetLocalData) {
      return;
    }
    setResetBusy(true);
    try {
      await onResetLocalData();
      setResetConfirmOpen(false);
    } finally {
      setResetBusy(false);
    }
  };

  const handleCheckForUpdates = async (): Promise<void> => {
    setCheckingForUpdate(true);
    try {
      const result = await desktopUpdaterService.checkForUpdate();
      setAppVersion(result.currentVersion);
      setUpdateResult(result);
      if (!result.supported) {
        announce('OTA updates are available from the installed desktop build.', 'warning');
        return;
      }
      if (result.available && result.manifest) {
        announce(`Update ${result.manifest.version} is available for this desktop station.`, 'success');
      } else {
        announce(`VPOS Desktop ${result.currentVersion} is already up to date.`, 'info');
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to check for updates right now.', 'error');
    } finally {
      setCheckingForUpdate(false);
    }
  };

  const handleInstallUpdate = async (): Promise<void> => {
    if (!updateResult?.available || !updateResult.manifest) {
      announce('Check for updates first before installing a desktop update.', 'warning');
      return;
    }

    setInstallingUpdate(true);
    try {
      await desktopUpdaterService.installAvailableUpdate((event) => {
        if (event.status === 'PENDING') {
          setMessage('Downloading and preparing the desktop update...');
        }
        if (event.status === 'ERROR') {
          setMessage(event.error || 'Desktop update failed.');
        }
      });
      announce(`Desktop update ${updateResult.manifest.version} was installed. The app may restart to finish applying it.`, 'success');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to install the desktop update.', 'error');
    } finally {
      setInstallingUpdate(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="settings"
        title="Settings"
        description="Configure printer, receipt format, and device options."
      />
      <div className={settingsStackClass}>
        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Onboarding</div>
            <h3>Walkthrough</h3>
          </div>
          <p className={settingsHelperClass}>Replay walkthrough or reset tutorial progress for this device.</p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Walkthrough Status</strong>
              <span>Run the guided spotlight tour again if this device needs a quick refresh for staff.</span>
            </div>
            <div className={settingsStatusRowClass}>
              <div className="customer-detail-card">
                <span>Status</span>
                <strong>{state.walkthrough.completedAt ? 'Completed' : 'Not Completed'}</strong>
              </div>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => onStartWalkthrough?.()}>
                Start App Walkthrough
              </button>
              <button className="secondary-btn" type="button" onClick={() => void handleResetWalkthrough()} disabled={tutorialResetBusy}>
                {tutorialResetBusy ? 'Resetting...' : 'Reset Walkthrough'}
              </button>
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">POS Defaults</div>
            <h3>Default LPG Flow</h3>
          </div>
          <p className={settingsHelperClass}>Default LPG flow for newly added cart lines.</p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>New LPG Cart Lines</strong>
              <span>Choose the default flow that desktop POS should use before the cashier changes it line by line.</span>
            </div>
            <div className={settingsChipRowClass}>
              {POS_FLOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`filter-chip ${form.posDefaultLpgFlow === option.value ? 'active' : ''}`}
                  onClick={() => setForm((prev) => ({ ...prev, posDefaultLpgFlow: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => void handleSavePosDefaults()} disabled={saving}>
                {saving ? 'Saving...' : 'Save POS Defaults'}
              </button>
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Security PIN</div>
            <h3>Offline Unlock</h3>
          </div>
          <p className={settingsHelperClass}>
            {pinConfigured ? 'Change your 4-digit offline unlock PIN.' : 'Set your 4-digit offline unlock PIN.'}
          </p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Offline Unlock PIN</strong>
              <span>Use a 4-digit PIN so the cashier can reopen the desktop app quickly while staying offline.</span>
            </div>
            <div className={settingsStatusRowClass}>
              <div className="customer-detail-card">
                <span>PIN Status</span>
                <strong>{pinConfigured ? 'Configured' : 'Not Set'}</strong>
              </div>
            </div>
            <div className={settingsActionRowClass}>
              <button
                ref={pinTarget.ref}
                className={`primary-btn ${pinTarget.active ? 'tutorial-target-active' : ''}`}
                type="button"
                onClick={openPinModal}
              >
                {pinConfigured ? 'Change PIN' : 'Set PIN'}
              </button>
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Receipt Layout</div>
            <h3>Printed Receipt</h3>
          </div>
          <p className={settingsHelperClass}>
            {state.receiptLayout.headerLogoText || 'Not set'} | Show or hide key receipt details, update header and footer text, then send a test print.
          </p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Printed Receipt Layout</strong>
              <span>Open the receipt sheet to adjust branding, printed fields, spacing, and run a quick test print.</span>
            </div>
            <div className={settingsActionRowClass}>
              <button
                ref={layoutTarget.ref}
                className={`secondary-btn ${layoutTarget.active ? 'tutorial-target-active' : ''}`}
                type="button"
                onClick={() => setLayoutModalOpen(true)}
              >
                Open Receipt Layout Settings
              </button>
              <button className="secondary-btn" type="button" onClick={() => void handleTestLayout()} disabled={layoutSaving}>
                {layoutSaving ? 'Testing...' : 'Test Layout Print'}
              </button>
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Branch Master Data</div>
            <h3>Download Local Branch Data</h3>
          </div>
          <p className={settingsHelperClass}>
            Sign in this workstation, choose branch and location, then refresh the local branch data before using desktop POS.
          </p>
          <div className={settingsStatusGridClass}>
            <div className="customer-detail-card">
              <span>Branch</span>
              <strong>{branchLabel || 'Not selected'}</strong>
            </div>
            <div className="customer-detail-card">
              <span>Location</span>
              <strong>{locationLabel || 'Not selected'}</strong>
            </div>
            <div className="customer-detail-card">
              <span>Last Download</span>
              <strong>{state.sync.lastSyncedAt ? formatDateTime(state.sync.lastSyncedAt) : 'Not yet'}</strong>
            </div>
            <div className="customer-detail-card">
              <span>Status</span>
              <strong>{state.sync.lastSyncStatus === 'success' ? 'Up to date' : state.sync.lastSyncStatus === 'error' ? 'Needs attention' : 'Not downloaded'}</strong>
            </div>
          </div>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Workstation Setup</strong>
              <span>These details stay on this device so the cashier can keep working locally even after restart.</span>
            </div>
            {needsSetupAttention ? (
              <div className="settings-form-grid">
                <label>
                  <span>Operator name</span>
                  <input value={form.operatorName} onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))} placeholder="Cashier or operator" />
                </label>
                <label>
                  <span>API base URL</span>
                  <input value={form.apiBaseUrl} onChange={(event) => setForm((prev) => ({ ...prev, apiBaseUrl: event.target.value }))} placeholder="https://vmjamtech.com/api" />
                </label>
                <label>
                  <span>Tenant client ID</span>
                  <input value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))} placeholder="DEMO or tenant code" />
                </label>
                <label>
                  <span>Desktop sign-in email</span>
                  <input value={form.authEmail} onChange={(event) => setForm((prev) => ({ ...prev, authEmail: event.target.value }))} placeholder="cashier@branch.local" />
                </label>
                <label>
                  <span>Desktop sign-in password</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
                </label>
                <label>
                  <span>Device ID</span>
                  <input value={form.deviceId} onChange={(event) => setForm((prev) => ({ ...prev, deviceId: event.target.value }))} placeholder="desktop-main-counter" />
                </label>
                <label>
                  <span>Branch</span>
                  <select
                    value={form.branchId}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        branchId: event.target.value,
                        branchLabel: branchOptions.find((option) => option.id === event.target.value)?.label ?? '',
                        locationId: '',
                        locationLabel: ''
                      }))
                    }
                  >
                    <option value="">Select branch</option>
                    {branchOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Location</span>
                  <select
                    value={form.locationId}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        locationId: event.target.value,
                        locationLabel: locationOptions.find((option) => option.id === event.target.value)?.label ?? ''
                      }))
                    }
                  >
                    <option value="">Select location</option>
                    {locationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          <div className={settingsActionRowClass}>
            <button className="secondary-btn" type="button" onClick={() => void handleSignIn()} disabled={signingIn}>
              {signingIn ? 'Signing In...' : 'Sign In'}
            </button>
            <button
              ref={redownloadTarget.ref}
              className={`primary-btn ${redownloadTarget.active ? 'tutorial-target-active' : ''}`}
              type="button"
              onClick={() => void handleRefreshCatalog()}
              disabled={syncingCatalog || !state.auth.accessToken}
            >
              {syncingCatalog ? 'Downloading...' : 'Redownload Branch Data'}
            </button>
            {needsSetupAttention ? (
              <button className="secondary-btn" type="button" onClick={() => void handleSaveSetup()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Desktop Setup'}
              </button>
            ) : null}
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Printer</div>
            <h3>Receipt Printer</h3>
          </div>
          <p className={settingsHelperClass}>Choose printer mode, save the printer path, then run a test print.</p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Current Printer Path</strong>
              <span>Choose USB or LAN, fill the path below, then save a reusable profile for this workstation.</span>
            </div>
            <div className={settingsChipRowClass}>
              {PRINTER_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`filter-chip ${form.printerMode === option.value ? 'active' : ''}`}
                  onClick={() => setForm((prev) => ({ ...prev, printerMode: option.value as DesktopSetupState['printerMode'] }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="settings-form-grid">
              <label>
                <span>USB printer name</span>
                <input value={form.printerName} onChange={(event) => setForm((prev) => ({ ...prev, printerName: event.target.value }))} placeholder="EPSON TM-T82X Receipt" />
              </label>
              <label>
                <span>Discovered USB printers</span>
                <select value={form.printerName} onChange={(event) => setForm((prev) => ({ ...prev, printerName: event.target.value }))}>
                  <option value="">Select discovered printer</option>
                  {discoveredPrinters.map((printer) => (
                    <option key={printer} value={printer}>
                      {printer}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>LAN printer host</span>
                <input value={form.printerHost} onChange={(event) => setForm((prev) => ({ ...prev, printerHost: event.target.value }))} placeholder="192.168.1.120" />
              </label>
              <label>
                <span>LAN printer port</span>
                <input value={form.printerPort} onChange={(event) => setForm((prev) => ({ ...prev, printerPort: event.target.value }))} placeholder="9100" />
              </label>
              <label>
                <span>Printer profile name</span>
                <input value={profileLabel} onChange={(event) => setProfileLabel(event.target.value)} placeholder="Front Counter USB or Warehouse LAN" />
              </label>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => void handleDiscoverPrinters()} disabled={discoveringPrinters}>
                {discoveringPrinters ? 'Discovering...' : 'Discover USB Printers'}
              </button>
              <button className="secondary-btn" type="button" onClick={() => void persistProfile()} disabled={savingProfile || form.printerMode === 'NONE'}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              <button className="secondary-btn" type="button" onClick={() => void runPrinterTest()} disabled={testingPrinter || form.printerMode === 'NONE'}>
                {testingPrinter ? 'Testing...' : 'Test Current Path'}
              </button>
              <button
                ref={printerSaveTarget.ref}
                className={`primary-btn ${printerSaveTarget.active ? 'tutorial-target-active' : ''}`}
                type="button"
                onClick={async () => {
                  const profile = await persistProfile();
                  if (profile) {
                    await runPrinterTest(profile);
                  }
                }}
                disabled={savingProfile || testingPrinter || form.printerMode === 'NONE'}
              >
                {testingPrinter ? 'Testing...' : 'Save & Test Profile'}
              </button>
            </div>
          </div>

          {selectedProfile ? (
            <div className={settingsCardClass}>
              <div className={settingsSubheadClass}>
                <strong>Selected Profile</strong>
                <span>Review the latest test result before printing live receipts.</span>
              </div>
              <div className={`sync-banner ${selectedProfile.lastTestStatus === 'error' ? 'error' : selectedProfile.lastTestStatus === 'success' ? 'success' : ''}`}>
                <strong>Selected profile status</strong>
                <span>Last test: {formatDateTime(selectedProfile.lastTestedAt)}</span>
                <span>Last success: {formatDateTime(selectedProfile.lastSuccessAt)}</span>
                <span>{selectedProfile.lastTestMessage || 'No printer feedback recorded yet.'}</span>
              </div>
            </div>
          ) : null}

          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Saved Printer Profiles</strong>
              <span>Tap a saved profile to apply it again, rerun a test, or remove it from this device.</span>
            </div>
            <div className="recent-sales-list">
              {state.printerProfiles.length === 0 ? (
                <div className="empty-state">No saved printer profiles yet. Save one after choosing a USB or LAN printer path.</div>
              ) : (
                state.printerProfiles.map((profile) => (
                  <article key={profile.id} className={`recent-sale-card ${selectedProfileId === profile.id ? 'selected-card' : ''}`}>
                    <button type="button" className="card-fill-button" onClick={() => applyProfile(profile)}>
                      <div>
                        <strong>{profile.label}</strong>
                        <span>
                          {profile.mode === 'USB'
                            ? profile.printerName || 'USB printer name not set'
                            : `${profile.printerHost || 'LAN host not set'}:${profile.printerPort || '9100'}`}
                        </span>
                      </div>
                      <div>
                        <strong>{profile.mode}</strong>
                        <span>Last success: {formatDateTime(profile.lastSuccessAt)}</span>
                      </div>
                      <div className={`sync-chip ${profile.lastTestStatus === 'error' ? 'failed' : profile.lastTestStatus === 'success' ? 'synced' : 'pending'}`}>
                        {profile.lastTestStatus === 'idle' ? 'not tested' : profile.lastTestStatus}
                      </div>
                    </button>
                    <div className="recent-sale-actions">
                      <button className="secondary-btn mini-btn" type="button" onClick={() => applyProfile(profile)}>
                        Apply
                      </button>
                      <button className="secondary-btn mini-btn" type="button" onClick={() => void runPrinterTest(profile)} disabled={testingPrinter}>
                        Test Again
                      </button>
                      <button className="secondary-btn mini-btn" type="button" onClick={() => void handleDeletePrinterProfile(profile.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Software Update</div>
            <h3>Desktop OTA</h3>
          </div>
          <p className={settingsHelperClass}>
            Check whether a newer desktop release is available, then install it from the signed OTA package.
          </p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Installed Version</strong>
              <span>Current desktop version: {appVersion}</span>
            </div>
            <div className={settingsStatusGridClass}>
              <div className="customer-detail-card">
                <span>Current</span>
                <strong>{appVersion}</strong>
              </div>
              <div className="customer-detail-card">
                <span>Latest Check</span>
                <strong>
                  {updateResult?.available && updateResult.manifest
                    ? `Update ${updateResult.manifest.version}`
                    : updateResult
                      ? 'Up to date'
                      : 'Not checked'}
                </strong>
              </div>
            </div>
            {updateResult?.manifest ? (
              <div className="sync-banner info">
                <strong>Release {updateResult.manifest.version}</strong>
                <span>{new Date(updateResult.manifest.date).toLocaleString()}</span>
                <span>{updateResult.manifest.body}</span>
              </div>
            ) : null}
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => void handleCheckForUpdates()} disabled={checkingForUpdate}>
                {checkingForUpdate ? 'Checking...' : 'Check for Updates'}
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => void handleInstallUpdate()}
                disabled={installingUpdate || !updateResult?.available || !updateResult.manifest}
              >
                {installingUpdate
                  ? 'Installing...'
                  : updateResult?.available && updateResult.manifest
                    ? `Install ${updateResult.manifest.version}`
                    : 'Install Update'}
              </button>
            </div>
          </div>
        </section>

        <section className={settingsSectionClass}>
          <div className={settingsHeadClass}>
            <div className="eyebrow">Device Data</div>
            <h3>Reset Local Desktop Data</h3>
          </div>
          <p className={settingsHelperClass}>
            Use this only when you want to restart desktop testing from a clean local state on this device.
          </p>
          <div className={settingsCardClass}>
            <div className={settingsSubheadClass}>
              <strong>Clear Local Records</strong>
              <span>This clears local sales, sync queue, cached branch data, saved printer profiles, PIN, and sign-in on this desktop device.</span>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => setResetConfirmOpen(true)} disabled={resetBusy}>
                {resetBusy ? 'Resetting...' : 'Reset Local Desktop Data'}
              </button>
            </div>
          </div>
        </section>

        <div className="message-banner">{message}</div>
      </div>
      {layoutModalOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !layoutSaving && setLayoutModalOpen(false)}>
          <div className={settingsModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={settingsModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Receipt layout</div>
                  <h3>Receipt Layout Editor</h3>
                  <p className={settingsHelperClass}>Arrange the printed receipt the same way mobile VPOS does: header first, printed fields next, then spacing and test print.</p>
                </div>
                <button className="secondary-btn mini-btn" type="button" onClick={() => !layoutSaving && setLayoutModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
              <section className="payment-section-card settings-layout-section">
                <div className="panel-head compact settings-layout-section-head">
                  <div>
                    <div className="eyebrow">Header</div>
                    <h3>Branding and store details</h3>
                    <p className={settingsHelperClass}>This is the branding block shown at the top and bottom of the printed receipt.</p>
                  </div>
                </div>
                <div className="checkout-grid pos-payment-grid">
                  <label className="payment-field-stack">
                    <span>Header Text</span>
                    <input
                      value={layoutDraft.headerLogoText}
                      onChange={(event) => updateLayoutDraft('headerLogoText', event.target.value)}
                      placeholder="VMJAM LPG"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Store Contact</span>
                    <input
                      value={layoutDraft.storeContactInfo}
                      onChange={(event) => updateLayoutDraft('storeContactInfo', event.target.value)}
                      placeholder="0917-000-0000"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Store Address</span>
                    <input
                      value={layoutDraft.storeAddress}
                      onChange={(event) => updateLayoutDraft('storeAddress', event.target.value)}
                      placeholder="Store address"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Business TIN</span>
                    <input
                      value={layoutDraft.businessTin}
                      onChange={(event) => updateLayoutDraft('businessTin', event.target.value)}
                      placeholder="Business TIN"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Permit / OR Info</span>
                    <input
                      value={layoutDraft.permitOrInfo}
                      onChange={(event) => updateLayoutDraft('permitOrInfo', event.target.value)}
                      placeholder="Permit or OR info"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Terminal Name</span>
                    <input
                      value={layoutDraft.terminalName}
                      onChange={(event) => updateLayoutDraft('terminalName', event.target.value)}
                      placeholder="Counter 1"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Cashier Role Label</span>
                    <input
                      value={layoutDraft.cashierRoleLabel}
                      onChange={(event) => updateLayoutDraft('cashierRoleLabel', event.target.value)}
                      placeholder="Senior Cashier"
                    />
                  </label>
                  <label className="payment-field-stack">
                    <span>Footer Text</span>
                    <input
                      value={layoutDraft.footerText}
                      onChange={(event) => updateLayoutDraft('footerText', event.target.value)}
                      placeholder="Thank you for choosing VPOS LPG."
                    />
                  </label>
                </div>
              </section>

              <section className="payment-section-card settings-layout-section">
                <div className="panel-head compact settings-layout-section-head">
                  <div>
                    <div className="eyebrow">Fields</div>
                    <h3>Show or hide printed sections</h3>
                    <p className={settingsHelperClass}>Choose which receipt details the cashier should print by default.</p>
                  </div>
                </div>
                <div className="filter-chip-row settings-layout-chip-row">
                  {RECEIPT_TOGGLE_ITEMS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`filter-chip ${layoutDraft[item.key] ? 'active' : ''}`}
                      onClick={() => updateLayoutDraft(item.key, !layoutDraft[item.key])}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="payment-section-card settings-layout-section">
                <div className="panel-head compact settings-layout-section-head">
                  <div>
                    <div className="eyebrow">Spacing</div>
                    <h3>Receipt margins</h3>
                    <p className={settingsHelperClass}>Adjust top and bottom blank lines to fit your receipt paper and printer feed.</p>
                  </div>
                </div>
                <div className="two-col-grid settings-layout-spacing-grid">
                  <div className="customer-detail-card settings-layout-spacing-card">
                    <span>Top Padding Lines</span>
                    <strong>{layoutDraft.topPaddingLines}</strong>
                    <div className="desktop-settings-actions">
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={() => updateLayoutDraft('topPaddingLines', clampPadding(layoutDraft.topPaddingLines - 1))}
                      >
                        -
                      </button>
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={() => updateLayoutDraft('topPaddingLines', clampPadding(layoutDraft.topPaddingLines + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="customer-detail-card settings-layout-spacing-card">
                    <span>Bottom Padding Lines</span>
                    <strong>{layoutDraft.bottomPaddingLines}</strong>
                    <div className="desktop-settings-actions">
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={() => updateLayoutDraft('bottomPaddingLines', clampPadding(layoutDraft.bottomPaddingLines - 1))}
                      >
                        -
                      </button>
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={() => updateLayoutDraft('bottomPaddingLines', clampPadding(layoutDraft.bottomPaddingLines + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <div className="checkout-action-row pos-payment-actions">
                <button className="secondary-btn checkout-btn checkout-btn-print-inline" type="button" onClick={() => void handleTestLayout()} disabled={layoutSaving}>
                  {layoutSaving ? 'Testing...' : 'Test Layout Print'}
                </button>
                <button className="secondary-btn checkout-btn checkout-btn-support" type="button" onClick={() => setLayoutModalOpen(false)} disabled={layoutSaving}>
                  Back
                </button>
                <button className="primary-btn checkout-btn" type="button" onClick={() => void handleSaveLayout()} disabled={layoutSaving}>
                  {layoutSaving ? 'Saving...' : 'Save Layout'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pinModalOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !pinSaving && setPinModalOpen(false)}>
          <div className="w-full max-w-xl rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] p-5 shadow-[var(--shadow-strong)]" onClick={(event) => event.stopPropagation()}>
            <div className="settings-pin-modal-head">
              <div>
                <div className="eyebrow">Security PIN</div>
                <h3>{pinConfigured ? 'Change PIN' : 'Set PIN'}</h3>
              </div>
              <button
                className="secondary-btn mini-btn"
                type="button"
                onClick={() => !pinSaving && setPinModalOpen(false)}
              >
                Close
              </button>
            </div>

            <p className={settingsHelperClass}>Use a 4-digit PIN for fast offline unlock.</p>

            <div className="settings-pin-stack">
              {pinConfigured ? (
                <div className="settings-pin-field">
                  <span className="settings-pin-label">Current PIN</span>
                  <DesktopPinCodeInput
                    key={`desktop-pin-current-${pinFocusEpoch}`}
                    value={currentPin}
                    onChange={(value) => setCurrentPin(normalizePin(value))}
                    editable={!pinSaving}
                    autoFocus
                  />
                </div>
              ) : null}

              <div className="settings-pin-field">
                <span className="settings-pin-label">New PIN (4 digits)</span>
                <DesktopPinCodeInput
                  key={`desktop-pin-next-${pinFocusEpoch}`}
                  value={nextPin}
                  onChange={(value) => setNextPin(normalizePin(value))}
                  editable={!pinSaving}
                  autoFocus={!pinConfigured}
                />
              </div>

              <div className="settings-pin-field">
                <span className="settings-pin-label">Confirm New PIN</span>
                <DesktopPinCodeInput
                  value={confirmPin}
                  onChange={(value) => setConfirmPin(normalizePin(value))}
                  editable={!pinSaving}
                />
              </div>
            </div>

            <div className={`${settingsActionRowClass} settings-pin-actions`}>
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setPinModalOpen(false)}
                disabled={pinSaving}
              >
                Back
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleSavePin()} disabled={pinSaving}>
                {pinSaving ? 'Saving PIN...' : pinConfigured ? 'Save New PIN' : 'Save PIN'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetConfirmOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !resetBusy && setResetConfirmOpen(false)}>
          <div className="w-full max-w-xl rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] p-5 shadow-[var(--shadow-strong)]" onClick={(event) => event.stopPropagation()}>
            <div className="settings-pin-modal-head">
              <div>
                <div className="eyebrow">Device Data</div>
                <h3>Reset Local Desktop Data</h3>
              </div>
              <button
                className="secondary-btn mini-btn"
                type="button"
                onClick={() => !resetBusy && setResetConfirmOpen(false)}
                disabled={resetBusy}
              >
                Close
              </button>
            </div>

            <p className={settingsHelperClass}>
              This will clear local sales, sync queue, cached branch data, saved printer profiles, PIN, and saved sign-in on this desktop device.
            </p>
            <div className="sync-banner error">
              <strong>Fresh test reset</strong>
              <span>Use this only when you want the device to go back to the startup flow for fresh POS testing.</span>
            </div>

            <div className={`${settingsActionRowClass} settings-pin-actions`}>
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                disabled={resetBusy}
              >
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleResetLocalData()} disabled={resetBusy}>
                {resetBusy ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

