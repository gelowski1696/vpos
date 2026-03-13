'use client';

import { useEffect, useMemo, useState } from 'react';
import { EntityManager, type SelectOption } from '../../../components/entity-manager';
import { apiRequest, getSessionCompanyId, getSessionRoles } from '../../../lib/api-client';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type TenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
};

function locationTypeLabel(value: unknown): string {
  if (value === 'BRANCH_WAREHOUSE') {
    return 'Branch Warehouse';
  }
  if (value === 'TRUCK') {
    return 'Delivery Truck';
  }
  if (value === 'PERSONNEL') {
    return 'Personnel';
  }
  return 'Branch Store';
}

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

export default function LocationsPage(): JSX.Element {
  const sessionRoles = useMemo(() => getSessionRoles(), []);
  const sessionCompanyId = useMemo(() => getSessionCompanyId(), []);
  const isPlatformOwner = sessionRoles.includes('platform_owner');
  const canEdit = sessionRoles.includes('owner') || sessionRoles.includes('platform_owner');

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [tenantOptions, setTenantOptions] = useState<SelectOption[]>([]);
  const [selectedTenantCompanyId, setSelectedTenantCompanyId] = useState(sessionCompanyId ?? '');
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleteNotice, setHardDeleteNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformOwner) {
      return;
    }

    let active = true;
    const loadTenants = async (): Promise<void> => {
      try {
        const rows = await apiRequest<TenantSummary[]>('/platform/owner/tenants');
        if (!active) {
          return;
        }

        const options = rows.map((row) => ({
          value: row.company_id,
          label: `${row.company_name} (${row.company_code})`
        }));
        setTenantOptions(options);
        setTenantLoadError(null);
        if (!selectedTenantCompanyId) {
          const preferred =
            sessionCompanyId && options.some((option) => option.value === sessionCompanyId)
              ? sessionCompanyId
              : options[0]?.value ?? '';
          setSelectedTenantCompanyId(preferred);
        }
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTenantLoadError(loadError instanceof Error ? loadError.message : 'Failed to load tenant list');
      }
    };

    void loadTenants();
    return () => {
      active = false;
    };
  }, [isPlatformOwner, selectedTenantCompanyId, sessionCompanyId]);

  const branchesEndpoint = useMemo(() => {
    if (isPlatformOwner && selectedTenantCompanyId) {
      return `/master-data/branches?companyId=${encodeURIComponent(selectedTenantCompanyId)}`;
    }
    return '/master-data/branches';
  }, [isPlatformOwner, selectedTenantCompanyId]);

  const locationsEndpoint = useMemo(() => {
    if (isPlatformOwner && selectedTenantCompanyId) {
      return `/master-data/locations?companyId=${encodeURIComponent(selectedTenantCompanyId)}`;
    }
    return '/master-data/locations';
  }, [isPlatformOwner, selectedTenantCompanyId]);

  async function handlePermanentDelete(row: Record<string, unknown>): Promise<void> {
    if (!isPlatformOwner) {
      return;
    }
    const id = String(row.id ?? '').trim();
    if (!id) {
      return;
    }
    const label = String(row.name ?? row.code ?? id);
    const confirmed = window.confirm(
      `Permanently delete location "${label}"? This cannot be undone and will fail if linked transactions exist.`
    );
    if (!confirmed) {
      return;
    }

    setHardDeleteError(null);
    setHardDeleteNotice(null);
    try {
      const query =
        isPlatformOwner && selectedTenantCompanyId
          ? `?companyId=${encodeURIComponent(selectedTenantCompanyId)}`
          : '';
      await apiRequest(`/master-data/locations/${encodeURIComponent(id)}/permanent${query}`, {
        method: 'DELETE'
      });
      setHardDeleteNotice(`Location "${label}" permanently deleted.`);
      setReloadSignal((current) => current + 1);
    } catch (error) {
      setHardDeleteError(error instanceof Error ? error.message : 'Failed to permanently delete location');
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const rows = await apiRequest<BranchRecord[]>(branchesEndpoint);
        setBranches(rows.filter((item) => item.isActive));
      } catch {
        setBranches([]);
      }
    })();
  }, [branchesEndpoint]);

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'Not linked to a branch' },
      ...branches.map((branch) => ({
        value: branch.id,
        label: `${branch.name} (${branch.code})`
      }))
    ],
    [branches]
  );

  const branchNameById = useMemo(
    () =>
      new Map(
        branches.map((branch) => [
          branch.id,
          `${branch.name} (${branch.code})`
        ])
      ),
    [branches]
  );

  return (
    <div className="space-y-3">
      {isPlatformOwner ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <label className="flex flex-col gap-1 text-sm md:max-w-md">
            <span className="font-medium text-slate-700 dark:text-slate-200">Tenant Scope</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setSelectedTenantCompanyId(event.target.value)}
              value={selectedTenantCompanyId}
            >
              <option value="">Select tenant...</option>
              {tenantOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Location list and save actions are scoped to the selected tenant.
            </span>
          </label>
          {tenantLoadError ? <p className="mt-2 text-xs text-rose-700">{tenantLoadError}</p> : null}
        </div>
      ) : null}

      {hardDeleteNotice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{hardDeleteNotice}</p> : null}
      {hardDeleteError ? <p className="text-sm text-rose-700">{hardDeleteError}</p> : null}

      <EntityManager
        allowDelete={canEdit}
        defaultValues={{ code: '', name: '', type: 'BRANCH_STORE', branchId: '', isActive: true }}
        deleteConfirmText="Safe delete is allowed only for locations not linked to a branch. Linked locations must be deleted via branch safe delete."
        reactivateConfirmText="This will reactivate the location."
        endpoint={locationsEndpoint}
        fields={[
          {
            key: 'code',
            label: 'Location Code',
            required: true,
            helperText: 'Short unique code, for example LOC-MAIN or TRUCK-01.'
          },
          {
            key: 'name',
            label: 'Location Name',
            required: true,
            helperText: 'Name shown during transfers and stock movement.'
          },
          {
            key: 'type',
            label: 'Location Type',
            type: 'select',
            required: true,
            options: [
              { value: 'BRANCH_STORE', label: 'Branch Store' },
              { value: 'BRANCH_WAREHOUSE', label: 'Branch Warehouse' },
              { value: 'TRUCK', label: 'Delivery Truck' },
              { value: 'PERSONNEL', label: 'Personnel' }
            ]
          },
          {
            key: 'branchId',
            label: 'Linked Branch',
            type: 'select',
            options: branchOptions,
            helperText: 'Link this location to a branch when applicable.'
          }
        ]}
        tableColumnOverrides={{
          type: {
            label: 'Location Type',
            render: (value) => locationTypeLabel(value)
          },
          branchId: {
            label: 'Linked Branch',
            render: (value) => {
              const key = value ? String(value) : '';
              return key ? branchNameById.get(key) ?? key : 'Not linked';
            }
          },
          isActive: {
            label: 'Active',
            render: (value) => yesNo(value)
          }
        }}
        readOnly={!canEdit}
        reloadSignal={reloadSignal}
        rowActions={
          isPlatformOwner
            ? [
                {
                  key: 'hard-delete',
                  label: 'Delete Permanently',
                  buttonClassName:
                    'rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40',
                  onClick: (row) => {
                    void handlePermanentDelete(row);
                  }
                }
              ]
            : []
        }
        title="Locations"
        transformBeforeSubmit={(payload) => ({
          ...payload,
          companyId: isPlatformOwner ? selectedTenantCompanyId || undefined : undefined,
          branchId: payload.branchId ? payload.branchId : null
        })}
      />
    </div>
  );
}
