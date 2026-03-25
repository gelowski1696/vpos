'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type Branch = { id: string; code: string; name: string; isActive: boolean };
type Customer = { id: string; code: string; name: string };
type InventoryCard = {
  id: string;
  card_uid: string;
  card_number: string;
  serial_number: string | null;
  status: 'UNASSIGNED' | 'ASSIGNED' | 'INACTIVE' | 'REVOKED';
  branch_id: string | null;
  location_id: string | null;
  updated_at: string;
};
type CustomerCard = {
  id: string;
  customer: { id: string; code: string; name: string; points_balance: number };
  card: InventoryCard;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  assigned_at: string;
};
type PointsPolicy = {
  earn_peso_per_point: number;
  redeem_peso_per_point: number;
  min_spend_for_earn: number;
  max_redeem_points_per_txn: number | null;
  points_expiry_days: number | null;
  updated_at: string;
};
type PointsLedger = {
  id: string;
  customer_id: string;
  txn_type: string;
  points: number;
  source_type: string;
  remarks: string | null;
  created_at: string;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function parseNum(v: string, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseOpt(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function CustomerCardsPage(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [assignCardId, setAssignCardId] = useState('');

  const [inventoryCards, setInventoryCards] = useState<InventoryCard[]>([]);
  const [customerCards, setCustomerCards] = useState<CustomerCard[]>([]);
  const [selectedCustomerCardId, setSelectedCustomerCardId] = useState('');
  const [reassignCustomerId, setReassignCustomerId] = useState('');

  const [policy, setPolicy] = useState<PointsPolicy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [earnRatio, setEarnRatio] = useState('100');
  const [redeemRatio, setRedeemRatio] = useState('1');
  const [minSpend, setMinSpend] = useState('0');
  const [maxRedeem, setMaxRedeem] = useState('');
  const [expiryDays, setExpiryDays] = useState('');

  const [pointsBusy, setPointsBusy] = useState(false);
  const [pointsCustomerId, setPointsCustomerId] = useState('');
  const [pointsCardId, setPointsCardId] = useState('');
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsValue, setPointsValue] = useState('');
  const [pointsRemarks, setPointsRemarks] = useState('');
  const [ledger, setLedger] = useState<PointsLedger[]>([]);

  const selectedCard = useMemo(
    () => customerCards.find((r) => r.id === selectedCustomerCardId) ?? null,
    [customerCards, selectedCustomerCardId]
  );
  const assignableCards = useMemo(
    () => inventoryCards.filter((r) => r.status === 'UNASSIGNED'),
    [inventoryCards]
  );
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  function getErrorMessage(cause: unknown, fallback: string): string {
    if (cause instanceof Error && cause.message.trim()) {
      return cause.message;
    }
    return fallback;
  }

  async function loadBase(): Promise<void> {
    const [b, c] = await Promise.all([
      apiRequest<Branch[]>('/master-data/branches'),
      apiRequest<Customer[]>('/master-data/customers')
    ]);
    const active = (b ?? []).filter((x) => x.isActive);
    setBranches(active);
    setCustomers(c ?? []);
    setBranchId((current) => (current && active.some((x) => x.id === current) ? current : active[0]?.id ?? ''));
    setCustomerId((current) => (current && (c ?? []).some((x) => x.id === current) ? current : c?.[0]?.id ?? ''));
    setReassignCustomerId((current) => (current && (c ?? []).some((x) => x.id === current) ? current : c?.[0]?.id ?? ''));
  }

  async function loadCards(): Promise<void> {
    if (!branchId) {
      setInventoryCards([]);
      setCustomerCards([]);
      return;
    }
    const [inventory, bound] = await Promise.all([
      apiRequest<InventoryCard[]>(`/vcard/inventory/cards?branch_id=${encodeURIComponent(branchId)}&limit=300`),
      apiRequest<CustomerCard[]>('/vcard/cards?limit=300')
    ]);
    const branchBound = (bound ?? []).filter((row) => row.card.branch_id === branchId);
    setInventoryCards(inventory ?? []);
    setCustomerCards(branchBound);
    setAssignCardId((current) => {
      if (current && (inventory ?? []).some((x) => x.id === current && x.status === 'UNASSIGNED')) return current;
      return (inventory ?? []).find((x) => x.status === 'UNASSIGNED')?.id ?? '';
    });
    setSelectedCustomerCardId((current) => {
      if (current && branchBound.some((x) => x.id === current)) return current;
      return branchBound[0]?.id ?? '';
    });
  }

  async function loadPolicy(): Promise<void> {
    const p = await apiRequest<PointsPolicy>('/vcard/points/policy');
    setPolicy(p);
    setEarnRatio(String(p.earn_peso_per_point));
    setRedeemRatio(String(p.redeem_peso_per_point));
    setMinSpend(String(p.min_spend_for_earn));
    setMaxRedeem(p.max_redeem_points_per_txn == null ? '' : String(p.max_redeem_points_per_txn));
    setExpiryDays(p.points_expiry_days == null ? '' : String(p.points_expiry_days));
  }

  async function loadLedger(targetCustomerId?: string): Promise<void> {
    const q = new URLSearchParams({ limit: '200' });
    if (targetCustomerId?.trim()) q.set('customer_id', targetCustomerId.trim());
    const rows = await apiRequest<PointsLedger[]>(`/vcard/points/ledger?${q.toString()}`);
    setLedger(rows ?? []);
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadBase();
        await loadPolicy();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load page.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) return;
    void loadCards().catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load cards.');
      setError(message);
      toastError('Load cards failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (!pointsCustomerId) return;
    void loadLedger(pointsCustomerId).catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load points ledger.');
      setError(message);
      toastError('Load points ledger failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsCustomerId]);

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      await Promise.all([loadCards(), loadPolicy(), loadLedger(pointsCustomerId)]);
      toastSuccess('Data refreshed');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to refresh.';
      setError(message);
      toastError('Refresh failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function assign(): Promise<void> {
    if (!customerId || !assignCardId) {
      toastInfo('Select customer and card first');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/vcard/cards/assign', {
        method: 'POST',
        body: { customer_id: customerId, card_inventory_id: assignCardId }
      });
      toastSuccess('Card assigned');
      setPointsCustomerId(customerId);
      await loadCards();
      await loadLedger(customerId);
    } catch (cause) {
      toastError('Assign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function doStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'REVOKED'): Promise<void> {
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status }
      });
      toastSuccess(`Card is now ${status.toLowerCase()}`);
      await loadCards();
    } catch (cause) {
      toastError('Status update failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function unassign(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(id)}/unassign`, { method: 'PATCH', body: {} });
      toastSuccess('Card unassigned');
      await loadCards();
    } catch (cause) {
      toastError('Unassign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function reassign(id: string): Promise<void> {
    if (!reassignCustomerId) {
      toastInfo('Select customer for reassign');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(id)}/reassign`, {
        method: 'PATCH',
        body: { customer_id: reassignCustomerId }
      });
      toastSuccess('Card reassigned');
      setPointsCustomerId(reassignCustomerId);
      await loadCards();
      await loadLedger(reassignCustomerId);
    } catch (cause) {
      toastError('Reassign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(): Promise<void> {
    setPolicyBusy(true);
    try {
      await apiRequest('/vcard/points/policy', {
        method: 'PUT',
        body: {
          earn_peso_per_point: parseNum(earnRatio, 100),
          redeem_peso_per_point: parseNum(redeemRatio, 1),
          min_spend_for_earn: parseNum(minSpend, 0),
          max_redeem_points_per_txn: parseOpt(maxRedeem),
          points_expiry_days: parseOpt(expiryDays)
        }
      });
      await loadPolicy();
      toastSuccess('Points policy saved');
    } catch (cause) {
      toastError('Policy save failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setPolicyBusy(false);
    }
  }

  async function submitPoints(action: 'earn' | 'redeem' | 'adjust'): Promise<void> {
    if (!pointsCustomerId) {
      toastInfo('Select customer first');
      return;
    }
    setPointsBusy(true);
    try {
      if (action === 'earn') {
        await apiRequest('/vcard/points/earn', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            amount: parseOpt(pointsAmount),
            points: parseOpt(pointsValue),
            remarks: pointsRemarks || null
          }
        });
      } else if (action === 'redeem') {
        await apiRequest('/vcard/points/redeem', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            amount: parseOpt(pointsAmount),
            points: parseNum(pointsValue, 0),
            remarks: pointsRemarks || null
          }
        });
      } else {
        await apiRequest('/vcard/points/adjust', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            delta_points: parseNum(pointsValue, 0),
            remarks: pointsRemarks || null
          }
        });
      }
      toastSuccess(`Points ${action} recorded`);
      await loadCards();
      await loadLedger(pointsCustomerId);
    } catch (cause) {
      toastError(`Points ${action} failed`, { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setPointsBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading customer cards...</p>;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-brandPrimary">Customer Cards</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Branch card assignment, revoke/reactivate, and points in one non-technical workflow.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-4">
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Select branch...</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer...</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={assignCardId} onChange={(e) => setAssignCardId(e.target.value)}>
            <option value="">Select unassigned card...</option>
            {assignableCards.map((c) => <option key={c.id} value={c.id}>{c.card_number} | {c.card_uid}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded-lg bg-brandPrimary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !branchId || !customerId || !assignCardId} onClick={() => void assign()}>Assign</button>
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={busy} onClick={() => void refresh()}>{busy ? '...' : 'Refresh'}</button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Only cards created for the selected branch are shown.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Assigned Cards (Branch)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Card</th><th className="px-3 py-2">UID</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Points</th><th className="px-3 py-2">Assigned</th></tr></thead>
            <tbody>
              {customerCards.length === 0 ? <tr><td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={6}>No assigned cards in this branch.</td></tr> : customerCards.map((row) => (
                <tr key={row.id} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${row.id === selectedCustomerCardId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`} onClick={() => { setSelectedCustomerCardId(row.id); setReassignCustomerId(row.customer.id); setPointsCustomerId(row.customer.id); setPointsCardId(row.card.id); }}>
                  <td className="px-3 py-2">{row.customer.name}</td><td className="px-3 py-2">{row.card.card_number}</td><td className="px-3 py-2">{row.card.card_uid}</td><td className="px-3 py-2">{row.status}</td><td className="px-3 py-2">{row.customer.points_balance}</td><td className="px-3 py-2">{fmtDate(row.assigned_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedCard ? (
          <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-[1fr_auto_auto_auto_auto]">
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={reassignCustomerId} onChange={(e) => setReassignCustomerId(e.target.value)}>
              <option value="">Select customer for reassign...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={busy} onClick={() => void reassign(selectedCard.id)}>Reassign</button>
            <button type="button" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 disabled:opacity-60" disabled={busy} onClick={() => void doStatus(selectedCard.id, selectedCard.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE')}>{selectedCard.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}</button>
            <button type="button" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100 disabled:opacity-60" disabled={busy} onClick={() => void doStatus(selectedCard.id, selectedCard.status === 'REVOKED' ? 'ACTIVE' : 'REVOKED')}>{selectedCard.status === 'REVOKED' ? 'Reactivate' : 'Revoke'}</button>
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={busy} onClick={() => void unassign(selectedCard.id)}>Unassign</button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Points Policy</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Updated: {fmtDate(policy?.updated_at ?? null)}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={earnRatio} onChange={(e) => setEarnRatio(e.target.value)} placeholder="Earn PHP/point" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={redeemRatio} onChange={(e) => setRedeemRatio(e.target.value)} placeholder="Redeem PHP/point" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="Min spend" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={maxRedeem} onChange={(e) => setMaxRedeem(e.target.value)} placeholder="Max redeem points (optional)" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} placeholder="Expiry days (optional)" />
        </div>
        <button type="button" className="mt-3 rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={policyBusy} onClick={() => void savePolicy()}>{policyBusy ? 'Saving...' : 'Save Policy'}</button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Points Actions</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsCustomerId} onChange={(e) => setPointsCustomerId(e.target.value)}>
            <option value="">Select customer...</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsCardId} onChange={(e) => setPointsCardId(e.target.value)} placeholder="Card ID (optional)" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsAmount} onChange={(e) => setPointsAmount(e.target.value)} placeholder="Amount (optional)" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsValue} onChange={(e) => setPointsValue(e.target.value)} placeholder="Points / Delta" />
          <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsRemarks} onChange={(e) => setPointsRemarks(e.target.value)} placeholder="Remarks" />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('earn')}>Earn</button>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('redeem')}>Redeem</button>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('adjust')}>Adjust</button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Points</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Remarks</th></tr></thead>
            <tbody>
              {ledger.length === 0 ? <tr><td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={6}>No points transactions found.</td></tr> : ledger.slice(0, 100).map((row) => (
                <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{fmtDate(row.created_at)}</td>
                  <td className="px-3 py-2">{customerNameById.get(row.customer_id) ?? row.customer_id}</td>
                  <td className="px-3 py-2">{row.txn_type}</td>
                  <td className="px-3 py-2">{row.points}</td>
                  <td className="px-3 py-2">{row.source_type}</td>
                  <td className="px-3 py-2">{row.remarks ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
