import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DESKTOP_ROUTES, type DesktopRoute, type DesktopRouteId } from './routes';
import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { BrandLogo } from '../components/layout/BrandLogo';
import { DesktopContainer } from '../components/layout/DesktopContainer';
import { useBreakpointUp } from '../hooks/useMediaQuery';
import { useDesktopShortcuts } from '../hooks/useDesktopShortcuts';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ModulePlaceholderScreen } from '../screens/ModulePlaceholderScreen';
import { PosScreen } from '../screens/PosScreen';
import { SalesScreen } from '../screens/SalesScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { LendingScreen } from '../screens/LendingScreen';
import { ItemsScreen } from '../screens/ItemsScreen';
import { LpgServiceScreen } from '../screens/LpgServiceScreen';
import { DesktopStartupScreen } from '../screens/DesktopStartupScreen';
import { TransferScreen } from '../screens/TransferScreen';
import { TransferHistoryScreen } from '../screens/TransferHistoryScreen';
import { ShiftScreen } from '../screens/ShiftScreen';
import { ExpenseScreen } from '../screens/ExpenseScreen';
import { CashierReportsScreen } from '../screens/CashierReportsScreen';
import { PurchaseOrdersScreen } from '../screens/PurchaseOrdersScreen';
import { DeliveryDispatchScreen } from '../screens/DeliveryDispatchScreen';
import { DesktopUiProvider, useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { playDesktopStartupCueOnce } from '../components/feedback/desktop-startup-cue';
import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState, type DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopSessionService, type DesktopStartupStage } from '../services/desktop-session.service';
import { desktopSettingsService } from '../services/desktop-settings.service';
import { desktopSyncService } from '../services/desktop-sync.service';
import { DesktopTutorialOverlayHost } from '../tutorial/tutorial-overlay-host';
import { DesktopTutorialProvider, useDesktopTutorialActions, useDesktopTutorialState } from '../tutorial/tutorial-provider';
import { getRouteForTutorialScreen } from '../tutorial/tutorial-routing';

const PRIMARY_ROUTES: DesktopRouteId[] = ['dashboard', 'pos', 'sales', 'transfer', 'transfer-list'];
const SIDE_MENU_ROUTES: DesktopRouteId[] = ['items', 'customers', 'lending', 'lpg-service', 'expense', 'shift', 'reports', 'settings'];
const ADDON_ROUTE_IDS = ['purchase-orders', 'delivery-dispatch'] as const;
const WORKSPACE_ROUTES = new Set<DesktopRouteId>(['pos', 'sales', 'transfer', 'transfer-list']);
type TenantAddonFlags = Awaited<ReturnType<typeof desktopMasterDataService.loadTenantAddons>>;
type AddonRouteId = (typeof ADDON_ROUTE_IDS)[number];

const ADDON_FLAG_BY_ROUTE: Record<AddonRouteId, keyof TenantAddonFlags> = {
  'purchase-orders': 'purchase_order_suite',
  'delivery-dispatch': 'delivery_dispatch_suite'
};

function resolveRoutes(routeIds: readonly DesktopRouteId[]): DesktopRoute[] {
  return routeIds
    .map((routeId) => DESKTOP_ROUTES.find((route) => route.id === routeId))
    .filter((route): route is DesktopRoute => Boolean(route));
}

function isAddonRoute(route: DesktopRouteId): route is AddonRouteId {
  return ADDON_ROUTE_IDS.includes(route as AddonRouteId);
}

