import { useEffect, useMemo, useState } from 'react';
import type { DesktopAppState } from '../../db/schema';
import { DESKTOP_ROUTES, type DesktopRouteId } from '../../app/routes';
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
  compact?: boolean;
};

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'error';
  actionLabel?: string;
  onAction?: () => void;
};

export function TopBar({
  state,
  activeRoute,
  onOpenMenu,
  pendingOutboxCount,
  syncBusy,
  onRunSync,
  onOpenRoute,
  compact = false
}: Props): JSX.Element {
  const tutorialActions = useDesktopTutorialActions();
  const helpTarget = useDesktopTutorialTarget('module-help');
  const activeConfig = DESKTOP_ROUTES.find((route) => route.id === activeRoute);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const tutorialScope = getTutorialScopeForRoute(activeRoute);
  const subtitle = state.setupCompleted
    ? [state.setup.operatorName || 'Cashier', state.setup.printerMode !== 'NONE' ? state.setup.printerMode : null]
        .filter(Boolean)
        .join(' \u00b7 ')
    : 'Finish setup first';

  useEffect(() => {
    setNotificationOpen(false);
  }, [activeRoute]);

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
        title: pendingOutboxCount === 1 ? '1 item waiting to sync' : `${pendingOutboxCount} items waiting to sync`,
        detail: 'Sales and other queued changes will upload on the next successful sync.',
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

  const statusHealthy = state.setupCompleted && state.sync.lastSyncStatus !== 'error' && pendingOutboxCount === 0;
  const statusLabel = statusHealthy ? 'Ready' : 'Needs attention';
  const notificationCount = notifications.filter((item) => item.tone !== 'success').length;

  return (
    <header
      className={[
        'sticky top-0 z-[55] flex justify-between gap-[18px] border-b border-[rgba(217,228,239,0.72)] bg-[linear-gradient(180deg,rgba(247,251,255,0.96),rgba(247,251,255,0.82))] px-[10px] pb-[10px] pt-3 backdrop-blur-[14px] transition-all',
        compact ? 'mx-[-6px] mt-[-8px] bg-[linear-gradient(180deg,rgba(247,251,255,0.98),rgba(247,251,255,0.92))] px-[10px] pb-2 pt-2 shadow-[0_8px_18px_rgba(17,40,58,0.06)]' : 'mx-[-6px] mt-[-4px]'
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          className={[
            'sticky z-[56] grid place-items-center rounded-[14px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] text-[1.1rem] text-[var(--text)] shadow-[0_10px_20px_rgba(17,40,58,0.08)] transition-all',
            compact ? 'top-2 h-10 w-10 rounded-[12px] shadow-[0_8px_16px_rgba(17,40,58,0.06)]' : 'top-3 h-11 w-11'
          ].join(' ')}
          type="button"
          onClick={onOpenMenu}
        >
          {'\u2630'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--muted)]">{activeConfig?.label ?? 'VPOS'}</div>
          <h1
            className={[
              'mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-extrabold leading-[1.12] text-[var(--text-strong)] transition-all',
              compact ? 'text-[1.42rem]' : 'text-[clamp(1.45rem,1.05rem+1.7vw,2.15rem)]'
            ].join(' ')}
          >
            {state.setupCompleted ? `${state.setup.branchLabel} / ${state.setup.locationLabel}` : 'Complete desktop setup'}
          </h1>
          <div className={compact ? 'mt-0.5 text-[0.84rem] text-[var(--muted)] opacity-90' : 'mt-1 text-[0.9rem] text-[var(--muted)]'}>
            {subtitle}
          </div>
        </div>
      </div>

      <div className="relative z-[58] flex shrink-0 items-center gap-2">
        <button
          ref={helpTarget.ref}
          className={[
            'relative grid place-items-center rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] text-[var(--text)] shadow-[0_8px_16px_rgba(17,40,58,0.06)] transition-all',
            compact ? 'h-9 w-9 shadow-[0_6px_12px_rgba(17,40,58,0.05)]' : 'h-10 w-10',
            helpTarget.active ? 'tutorial-target-active' : ''
          ].join(' ')}
          type="button"
          onClick={() => tutorialActions.open(tutorialScope)}
          aria-label="Open walkthrough"
          title="Open walkthrough"
        >
          ?
        </button>
        <div
          className={[
            'grid place-items-center rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] shadow-[0_8px_16px_rgba(17,40,58,0.06)] transition-all',
            compact ? 'h-9 w-9 shadow-[0_6px_12px_rgba(17,40,58,0.05)]' : 'h-10 w-10'
          ].join(' ')}
          title={statusLabel}
          aria-label={statusLabel}
        >
          <div className={`h-[11px] w-[11px] rounded-full ${statusHealthy ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
        </div>
        <button
          className={[
            'relative grid place-items-center rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] text-[var(--text)] shadow-[0_8px_16px_rgba(17,40,58,0.06)] transition-all',
            compact ? 'h-9 w-9 shadow-[0_6px_12px_rgba(17,40,58,0.05)]' : 'h-10 w-10'
          ].join(' ')}
          type="button"
          onClick={() => setNotificationOpen((value) => !value)}
          aria-label="Open notifications"
        >
          {'\uD83D\uDD14'}
          {notificationCount > 0 ? (
            <span className="absolute right-[-5px] top-[-5px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] px-1 text-[0.62rem] font-extrabold text-white shadow-[0_8px_16px_rgba(25,118,210,0.18)]">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          ) : null}
        </button>
      </div>

      {notificationOpen ? (
        <>
          <button
            type="button"
            className="topbar-popover-scrim"
            aria-label="Close notifications"
            onClick={() => setNotificationOpen(false)}
          />
          <div className="absolute right-0 top-[calc(100%+10px)] z-[59] grid w-[min(360px,calc(100vw-28px))] gap-2.5 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-3 shadow-[0_22px_42px_rgba(17,40,58,0.16)] backdrop-blur-[12px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[0.95rem] font-extrabold text-[var(--text-strong)]">Notifications</div>
                <div className="mt-1 text-[0.76rem] leading-[1.35] text-[var(--muted)]">
                  {notifications.length ? 'Quick branch and sync updates.' : 'Everything looks clear right now.'}
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              {notifications.length === 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgba(29,141,104,0.18)] bg-[rgba(29,141,104,0.08)] p-3">
                  <div className="grid gap-1">
                    <strong className="text-[0.85rem] text-[var(--text-strong)]">No pending alerts</strong>
                    <div className="text-[0.76rem] leading-[1.35] text-[var(--muted)]">Desktop is ready for normal use.</div>
                  </div>
                </div>
              ) : (
                notifications.map((item) => (
                  <div
                    key={item.id}
                    className={[
                      'flex items-center justify-between gap-3 rounded-2xl border p-3',
                      item.tone === 'success'
                        ? 'border-[rgba(29,141,104,0.18)] bg-[rgba(29,141,104,0.08)]'
                        : item.tone === 'warning'
                          ? 'border-[rgba(217,119,6,0.18)] bg-[rgba(245,158,11,0.08)]'
                          : 'border-[rgba(185,62,95,0.18)] bg-[rgba(239,68,68,0.08)]'
                    ].join(' ')}
                  >
                    <div className="grid min-w-0 gap-1">
                      <strong className="text-[0.85rem] text-[var(--text-strong)]">{item.title}</strong>
                      <div className="text-[0.76rem] leading-[1.35] text-[var(--muted)]">{item.detail}</div>
                    </div>
                    {item.actionLabel ? (
                      <button
                        type="button"
                        className="min-h-[34px] whitespace-nowrap rounded-[10px] border border-[rgba(140,182,223,0.42)] bg-[var(--accent-soft)] px-3 text-[0.76rem] font-extrabold text-[var(--accent-strong)]"
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
        </>
      ) : null}
    </header>
  );
}
