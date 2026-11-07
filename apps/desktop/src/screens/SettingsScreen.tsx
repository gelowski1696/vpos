import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import {
  assessDesktopUpdateSafety,
  desktopUpdaterService,
  type DesktopUpdateCheckResult,
  type DesktopUpdateStatus
} from '../services/desktop-updater.service';
import { DesktopPinCodeInput } from '../components/feedback/DesktopPinCodeInput';
import { useDesktopTutorialTarget } from '../tutorial/tutorial-provider';

type Props = {
  state: DesktopAppState;
  onStateReload: () => Promise<void>;
  onStartWalkthrough?: () => void;
  onResetLocalData?: () => Promise<void>;
  pendingOutboxCount?: number;
  hasActiveShift?: boolean;
  syncBusy?: boolean;
  onRunSync?: () => Promise<void>;
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

const SETTINGS_SETUP_ACCESS_PASSWORD_B64 = 'Vm1qYW10ZWNoQDIwMjY=';

function decodeBase64(value: string): string {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(value);
  }
  return value;
}

export function isManageSetupPasswordValid(password: string): boolean {
  return password === decodeBase64(SETTINGS_SETUP_ACCESS_PASSWORD_B64);
}

export function resolvePrinterProfileSavedMessage(label: string): string {
  return `Saved printer profile "${label}" for this desktop station.`;
}

