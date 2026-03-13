import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import Toast from "react-native-toast-message";
import type { PrinterType } from "@vpos/printing-core";
import type { ReceiptDocument } from "@vpos/printing-core";
import { getDatabase, initDatabase } from "./src/db/sqlite";
import {
  AuthTransportError,
  HttpAuthTransport,
} from "./src/features/auth/http-auth.transport";
import {
  type AuthStage,
  MobileAuthFlow,
} from "./src/features/auth/mobile-auth-flow";
import {
  MobilePrinterService,
  type MobilePrinterRuntimeCapabilities,
} from "./src/features/printer/mobile-printer.service";
import { LocalSessionService } from "./src/features/auth/local-session.service";
import { HttpSyncTransport } from "./src/features/sync/http-sync.transport";
import { MobileSyncOrchestrator } from "./src/features/sync/mobile-sync-orchestrator";
import { MobileSubscriptionPolicyService } from "./src/features/sync/mobile-subscription-policy.service";
import { SQLiteOutboxRepository } from "./src/outbox/sqlite-outbox.repository";
import {
  goeyToastConfig,
  setToastTopOffset,
  toastError,
  toastInfo,
  toastSuccess,
} from "./src/app/goey-toast";
import { type AppTheme, darkTheme, lightTheme } from "./src/app/theme";
import { HomeScreen } from "./src/app/screens/HomeScreen";
import {
  PosScreen,
  type PosQueuedSaleReceiptPayload,
} from "./src/app/screens/PosScreen";
import { SalesScreen } from "./src/app/screens/SalesScreen";
import { TransfersScreen } from "./src/app/screens/TransfersScreen";
import { TransferListScreen } from "./src/app/screens/TransferListScreen";
import { ExpenseScreen } from "./src/app/screens/ExpenseScreen";
import { ItemsViewScreen } from "./src/app/screens/ItemsViewScreen";
import { CustomersViewScreen } from "./src/app/screens/CustomersViewScreen";
import { ShiftScreen } from "./src/app/screens/ShiftScreen";
import { SettingsScreen } from "./src/app/screens/SettingsScreen";
import { MasterDataSelect } from "./src/app/components/MasterDataSelect";
import { PinCodeInput } from "./src/app/components/PinCodeInput";
import { EnrollmentScannerModal } from "./src/app/components/EnrollmentScannerModal";
import {
  loadBranchOptions,
  loadLocationOptions,
  loadUserOptions,
  type MasterDataOption,
} from "./src/app/master-data-local";
import {
  type PosDefaultLpgFlow,
  getStartupState,
  updateStartupState,
} from "./src/app/startup-state";
import { getOrCreateDeviceId } from "./src/app/device-identity";
import { MasterDataBootstrapService } from "./src/features/bootstrap/master-data-bootstrap.service";
import { normalizeApiBaseUrl } from "./src/app/api-base-url";
import {
  type ReceiptLayoutSettings,
  DEFAULT_RECEIPT_LAYOUT_SETTINGS,
  loadReceiptLayoutSettings,
  normalizeReceiptLayoutSettings,
  saveReceiptLayoutSettings,
} from "./src/app/receipt-layout-settings";
import { TutorialProvider, useTutorialActions, useTutorialState, useTutorialTarget } from "./src/app/tutorial/tutorial-provider";
import { TutorialOverlayHost } from "./src/app/tutorial/tutorial-overlay-host";
import type { TutorialScope, TutorialScreenKey } from "./src/app/tutorial/tutorial-types";

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? "http://192.168.1.14:3001/api",
);
const CONFIGURED_DEVICE_ID = env?.EXPO_PUBLIC_DEVICE_ID ?? "";
const APP_LOGO = require("./assests/vpos_logo.png");

const PRIMARY_TABS = ["HOME", "POS", "SALES", "TRANSFER", "TRANSFER_LIST"] as const;
const SIDE_MENU_MODULES = [
  "EXPENSE",
  "ITEMS",
  "CUSTOMERS",
  "SHIFT",
  "SETTINGS",
] as const;
type PrimaryTab = (typeof PRIMARY_TABS)[number];
type SideModule = (typeof SIDE_MENU_MODULES)[number];
type ReadyView = PrimaryTab | SideModule;
type UiStage = AuthStage | "BRANCH_SETUP" | "SUBSCRIPTION_ENDED";
type ThemeMode = "LIGHT" | "DARK";
const READY_VIEW_META: Record<ReadyView, { label: string; hint: string }> = {
  HOME: { label: "Home", hint: "Overview" },
  POS: { label: "POS", hint: "Sales" },
  SALES: { label: "Sales", hint: "History" },
  TRANSFER: { label: "Transfer", hint: "Create" },
  TRANSFER_LIST: { label: "Transfers", hint: "History" },
  EXPENSE: { label: "Expense", hint: "Petty Cash" },
  ITEMS: { label: "Items", hint: "Read Only" },
  CUSTOMERS: { label: "Customers", hint: "Credit" },
  SHIFT: { label: "Shift", hint: "Register" },
  SETTINGS: { label: "Settings", hint: "Device" },
};
const READY_VIEW_ICONS: Record<ReadyView, string> = {
  HOME: "\u2302",
  POS: "\u25A3",
  SALES: "\u25A4",
  TRANSFER: "\u2194",
  TRANSFER_LIST: "\u2630",
  EXPENSE: "\u20B1",
  ITEMS: "\u25A6",
  CUSTOMERS: "\u263A",
  SHIFT: "\u25F7",
  SETTINGS: "\u2699",
};

function decodeBase64ToString(base64: string): string | null {
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof atobFn === "function") {
    try {
      return atobFn(base64);
    } catch {
      return null;
    }
  }

  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean || clean.length % 4 !== 0) {
    return null;
  }

  let output = "";
  for (let index = 0; index < clean.length; index += 4) {
    const c1 = clean.charAt(index);
    const c2 = clean.charAt(index + 1);
    const c3 = clean.charAt(index + 2);
    const c4 = clean.charAt(index + 3);

    const n1 = alphabet.indexOf(c1);
    const n2 = alphabet.indexOf(c2);
    const n3 = c3 === "=" ? 0 : alphabet.indexOf(c3);
    const n4 = c4 === "=" ? 0 : alphabet.indexOf(c4);
    if (n1 < 0 || n2 < 0 || (c3 !== "=" && n3 < 0) || (c4 !== "=" && n4 < 0)) {
      return null;
    }

    const b1 = (n1 << 2) | (n2 >> 4);
    output += String.fromCharCode(b1);

    if (c3 !== "=") {
      const b2 = ((n2 & 0x0f) << 4) | (n3 >> 2);
      output += String.fromCharCode(b2);
    }

    if (c4 !== "=") {
      const b3 = ((n3 & 0x03) << 6) | n4;
      output += String.fromCharCode(b3);
    }
  }

  return output;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const raw = parts[1]?.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const withPadding =
    padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  const decoded = decodeBase64ToString(withPadding);
  if (!decoded) {
    return null;
  }

  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveCashierNameFromToken(
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) {
    return null;
  }
  const candidates = [
    payload.full_name,
    payload.fullName,
    payload.display_name,
    payload.displayName,
    payload.name,
    payload.preferred_username,
    payload.username,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim();
      if (normalized.includes("@")) {
        continue;
      }
      return normalized;
    }
  }
  return null;
}

