import { useEffect, useMemo, useState } from 'react';
import { DESKTOP_ROUTES, type DesktopRouteId } from './routes';
import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ModulePlaceholderScreen } from '../screens/ModulePlaceholderScreen';
import { PosScreen } from '../screens/PosScreen';
import { SalesScreen } from '../screens/SalesScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { LendingScreen } from '../screens/LendingScreen';
import { DesktopStartupScreen } from '../screens/DesktopStartupScreen';
import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState, type DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopSessionService, type DesktopStartupStage } from '../services/desktop-session.service';
import { desktopSettingsService } from '../services/desktop-settings.service';
import { desktopSyncService } from '../services/desktop-sync.service';

function moduleConfig(route: DesktopRouteId): { title: string; description: string; bullets: string[] } {
  switch (route) {
    case 'customers':
      return {
        title: 'Customers',
        description: 'Desktop customer lookup will focus on quick search, balances, points, and recent activity.',
        bullets: [
          'Customer search and detail drawer',
          'Points and balance view',
          'Recent sales, lending, and payments',
          'Card and loyalty read-only support'
        ]
      };
    case 'sales':
      return {
        title: 'Sales',
        description: 'Desktop sales history will support the same correction flows already available on mobile.',
        bullets: ['Sales list and detail', 'Cancel sale', 'Return item', 'Cancel and recreate sale']
      };
    case 'lending':
      return {
        title: 'Lending',
        description: 'Desktop lending will reuse the same business rules as the mobile app with denser record tables.',
        bullets: ['Create lending from completed sales', 'View open and partial records', 'Record returns', 'Offline queue and sync reconciliation']
      };
    case 'loyalty':
      return {
        title: 'Loyalty',
        description: 'Desktop loyalty will keep cashier-facing visibility lightweight while preserving the current reward rules.',
        bullets: ['Points lookup', 'Reward visibility', 'Reward redemption history', 'Support for receipt-side point summaries']
      };
    case 'lpg-service':
      return {
        title: 'LPG Service',
        description: 'Desktop LPG service will surface disposed, junked, and replaced item records in a branch-friendly layout.',
        bullets: ['Disposed records and service history', 'Readable branch-focused filters', 'Offline-safe service action queue', 'Cross-link to related sales and notes']
      };
    case 'settings':
      return {
        title: 'Settings',
        description: 'Desktop setup and device options live here so each branch workstation can be configured quickly.',
        bullets: ['Branch and location setup', 'Printer configuration', 'API and sync configuration', 'Later: updater and advanced device settings']
      };
    case 'dashboard':
    case 'pos':
    default:
      return {
        title: 'Dashboard',
        description: 'Branch overview and sync health.',
        bullets: []
      };
  }
}