function moduleConfig(route: DesktopRouteId): { title: string; description: string; bullets: string[] } {
  switch (route) {
    case 'customers':
      return {
        title: 'Customers',
        description: 'Search customers, review balances, and reopen recent sales into POS.',
        bullets: [
          'Customer search and detail drawer',
          'Points and balance view',
          'Recent sales, lending, and payments',
          'Card and loyalty read-only support'
        ]
      };
    case 'items':
      return {
        title: 'Items',
        description: 'Search branch items, review stock, and send an item straight into POS.',
        bullets: [
          'Search items and categories',
          'Stock and LPG full or empty view',
          'Price and unit detail',
          'Quick send to POS'
        ]
      };
    case 'sales':
      return {
        title: 'Sales',
        description: 'Sales history, cancel sale, item returns, and payment follow-up.',
        bullets: ['Sales list and detail', 'Cancel sale', 'Payment breakdown', 'Pay balance', 'Return item']
      };
    case 'transfer':
      return {
        title: 'Transfer',
        description: 'Create a transfer the same way the mobile Transfer tab works.',
        bullets: ['Choose destination branch', 'Add items and quantities', 'Save transfer locally', 'Sync later when ready']
      };
    case 'transfer-list':
      return {
        title: 'Transfer History',
        description: 'Review saved transfers, received transfers, and recent movement records.',
        bullets: ['Transfer history list', 'Sent and received filters', 'Transfer detail', 'Later: reopen and print']
      };
    case 'expense':
      return {
        title: 'Expense',
        description: 'Petty cash and branch expense entries will live here, following the mobile menu path.',
        bullets: ['View petty cash entries', 'Create branch expense entries', 'Review expense history', 'Later: sync and approval flow']
      };
    case 'reports':
      return {
        title: 'Cashier Reports',
        description: 'Date-filtered cashier report snapshots for sales, collections, balances, and shift activity.',
        bullets: [
          'Sales totals and recent receipts',
          'Customer payment totals in range',
          'Outstanding balance snapshot',
          'Open lending and shift read overview'
        ]
      };
    case 'lending':
      return {
        title: 'Lending',
        description: 'Open lending records, partial returns, and close-out actions.',
        bullets: ['Create lending from completed sales', 'View open and partial records', 'Record returns', 'Offline queue and sync reconciliation']
      };
    case 'shift':
      return {
        title: 'Shift',
        description: 'Start duty, end duty, and review shift cash from the same layout used on mobile.',
        bullets: ['Open duty with opening cash', 'End duty with actual count', 'Shift cash in and out', 'Later: full shift history']
      };
    case 'purchase-orders':
      return {
        title: 'Purchase Orders',
        description: 'Prepare supplier purchase orders, track receiving, and keep branch replenishment organized.',
        bullets: [
          'Create and review supplier orders',
          'Track ordered, received, and pending quantities',
          'Prepare receiving and reconciliation steps',
          'Later: sync approvals and supplier follow-up'
        ]
      };
    case 'delivery-dispatch':
      return {
        title: 'Delivery Dispatch',
        description: 'Stage delivery dispatch work, handoff details, and route-ready order tracking for branch teams.',
        bullets: [
          'Create dispatch records from completed orders',
          'Track driver, vehicle, and handoff details',
          'Review delivery status and exceptions',
          'Later: sync proof-of-delivery and completion updates'
        ]
      };
    case 'lpg-service':
      return {
        title: 'LPG Service',
        description: 'Disposed, junked, and replaced item records with the same branch-facing flow as mobile.',
        bullets: ['Disposed records and service history', 'Readable branch-focused filters', 'Offline-safe service action queue', 'Cross-link to related sales and notes']
      };
    case 'settings':
      return {
        title: 'Settings',
        description: 'Setup and device options for this branch device.',
        bullets: ['Branch and location setup', 'Printer configuration', 'API and sync configuration', 'Later: updater and advanced device settings']
      };
    case 'dashboard':
    case 'pos':
    default:
      return {
        title: 'Dashboard',
        description: 'Branch overview and quick actions.',
        bullets: []
      };
  }
}

function unavailableAddonConfig(route: AddonRouteId): { title: string; description: string; bullets: string[] } {
  switch (route) {
    case 'purchase-orders':
      return {
        title: 'Purchase Orders Unavailable',
        description: 'The Purchase Order Suite add-on is not enabled for this tenant on this desktop.',
        bullets: [
          'Enable Purchase Order Suite for this tenant to open the route.',
          'Download branch data again after the add-on is turned on.',
          'Until then, this workstation keeps the module unavailable.'
        ]
      };
    case 'delivery-dispatch':
      return {
        title: 'Delivery Dispatch Unavailable',
        description: 'The Delivery Dispatch Suite add-on is not enabled for this tenant on this desktop.',
        bullets: [
          'Enable Delivery Dispatch Suite for this tenant to open the route.',
          'Download branch data again after the add-on is turned on.',
          'Until then, this workstation keeps the module unavailable.'
        ]
      };
  }
}

