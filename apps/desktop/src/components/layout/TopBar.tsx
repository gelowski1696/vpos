import type { DesktopAppState } from '../../db/schema';

type Props = {
  state: DesktopAppState;
};

export function TopBar({ state }: Props): JSX.Element {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">Cashier Desktop</div>
        <h1 className="topbar-title">
          {state.setupCompleted
            ? `${state.setup.branchLabel} / ${state.setup.locationLabel}`
            : 'Complete desktop setup'}
        </h1>
      </div>

      <div className="topbar-status-row">
        <div className="status-pill">
          <span className="status-label">Operator</span>
          <strong>{state.setup.operatorName || 'Not set'}</strong>
        </div>
        <div className="status-pill">
          <span className="status-label">Printer</span>
          <strong>{state.setup.printerMode}</strong>
        </div>
        <div className={`status-pill ${state.sync.lastSyncStatus}`}>
          <span className="status-label">Sync</span>
          <strong>
            {state.sync.lastSyncStatus === 'idle'
              ? 'Waiting'
              : state.sync.lastSyncStatus === 'running'
                ? 'Running'
                : state.sync.lastSyncStatus === 'success'
                  ? 'Healthy'
                  : 'Check'}
          </strong>
        </div>
      </div>
    </header>
  );
}
