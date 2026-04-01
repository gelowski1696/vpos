import type { DesktopAppState } from '../db/schema';

type Props = {
  state: DesktopAppState;
  pendingOutboxCount: number;
  onRunSync: () => Promise<void>;
  onQueueDemoItem: () => Promise<void>;
  syncBusy: boolean;
};

export function DashboardScreen({ state, pendingOutboxCount, onRunSync, onQueueDemoItem, syncBusy }: Props): JSX.Element {
  const cards = [
    {
      title: 'POS Ready',
      value: state.setupCompleted ? 'Yes' : 'Setup Needed',
      copy: state.setupCompleted
        ? 'Desktop shell is ready for cashier workflows.'
        : 'Finish branch and printer setup first.'
    },
    {
      title: 'Offline Queue',
      value: String(pendingOutboxCount),
      copy: pendingOutboxCount > 0
        ? 'These desktop items are waiting to sync.'
        : 'No queued desktop items right now.'
    },
    {
      title: 'Printer Path',
      value: state.setup.printerMode,
      copy: 'USB and LAN printer support are the recommended first targets for branch desktops.'
    }
  ];

  return (
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop foundation</div>
          <h2>We now have a real desktop shell to build VPOS on.</h2>
          <p>
            This slice now includes a real desktop-local setup store and persistent outbox table for future offline sales,
            lending, loyalty, and LPG service actions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="secondary-btn" type="button" onClick={() => void onQueueDemoItem()}>
            Queue Sample Item
          </button>
          <button className="primary-btn" type="button" onClick={() => void onRunSync()} disabled={syncBusy}>
            {syncBusy ? 'Checking Sync...' : 'Run Sync Check'}
          </button>
        </div>
      </section>

      <section className="metric-grid">
        {cards.map((card) => (
          <article key={card.title} className="metric-card">
            <div className="metric-title">{card.title}</div>
            <div className="metric-value">{card.value}</div>
            <p>{card.copy}</p>
          </article>
        ))}
      </section>

      <section className="two-col-grid">
        <article className="panel-card">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Current branch setup</div>
              <h3>Device assignment</h3>
            </div>
          </div>
          <dl className="detail-list">
            <div><dt>Operator</dt><dd>{state.setup.operatorName || 'Not set'}</dd></div>
            <div><dt>Branch</dt><dd>{state.setup.branchLabel || 'Not set'}</dd></div>
            <div><dt>Location</dt><dd>{state.setup.locationLabel || 'Not set'}</dd></div>
            <div><dt>API</dt><dd>{state.setup.apiBaseUrl}</dd></div>
          </dl>
        </article>

        <article className="panel-card">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Sync health</div>
              <h3>Latest result</h3>
            </div>
          </div>
          <div className={`sync-banner ${state.sync.lastSyncStatus}`}>
            <strong>
              {state.sync.lastSyncStatus === 'success'
                ? 'Connection looks good'
                : state.sync.lastSyncStatus === 'error'
                  ? 'Connection needs attention'
                  : state.sync.lastSyncStatus === 'running'
                    ? 'Sync is running'
                    : 'No sync run yet'}
            </strong>
            <span>{state.sync.lastSyncMessage}</span>
            <span>{state.sync.lastSyncedAt ? new Date(state.sync.lastSyncedAt).toLocaleString() : 'No timestamp yet'}</span>
          </div>
        </article>
      </section>
    </div>
  );
}