export function resolvePrinterTestFeedback({
  success,
  profileLabel,
  errorMessage
}: {
  success: boolean;
  profileLabel?: string | null;
  errorMessage?: string | null;
}): {
  message: string;
  tone: 'success' | 'error';
} {
  if (success) {
    return {
      message: profileLabel
        ? `Printer test was sent using "${profileLabel}".`
        : 'Printer test was sent. If nothing came out, check the selected USB printer name or LAN host and port.',
      tone: 'success'
    };
  }

  return {
    message: errorMessage?.trim() || 'Unable to run printer test on this desktop station.',
    tone: 'error'
  };
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

type SettingsIconKind =
  | 'settings'
  | 'onboarding'
  | 'pos'
  | 'pin'
  | 'receipt'
  | 'branch'
  | 'printer'
  | 'update'
  | 'reset'
  | 'info';

type SettingsIconTone = 'blue' | 'amber' | 'green' | 'violet' | 'orange' | 'rose';
type SettingsBadgeTone = 'good' | 'warn' | 'danger' | 'neutral' | 'blue';

function SettingsPageIcon({
  kind,
  className = ''
}: {
  kind: SettingsIconKind;
  className?: string;
}): JSX.Element {
  let path: ReactNode;

  if (kind === 'settings') {
    path = (
      <>
        <path d="M12 3.75 13.36 6a6.93 6.93 0 0 1 1.74.72L17.56 6l1.69 2.94-1.73 1.28c.1.51.15 1.03.15 1.56 0 .53-.05 1.06-.15 1.57l1.73 1.28-1.69 2.94-2.46-.72a6.93 6.93 0 0 1-1.74.72L12 20.25l-1.36-2.25a6.93 6.93 0 0 1-1.74-.72L6.44 18l-1.69-2.94 1.73-1.28A8.1 8.1 0 0 1 6.33 12c0-.53.05-1.05.15-1.56L4.75 9.16 6.44 6.2l2.46.72c.55-.32 1.14-.56 1.74-.72L12 3.75Z" />
        <circle cx="12" cy="12" r="2.7" />
      </>
    );
  } else if (kind === 'onboarding') {
    path = (
      <>
        <path d="m12 4 1.2 3.05L16 8.25l-2.8 1.2L12 12.5l-1.2-3.05L8 8.25l2.8-1.2L12 4Z" />
        <path d="m6 12 .8 2.05L9 15l-2.2.95L6 18l-.8-2.05L3 15l2.2-.95L6 12Z" />
        <path d="m18 12 .8 2.05L21 15l-2.2.95L18 18l-.8-2.05L15 15l2.2-.95L18 12Z" />
      </>
    );
  } else if (kind === 'pos') {
    path = (
      <>
        <path d="M8 4.5h8" />
        <path d="M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        <path d="M9 12h6M9 15h4" />
      </>
    );
  } else if (kind === 'pin') {
    path = (
      <>
        <rect x="5" y="10" width="14" height="9" rx="2.5" />
        <path d="M8 10V8a4 4 0 1 1 8 0v2" />
        <circle cx="12" cy="14.5" r="1" />
      </>
    );
  } else if (kind === 'receipt') {
    path = (
      <>
        <path d="M7 4h10a2 2 0 0 1 2 2v13l-2-1-2 1-2-1-2 1-2-1-2 1V6a2 2 0 0 1 2-2Z" />
        <path d="M9 8.5h6M9 12h6M9 15.5h4" />
      </>
    );
  } else if (kind === 'branch') {
    path = (
      <>
        <path d="M5 19V7.5L12 4l7 3.5V19" />
        <path d="M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01" />
        <path d="M10 19v-3h4v3" />
      </>
    );
  } else if (kind === 'printer') {
    path = (
      <>
        <path d="M8 6V4.5h8V6" />
        <path d="M7 16H5.5A1.5 1.5 0 0 1 4 14.5v-5A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
        <path d="M7 12h10v7H7z" />
        <path d="M17 10.5h.01" />
      </>
    );
  } else if (kind === 'update') {
    path = (
      <>
        <path d="M6.5 7.5A6.75 6.75 0 0 1 18 9h1.5" />
        <path d="M17.5 16.5A6.75 6.75 0 0 1 6 15H4.5" />
        <path d="m18.5 6.5 1 2.5-2.5 1" />
        <path d="m5.5 17.5-1-2.5 2.5-1" />
      </>
    );
  } else if (kind === 'reset') {
    path = (
      <>
        <path d="M7 7h10" />
        <path d="M9 4h6l1 2H8l1-2Z" />
        <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
        <path d="M10.5 10.5v5M13.5 10.5v5" />
      </>
    );
  } else {
    path = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v4" />
        <circle cx="12" cy="7.5" r=".9" fill="currentColor" stroke="none" />
      </>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={`settings-overview-icon ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

function SettingsOverviewGlyph({
  kind,
  tone
}: {
  kind: SettingsIconKind;
  tone: SettingsIconTone;
}): JSX.Element {
  return (
    <span className={`settings-overview-glyph settings-overview-glyph--${tone}`} aria-hidden="true">
      <SettingsPageIcon kind={kind} />
    </span>
  );
}

function SettingsStatusBadge({
  label,
  tone
}: {
  label: string;
  tone: SettingsBadgeTone;
}): JSX.Element {
  return <span className={`settings-overview-badge settings-overview-badge--${tone}`}>{label}</span>;
}

function SettingsModalCloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M5 5l10 10" />
      <path d="M15 5 5 15" />
    </svg>
  );
}

function SettingsModalCloseButton({
  onClick,
  disabled = false
}: {
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      className="secondary-btn mini-btn modal-close-icon-btn"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Close modal"
      title="Close"
    >
      <SettingsModalCloseIcon />
    </button>
  );
}

function SettingsOverviewCard({
  icon,
  tone,
  eyebrow,
  title,
  description,
  compact = false,
  children
}: {
  icon: SettingsIconKind;
  tone: SettingsIconTone;
  eyebrow: string;
  title: string;
  description: string;
  compact?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={`settings-overview-card ${compact ? 'settings-overview-card--compact' : 'settings-overview-card--feature'}`}>
      <div className="settings-overview-card-head">
        <SettingsOverviewGlyph kind={icon} tone={tone} />
        <div className="settings-overview-card-heading">
          <div className="eyebrow">{eyebrow}</div>
          <h3>{title}</h3>
        </div>
      </div>
      <p className="settings-overview-card-copy">{description}</p>
      {children}
    </section>
  );
}

const screenStackClass = 'flex flex-col gap-5';
const settingsHeadClass = 'flex flex-col gap-2';
const settingsHelperClass = 'text-[0.94rem] leading-6 text-[var(--muted)]';
const settingsCardClass = 'settings-screen-card';
const settingsSubheadClass = 'grid gap-1';
const settingsStatusRowClass = 'grid gap-3';
const settingsStatusGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const settingsActionRowClass = 'flex flex-wrap gap-3';
const settingsChipRowClass = 'flex flex-wrap gap-2';
const settingsStatusCardClass =
  'grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.96)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const settingsStatusLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const settingsStatusValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const settingsProfileListClass = 'grid gap-3';
const settingsProfileCardClass =
  'rounded-[22px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,254,0.98))] shadow-[0_10px_24px_rgba(17,40,58,0.04)]';
const settingsProfileSelectedClass =
  'border-[rgba(25,118,210,0.28)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_28px_rgba(25,118,210,0.12)]';
const settingsProfileButtonClass = 'grid w-full gap-3 px-4 py-4 text-left md:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.7fr)_auto] md:items-start';
const settingsModalBackdropClass = 'desktop-modal-backdrop';
const settingsModalCardClass = 'desktop-modal-card desktop-modal-card--detail settings-layout-modal';
const settingsActionModalCardClass = 'desktop-modal-card desktop-modal-card--action settings-pin-modal';
const settingsSetupModalCardClass = 'desktop-modal-card desktop-modal-card--detail settings-setup-modal';
const settingsPrinterModalCardClass = 'desktop-modal-card desktop-modal-card--detail settings-printer-modal';
const settingsModalToolbarClass = 'desktop-modal-header settings-layout-toolbar';

export function SettingsScreen({
  state,
  onStateReload,
  onStartWalkthrough,
  onResetLocalData,
  pendingOutboxCount = 0,
  hasActiveShift = false,
  syncBusy = false,
  onRunSync
}: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const pinTarget = useDesktopTutorialTarget('settings-set-pin');
  const layoutTarget = useDesktopTutorialTarget('settings-open-layout');
  const redownloadTarget = useDesktopTutorialTarget('settings-redownload-data');
  const printerSaveTarget = useDesktopTutorialTarget('settings-save-printer');
  const [form, setForm] = useState<DesktopSetupState>(copySetup(state.setup));
  const [password, setPassword] = useState('');
  const [setupAccessPromptOpen, setSetupAccessPromptOpen] = useState(false);
  const [setupAccessPassword, setSetupAccessPassword] = useState('');
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [printerModalOpen, setPrinterModalOpen] = useState(false);
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
  const [autoPrinterDiscoveryTried, setAutoPrinterDiscoveryTried] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<string[]>([]);
  const [profileLabel, setProfileLabel] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [appVersion, setAppVersion] = useState(state.version.toString());
  const [updateResult, setUpdateResult] = useState<DesktopUpdateCheckResult | null>(() => desktopUpdaterService.getStoredStatus());
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>(() => desktopUpdaterService.getStoredStatus()?.status ?? 'idle');
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
  const walkthroughCompleted = Boolean(state.walkthrough.completedAt);
  const posDefaultFlowLabel = POS_FLOW_OPTIONS.find((option) => option.value === form.posDefaultLpgFlow)?.label ?? 'Require per item';
  const branchStatusLabel =
    state.sync.lastSyncStatus === 'success'
      ? 'Ready'
      : state.sync.lastSyncStatus === 'error'
        ? 'Needs Attention'
        : state.auth.accessToken
          ? 'Waiting for Download'
          : 'Sign In Needed';
  const branchStatusTone: SettingsBadgeTone =
    state.sync.lastSyncStatus === 'success'
      ? 'good'
      : state.sync.lastSyncStatus === 'error'
        ? 'danger'
        : 'warn';
  const printerPathLabel =
    form.printerMode === 'USB'
      ? form.printerName.trim() || 'USB printer not selected'
      : form.printerMode === 'LAN'
        ? `${form.printerHost.trim() || 'LAN host not set'}:${form.printerPort.trim() || '9100'}`
        : 'No printer configured';
  const printerReady =
    form.printerMode === 'USB'
      ? Boolean(form.printerName.trim())
      : form.printerMode === 'LAN'
        ? Boolean(form.printerHost.trim())
        : false;
  const printerStatusLabel = printerReady ? 'Active' : form.printerMode === 'NONE' ? 'Not Set' : 'Needs Setup';
  const printerStatusTone: SettingsBadgeTone = printerReady ? 'good' : form.printerMode === 'NONE' ? 'neutral' : 'warn';
  const updateSafety = useMemo(
    () => assessDesktopUpdateSafety({ pendingOutboxCount, hasActiveShift, syncBusy }),
    [hasActiveShift, pendingOutboxCount, syncBusy]
  );
  const latestCheckLabel =
    updateStatus === 'failed'
      ? 'Check Failed'
      : updateResult?.available && updateResult.manifest
      ? `Update ${updateResult.manifest.version}`
      : updateResult
        ? 'Up to date'
        : 'Not checked';
  const latestCheckTone: SettingsBadgeTone =
    updateStatus === 'failed'
      ? 'danger'
      : updateResult?.available && updateResult.manifest
        ? 'warn'
        : updateResult
          ? 'good'
          : 'neutral';
  const manifestReleaseNotes = (updateResult?.manifest as unknown as { notes?: string | null } | undefined)?.notes ?? null;

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

  const persistProfile = async (options?: { announceSuccess?: boolean }): Promise<DesktopPrinterProfile | null> => {
    const announceSuccess = options?.announceSuccess ?? true;
    const trimmed = profileLabel.trim();
    if (!trimmed) {
      announce('Enter a printer profile name first.', 'warning');
      return null;
    }
    if (form.printerMode === 'NONE') {
      announce('Choose USB or LAN before saving a printer profile.', 'warning');
      return null;
    }
    if (form.printerMode === 'USB' && !form.printerName.trim()) {
      announce('Select or enter a USB printer name before saving this profile.', 'warning');
      return null;
    }
    if (form.printerMode === 'LAN' && !form.printerHost.trim()) {
      announce('Enter the LAN printer host before saving this profile.', 'warning');
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
      const successMessage = resolvePrinterProfileSavedMessage(profile.label);
      await saveProfilesState(nextProfiles, successMessage);
      setSelectedProfileId(profile.id);
      if (announceSuccess) {
        announce(successMessage, 'success');
      } else {
        setMessage(successMessage);
      }
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
      const feedback = resolvePrinterTestFeedback({
        success: true,
        profileLabel: overrideProfile?.label ?? null
      });
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), true, feedback.message);
      announce(feedback.message, feedback.tone);
    } catch (error) {
      const feedback = resolvePrinterTestFeedback({
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unable to run printer test on this desktop station.'
      });
      await recordPrinterTestResult(overrideProfile?.id ?? (selectedProfileId || null), false, feedback.message);
      announce(feedback.message, feedback.tone);
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
          ...result.state.sync,
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
          ...state.sync,
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
    await discoverPrinters(true);
  };

  const discoverPrinters = async (announceResult: boolean): Promise<void> => {
    setDiscoveringPrinters(true);
    try {
      const printers = await listNativePrinters();
      setDiscoveredPrinters(printers);
      if (!form.printerName && printers.length === 1) {
        setForm((prev) => ({ ...prev, printerName: printers[0] }));
      }
      if (announceResult) {
        setMessage(
          printers.length > 0
            ? `Found ${printers.length} installed printer${printers.length === 1 ? '' : 's'} on this desktop station.`
            : 'No installed printers were discovered on this desktop station.'
        );
      }
    } catch (error) {
      if (announceResult) {
        setMessage(error instanceof Error ? error.message : 'Unable to discover installed printers on this desktop.');
      }
    } finally {
      setDiscoveringPrinters(false);
    }
  };

  useEffect(() => {
    if (form.printerMode !== 'USB') {
      if (autoPrinterDiscoveryTried) {
        setAutoPrinterDiscoveryTried(false);
      }
      return;
    }
    if (discoveredPrinters.length > 0 || discoveringPrinters || autoPrinterDiscoveryTried) {
      return;
    }
    setAutoPrinterDiscoveryTried(true);
    void discoverPrinters(false);
  }, [autoPrinterDiscoveryTried, discoveringPrinters, discoveredPrinters.length, form.printerMode]);

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
      setSetupModalOpen(false);
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

  const closeSetupAccessPrompt = (): void => {
    setSetupAccessPromptOpen(false);
    setSetupAccessPassword('');
  };

  const openSetupAccessPrompt = (): void => {
    setSetupAccessPassword('');
    setSetupAccessPromptOpen(true);
  };

  const handleConfirmSetupAccess = (): void => {
    if (!isManageSetupPasswordValid(setupAccessPassword)) {
      announce('Incorrect manage setup password.', 'error');
      return;
    }
    setSetupAccessPassword('');
    setSetupAccessPromptOpen(false);
    setSetupModalOpen(true);
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
    setUpdateStatus('checking');
    try {
      const result = await desktopUpdaterService.checkForUpdate({
        apiBaseUrl: state.setup.apiBaseUrl,
        deviceId: state.setup.deviceId
      });
      setAppVersion(result.currentVersion);
      setUpdateResult(result);
      setUpdateStatus(result.status);
      if (!result.supported) {
        announce(result.errorMessage ?? 'OTA updates are available from the installed desktop build.', 'warning');
        return;
      }
      if (result.status === 'failed') {
        announce(result.errorMessage ?? 'Unable to check for updates right now.', 'error');
        return;
      }
      if (result.available && result.manifest) {
        announce(
          `${result.required ? 'Required update' : 'Update'} ${result.manifest.version} is available for this desktop station.`,
          result.required ? 'warning' : 'success'
        );
      } else {
        announce(`VPOS Desktop ${result.currentVersion} is already up to date.`, 'info');
      }
    } catch (error) {
      setUpdateStatus('failed');
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
    if (!updateSafety.safe) {
      announce(updateSafety.blockers[0] ?? 'This workstation is not ready to install an update.', 'warning');
      return;
    }
    if (hasActiveShift && !globalThis.confirm('A cashier shift is still open. Install the update now anyway?')) {
      announce('Update postponed. Close the shift, then install from Settings.', 'info');
      return;
    }

    setInstallingUpdate(true);
    setUpdateStatus('downloading');
    try {
      await desktopUpdaterService.installAvailableUpdate((event) => {
        if (event.status === 'PENDING') {
          setUpdateStatus('downloading');
          setMessage('Downloading and preparing the desktop update...');
        }
        if (event.status === 'DONE') {
          setUpdateStatus('restart_required');
          setMessage('Update downloaded and verified. Restarting VPOS Desktop...');
        }
        if (event.status === 'ERROR') {
          setUpdateStatus('failed');
          setMessage(event.error || 'Desktop update failed.');
        }
      });
      setUpdateStatus('restart_required');
      announce(`Desktop update ${updateResult.manifest.version} was installed. The app may restart to finish applying it.`, 'success');
    } catch (error) {
      setUpdateStatus('failed');
      announce(error instanceof Error ? error.message : 'Unable to install the desktop update.', 'error');
    } finally {
      setInstallingUpdate(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <SettingsPageIcon kind="settings" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Settings Overview
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Manage your workstation setup and preferences.
            </p>
          </div>
        </div>
      </section>

      <div className="settings-overview-feature-grid">
        <SettingsOverviewCard
          icon="onboarding"
          tone="amber"
          eyebrow="Onboarding"
          title="Walkthrough"
          description="Replay walkthrough or reset tutorial progress for this device."
        >
          <div className="settings-overview-surface">
            <div className="settings-overview-surface-head">
              <strong>Walkthrough Status</strong>
              <span>Run the guided spotlight tour again if this device needs a quick refresh.</span>
            </div>
            <div className="settings-overview-status-strip">
              <div className="settings-overview-status-copy">
                <span className={settingsStatusLabelClass}>Status</span>
                <strong className="settings-overview-inline-value">{walkthroughCompleted ? 'Completed' : 'Not Completed'}</strong>
              </div>
              <SettingsStatusBadge label={walkthroughCompleted ? 'Completed' : 'Not Completed'} tone={walkthroughCompleted ? 'good' : 'warn'} />
            </div>
            <div className={settingsActionRowClass}>
              <button className="primary-btn" type="button" onClick={() => onStartWalkthrough?.()}>
                Start App Walkthrough
              </button>
              <button className="secondary-btn" type="button" onClick={() => void handleResetWalkthrough()} disabled={tutorialResetBusy}>
                {tutorialResetBusy ? 'Resetting...' : 'Reset Walkthrough'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>

        <SettingsOverviewCard
          icon="pos"
          tone="blue"
          eyebrow="POS Defaults"
          title="Default LPG Flow"
          description="Set the default LPG flow for newly added cart lines."
        >
          <div className="settings-overview-surface">
            <div className="settings-overview-surface-head">
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
            <div className="settings-overview-status-strip">
              <div className="settings-overview-status-copy">
                <span className={settingsStatusLabelClass}>Current Default</span>
                <strong className="settings-overview-inline-value">{posDefaultFlowLabel}</strong>
              </div>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => void handleSavePosDefaults()} disabled={saving}>
                {saving ? 'Saving...' : 'Save POS Defaults'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>

        <SettingsOverviewCard
          icon="pin"
          tone="green"
          eyebrow="Security PIN"
          title="Offline Unlock"
          description={pinConfigured ? 'Change your 4-digit offline unlock PIN.' : 'Set your 4-digit offline unlock PIN.'}
        >
          <div className="settings-overview-surface">
            <div className="settings-overview-surface-head">
              <strong>Offline Unlock PIN</strong>
              <span>Use a 4-digit PIN so the cashier can reopen the desktop app quickly while staying offline.</span>
            </div>
            <div className="settings-overview-status-strip">
              <div className="settings-overview-status-copy">
                <span className={settingsStatusLabelClass}>PIN Status</span>
                <strong className="settings-overview-inline-value">{pinConfigured ? 'Configured' : 'Not Set'}</strong>
              </div>
              <SettingsStatusBadge label={pinConfigured ? 'Ready' : 'Not Set'} tone={pinConfigured ? 'good' : 'warn'} />
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
        </SettingsOverviewCard>

        <SettingsOverviewCard
          icon="receipt"
          tone="violet"
          eyebrow="Receipt Layout"
          title="Printed Receipt"
          description="Customize the printed receipt layout and run a test print."
        >
          <div className="settings-overview-surface">
            <div className="settings-overview-surface-head">
              <strong>Printed Receipt Layout</strong>
              <span>Open the receipt sheet to adjust branding, printed fields, spacing, and run a quick test print.</span>
            </div>
            <div className="settings-overview-status-strip">
              <div className="settings-overview-status-copy">
                <span className={settingsStatusLabelClass}>Current Header</span>
                <strong className="settings-overview-inline-value">{state.receiptLayout.headerLogoText || 'Printed Receipt'}</strong>
              </div>
              <SettingsStatusBadge label="Ready" tone="blue" />
            </div>
            <div className={settingsActionRowClass}>
              <button
                ref={layoutTarget.ref}
                className={`secondary-btn ${layoutTarget.active ? 'tutorial-target-active' : ''}`}
                type="button"
                onClick={() => setLayoutModalOpen(true)}
              >
                Open Layout Settings
              </button>
              <button className="secondary-btn" type="button" onClick={() => void handleTestLayout()} disabled={layoutSaving}>
                {layoutSaving ? 'Testing...' : 'Test Layout Print'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>
      </div>

      <div className="settings-overview-utility-grid">
        <SettingsOverviewCard
          compact
          icon="branch"
          tone="blue"
          eyebrow="Branch Master Data"
          title="Download Local Branch Data"
          description="Sign in, choose branch and location, then refresh local branch data."
        >
          <div className="settings-overview-surface settings-overview-surface--compact">
            <div className="settings-overview-info-grid">
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Branch</span>
                <strong>{branchLabel || 'Not selected'}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Location</span>
                <strong>{locationLabel || 'Not selected'}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Last Download</span>
                <strong>{state.sync.lastSyncedAt ? formatDateTime(state.sync.lastSyncedAt) : 'Not yet'}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Status</span>
                <SettingsStatusBadge label={branchStatusLabel} tone={branchStatusTone} />
              </div>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={openSetupAccessPrompt}>
                Manage Setup
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
            </div>
          </div>
        </SettingsOverviewCard>

        <SettingsOverviewCard
          compact
          icon="printer"
          tone="blue"
          eyebrow="Printer"
          title="Receipt Printer"
          description="Choose printer mode, save the path, then run a test print."
        >
          <div className="settings-overview-surface settings-overview-surface--compact">
            <div className="settings-overview-info-grid">
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Current Path</span>
                <strong>{printerPathLabel}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Saved Profiles</span>
                <strong>{state.printerProfiles.length}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Mode</span>
                <strong>{form.printerMode}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Status</span>
                <SettingsStatusBadge label={printerStatusLabel} tone={printerStatusTone} />
              </div>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => setPrinterModalOpen(true)}>
                Manage Printer Settings
              </button>
              <button className="secondary-btn" type="button" onClick={() => void runPrinterTest()} disabled={testingPrinter || form.printerMode === 'NONE'}>
                {testingPrinter ? 'Testing...' : 'Test Print'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>

        <SettingsOverviewCard
          compact
          icon="update"
          tone="orange"
          eyebrow="Software Update"
          title="Desktop OTA"
          description="Check for updates and install the latest signed desktop package."
        >
          <div className="settings-overview-surface settings-overview-surface--compact">
            <div className="settings-overview-info-grid">
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Installed Version</span>
                <strong>{appVersion}</strong>
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Latest Check</span>
                <SettingsStatusBadge label={latestCheckLabel} tone={latestCheckTone} />
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Install Safety</span>
                <SettingsStatusBadge
                  label={updateSafety.safe ? (hasActiveShift ? 'Shift Open' : 'Ready') : 'Action Needed'}
                  tone={updateSafety.safe ? (hasActiveShift ? 'warn' : 'good') : 'danger'}
                />
              </div>
              <div className="settings-overview-info-item">
                <span className={settingsStatusLabelClass}>Checked At</span>
                <strong>{updateResult?.checkedAt ? formatDateTime(updateResult.checkedAt) : 'Not checked yet'}</strong>
              </div>
            </div>
            {updateResult?.required ? (
              <div className="rounded-[14px] border border-amber-300 bg-amber-50 px-3 py-2 text-[0.82rem] font-semibold text-amber-900">
                This update is required for continued support. Sync pending work before installation.
              </div>
            ) : null}
            {updateResult?.policy?.releaseNotes || manifestReleaseNotes ? (
              <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2 text-[0.82rem] leading-5 text-[var(--muted-strong)]">
                <strong className="block text-[var(--text-strong)]">What is included</strong>
                {updateResult?.policy?.releaseNotes ?? manifestReleaseNotes}
              </div>
            ) : null}
            {updateSafety.blockers.length > 0 || updateSafety.warnings.length > 0 ? (
              <div className="grid gap-1 text-[0.8rem] leading-5 text-[var(--muted-strong)]">
                {[...updateSafety.blockers, ...updateSafety.warnings].map((item) => (
                  <span key={item}>• {item}</span>
                ))}
              </div>
            ) : (
              <div className="text-[0.8rem] text-emerald-700">No pending records or active sync operations block installation.</div>
            )}
            {updateStatus === 'downloading' || updateStatus === 'installing' ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-label="Update download in progress">
                <span className="block h-full w-2/3 animate-pulse rounded-full bg-[var(--accent)]" />
              </div>
            ) : null}
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => void handleCheckForUpdates()} disabled={checkingForUpdate}>
                {checkingForUpdate ? 'Checking...' : 'Check for Updates'}
              </button>
              {pendingOutboxCount > 0 && onRunSync ? (
                <button className="secondary-btn" type="button" onClick={() => void onRunSync()} disabled={syncBusy}>
                  {syncBusy ? 'Syncing...' : `Sync ${pendingOutboxCount} Unsynced`}
                </button>
              ) : null}
              <button
                className="primary-btn"
                type="button"
                onClick={() => void handleInstallUpdate()}
                disabled={installingUpdate || !updateSafety.safe || !updateResult?.available || !updateResult.manifest}
              >
                {installingUpdate
                  ? 'Installing...'
                  : updateResult?.available && updateResult.manifest
                    ? `Install ${updateResult.manifest.version}`
                    : 'Install Update'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>

        <SettingsOverviewCard
          compact
          icon="reset"
          tone="rose"
          eyebrow="Device Data"
          title="Reset Local Desktop Data"
          description="Use this only when you want to restart desktop testing from a clean local state."
        >
          <div className="settings-overview-surface settings-overview-surface--compact">
            <div className="settings-overview-surface-head">
              <strong>Clear Local Records</strong>
              <span>This clears local sales, sync queue, cached branch data, saved printer profiles, PIN, and sign-in on this desktop device.</span>
            </div>
            <div className={settingsActionRowClass}>
              <button className="secondary-btn" type="button" onClick={() => setResetConfirmOpen(true)} disabled={resetBusy}>
                {resetBusy ? 'Resetting...' : 'Reset Local Data'}
              </button>
            </div>
          </div>
        </SettingsOverviewCard>
      </div>

      <div className="settings-overview-banner">
        <SettingsOverviewGlyph kind="info" tone="blue" />
        <span>{message}</span>
      </div>

      {setupAccessPromptOpen ? (
        <div className={settingsModalBackdropClass} onClick={closeSetupAccessPrompt}>
          <div className={settingsActionModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header settings-pin-modal-head">
              <div>
                <div className="eyebrow">Branch Master Data</div>
                <h3>Manage Setup Access</h3>
              </div>
              <SettingsModalCloseButton onClick={closeSetupAccessPrompt} />
            </div>

            <div className="desktop-modal-body settings-pin-stack">
              <p className={settingsHelperClass}>Enter the access password before opening workstation setup on this device.</p>
              <div className="settings-pin-field">
                <span className="settings-pin-label">Access Password</span>
                <input
                  className="settings-access-input"
                  type="password"
                  value={setupAccessPassword}
                  onChange={(event) => setSetupAccessPassword(event.target.value)}
                  placeholder="Enter access password"
                  autoFocus
                />
              </div>
            </div>

            <div className="desktop-modal-footer settings-pin-actions">
              <button className="secondary-btn" type="button" onClick={closeSetupAccessPrompt}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={handleConfirmSetupAccess}>
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {setupModalOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !saving && !signingIn && setSetupModalOpen(false)}>
          <div className={settingsSetupModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={settingsModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Branch Master Data</div>
                  <h3>Workstation Setup</h3>
                  <p className={settingsHelperClass}>Sign in this workstation, choose branch and location, then refresh the local branch data before using desktop POS.</p>
                </div>
                <SettingsModalCloseButton onClick={() => setSetupModalOpen(false)} disabled={saving || signingIn} />
              </div>
            </div>

            <div className="desktop-modal-body settings-layout-stack">
              <section className="payment-section-card settings-layout-section">
                <div className="settings-overview-info-grid">
                  <div className="settings-overview-info-item">
                    <span className={settingsStatusLabelClass}>Branch</span>
                    <strong>{branchLabel || 'Not selected'}</strong>
                  </div>
                  <div className="settings-overview-info-item">
                    <span className={settingsStatusLabelClass}>Location</span>
                    <strong>{locationLabel || 'Not selected'}</strong>
                  </div>
                  <div className="settings-overview-info-item">
                    <span className={settingsStatusLabelClass}>Last Download</span>
                    <strong>{state.sync.lastSyncedAt ? formatDateTime(state.sync.lastSyncedAt) : 'Not yet'}</strong>
                  </div>
                  <div className="settings-overview-info-item">
                    <span className={settingsStatusLabelClass}>Status</span>
                    <SettingsStatusBadge label={branchStatusLabel} tone={branchStatusTone} />
                  </div>
                </div>
              </section>

              <section className="payment-section-card settings-layout-section">
                <div className={settingsSubheadClass}>
                  <strong>Workstation Setup</strong>
                  <span>These details stay on this device so the cashier can keep working locally even after restart.</span>
                </div>
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
              </section>
            </div>

            <div className="desktop-modal-footer checkout-action-row pos-payment-actions">
              <button className="secondary-btn checkout-btn checkout-btn-support" type="button" onClick={() => setSetupModalOpen(false)} disabled={saving || signingIn}>
                Back
              </button>
              <button className="secondary-btn checkout-btn checkout-btn-print-inline" type="button" onClick={() => void handleSaveSetup()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Desktop Setup'}
              </button>
              <button className="primary-btn checkout-btn" type="button" onClick={() => void handleSignIn()} disabled={signingIn}>
                {signingIn ? 'Signing In...' : state.auth.accessToken ? 'Refresh Sign In' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {printerModalOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !savingProfile && !testingPrinter && !discoveringPrinters && setPrinterModalOpen(false)}>
          <div className={settingsPrinterModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={settingsModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Printer</div>
                  <h3>Receipt Printer Settings</h3>
                  <p className={settingsHelperClass}>Choose printer mode, save the printer path, then run a test print.</p>
                </div>
                <SettingsModalCloseButton
                  onClick={() => setPrinterModalOpen(false)}
                  disabled={savingProfile || testingPrinter || discoveringPrinters}
                />
              </div>
            </div>

            <div className="desktop-modal-body settings-layout-stack">
              <section className="payment-section-card settings-layout-section">
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
                      const profile = await persistProfile({ announceSuccess: false });
                      if (profile) {
                        await runPrinterTest(profile);
                      }
                    }}
                    disabled={savingProfile || testingPrinter || form.printerMode === 'NONE'}
                  >
                    {testingPrinter ? 'Testing...' : 'Save & Test Profile'}
                  </button>
                </div>
              </section>

              {selectedProfile ? (
                <section className="payment-section-card settings-layout-section">
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
                </section>
              ) : null}

              <section className="payment-section-card settings-layout-section">
                <div className={settingsSubheadClass}>
                  <strong>Saved Printer Profiles</strong>
                  <span>Tap a saved profile to apply it again, rerun a test, or remove it from this device.</span>
                </div>
                <div className={settingsProfileListClass}>
                  {state.printerProfiles.length === 0 ? (
                    <div className="empty-state">No saved printer profiles yet. Save one after choosing a USB or LAN printer path.</div>
                  ) : (
                    state.printerProfiles.map((profile) => (
                      <article key={profile.id} className={`${settingsProfileCardClass} ${selectedProfileId === profile.id ? settingsProfileSelectedClass : ''}`}>
                        <button type="button" className={settingsProfileButtonClass} onClick={() => applyProfile(profile)}>
                          <div className="grid gap-1.5">
                            <span className={settingsStatusLabelClass}>Profile</span>
                            <strong className={settingsStatusValueClass}>{profile.label}</strong>
                            <span className="text-[0.88rem] text-[var(--muted)]">
                              {profile.mode === 'USB'
                                ? profile.printerName || 'USB printer name not set'
                                : `${profile.printerHost || 'LAN host not set'}:${profile.printerPort || '9100'}`}
                            </span>
                          </div>
                          <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)] md:justify-items-end">
                            <span className={settingsStatusLabelClass}>Mode</span>
                            <strong className={settingsStatusValueClass}>{profile.mode}</strong>
                            <span className="text-[0.84rem] text-[var(--muted)]">Last success: {formatDateTime(profile.lastSuccessAt)}</span>
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
              </section>
            </div>

            <div className="desktop-modal-footer settings-pin-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setPrinterModalOpen(false)}
                disabled={savingProfile || testingPrinter || discoveringPrinters}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                <SettingsModalCloseButton onClick={() => !layoutSaving && setLayoutModalOpen(false)} disabled={layoutSaving} />
              </div>
            </div>

            <div className="desktop-modal-body settings-layout-stack">
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
                  <div className={`${settingsStatusCardClass} settings-layout-spacing-card`}>
                    <span className={settingsStatusLabelClass}>Top Padding Lines</span>
                    <strong className={settingsStatusValueClass}>{layoutDraft.topPaddingLines}</strong>
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
                  <div className={`${settingsStatusCardClass} settings-layout-spacing-card`}>
                    <span className={settingsStatusLabelClass}>Bottom Padding Lines</span>
                    <strong className={settingsStatusValueClass}>{layoutDraft.bottomPaddingLines}</strong>
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

            </div>
            <div className="desktop-modal-footer checkout-action-row pos-payment-actions">
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
      ) : null}

      {pinModalOpen ? (
        <div className={settingsModalBackdropClass} onClick={() => !pinSaving && setPinModalOpen(false)}>
          <div className={settingsActionModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header settings-pin-modal-head">
              <div>
                <div className="eyebrow">Security PIN</div>
                <h3>{pinConfigured ? 'Change PIN' : 'Set PIN'}</h3>
              </div>
              <SettingsModalCloseButton onClick={() => !pinSaving && setPinModalOpen(false)} disabled={pinSaving} />
            </div>

            <div className="desktop-modal-body settings-pin-stack">
              <p className={settingsHelperClass}>Use a 4-digit PIN for fast offline unlock.</p>
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

            <div className="desktop-modal-footer settings-pin-actions">
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
          <div className={settingsActionModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header settings-pin-modal-head">
              <div>
                <div className="eyebrow">Device Data</div>
                <h3>Reset Local Desktop Data</h3>
              </div>
              <SettingsModalCloseButton onClick={() => !resetBusy && setResetConfirmOpen(false)} disabled={resetBusy} />
            </div>

            <div className="desktop-modal-body settings-pin-stack">
              <p className={settingsHelperClass}>
                This will clear local sales, sync queue, cached branch data, saved printer profiles, PIN, and saved sign-in on this desktop device.
              </p>
              <div className="sync-banner error">
                <strong>Fresh test reset</strong>
                <span>Use this only when you want the device to go back to the startup flow for fresh POS testing.</span>
              </div>
            </div>
            <div className="desktop-modal-footer settings-pin-actions">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                disabled={resetBusy}
              >
                Cancel
              </button>
              <button className="primary-btn bg-[#b91c1c] border-transparent text-white hover:bg-[#a11a1a]" type="button" onClick={() => void handleResetLocalData()} disabled={resetBusy}>
                {resetBusy ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

