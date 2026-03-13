'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest, getSessionRoles } from '../../../lib/api-client';
import { toastError, toastSuccess } from '../../../lib/web-toast';

type CostingConfigRecord = {
  method: 'WAC' | 'STANDARD' | 'LAST_PURCHASE' | 'MANUAL_OVERRIDE';
  allowManualOverride: boolean;
  negativeStockPolicy: 'BLOCK_POSTING' | 'ALLOW_WITH_REVIEW';
  includeFreight: boolean;
  includeHandling: boolean;
  includeOtherLandedCost: boolean;
  allocationBasis: 'PER_QUANTITY' | 'PER_WEIGHT';
  roundingScale: number;
  locked: boolean;
  updatedAt: string;
};

const DEFAULT_CONFIG: CostingConfigRecord = {
  method: 'WAC',
  allowManualOverride: false,
  negativeStockPolicy: 'BLOCK_POSTING',
  includeFreight: false,
  includeHandling: false,
  includeOtherLandedCost: false,
  allocationBasis: 'PER_QUANTITY',
  roundingScale: 4,
  locked: false,
  updatedAt: new Date(0).toISOString()
};

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export default function CostingPage(): JSX.Element {
  const [config, setConfig] = useState<CostingConfigRecord>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  const canEdit = useMemo(
    () =>
      roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );

  useEffect(() => {
    setRoles(getSessionRoles());
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const row = await apiRequest<CostingConfigRecord>('/master-data/costing-config');
      setConfig(row);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load costing setup';
      setError(message);
      toastError('Failed to load costing setup', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(): Promise<void> {
    if (!canEdit) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        method: config.method,
        allowManualOverride: config.allowManualOverride,
        negativeStockPolicy: config.negativeStockPolicy,
        includeFreight: config.includeFreight,
        includeHandling: config.includeHandling,
        includeOtherLandedCost: config.includeOtherLandedCost,
        allocationBasis: config.allocationBasis,
        roundingScale: Number(config.roundingScale),
        locked: config.locked
      };
      const updated = await apiRequest<CostingConfigRecord>('/master-data/costing-config', {
        method: 'PUT',
        body: payload
      });
      setConfig(updated);
      toastSuccess('Costing setup saved.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save costing setup';
      setError(message);
      toastError('Failed to save costing setup', { description: message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading costing setup...</p>;
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Costing Setup</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure how server-side COGS is finalized during sale posting.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Last updated: {new Date(config.updatedAt).toLocaleString()}
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : null}
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            COGS Calculation
          </h3>
          <div className="mt-3 space-y-3 text-sm">
            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">Costing Method</span>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    method: event.target.value as CostingConfigRecord['method']
                  }))
                }
                value={config.method}
              >
                <option value="WAC">Weighted Average Cost (WAC)</option>
                <option value="STANDARD">Standard Cost (per product)</option>
                <option value="LAST_PURCHASE">Last Purchase Cost</option>
                <option value="MANUAL_OVERRIDE">Manual Override (supervised)</option>
              </select>
            </label>

            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Negative Stock Behavior
              </span>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    negativeStockPolicy:
                      event.target.value as CostingConfigRecord['negativeStockPolicy']
                  }))
                }
                value={config.negativeStockPolicy}
              >
                <option value="BLOCK_POSTING">Block Posting</option>
                <option value="ALLOW_WITH_REVIEW">Allow with Review</option>
              </select>
            </label>

            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">Rounding Scale</span>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    roundingScale: Number(event.target.value)
                  }))
                }
                value={String(config.roundingScale)}
              >
                <option value="2">2 decimals</option>
                <option value="3">3 decimals</option>
                <option value="4">4 decimals</option>
              </select>
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Allow Manual Override</span>
              <input
                checked={config.allowManualOverride}
                className="h-4 w-4"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, allowManualOverride: event.target.checked }))
                }
                type="checkbox"
              />
            </label>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Landed Cost Allocation (Inbound)
          </h3>
          <div className="mt-3 space-y-3 text-sm">
            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">Allocation Basis</span>
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    allocationBasis: event.target.value as CostingConfigRecord['allocationBasis']
                  }))
                }
                value={config.allocationBasis}
              >
                <option value="PER_QUANTITY">Per Quantity</option>
                <option value="PER_WEIGHT">Per Weight</option>
              </select>
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Include Freight</span>
              <input
                checked={config.includeFreight}
                className="h-4 w-4"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, includeFreight: event.target.checked }))
                }
                type="checkbox"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Include Handling</span>
              <input
                checked={config.includeHandling}
                className="h-4 w-4"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, includeHandling: event.target.checked }))
                }
                type="checkbox"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Include Other Costs</span>
              <input
                checked={config.includeOtherLandedCost}
                className="h-4 w-4"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    includeOtherLandedCost: event.target.checked
                  }))
                }
                type="checkbox"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Lock Costing Setup</span>
              <input
                checked={config.locked}
                className="h-4 w-4"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, locked: event.target.checked }))
                }
                type="checkbox"
              />
            </label>
          </div>
        </article>
      </section>

      <footer className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Current method: <span className="font-semibold">{config.method}</span> | Manual override:{' '}
            <span className="font-semibold">{yesNo(config.allowManualOverride)}</span>
          </p>
          <button
            className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canEdit || saving}
            onClick={() => {
              void save();
            }}
            type="button"
          >
            {saving ? 'Saving...' : 'Save Costing Setup'}
          </button>
        </div>
      </footer>
    </div>
  );
}
