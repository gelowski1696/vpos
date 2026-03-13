'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

type AuditLogRow = {
  id: string;
  created_at: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  action: string;
  entity: string;
  entity_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_branch_id?: string | null;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
};

export default function AuditLogsPage(): JSX.Element {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        query.set('limit', '200');
        if (branchId) {
          query.set('branch_id', branchId);
        }
        const [data, branchRows] = await Promise.all([
          apiRequest<{ rows: AuditLogRow[] }>(`/reports/audit-logs?${query.toString()}`),
          apiRequest<BranchRow[]>('/master-data/branches')
        ]);
        setRows(data.rows ?? []);
        setBranches(branchRows ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load audit logs');
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId]);

  return (
    <main>
      <h1 className="text-2xl font-bold text-brandPrimary">Audit Logs</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Read-only timeline of sensitive actions from tenant-scoped operations.</p>
      <div className="mt-3 max-w-sm">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">Branch Filter</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            onChange={(event) => setBranchId(event.target.value)}
            value={branchId}
          >
            <option value="">All Branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading audit logs...</p> : null}
      {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}

      {!loading && !error ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="pb-2 pr-3">When</th>
                  <th className="pb-2 pr-3">Level</th>
                  <th className="pb-2 pr-3">Action</th>
                  <th className="pb-2 pr-3">Entity</th>
                  <th className="pb-2 pr-3">Entity ID</th>
                  <th className="pb-2 pr-3">User</th>
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="border-t border-slate-100 text-slate-800 dark:border-slate-700 dark:text-slate-200" key={row.id}>
                    <td className="py-2 pr-3">{row.created_at}</td>
                    <td className="py-2 pr-3">{row.level}</td>
                    <td className="py-2 pr-3">{row.action}</td>
                    <td className="py-2 pr-3">{row.entity}</td>
                    <td className="py-2 pr-3">{row.entity_id ?? ''}</td>
                    <td className="py-2 pr-3">{row.user_name ?? ''}</td>
                    <td className="py-2">{row.user_email ?? ''}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500 dark:text-slate-400" colSpan={7}>
                      No audit records for the selected scope.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
