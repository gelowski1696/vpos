import type { DesktopRoute, DesktopRouteId } from '../../app/routes';

type Props = {
  routes: DesktopRoute[];
  open: boolean;
  activeRoute: DesktopRouteId;
  onSelect: (route: DesktopRouteId) => void;
  onClose: () => void;
  setupCompleted: boolean;
  syncBusy: boolean;
  branchDataBusy: boolean;
  onBackToMainTabs: () => void;
  onSyncNow: () => void;
  onDownloadBranchData: () => void;
  onSwitchCashier: () => void;
  onLockSession: () => void;
  onFullSignOut: () => void;
};

export function Sidebar({
  routes,
  open,
  activeRoute,
  onSelect,
  onClose,
  setupCompleted,
  syncBusy,
  branchDataBusy,
  onBackToMainTabs,
  onSyncNow,
  onDownloadBranchData,
  onSwitchCashier,
  onLockSession,
  onFullSignOut
}: Props): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-[rgba(7,31,47,0.28)]"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="absolute inset-y-4 left-4 w-[292px] overflow-auto rounded-[24px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,247,251,0.98))] px-3 pb-4 pt-[18px] shadow-[0_24px_44px_rgba(7,31,47,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3.5">
          <div>
            <div className="text-base font-extrabold text-[var(--text-strong)]">Other Menu</div>
            <div className="mt-1 text-[0.72rem] leading-[1.4] text-[var(--muted)]">
              Lending, LPG service, expense, items, customers, shift, and settings.
            </div>
          </div>
          <button
            className="ml-auto min-h-9 rounded-full border border-[var(--border-soft)] bg-[var(--surface-strong)] px-3.5 text-sm font-semibold text-[var(--text)]"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <nav className="mb-3 flex flex-col gap-2">
          {routes.map((route) => {
            const disabled = !setupCompleted && route.id !== 'settings';
            const active = route.id === activeRoute;
            return (
              <button
                key={route.id}
                className={[
                  'rounded-[14px] border px-3 py-2.5 text-left transition-colors',
                  active
                    ? 'border-transparent bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-[#f4f8ff]'
                    : 'border-[var(--border-soft)] bg-[var(--surface-muted)] text-[var(--text)]'
                ].join(' ')}
                type="button"
                onClick={() => {
                  onSelect(route.id);
                  onClose();
                }}
                disabled={disabled}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={[
                      'grid h-[30px] w-[30px] place-items-center rounded-[9px] text-[0.95rem] font-extrabold',
                      active
                        ? 'bg-[rgba(255,255,255,0.2)] text-white'
                        : 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                    ].join(' ')}
                  >
                    {route.icon}
                  </div>
                  <div className="grid gap-0.5">
                    <span className="font-bold">{route.label}</span>
                    <div className={active ? 'text-[0.76rem] leading-[1.3] text-[rgba(255,255,255,0.9)]' : 'text-[0.76rem] leading-[1.3] text-[var(--muted)]'}>
                      {route.hint}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="grid gap-2">
          <button
            className="min-h-10 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 text-[0.82rem] font-bold text-[var(--text)]"
            type="button"
            onClick={onBackToMainTabs}
          >
            Back To Main Tabs
          </button>
          <button
            className="min-h-10 rounded-[10px] border border-transparent bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] px-3 text-[0.82rem] font-bold text-white"
            type="button"
            onClick={onSyncNow}
            disabled={syncBusy}
          >
            {syncBusy ? 'Syncing...' : 'Sync Now'}
          </button>
          <button
            className="min-h-10 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 text-[0.82rem] font-bold text-[var(--text)]"
            type="button"
            onClick={onDownloadBranchData}
            disabled={branchDataBusy || !setupCompleted}
          >
            {branchDataBusy ? 'Downloading...' : 'Download Branch Data'}
          </button>
          <button
            className="min-h-10 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 text-[0.82rem] font-bold text-[var(--text)]"
            type="button"
            onClick={onSwitchCashier}
          >
            Switch Cashier
          </button>
          <button
            className="min-h-10 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 text-[0.82rem] font-bold text-[var(--text)]"
            type="button"
            onClick={onLockSession}
          >
            Log Out (Lock)
          </button>
          <button
            className="min-h-10 rounded-[10px] border border-transparent bg-[#b91c1c] px-3 text-[0.82rem] font-bold text-white"
            type="button"
            onClick={onFullSignOut}
          >
            Full Sign Out
          </button>
        </div>
      </aside>
    </div>
  );
}