function asPayloadString(
  payload: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!payload) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function logPrinterDebug(
  event: string,
  payload?: Record<string, unknown>,
): void {
  try {
    if (payload) {
      // eslint-disable-next-line no-console
      console.log(`[VPOS][PRINTER] ${event}`, payload);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[VPOS][PRINTER] ${event}`);
  } catch {
    // no-op
  }
}

function normalizeTcpHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  const hostOnly = withoutProtocol.split("/")[0]?.trim() ?? "";
  return hostOnly;
}

function parseTcpHostAndPort(
  hostInput: string,
  portInput: string,
): { host: string; port: number } | null {
  const normalizedHost = normalizeTcpHost(hostInput);
  if (!normalizedHost) {
    return null;
  }

  const isIpv6 = normalizedHost.includes("[") || normalizedHost.includes("]");
  const hasSingleColon = normalizedHost.split(":").length === 2;
  if (!isIpv6 && hasSingleColon && normalizedHost.includes(":")) {
    const [hostPart, portPart] = normalizedHost.split(":");
    const parsed = Number(portPart);
    if (hostPart && Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
      return { host: hostPart, port: parsed };
    }
  }

  const parsedPort = Number(portInput || "9100");
  if (!Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    return null;
  }
  return { host: normalizedHost, port: parsedPort };
}

function readEnrollmentTokenFromUrl(rawUrl: string | null | undefined): string | null {
  const normalized = (rawUrl ?? "").trim();
  if (!normalized) {
    return null;
  }

  const directMatch = normalized.match(/[?&](?:token|setup_token)=([^&]+)/i);
  if (directMatch?.[1]) {
    try {
      return decodeURIComponent(directMatch[1]).trim() || null;
    } catch {
      return directMatch[1].trim() || null;
    }
  }

  const pathMatch = normalized.match(/\/enroll\/([^/?#]+)/i);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]).trim() || null;
    } catch {
      return pathMatch[1].trim() || null;
    }
  }

  return null;
}

function buildReceiptNumber(branchId: string, saleId: string): string {
  const compact =
    saleId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toUpperCase() || "000001";
  return `${branchId.toUpperCase()}-${compact}`;
}

function buildPosReceiptDocument(
  input: PosQueuedSaleReceiptPayload,
  receiptNumber: string,
  layout: ReceiptLayoutSettings,
): ReceiptDocument {
  const safeLayout = normalizeReceiptLayoutSettings(layout);
  const lines: ReceiptDocument["lines"] = [];
  const resolveLogoBase64 = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    const marker = "base64,";
    const index = trimmed.indexOf(marker);
    if (index >= 0) {
      return trimmed.slice(index + marker.length).trim();
    }
    return trimmed;
  };
  const formatQty = (value: number): string =>
    Number.isInteger(value) ? String(value) : value.toFixed(2);
  const qtyTotal = input.lines.reduce((sum, line) => sum + line.quantity, 0);
  const itemCount = input.lines.length;
  const hasBalanceDue = input.creditBalance > 0.009;
  const hasPersonnel = Boolean((input.personnelName ?? "").trim());
  const hasHelper = Boolean((input.helperName ?? "").trim());
  const addLine = (
    condition: boolean,
    text: string,
    align: "left" | "center" | "right" = "left",
    emphasis = false,
  ): void => {
    if (!condition) {
      return;
    }
    lines.push({ align, text, emphasis });
  };

  const logoBase64 = resolveLogoBase64(safeLayout.headerLogoImageDataUrl);
  if (safeLayout.showHeaderLogoImage && logoBase64) {
    const logoAlign =
      safeLayout.headerLogoPlacement === "LEFT"
        ? "left"
        : safeLayout.headerLogoPlacement === "RIGHT"
          ? "right"
          : "center";
    lines.push({
      align: logoAlign,
      text: "",
      imageBase64: logoBase64,
      imageWidth: 220,
    });
  }

  addLine(
    safeLayout.showHeaderLogoText,
    safeLayout.headerLogoText.trim() || "VMJAM LPG",
    "center",
    true,
  );
  addLine(
    safeLayout.showStoreContact && Boolean(safeLayout.storeContactInfo.trim()),
    safeLayout.storeContactInfo.trim(),
    "center",
    true,
  );
  addLine(
    safeLayout.showStoreAddress && Boolean(safeLayout.storeAddress.trim()),
    safeLayout.storeAddress.trim(),
    "center",
    true,
  );
  addLine(
    safeLayout.showBusinessTin && Boolean(safeLayout.businessTin.trim()),
    safeLayout.businessTin.trim(),
    "center",
    true,
  );
  addLine(
    safeLayout.showPermitOrInfo && Boolean(safeLayout.permitOrInfo.trim()),
    safeLayout.permitOrInfo.trim(),
    "center",
    true,
  );
  addLine(
    safeLayout.showReceiptNumber,
    `Receipt #${receiptNumber}`,
    "center",
    true,
  );
  addLine(safeLayout.showSaleId, `Sale ID: ${input.saleId}`, "left", true);
  addLine(
    safeLayout.showDateTime,
    `Date: ${new Date(input.createdAt).toLocaleString()}`,
    "left",
    true,
  );
  addLine(safeLayout.showBranch, `Branch: ${input.branchName}`, "left", true);
  addLine(
    safeLayout.showLocation,
    `Location: ${input.locationName}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showTerminalName && Boolean(safeLayout.terminalName.trim()),
    `Terminal: ${safeLayout.terminalName.trim()}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showCashier,
    `Cashier: ${input.cashierName ?? "-"}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showCashierRole && Boolean(safeLayout.cashierRoleLabel.trim()),
    `Role: ${safeLayout.cashierRoleLabel.trim()}`,
    "left",
    true,
  );
  addLine(safeLayout.showOrderType, `Type: ${input.orderType}`, "left", true);
  addLine(
    safeLayout.showCustomer,
    `Customer: ${input.customerName ?? "-"}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showPersonnel && hasPersonnel,
    `Personnel: ${input.personnelName?.trim() ?? ""}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showHelper && hasHelper,
    `Helper: ${input.helperName?.trim() ?? ""}`,
    "left",
    true,
  );

  lines.push({ align: "left", text: "------------------------------" });
  lines.push(
    ...input.lines.flatMap((line) => {
      const itemName =
        safeLayout.showItemCode && line.subtitle
          ? `${line.subtitle} - ${line.name}`
          : line.name;
      return [
        {
          align: "left" as const,
          text: `${formatQty(line.quantity)} x ${itemName}`,
          emphasis: true,
        },
        {
          align: "right" as const,
          text: `  @ ${line.unitPrice.toFixed(2)} = ${(line.quantity * line.unitPrice).toFixed(2)}`,
          emphasis: true,
        },
      ];
    }),
  );
  lines.push({ align: "left", text: "------------------------------" });
  addLine(true, `QTY TOTAL: ${formatQty(qtyTotal)}`, "left", true);
  addLine(true, `ITEM COUNT: ${itemCount}`, "left", true);
  lines.push({ align: "left", text: "------------------------------" });

  addLine(
    safeLayout.showSubtotal,
    `Subtotal: PHP ${input.subtotal.toFixed(2)}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showDiscount,
    `Discount: PHP ${input.discount.toFixed(2)}`,
    "left",
    true,
  );
  lines.push({ align: "left", text: "------------------------------" });
  addLine(true, "GRAND TOTAL", "center", true);
  addLine(true, `PHP ${input.total.toFixed(2)}`, "center", true);
  lines.push({ align: "left", text: "------------------------------" });
  addLine(
    safeLayout.showTotal,
    `Total: PHP ${input.total.toFixed(2)}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showPaid,
    `Paid (${input.paymentMethod}): PHP ${input.paidAmount.toFixed(2)}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showChange,
    `Change: PHP ${input.changeAmount.toFixed(2)}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showCreditDue && hasBalanceDue,
    `Credit Due: PHP ${input.creditBalance.toFixed(2)}`,
    "left",
    true,
  );
  addLine(
    safeLayout.showPaymentMode,
    `Payment Mode: ${input.paymentMode}`,
    "left",
    true,
  );
  addLine(Boolean(input.notes), `Notes: ${input.notes ?? ""}`, "left", true);
  lines.push({ align: "left", text: "------------------------------" });
  addLine(
    true,
    hasBalanceDue
      ? `BALANCE DUE: PHP ${input.creditBalance.toFixed(2)}`
      : `CHANGE: PHP ${input.changeAmount.toFixed(2)}`,
    "center",
    true,
  );

  return {
    title: "VPOS RECEIPT",
    isReprint: false,
    lines,
    footer: safeLayout.showFooter
      ? safeLayout.footerText.trim() || "Thank you for choosing VPOS LPG."
      : undefined,
    footerEmphasis: true,
    topPaddingLines: safeLayout.topPaddingLines,
    bottomPaddingLines: safeLayout.bottomPaddingLines,
  };
}

function AppShell(): JSX.Element {
  const scheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    scheme === "light" ? "LIGHT" : "DARK",
  );
  const theme = themeMode === "LIGHT" ? lightTheme : darkTheme;
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [stage, setStage] = useState<UiStage>("BOOTING");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionEndedMessage, setSubscriptionEndedMessage] = useState<string | null>(null);
  const [startupConnectivityChecked, setStartupConnectivityChecked] =
    useState(false);
  const [startupConnectivityChecking, setStartupConnectivityChecking] =
    useState(false);
  const [showNoInternetPage, setShowNoInternetPage] = useState(false);
  const [noInternetMessage, setNoInternetMessage] = useState<string>(
    "Unable to reach server.",
  );
  const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTab>("HOME");
  const [activeSideModule, setActiveSideModule] = useState<SideModule | null>(
    null,
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedBranchName, setSelectedBranchName] = useState<string | null>(
    null,
  );
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedLocationName, setSelectedLocationName] = useState<
    string | null
  >(null);
  const [branchLocationOptions, setBranchLocationOptions] = useState<
    MasterDataOption[]
  >([]);
  const [lastMasterDataSyncAt, setLastMasterDataSyncAt] = useState<
    string | null
  >(null);
  const [masterDataFingerprint, setMasterDataFingerprint] = useState<
    string | null
  >(null);
  const [masterDataUpdateAvailable, setMasterDataUpdateAvailable] =
    useState(false);
  const [branchDataBusy, setBranchDataBusy] = useState(false);
  const [masterDataVersion, setMasterDataVersion] = useState(0);
  const [notifiedFingerprint, setNotifiedFingerprint] = useState<string | null>(
    null,
  );
  const [branchOptions, setBranchOptions] = useState<MasterDataOption[]>([]);
  const [branchSetupBusy, setBranchSetupBusy] = useState(false);
  const [branchSetupMessage, setBranchSetupMessage] = useState<string | null>(
    null,
  );
  const [serverOnline, setServerOnline] = useState(false);
  const [tutorialSeenAt, setTutorialSeenAt] = useState<string | null>(null);
  const [tutorialSeenKeys, setTutorialSeenKeys] = useState<string[]>([]);
  const [tutorialProgressByScope, setTutorialProgressByScope] = useState<
    Record<string, number>
  >({});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pendingEnrollmentToken, setPendingEnrollmentToken] = useState<
    string | null
  >(null);
  const [enrollmentScannerOpen, setEnrollmentScannerOpen] = useState(false);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [hasCachedSession, setHasCachedSession] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [pendingCount, setPendingCount] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [currentCashierName, setCurrentCashierName] = useState<string | null>(
    null,
  );

  const [printerType, setPrinterType] = useState<PrinterType>("NONE");
  const [printerBluetoothMac, setPrinterBluetoothMac] = useState("");
  const [printerTcpHost, setPrinterTcpHost] = useState("");
  const [printerTcpPort, setPrinterTcpPort] = useState("9100");
  const [printerCapabilities, setPrinterCapabilities] =
    useState<MobilePrinterRuntimeCapabilities | null>(null);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerMessage, setPrinterMessage] = useState<string | null>(null);
  const [receiptLayoutSettings, setReceiptLayoutSettings] =
    useState<ReceiptLayoutSettings>(DEFAULT_RECEIPT_LAYOUT_SETTINGS);
  const [posDefaultLpgFlow, setPosDefaultLpgFlow] =
    useState<PosDefaultLpgFlow>("NONE");

  const authFlowRef = useRef<MobileAuthFlow | null>(null);
  const printerServiceRef = useRef<MobilePrinterService | null>(null);
  const deviceIdRef = useRef<string>("");
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sideMenuAnim = useRef(new Animated.Value(0)).current;
  const rootViewRef = useRef<View | null>(null);
  const contentScrollRef = useRef<ScrollView | null>(null);
  const contentScrollYRef = useRef(0);
  const lastTutorialMeasureTsRef = useRef(0);
  const [sideMenuMounted, setSideMenuMounted] = useState(false);
  const tutorialCheckRef = useRef<TutorialScope | null>(null);
  const startupProbeAbortRef = useRef<AbortController | null>(null);
  const enrollmentListenerRef = useRef<{ remove: () => void } | null>(null);
  const lastEnrollmentClaimTokenRef = useRef<string | null>(null);
  const tutorialState = useTutorialState();
  const tutorialActions = useTutorialActions();
  const moduleHelpTarget = useTutorialTarget("module-help");
  const currentReadyView: ReadyView = activeSideModule ?? activePrimaryTab;
  const tutorialScopeForReadyView: TutorialScope =
    currentReadyView === "TRANSFER_LIST" ? "TRANSFER" : currentReadyView;
  const tutorialScope = tutorialState.scope;
  const isTutorialTargetActive = tutorialActions.isTargetActive;
  const androidStatusInset =
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const headerTopPadding = 10 + androidStatusInset;
  const contentTopPaddingNoHeader = 16 + androidStatusInset;
  const contentTopPadding = 80 + androidStatusInset;
  const showTopHeader = stage === "READY";
  const notificationCount =
    (pendingCount > 0 ? 1 : 0) + (masterDataUpdateAvailable ? 1 : 0);

  const navigateToTutorialScreen = useCallback((screen: TutorialScreenKey): void => {
    if (screen === "HOME" || screen === "POS" || screen === "SALES" || screen === "TRANSFER") {
      setActivePrimaryTab(screen);
      setActiveSideModule(null);
      return;
    }

    setActivePrimaryTab("HOME");
    setActiveSideModule(screen);
  }, []);

  const ensureTutorialTargetVisible = useCallback((rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void => {
    if (stage !== "READY") {
      return;
    }
    const scroll = contentScrollRef.current;
    if (!scroll) {
      return;
    }
    const windowHeight = Dimensions.get("window").height;
    const topBound = headerTopPadding + 70;
    const bottomBound = windowHeight - 180;
    const currentScrollY = contentScrollYRef.current;

    if (rect.y < topBound) {
      const delta = topBound - rect.y + 20;
      scroll.scrollTo({ y: Math.max(currentScrollY - delta, 0), animated: true });
      return;
    }

    const rectBottom = rect.y + rect.height;
    if (rectBottom > bottomBound) {
      const delta = rectBottom - bottomBound + 20;
      scroll.scrollTo({ y: Math.max(currentScrollY + delta, 0), animated: true });
    }
  }, [stage, headerTopPadding]);

  const refreshTutorialViewportOffset = useCallback(() => {
    const root = rootViewRef.current;
    if (!root || typeof root.measureInWindow !== "function") {
      tutorialActions.setViewportOffset(null);
      return;
    }
    root.measureInWindow((x, y) => {
      tutorialActions.setViewportOffset({ x, y });
    });
  }, [tutorialActions]);

  const isAuthInputDisabled = useMemo(
    () => busy || stage === "BOOTING",
    [busy, stage],
  );

  const shouldRunStartupConnectivityGate = useMemo(() => {
    if (busy || stage === "BOOTING") {
      return false;
    }
    if (stage === "UNLOCK") {
      return false;
    }
    // If device already has a cached authenticated session, keep UI accessible
    // offline and avoid hard-blocking with the no-internet page.
    if (hasCachedSession) {
      return false;
    }
    return stage === "LOGIN" || stage === "BRANCH_SETUP";
  }, [busy, hasCachedSession, stage]);

  const probeStartupServerConnection = useCallback(async (): Promise<{
    online: boolean;
    message: string;
  }> => {
    const controller = new AbortController();
    startupProbeAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(
        `${API_BASE_URL}/sync/pull?since=0&device_id=startup-connectivity-probe`,
        {
          method: "GET",
          signal: controller.signal,
        },
      );
      if (response.status >= 100) {
        return {
          online: true,
          message: "Server reachable.",
        };
      }
      return {
        online: false,
        message: `Server responded with status ${response.status}.`,
      };
    } catch (cause) {
      const detail =
        cause instanceof Error ? cause.message : "Network request failed";
      return {
        online: false,
        message: `No internet/server connection. ${detail}`,
      };
    } finally {
      clearTimeout(timeout);
      if (startupProbeAbortRef.current === controller) {
        startupProbeAbortRef.current = null;
      }
    }
  }, []);

  const runStartupConnectivityCheck = useCallback(
    async (manual = false): Promise<void> => {
      if (startupConnectivityChecking) {
        return;
      }
      setStartupConnectivityChecking(true);
      const probe = await probeStartupServerConnection();
      setServerOnline(probe.online);
      if (probe.online) {
        setShowNoInternetPage(false);
        setStartupConnectivityChecked(true);
        if (manual) {
          toastSuccess("Connection restored", "Server is reachable.");
        }
      } else {
        setNoInternetMessage(probe.message);
        setShowNoInternetPage(true);
        setStartupConnectivityChecked(true);
        if (manual) {
          toastError("No internet connection", probe.message);
        }
      }
      setStartupConnectivityChecking(false);
    },
    [probeStartupServerConnection, startupConnectivityChecking],
  );

  const resolveSubscriptionEndedMessage = useCallback((cause: unknown): string | null => {
    if (cause instanceof AuthTransportError && cause.code === "SUBSCRIPTION_ENDED") {
      if (typeof cause.payload === "object" && cause.payload !== null) {
        const payload = cause.payload as { message?: unknown };
        if (typeof payload.message === "string" && payload.message.trim().length > 0) {
          return payload.message.trim();
        }
      }
      return "Subscription has ended. Please contact your administrator to renew.";
    }
    const rawMessage = cause instanceof Error ? cause.message : String(cause ?? "");
    if (!rawMessage) {
      return null;
    }
    if (rawMessage.toUpperCase().includes("SUBSCRIPTION_ENDED")) {
      return "Subscription has ended. Please contact your administrator to renew.";
    }
    if (
      /(subscription).*(expired|ended|past[_\s-]?due|canceled|suspended|grace)/i.test(
        rawMessage,
      )
    ) {
      return rawMessage;
    }
    return null;
  }, []);

  const moveToSubscriptionEndedStage = useCallback((reason: string) => {
    setSubscriptionEndedMessage(reason);
    setError(null);
    setPassword("");
    setPin("");
    setShowPassword(false);
    setStage("SUBSCRIPTION_ENDED");
  }, []);

  useEffect(() => {
    tutorialActions.setScreenNavigator(navigateToTutorialScreen);
    tutorialActions.setEnsureVisibleHandler(ensureTutorialTargetVisible);
    refreshTutorialViewportOffset();
    return () => {
      tutorialActions.setScreenNavigator(null);
      tutorialActions.setEnsureVisibleHandler(null);
      tutorialActions.setViewportOffset(null);
    };
  }, [
    tutorialActions,
    navigateToTutorialScreen,
    ensureTutorialTargetVisible,
    refreshTutorialViewportOffset,
  ]);

  useEffect(() => {
    const id = setTimeout(() => {
      refreshTutorialViewportOffset();
    }, 40);
    return () => clearTimeout(id);
  }, [stage, currentReadyView, refreshTutorialViewportOffset]);

  const refreshPendingCount = async (): Promise<void> => {
    if (!db) {
      setPendingCount(0);
      return;
    }
    const row = await db.getFirstAsync<{ total: number }>(
      `
      SELECT COUNT(*) AS total
      FROM outbox
      WHERE status IN (?, ?)
      `,
      "pending",
      "failed",
    );
    setPendingCount(Number(row?.total ?? 0));
  };

  const refreshCashierIdentity = async (
    localDb: SQLiteDatabase,
    fallbackEmail?: string | null,
  ): Promise<void> => {
    const session = new LocalSessionService(localDb);
    await session.initializeFromStorage();
    const token = await session.getAccessToken();
    const payload = token ? decodeJwtPayload(token) : null;
    const fromTokenName = resolveCashierNameFromToken(payload);
    if (fromTokenName) {
      setCurrentCashierName(fromTokenName);
      return;
    }

    const tokenUserId = asPayloadString(
      payload,
      "user_id",
      "userId",
      "sub",
      "id",
    );
    const tokenEmail = asPayloadString(payload, "email");
    const fallbackNormalized = fallbackEmail?.trim().toLowerCase() ?? "";
    const users = await loadUserOptions(localDb);
    const matched = users.find((user) => {
      const byId = tokenUserId ? user.id === tokenUserId : false;
      const subtitle = (user.subtitle ?? "").toLowerCase();
      const byTokenEmail =
        tokenEmail && subtitle.includes(tokenEmail.toLowerCase());
      const byFallbackEmail =
        fallbackNormalized.length > 0 && subtitle.includes(fallbackNormalized);
      return byId || byTokenEmail || byFallbackEmail;
    });
    if (matched?.label && !matched.label.includes("@")) {
      setCurrentCashierName(matched.label.trim());
      return;
    }

    setCurrentCashierName(null);
  };

  const loadBranchLocationsForSetup = async (
    localDb: SQLiteDatabase,
    branchId: string,
    options?: {
      preferLocationId?: string | null;
      allowRemote?: boolean;
      bootstrapService?: MasterDataBootstrapService;
    },
  ): Promise<void> => {
    const fallback = await loadLocationOptions(localDb);
    let nextLocations = fallback.filter(
      (option) => !option.branchId || option.branchId === branchId,
    );

    if (options?.allowRemote && options.bootstrapService) {
      try {
        const remote =
          await options.bootstrapService.fetchLocationOptions(branchId);
        if (remote.length > 0) {
          nextLocations = remote;
        }
      } catch {
        // Keep local fallback when remote location fetch fails.
      }
    }

    setBranchLocationOptions(nextLocations);

    const preferred =
      options?.preferLocationId &&
      nextLocations.some((option) => option.id === options.preferLocationId)
        ? options.preferLocationId
        : (nextLocations[0]?.id ?? "");
    setSelectedLocationId(preferred);
    const selected = nextLocations.find((option) => option.id === preferred);
    setSelectedLocationName(selected?.label ?? null);
  };

  const resolveBranchSetup = async (localDb: SQLiteDatabase): Promise<void> => {
    const startup = await getStartupState(localDb);
    setLastMasterDataSyncAt(startup.lastMasterDataSyncAt);
    setMasterDataFingerprint(startup.lastMasterDataFingerprint);
    setMasterDataUpdateAvailable(false);
    setNotifiedFingerprint(null);
    setPosDefaultLpgFlow(startup.posDefaultLpgFlow);
    setTutorialSeenAt(startup.tutorialSeenAt);
    setTutorialSeenKeys(startup.tutorialSeenKeys);
    setTutorialProgressByScope(startup.tutorialProgressByScope ?? {});
    const localBranches = await loadBranchOptions(localDb);
    let options = localBranches;
    let online = false;
    let message =
      startup.lastServerStatus === "OFFLINE"
        ? "Using cached branch data (offline)."
        : null;

    const session = new LocalSessionService(localDb);
    await session.initializeFromStorage();
    const bootstrapService = new MasterDataBootstrapService({
      baseUrl: API_BASE_URL,
      db: localDb,
      getAccessToken: async () => {
        const token = await session.getAccessToken();
        if (token) {
          return token;
        }
        const refreshed = await session.refreshSession(
          new HttpAuthTransport({ baseUrl: API_BASE_URL }),
        );
        if (!refreshed) {
          return undefined;
        }
        return session.getAccessToken();
      },
      getClientId: async () => session.getClientId(),
    });

    const probe = await bootstrapService.probeServer();
    online = probe.online;
    message = probe.message;

    await updateStartupState(localDb, {
      lastServerStatus: probe.online ? "ONLINE" : "OFFLINE",
      lastServerCheckAt: new Date().toISOString(),
    });

    if (probe.online) {
      try {
        const remoteBranches = await bootstrapService.fetchBranchOptions();
        if (remoteBranches.length > 0) {
          options = remoteBranches;
        }
      } catch (cause) {
        const detail =
          cause instanceof Error ? cause.message : "Branch fetch failed";
        message = `Server reachable but branch fetch failed: ${detail}`;
      }
    }

    setServerOnline(online);
    setBranchSetupMessage(message);
    setBranchOptions(options);

    const fallbackBranchId = options[0]?.id ?? "";
    const preferredBranchId =
      startup.selectedBranchId &&
      options.some((option) => option.id === startup.selectedBranchId)
        ? startup.selectedBranchId
        : fallbackBranchId;
    setSelectedBranchId(preferredBranchId);
    const selectedOption = options.find(
      (option) => option.id === preferredBranchId,
    );
    setSelectedBranchName(selectedOption?.label ?? null);

    await loadBranchLocationsForSetup(localDb, preferredBranchId, {
      preferLocationId: startup.selectedLocationId,
      allowRemote: probe.online,
      bootstrapService,
    });
  };

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (): Promise<void> => {
      try {
        await initDatabase();
        const localDb = await getDatabase();
        const resolvedDeviceId = await getOrCreateDeviceId(
          localDb,
          CONFIGURED_DEVICE_ID,
        );
        deviceIdRef.current = resolvedDeviceId;
        const session = new LocalSessionService(localDb);
        const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
        const flow = new MobileAuthFlow(session, transport, resolvedDeviceId);
        const printerService = new MobilePrinterService({
          db: localDb,
          deviceId: resolvedDeviceId,
        });

        authFlowRef.current = flow;
        printerServiceRef.current = printerService;

        const preference = await printerService.getPreference();
        const savedReceiptLayout = await loadReceiptLayoutSettings(
          localDb,
          resolvedDeviceId,
        );
        const capabilities = await printerService.getRuntimeCapabilities();
        const next = await flow.bootstrap();
        const startup = await getStartupState(localDb);

        if (!mounted) {
          return;
        }

        setDb(localDb);
        setPosDefaultLpgFlow(startup.posDefaultLpgFlow);
        setTutorialSeenAt(startup.tutorialSeenAt);
        setTutorialSeenKeys(startup.tutorialSeenKeys);
        setTutorialProgressByScope(startup.tutorialProgressByScope ?? {});
        setPinConfigured(await session.hasPin());
        setHasCachedSession(session.hasCachedSession());
        setActivePrimaryTab("HOME");
        setActiveSideModule(null);
        setPrinterType(preference.printerType);
        setReceiptLayoutSettings(savedReceiptLayout);
        setPrinterCapabilities(capabilities);
        setPrinterBluetoothMac(
          typeof preference.config?.bluetoothMac === "string"
            ? preference.config.bluetoothMac
            : "",
        );
        setPrinterTcpHost(
          typeof preference.config?.tcpHost === "string"
            ? preference.config.tcpHost
            : "",
        );
        setPrinterTcpPort(
          typeof preference.config?.tcpPort === "number"
            ? String(preference.config.tcpPort)
            : typeof preference.config?.tcpPort === "string"
              ? preference.config.tcpPort
              : "9100",
        );
        await refreshPendingCount();
        if (next === "READY") {
          await refreshCashierIdentity(localDb);
          await enterBranchSetup(localDb);
          toastInfo(
            "Session restored",
            "Select branch and load local master data.",
          );
        } else {
          setStage(next);
          toastInfo("Mobile ready", "Please sign in to continue.");
        }
      } catch (cause) {
        if (!mounted) {
          return;
        }
        const message =
          cause instanceof Error
            ? cause.message
            : "Failed to initialize mobile session";
        const subscriptionEnded = resolveSubscriptionEndedMessage(cause);
        if (subscriptionEnded) {
          moveToSubscriptionEndedStage(subscriptionEnded);
          toastError("Subscription ended", subscriptionEnded);
        } else {
          setError(message);
          setStage("LOGIN");
          toastError("Bootstrap failed", message);
        }
      } finally {
        if (mounted) {
          setBusy(false);
        }
      }
    };

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "BOOTING") {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.96,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [pulseAnim, stage]);

  useEffect(() => {
    if (stage !== "READY") {
      return;
    }
    void refreshPendingCount();
  }, [stage, db]);

  useEffect(() => {
    setHeaderMenuOpen(false);
    setNotificationMenuOpen(false);
  }, [stage, activePrimaryTab, activeSideModule]);

  useEffect(() => {
    if (stage !== "READY") {
      setSideMenuMounted(false);
      sideMenuAnim.setValue(0);
      return;
    }

    if (headerMenuOpen) {
      setSideMenuMounted(true);
      Animated.spring(sideMenuAnim, {
        toValue: 1,
        damping: 22,
        mass: 0.75,
        stiffness: 240,
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!sideMenuMounted) {
      return;
    }

    Animated.timing(sideMenuAnim, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setSideMenuMounted(false);
      }
    });
  }, [headerMenuOpen, stage, sideMenuMounted, sideMenuAnim]);

  useEffect(() => {
    if (!db) {
      tutorialCheckRef.current = null;
      tutorialActions.close();
      return;
    }
    if (tutorialScope) {
      return;
    }

    let nextScope: TutorialScope | null = null;
    if (stage === "READY") {
      if (!tutorialSeenKeys.includes("PIN_SETUP")) {
        nextScope = "PIN_SETUP";
      } else if (!tutorialSeenKeys.includes("APP_WALKTHROUGH")) {
        nextScope = "APP_WALKTHROUGH";
      }
    }

    if (!nextScope) {
      tutorialCheckRef.current = null;
      return;
    }
    if (tutorialCheckRef.current === nextScope) {
      return;
    }
    tutorialCheckRef.current = nextScope;
    setHeaderMenuOpen(false);
    setNotificationMenuOpen(false);
    tutorialActions.open(nextScope, {
      startStep: tutorialProgressByScope[nextScope] ?? 0,
    });
  }, [
    db,
    stage,
    tutorialScope,
    branchSetupBusy,
    tutorialSeenKeys,
    tutorialProgressByScope,
    tutorialActions,
  ]);

  useEffect(() => {
    if (stage !== "READY" || !selectedBranchId.trim()) {
      return;
    }

    const initialTimer = setTimeout(() => {
      void handleCheckBranchUpdates(true);
    }, 15000);

    const interval = setInterval(() => {
      void handleCheckBranchUpdates(true);
    }, 120000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [stage, selectedBranchId, db, masterDataFingerprint]);

  useEffect(() => {
    if (!db || !tutorialScope) {
      return;
    }
    const nextIndex = tutorialState.stepIndex;
    const currentIndex = tutorialProgressByScope[tutorialScope];
    if (currentIndex === nextIndex) {
      return;
    }
    const nextProgress = {
      ...tutorialProgressByScope,
      [tutorialScope]: nextIndex,
    };
    setTutorialProgressByScope(nextProgress);
    void updateStartupState(db, {
      tutorialProgressByScope: nextProgress,
    });
  }, [db, tutorialScope, tutorialState.stepIndex, tutorialProgressByScope]);

  useEffect(() => {
    if (stage === "BOOTING") {
      setToastTopOffset(androidStatusInset + 18);
      return;
    }
    // Keep toast below sticky header and status area.
    setToastTopOffset(headerTopPadding + 56);
  }, [androidStatusInset, headerTopPadding, stage]);

  useEffect(() => {
    if (!shouldRunStartupConnectivityGate || startupConnectivityChecked) {
      return;
    }
    void runStartupConnectivityCheck(false);
  }, [
    shouldRunStartupConnectivityGate,
    startupConnectivityChecked,
    runStartupConnectivityCheck,
  ]);

  useEffect(() => {
    return () => {
      startupProbeAbortRef.current?.abort();
      startupProbeAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleUrl = (url: string | null | undefined): void => {
      const token = readEnrollmentTokenFromUrl(url);
      if (!token) {
        return;
      }
      setPendingEnrollmentToken(token);
      setShowNoInternetPage(false);
    };

    void Linking.getInitialURL()
      .then((url) => {
        handleUrl(url);
      })
      .catch(() => {
        // Ignore deep-link parsing failures at startup.
      });

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });
    enrollmentListenerRef.current = subscription;
    return () => {
      enrollmentListenerRef.current?.remove();
      enrollmentListenerRef.current = null;
    };
  }, []);

  const requestBluetoothPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== "android") {
      return true;
    }

    try {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      return (
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    } catch {
      return false;
    }
  };

  const enterBranchSetup = async (localDb: SQLiteDatabase): Promise<void> => {
    setBranchSetupBusy(true);
    setError(null);
    try {
      await resolveBranchSetup(localDb);
      const startup = await getStartupState(localDb);
      const savedBranchId = startup.selectedBranchId?.trim() ?? "";
      const savedLocationId = startup.selectedLocationId?.trim() ?? "";
      if (savedBranchId && savedLocationId) {
        const [localBranches, localLocations] = await Promise.all([
          loadBranchOptions(localDb),
          loadLocationOptions(localDb),
        ]);
        const savedBranch = localBranches.find(
          (option) => option.id === savedBranchId,
        );
        const savedLocation = localLocations.find(
          (option) =>
            option.id === savedLocationId &&
            (!option.branchId || option.branchId === savedBranchId),
        );
        if (savedBranch && savedLocation) {
          setSelectedBranchId(savedBranch.id);
          setSelectedBranchName(savedBranch.label);
          setSelectedLocationId(savedLocation.id);
          setSelectedLocationName(savedLocation.label);
          setBranchOptions(
            localBranches.length ? localBranches : branchOptions,
          );
          await loadBranchLocationsForSetup(localDb, savedBranch.id, {
            preferLocationId: savedLocation.id,
            allowRemote: false,
          });
          setStage("READY");
          await refreshPendingCount();
          return;
        }
      }
      setStage("BRANCH_SETUP");
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to prepare branch setup";
      setError(message);
      setStage("LOGIN");
      toastError("Branch setup failed", message);
    } finally {
      setBranchSetupBusy(false);
    }
  };

  const handleBranchRefresh = async (): Promise<void> => {
    if (!db || branchSetupBusy) {
      return;
    }
    setBranchSetupBusy(true);
    try {
      await resolveBranchSetup(db);
      toastInfo("Branch list updated", "Branch selection is ready.");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to refresh branches";
      setError(message);
      toastError("Branch refresh failed", message);
    } finally {
      setBranchSetupBusy(false);
    }
  };

  const handleBranchContinue = async (): Promise<void> => {
    if (!db || !selectedBranchId.trim()) {
      toastError("Branch setup", "Please select a branch.");
      return;
    }
    if (!selectedLocationId.trim()) {
      toastError("Branch setup", "Please select a location.");
      return;
    }
    if (branchSetupBusy) {
      return;
    }

    setBranchSetupBusy(true);
    setError(null);
    try {
      const selectedOption = branchOptions.find(
        (option) => option.id === selectedBranchId,
      );
      setSelectedBranchName(selectedOption?.label ?? null);
      const selectedLocation = branchLocationOptions.find(
        (option) => option.id === selectedLocationId,
      );
      setSelectedLocationName(selectedLocation?.label ?? null);

      const session = new LocalSessionService(db);
      await session.initializeFromStorage();
      const bootstrapService = new MasterDataBootstrapService({
        baseUrl: API_BASE_URL,
        db,
        getAccessToken: async () => {
          const token = await session.getAccessToken();
          if (token) {
            return token;
          }
          const refreshed = await session.refreshSession(
            new HttpAuthTransport({ baseUrl: API_BASE_URL }),
          );
          if (!refreshed) {
            return undefined;
          }
          return session.getAccessToken();
        },
        getClientId: async () => session.getClientId(),
      });

      const probe = await bootstrapService.probeServer();
      setServerOnline(probe.online);
      setBranchSetupMessage(probe.message);
      await updateStartupState(db, {
        lastServerStatus: probe.online ? "ONLINE" : "OFFLINE",
        lastServerCheckAt: new Date().toISOString(),
      });

      if (probe.online) {
        const result =
          await bootstrapService.bootstrapForBranch(selectedBranchId);
        await updateStartupState(db, {
          selectedBranchId,
          selectedBranchName: selectedOption?.label ?? selectedBranchId,
          selectedLocationId,
          selectedLocationName: selectedLocation?.label ?? selectedLocationId,
          lastMasterDataSyncAt: result.downloadedAt,
          lastMasterDataFingerprint: result.fingerprint,
        });
        setLastMasterDataSyncAt(result.downloadedAt);
        setMasterDataFingerprint(result.fingerprint);
        setMasterDataUpdateAvailable(false);
        setNotifiedFingerprint(null);
        setMasterDataVersion((prev) => prev + 1);
        toastSuccess(
          "Branch data downloaded",
          `Saved ${result.counts.products} products, ${result.counts.users} users, ${result.counts.locations} locations.`,
        );
        await refreshCashierIdentity(db, email);
      } else {
        const localBranches = await loadBranchOptions(db);
        if (!localBranches.length) {
          throw new Error(
            "No cached branch data available offline. Connect to server and retry.",
          );
        }
        await updateStartupState(db, {
          selectedBranchId,
          selectedBranchName: selectedOption?.label ?? selectedBranchId,
          selectedLocationId,
          selectedLocationName: selectedLocation?.label ?? selectedLocationId,
        });
        toastInfo(
          "Offline mode",
          "Using previously downloaded local master data.",
        );
        await refreshCashierIdentity(db, email);
      }

      setStage("READY");
      await refreshPendingCount();
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to continue with selected branch";
      setError(message);
      toastError("Branch setup failed", message);
    } finally {
      setBranchSetupBusy(false);
    }
  };

  const createBootstrapService = useCallback(async (
    localDb: SQLiteDatabase,
  ): Promise<MasterDataBootstrapService> => {
    const session = new LocalSessionService(localDb);
    await session.initializeFromStorage();
    return new MasterDataBootstrapService({
      baseUrl: API_BASE_URL,
      db: localDb,
      getAccessToken: async () => {
        const token = await session.getAccessToken();
        if (token) {
          return token;
        }
        const refreshed = await session.refreshSession(
          new HttpAuthTransport({ baseUrl: API_BASE_URL }),
        );
        if (!refreshed) {
          return undefined;
        }
        return session.getAccessToken();
      },
      getClientId: async () => session.getClientId(),
    });
  }, []);

  const handleEnrollmentClaim = useCallback(
    async (setupToken: string): Promise<void> => {
      if (!db) {
        return;
      }
      const trimmedToken = setupToken.trim();
      if (!trimmedToken) {
        return;
      }
      if (!deviceIdRef.current) {
        toastError("Setup QR", "Device is not ready yet. Please retry.");
        return;
      }
      if (enrollmentBusy) {
        return;
      }
      if (lastEnrollmentClaimTokenRef.current === trimmedToken) {
        return;
      }

      setEnrollmentBusy(true);
      setBusy(true);
      setError(null);
      setShowNoInternetPage(false);
      setStartupConnectivityChecked(true);
      try {
        const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
        const claimed = await transport.claimEnrollment(
          trimmedToken,
          deviceIdRef.current,
        );

        const session = new LocalSessionService(db);
        await session.initializeFromStorage();
        await session.cacheSession(
          claimed.access_token,
          claimed.refresh_token,
          null,
          claimed.client_id,
        );

        lastEnrollmentClaimTokenRef.current = trimmedToken;
        setHasCachedSession(true);
        setPinConfigured(await session.hasPin());
        setEmail(claimed.user_email?.trim() || "");
        setPassword("");
        setPin("");
        setShowPassword(false);

        const bootstrapService = await createBootstrapService(db);
        const result = await bootstrapService.bootstrapForBranch(
          claimed.branch_id,
        );

        await updateStartupState(db, {
          selectedBranchId: claimed.branch_id,
          selectedBranchName: claimed.branch_name,
          selectedLocationId: claimed.location_id,
          selectedLocationName: claimed.location_name,
          lastMasterDataSyncAt: result.downloadedAt,
          lastMasterDataFingerprint: result.fingerprint,
          lastServerStatus: "ONLINE",
          lastServerCheckAt: new Date().toISOString(),
          lastLoginEmail: claimed.user_email?.trim() || null,
        });

        setSelectedBranchId(claimed.branch_id);
        setSelectedBranchName(claimed.branch_name);
        setSelectedLocationId(claimed.location_id);
        setSelectedLocationName(claimed.location_name);
        setLastMasterDataSyncAt(result.downloadedAt);
        setMasterDataFingerprint(result.fingerprint);
        setMasterDataUpdateAvailable(false);
        setNotifiedFingerprint(null);
        setMasterDataVersion((prev) => prev + 1);
        setServerOnline(true);
        setBranchSetupMessage("Mobile setup complete.");
        setStage("READY");
        await refreshCashierIdentity(db, claimed.user_email);
        await refreshPendingCount();
        toastSuccess(
          "Setup complete",
          `Logged in as ${claimed.user_full_name} and synced branch data.`,
        );
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Unable to claim setup token";
        setError(message);
        toastError("Setup QR failed", message);
      } finally {
        setPendingEnrollmentToken(null);
        setEnrollmentBusy(false);
        setBusy(false);
      }
    },
    [createBootstrapService, db, enrollmentBusy],
  );

  useEffect(() => {
    if (!pendingEnrollmentToken || !db) {
      return;
    }
    void handleEnrollmentClaim(pendingEnrollmentToken);
  }, [db, handleEnrollmentClaim, pendingEnrollmentToken]);

  const handleCheckBranchUpdates = async (silent = false): Promise<void> => {
    if (!db || !selectedBranchId.trim() || stage !== "READY") {
      return;
    }
    if (branchDataBusy) {
      return;
    }

    setBranchDataBusy(true);
    try {
      const bootstrapService = await createBootstrapService(db);
      const probe = await bootstrapService.probeServer();
      setServerOnline(probe.online);
      await updateStartupState(db, {
        lastServerStatus: probe.online ? "ONLINE" : "OFFLINE",
        lastServerCheckAt: new Date().toISOString(),
      });

      if (!probe.online) {
        if (!silent) {
          toastError("Update check failed", probe.message);
        }
        return;
      }

      const result =
        await bootstrapService.getBranchDataFingerprint(selectedBranchId);
      if (!masterDataFingerprint) {
        setMasterDataFingerprint(result.fingerprint);
        await updateStartupState(db, {
          lastMasterDataFingerprint: result.fingerprint,
          lastServerStatus: "ONLINE",
          lastServerCheckAt: new Date().toISOString(),
        });
        if (!silent) {
          toastInfo(
            "Branch data baseline",
            "Branch update fingerprint initialized.",
          );
        }
        return;
      }

      if (!masterDataFingerprint.startsWith("v2:")) {
        setMasterDataFingerprint(result.fingerprint);
        setMasterDataUpdateAvailable(false);
        setNotifiedFingerprint(null);
        await updateStartupState(db, {
          lastMasterDataFingerprint: result.fingerprint,
          lastServerStatus: "ONLINE",
          lastServerCheckAt: new Date().toISOString(),
        });
        if (!silent) {
          toastInfo(
            "Branch baseline upgraded",
            "Update checks were stabilized for this device.",
          );
        }
        return;
      }

      const hasChanges = result.fingerprint !== masterDataFingerprint;
      setMasterDataUpdateAvailable(hasChanges);

      if (hasChanges) {
        if (!silent || notifiedFingerprint !== result.fingerprint) {
          toastInfo(
            "Branch data updated",
            "Admin changed data for this branch. Tap Redownload Branch Data in Settings.",
          );
        }
        setNotifiedFingerprint(result.fingerprint);
      } else {
        setNotifiedFingerprint(null);
        await updateStartupState(db, {
          lastMasterDataFingerprint: result.fingerprint,
          lastServerStatus: "ONLINE",
          lastServerCheckAt: new Date().toISOString(),
        });
        if (!silent) {
          toastSuccess("Up to date", "No new branch data changes detected.");
        }
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to check branch updates";
      if (!silent) {
        toastError("Update check failed", message);
      }
    } finally {
      setBranchDataBusy(false);
    }
  };

  const handleRedownloadBranchData = async (): Promise<void> => {
    if (!db || !selectedBranchId.trim() || stage !== "READY") {
      return;
    }
    if (branchDataBusy) {
      return;
    }

    setBranchDataBusy(true);
    try {
      const bootstrapService = await createBootstrapService(db);
      const probe = await bootstrapService.probeServer();
      setServerOnline(probe.online);
      if (!probe.online) {
        throw new Error(
          "Server is offline. Connect to network to redownload branch data.",
        );
      }

      const result =
        await bootstrapService.bootstrapForBranch(selectedBranchId);
      await updateStartupState(db, {
        selectedBranchId,
        selectedBranchName: selectedBranchName ?? selectedBranchId,
        lastMasterDataSyncAt: result.downloadedAt,
        lastMasterDataFingerprint: result.fingerprint,
        lastServerStatus: "ONLINE",
        lastServerCheckAt: new Date().toISOString(),
      });

      setLastMasterDataSyncAt(result.downloadedAt);
      setMasterDataFingerprint(result.fingerprint);
      setMasterDataUpdateAvailable(false);
      setNotifiedFingerprint(null);
      setMasterDataVersion((prev) => prev + 1);
      await refreshCashierIdentity(db, email);
      toastSuccess(
        "Branch data redownloaded",
        `Updated ${result.counts.products} products and ${result.counts.priceLists} price lists.`,
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to redownload branch data";
      toastError("Redownload failed", message);
    } finally {
      setBranchDataBusy(false);
    }
  };

  const handleLogin = async (): Promise<void> => {
    const flow = authFlowRef.current;
    if (!flow) {
      return;
    }

    if (!email.trim() || !password) {
      toastError("Login", "Email and password are required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const normalizedEmail = email.trim();
      const next = await flow.login({ email: normalizedEmail, password });
      setSubscriptionEndedMessage(null);
      const hasPinConfigured = await flow.hasPinConfigured();
      setHasCachedSession(true);
      if (db) {
        await updateStartupState(db, {
          lastLoginEmail: normalizedEmail,
        });
      }
      setPinConfigured(hasPinConfigured);
      setActivePrimaryTab("HOME");
      setActiveSideModule(null);
      if (next === "READY" && db) {
        await refreshCashierIdentity(db, email);
        await enterBranchSetup(db);
      } else {
        setStage(next);
        await refreshPendingCount();
      }
      toastSuccess("Login successful", "Session authenticated.");
    } catch (cause) {
      const subscriptionEnded = resolveSubscriptionEndedMessage(cause);
      if (subscriptionEnded) {
        moveToSubscriptionEndedStage(subscriptionEnded);
        toastError("Subscription ended", subscriptionEnded);
        return;
      }
      const message = cause instanceof Error ? cause.message : "Login failed";
      setError(message);
      toastError("Login failed", message);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (): Promise<void> => {
    const flow = authFlowRef.current;
    if (!flow) {
      return;
    }

    if (!pin.trim()) {
      toastError("Unlock", "PIN is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const next = await flow.unlock(pin);
      if (next !== "READY") {
        setError("Invalid PIN");
        toastError("Unlock failed", "Invalid PIN.");
      } else {
        setActivePrimaryTab("HOME");
        setActiveSideModule(null);
        setPinConfigured(await flow.hasPinConfigured());
        if (db) {
          await refreshCashierIdentity(db);
          await enterBranchSetup(db);
        } else {
          setStage(next);
          await refreshPendingCount();
        }
        toastSuccess("Unlocked", "Select branch to continue.");
      }
      if (next !== "READY") {
        setStage(next);
      }
    } catch (cause) {
      const subscriptionEnded = resolveSubscriptionEndedMessage(cause);
      if (subscriptionEnded) {
        moveToSubscriptionEndedStage(subscriptionEnded);
        toastError("Subscription ended", subscriptionEnded);
        return;
      }
      const message = cause instanceof Error ? cause.message : "Unlock failed";
      setError(message);
      toastError("Unlock failed", message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const rememberedEmail = email.trim();
      if (db && rememberedEmail) {
        await updateStartupState(db, {
          lastLoginEmail: rememberedEmail,
        });
      }
      if (db) {
        const session = new LocalSessionService(db);
        await session.initializeFromStorage();
        setPinConfigured(await session.hasPin());
        setHasCachedSession(session.hasCachedSession());
      } else {
        setPinConfigured(false);
        setHasCachedSession(false);
      }
      setStage("LOGIN");
      setActivePrimaryTab("HOME");
      setActiveSideModule(null);
      setSelectedBranchId("");
      setSelectedBranchName(null);
      setSelectedLocationId("");
      setSelectedLocationName(null);
      setBranchLocationOptions([]);
      setLastMasterDataSyncAt(null);
      setMasterDataFingerprint(null);
      setMasterDataUpdateAvailable(false);
      setNotifiedFingerprint(null);
      setBranchOptions([]);
      setBranchSetupMessage(null);
      setServerOnline(false);
      setCurrentCashierName(null);
      tutorialActions.close();
      setPassword("");
      setEmail("");
      setPin("");
      setShowPassword(false);
      toastInfo("Session locked", "Use PIN Instead or password to sign back in.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Logout failed";
      setError(message);
      toastError("Logout failed", message);
    } finally {
      setBusy(false);
    }
  };

  const handleFullSignOut = async (): Promise<void> => {
    const flow = authFlowRef.current;
    if (!flow) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rememberedEmail = email.trim();
      await flow.fullSignOut("full_sign_out");
      if (db && rememberedEmail) {
        await updateStartupState(db, {
          lastLoginEmail: rememberedEmail,
        });
      }
      setPinConfigured(false);
      setHasCachedSession(false);
      setStage("LOGIN");
      setActivePrimaryTab("HOME");
      setActiveSideModule(null);
      setSelectedBranchId("");
      setSelectedBranchName(null);
      setSelectedLocationId("");
      setSelectedLocationName(null);
      setBranchLocationOptions([]);
      setLastMasterDataSyncAt(null);
      setMasterDataFingerprint(null);
      setMasterDataUpdateAvailable(false);
      setNotifiedFingerprint(null);
      setBranchOptions([]);
      setBranchSetupMessage(null);
      setServerOnline(false);
      setCurrentCashierName(null);
      tutorialActions.close();
      setPassword("");
      setEmail("");
      setPin("");
      setShowPassword(false);
      toastInfo(
        "Signed out fully",
        "Session and PIN unlock were removed from this device.",
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Full sign out failed";
      setError(message);
      toastError("Full sign out failed", message);
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchCashier = async (): Promise<void> => {
    const flow = authFlowRef.current;
    if (!flow) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const rememberedEmail = email.trim();
      await flow.fullSignOut("switch_cashier");
      if (db && rememberedEmail) {
        await updateStartupState(db, {
          lastLoginEmail: rememberedEmail,
        });
      }
      setPinConfigured(false);
      setHasCachedSession(false);
      setStage("LOGIN");
      setActivePrimaryTab("HOME");
      setActiveSideModule(null);
      setSelectedBranchId("");
      setSelectedBranchName(null);
      setSelectedLocationId("");
      setSelectedLocationName(null);
      setBranchLocationOptions([]);
      setCurrentCashierName(null);
      tutorialActions.close();
      setPassword("");
      setEmail("");
      setPin("");
      setShowPassword(false);
      toastInfo(
        "Switch Cashier",
        "Current cashier signed out. Next cashier can sign in on this device.",
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Switch cashier failed";
      setError(message);
      toastError("Switch cashier failed", message);
    } finally {
      setBusy(false);
    }
  };

  const switchToPasswordLogin = (): void => {
    setPin("");
    setShowPassword(false);
    setStage("LOGIN");
  };

  const switchToPinUnlock = (): void => {
    if (!pinConfigured) {
      return;
    }
    if (!db) {
      return;
    }
    void (async () => {
      const session = new LocalSessionService(db);
      await session.initializeFromStorage();
      if (!session.hasCachedSession()) {
        toastInfo(
          "PIN Unlock Unavailable",
          "Sign in with password first, then use PIN unlock next time.",
        );
        return;
      }
      setPassword("");
      setPin("");
      setStage("UNLOCK");
    })();
  };

  const handleChangePin = async (input: {
    currentPin: string;
    nextPin: string;
  }): Promise<void> => {
    if (!db) {
      throw new Error("Database is not ready.");
    }
    const session = new LocalSessionService(db);
    await session.initializeFromStorage();
    const changed = await session.changePin(
      pinConfigured ? input.currentPin : null,
      input.nextPin,
    );
    if (!changed) {
      throw new Error(
        pinConfigured
          ? "Current PIN is invalid."
          : "Unable to set PIN. Please retry.",
      );
    }
    await authFlowRef.current?.reloadSessionState();
    setPinConfigured(true);
  };

  const markTutorialSeenForScope = async (
    scope: TutorialScope,
    completionMode: "done" | "skipped",
  ) => {
    if (!scope) {
      return;
    }
    const seenAt = new Date().toISOString();
    const nextKeys = tutorialSeenKeys.includes(scope)
      ? tutorialSeenKeys
      : [...tutorialSeenKeys, scope];
    const nextProgress = { ...tutorialProgressByScope };
    delete nextProgress[scope];
    try {
      if (db) {
        await updateStartupState(db, {
          tutorialSeenAt: tutorialSeenAt ?? seenAt,
          tutorialSeenKeys: nextKeys,
          tutorialProgressByScope: nextProgress,
        });
      }
    } finally {
      if (!tutorialSeenAt) {
        setTutorialSeenAt(seenAt);
      }
      setTutorialSeenKeys(nextKeys);
      setTutorialProgressByScope(nextProgress);
      const completedScope = scope;
      tutorialActions.close();
      tutorialCheckRef.current = null;
      if (completionMode === "done" && completedScope === "PIN_SETUP") {
        setActiveSideModule("SETTINGS");
      }
    }
  };

  const pauseTutorialForScope = (scope: TutorialScope): void => {
    if (!scope) {
      return;
    }
    tutorialActions.pause();
    tutorialCheckRef.current = scope;
  };

  const handleOpenTutorialForScope = (scope: TutorialScope) => {
    setHeaderMenuOpen(false);
    setNotificationMenuOpen(false);
    tutorialActions.open(scope, {
      startStep: 0,
    });
  };

  const handleStartAppWalkthrough = (): void => {
    setHeaderMenuOpen(false);
    setNotificationMenuOpen(false);
    tutorialCheckRef.current = null;
    tutorialActions.open("APP_WALKTHROUGH", { startStep: 0 });
  };

  const handleResetTutorials = async (): Promise<void> => {
    const seenAt = null;
    const nextKeys: string[] = [];
    const nextProgress: Record<string, number> = {};
    if (db) {
      await updateStartupState(db, {
        tutorialSeenAt: seenAt,
        tutorialSeenKeys: nextKeys,
        tutorialProgressByScope: nextProgress,
      });
    }
    setTutorialSeenAt(seenAt);
    setTutorialSeenKeys(nextKeys);
    setTutorialProgressByScope(nextProgress);
    tutorialCheckRef.current = null;
    toastSuccess("Tutorial reset", "Onboarding can run again from start.");
  };

  const handleSyncNow = async (sourceTab: ReadyView): Promise<void> => {
    if (!db || syncBusy) {
      return;
    }

    setSyncBusy(true);
    setError(null);
    try {
      const session = new LocalSessionService(db);
      await session.initializeFromStorage();
      const authTransport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
      const transport = new HttpSyncTransport({
        baseUrl: API_BASE_URL,
        getAccessToken: async () => {
          const current = await session.getAccessToken();
          if (current) {
            return current;
          }
          const refreshed = await session.refreshSession(authTransport);
          if (!refreshed) {
            return undefined;
          }
          return session.getAccessToken();
        },
        getClientId: async () => session.getClientId(),
      });
      const subscriptionPolicy = new MobileSubscriptionPolicyService(db);
      if (!deviceIdRef.current) {
        throw new Error("Device identity is not ready.");
      }
      const orchestrator = new MobileSyncOrchestrator(
        db,
        transport,
        deviceIdRef.current,
        subscriptionPolicy,
      );
      const result = await orchestrator.run();
      await refreshPendingCount();
      setServerOnline(true);
      toastSuccess(
        `${sourceTab} sync complete`,
        `${result.syncedIds.length} synced, ${result.rejectedIds.length} rejected`,
      );
      if (result.rejectedIds.length > 0) {
        const latestReview = await db.getFirstAsync<{
          entity: string;
          reason: string;
        }>(
          `
          SELECT entity, reason
          FROM sync_reviews_local
          WHERE status = 'OPEN'
          ORDER BY updated_at DESC
          LIMIT 1
          `,
        );
        if (latestReview?.reason) {
          toastInfo(
            "Sync review required",
            `${latestReview.entity}: ${latestReview.reason}`,
          );
        }
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to sync now";
      setError(message);
      setServerOnline(false);
      toastError(`${sourceTab} sync failed`, message);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleHeaderSyncNow = async (): Promise<void> => {
    setHeaderMenuOpen(false);
    setNotificationMenuOpen(false);
    if (stage !== "READY") {
      toastInfo("Sync unavailable", "Sign in and complete branch setup first.");
      return;
    }
    await handleSyncNow(currentReadyView);
  };

  const handlePrinterTypeSelect = async (
    nextType: PrinterType,
  ): Promise<void> => {
    logPrinterDebug("PRINTER_TYPE_SELECTED", {
      selectedType: nextType,
      currentType: printerType,
      hasIminSdk: printerCapabilities?.hasIminSdk ?? false,
      moduleAvailable: printerCapabilities?.moduleAvailable ?? false,
    });
    await savePrinterPreference(nextType, false);
  };

  const resolvePrinterConfig = (
    type: PrinterType,
  ): { config: Record<string, unknown> | null; validationError?: string } => {
    if (type === "NONE") {
      return {
        config: null,
        validationError: "Select a printer type before running test print.",
      };
    }

    if (type === "IMIN") {
      if (!printerCapabilities?.hasIminSdk) {
        return {
          config: null,
          validationError:
            "iMin SDK is not detected. Rebuild Dev Client with iMin SDK or use Bluetooth/TCP ESC-POS.",
        };
      }
      return { config: { connectType: "SPI" } };
    }

    if (type === "BLUETOOTH") {
      if (!printerBluetoothMac.trim()) {
        return {
          config: null,
          validationError:
            "Bluetooth MAC is required for Bluetooth printer mode.",
        };
      }
      return { config: { bluetoothMac: printerBluetoothMac.trim() } };
    }

    if (type === "GENERIC_BUILTIN") {
      const normalizedHost = normalizeTcpHost(printerTcpHost);
      const parsed = parseTcpHostAndPort(printerTcpHost, printerTcpPort);
      if (!parsed) {
        if (!normalizedHost && !printerCapabilities?.hasIminSdk) {
          return {
            config: null,
            validationError:
              "TCP Host is required for Generic Built-in. You can input 192.168.x.x or host:port (for example 192.168.1.50:9100).",
          };
        }
        if (normalizedHost) {
          return {
            config: null,
            validationError:
              "TCP Port is invalid. Use a value between 1 and 65535 (default 9100).",
          };
        }
        return { config: null };
      }
      return { config: { tcpHost: parsed.host, tcpPort: parsed.port } };
    }

    return { config: null };
  };

  const savePrinterPreference = async (
    nextType: PrinterType,
    silent: boolean,
  ): Promise<void> => {
    const printerService = printerServiceRef.current;
    if (!printerService) {
      return;
    }

    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      logPrinterDebug("PRINTER_SAVE_REQUEST", {
        requestedType: nextType,
        silent,
        hasIminSdk: printerCapabilities?.hasIminSdk ?? false,
        moduleAvailable: printerCapabilities?.moduleAvailable ?? false,
        bluetoothMac: printerBluetoothMac || null,
        tcpHost: normalizeTcpHost(printerTcpHost) || null,
        tcpPort: printerTcpPort || null,
      });
      if (nextType === "BLUETOOTH") {
        const granted = await requestBluetoothPermissions();
        if (!granted) {
          throw new Error(
            "Bluetooth permission is required for ESC/POS Bluetooth printing.",
          );
        }
      }

      const { config, validationError } = resolvePrinterConfig(nextType);
      if (validationError) {
        logPrinterDebug("PRINTER_SAVE_VALIDATION_ERROR", {
          requestedType: nextType,
          validationError,
        });
        throw new Error(validationError);
      }

      const preference = await printerService.setPreference({
        printerType: nextType,
        config,
      });
      logPrinterDebug("PRINTER_SAVE_SUCCESS", {
        savedType: preference.printerType,
        savedConfig: config ?? null,
      });
      setPrinterType(preference.printerType);
      setPrinterMessage(`Printer set to ${preference.printerType}.`);
      if (!silent) {
        toastSuccess("Printer saved", `Selected ${preference.printerType}`);
      }
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to update printer setting";
      const stack = cause instanceof Error ? cause.stack : undefined;
      logPrinterDebug("PRINTER_SAVE_ERROR", {
        requestedType: nextType,
        message,
        stack: stack ?? null,
      });
      setPrinterMessage(message);
      if (!silent) {
        toastError("Printer setup failed", message);
      }
    } finally {
      setPrinterBusy(false);
    }
  };

  const handlePrinterSave = async (): Promise<void> => {
    await savePrinterPreference(printerType, false);
  };

  const persistValidatedPrinterPreference = async (
    printerService: MobilePrinterService,
  ): Promise<{
    printerType: PrinterType;
    config: Record<string, unknown> | null;
  }> => {
    const resolved = resolvePrinterConfig(printerType);
    logPrinterDebug("PRINTER_TEST_REQUEST", {
      printerType,
      resolvedConfig: resolved.config ?? null,
      hasIminSdk: printerCapabilities?.hasIminSdk ?? false,
      moduleAvailable: printerCapabilities?.moduleAvailable ?? false,
    });
    const { validationError } = resolved;
    if (validationError) {
      logPrinterDebug("PRINTER_TEST_VALIDATION_ERROR", {
        printerType,
        validationError,
      });
      throw new Error(validationError);
    }

    if (printerType === "BLUETOOTH") {
      const granted = await requestBluetoothPermissions();
      if (!granted) {
        throw new Error(
          "Bluetooth permission is required for ESC/POS Bluetooth printing.",
        );
      }
    }

    await printerService.setPreference({
      printerType,
      config: resolved.config,
    });

    return {
      printerType,
      config: resolved.config,
    };
  };

  const handleSaveReceiptLayoutSettings = async (
    nextLayout: ReceiptLayoutSettings,
  ): Promise<void> => {
    if (!db) {
      throw new Error("Database is not ready.");
    }
    if (!deviceIdRef.current) {
      throw new Error("Device identity is not ready.");
    }
    const normalized = normalizeReceiptLayoutSettings(nextLayout);
    await saveReceiptLayoutSettings(db, deviceIdRef.current, normalized);
    setReceiptLayoutSettings(normalized);
  };

  const handleChangePosDefaultLpgFlow = async (
    flow: PosDefaultLpgFlow,
  ): Promise<void> => {
    setPosDefaultLpgFlow(flow);
    if (!db) {
      return;
    }
    await updateStartupState(db, {
      posDefaultLpgFlow: flow,
    });
  };

  const buildLayoutTestReceiptDocument = (
    nextLayout: ReceiptLayoutSettings,
  ): ReceiptDocument => {
    const now = new Date().toISOString();
    return buildPosReceiptDocument(
      {
        saleId: "SALE-TEST-001",
        branchId: selectedBranchId || "branch-main",
        branchName: selectedBranchName ?? selectedBranchId ?? "Main Branch",
        locationId: selectedLocationId || "loc-main",
        locationName:
          selectedLocationName ?? selectedLocationId ?? "Main Store",
        cashierName: currentCashierName ?? "Demo Cashier",
        orderType: "PICKUP",
        customerName: "Walk-in Customer",
        personnelName: "Demo Cashier",
        helperName: null,
        lines: [
          {
            name: "LPG Refill 11kg",
            subtitle: "LPG-11-REFILL",
            quantity: 1,
            unitPrice: 950,
          },
          {
            name: "Deposit 11kg",
            subtitle: "DEP-11",
            quantity: 1,
            unitPrice: 1200,
          },
        ],
        subtotal: 2150,
        discount: 50,
        total: 2100,
        paidAmount: 2200,
        changeAmount: 100,
        creditBalance: 0,
        notes: "Layout preview print from Settings",
        paymentMode: "FULL",
        paymentMethod: "CASH",
        createdAt: now,
      },
      "TEST-000001",
      nextLayout,
    );
  };

  const handleTestReceiptLayout = async (
    nextLayout: ReceiptLayoutSettings,
  ): Promise<void> => {
    const printerService = printerServiceRef.current;
    if (!printerService) {
      throw new Error("Printer runtime is not ready yet.");
    }

    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      await persistValidatedPrinterPreference(printerService);
      const normalized = normalizeReceiptLayoutSettings(nextLayout);
      await handleSaveReceiptLayoutSettings(normalized);
      const doc = buildLayoutTestReceiptDocument(normalized);
      await printerService.printReceiptDocument(doc);
      logPrinterDebug("PRINTER_LAYOUT_TEST_SUCCESS", {
        printerType,
        layout: normalized,
      });
      setPrinterMessage("Layout test print sent.");
      toastSuccess("Layout test printed", "Check your receipt layout output.");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Layout test print failed";
      const stack = cause instanceof Error ? cause.stack : undefined;
      logPrinterDebug("PRINTER_LAYOUT_TEST_ERROR", {
        printerType,
        message,
        stack: stack ?? null,
      });
      setPrinterMessage(message);
      toastError("Layout test failed", message);
      throw cause;
    } finally {
      setPrinterBusy(false);
    }
  };

  const handlePrinterTest = async (): Promise<void> => {
    const printerService = printerServiceRef.current;
    if (!printerService) {
      return;
    }

    setPrinterBusy(true);
    setPrinterMessage(null);
    try {
      await persistValidatedPrinterPreference(printerService);
      const doc = buildLayoutTestReceiptDocument(receiptLayoutSettings);
      await printerService.printReceiptDocument(doc);
      logPrinterDebug("PRINTER_TEST_SUCCESS", { printerType });
      setPrinterMessage("Test print sent using current receipt layout.");
      toastSuccess("Test print sent", "Printed using current receipt layout.");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Test print failed";
      const stack = cause instanceof Error ? cause.stack : undefined;
      logPrinterDebug("PRINTER_TEST_ERROR", {
        printerType,
        message,
        stack: stack ?? null,
        hasIminSdk: printerCapabilities?.hasIminSdk ?? false,
      });
      setPrinterMessage(message);
      toastError("Test print failed", message);
    } finally {
      setPrinterBusy(false);
    }
  };

  const handlePrintQueuedSaleReceipt = async (
    payload: PosQueuedSaleReceiptPayload,
  ): Promise<{
    printed: boolean;
    receiptNumber?: string;
    message?: string;
  }> => {
    const printerService = printerServiceRef.current;
    if (!db || !printerService) {
      return { printed: false, message: "Printer runtime is not ready yet." };
    }

    const receiptNumber = buildReceiptNumber(payload.branchId, payload.saleId);
    const receiptDocument = buildPosReceiptDocument(
      payload,
      receiptNumber,
      receiptLayoutSettings,
    );
    const now = new Date().toISOString();

    await db.runAsync(
      `
      INSERT INTO receipts_local(sale_id, receipt_number, payload, reprint_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
      ON CONFLICT(sale_id) DO UPDATE SET
        receipt_number = excluded.receipt_number,
        payload = excluded.payload,
        updated_at = excluded.updated_at
      `,
      payload.saleId,
      receiptNumber,
      JSON.stringify(receiptDocument),
      payload.createdAt || now,
      now,
    );

    const preference = await printerService.getPreference();
    if (preference.printerType === "NONE") {
      return {
        printed: false,
        receiptNumber,
        message:
          "Sale saved. Printer is set to None. Configure printer in Settings to print receipts.",
      };
    }

    try {
      await printerService.printReceiptDocument(receiptDocument);
      return { printed: true, receiptNumber };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Print dispatch failed.";
      return {
        printed: false,
        receiptNumber,
        message: `Sale saved. Print failed: ${message}`,
      };
    }
  };

  const handlePrintSaleReceipt = async (
    saleId: string,
  ): Promise<{
    printed: boolean;
    receiptNumber?: string;
    message?: string;
  }> => {
    const printerService = printerServiceRef.current;
    if (!db || !printerService) {
      return { printed: false, message: "Printer runtime is not ready yet." };
    }

    const row = await db.getFirstAsync<{
      sale_id: string;
      receipt_number: string;
      payload: string;
      reprint_count: number;
    }>(
      "SELECT sale_id, receipt_number, payload, reprint_count FROM receipts_local WHERE sale_id = ?",
      saleId,
    );
    if (!row) {
      return {
        printed: false,
        message: "No local receipt found for this sale.",
      };
    }

    const preference = await printerService.getPreference();
    if (preference.printerType === "NONE") {
      return {
        printed: false,
        receiptNumber: row.receipt_number,
        message:
          "Printer is set to None. Configure printer in Settings to print receipts.",
      };
    }

    const original = JSON.parse(row.payload) as ReceiptDocument;
    const marker = "*** REPRINT ***";
    const currentLines = Array.isArray(original.lines) ? original.lines : [];
    const hasMarker = currentLines.some(
      (line) =>
        typeof line?.text === "string" &&
        line.text.toUpperCase().includes("REPRINT"),
    );
    const printable: ReceiptDocument = {
      ...original,
      isReprint: false,
      lines: hasMarker
        ? currentLines
        : [{ align: "center", emphasis: true, text: marker }, ...currentLines],
    };

    try {
      await printerService.printReceiptDocument(printable);

      const now = new Date().toISOString();
      await db.runAsync(
        "UPDATE receipts_local SET reprint_count = reprint_count + 1, updated_at = ? WHERE sale_id = ?",
        now,
        saleId,
      );

      const stamp = Date.now();
      const outbox = new SQLiteOutboxRepository(db);
      await outbox.enqueue({
        id: `reprint-${saleId}-${stamp}`,
        entity: "receipt",
        action: "reprint",
        payload: {
          sale_id: saleId,
          receipt_number: row.receipt_number,
          reprinted_at: now,
        },
        idempotencyKey: `idem-reprint-${saleId}-${stamp}`,
      });

      return {
        printed: true,
        receiptNumber: row.receipt_number,
        message:
          row.reprint_count > 0
            ? "Reprint sent to printer."
            : "Print sent to printer.",
      };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Print dispatch failed.";
      return {
        printed: false,
        receiptNumber: row.receipt_number,
        message,
      };
    }
  };

  const renderReadyContent = (activeTheme: AppTheme): JSX.Element => {
    if (!db) {
      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: activeTheme.card,
              borderColor: activeTheme.cardBorder,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: activeTheme.heading }]}>
            Loading Database...
          </Text>
          <Text style={[styles.infoText, { color: activeTheme.subtext }]}>
            Local storage is initializing. Please wait.
          </Text>
        </View>
      );
    }

    if (currentReadyView === "HOME") {
      return (
        <HomeScreen
          db={db}
          theme={activeTheme}
          pendingCount={pendingCount}
          serverOnline={serverOnline}
          selectedBranchName={selectedBranchName}
          selectedLocationName={selectedLocationName}
          lastMasterDataSyncAt={lastMasterDataSyncAt}
        />
      );
    }

    if (currentReadyView === "POS") {
      return (
        <PosScreen
          key={`pos-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          preferredBranchId={selectedBranchId}
          preferredLocationId={selectedLocationId}
          defaultLpgFlowForNewItem={posDefaultLpgFlow}
          cashierName={currentCashierName}
          onDataChanged={refreshPendingCount}
          onPrintQueuedSaleReceipt={handlePrintQueuedSaleReceipt}
          onGoToShift={() => {
            setActivePrimaryTab("HOME");
            setActiveSideModule("SHIFT");
          }}
          syncBusy={syncBusy}
        />
      );
    }
    if (currentReadyView === "TRANSFER") {
      return (
        <TransfersScreen
          key={`transfers-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          onDataChanged={refreshPendingCount}
          syncBusy={syncBusy}
        />
      );
    }
    if (currentReadyView === "TRANSFER_LIST") {
      return (
        <TransferListScreen
          key={`transfer-list-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          syncBusy={syncBusy}
        />
      );
    }
    if (currentReadyView === "SALES") {
      return (
        <SalesScreen
          key={`sales-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          preferredBranchId={selectedBranchId}
          onDataChanged={refreshPendingCount}
          onPrintSaleReceipt={handlePrintSaleReceipt}
          syncBusy={syncBusy}
        />
      );
    }
    if (currentReadyView === "EXPENSE") {
      return (
        <ExpenseScreen
          key={`expense-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          onDataChanged={refreshPendingCount}
          syncBusy={syncBusy}
        />
      );
    }
    if (currentReadyView === "ITEMS") {
      return <ItemsViewScreen db={db} theme={activeTheme} />;
    }

    if (currentReadyView === "CUSTOMERS") {
      return (
        <CustomersViewScreen
          key={`customers-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          preferredBranchId={selectedBranchId}
          onDataChanged={refreshPendingCount}
          syncBusy={syncBusy}
        />
      );
    }

    if (currentReadyView === "SHIFT") {
      return (
        <ShiftScreen
          key={`shift-${masterDataVersion}`}
          db={db}
          theme={activeTheme}
          preferredBranchId={selectedBranchId}
          preferredLocationId={selectedLocationId}
          onDataChanged={refreshPendingCount}
          syncBusy={syncBusy}
        />
      );
    }

    return (
      <SettingsScreen
        theme={activeTheme}
        themeMode={themeMode}
        onChangeThemeMode={setThemeMode}
        posDefaultLpgFlow={posDefaultLpgFlow}
        onChangePosDefaultLpgFlow={handleChangePosDefaultLpgFlow}
        pinConfigured={pinConfigured}
        onChangePin={handleChangePin}
        selectedBranchName={selectedBranchName}
        selectedBranchId={selectedBranchId}
        lastMasterDataSyncAt={lastMasterDataSyncAt}
        updateAvailable={masterDataUpdateAvailable}
        branchDataBusy={branchDataBusy}
        onCheckBranchUpdates={async () => {
          await handleCheckBranchUpdates(false);
        }}
        onRedownloadBranchData={handleRedownloadBranchData}
        printerType={printerType}
        printerBluetoothMac={printerBluetoothMac}
        printerTcpHost={printerTcpHost}
        printerTcpPort={printerTcpPort}
        printerCapabilities={printerCapabilities}
        printerBusy={printerBusy}
        printerMessage={printerMessage}
        onChangeBluetoothMac={setPrinterBluetoothMac}
        onChangeTcpHost={setPrinterTcpHost}
        onChangeTcpPort={setPrinterTcpPort}
        onSelectPrinterType={handlePrinterTypeSelect}
        onSavePrinterConfig={handlePrinterSave}
        onTestPrint={handlePrinterTest}
        receiptLayoutSettings={receiptLayoutSettings}
        onSaveReceiptLayoutSettings={handleSaveReceiptLayoutSettings}
        onTestReceiptLayout={handleTestReceiptLayout}
        onStartAppWalkthrough={handleStartAppWalkthrough}
        onResetTutorials={handleResetTutorials}
      />
    );
  };

  const headerSubtitle = `${selectedBranchName ?? selectedBranchId ?? "No branch"}${selectedLocationName ? ` - ${selectedLocationName}` : ""}`;

  if (stage === "BOOTING") {
    return (
      <SafeAreaView
        ref={rootViewRef}
        onLayout={refreshTutorialViewportOffset}
        style={[styles.splashScreen, { backgroundColor: theme.background }]}
      >
        <StatusBar
          animated
          hidden={false}
          translucent={Platform.OS === "android"}
          backgroundColor="transparent"
          barStyle={themeMode === "LIGHT" ? "dark-content" : "light-content"}
        />
        <Animated.View
          style={[styles.splashLogoWrap, { transform: [{ scale: pulseAnim }] }]}
        >
          <Image
            source={APP_LOGO}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </Animated.View>
        <Text style={[styles.splashTitle, { color: theme.heading }]}>VPOS</Text>
        <Text style={[styles.splashSubtitle, { color: theme.subtext }]}>
          Preparing offline engine...
        </Text>
        <ActivityIndicator style={{ marginTop: 12 }} color={theme.primary} />
        <Toast config={goeyToastConfig} />
      </SafeAreaView>
    );
  }

  if (showNoInternetPage && shouldRunStartupConnectivityGate) {
    return (
      <SafeAreaView
        ref={rootViewRef}
        onLayout={refreshTutorialViewportOffset}
        style={[styles.noInternetScreen, { backgroundColor: theme.background }]}
      >
        <StatusBar
          animated
          hidden={false}
          translucent={Platform.OS === "android"}
          backgroundColor="transparent"
          barStyle={themeMode === "LIGHT" ? "dark-content" : "light-content"}
        />
        <View
          style={[
            styles.noInternetCard,
            { backgroundColor: theme.card, borderColor: theme.cardBorder },
          ]}
        >
          <Text style={[styles.noInternetTitle, { color: theme.heading }]}>
            No Internet Connection
          </Text>
          <Text style={[styles.noInternetText, { color: theme.subtext }]}>
            Connect your device to internet and server, then retry.
          </Text>
          <Text style={[styles.noInternetMeta, { color: theme.subtext }]}>
            {noInternetMessage}
          </Text>
          <Pressable
            disabled={startupConnectivityChecking}
            onPress={() => void runStartupConnectivityCheck(true)}
            style={[
              styles.primaryButton,
              {
                backgroundColor: startupConnectivityChecking
                  ? theme.primaryMuted
                  : theme.primary,
                marginTop: 10,
              },
            ]}
          >
            <Text style={styles.buttonText}>
              {startupConnectivityChecking ? "Checking..." : "Retry"}
            </Text>
          </Pressable>
          <Text style={[styles.apiText, { color: theme.subtext }]}>
            API: {API_BASE_URL}
          </Text>
        </View>
        <Toast config={goeyToastConfig} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      ref={rootViewRef}
      onLayout={refreshTutorialViewportOffset}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <StatusBar
        animated
        hidden={false}
        translucent={Platform.OS === "android"}
        backgroundColor="transparent"
        barStyle={themeMode === "LIGHT" ? "dark-content" : "light-content"}
      />
      {showTopHeader ? (
        <View
          style={[
            styles.topHeader,
            {
              backgroundColor: theme.card,
              borderColor: theme.cardBorder,
              paddingTop: headerTopPadding,
            },
          ]}
        >
          <View style={styles.topHeaderLeft}>
            <Pressable
              onPress={() => {
                setNotificationMenuOpen(false);
                setHeaderMenuOpen((prev) => !prev);
              }}
              style={[
                styles.iconButton,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
            >
              <Text style={[styles.iconButtonText, { color: theme.pillText }]}>
                {"\u2630"}
              </Text>
            </Pressable>
            <View
              style={[
                styles.brandMark,
                {
                  backgroundColor: theme.pillBg,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Image
                source={APP_LOGO}
                style={styles.brandLogo}
                resizeMode="contain"
              />
            </View>
            <View style={styles.brandTextWrap}>
              <Text style={[styles.topHeaderTitle, { color: theme.heading }]}>
                VPOS
              </Text>
              <Text
                style={[styles.topHeaderSubtitle, { color: theme.subtext }]}
                numberOfLines={1}
              >
                {headerSubtitle}
              </Text>
            </View>
          </View>
          <View style={styles.topHeaderRight}>
            <View
              style={[
                styles.statusDotWrap,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: serverOnline ? "#22C55E" : "#EF4444" },
                ]}
              />
            </View>
            <Pressable
              onPress={() => {
                setHeaderMenuOpen(false);
                setNotificationMenuOpen((prev) => !prev);
              }}
              style={[
                styles.iconButton,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
            >
              <Text style={[styles.iconButtonText, { color: theme.pillText }]}>
                {"\uD83D\uDD14"}
              </Text>
              {notificationCount > 0 ? (
                <View
                  style={[styles.bellBadge, { backgroundColor: theme.primary }]}
                >
                  <Text style={styles.statusPendingBadgeText}>
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>
      ) : null}
      <ScrollView
        ref={contentScrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: showTopHeader
              ? contentTopPadding
              : contentTopPaddingNoHeader,
          },
          stage === "READY" ? styles.scrollContentReady : null,
        ]}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => {
          contentScrollYRef.current = event.nativeEvent.contentOffset.y;
          const activeTargetKey = tutorialState.activeTargetKey;
          if (!activeTargetKey) {
            return;
          }
          const now = Date.now();
          if (now - lastTutorialMeasureTsRef.current < 48) {
            return;
          }
          lastTutorialMeasureTsRef.current = now;
          tutorialActions.measureTarget(activeTargetKey);
        }}
        onScrollBeginDrag={() => {
          setHeaderMenuOpen(false);
          setNotificationMenuOpen(false);
        }}
      >
        {stage === "SUBSCRIPTION_ENDED" && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.heading }]}>
              Subscription Ended
            </Text>
            <Text style={[styles.infoText, { color: theme.subtext }]}>
              {subscriptionEndedMessage ??
                "Mobile access is locked because the tenant subscription is not active."}
            </Text>
            <Text style={[styles.helperText, { color: theme.subtext }]}>
              Ask your owner/admin to renew or reactivate your subscription.
            </Text>
            <Pressable
              disabled={busy}
              onPress={() => {
                setSubscriptionEndedMessage(null);
                setError(null);
                setStage("LOGIN");
              }}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: busy ? theme.primaryMuted : theme.primary,
                },
              ]}
            >
              <Text style={styles.buttonText}>Retry Sign In</Text>
            </Pressable>
          </View>
        )}

        {stage === "LOGIN" && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.heading }]}>
              Sign In
            </Text>
            <TextInput
              value={email}
              editable={!isAuthInputDisabled}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="off"
              importantForAutofill="no"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={theme.inputPlaceholder}
              textContentType="none"
              style={[
                styles.input,
                { backgroundColor: theme.inputBg, color: theme.inputText },
              ]}
            />
            <Text style={[styles.helperText, { color: theme.subtext }]}>
              Use your web admin email address.
            </Text>
            <View
              style={[
                styles.passwordRow,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.inputBg,
                },
              ]}
            >
              <TextInput
                value={password}
                editable={!isAuthInputDisabled}
                onChangeText={setPassword}
                autoComplete="off"
                importantForAutofill="no"
                secureTextEntry={!showPassword}
                placeholder="Password"
                placeholderTextColor={theme.inputPlaceholder}
                textContentType="none"
                style={[styles.passwordInput, { color: theme.inputText }]}
              />
              <Pressable
                disabled={isAuthInputDisabled}
                onPress={() => setShowPassword((prev) => !prev)}
                style={[
                  styles.passwordToggle,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.pillBg,
                  },
                ]}
              >
                <Text
                  style={[styles.passwordToggleText, { color: theme.pillText }]}
                >
                  {showPassword ? "\u{1F648}" : "\u{1F441}"}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.helperText, { color: theme.subtext }]}>
              Minimum 8 characters recommended.
            </Text>
            <Text style={[styles.helperText, { color: theme.subtext }]}>
              PIN is configured in Settings after login.
            </Text>
            <Pressable
              disabled={isAuthInputDisabled}
              onPress={() => void handleLogin()}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: isAuthInputDisabled
                    ? theme.primaryMuted
                    : theme.primary,
                },
              ]}
            >
              <Text style={styles.buttonText}>
                {busy ? "Signing In..." : "Sign In"}
              </Text>
            </Pressable>
            {pinConfigured ? (
              <Pressable
                disabled={isAuthInputDisabled}
                onPress={switchToPinUnlock}
                style={[
                  styles.secondaryButton,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.pillBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: theme.pillText },
                  ]}
                >
                  Use PIN Instead
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={isAuthInputDisabled}
              onPress={() => {
                setEnrollmentScannerOpen(true);
              }}
              style={[
                styles.secondaryButton,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
            >
              <Text
                style={[
                  styles.secondaryButtonText,
                  { color: theme.pillText },
                ]}
              >
                Scan Setup QR
              </Text>
            </Pressable>
          </View>
        )}

        {stage === "UNLOCK" && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.heading }]}>
              Unlock Offline Session
            </Text>
            <Text style={[styles.infoText, { color: theme.subtext }]}>
              Enter your local PIN to continue while offline.
            </Text>
            {email.trim() ? (
              <Text style={[styles.helperText, { color: theme.subtext }]}>
                Account: {email.trim()}
              </Text>
            ) : null}
            <PinCodeInput
              value={pin}
              onChange={setPin}
              editable={!isAuthInputDisabled}
              theme={theme}
              autoFocus
            />
            <Text style={[styles.helperText, { color: theme.subtext }]}>
              Ask supervisor to reset PIN if forgotten.
            </Text>
            <Pressable
              disabled={isAuthInputDisabled}
              onPress={() => void handleUnlock()}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: isAuthInputDisabled
                    ? theme.primaryMuted
                    : theme.primary,
                },
              ]}
            >
              <Text style={styles.buttonText}>
                {busy ? "Unlocking..." : "Unlock"}
              </Text>
            </Pressable>
            <Pressable
              disabled={isAuthInputDisabled}
              onPress={switchToPasswordLogin}
              style={[
                styles.secondaryButton,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
            >
              <Text
                style={[styles.secondaryButtonText, { color: theme.pillText }]}
              >
                Use Password Instead
              </Text>
            </Pressable>
          </View>
        )}

        {stage === "BRANCH_SETUP" && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.heading }]}>
              Branch Selection
            </Text>
            <Text style={[styles.infoText, { color: theme.subtext }]}>
              {serverOnline
                ? "Connected to server. Select branch to download latest users, locations, and master data."
                : "Offline mode detected. You can continue with previously downloaded branch data."}
            </Text>

            <MasterDataSelect
              label="Branch"
              placeholder={
                branchOptions.length ? "Select branch" : "No branch available"
              }
              value={selectedBranchId}
              options={branchOptions}
              theme={theme}
              onChange={(next) => {
                setSelectedBranchId(next);
                const selected = branchOptions.find(
                  (option) => option.id === next,
                );
                setSelectedBranchName(selected?.label ?? null);
                if (db && next.trim()) {
                  void loadBranchLocationsForSetup(db, next, {
                    allowRemote: serverOnline,
                  });
                } else {
                  setBranchLocationOptions([]);
                  setSelectedLocationId("");
                  setSelectedLocationName(null);
                }
              }}
              disabled={branchSetupBusy}
            />

            <MasterDataSelect
              label="Location"
              placeholder={
                branchLocationOptions.length
                  ? "Select location"
                  : "No location available for selected branch"
              }
              value={selectedLocationId}
              options={branchLocationOptions}
              theme={theme}
              onChange={(next) => {
                setSelectedLocationId(next);
                const selected = branchLocationOptions.find(
                  (option) => option.id === next,
                );
                setSelectedLocationName(selected?.label ?? null);
              }}
              disabled={branchSetupBusy || !selectedBranchId.trim()}
            />
            {!branchLocationOptions.length && selectedBranchId.trim() ? (
              <Text style={[styles.helperText, { color: theme.subtext }]}>
                No active locations found for this branch. Add at least one
                active location in Web Admin, then tap Refresh Branches.
              </Text>
            ) : null}

            {branchSetupMessage ? (
              <Text style={[styles.helperText, { color: theme.subtext }]}>
                {branchSetupMessage}
              </Text>
            ) : null}

            <View style={styles.row}>
              <Pressable
                disabled={branchSetupBusy}
                onPress={() => void handleBranchRefresh()}
                style={[
                  styles.secondaryButton,
                  {
                    backgroundColor: branchSetupBusy
                      ? theme.primaryMuted
                      : theme.pillBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: branchSetupBusy ? "#FFFFFF" : theme.pillText },
                  ]}
                >
                  {branchSetupBusy ? "Checking..." : "Refresh Branches"}
                </Text>
              </Pressable>
              <Pressable
                disabled={
                  branchSetupBusy ||
                  !selectedBranchId.trim() ||
                  !selectedLocationId.trim() ||
                  branchOptions.length === 0
                }
                onPress={() => void handleBranchContinue()}
                style={[
                  styles.primaryButton,
                  {
                    flex: 1,
                    backgroundColor:
                      branchSetupBusy ||
                      !selectedBranchId.trim() ||
                      !selectedLocationId.trim() ||
                      branchOptions.length === 0
                        ? theme.primaryMuted
                        : theme.primary,
                  },
                ]}
              >
                <Text style={styles.buttonText}>
                  {branchSetupBusy
                    ? "Downloading..."
                    : selectedBranchName && selectedLocationName
                      ? `Use ${selectedBranchName} / ${selectedLocationName}`
                      : "Continue"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {stage === "READY" && (
          <View style={styles.sectionStack}>
            <View
              style={[
                styles.moduleHeader,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <View style={styles.moduleHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.moduleTitle, { color: theme.heading }]}>
                    {READY_VIEW_META[currentReadyView].label}
                  </Text>
                  <Text style={[styles.moduleHint, { color: theme.subtext }]}>
                    {READY_VIEW_META[currentReadyView].hint}
                  </Text>
                </View>
                <View ref={moduleHelpTarget.ref} onLayout={moduleHelpTarget.onLayout}>
                  <Pressable
                    onPress={() => handleOpenTutorialForScope(tutorialScopeForReadyView)}
                    style={[
                      styles.moduleHelpButton,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor: theme.pillBg,
                      },
                      isTutorialTargetActive("module-help")
                        ? styles.tutorialTargetFocus
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.moduleHelpButtonText,
                        { color: theme.pillText },
                      ]}
                    >
                      ?
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {renderReadyContent(theme)}
          </View>
        )}

        {error ? (
          <View style={[styles.errorCard, { backgroundColor: "#3B1B28" }]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={[styles.apiText, { color: theme.subtext }]}>
          API: {API_BASE_URL}
        </Text>
      </ScrollView>
      {stage === "READY" && notificationMenuOpen ? (
        <View style={styles.notificationOverlay}>
          <Pressable
            style={styles.notificationBackdrop}
            onPress={() => setNotificationMenuOpen(false)}
          />
          <View
            style={[
              styles.notificationPanel,
              {
                top: headerTopPadding + 44,
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <Text style={[styles.notificationTitle, { color: theme.heading }]}>
              Notifications
            </Text>
            <Text style={[styles.notificationSub, { color: theme.subtext }]}>
              Sync and branch-data actions for this device.
            </Text>

            {pendingCount > 0 ? (
              <View
                style={[
                  styles.notificationItem,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.inputBg,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.notificationItemTitle,
                      { color: theme.heading },
                    ]}
                  >
                    {pendingCount} item{pendingCount > 1 ? "s" : ""} pending
                    sync
                  </Text>
                  <Text
                    style={[
                      styles.notificationItemSub,
                      { color: theme.subtext },
                    ]}
                  >
                    Push queued transactions to server now.
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.notificationGoButton,
                    {
                      backgroundColor: syncBusy
                        ? theme.primaryMuted
                        : theme.primary,
                    },
                  ]}
                  disabled={syncBusy}
                  onPress={() => void handleHeaderSyncNow()}
                >
                  <Text style={styles.notificationGoButtonText}>
                    {syncBusy ? "..." : "Go"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {masterDataUpdateAvailable ? (
              <View
                style={[
                  styles.notificationItem,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.inputBg,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.notificationItemTitle,
                      { color: theme.heading },
                    ]}
                  >
                    Branch data update available
                  </Text>
                  <Text
                    style={[
                      styles.notificationItemSub,
                      { color: theme.subtext },
                    ]}
                  >
                    Redownload latest branch users, prices, and master data.
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.notificationGoButton,
                    {
                      backgroundColor: branchDataBusy
                        ? theme.primaryMuted
                        : theme.primary,
                    },
                  ]}
                  disabled={branchDataBusy}
                  onPress={() => {
                    setNotificationMenuOpen(false);
                    void handleRedownloadBranchData();
                  }}
                >
                  <Text style={styles.notificationGoButtonText}>
                    {branchDataBusy ? "..." : "Go"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {notificationCount === 0 ? (
              <View
                style={[
                  styles.notificationItem,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.inputBg,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.notificationItemTitle,
                      { color: theme.heading },
                    ]}
                  >
                    No new alerts
                  </Text>
                  <Text
                    style={[
                      styles.notificationItemSub,
                      { color: theme.subtext },
                    ]}
                  >
                    Everything is up to date for now.
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.notificationGoButton,
                    { backgroundColor: theme.pillBg },
                  ]}
                  onPress={() => {
                    setNotificationMenuOpen(false);
                    setActiveSideModule("SETTINGS");
                  }}
                >
                  <Text
                    style={[
                      styles.notificationGoButtonText,
                      { color: theme.pillText },
                    ]}
                  >
                    Open
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      {stage === "READY" && sideMenuMounted ? (
        <Animated.View style={styles.sideMenuOverlay}>
          <Pressable
            style={styles.sideMenuBackdrop}
            onPress={() => setHeaderMenuOpen(false)}
          >
            <Animated.View
              style={[
                styles.sideMenuBackdropDim,
                {
                  opacity: sideMenuAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                },
              ]}
            />
          </Pressable>
          <Animated.View
            style={[
              styles.sideMenuPanel,
              {
                backgroundColor: theme.card,
                borderColor: theme.cardBorder,
                paddingTop: headerTopPadding + 58,
              },
              {
                opacity: sideMenuAnim.interpolate({
                  inputRange: [0, 0.35, 1],
                  outputRange: [0, 0.85, 1],
                }),
                transform: [
                  {
                    translateX: sideMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-44, 0],
                    }),
                  },
                  {
                    scale: sideMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={[styles.sideMenuTitle, { color: theme.heading }]}>
              Other Menu
            </Text>
            <Text style={[styles.sideMenuSub, { color: theme.subtext }]}>
              Expense, Items, Customers, Settings and others.
            </Text>

            {SIDE_MENU_MODULES.map((module) => {
              const active = activeSideModule === module;
              return (
                <Pressable
                  key={module}
                  style={[
                    styles.sideMenuItem,
                    {
                      backgroundColor: active ? theme.primary : theme.inputBg,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                  onPress={() => {
                    setActiveSideModule(module);
                    setHeaderMenuOpen(false);
                  }}
                >
                  <View style={styles.sideMenuItemRow}>
                    <View
                      style={[
                        styles.sideMenuIconBadge,
                        {
                          backgroundColor: active
                            ? "rgba(255,255,255,0.2)"
                            : theme.pillBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sideMenuIconText,
                          { color: active ? "#FFFFFF" : theme.pillText },
                        ]}
                      >
                        {READY_VIEW_ICONS[module]}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.sideMenuItemTitle,
                          { color: active ? "#FFFFFF" : theme.heading },
                        ]}
                      >
                        {READY_VIEW_META[module].label}
                      </Text>
                      <Text
                        style={[
                          styles.sideMenuItemSub,
                          { color: active ? "#FFFFFF" : theme.subtext },
                        ]}
                      >
                        {READY_VIEW_META[module].hint}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
              onPress={() => {
                setActiveSideModule(null);
                setHeaderMenuOpen(false);
              }}
            >
              <Text
                style={[styles.sideMenuActionText, { color: theme.pillText }]}
              >
                Back To Main Tabs
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: syncBusy
                    ? theme.primaryMuted
                    : theme.primary,
                },
              ]}
              onPress={() => void handleHeaderSyncNow()}
              disabled={syncBusy}
            >
              <Text style={styles.sideMenuActionText}>
                {syncBusy ? "Syncing..." : "Sync Now"}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: branchDataBusy
                    ? theme.primaryMuted
                    : theme.pillBg,
                },
              ]}
              onPress={() => {
                setHeaderMenuOpen(false);
                void handleRedownloadBranchData();
              }}
              disabled={branchDataBusy}
            >
              <Text
                style={[
                  styles.sideMenuActionText,
                  { color: branchDataBusy ? "#FFFFFF" : theme.pillText },
                ]}
              >
                {branchDataBusy ? "Downloading..." : "Download Branch Data"}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
              onPress={() => {
                setHeaderMenuOpen(false);
                void handleSwitchCashier();
              }}
            >
              <Text
                style={[styles.sideMenuActionText, { color: theme.pillText }]}
              >
                Switch Cashier
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.pillBg,
                },
              ]}
              onPress={() => {
                setHeaderMenuOpen(false);
                void handleLogout();
              }}
            >
              <Text
                style={[styles.sideMenuActionText, { color: theme.pillText }]}
              >
                Log Out (Lock)
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sideMenuAction,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor: "#B91C1C",
                },
              ]}
              onPress={() => {
                setHeaderMenuOpen(false);
                void handleFullSignOut();
              }}
            >
              <Text style={styles.sideMenuActionText}>Full Sign Out</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      ) : null}
      <EnrollmentScannerModal
        visible={enrollmentScannerOpen}
        theme={theme}
        busy={enrollmentBusy}
        onClose={() => setEnrollmentScannerOpen(false)}
        onTokenDetected={(token) => {
          setEnrollmentScannerOpen(false);
          setPendingEnrollmentToken(token);
          setShowNoInternetPage(false);
        }}
      />
      <TutorialOverlayHost
        theme={theme}
        onCompleteScope={(scope) => {
          void markTutorialSeenForScope(scope, "done");
        }}
        onPauseScope={(scope) => {
          pauseTutorialForScope(scope);
        }}
        onSkipScope={(scope) => {
          void markTutorialSeenForScope(scope, "skipped");
        }}
      />
      {stage === "READY" && (
        <View
          style={[
            styles.bottomNav,
            { backgroundColor: theme.card, borderColor: theme.cardBorder },
          ]}
        >
          {PRIMARY_TABS.map((tab) => {
            const selected =
              tab === activePrimaryTab && activeSideModule === null;
            return (
              <Pressable
                key={tab}
                onPress={() => {
                  setActivePrimaryTab(tab);
                  setActiveSideModule(null);
                }}
                style={[
                  styles.bottomNavItem,
                  {
                    backgroundColor: selected ? theme.primary : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.bottomNavLabel,
                    { color: selected ? "#FFFFFF" : theme.pillText },
                  ]}
                >
                  {READY_VIEW_META[tab].label}
                </Text>
                <Text
                  style={[
                    styles.bottomNavHint,
                    { color: selected ? "#FFFFFF" : theme.subtext },
                  ]}
                >
                  {READY_VIEW_META[tab].hint}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Toast config={goeyToastConfig} />
    </SafeAreaView>
  );
}

export default function App(): JSX.Element {
  return (
    <TutorialProvider>
      <AppShell />
    </TutorialProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  splashScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  splashLogoWrap: {
    width: 150,
    height: 150,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  splashLogo: {
    width: 132,
    height: 132,
  },
  splashTitle: {
    marginTop: 14,
    fontSize: 30,
    fontWeight: "800",
  },
  splashSubtitle: {
    marginTop: 4,
    fontSize: 14,
  },
  noInternetScreen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  noInternetCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 10,
  },
  noInternetTitle: {
    fontSize: 22,
    fontWeight: "800",
  },
  noInternetText: {
    fontSize: 14,
    lineHeight: 20,
  },
  noInternetMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 80,
    paddingBottom: 18,
    gap: 12,
  },
  scrollContentReady: {
    paddingBottom: 98,
  },
  topHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    elevation: 40,
    overflow: "visible",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogo: {
    width: 24,
    height: 24,
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  topHeaderTitle: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
  topHeaderSubtitle: {
    fontSize: 11,
    lineHeight: 14,
  },
  topHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    zIndex: 60,
    gap: 6,
  },
  statusDotWrap: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  bellBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  statusPendingBadge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  statusUpdateBadge: {
    position: "absolute",
    bottom: -6,
    right: -8,
    minWidth: 15,
    height: 15,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  statusPendingBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  headerDropdown: {
    position: "absolute",
    top: 36,
    right: 0,
    minWidth: 170,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    zIndex: 80,
    elevation: 80,
  },
  dropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dropdownText: {
    fontSize: 12,
    fontWeight: "700",
  },
  dropdownHint: {
    fontSize: 11,
  },
  dropdownButton: {
    minHeight: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  notificationOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 95,
    elevation: 95,
  },
  notificationBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  notificationPanel: {
    position: "absolute",
    right: 12,
    width: 312,
    maxWidth: "92%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    zIndex: 96,
    elevation: 96,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  notificationSub: {
    fontSize: 11,
    marginBottom: 2,
  },
  notificationItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notificationItemTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  notificationItemSub: {
    fontSize: 11,
    marginTop: 2,
  },
  notificationGoButton: {
    minWidth: 44,
    minHeight: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  notificationGoButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  sideMenuOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: 90,
    elevation: 90,
  },
  sideMenuBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sideMenuBackdropDim: {
    flex: 1,
    backgroundColor: "rgba(2, 8, 23, 0.45)",
  },
  sideMenuPanel: {
    width: 292,
    maxWidth: "84%",
    height: "100%",
    borderRightWidth: 1,
    paddingTop: 82,
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 8,
  },
  sideMenuTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  sideMenuSub: {
    fontSize: 11,
    marginBottom: 4,
  },
  sideMenuItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sideMenuItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sideMenuIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sideMenuIconText: {
    fontSize: 16,
    fontWeight: "800",
  },
  sideMenuItemTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  sideMenuItemSub: {
    fontSize: 11,
    marginTop: 2,
  },
  sideMenuAction: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  sideMenuActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: "#F59E0B",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  sectionStack: {
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  helperText: {
    fontSize: 12,
    marginTop: -2,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  passwordRow: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 8,
    gap: 8,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  passwordToggle: {
    minHeight: 30,
    minWidth: 54,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  passwordToggleText: {
    fontSize: 12,
    fontWeight: "700",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  infoText: {
    fontSize: 13,
  },
  rowCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  moduleHeader: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  moduleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  moduleTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  moduleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  moduleHelpButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  moduleHelpButtonText: {
    fontSize: 15,
    fontWeight: "800",
  },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 6,
    flexDirection: "row",
    gap: 6,
  },
  bottomNavItem: {
    flex: 1,
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  bottomNavLabel: {
    fontSize: 11,
    fontWeight: "800",
  },
  bottomNavHint: {
    fontSize: 10,
    marginTop: 1,
  },
  errorCard: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: "#FFD8E4",
    fontSize: 13,
  },
  apiText: {
    marginTop: 4,
    fontSize: 12,
  },
});

