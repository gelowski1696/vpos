import { useEffect, useMemo, useState } from 'react';
import type { DesktopAppState, DesktopLendingDetail, DesktopLendingReturnDraft, DesktopLendingRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopLendingService } from '../services/desktop-lending.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopSettingsService } from '../services/desktop-settings.service';

const RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'LOST'] as const;

type Props = {
  appState: DesktopAppState;
  onStateReload?: () => Promise<void> | void;
};

type LendingFilter = 'all' | 'OPEN' | 'PARTIALLY_RETURNED' | 'OVERDUE' | 'CLOSED';

type ReturnLineState = {
  returnedQty: string;
  condition: (typeof RETURN_CONDITIONS)[number];
};

function fmtNumber(value: number): string {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function friendlyStatus(status: DesktopLendingRecord['status']): string {
  switch (status) {
    case 'PARTIALLY_RETURNED':
      return 'Partial Return';
    case 'FORCE_CLOSED':
      return 'Force Closed';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function openQuantity(record: DesktopLendingRecord): number {
  return Number((record.total_quantity_lent - record.total_quantity_returned).toFixed(3));
}

export function LendingScreen({ appState, onStateReload }: Props): JSX.Element {
  const [records, setRecords] = useState<DesktopLendingRecord[]>([]);
  const [selectedLendingId, setSelectedLendingId] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<DesktopLendingDetail | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<LendingFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [returnLines, setReturnLines] = useState<Record<string, ReturnLineState>>({});
  const [savingReturn, setSavingReturn] = useState(false);
  const [message, setMessage] = useState('Refresh branch data in Settings to keep the lending cache current on this desktop.');

  const loadRecords = async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await desktopMasterDataService.loadLendingRecords(appState.setup.branchId, appState.setup.locationId);
      setRecords(rows);
      if (!selectedLendingId && rows.length > 0) {
        setSelectedLendingId(rows[0].lending_id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, [appState.setup.branchId, appState.setup.locationId]);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      if (activeFilter !== 'all' && record.status !== activeFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = [
        record.customer_name ?? '',
        record.sale_id,
        record.location_name ?? '',
        record.remarks ?? '',
        friendlyStatus(record.status)
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [activeFilter, records, search]);

  const selectedRecord =
    filteredRecords.find((record) => record.lending_id === selectedLendingId) ??
    records.find((record) => record.lending_id === selectedLendingId) ??
    filteredRecords[0] ??
    null;

  useEffect(() => {
    let active = true;
    async function loadDetail(): Promise<void> {
      if (!selectedRecord) {
        setSelectedDetail(null);
        return;
      }
      setLoadingDetail(true);
      try {
        const cached = await desktopMasterDataService.loadCachedLendingDetail(selectedRecord.lending_id);
        if (active) {
          setSelectedDetail(cached);
        }
        if (appState.auth.accessToken) {
          try {
            const result = await desktopMasterDataService.refreshLendingDetail(appState, selectedRecord.lending_id);
            if (!active) {
              return;
            }
            setSelectedDetail(result.detail);
            await desktopSettingsService.saveState(result.state);
            if (onStateReload) {
              await onStateReload();
            }
          } catch {
            if (active && !cached) {
              setMessage('This lending detail is only partially available offline right now. Connect once to load its full line history.');
            }
          }
        }
      } finally {
        if (active) {
          setLoadingDetail(false);
        }
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedRecord?.lending_id, appState.auth.accessToken]);

  const counts = useMemo(
    () => ({
      all: records.length,
      OPEN: records.filter((record) => record.status === 'OPEN').length,
      PARTIALLY_RETURNED: records.filter((record) => record.status === 'PARTIALLY_RETURNED').length,
      OVERDUE: records.filter((record) => record.status === 'OVERDUE').length,
      CLOSED: records.filter((record) => record.status === 'CLOSED').length
    }),
    [records]
  );

  const returnableLines = useMemo(
    () => (selectedDetail?.lines ?? []).filter((line) => line.quantity_open > 0),
    [selectedDetail]
  );

  const openReturnModal = (): void => {
    if (!selectedDetail || returnableLines.length === 0) {
      setMessage('This lending record has no open quantity left to return.');
      return;
    }
    const nextLines: Record<string, ReturnLineState> = {};
    returnableLines.forEach((line) => {
      nextLines[line.lending_line_id] = {
        returnedQty: '',
        condition: 'GOOD'
      };
    });
    setReturnLines(nextLines);
    setReturnRemarks('');
    setReturnModalOpen(true);
  };

  const handleRefreshRecords = async (): Promise<void> => {
    if (!appState.auth.accessToken || !appState.setup.branchId) {
      setMessage('Sign in and choose a branch first before refreshing desktop lending records.');
      return;
    }
    try {
      const result = await desktopMasterDataService.refreshLendingRecords(appState, appState.setup.branchId);
      await desktopSettingsService.saveState(result.state);
      if (onStateReload) {
        await onStateReload();
      }
      setMessage(`Desktop lending cache refreshed. ${result.count} branch records are now available on this workstation.`);
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh desktop lending records right now.');
    }
  };

  const handleSubmitReturn = async (): Promise<void> => {
    if (!selectedRecord || !selectedDetail) {
      return;
    }

    const draftLines = returnableLines
      .map((line) => {
        const row = returnLines[line.lending_line_id];
        const qty = Number(row?.returnedQty ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) {
          return null;
        }
        return {
          lending_line_id: line.lending_line_id,
          returned_qty: qty,
          condition: row?.condition ?? 'GOOD',
          remarks: null
        };
      })
      .filter(Boolean) as DesktopLendingReturnDraft['lines'];

    if (draftLines.length === 0) {
      setMessage('Enter at least one return quantity before saving this lending return.');
      return;
    }

    setSavingReturn(true);
    try {
      const draft = {
        remarks: returnRemarks.trim() || null,
        lines: draftLines
      } satisfies DesktopLendingReturnDraft;
      let nextDetail: DesktopLendingDetail;
      let nextMessage = '';

      if (appState.auth.accessToken) {
        try {
          const result = await desktopMasterDataService.recordLendingReturn(appState, selectedRecord.lending_id, draft);
          await desktopSettingsService.saveState(result.state);
          if (onStateReload) {
            await onStateReload();
          }
          nextDetail = result.detail;
          nextMessage = `Return saved for ${selectedRecord.customer_name || selectedRecord.sale_id}. The lending record is now updated on this desktop.`;
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unable to record the lending return right now.';
          if (!/fetch|network|offline|failed/i.test(detail)) {
            throw error;
          }
          nextDetail = await desktopLendingService.queueOfflineReturn(appState, selectedDetail, draft);
          nextMessage = `Return queued locally for ${selectedRecord.customer_name || selectedRecord.sale_id}. It will sync when this desktop reconnects.`;
        }
      } else {
        nextDetail = await desktopLendingService.queueOfflineReturn(appState, selectedDetail, draft);
        nextMessage = `Return queued locally for ${selectedRecord.customer_name || selectedRecord.sale_id}. It will sync when this desktop reconnects.`;
      }

      setSelectedDetail(nextDetail);
      setRecords((prev) =>
        prev.map((record) =>
          record.lending_id === nextDetail.lending_id
            ? {
                ...record,
                ...nextDetail
              }
            : record
        )
      );
      setReturnModalOpen(false);
      setReturnRemarks('');
      setReturnLines({});
      setMessage(nextMessage);
      await loadRecords();
      const outboxRows = await desktopDb.listOutboxItems();
      if (onStateReload && outboxRows.some((row) => row.entity === 'lending_return' && (row.status === 'pending' || row.status === 'failed'))) {
        await onStateReload();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record the lending return right now.');
    } finally {
      setSavingReturn(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop Lending</div>
          <h2>Track open, partial, overdue, and closed lending records from the desktop station.</h2>
          <p>
            The list uses cached branch lending records for fast loading. When the desktop is signed in, the detail
            pane also refreshes the full line and return history from the API.
          </p>
        </div>
        <div className="sales-summary-strip">
          <div>
            <span>All Records</span>
            <strong>{counts.all}</strong>
          </div>
          <div>
            <span>Open</span>
            <strong>{counts.OPEN}</strong>
          </div>
          <div>
            <span>Partial</span>
            <strong>{counts.PARTIALLY_RETURNED}</strong>
          </div>
          <div>
            <span>Overdue</span>
            <strong>{counts.OVERDUE}</strong>
          </div>
        </div>
      </section>

      <section className="sales-shell">
        <div className="panel-card">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Lending list</div>
              <h3>Branch records</h3>
            </div>
            <button className="secondary-btn" type="button" onClick={() => void handleRefreshRecords()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh Records'}
            </button>
          </div>

          <input
            className="desktop-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer, sale, location, or note"
          />

          <div className="filter-chip-row">
            {([
              ['all', `All (${counts.all})`],
              ['OPEN', `Open (${counts.OPEN})`],
              ['PARTIALLY_RETURNED', `Partial (${counts.PARTIALLY_RETURNED})`],
              ['OVERDUE', `Overdue (${counts.OVERDUE})`],
              ['CLOSED', `Closed (${counts.CLOSED})`]
            ] as Array<[LendingFilter, string]>).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
                onClick={() => setActiveFilter(filter)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="sales-list">
            {loading ? (
              <div className="empty-state">Loading desktop lending records...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="empty-state">No desktop lending records match this filter yet.</div>
            ) : (
              filteredRecords.map((record) => (
                <button
                  key={record.lending_id}
                  type="button"
                  className={`sales-list-row ${selectedRecord?.lending_id === record.lending_id ? 'selected' : ''}`}
                  onClick={() => setSelectedLendingId(record.lending_id)}
                >
                  <div>
                    <strong>{record.customer_name || 'Customer lending record'}</strong>
                    <span>{record.sale_id} · {record.location_name || record.location_id}</span>
                    <span>{new Date(record.opened_at).toLocaleString()}</span>
                  </div>
                  <div className="sales-list-row-right">
                    <strong>{fmtNumber(record.total_quantity_lent)} out</strong>
                    <div className={`sync-chip ${record.status === 'CLOSED' ? 'synced' : record.status === 'OVERDUE' ? 'failed' : 'pending'}`}>
                      {friendlyStatus(record.status)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="panel-card sales-detail-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Lending detail</div>
              <h3>{selectedRecord ? selectedRecord.customer_name || selectedRecord.sale_id : 'Choose a record'}</h3>
            </div>
            {selectedRecord ? (
              <button
                className="secondary-btn"
                type="button"
                onClick={openReturnModal}
                disabled={!appState.auth.accessToken || openQuantity(selectedRecord) <= 0 || loadingDetail}
              >
                Record Return
              </button>
            ) : null}
          </div>

          {!selectedRecord ? (
            <div className="empty-state">Choose a lending record from the left to inspect its quantities and return history.</div>
          ) : (
            <div className="sales-detail-stack">
              <div className="sales-detail-grid">
                <div className="customer-detail-card">
                  <span>Status</span>
                  <strong>{friendlyStatus(selectedRecord.status)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Quantity Lent</span>
                  <strong>{fmtNumber(selectedRecord.total_quantity_lent)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Returned</span>
                  <strong>{fmtNumber(selectedRecord.total_quantity_returned)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Open Qty</span>
                  <strong>{fmtNumber(openQuantity(selectedRecord))}</strong>
                </div>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>Customer</dt>
                  <dd>{selectedRecord.customer_name || selectedRecord.customer_id}</dd>
                </div>
                <div>
                  <dt>Sale Reference</dt>
                  <dd>{selectedRecord.sale_id}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{selectedRecord.location_name || selectedRecord.location_id}</dd>
                </div>
                <div>
                  <dt>Remarks</dt>
                  <dd>{selectedRecord.remarks || 'No lending note recorded.'}</dd>
                </div>
              </dl>

              <section className="sales-line-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Lent items</div>
                    <h3>{loadingDetail ? 'Loading line detail...' : 'Current lines'}</h3>
                  </div>
                </div>
                {!selectedDetail ? (
                  <div className="empty-state">Full line detail is not cached for this record yet. Open it once while online to store the detail on this desktop.</div>
                ) : (
                  <div className="cart-list">
                    {selectedDetail.lines.map((line) => (
                      <div key={line.lending_line_id} className="cart-row">
                        <div>
                          <strong>{line.product_name || line.product_id}</strong>
                          <span>{line.product_sku || 'No SKU'} · Open {fmtNumber(line.quantity_open)}</span>
                        </div>
                        <strong>Lent {fmtNumber(line.quantity_lent)}</strong>
                        <strong>Returned {fmtNumber(line.quantity_returned)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="sales-sync-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Return history</div>
                    <h3>Recorded returns</h3>
                  </div>
                </div>
                {!selectedDetail || selectedDetail.returns.length === 0 ? (
                  <div className="empty-state">No return history is cached for this desktop record yet.</div>
                ) : (
                  <div className="recent-sales-list">
                    {selectedDetail.returns.map((entry) => (
                      <article key={entry.lending_return_id} className="recent-sale-card">
                        <div>
                          <strong>{fmtNumber(entry.returned_qty)} returned</strong>
                          <span>{entry.condition} · {entry.received_by_name || 'Branch staff'}</span>
                        </div>
                        <div>
                          <strong>{new Date(entry.returned_at).toLocaleDateString()}</strong>
                          <span>{entry.remarks || 'No return note'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </section>

      {returnModalOpen && selectedDetail ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card wide-modal">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Lending return</div>
                <h3>{selectedRecord?.customer_name || selectedRecord?.sale_id}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="cart-list">
              {returnableLines.map((line) => (
                <div key={line.lending_line_id} className="return-line-grid">
                  <div>
                    <strong>{line.product_name || line.product_id}</strong>
                    <span>Open quantity {fmtNumber(line.quantity_open)}</span>
                  </div>
                  <label>
                    <span>Return Qty</span>
                    <input
                      value={returnLines[line.lending_line_id]?.returnedQty ?? ''}
                      onChange={(event) =>
                        setReturnLines((prev) => ({
                          ...prev,
                          [line.lending_line_id]: {
                            ...prev[line.lending_line_id],
                            returnedQty: event.target.value
                          }
                        }))
                      }
                      placeholder="0"
                    />
                  </label>
                  <label>
                    <span>Condition</span>
                    <select
                      value={returnLines[line.lending_line_id]?.condition ?? 'GOOD'}
                      onChange={(event) =>
                        setReturnLines((prev) => ({
                          ...prev,
                          [line.lending_line_id]: {
                            ...prev[line.lending_line_id],
                            condition: event.target.value as ReturnLineState['condition']
                          }
                        }))
                      }
                    >
                      {RETURN_CONDITIONS.map((condition) => (
                        <option key={condition} value={condition}>
                          {condition}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <label className="full-width-field">
              <span>Return Remarks</span>
              <textarea
                value={returnRemarks}
                onChange={(event) => setReturnRemarks(event.target.value)}
                placeholder="Reason, condition note, or receiving remark"
              />
            </label>
            <div className="action-row desktop-settings-actions">
              <button className="secondary-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleSubmitReturn()} disabled={savingReturn}>
                {savingReturn ? 'Saving Return...' : 'Save Return'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}
