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
import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState, type DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
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
    void Promise.all([desktopSettingsService.getState(), desktopDb.listOutboxItems()]).then(([next, outbox]) => {
      if (!active) {
        return;
      }
      setState(next);
      setPendingOutboxCount(outbox.filter((row) => row.status === 'pending' || row.status === 'failed').length);
      setBooting(false);
    });
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
