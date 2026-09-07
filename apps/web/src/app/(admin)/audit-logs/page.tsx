'use client';

import { useEffect, useMemo, useState } from 'react';
import { TablePaginationControls } from '../../../components/table-pagination-controls';
import { apiRequest, getSessionCompanyId, getSessionRoles } from '../../../lib/api-client';
import { useTablePagination } from '../../../lib/table-pagination';

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
  metadata?: unknown;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
};

type TenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
};

function formatWhen(value: string): string {
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2]}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const pad = (num: number): string => String(num).padStart(2, '0');
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`;
}

function branchIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  const direct = record.branch_id;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const camel = record.branchId;
  if (typeof camel === 'string' && camel.trim()) {
    return camel.trim();
  }
  return null;
}

export default function AuditLogsPage(): JSX.Element {
  const sessionRoles = useMemo(() => getSessionRoles(), []);
  const sessionCompanyId = useMemo(() => getSessionCompanyId(), []);
  const isPlatformOwner = sessionRoles.includes('platform_owner');
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantSummary[]>([]);
  const [selectedTenantCompanyId, setSelectedTenantCompanyId] = useState(sessionCompanyId ?? '');
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformOwner) {
      return;
    }

    let active = true;
    const loadTenants = async (): Promise<void> => {
      setTenantLoading(true);
      setTenantLoadError(null);
      try {
        const tenantRows = await apiRequest<TenantSummary[]>('/platform/owner/tenants');
        if (!active) {
          return;
        }
        setTenantOptions(tenantRows);
        if (!selectedTenantCompanyId) {
          const preferred =
            sessionCompanyId && tenantRows.some((tenant) => tenant.company_id === sessionCompanyId)
              ? sessionCompanyId
              : tenantRows[0]?.company_id ?? '';
          setSelectedTenantCompanyId(preferred);
        }
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTenantLoadError(loadError instanceof Error ? loadError.message : 'Failed to load tenant list');
      } finally {
        if (active) {
          setTenantLoading(false);
        }
      }
    };

    void loadTenants();
    return () => {
      active = false;
    };
  }, [isPlatformOwner, selectedTenantCompanyId, sessionCompanyId]);

  const selectedTenantQuery = useMemo(() => {
    return isPlatformOwner && selectedTenantCompanyId
      ? `companyId=${encodeURIComponent(selectedTenantCompanyId)}`
      : '';
  }, [isPlatformOwner, selectedTenantCompanyId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        query.set('limit', '200');
        if (isPlatformOwner && selectedTenantCompanyId) {
          query.set('companyId', selectedTenantCompanyId);
        }
        if (branchId) {
          query.set('branch_id', branchId);
        }
        const branchesEndpoint = selectedTenantQuery
          ? `/master-data/branches?${selectedTenantQuery}`
          : '/master-data/branches';
        const [data, branchRows] = await Promise.all([
          apiRequest<{ rows: AuditLogRow[] }>(`/reports/audit-logs?${query.toString()}`),
          apiRequest<BranchRow[]>(branchesEndpoint)
        ]);
        setRows(data.rows ?? []);
        setBranches(branchRows ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load audit logs');
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId, isPlatformOwner, selectedTenantCompanyId, selectedTenantQuery]);

  const paginatedRows = useTablePagination(rows, {
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetKey: `${selectedTenantCompanyId}|${branchId}|${rows.length}`
  });

  return (
    <main>
      <h1 className="text-2xl font-bold text-brandPrimary">Audit Logs</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Read-only timeline of sensitive actions from tenant-scoped operations.</p>
      <div className="mt-3 grid gap-3 md:max-w-3xl md:grid-cols-2">
        {isPlatformOwner ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Tenant Scope</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              disabled={tenantLoading}
              onChange={(event) => {
                setSelectedTenantCompanyId(event.target.value);
                setBranchId('');
              }}
              value={selectedTenantCompanyId}
            >
              {tenantOptions.length === 0 ? <option value={selectedTenantCompanyId}>Current Tenant</option> : null}
              {tenantOptions.map((tenant) => (
                <option key={tenant.company_id} value={tenant.company_id}>
                  {tenant.company_name} ({tenant.company_code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
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

      {tenantLoadError ? <p className="mt-3 text-sm text-rose-700">{tenantLoadError}</p> : null}
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
                  <th className="pb-2 pr-3">Branch</th>
                  <th className="pb-2 pr-3">User</th>
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.pageRows.map((row) => (
                  <tr className="border-t border-slate-100 text-slate-800 dark:border-slate-700 dark:text-slate-200" key={row.id}>
                    <td className="py-2 pr-3">{formatWhen(row.created_at)}</td>
                    <td className="py-2 pr-3">{row.level}</td>
                    <td className="py-2 pr-3">{row.action}</td>
                    <td className="py-2 pr-3">{row.entity}</td>
                    <td className="py-2 pr-3">{row.entity_id ?? ''}</td>
                    <td className="py-2 pr-3">{row.user_branch_id ?? branchIdFromMetadata(row.metadata) ?? ''}</td>
                    <td className="py-2 pr-3">{row.user_name ?? ''}</td>
                    <td className="py-2">{row.user_email ?? ''}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500 dark:text-slate-400" colSpan={8}>
                      No audit records for the selected scope.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <TablePaginationControls
            endRow={paginatedRows.endRow}
            onPageChange={paginatedRows.setPage}
            onPageSizeChange={paginatedRows.setPageSize}
            page={paginatedRows.page}
            pageSize={paginatedRows.pageSize}
            pageSizeOptions={paginatedRows.pageSizeOptions}
            startRow={paginatedRows.startRow}
            totalItems={paginatedRows.totalItems}
            totalPages={paginatedRows.totalPages}
          />
        </section>
      ) : null}
    </main>
  );
}
