import { useEffect, type ReactNode } from 'react';
import type { DesktopRoute, DesktopRouteId } from '../../app/routes';
import logoSrc from '../../assets/vpos-logo.png';

type SidebarMode = 'rail' | 'drawer';

type Props = {
  primaryRoutes: DesktopRoute[];
  secondaryRoutes: DesktopRoute[];
  addonRoutes?: DesktopRoute[];
  activeRoute: DesktopRouteId;
  mode: SidebarMode;
  open: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (route: DesktopRouteId) => void;
  onClose: () => void;
  setupCompleted: boolean;
  syncBusy: boolean;
  syncNeedsAttention?: boolean;
  branchDataBusy: boolean;
  pendingOutboxCount: number;
  lastSyncedAt: string | null;
  onSyncNow: () => void;
  onDownloadBranchData: () => void;
  brandTitle?: string;
  brandSubtitle?: string;
};

type NavGroup = {
  label: string;
  routes: DesktopRoute[];
};

function SvgIcon({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className ?? 'h-[18px] w-[18px]'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function ChevronDoubleIcon({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <SvgIcon className="h-[16px] w-[16px]">
      {collapsed ? (
        <>
          <path d="m6.5 6 4 4-4 4" />
          <path d="m10.5 6 4 4-4 4" />
        </>
      ) : (
        <>
          <path d="m13.5 6-4 4 4 4" />
          <path d="m9.5 6-4 4 4 4" />
        </>
      )}
    </SvgIcon>
  );
}

function SyncIcon({ spinning = false }: { spinning?: boolean }): JSX.Element {
  return (
    <SvgIcon className={`h-[17px] w-[17px] ${spinning ? 'animate-spin' : ''}`}>
      <path d="M16.2 10a6.2 6.2 0 0 1-10.6 4.4" />
      <path d="M3.8 10a6.2 6.2 0 0 1 10.6-4.4" />
      <path d="M13.5 3.8h2.8v2.8" />
      <path d="M6.5 16.2H3.7v-2.8" />
    </SvgIcon>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M10 3.8v8.5" />
      <path d="m6.7 9.8 3.3 3.5 3.3-3.5" />
      <path d="M4.8 16h10.4" />
    </SvgIcon>
  );
}

function routeIcon(routeId: DesktopRouteId): JSX.Element {
  switch (routeId) {
    case 'dashboard':
      return (
        <SvgIcon>
          <path d="M4.8 9.2 10 4.8l5.2 4.4" />
          <path d="M6 8.2v7h8v-7" />
        </SvgIcon>
      );
    case 'pos':
      return (
        <SvgIcon>
          <rect x="4.6" y="4.7" width="10.8" height="10.6" rx="2" />
          <path d="M7 13h6" />
          <path d="M7 10h6" />
        </SvgIcon>
      );
    case 'sales':
      return (
        <SvgIcon>
          <path d="M6 4.8h8l1.2 1.2v9.2H4.8V6z" />
          <path d="M7.2 8.3h5.6" />
          <path d="M7.2 11h5.6" />
        </SvgIcon>
      );
    case 'transfer':
      return (
        <SvgIcon>
          <path d="M4.5 7.4h11" />
          <path d="m12.6 4.8 2.8 2.6-2.8 2.6" />
          <path d="M15.5 12.6H4.5" />
          <path d="m7.4 15.2-2.8-2.6 2.8-2.6" />
        </SvgIcon>
      );
    case 'transfer-list':
      return (
        <SvgIcon>
          <circle cx="10" cy="10" r="5.6" />
          <path d="M10 6.8V10l2.2 1.8" />
        </SvgIcon>
      );
    case 'reports':
      return (
        <SvgIcon>
          <path d="M5 15.2V9.8" />
          <path d="M9 15.2V6.5" />
          <path d="M13 15.2v-3.8" />
          <path d="M4.5 15.2h11" />
        </SvgIcon>
      );
    case 'expense':
      return (
        <SvgIcon>
          <path d="M6 5.2h5.8a2.5 2.5 0 0 1 0 5H7.6a2.3 2.3 0 0 0 0 4.6H14" />
          <path d="M10 4v12" />
        </SvgIcon>
      );
    case 'items':
      return (
        <SvgIcon>
          <path d="m10 4.6 5 2.7v5.4L10 15.4l-5-2.7V7.3Z" />
          <path d="m5 7.3 5 2.7 5-2.7" />
          <path d="M10 10v5.4" />
        </SvgIcon>
      );
    case 'customers':
      return (
        <SvgIcon>
          <circle cx="8" cy="7.2" r="2.4" />
          <path d="M3.8 15.2a4.4 4.4 0 0 1 8.4 0" />
          <circle cx="13.3" cy="8.1" r="1.7" />
          <path d="M12.2 11.9a3.5 3.5 0 0 1 4 2.8" />
        </SvgIcon>
      );
    case 'lending':
      return (
        <SvgIcon>
          <circle cx="10" cy="10" r="5.8" />
          <path d="M10 6.7v3.3l2.5 1.5" />
        </SvgIcon>
      );
    case 'lpg-service':
      return (
        <SvgIcon>
          <path d="m10 4.5 4.7 8.4H5.3L10 4.5Z" />
          <path d="M10 8.2v2.4" />
          <path d="M10 13h.01" />
        </SvgIcon>
      );
    case 'shift':
      return (
        <SvgIcon>
          <circle cx="10" cy="10" r="5.6" />
          <path d="M10 6.7v3.6l2.2 1.4" />
        </SvgIcon>
      );
    case 'purchase-orders':
      return (
        <SvgIcon>
          <path d="M6 4.8h8l1.2 1.2v9.2H4.8V6z" />
          <path d="M7.1 8.1h5.8" />
          <path d="M7.1 11h5.8" />
          <path d="M7.1 13.9h3.3" />
        </SvgIcon>
      );
    case 'delivery-dispatch':
      return (
        <SvgIcon>
          <path d="M4.8 7.2h7.8v5.6H4.8z" />
          <path d="M12.6 9.1h2.2l1.6 1.8v1.9h-3.8" />
          <circle cx="7.3" cy="14.1" r="1.1" />
          <circle cx="13.9" cy="14.1" r="1.1" />
        </SvgIcon>
      );
    case 'settings':
      return (
        <SvgIcon>
          <circle cx="10" cy="10" r="2.4" />
          <path d="M10 4.4v1.5" />
          <path d="M10 14.1v1.5" />
          <path d="m5.9 5.9 1 1" />
          <path d="m13.1 13.1 1 1" />
          <path d="M4.4 10h1.5" />
          <path d="M14.1 10h1.5" />
          <path d="m5.9 14.1 1-1" />
          <path d="m13.1 6.9 1-1" />
        </SvgIcon>
      );
  }
}

function formatRelativeSyncTime(value: string | null): string {
  if (!value) {
    return 'Not yet synced';
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 'Not yet synced';
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs <= 30_000) {
    return 'Just now';
  }

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function Sidebar({
  primaryRoutes,
  secondaryRoutes,
  addonRoutes = [],
  activeRoute,
  mode,
  open,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onClose,
  setupCompleted,
  syncBusy,
  syncNeedsAttention = false,
  branchDataBusy,
  pendingOutboxCount,
  lastSyncedAt,
  onSyncNow,
  onDownloadBranchData,
  brandTitle = 'VPOS Desktop',
  brandSubtitle
}: Props): JSX.Element | null {
  const isDrawer = mode === 'drawer';

  useEffect(() => {
    if (!isDrawer || !open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isDrawer, open]);

  if (isDrawer && !open) {
    return null;
  }

  const groups: NavGroup[] = [
    {
      label: 'Operations',
      routes: primaryRoutes.filter((route) =>
        ['dashboard', 'pos', 'sales', 'transfer', 'transfer-list'].includes(route.id)
      )
    },
    {
      label: 'Inventory & Services',
      routes: [...secondaryRoutes].filter((route) =>
        ['items', 'customers', 'lending', 'lpg-service', 'expense', 'shift'].includes(route.id)
      )
    },
    {
      label: 'System',
      routes: [...secondaryRoutes].filter((route) => ['reports', 'settings'].includes(route.id))
    },
    {
      label: 'Add-ons',
      routes: addonRoutes
    }
  ].filter((group) => group.routes.length > 0);

  const showLabels = isDrawer ? true : !collapsed;
  const railWidthClass = collapsed ? 'w-rail-collapsed' : 'w-rail-expanded';
  const railClass = isDrawer
    ? 'absolute inset-y-4 left-4 flex w-[290px] flex-col overflow-hidden rounded-[28px] border border-border-soft bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,251,0.98))] shadow-strong'
    : [
        'sticky top-0 z-rail flex h-screen shrink-0 flex-col overflow-visible border-r border-border-soft',
        'bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,251,0.98))]',
        'transition-[width] duration-normal ease-standard',
        railWidthClass
      ].join(' ');

  const renderItem = (route: DesktopRoute): JSX.Element => {
    const disabled = !setupCompleted && route.id !== 'settings';
    const active = route.id === activeRoute;

    return (
      <button
        key={route.id}
        className={[
          'shell-sidebar-item',
          active ? 'is-active' : '',
          showLabels ? '' : 'is-collapsed',
          disabled ? 'opacity-50' : ''
        ].join(' ')}
        type="button"
        onClick={() => {
          onSelect(route.id);
          if (isDrawer) {
            onClose();
          }
        }}
        disabled={disabled}
        title={!showLabels ? route.label : undefined}
        aria-label={route.label}
      >
        <span className="shell-sidebar-item-icon">{routeIcon(route.id)}</span>
        {showLabels ? <span className="shell-sidebar-item-label">{route.label}</span> : null}
      </button>
    );
  };

  const expandedFooter = (
    <div className="shell-sidebar-footer">
      <div className="shell-sidebar-sync-card">
        <div className="shell-sidebar-sync-card__meta">
          <span className={`shell-sidebar-sync-dot ${syncNeedsAttention ? 'is-alert' : 'is-healthy'}`} />
          <span>{syncNeedsAttention ? 'Sync status' : 'Last synced'}</span>
          {pendingOutboxCount > 0 ? <span className="shell-sidebar-count-pill">{pendingOutboxCount}</span> : null}
        </div>
        <strong>
          {syncBusy ? 'Syncing now...' : syncNeedsAttention ? 'Needs attention' : formatRelativeSyncTime(lastSyncedAt)}
        </strong>
        <button
          className="shell-sidebar-primary-btn"
          type="button"
          onClick={onSyncNow}
          disabled={syncBusy}
        >
          <SyncIcon spinning={syncBusy} />
          <span>{syncBusy ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>

      <button
        className="shell-sidebar-secondary-btn"
        type="button"
        onClick={onDownloadBranchData}
        disabled={branchDataBusy || !setupCompleted}
      >
        <DownloadIcon />
        <span>{branchDataBusy ? 'Downloading...' : 'Download Branch Data'}</span>
      </button>
    </div>
  );

  const collapsedFooter = (
    <div className="shell-sidebar-footer shell-sidebar-footer--collapsed">
      <button
        className="shell-sidebar-icon-btn"
        type="button"
        onClick={onSyncNow}
        disabled={syncBusy}
        title={syncBusy ? 'Syncing...' : 'Sync Now'}
        aria-label={syncBusy ? 'Syncing...' : 'Sync Now'}
      >
        <SyncIcon spinning={syncBusy} />
      </button>
      <button
        className="shell-sidebar-icon-btn"
        type="button"
        onClick={onDownloadBranchData}
        disabled={branchDataBusy || !setupCompleted}
        title={branchDataBusy ? 'Downloading...' : 'Download Branch Data'}
        aria-label={branchDataBusy ? 'Downloading...' : 'Download Branch Data'}
      >
        <DownloadIcon />
      </button>
    </div>
  );

  const navList = (
    <nav className="shell-sidebar-nav" aria-label="Primary navigation">
      {groups.map((group) => (
        <div key={group.label} className="shell-sidebar-group">
          {showLabels ? <div className="shell-sidebar-group-label">{group.label}</div> : null}
          <div className="grid gap-1.5">{group.routes.map(renderItem)}</div>
        </div>
      ))}
    </nav>
  );

  const shell = (
    <aside className={railClass} aria-label="Primary navigation">
      <div
        className={[
          'shell-sidebar-header',
          showLabels ? '' : 'shell-sidebar-header--collapsed'
        ].join(' ')}
      >
        <div
          className={[
            'shell-sidebar-brand',
            showLabels ? '' : 'shell-sidebar-brand--collapsed'
          ].join(' ')}
        >
          <div className="shell-sidebar-brand-mark">
            <img src={logoSrc} alt="VPOS" />
          </div>
          {showLabels ? (
            <div className="shell-sidebar-brand-copy">
              <strong>{brandTitle}</strong>
              <small>{brandSubtitle || 'Cashier workspace'}</small>
            </div>
          ) : null}
        </div>

        {isDrawer ? (
          <button className="shell-sidebar-close-btn" type="button" onClick={onClose}>
            Close
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shell-sidebar-toggle-btn"
          >
            <ChevronDoubleIcon collapsed={collapsed} />
          </button>
        )}
      </div>

      {navList}
      {showLabels ? expandedFooter : collapsedFooter}
    </aside>
  );

  if (isDrawer) {
    return (
      <div className="fixed inset-0 z-drawer bg-[rgba(7,31,47,0.28)]" onClick={onClose} role="presentation">
        <div onClick={(event) => event.stopPropagation()}>{shell}</div>
      </div>
    );
  }

  return shell;
}
