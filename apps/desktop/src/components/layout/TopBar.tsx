import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DesktopAppState } from '../../db/schema';
import { type DesktopRouteId } from '../../app/routes';
import { useDesktopTutorialActions, useDesktopTutorialTarget } from '../../tutorial/tutorial-provider';
import { getTutorialScopeForRoute } from '../../tutorial/tutorial-routing';

type Props = {
  state: DesktopAppState;
  activeRoute: DesktopRouteId;
  onOpenMenu: () => void;
  pendingOutboxCount: number;
  syncBusy: boolean;
  onRunSync: () => void;
  onOpenRoute: (route: DesktopRouteId) => void;
  onSwitchCashier: () => void;
  onLockSession: () => void;
  onFullSignOut: () => void;
  compact?: boolean;
  showMenuButton?: boolean;
};

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'error';
  actionLabel?: string;
  onAction?: () => void;
};

function SvgIcon({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className ?? 'h-[18px] w-[18px]'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function MenuIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M4 5.5h12" />
      <path d="M4 10h12" />
      <path d="M4 14.5h12" />
    </SvgIcon>
  );
}

function BranchIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M4.5 16V5.5l4-2v3l3-1.5V16" />
      <path d="M11.5 7.5h4v8.5" />
      <path d="M7 8.5v1" />
      <path d="M7 11.5v1" />
      <path d="M13.5 10.5v1" />
      <path d="M13.5 13.5v1" />
      <path d="M4 16.5h12" />
    </SvgIcon>
  );
}

function HelpIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M7.9 7.2a2.5 2.5 0 1 1 4.1 1.9c-.8.7-1.5 1.1-1.5 2.1" />
      <path d="M10 14.6h.01" />
      <circle cx="10" cy="10" r="7.2" />
    </SvgIcon>
  );
}

function SyncIcon({ spinning = false }: { spinning?: boolean }): JSX.Element {
  return (
    <SvgIcon className={`h-[18px] w-[18px] ${spinning ? 'animate-spin' : ''}`}>
      <path d="M16.2 10a6.2 6.2 0 0 1-10.6 4.4" />
      <path d="M3.8 10a6.2 6.2 0 0 1 10.6-4.4" />
      <path d="M13.5 3.8h2.8v2.8" />
      <path d="M6.5 16.2H3.7v-2.8" />
    </SvgIcon>
  );
}

function BellIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M10 4.7a3 3 0 0 0-3 3v1.6c0 .9-.2 1.8-.7 2.6l-.8 1.4h9l-.8-1.4c-.5-.8-.7-1.7-.7-2.6V7.7a3 3 0 0 0-3-3Z" />
      <path d="M8.5 15.1a1.7 1.7 0 0 0 3 0" />
    </SvgIcon>
  );
}

function SwitchIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M4.8 6.3h8.5" />
      <path d="m10.8 3.6 2.5 2.7-2.5 2.7" />
      <path d="M15.2 13.7H6.7" />
      <path d="m9.2 16.4-2.5-2.7 2.5-2.7" />
    </SvgIcon>
  );
}

function LockIcon(): JSX.Element {
  return (
    <SvgIcon>
      <rect x="5" y="8.6" width="10" height="7.4" rx="2" />
      <path d="M7.2 8.6V6.9a2.8 2.8 0 0 1 5.6 0v1.7" />
    </SvgIcon>
  );
}

function SignOutIcon(): JSX.Element {
  return (
    <SvgIcon>
      <path d="M8 4.8H6.4A1.6 1.6 0 0 0 4.8 6.4v7.2a1.6 1.6 0 0 0 1.6 1.6H8" />
      <path d="M11 6.5 15 10l-4 3.5" />
      <path d="M8.5 10H15" />
    </SvgIcon>
  );
}

function MoreIcon(): JSX.Element {
  return (
    <SvgIcon className="h-[16px] w-[16px]">
      <circle cx="10" cy="5.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
    </SvgIcon>
  );
}

function StatusDotIcon({ className }: { className?: string }): JSX.Element {
  return <span className={className ?? 'shell-status-pill__dot'} aria-hidden="true" />;
}

function operatorInitial(operatorName: string): string {
  return operatorName.trim().charAt(0).toUpperCase() || 'C';
}