function DesktopAppShell(): JSX.Element {
  const desktopUi = useDesktopUi();
  const tutorialActions = useDesktopTutorialActions();
  const tutorialState = useDesktopTutorialState();
  const [state, setState] = useState<DesktopAppState>(DEFAULT_DESKTOP_APP_STATE);
  const [activeRoute, setActiveRoute] = useState<DesktopRouteId>('dashboard');
  const [lastPrimaryRoute, setLastPrimaryRoute] = useState<DesktopRouteId>('dashboard');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const isWide = useBreakpointUp('md');
  const [booting, setBooting] = useState(true);
  const [startupStage, setStartupStage] = useState<DesktopStartupStage>('LOGIN');
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupMessage, setStartupMessage] = useState(
    'Sign in with password or use QR quick setup, then download branch data before opening the app.'
  );
  const [startupMessageTone, setStartupMessageTone] = useState<'info' | 'success'>('info');
  const [startupError, setStartupError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [branchDataBusy, setBranchDataBusy] = useState(false);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [shellScrolled, setShellScrolled] = useState(false);
  const [tenantAddonFlags, setTenantAddonFlags] = useState<TenantAddonFlags | null>(null);
  const [reopenSaleDraft, setReopenSaleDraft] = useState<{ sale: DesktopSaleRecord; mode: 'copy' | 'recreate' } | null>(null);
  const [reopenSaleNonce, setReopenSaleNonce] = useState(0);
  const [pendingSalesDetailId, setPendingSalesDetailId] = useState<string | null>(null);
  const [pendingSalesDetailNonce, setPendingSalesDetailNonce] = useState(0);
  const [quickAddProductId, setQuickAddProductId] = useState<string | null>(null);
  const [quickAddNonce, setQuickAddNonce] = useState(0);
  const [lpgFocusProductId, setLpgFocusProductId] = useState<string | null>(null);
  const [lpgFocusNonce, setLpgFocusNonce] = useState(0);
  const autoWalkthroughOpenedRef = useRef(false);

  const handleSelectRoute = useCallback((route: DesktopRouteId): void => {
    setActiveRoute(route);
    if (PRIMARY_ROUTES.includes(route)) {
      setLastPrimaryRoute(route);
    }
  }, []);

  const handleEscape = useCallback((): void => {
    setDrawerOpen(false);
  }, []);

  useDesktopShortcuts({
    onSelectRoute: handleSelectRoute,
    onEscape: handleEscape
  });

  const reloadDesktopState = async (): Promise<void> => {
    const [next, outbox] = await Promise.all([desktopSettingsService.getState(), desktopDb.listOutboxItems()]);
    setState(next);
    setPendingOutboxCount(outbox.filter((row) => row.status === 'pending' || row.status === 'failed').length);
  };

  const refreshOutboxCount = async (): Promise<void> => {
    const rows = await desktopDb.listOutboxItems();
    setPendingOutboxCount(rows.filter((row) => row.status === 'pending' || row.status === 'failed').length);
  };

  const reloadTenantAddonFlags = useCallback(async (): Promise<void> => {
    try {
      const nextFlags = await desktopMasterDataService.loadTenantAddons();
      setTenantAddonFlags(nextFlags);
    } catch {
      setTenantAddonFlags(null);
    }
  }, []);

  useEffect(() => {
    void playDesktopStartupCueOnce();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [loadedState, outbox, addonFlags] = await Promise.all([
        desktopSettingsService.getState(),
        desktopDb.listOutboxItems(),
        desktopMasterDataService.loadTenantAddons().catch(() => null)
      ]);
      const boot = await desktopSessionService.bootstrap(loadedState);
      if (!active) {
        return;
      }
      setState(boot.state);
      setTenantAddonFlags(addonFlags);
      setPendingOutboxCount(outbox.filter((row) => row.status === 'pending' || row.status === 'failed').length);
      setStartupStage(boot.stage);
      setStartupMessage(
        boot.stage === 'SETUP'
          ? 'Choose the branch and location, then download branch data.'
          : boot.stage === 'UNLOCK'
            ? 'Enter the saved PIN to reopen the app.'
            : 'Sign in with password or use QR quick setup, then download branch data before opening the app.'
      );
      setStartupMessageTone('info');
      setBooting(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleScroll = (): void => {
      setShellScrolled(window.scrollY > 14);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const autoTutorialsEnabled = false;
    if (!autoTutorialsEnabled) {
      return;
    }
    if (booting || startupStage !== 'READY') {
      return;
    }
    if (autoWalkthroughOpenedRef.current || tutorialState.scope) {
      return;
    }
    if (!state.walkthrough.completedAt && !state.walkthrough.dismissedAt) {
      autoWalkthroughOpenedRef.current = true;
      tutorialActions.open('APP_WALKTHROUGH');
    }
  }, [
    booting,
    startupStage,
    state.walkthrough.completedAt,
    state.walkthrough.dismissedAt,
    tutorialActions,
    tutorialState.scope
  ]);

  useEffect(() => {
    tutorialActions.setScreenNavigator((screen) => {
      handleSelectRoute(getRouteForTutorialScreen(screen));
    });
    tutorialActions.setEnsureVisibleHandler((rect) => {
      const topPadding = 118;
      const bottomPadding = 220;
      if (rect.y < topPadding) {
        window.scrollBy({
          top: rect.y - topPadding,
          behavior: 'smooth'
        });
        return;
      }
      const overflowBottom = rect.y + rect.height - (window.innerHeight - bottomPadding);
      if (overflowBottom > 0) {
        window.scrollBy({
          top: overflowBottom,
          behavior: 'smooth'
        });
      }
    });
    return () => {
      tutorialActions.setScreenNavigator(null);
      tutorialActions.setEnsureVisibleHandler(null);
    };
  }, [handleSelectRoute, tutorialActions]);

  const handleStartWalkthrough = useCallback(() => {
    tutorialActions.open('APP_WALKTHROUGH');
  }, [tutorialActions]);

  const handlePauseWalkthrough = useCallback(async () => {
    await desktopSettingsService.updateWalkthrough({
      dismissedAt: new Date().toISOString()
    });
    await reloadDesktopState();
  }, []);

  const handleCompleteWalkthrough = useCallback(async () => {
    await desktopSettingsService.updateWalkthrough({
      completedAt: new Date().toISOString(),
      dismissedAt: null
    });
    await reloadDesktopState();
  }, []);

  const handleSkipWalkthrough = useCallback(async () => {
    await desktopSettingsService.updateWalkthrough({
      completedAt: new Date().toISOString(),
      dismissedAt: null
    });
    await reloadDesktopState();
  }, []);

  const selectedModule = useMemo(() => moduleConfig(activeRoute), [activeRoute]);
  const enabledAddonRouteIds = useMemo(
    () => ADDON_ROUTE_IDS.filter((routeId) => tenantAddonFlags?.[ADDON_FLAG_BY_ROUTE[routeId]] === true),
    [tenantAddonFlags]
  );
  const primaryRoutes = useMemo(() => resolveRoutes(PRIMARY_ROUTES), []);
  const sideRoutes = useMemo(() => resolveRoutes(SIDE_MENU_ROUTES), []);
  const addonRoutes = useMemo(() => resolveRoutes(enabledAddonRouteIds), [enabledAddonRouteIds]);
  const enabledAddonRouteSet = useMemo(() => new Set<AddonRouteId>(enabledAddonRouteIds), [enabledAddonRouteIds]);

  const handleRunSync = async (): Promise<void> => {
    setSyncBusy(true);
    setState((prev) => ({
      ...prev,
      sync: {
        ...prev.sync,
        lastSyncStatus: 'running',
        lastSyncMessage: 'Checking API reachability and sync foundation...'
      }
    }));

    let syncStateApplied = false;
    try {
      const result = state.setupCompleted
        ? await desktopSyncService.runSync(
            state,
            state.setup.deviceId || `${state.setup.branchLabel || 'branch'}-${state.setup.locationLabel || 'location'}`
          )
        : await desktopSyncService.previewOffline();

      const nextSync = {
        lastSyncedAt: result.timestamp,
        lastSyncStatus: result.ok ? 'success' as const : 'error' as const,
        lastSyncMessage: result.message
      };
      setState((prev) => ({
        ...prev,
        sync: {
          ...prev.sync,
          ...nextSync
        }
      }));
      syncStateApplied = true;
      const nextState = await desktopSettingsService.updateSyncState(nextSync);
      setState(nextState);
      await reloadDesktopState();
      await refreshOutboxCount();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete desktop sync.';
      if (!syncStateApplied) {
        setState((prev) => ({
          ...prev,
          sync: {
            ...prev.sync,
            lastSyncedAt: new Date().toISOString(),
            lastSyncStatus: 'error',
            lastSyncMessage: message
          }
        }));
      }
      desktopUi.showToast({ tone: 'error', message });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleRedownloadBranchData = async (): Promise<void> => {
    if (!state.setupCompleted || !state.setup.branchId.trim() || branchDataBusy) {
      return;
    }

    setBranchDataBusy(true);
    try {
      const result = await desktopMasterDataService.syncCatalog(state, state.setup.branchId);
      const nextState: DesktopAppState = {
        ...result.state,
        setupCompleted: true,
        setup: {
          ...result.state.setup,
          branchId: state.setup.branchId,
          branchLabel: state.setup.branchLabel,
          locationId: state.setup.locationId,
          locationLabel: state.setup.locationLabel
        },
        sync: {
          ...result.state.sync,
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
          lastSyncMessage: `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, ${result.lendingCount} lending records, ${result.salesCount} sales, and ${result.transferCount} transfers are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      await refreshOutboxCount();
      await reloadTenantAddonFlags();
      desktopUi.showToast({ tone: 'success', message: 'Branch data refreshed for this device.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to download branch data.'
      });
    } finally {
      setBranchDataBusy(false);
    }
  };

  const handleSwitchCashier = async (): Promise<void> => {
    const nextState = await desktopSessionService.fullSignOut(state, 'switch_cashier');
    setState(nextState);
    setDrawerOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupStage('LOGIN');
    setStartupError(null);
    setStartupMessage('Current cashier signed out. Next cashier can sign in on this device.');
    setStartupMessageTone('info');
    desktopUi.showToast({ tone: 'info', message: 'Current cashier signed out. Next cashier can sign in on this device.' });
  };

  const handleLockSession = (): void => {
    setDrawerOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupError(null);
    if (desktopSessionService.hasPinConfigured(state)) {
      setStartupStage('UNLOCK');
      setStartupMessage('Enter the saved PIN to reopen the app.');
      setStartupMessageTone('info');
      desktopUi.showToast({ tone: 'info', message: 'Session locked. Use PIN or password to sign back in.' });
      return;
    }
    setStartupStage('LOGIN');
    setStartupMessage('Sign in with password to continue.');
    setStartupMessageTone('info');
    desktopUi.showToast({ tone: 'info', message: 'Session locked. Sign in with password to continue.' });
  };

  const handleFullSignOut = async (): Promise<void> => {
    const nextState = await desktopSessionService.fullSignOut(state, 'full_sign_out');
    setState(nextState);
    setDrawerOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupStage('LOGIN');
    setStartupError(null);
    setStartupMessage('Session and PIN unlock were removed from this device.');
    setStartupMessageTone('info');
    desktopUi.showToast({ tone: 'info', message: 'Session and PIN unlock were removed from this device.' });
  };

  const handleResetLocalData = useCallback(async () => {
    await desktopSettingsService.resetLocalData();
    tutorialActions.close();
    autoWalkthroughOpenedRef.current = false;
    setState(DEFAULT_DESKTOP_APP_STATE);
    setPendingOutboxCount(0);
    setDrawerOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setSyncBusy(false);
    setBranchDataBusy(false);
    setStartupBusy(false);
    setStartupError(null);
    setTenantAddonFlags(null);
    setStartupStage('LOGIN');
    setStartupMessage('Local desktop data was cleared. Sign in and download branch data again.');
    setStartupMessageTone('success');
    desktopUi.showToast({ tone: 'success', message: 'Local desktop data was cleared from this device.' });
  }, [tutorialActions]);

  const handleStartupLogin = async (
    input: DesktopAppState['setup'] & { password: string; pin: string }
  ): Promise<void> => {
    if (!input.apiBaseUrl.trim() || !input.authEmail.trim() || !input.password.trim() || !input.deviceId.trim()) {
      setStartupError('API URL, email, password, and device ID are required.');
      return;
    }
    setStartupBusy(true);
    setStartupError(null);
    setStartupMessage('Signing in...');
    setStartupMessageTone('info');
    try {
      const baseState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          operatorName: input.operatorName,
          clientId: input.clientId,
          authEmail: input.authEmail,
          deviceId: input.deviceId,
          branchId: input.branchId,
          branchLabel: input.branchLabel,
          locationId: input.locationId,
          locationLabel: input.locationLabel,
          apiBaseUrl: input.apiBaseUrl,
          printerMode: input.printerMode,
          printerName: input.printerName,
          printerHost: input.printerHost,
          printerPort: input.printerPort
        }
      };
      const session = await desktopAuthService.login(
        input.apiBaseUrl,
        input.authEmail,
        input.password,
        input.clientId,
        input.deviceId
      );
      const cached = await desktopSessionService.cacheSession(baseState, {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        userEmail: input.authEmail,
        pin: input.pin
      });
      const nextState: DesktopAppState = {
        ...cached,
        setup: {
          ...cached.setup,
          clientId: session.clientId || cached.setup.clientId
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      setStartupStage('SETUP');
      setStartupMessage('Signed in. Next step: choose branch and location, then download branch data.');
      setStartupMessageTone('info');
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Desktop sign-in failed.');
    } finally {
      setStartupBusy(false);
    }
  };

  const handleStartupUnlock = async (pin: string): Promise<void> => {
    if (!pin.trim()) {
      setStartupError('PIN is required.');
      return;
    }
    setStartupBusy(true);
    setStartupError(null);
    setStartupMessage('Unlocking...');
    setStartupMessageTone('info');
    try {
      const unlocked = await desktopSessionService.unlock(state, pin);
      if (!unlocked) {
        setStartupError('Invalid PIN.');
        setStartupStage('UNLOCK');
        return;
      }
      let unlockedState = state;
      try {
        const refreshed = await desktopAuthService.refreshSession(state);
        setState(refreshed);
        unlockedState = refreshed;
      } catch {
        // Offline unlock should still continue with the cached session.
      }
      setStartupStage(unlockedState.setupCompleted ? 'READY' : 'SETUP');
      setStartupMessage(
        unlockedState.setupCompleted
          ? 'App unlocked.'
          : 'Unlocked. Finish branch setup and download local data before continuing.'
      );
      setStartupMessageTone('info');
    } finally {
      setStartupBusy(false);
    }
  };

  const handleStartupDownloadSetup = async (setup: DesktopAppState['setup']): Promise<void> => {
    if (!setup.branchId.trim() || !setup.locationId.trim()) {
      setStartupError('Choose both branch and location before downloading branch data.');
      return;
    }
    setStartupBusy(true);
    setStartupError(null);
    setStartupMessage('Downloading products, customers, and lending data...');
    setStartupMessageTone('info');
    try {
      const workingState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          ...setup
        }
      };
      const result = await desktopMasterDataService.syncCatalog(workingState, setup.branchId);
      const nextState: DesktopAppState = {
        ...result.state,
        setupCompleted: true,
        setup: {
          ...result.state.setup,
          ...setup
        },
        sync: {
          ...result.state.sync,
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
          lastSyncMessage: `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, ${result.lendingCount} lending records, ${result.salesCount} sales, and ${result.transferCount} transfers are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      setStartupStage('READY');
      setStartupMessage('Setup complete. The app is ready.');
      setStartupMessageTone('info');
      await refreshOutboxCount();
      await reloadTenantAddonFlags();
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Unable to download branch data.');
    } finally {
      setStartupBusy(false);
    }
  };

  const handleQuickSetup = async (input: {
    token: string;
    pin: string;
    apiBaseUrl: string;
    deviceId: string;
    operatorName: string;
  }): Promise<void> => {
    if (!input.apiBaseUrl.trim() || !input.deviceId.trim()) {
      setStartupError('API URL and device ID are required before QR quick setup.');
      return;
    }
    setStartupBusy(true);
    setStartupError(null);
    setStartupMessage('Claiming setup token and downloading branch data...');
    setStartupMessageTone('info');
    try {
      const claimed = await desktopAuthService.claimEnrollment(input.apiBaseUrl, input.token, input.deviceId);
      const baseState: DesktopAppState = {
        ...state,
        setup: {
          ...state.setup,
          apiBaseUrl: input.apiBaseUrl,
          deviceId: input.deviceId,
          operatorName: input.operatorName || state.setup.operatorName,
          clientId: claimed.client_id,
          authEmail: claimed.user_email,
          branchId: claimed.branch_id,
          branchLabel: claimed.branch_name,
          locationId: claimed.location_id,
          locationLabel: claimed.location_name
        }
      };
      const cached = await desktopSessionService.cacheSession(baseState, {
        accessToken: claimed.access_token,
        refreshToken: claimed.refresh_token,
        userEmail: claimed.user_email,
        userFullName: claimed.user_full_name,
        pin: input.pin
      });
      const result = await desktopMasterDataService.syncCatalog(cached, claimed.branch_id);
      const nextState: DesktopAppState = {
        ...result.state,
        setupCompleted: true,
        setup: {
          ...result.state.setup,
          operatorName: input.operatorName || result.state.setup.operatorName,
          apiBaseUrl: input.apiBaseUrl,
          deviceId: input.deviceId,
          clientId: claimed.client_id,
          authEmail: claimed.user_email,
          branchId: claimed.branch_id,
          branchLabel: claimed.branch_name,
          locationId: claimed.location_id,
          locationLabel: claimed.location_name
        },
        sync: {
          ...result.state.sync,
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
          lastSyncMessage: `Quick setup complete. ${result.productCount} products, ${result.customerCount} customers, ${result.lendingCount} lending records, ${result.salesCount} sales, and ${result.transferCount} transfers are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      setStartupStage('READY');
      setStartupMessage(`Quick setup complete. Signed in as ${claimed.user_full_name}.`);
      setStartupMessageTone('info');
      await refreshOutboxCount();
      await reloadTenantAddonFlags();
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Desktop quick setup failed.');
    } finally {
      setStartupBusy(false);
    }
  };

  let content: JSX.Element;
  if (activeRoute === 'dashboard') {
    content = (
        <DashboardScreen
          state={state}
          pendingOutboxCount={pendingOutboxCount}
          onRunSync={handleRunSync}
          syncBusy={syncBusy}
          onOpenReports={() => handleSelectRoute('reports')}
          onStartWalkthrough={handleStartWalkthrough}
        />
      );
  } else if (activeRoute === 'pos') {
    content = (
      <PosScreen
        appState={state}
        onOutboxChanged={refreshOutboxCount}
        reopenedSale={reopenSaleDraft?.sale ?? null}
        reopenedSaleMode={reopenSaleDraft?.mode ?? 'copy'}
        reopenedSaleNonce={reopenSaleNonce}
        onConsumeReopenedSale={() => setReopenSaleDraft(null)}
        quickAddProductId={quickAddProductId}
        quickAddNonce={quickAddNonce}
        onGoToShift={() => handleSelectRoute('shift')}
      />
    );
  } else if (activeRoute === 'expense') {
    content = <ExpenseScreen appState={state} onOutboxChanged={refreshOutboxCount} />;
  } else if (activeRoute === 'reports') {
    content = (
      <CashierReportsScreen
        appState={state}
        onStateUpdate={setState}
      />
    );
  } else if (activeRoute === 'items') {
    content = (
      <ItemsScreen
        appState={state}
        onOpenLpgService={(productId) => {
          setLpgFocusProductId(productId);
          setLpgFocusNonce((value) => value + 1);
          handleSelectRoute('lpg-service');
        }}
      />
    );
  } else if (activeRoute === 'customers') {
    content = (
      <CustomersScreen
        appState={state}
        onReopenSale={(sale) => {
          setReopenSaleDraft({ sale, mode: 'copy' });
          setReopenSaleNonce((value) => value + 1);
          handleSelectRoute('pos');
        }}
      />
    );
  } else if (activeRoute === 'sales') {
    content = (
      <SalesScreen
        appState={state}
        onOutboxChanged={refreshOutboxCount}
        requestedSaleId={pendingSalesDetailId}
        requestedSaleNonce={pendingSalesDetailNonce}
        onConsumeRequestedSale={() => setPendingSalesDetailId(null)}
        onReopenSale={(sale, mode) => {
          setReopenSaleDraft({ sale, mode });
          setReopenSaleNonce((value) => value + 1);
          handleSelectRoute('pos');
        }}
      />
    );
  } else if (activeRoute === 'lending') {
    content = <LendingScreen appState={state} onStateReload={reloadDesktopState} />;
  } else if (activeRoute === 'lpg-service') {
    content = (
      <LpgServiceScreen
        appState={state}
        focusProductId={lpgFocusProductId}
        focusNonce={lpgFocusNonce}
        onOpenItems={(productId) => {
          setLpgFocusProductId(productId);
          handleSelectRoute('items');
        }}
      />
    );
  } else if (activeRoute === 'transfer') {
    content = <TransferScreen appState={state} onOutboxChanged={refreshOutboxCount} />;
  } else if (activeRoute === 'transfer-list') {
    content = <TransferHistoryScreen />;
  } else if (activeRoute === 'shift') {
    content = <ShiftScreen appState={state} onOutboxChanged={refreshOutboxCount} />;
  } else if (activeRoute === 'settings') {
    content = (
      <SettingsScreen
        state={state}
        onStateReload={async () => {
          await reloadDesktopState();
        }}
        onStartWalkthrough={handleStartWalkthrough}
        onResetLocalData={handleResetLocalData}
      />
    );
  } else if (activeRoute === 'purchase-orders') {
    content =
      enabledAddonRouteSet.has('purchase-orders') ? (
        <PurchaseOrdersScreen appState={state} onOutboxChanged={refreshOutboxCount} />
      ) : (
        <ModulePlaceholderScreen
          routeId={activeRoute}
          title={unavailableAddonConfig('purchase-orders').title}
          description={unavailableAddonConfig('purchase-orders').description}
          bullets={unavailableAddonConfig('purchase-orders').bullets}
        />
      );
  } else if (activeRoute === 'delivery-dispatch') {
    content =
      enabledAddonRouteSet.has('delivery-dispatch') ? (
        <DeliveryDispatchScreen appState={state} onOutboxChanged={refreshOutboxCount} />
      ) : (
        <ModulePlaceholderScreen
          routeId={activeRoute}
          title={unavailableAddonConfig('delivery-dispatch').title}
          description={unavailableAddonConfig('delivery-dispatch').description}
          bullets={unavailableAddonConfig('delivery-dispatch').bullets}
        />
      );
  } else {
    content = (
      <ModulePlaceholderScreen
        routeId={activeRoute}
        title={selectedModule.title}
        description={selectedModule.description}
        bullets={selectedModule.bullets}
      />
    );
  }

  if (booting) {
    return (
      <div className="app-loading-shell startup-enter-shell">
        <div className="startup-ambient-orb startup-ambient-orb-a" aria-hidden="true" />
        <div className="startup-ambient-orb startup-ambient-orb-b" aria-hidden="true" />
        <BrandLogo title="VPOS Desktop" subtitle="Preparing your workstation" compact />
        <h1>Loading VPOS Desktop...</h1>
        <p>Preparing the desktop shell and local device state.</p>
        <div className="startup-loading-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }

  if (startupStage !== 'READY') {
    return (
      <DesktopStartupScreen
        state={state}
        stage={startupStage}
        busy={startupBusy}
        message={startupMessage}
        messageTone={startupMessageTone}
        error={startupError}
        hasPinConfigured={desktopSessionService.hasPinConfigured(state)}
        onLogin={handleStartupLogin}
        onUnlock={handleStartupUnlock}
        onDownloadSetup={handleStartupDownloadSetup}
        onQuickSetup={handleQuickSetup}
        onSwitchToLogin={() => {
          setStartupStage('LOGIN');
          setStartupError(null);
          setStartupMessage('Sign in with password or use QR quick setup, then download branch data.');
          setStartupMessageTone('info');
        }}
        onSwitchToPin={() => {
          setStartupStage('UNLOCK');
          setStartupError(null);
          setStartupMessage('Enter the saved PIN to reopen the app.');
          setStartupMessageTone('info');
        }}
      />
    );
  }

  const sidebarMode = isWide ? 'rail' : 'drawer';
  const brandSubtitle = state.setupCompleted
    ? `${state.setup.branchLabel} / ${state.setup.locationLabel}`
    : 'Setup pending';
  const containerWidth = WORKSPACE_ROUTES.has(activeRoute) ? 'wide' : 'standard';

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]">
      <Sidebar
        primaryRoutes={primaryRoutes}
        secondaryRoutes={sideRoutes}
        addonRoutes={addonRoutes}
        activeRoute={activeRoute}
        mode={sidebarMode}
        open={drawerOpen}
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((value) => !value)}
        onSelect={handleSelectRoute}
        onClose={() => setDrawerOpen(false)}
        setupCompleted={state.setupCompleted}
        syncBusy={syncBusy}
        syncNeedsAttention={state.sync.lastSyncStatus === 'error'}
        branchDataBusy={branchDataBusy}
        pendingOutboxCount={pendingOutboxCount}
        lastSyncedAt={state.sync.lastSyncedAt}
        onSyncNow={() => {
          void handleRunSync();
        }}
        onDownloadBranchData={() => {
          void handleRedownloadBranchData();
        }}
        brandSubtitle={brandSubtitle}
      />
      <main className="flex min-w-0 flex-col">
        <TopBar
          state={state}
          activeRoute={activeRoute}
          onOpenMenu={() => setDrawerOpen(true)}
          pendingOutboxCount={pendingOutboxCount}
          syncBusy={syncBusy}
          onRunSync={() => {
            void handleRunSync();
          }}
          onOpenRoute={handleSelectRoute}
          onSwitchCashier={() => {
            void handleSwitchCashier();
          }}
          onLockSession={handleLockSession}
          onFullSignOut={() => {
            void handleFullSignOut();
          }}
          compact={shellScrolled}
          showMenuButton={!isWide}
        />
        <div className="flex flex-1 flex-col py-gutter-y pb-[var(--bottomdock-height)] md:pb-gutter-y">
          <DesktopContainer width={containerWidth}>
            <div className="desktop-shell-stack">{content}</div>
          </DesktopContainer>
        </div>
        <div className="fixed bottom-[var(--bottomdock-offset)] left-gutter-x right-gutter-x z-rail flex gap-2 overflow-x-auto rounded-xl border border-border-soft bg-surface-strong p-2 shadow-strong backdrop-blur-[14px] md:hidden">
          {primaryRoutes.map((route) => (
            <button
              key={route.id}
              className={[
                'relative grid min-h-[68px] min-w-0 flex-1 justify-items-center gap-1 rounded-lg bg-transparent px-3 py-3 text-center transition-all',
                route.id === activeRoute
                  ? 'translate-y-[-4px] scale-[1.01] bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-[#f4f8ff] shadow-strong'
                  : 'text-text hover:bg-accent-soft'
              ].join(' ')}
              type="button"
              onClick={() => handleSelectRoute(route.id)}
            >
              <div
                className={[
                  'grid h-[34px] w-[34px] place-items-center rounded-sm text-base transition-all',
                  route.id === activeRoute
                    ? 'bg-white/20 text-[#f4f8ff]'
                    : 'bg-accent-soft'
                ].join(' ')}
              >
                {route.icon}
              </div>
              <span className="text-sm font-extrabold">{route.label}</span>
              <small className={route.id === activeRoute ? 'text-xs text-white/85' : 'text-xs text-muted'}>
                {route.hint}
              </small>
            </button>
          ))}
        </div>
      </main>
      <DesktopTutorialOverlayHost
        onPauseScope={() => void handlePauseWalkthrough()}
        onCompleteScope={() => void handleCompleteWalkthrough()}
        onSkipScope={() => void handleSkipWalkthrough()}
      />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <DesktopUiProvider>
      <DesktopTutorialProvider>
        <DesktopAppShell />
      </DesktopTutorialProvider>
    </DesktopUiProvider>
  );
}