export function App(): JSX.Element {
  const [state, setState] = useState<DesktopAppState>(DEFAULT_DESKTOP_APP_STATE);
  const [activeRoute, setActiveRoute] = useState<DesktopRouteId>('dashboard');
  const [booting, setBooting] = useState(true);
  const [startupStage, setStartupStage] = useState<DesktopStartupStage>('LOGIN');
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupMessage, setStartupMessage] = useState(
    'Sign in with password or use QR quick setup, then download branch data before opening the workstation.'
  );
  const [startupError, setStartupError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [reopenSaleDraft, setReopenSaleDraft] = useState<{ sale: DesktopSaleRecord; mode: 'copy' | 'recreate' } | null>(null);
  const [reopenSaleNonce, setReopenSaleNonce] = useState(0);

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
          ? 'Choose the branch and location for this desktop, then download the local branch data.'
          : boot.stage === 'UNLOCK'
            ? 'Enter the saved device PIN to reopen this workstation.'
            : 'Sign in with password or use QR quick setup, then download branch data before opening the workstation.'
      );
      setBooting(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedModule = useMemo(() => moduleConfig(activeRoute), [activeRoute]);

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

  const handleQueueDemoItem = async (): Promise<void> => {
    const now = new Date().toISOString();
    await desktopDb.enqueueOutboxItem({
      id: `desktop-demo-${Date.now()}`,
      entity: 'desktop_setup',
      action: 'demo_queue',
      payload: {
        branch: state.setup.branchLabel || 'Unassigned Branch',
        location: state.setup.locationLabel || 'Unassigned Location',
        queued_at: now
      },
      idempotency_key: `desktop-demo:${Date.now()}`,
      created_at: now
    });
    await refreshOutboxCount();
    setState((prev) => ({
      ...prev,
      sync: {
        ...prev.sync,
        lastSyncStatus: 'idle',
        lastSyncMessage: 'Queued a sample desktop outbox item. You can now test sync against the real local outbox table.'
      }
    }));
  };

  const handleStartupLogin = async (
    input: DesktopAppState['setup'] & { password: string; pin: string }
  ): Promise<void> => {
    if (!input.apiBaseUrl.trim() || !input.clientId.trim() || !input.authEmail.trim() || !input.password.trim() || !input.deviceId.trim()) {
      setStartupError('API URL, client ID, email, password, and device ID are required.');
      return;
    }
    setStartupBusy(true);
    setStartupError(null);
    setStartupMessage('Signing in this desktop workstation...');
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
      setState(cached);
      setStartupStage('SETUP');
      setStartupMessage('Signed in. Next step: choose branch and location, then download branch data.');
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
    setStartupMessage('Unlocking this workstation...');
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
          ? 'Workstation unlocked.'
          : 'Unlocked. Finish branch setup and download local data before continuing.'
      );
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
    setStartupMessage('Downloading products, customers, and lending data for this desktop...');
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
          lastSyncMessage: `Branch data refreshed. ${result.productCount} products, ${result.customerCount} customers, and ${result.lendingCount} lending records are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      setStartupStage('READY');
      setStartupMessage('Desktop setup complete. The workstation is ready.');
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
          lastSyncMessage: `Quick setup complete. ${result.productCount} products, ${result.customerCount} customers, and ${result.lendingCount} lending records are cached locally.`
        }
      };
      await desktopSettingsService.saveState(nextState);
      setState(nextState);
      setStartupStage('READY');
      setStartupMessage(`Quick setup complete. Signed in as ${claimed.user_full_name}.`);
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
        onQueueDemoItem={handleQueueDemoItem}
        syncBusy={syncBusy}
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
      />
    );
  } else if (activeRoute === 'customers') {
    content = (
      <CustomersScreen
        onReopenSale={(sale) => {
          setReopenSaleDraft({ sale, mode: 'copy' });
          setReopenSaleNonce((value) => value + 1);
          setActiveRoute('pos');
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
          setActiveRoute('pos');
        }}
      />
    );
  } else if (activeRoute === 'lending') {
    content = <LendingScreen appState={state} onStateReload={reloadDesktopState} />;
  } else if (activeRoute === 'settings') {
    content = (
      <SettingsScreen
        state={state}
        onStateReload={async () => {
          await reloadDesktopState();
        }}
      />
    );
  } else {
    content = (
      <ModulePlaceholderScreen
        title={selectedModule.title}
        description={selectedModule.description}
        bullets={selectedModule.bullets}
      />
    );
  }

  if (booting) {
    return (
      <div className="app-loading-shell">
        <div className="brand-mark">VP</div>
        <h1>Loading VPOS Desktop...</h1>
        <p>Preparing the desktop shell and local device state.</p>
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
        }}
        onSwitchToPin={() => {
          setStartupStage('UNLOCK');
          setStartupError(null);
          setStartupMessage('Enter the saved device PIN to reopen this workstation.');
        }}
      />
    );
  }

  return (
    <div className="desktop-root">
      <Sidebar
        routes={DESKTOP_ROUTES}
        activeRoute={activeRoute}
        onSelect={setActiveRoute}
        setupCompleted={state.setupCompleted}
      />
      <main className="desktop-main">
        <TopBar state={state} />
        <div className="content-area">{content}</div>
      </main>
    </div>
  );
}
