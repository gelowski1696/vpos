import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sileo } from 'sileo';
import { DESKTOP_ROUTES, type DesktopRouteId } from './routes';
import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { BrandLogo } from '../components/layout/BrandLogo';
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
import { DesktopUiProvider } from '../components/feedback/DesktopUiFeedback';
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
const SIDE_MENU_ROUTES: DesktopRouteId[] = ['lending', 'lpg-service', 'expense', 'items', 'customers', 'shift', 'settings'];

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
        description: 'Sales history, item returns, and cancel-and-recreate flow.',
        bullets: ['Sales list and detail', 'Cancel sale', 'Return item', 'Cancel and recreate sale']
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

function DesktopAppShell(): JSX.Element {
  const tutorialActions = useDesktopTutorialActions();
  const tutorialState = useDesktopTutorialState();
  const [state, setState] = useState<DesktopAppState>(DEFAULT_DESKTOP_APP_STATE);
  const [activeRoute, setActiveRoute] = useState<DesktopRouteId>('dashboard');
  const [lastPrimaryRoute, setLastPrimaryRoute] = useState<DesktopRouteId>('dashboard');
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
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
  const [reopenSaleDraft, setReopenSaleDraft] = useState<{ sale: DesktopSaleRecord; mode: 'copy' | 'recreate' } | null>(null);
  const [reopenSaleNonce, setReopenSaleNonce] = useState(0);
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

  const reloadDesktopState = async (): Promise<void> => {
    const [next, outbox] = await Promise.all([desktopSettingsService.getState(), desktopDb.listOutboxItems()]);
    setState(next);
    setPendingOutboxCount(outbox.filter((row) => row.status === 'pending' || row.status === 'failed').length);
  };

  const refreshOutboxCount = async (): Promise<void> => {
    const rows = await desktopDb.listOutboxItems();
    setPendingOutboxCount(rows.filter((row) => row.status === 'pending' || row.status === 'failed').length);
  };

  useEffect(() => {
    void playDesktopStartupCueOnce();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [loadedState, outbox] = await Promise.all([desktopSettingsService.getState(), desktopDb.listOutboxItems()]);
      const boot = await desktopSessionService.bootstrap(loadedState);
      if (!active) {
        return;
      }
      setState(boot.state);
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
  const primaryRoutes = useMemo(
    () =>
      PRIMARY_ROUTES.map((routeId) => DESKTOP_ROUTES.find((route) => route.id === routeId)).filter(
        (route): route is (typeof DESKTOP_ROUTES)[number] => Boolean(route)
      ),
    []
  );
  const sideRoutes = useMemo(
    () =>
      SIDE_MENU_ROUTES.map((routeId) => DESKTOP_ROUTES.find((route) => route.id === routeId)).filter(
        (route): route is (typeof DESKTOP_ROUTES)[number] => Boolean(route)
      ),
    []
  );

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
    const nextState = await desktopSettingsService.updateSyncState(nextSync);
    setState(nextState);
    await reloadDesktopState();
    await refreshOutboxCount();
    setSyncBusy(false);
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
          lastSyncedAt: result.syncedAt,
          lastSyncStatus: 'success',
          lastSyncMessage: `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, ${result.lendingCount} lending records, ${result.salesCount} sales, and ${result.transferCount} transfers are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      await refreshOutboxCount();
      sileo.success({
        description: 'Branch data refreshed for this device.'
      });
    } catch (error) {
      sileo.error({
        description: error instanceof Error ? error.message : 'Unable to download branch data.'
      });
    } finally {
      setBranchDataBusy(false);
    }
  };

  const handleSwitchCashier = async (): Promise<void> => {
    const nextState = await desktopSessionService.clearSession(state, { clearPin: true });
    setState(nextState);
    setSideMenuOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupStage('LOGIN');
    setStartupError(null);
    setStartupMessage('Current cashier signed out. Next cashier can sign in on this device.');
    setStartupMessageTone('info');
    sileo.info({
      description: 'Current cashier signed out. Next cashier can sign in on this device.'
    });
  };

  const handleLockSession = (): void => {
    setSideMenuOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupError(null);
    if (desktopSessionService.hasPinConfigured(state)) {
      setStartupStage('UNLOCK');
      setStartupMessage('Enter the saved PIN to reopen the app.');
      setStartupMessageTone('info');
      sileo.info({
        description: 'Session locked. Use PIN or password to sign back in.'
      });
      return;
    }
    setStartupStage('LOGIN');
    setStartupMessage('Sign in with password to continue.');
    setStartupMessageTone('info');
    sileo.info({
      description: 'Session locked. Sign in with password to continue.'
    });
  };

  const handleFullSignOut = async (): Promise<void> => {
    const nextState = await desktopSessionService.clearSession(state, { clearPin: true });
    setState(nextState);
    setSideMenuOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setStartupStage('LOGIN');
    setStartupError(null);
    setStartupMessage('Session and PIN unlock were removed from this device.');
    setStartupMessageTone('info');
    sileo.info({
      description: 'Session and PIN unlock were removed from this device.'
    });
  };

  const handleResetLocalData = useCallback(async () => {
    await desktopSettingsService.resetLocalData();
    tutorialActions.close();
    autoWalkthroughOpenedRef.current = false;
    setState(DEFAULT_DESKTOP_APP_STATE);
    setPendingOutboxCount(0);
    setSideMenuOpen(false);
    setActiveRoute('dashboard');
    setLastPrimaryRoute('dashboard');
    setSyncBusy(false);
    setBranchDataBusy(false);
    setStartupBusy(false);
    setStartupError(null);
    setStartupStage('LOGIN');
    setStartupMessage('Local desktop data was cleared. Sign in and download branch data again.');
    setStartupMessageTone('success');
    sileo.success({
      description: 'Local desktop data was cleared from this device.'
    });
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
        quickAddProductId={quickAddProductId}
        quickAddNonce={quickAddNonce}
        onGoToShift={() => handleSelectRoute('shift')}
      />
    );
  } else if (activeRoute === 'expense') {
    content = <ExpenseScreen appState={state} onOutboxChanged={refreshOutboxCount} />;
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

  return (
    <div className="grid min-h-screen grid-cols-1">
      <Sidebar
        routes={sideRoutes}
        open={sideMenuOpen}
        activeRoute={activeRoute}
        onSelect={handleSelectRoute}
        onClose={() => setSideMenuOpen(false)}
        setupCompleted={state.setupCompleted}
        syncBusy={syncBusy}
        branchDataBusy={branchDataBusy}
        onBackToMainTabs={() => {
          handleSelectRoute(lastPrimaryRoute);
          setSideMenuOpen(false);
        }}
        onSyncNow={() => {
          void handleRunSync();
        }}
        onDownloadBranchData={() => {
          void handleRedownloadBranchData();
        }}
        onSwitchCashier={() => {
          void handleSwitchCashier();
        }}
        onLockSession={handleLockSession}
        onFullSignOut={() => {
          void handleFullSignOut();
        }}
      />
      <main className="flex flex-col gap-2.5 px-[18px] pb-[18px] pt-[14px]">
        <TopBar
          state={state}
          activeRoute={activeRoute}
          onOpenMenu={() => setSideMenuOpen(true)}
          pendingOutboxCount={pendingOutboxCount}
          syncBusy={syncBusy}
          onRunSync={() => {
            void handleRunSync();
          }}
          onOpenRoute={handleSelectRoute}
          compact={shellScrolled}
        />
        <div className="flex flex-col gap-[18px] scroll-pb-24 pb-[92px]">{content}</div>
        <div className="fixed bottom-[10px] left-[18px] right-[18px] z-40 flex gap-2 overflow-x-auto rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] p-2 shadow-[0_20px_34px_rgba(17,40,58,0.14)] backdrop-blur-[14px]">
          {primaryRoutes.map((route) => (
            <button
              key={route.id}
              className={[
                'relative grid min-h-[68px] min-w-0 flex-1 justify-items-center gap-1 rounded-[22px] bg-transparent px-3 py-3 text-center transition-all',
                route.id === activeRoute
                  ? 'translate-y-[-4px] scale-[1.01] bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-[#f4f8ff] shadow-[0_14px_26px_rgba(25,118,210,0.24)]'
                  : 'text-[var(--text)] hover:bg-[rgba(229,238,246,0.88)]'
              ].join(' ')}
              type="button"
              onClick={() => handleSelectRoute(route.id)}
            >
              <div
                className={[
                  'grid h-[34px] w-[34px] place-items-center rounded-[12px] text-[0.98rem] transition-all',
                  route.id === activeRoute
                    ? 'bg-[rgba(255,255,255,0.2)] text-[#f4f8ff]'
                    : 'bg-[var(--accent-soft)]'
                ].join(' ')}
              >
                {route.icon}
              </div>
              <span className="text-[0.96rem] font-extrabold">{route.label}</span>
              <small className={route.id === activeRoute ? 'text-[0.74rem] leading-[1.25] text-[rgba(255,255,255,0.82)]' : 'text-[0.74rem] leading-[1.25] text-[var(--muted)]'}>
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

