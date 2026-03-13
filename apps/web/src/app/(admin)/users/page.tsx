'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityManager, type EntityField, type SelectOption } from '../../../components/entity-manager';
import { apiRequest, getSessionCompanyId, getSessionRoles } from '../../../lib/api-client';
import { buildQrSvgDataUrl } from '../../../lib/qr-svg';

type TenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
  client_id?: string;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
};

type LocationRow = {
  id: string;
  code: string;
  name: string;
  branchId?: string | null;
  isActive?: boolean;
};

type EnrollmentResponse = {
  id: string;
  expires_at: string;
  setup_token: string;
  setup_url: string;
  user: { id: string; email: string; full_name: string };
  branch: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string };
};

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'driver', label: 'Driver' },
  { value: 'helper', label: 'Helper' },
  { value: 'owner', label: 'Owner' },
  { value: 'platform_owner', label: 'Platform Owner' }
];

const roleLabelByValue = new Map(roleOptions.map((option) => [option.value, option.label]));

function roleLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => roleLabelByValue.get(String(item)) ?? String(item)).join(', ');
  }

  const key = String(value ?? '').trim();
  if (!key) {
    return '-';
  }
  return roleLabelByValue.get(key) ?? key;
}

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

function extractRoleList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  }
  const raw = String(value ?? '').trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function UsersPage(): JSX.Element {
  const sessionRoles = useMemo(() => getSessionRoles(), []);
  const sessionCompanyId = useMemo(() => getSessionCompanyId(), []);
  const isPlatformOwner = sessionRoles.includes('platform_owner');
  const canEdit = sessionRoles.includes('owner') || sessionRoles.includes('platform_owner');

  const [tenantOptions, setTenantOptions] = useState<SelectOption[]>([]);
  const [selectedTenantCompanyId, setSelectedTenantCompanyId] = useState(sessionCompanyId ?? '');
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleteNotice, setHardDeleteNotice] = useState<string | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupUser, setSetupUser] = useState<{ id: string; label: string; email: string } | null>(null);
  const [setupBranchOptions, setSetupBranchOptions] = useState<SelectOption[]>([]);
  const [setupLocationRows, setSetupLocationRows] = useState<LocationRow[]>([]);
  const [setupBranchId, setSetupBranchId] = useState('');
  const [setupLocationId, setSetupLocationId] = useState('');
  const [setupResult, setSetupResult] = useState<EnrollmentResponse | null>(null);
  const [setupQrDataUrl, setSetupQrDataUrl] = useState('');
  const [liveFormState, setLiveFormState] = useState<{
    mode: 'create' | 'edit';
    editingId: string | null;
    email: string;
    password: string;
  }>({
    mode: 'create',
    editingId: null,
    email: '',
    password: ''
  });
  const [liveEmailState, setLiveEmailState] = useState<'idle' | 'invalid' | 'checking' | 'exists' | 'available'>('idle');
  const emailCheckTokenRef = useRef(0);
  const emailCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const preferred = options[0]?.value ?? '';
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

  const companyLabelById = useMemo(
    () => new Map(tenantOptions.map((option) => [option.value, option.label])),
    [tenantOptions]
  );

  const setupLocationOptions = useMemo(() => {
    return setupLocationRows
      .filter((row) => row.isActive !== false)
      .filter((row) => !setupBranchId || (row.branchId ?? '') === setupBranchId)
      .map((row) => ({
        value: row.id,
        label: `${row.name} (${row.code})`
      }));
  }, [setupBranchId, setupLocationRows]);

  useEffect(() => {
    if (!setupLocationOptions.length) {
      setSetupLocationId('');
      return;
    }
    if (!setupLocationOptions.some((row) => row.value === setupLocationId)) {
      setSetupLocationId(setupLocationOptions[0]?.value ?? '');
    }
  }, [setupLocationId, setupLocationOptions]);

  const baseFields: EntityField[] = useMemo(
    () => [
      {
        key: 'email',
        label: 'Email Address',
        type: 'text',
        required: true,
        helperText: 'Used as the login name for this user.'
      },
      {
        key: 'fullName',
        label: 'Full Name',
        required: true,
        helperText: 'Display name shown in logs and transactions.'
      },
      {
        key: 'roles',
        label: 'User Role',
        type: 'select',
        required: true,
        options: roleOptions,
        helperText: 'Select the main role for this user account.'
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        placeholder: 'Leave blank to keep current password',
        helperText:
          'Optional. If provided, must be at least 8 characters with uppercase, lowercase, and number.',
        tableHidden: true
      }
    ],
    []
  );

  const fields = baseFields;

  const defaultValues = useMemo(
    () => ({
      email: '',
      fullName: '',
      roles: 'cashier',
      password: '',
      isActive: true
    }),
    [selectedTenantCompanyId]
  );

  const endpoint = useMemo(() => {
    if (isPlatformOwner && selectedTenantCompanyId) {
      return `/master-data/users?companyId=${encodeURIComponent(selectedTenantCompanyId)}`;
    }
    return '/master-data/users';
  }, [isPlatformOwner, selectedTenantCompanyId]);

  useEffect(() => {
    if (emailCheckTimerRef.current) {
      clearTimeout(emailCheckTimerRef.current);
      emailCheckTimerRef.current = null;
    }

    const normalizedEmail = liveFormState.email.trim().toLowerCase();
    if (!normalizedEmail) {
      setLiveEmailState('idle');
      return;
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isValidEmail) {
      setLiveEmailState('invalid');
      return;
    }

    if (isPlatformOwner && !selectedTenantCompanyId) {
      setLiveEmailState('idle');
      return;
    }

    const token = emailCheckTokenRef.current + 1;
    emailCheckTokenRef.current = token;
    setLiveEmailState('checking');
    emailCheckTimerRef.current = setTimeout(() => {
      const query = new URLSearchParams();
      query.set('email', normalizedEmail);
      if (isPlatformOwner && selectedTenantCompanyId) {
        query.set('companyId', selectedTenantCompanyId);
      }
      if (liveFormState.mode === 'edit' && liveFormState.editingId) {
        query.set('excludeUserId', liveFormState.editingId);
      }

      void apiRequest<{ exists: boolean }>(`/master-data/users/email-exists?${query.toString()}`)
        .then((result) => {
          if (emailCheckTokenRef.current !== token) {
            return;
          }
          setLiveEmailState(result.exists ? 'exists' : 'available');
        })
        .catch(() => {
          if (emailCheckTokenRef.current !== token) {
            return;
          }
          setLiveEmailState('idle');
        });
    }, 250);

    return () => {
      if (emailCheckTimerRef.current) {
        clearTimeout(emailCheckTimerRef.current);
        emailCheckTimerRef.current = null;
      }
    };
  }, [
    isPlatformOwner,
    liveFormState.editingId,
    liveFormState.email,
    liveFormState.mode,
    selectedTenantCompanyId
  ]);

  async function handlePermanentDelete(row: Record<string, unknown>): Promise<void> {
    if (!isPlatformOwner) {
      return;
    }
    const id = String(row.id ?? '').trim();
    if (!id) {
      return;
    }
    const label = String(row.fullName ?? row.email ?? id);
    const confirmed = window.confirm(
      `Permanently delete user "${label}"? This cannot be undone and will fail if linked transactions exist.`
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
      await apiRequest(`/master-data/users/${encodeURIComponent(id)}/permanent${query}`, {
        method: 'DELETE'
      });
      setHardDeleteNotice(`User "${label}" permanently deleted.`);
      setReloadSignal((current) => current + 1);
    } catch (error) {
      setHardDeleteError(error instanceof Error ? error.message : 'Failed to permanently delete user');
    }
  }

  async function loadSetupScopeOptions(companyIdOverride?: string): Promise<void> {
    const query =
      isPlatformOwner && companyIdOverride
        ? `?companyId=${encodeURIComponent(companyIdOverride)}`
        : '';
    const [branches, locations] = await Promise.all([
      apiRequest<BranchRow[]>(`/master-data/branches${query}`),
      apiRequest<LocationRow[]>(`/master-data/locations${query}`)
    ]);
    const branchOptions = branches
      .filter((row) => row.isActive !== false)
      .map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }));
    setSetupBranchOptions(branchOptions);
    setSetupLocationRows(locations);
    const defaultBranchId = branchOptions[0]?.value ?? '';
    setSetupBranchId(defaultBranchId);
  }

  async function handleOpenSetupModal(row: Record<string, unknown>): Promise<void> {
    setHardDeleteError(null);
    setHardDeleteNotice(null);
    setSetupError(null);
    setSetupResult(null);
    setSetupQrDataUrl('');

    const roles = extractRoleList(row.roles);
    if (!roles.includes('cashier')) {
      setSetupError('Setup QR can only be generated for cashier users.');
      return;
    }

    const userId = String(row.id ?? '').trim();
    const email = String(row.email ?? '').trim();
    const fullName =
      String((row.fullName ?? row.full_name ?? email) || userId).trim() ||
      userId;
    if (!userId) {
      setSetupError('Unable to identify selected user.');
      return;
    }

    if (isPlatformOwner && !selectedTenantCompanyId) {
      setSetupError('Select tenant scope first.');
      return;
    }

    setSetupUser({ id: userId, label: fullName, email });
    setSetupModalOpen(true);
    setSetupBusy(true);
    try {
      await loadSetupScopeOptions(selectedTenantCompanyId || undefined);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Failed to load branch/location options');
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleGenerateSetupQr(): Promise<void> {
    if (!setupUser) {
      return;
    }
    if (!setupBranchId || !setupLocationId) {
      setSetupError('Branch and location are required.');
      return;
    }

    setSetupBusy(true);
    setSetupError(null);
    setSetupResult(null);
    setSetupQrDataUrl('');
    try {
      const payload: Record<string, unknown> = {
        user_id: setupUser.id,
        branch_id: setupBranchId,
        location_id: setupLocationId,
        expires_in_minutes: 60
      };
      if (isPlatformOwner && selectedTenantCompanyId) {
        payload.companyId = selectedTenantCompanyId;
      }
      const response = await apiRequest<EnrollmentResponse>('/mobile-enrollment/tokens', {
        method: 'POST',
        body: payload
      });
      setSetupResult(response);
      setSetupQrDataUrl(buildQrSvgDataUrl(response.setup_url, { scale: 6, margin: 2 }));
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Failed to generate setup QR');
    } finally {
      setSetupBusy(false);
    }
  }

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
              Users list and create flow are scoped to the selected tenant.
            </span>
          </label>
          {tenantLoadError ? <p className="mt-2 text-xs text-rose-700">{tenantLoadError}</p> : null}
        </div>
      ) : null}

      {hardDeleteNotice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{hardDeleteNotice}</p> : null}
      {hardDeleteError ? <p className="text-sm text-rose-700">{hardDeleteError}</p> : null}

      <EntityManager
        allowDelete={canEdit}
        defaultValues={defaultValues}
        deleteConfirmText="Safe delete will mark this user inactive and block access while keeping audit history."
        reactivateConfirmText="This will reactivate the user and allow access again."
        endpoint={endpoint}
        fields={fields}
        readOnly={!canEdit}
        reloadSignal={reloadSignal}
        rowActions={
          canEdit
            ? [
                {
                  key: 'generate-setup-qr',
                  label: 'Generate Setup QR',
                  buttonClassName:
                    'rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40',
                  onClick: (row) => {
                    void handleOpenSetupModal(row);
                  }
                },
                ...(isPlatformOwner
                  ? [
                      {
                        key: 'hard-delete',
                        label: 'Delete Permanently',
                        buttonClassName:
                          'rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40',
                        onClick: (row: Record<string, unknown>) => {
                          void handlePermanentDelete(row);
                        }
                      }
                    ]
                  : [])
              ]
            : []
        }
        tableColumnOverrides={{
          companyId: {
            label: 'Tenant',
            render: (value) => companyLabelById.get(String(value ?? '')) ?? String(value ?? '-')
          },
          roles: {
            label: 'Role',
            render: (value) => roleLabel(value)
          },
          isActive: {
            label: 'Active',
            render: (value) => yesNo(value)
          }
        }}
        title="Users"
        onFormStateChange={(form, context) => {
          setLiveFormState({
            mode: context.mode,
            editingId: context.editingId,
            email: String(form.email ?? ''),
            password: String(form.password ?? '')
          });
        }}
        renderFieldIndicator={({ field, value }) => {
          if (field.key === 'email') {
            if (liveEmailState === 'invalid') {
              return <p className="text-xs text-rose-600">X Enter a valid email format.</p>;
            }
            if (liveEmailState === 'checking') {
              return <p className="text-xs text-slate-500">Checking email availability...</p>;
            }
            if (liveEmailState === 'exists') {
              return <p className="text-xs text-rose-600">X Email already exists.</p>;
            }
            if (liveEmailState === 'available') {
              return <p className="text-xs text-emerald-600">✓ Email is available.</p>;
            }
            return null;
          }

          if (field.key === 'password') {
            const password = String(value ?? '').trim();
            if (!password) {
              return <p className="text-xs text-slate-500">Optional. Leave blank to keep current/default password.</p>;
            }

            const checks = [
              { ok: password.length >= 8, label: 'At least 8 characters' },
              { ok: /[A-Z]/.test(password), label: 'At least 1 uppercase letter' },
              { ok: /[a-z]/.test(password), label: 'At least 1 lowercase letter' },
              { ok: /[0-9]/.test(password), label: 'At least 1 number' }
            ];

            return (
              <div className="space-y-0.5">
                {checks.map((check) => (
                  <p
                    className={`text-xs ${check.ok ? 'text-emerald-600' : 'text-rose-600'}`}
                    key={check.label}
                  >
                    {check.ok ? '✓' : 'X'} {check.label}
                  </p>
                ))}
              </div>
            );
          }

          return null;
        }}
        transformBeforeSubmit={async (payload, context) => {
          const normalizedEmail = String(payload.email ?? '').trim().toLowerCase();
          if (!normalizedEmail) {
            throw new Error('Email is required.');
          }

          const password = String(payload.password ?? '').trim();
          if (password) {
            if (password.length < 8) {
              throw new Error('Password must be at least 8 characters.');
            }
            if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
              throw new Error('Password must include uppercase, lowercase, and a number.');
            }
          }

          if (isPlatformOwner && !selectedTenantCompanyId) {
            throw new Error('Select a tenant scope first.');
          }

          const query = new URLSearchParams();
          query.set('email', normalizedEmail);
          if (isPlatformOwner && selectedTenantCompanyId) {
            query.set('companyId', selectedTenantCompanyId);
          }
          if (context.mode === 'edit' && context.editingId) {
            query.set('excludeUserId', context.editingId);
          }

          const existsResult = await apiRequest<{ exists: boolean }>(`/master-data/users/email-exists?${query.toString()}`);
          if (existsResult.exists) {
            throw new Error(`Email "${normalizedEmail}" already exists.`);
          }

          return {
            ...payload,
            email: normalizedEmail,
            companyId: isPlatformOwner ? selectedTenantCompanyId || undefined : undefined,
            roles: Array.isArray(payload.roles) ? payload.roles : [String(payload.roles ?? '').trim()].filter(Boolean),
            password: password || undefined
          };
        }}
      />

      {setupModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              setSetupModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cashier Mobile Setup QR</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Generate one-time QR for <span className="font-semibold">{setupUser?.label ?? '-'}</span>.
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setSetupModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Branch</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  disabled={setupBusy}
                  onChange={(event) => setSetupBranchId(event.target.value)}
                  value={setupBranchId}
                >
                  <option value="">Select branch...</option>
                  {setupBranchOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Location</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  disabled={setupBusy || !setupBranchId}
                  onChange={(event) => setSetupLocationId(event.target.value)}
                  value={setupLocationId}
                >
                  <option value="">Select location...</option>
                  {setupLocationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
                disabled={setupBusy || !setupBranchId || !setupLocationId || !setupUser}
                onClick={() => {
                  void handleGenerateSetupQr();
                }}
                type="button"
              >
                {setupBusy ? 'Generating...' : 'Generate One-Time QR (1 hour)'}
              </button>
            </div>

            {setupError ? <p className="mt-3 text-sm text-rose-600">{setupError}</p> : null}

            {setupResult ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  QR expires at <span className="font-semibold">{new Date(setupResult.expires_at).toLocaleString()}</span> and can be used
                  once.
                </p>
                <div className="mt-3 flex flex-col items-center gap-3 md:flex-row md:items-start">
                  {setupQrDataUrl ? (
                    <img
                      alt="Mobile setup QR"
                      className="h-56 w-56 rounded-lg border border-slate-300 bg-white p-2"
                      src={setupQrDataUrl}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Setup Link</p>
                    <div className="rounded-lg border border-slate-300 bg-white p-2 text-xs break-all dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                      {setupResult.setup_url}
                    </div>
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => {
                        void navigator.clipboard.writeText(setupResult.setup_url);
                      }}
                      type="button"
                    >
                      Copy setup link
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