export function TopBar({
  state,
  activeRoute,
  onOpenMenu,
  pendingOutboxCount,
  syncBusy,
  onRunSync,
  onOpenRoute,
  onSwitchCashier,
  onLockSession,
  onFullSignOut,
  compact = false,
  showMenuButton = true
}: Props): JSX.Element {
  const tutorialActions = useDesktopTutorialActions();
  const helpTarget = useDesktopTutorialTarget('module-help');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const tutorialScope = getTutorialScopeForRoute(activeRoute);
  const operatorName =
    state.auth.userFullName?.trim() ||
    state.auth.userEmail?.trim() ||
    state.setup.operatorName.trim() ||
    'Cashier';

  useEffect(() => {
    setNotificationOpen(false);
    setProfileOpen(false);
  }, [activeRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = (): void => setIsNetworkOnline(true);
    const handleOffline = (): void => setIsNetworkOnline(false);

    setIsNetworkOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const notifications = useMemo<NotificationItem[]>(() => {
    const next: NotificationItem[] = [];

    if (!state.setupCompleted) {
      next.push({
        id: 'setup',
        title: 'Finish setup first',
        detail: 'Choose branch and location, then download branch data before using the app.',
        tone: 'error',
        actionLabel: 'Open Settings',
        onAction: () => onOpenRoute('settings')
      });
    }

    if (pendingOutboxCount > 0) {
      next.push({
        id: 'outbox',
        title: pendingOutboxCount === 1 ? '1 unsynced item' : `${pendingOutboxCount} unsynced items`,
        detail: 'Pending changes upload automatically. Rejected changes wait for correction and do not block new work.',
        tone: 'warning',
        actionLabel: syncBusy ? 'Syncing...' : 'Sync Now',
        onAction: syncBusy ? undefined : onRunSync
      });
    }

    if (state.sync.lastSyncStatus === 'error') {
      next.push({
        id: 'sync-error',
        title: 'Sync needs attention',
        detail: state.sync.lastSyncMessage || 'The last sync did not finish successfully.',
        tone: 'error',
        actionLabel: syncBusy ? 'Syncing...' : 'Retry Sync',
        onAction: syncBusy ? undefined : onRunSync
      });
    } else if (state.sync.lastSyncStatus === 'success' && state.sync.lastSyncedAt) {
      next.push({
        id: 'sync-ok',
        title: 'Sync is up to date',
        detail: `Last synced ${new Date(state.sync.lastSyncedAt).toLocaleString()}.`,
        tone: 'success'
      });
    }

    if (state.setupCompleted && state.setup.printerMode === 'NONE') {
      next.push({
        id: 'printer',
        title: 'Printer is not set',
        detail: 'Receipt printing is off until a USB or LAN printer is configured.',
        tone: 'warning',
        actionLabel: 'Open Settings',
        onAction: () => onOpenRoute('settings')
      });
    }

    return next;
  }, [onOpenRoute, onRunSync, pendingOutboxCount, state, syncBusy]);

  const statusHealthy = isNetworkOnline;
  const notificationCount = notifications.filter((item) => item.tone !== 'success').length;
  const onlinePillTone = statusHealthy ? 'success' : 'danger';
  const syncPillTone = pendingOutboxCount > 0 ? 'warning' : state.sync.lastSyncStatus === 'error' ? 'danger' : 'muted';
  const syncPillLabel =
    pendingOutboxCount > 0
      ? `${pendingOutboxCount} Unsynced`
      : state.sync.lastSyncStatus === 'error'
        ? 'Sync Needs Attention'
        : 'All Synced';

  return (
    <header className={`shell-topbar ${compact ? 'shell-topbar--compact' : ''}`}>
      <div className="shell-topbar-primary">
        {showMenuButton ? (
          <button
            className="shell-action-circle shell-action-circle--menu"
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
        ) : null}

        <div className="shell-branch-card">
          <span className="shell-branch-card__icon">
            <BranchIcon />
          </span>
          <span className="shell-branch-card__copy">
            <strong>{state.setupCompleted ? state.setup.locationLabel : 'Desktop setup'}</strong>
            <small>
              {state.setupCompleted
                ? state.setup.branchLabel
                : 'Select branch, printer, and local workstation settings'}
            </small>
          </span>
        </div>

        <div className="shell-status-strip" aria-label="Desktop status">
          <div className={`shell-status-pill shell-status-pill--${onlinePillTone}`}>
            <StatusDotIcon className={`shell-status-pill__dot shell-status-pill__dot--${onlinePillTone}`} />
            <span>{statusHealthy ? 'Online' : 'Offline'}</span>
          </div>
          <div className={`shell-status-pill shell-status-pill--${syncPillTone}`}>
            <SyncIcon spinning={syncBusy} />
            <span>{syncBusy ? 'Syncing...' : syncPillLabel}</span>
          </div>
        </div>
      </div>

      <div className="relative z-topbarPopover shell-topbar-actions">
        <button
          ref={helpTarget.ref}
          className={`shell-action-circle ${helpTarget.active ? 'tutorial-target-active' : ''}`}
          type="button"
          onClick={() => tutorialActions.open(tutorialScope)}
          aria-label="Open walkthrough"
          title="Open walkthrough"
        >
          <HelpIcon />
        </button>

        <button
          className="shell-action-circle shell-notification-btn"
          type="button"
          onClick={() => {
            setProfileOpen(false);
            setNotificationOpen((value) => !value);
          }}
          aria-label="Open notifications"
          title="Notifications"
        >
          <span className="shell-notification-btn__icon">
            <BellIcon />
          </span>
          {notificationCount > 0 ? (
            <span className="shell-notification-badge">{notificationCount > 99 ? '99+' : notificationCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          className="shell-profile-chip shell-profile-chip--button"
          onClick={() => {
            setNotificationOpen(false);
            setProfileOpen((value) => !value);
          }}
          aria-label="Open cashier menu"
          title="Cashier menu"
        >
          <span className="shell-profile-avatar">{operatorInitial(operatorName)}</span>
          <span className="shell-profile-copy">
            <strong>{operatorName}</strong>
            <small>{state.setupCompleted ? 'Cashier' : 'Setup pending'}</small>
          </span>
          <span className="shell-profile-chip__menu-icon">
            <MoreIcon />
          </span>
        </button>
      </div>

      {notificationOpen || profileOpen ? (
        <>
          <button
            type="button"
            className="topbar-popover-scrim"
            aria-label="Close top bar menus"
            onClick={() => {
              setNotificationOpen(false);
              setProfileOpen(false);
            }}
          />
          {profileOpen ? (
            <div className="shell-profile-menu">
              <div className="shell-profile-menu__head">
                <span className="shell-profile-menu__avatar">{operatorInitial(operatorName)}</span>
                <div className="shell-profile-menu__copy">
                  <strong>{operatorName}</strong>
                  <small>{state.setupCompleted ? state.setup.locationLabel : 'Setup pending'}</small>
                </div>
              </div>
              <button
                type="button"
                className="shell-profile-menu__item"
                onClick={() => {
                  setProfileOpen(false);
                  onSwitchCashier();
                }}
              >
                <SwitchIcon />
                <span>Switch Cashier</span>
              </button>
              <button
                type="button"
                className="shell-profile-menu__item"
                onClick={() => {
                  setProfileOpen(false);
                  onLockSession();
                }}
              >
                <LockIcon />
                <span>Lock Session</span>
              </button>
              <button
                type="button"
                className="shell-profile-menu__item shell-profile-menu__item--danger"
                onClick={() => {
                  setProfileOpen(false);
                  onFullSignOut();
                }}
              >
                <SignOutIcon />
                <span>Full Sign Out</span>
              </button>
            </div>
          ) : null}
          {notificationOpen ? (
            <div className="absolute right-gutter-x top-[calc(100%+12px)] z-topbarPopover grid w-[min(380px,calc(100vw-28px))] gap-2 rounded-[24px] border border-border-soft bg-surface-strong p-3 shadow-strong backdrop-blur-[12px]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-text-strong">Desktop notices</div>
                  <div className="mt-0.5 text-xs leading-snug text-muted">
                    {notifications.length ? 'Quick branch, sync, and receipt updates.' : 'Everything looks clear right now.'}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                {notifications.length === 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[rgba(29,141,104,0.18)] bg-[rgba(29,141,104,0.08)] p-3">
                    <div className="grid gap-1">
                      <strong className="text-sm text-text-strong">No pending alerts</strong>
                      <div className="text-xs leading-snug text-muted">Desktop is ready for normal use.</div>
                    </div>
                  </div>
                ) : (
                  notifications.map((item) => (
                    <div
                      key={item.id}
                      className={[
                        'flex items-center justify-between gap-3 rounded-[18px] border p-3',
                        item.tone === 'success'
                          ? 'border-[rgba(29,141,104,0.18)] bg-[rgba(29,141,104,0.08)]'
                          : item.tone === 'warning'
                            ? 'border-[rgba(217,119,6,0.18)] bg-[rgba(245,158,11,0.08)]'
                            : 'border-[rgba(185,62,95,0.18)] bg-[rgba(239,68,68,0.08)]'
                      ].join(' ')}
                    >
                      <div className="grid min-w-0 gap-1">
                        <strong className="text-sm text-text-strong">{item.title}</strong>
                        <div className="text-xs leading-snug text-muted">{item.detail}</div>
                      </div>
                      {item.actionLabel ? (
                        <button
                          type="button"
                          className="min-h-9 whitespace-nowrap rounded-pill border border-[rgba(140,182,223,0.42)] bg-accent-soft px-3 text-xs font-extrabold text-accent-strong"
                          onClick={() => {
                            item.onAction?.();
                            setNotificationOpen(false);
                          }}
                          disabled={!item.onAction}
                        >
                          {item.actionLabel}
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </header>
  );
}
