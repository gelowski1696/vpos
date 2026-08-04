'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityManager, type SelectOption } from '../../../components/entity-manager';
import {
  MasterDataImportWizard,
  type ImportColumn
} from '../../../components/master-data-import-wizard';
import { apiRequest } from '../../../lib/api-client';

type BranchRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type PersonnelRoleRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type PersonnelRow = {
  id: string;
  code: string;
  fullName: string;
  branchId: string;
  roleId?: string | null;
  roleName?: string | null;
  roleCode?: string | null;
  phone?: string | null;
  email?: string | null;
  salaryType?: string | null;
  salaryRate?: number | string | null;
  commissionEligible?: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type PersonnelDetailTab = 'details' | 'transactions';

type PersonnelTransactionRow = {
  id: string;
  saleId: string;
  saleLineId: string;
  receiptNumber: string | null;
  postedAt: string;
  saleType: string;
  saleStatus: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  productId: string;
  productSku: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  saleTotalAmount: number;
  commissionRate: number;
  splitPercent: number;
  commissionAmount: number;
  personnelRole: string | null;
  createdAt: string;
};

type RiderUserRow = {
  id: string;
  username: string;
  personnelId: string;
  personnelCode?: string | null;
  personnelName?: string | null;
  branchId?: string | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type RiderUserFormState = {
  mode: 'create' | 'edit';
  editingId: string | null;
  username: string;
  password: string;
  personnelId: string;
  isActive: boolean;
};

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

function formatMoney(value: unknown): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function generateShortCode(prefix: string): string {
  const normalizedPrefix = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'P';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

function normalizeRiderUsername(value: string): string {
  return value.trim().toLowerCase();
}

function validateRiderUsername(value: string): string | null {
  const normalized = normalizeRiderUsername(value);
  if (!normalized) {
    return 'Username is required.';
  }
  if (normalized.length < 3 || normalized.length > 40) {
    return 'Username must be 3 to 40 characters.';
  }
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    return 'Username can only use letters, numbers, dot, underscore, and dash.';
  }
  if (normalized.includes('@')) {
    return 'Use username only, not an email address.';
  }
  return null;
}

function validateRiderPassword(value: string, required: boolean): string | null {
  const password = value.trim();
  if (!password) {
    return required ? 'Password is required.' : null;
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, and a number.';
  }
  return null;
}

function riderStatusLabel(value: boolean): string {
  return value ? 'Active' : 'Inactive';
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function formatQuantity(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return '0';
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 4
  });
}

function formatPercent(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return '0%';
  }
  return `${parsed.toLocaleString(undefined, {
    minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 4
  })}%`;
}

function personnelSalaryTypeLabel(value?: string | null): string {
  switch (String(value ?? '').toUpperCase()) {
    case 'MONTHLY':
      return 'Monthly';
    case 'DAILY':
      return 'Daily';
    case 'HOURLY':
      return 'Hourly';
    case 'PER_TRANSACTION':
      return 'Per Transaction';
    default:
      return '-';
  }
}

function saleTypeLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function personnelFromTableRow(row: Record<string, unknown>): PersonnelRow {
  return {
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    fullName: String(row.fullName ?? row.name ?? ''),
    branchId: String(row.branchId ?? ''),
    roleId: row.roleId === undefined || row.roleId === null ? null : String(row.roleId),
    roleCode: row.roleCode === undefined || row.roleCode === null ? null : String(row.roleCode),
    roleName: row.roleName === undefined || row.roleName === null ? null : String(row.roleName),
    phone: row.phone === undefined || row.phone === null ? null : String(row.phone),
    email: row.email === undefined || row.email === null ? null : String(row.email),
    salaryType: row.salaryType === undefined || row.salaryType === null ? null : String(row.salaryType),
    salaryRate: row.salaryRate === undefined || row.salaryRate === null ? null : Number(row.salaryRate),
    commissionEligible: Boolean(row.commissionEligible),
    isActive: row.isActive !== false,
    createdAt: row.createdAt === undefined || row.createdAt === null ? undefined : String(row.createdAt),
    updatedAt: row.updatedAt === undefined || row.updatedAt === null ? undefined : String(row.updatedAt)
  };
}

export default function PersonnelsPage(): JSX.Element {
  const [reloadSignal, setReloadSignal] = useState(0);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [roles, setRoles] = useState<PersonnelRoleRow[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<PersonnelRow | null>(null);
  const [personnelDetailTab, setPersonnelDetailTab] = useState<PersonnelDetailTab>('details');
  const [personnelTransactions, setPersonnelTransactions] = useState<PersonnelTransactionRow[]>([]);
  const [personnelTransactionsLoading, setPersonnelTransactionsLoading] = useState(false);
  const [personnelTransactionsError, setPersonnelTransactionsError] = useState<string | null>(null);
  const [riderUsersOpen, setRiderUsersOpen] = useState(false);
  const [riderUsersLoading, setRiderUsersLoading] = useState(false);
  const [riderUsersSaving, setRiderUsersSaving] = useState(false);
  const [riderUsersError, setRiderUsersError] = useState<string | null>(null);
  const [riderUsersNotice, setRiderUsersNotice] = useState<string | null>(null);
  const [riderUsers, setRiderUsers] = useState<RiderUserRow[]>([]);
  const [riderPersonnelRows, setRiderPersonnelRows] = useState<PersonnelRow[]>([]);
  const [riderUserForm, setRiderUserForm] = useState<RiderUserFormState>({
    mode: 'create',
    editingId: null,
    username: '',
    password: '',
    personnelId: '',
    isActive: true
  });
  const [liveFormState, setLiveFormState] = useState<{
    mode: 'create' | 'edit';
    editingId: string | null;
    code: string;
  }>({
    mode: 'create',
    editingId: null,
    code: ''
  });
  const [liveCodeState, setLiveCodeState] = useState<'idle' | 'invalid' | 'checking' | 'exists' | 'available'>('idle');
  const codeCheckTokenRef = useRef(0);
  const codeCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [branchRows, roleRows] = await Promise.all([
          apiRequest<BranchRow[]>('/master-data/branches'),
          apiRequest<PersonnelRoleRow[]>('/master-data/personnel-roles')
        ]);
        if (!active) {
          return;
        }
        setBranches((branchRows ?? []).filter((row) => row.isActive !== false));
        setRoles((roleRows ?? []).filter((row) => row.isActive !== false));
      } catch {
        if (!active) {
          return;
        }
        setBranches([]);
        setRoles([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (codeCheckTimerRef.current) {
      clearTimeout(codeCheckTimerRef.current);
      codeCheckTimerRef.current = null;
    }

    const normalizedCode = String(liveFormState.code ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!normalizedCode) {
      setLiveCodeState('idle');
      return;
    }
    if (normalizedCode.length < 1 || normalizedCode.length > 8) {
      setLiveCodeState('invalid');
      return;
    }

    const token = codeCheckTokenRef.current + 1;
    codeCheckTokenRef.current = token;
    setLiveCodeState('checking');
    codeCheckTimerRef.current = setTimeout(() => {
      const query = new URLSearchParams();
      query.set('code', normalizedCode);
      if (liveFormState.mode === 'edit' && liveFormState.editingId) {
        query.set('excludeId', liveFormState.editingId);
      }
      void apiRequest<{ exists: boolean }>(`/master-data/personnels/code-exists?${query.toString()}`)
        .then((result) => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState(result.exists ? 'exists' : 'available');
        })
        .catch(() => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState('idle');
        });
    }, 250);

    return () => {
      if (codeCheckTimerRef.current) {
        clearTimeout(codeCheckTimerRef.current);
        codeCheckTimerRef.current = null;
      }
    };
  }, [liveFormState.code, liveFormState.editingId, liveFormState.mode]);

  const branchOptions = useMemo<SelectOption[]>(
    () =>
      branches.map((branch) => ({
        value: branch.id,
        label: `${branch.name} (${branch.code})`
      })),
    [branches]
  );
  const roleOptions = useMemo<SelectOption[]>(
    () =>
      roles.map((role) => ({
        value: role.id,
        label: `${role.name} (${role.code})`
      })),
    [roles]
  );
  const branchLabelById = useMemo(
    () => new Map(branchOptions.map((option) => [option.value, option.label])),
    [branchOptions]
  );
  const roleLabelById = useMemo(
    () => new Map(roleOptions.map((option) => [option.value, option.label])),
    [roleOptions]
  );
  const branchSelectOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: '',
        label: branchOptions.length > 0 ? 'Select branch...' : 'No active branches available'
      },
      ...branchOptions
    ],
    [branchOptions]
  );
  const roleSelectOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: '',
        label: roleOptions.length > 0 ? 'Select personnel role...' : 'No active personnel roles available'
      },
      ...roleOptions
    ],
    [roleOptions]
  );
  const salaryTypeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'MONTHLY', label: 'Monthly' },
      { value: 'DAILY', label: 'Daily' },
      { value: 'HOURLY', label: 'Hourly' },
      { value: 'PER_TRANSACTION', label: 'Per Transaction' }
    ],
    []
  );
  const importColumns = useMemo<ImportColumn[]>(() => {
    const branchTemplateValues = branches
      .filter((row) => row.isActive)
      .map((row) => row.code)
      .sort((a, b) => a.localeCompare(b));
    const roleTemplateValues = roles
      .filter((row) => row.isActive)
      .map((row) => row.code)
      .sort((a, b) => a.localeCompare(b));
    const boolTemplateValues = ['true', 'false'];
    return [
      {
        key: 'code',
        label: 'Personnel Code',
        required: true,
        example: 'P001',
        aliases: ['personnelcode', 'personnel_code']
      },
      {
        key: 'fullName',
        label: 'Full Name',
        required: true,
        example: 'Juan Dela Cruz',
        aliases: ['fullname', 'full_name', 'name']
      },
      {
        key: 'branchCode',
        label: 'Branch',
        required: true,
        example: branchTemplateValues[0] ?? 'MAIN',
        aliases: ['branch', 'branch_code', 'branchid', 'branch_id'],
        templateDropdownValues: branchTemplateValues
      },
      {
        key: 'roleCode',
        label: 'Personnel Role',
        required: true,
        example: roleTemplateValues[0] ?? 'DRIVER',
        aliases: ['role', 'role_code', 'roleid', 'role_id', 'personnel_role'],
        templateDropdownValues: roleTemplateValues
      },
      {
        key: 'phone',
        label: 'Phone',
        example: '09171234567'
      },
      {
        key: 'email',
        label: 'Email',
        example: 'personnel@tenant.local'
      },
      {
        key: 'salaryType',
        label: 'Salary Type',
        example: 'DAILY',
        aliases: ['salary_type'],
        templateDropdownValues: salaryTypeOptions.map((option) => option.value)
      },
      {
        key: 'salaryRate',
        label: 'Salary Rate',
        example: 500,
        aliases: ['salary_rate']
      },
      {
        key: 'commissionEligible',
        label: 'Commission Eligible',
        example: true,
        aliases: ['commission_eligible'],
        templateDropdownValues: boolTemplateValues
      },
      {
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: boolTemplateValues
      }
    ];
  }, [branches, roles, salaryTypeOptions]);

  const assignedRiderPersonnelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const riderUser of riderUsers) {
      if (riderUser.personnelId && riderUser.id !== riderUserForm.editingId) {
        ids.add(riderUser.personnelId);
      }
    }
    return ids;
  }, [riderUserForm.editingId, riderUsers]);

  const riderPersonnelOptions = useMemo<SelectOption[]>(() => {
    const rows = riderPersonnelRows
      .filter((row) => row.isActive !== false || row.id === riderUserForm.personnelId)
      .filter((row) => !assignedRiderPersonnelIds.has(row.id) || row.id === riderUserForm.personnelId)
      .map((row) => ({
        value: row.id,
        label: `${row.fullName} (${row.code})${row.roleName || row.roleCode ? ` - ${row.roleName ?? row.roleCode}` : ''}`
      }));
    return [
      {
        value: '',
        label: rows.length ? 'Select personnel...' : 'No unassigned active personnel available'
      },
      ...rows
    ];
  }, [assignedRiderPersonnelIds, riderPersonnelRows, riderUserForm.personnelId]);

  const personnelTransactionTotal = useMemo(
    () =>
      personnelTransactions.reduce((sum, row) => {
        const value = Number(row.commissionAmount ?? 0);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [personnelTransactions]
  );

  const latestPersonnelTransaction = personnelTransactions[0] ?? null;

  const selectedPersonnelBranchLabel = selectedPersonnel
    ? branchLabelById.get(selectedPersonnel.branchId) ?? selectedPersonnel.branchId
    : '-';
  const selectedPersonnelRoleLabel = selectedPersonnel
    ? selectedPersonnel.roleName ??
      selectedPersonnel.roleCode ??
      (selectedPersonnel.roleId ? roleLabelById.get(selectedPersonnel.roleId) : null) ??
      '-'
    : '-';

  async function loadPersonnelTransactions(personnelId: string): Promise<void> {
    setPersonnelTransactionsLoading(true);
    setPersonnelTransactionsError(null);
    try {
      const rows = await apiRequest<PersonnelTransactionRow[]>(
        `/master-data/personnels/${encodeURIComponent(personnelId)}/transactions`
      );
      setPersonnelTransactions(rows);
    } catch (error) {
      setPersonnelTransactions([]);
      setPersonnelTransactionsError(
        error instanceof Error ? error.message : 'Failed to load personnel transactions.'
      );
    } finally {
      setPersonnelTransactionsLoading(false);
    }
  }

  function openPersonnelDetails(row: Record<string, unknown>): void {
    const personnel = personnelFromTableRow(row);
    setSelectedPersonnel(personnel);
    setPersonnelDetailTab('details');
    setPersonnelTransactions([]);
    setPersonnelTransactionsError(null);
    void loadPersonnelTransactions(personnel.id);
  }

  function closePersonnelDetails(): void {
    setSelectedPersonnel(null);
    setPersonnelDetailTab('details');
    setPersonnelTransactions([]);
    setPersonnelTransactionsError(null);
    setPersonnelTransactionsLoading(false);
  }

  async function loadRiderUsers(): Promise<void> {
    setRiderUsersLoading(true);
    setRiderUsersError(null);
    try {
      const [userRows, personnelRows] = await Promise.all([
        apiRequest<RiderUserRow[]>('/master-data/rider-users'),
        apiRequest<PersonnelRow[]>('/master-data/personnels')
      ]);
      setRiderUsers(userRows);
      setRiderPersonnelRows(personnelRows);
    } catch (error) {
      setRiderUsersError(error instanceof Error ? error.message : 'Failed to load rider users.');
    } finally {
      setRiderUsersLoading(false);
    }
  }

  function resetRiderUserForm(): void {
    setRiderUserForm({
      mode: 'create',
      editingId: null,
      username: '',
      password: '',
      personnelId: '',
      isActive: true
    });
  }

  function openRiderUsersModal(): void {
    setRiderUsersOpen(true);
    setRiderUsersNotice(null);
    setRiderUsersError(null);
    resetRiderUserForm();
    void loadRiderUsers();
  }

  function editRiderUser(row: RiderUserRow): void {
    setRiderUsersNotice(null);
    setRiderUsersError(null);
    setRiderUserForm({
      mode: 'edit',
      editingId: row.id,
      username: row.username,
      password: '',
      personnelId: row.personnelId,
      isActive: row.isActive
    });
  }

  async function saveRiderUser(): Promise<void> {
    setRiderUsersError(null);
    setRiderUsersNotice(null);
    const username = normalizeRiderUsername(riderUserForm.username);
    const usernameError = validateRiderUsername(username);
    if (usernameError) {
      setRiderUsersError(usernameError);
      return;
    }
    const passwordError = validateRiderPassword(riderUserForm.password, riderUserForm.mode === 'create');
    if (passwordError) {
      setRiderUsersError(passwordError);
      return;
    }
    if (!riderUserForm.personnelId) {
      setRiderUsersError('Assign a personnel record to this rider login.');
      return;
    }

    setRiderUsersSaving(true);
    try {
      const query = new URLSearchParams();
      query.set('username', username);
      if (riderUserForm.mode === 'edit' && riderUserForm.editingId) {
        query.set('excludeUserId', riderUserForm.editingId);
      }
      const exists = await apiRequest<{ exists: boolean }>(
        `/master-data/rider-users/username-exists?${query.toString()}`
      );
      if (exists.exists) {
        throw new Error(`Rider username "${username}" already exists.`);
      }

      const payload: Record<string, unknown> = {
        username,
        personnelId: riderUserForm.personnelId,
        isActive: riderUserForm.isActive
      };
      const password = riderUserForm.password.trim();
      if (password) {
        payload.password = password;
      }

      if (riderUserForm.mode === 'edit' && riderUserForm.editingId) {
        await apiRequest(`/master-data/rider-users/${encodeURIComponent(riderUserForm.editingId)}`, {
          method: 'PUT',
          body: payload
        });
        setRiderUsersNotice('Rider user updated.');
      } else {
        await apiRequest('/master-data/rider-users', {
          method: 'POST',
          body: payload
        });
        setRiderUsersNotice('Rider user created.');
      }
      resetRiderUserForm();
      await loadRiderUsers();
    } catch (error) {
      setRiderUsersError(error instanceof Error ? error.message : 'Failed to save rider user.');
    } finally {
      setRiderUsersSaving(false);
    }
  }

  async function setRiderUserActive(row: RiderUserRow, isActive: boolean): Promise<void> {
    setRiderUsersError(null);
    setRiderUsersNotice(null);
    setRiderUsersSaving(true);
    try {
      if (isActive) {
        await apiRequest(`/master-data/rider-users/${encodeURIComponent(row.id)}`, {
          method: 'PUT',
          body: { isActive: true }
        });
        setRiderUsersNotice(`Rider user "${row.username}" reactivated.`);
      } else {
        await apiRequest(`/master-data/rider-users/${encodeURIComponent(row.id)}`, {
          method: 'DELETE'
        });
        setRiderUsersNotice(`Rider user "${row.username}" deactivated.`);
      }
      await loadRiderUsers();
    } catch (error) {
      setRiderUsersError(error instanceof Error ? error.message : 'Failed to update rider user status.');
    } finally {
      setRiderUsersSaving(false);
    }
  }

  async function deleteRiderUser(row: RiderUserRow): Promise<void> {
    const confirmed = window.confirm(
      `Delete rider user "${row.username}"? Use deactivate instead if this rider has delivery history.`
    );
    if (!confirmed) {
      return;
    }
    setRiderUsersError(null);
    setRiderUsersNotice(null);
    setRiderUsersSaving(true);
    try {
      await apiRequest(`/master-data/rider-users/${encodeURIComponent(row.id)}/permanent`, {
        method: 'DELETE'
      });
      setRiderUsersNotice(`Rider user "${row.username}" deleted.`);
      if (riderUserForm.editingId === row.id) {
        resetRiderUserForm();
      }
      await loadRiderUsers();
    } catch (error) {
      setRiderUsersError(error instanceof Error ? error.message : 'Failed to delete rider user.');
    } finally {
      setRiderUsersSaving(false);
    }
  }

  const selectedPersonnelDetails = selectedPersonnel
    ? [
        { label: 'Personnel Code', value: selectedPersonnel.code || '-' },
        { label: 'Branch', value: selectedPersonnelBranchLabel || '-' },
        { label: 'Role', value: selectedPersonnelRoleLabel || '-' },
        { label: 'Phone', value: selectedPersonnel.phone || '-' },
        { label: 'Email', value: selectedPersonnel.email || '-' },
        { label: 'Salary Type', value: personnelSalaryTypeLabel(selectedPersonnel.salaryType) },
        { label: 'Salary Rate', value: formatMoney(selectedPersonnel.salaryRate) },
        { label: 'Commission Eligible', value: yesNo(selectedPersonnel.commissionEligible) },
        { label: 'Active', value: yesNo(selectedPersonnel.isActive) },
        { label: 'Created', value: formatDateTime(selectedPersonnel.createdAt) },
        { label: 'Updated', value: formatDateTime(selectedPersonnel.updatedAt) }
      ]
    : [];

  return (
    <>
    <EntityManager
      allowDelete
      defaultValues={{
        code: '',
        fullName: '',
        branchId: '',
        roleId: '',
        phone: '',
        email: '',
        salaryType: 'MONTHLY',
        salaryRate: 0,
        commissionEligible: true,
        isActive: true
      }}
      endpoint="/master-data/personnels"
      reloadSignal={reloadSignal}
      toolbarActions={
        <>
          <MasterDataImportWizard
            title="Personnel"
            entity="personnels"
            endpointBase="/master-data/import/personnels"
            columns={importColumns}
            onImported={() => {
              setReloadSignal((current) => current + 1);
            }}
          />
          <button
            className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950/40"
            onClick={openRiderUsersModal}
            type="button"
          >
            Rider Users
          </button>
        </>
      }
      fields={[
        {
          key: 'code',
          label: 'Personnel Code',
          helperText: 'Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.'
        },
        { key: 'fullName', label: 'Full Name', required: true },
        {
          key: 'branchId',
          label: 'Branch',
          type: 'select',
          required: true,
          options: branchSelectOptions
        },
        {
          key: 'roleId',
          label: 'Personnel Role',
          type: 'select',
          required: true,
          options: roleSelectOptions
        },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        {
          key: 'salaryType',
          label: 'Salary Type',
          type: 'select',
          options: salaryTypeOptions
        },
        {
          key: 'salaryRate',
          label: 'Salary Rate',
          type: 'number',
          helperText: 'Base payroll rate for the selected salary type.'
        },
        {
          key: 'commissionEligible',
          label: 'Commission Eligible',
          type: 'boolean'
        },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      onFormStateChange={(form, context) => {
        setLiveFormState({
          mode: context.mode,
          editingId: context.editingId,
          code: String(form.code ?? '')
        });
      }}
      onRowClick={openPersonnelDetails}
      renderFieldAction={({ field, disabled, setValue }) =>
        field.key === 'code' ? (
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => setValue(generateShortCode('P'))}
            title="Auto-generate code"
            type="button"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
              <path d="M12 3v4M12 17v4M4.2 7.2l2.8 2.8M17 14l2.8 2.8M3 12h4M17 12h4M4.2 16.8 7 14M17 10l2.8-2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        ) : null
      }
      renderFieldIndicator={({ field }) => {
        if (field.key !== 'code') {
          return null;
        }
        if (liveCodeState === 'invalid') {
          return <p className="text-xs text-rose-600">X Code must be 1 to 8 characters (A-Z, 0-9).</p>;
        }
        if (liveCodeState === 'checking') {
          return <p className="text-xs text-slate-500">Checking code availability...</p>;
        }
        if (liveCodeState === 'exists') {
          return <p className="text-xs text-rose-600">X Code already exists.</p>;
        }
        if (liveCodeState === 'available') {
          return <p className="text-xs text-emerald-600">OK Code is available.</p>;
        }
        return <p className="text-xs text-slate-500">If left blank, code is auto-generated.</p>;
      }}
      tableColumnOverrides={{
        branchId: {
          label: 'Branch',
          render: (value) => branchLabelById.get(String(value ?? '')) ?? String(value ?? '-')
        },
        roleId: {
          label: 'Role',
          render: (value) => roleLabelById.get(String(value ?? '')) ?? String(value ?? '-')
        },
        salaryType: {
          label: 'Salary Type',
          render: (value) =>
            salaryTypeOptions.find((option) => option.value === String(value ?? ''))?.label ??
            String(value ?? '-')
        },
        salaryRate: {
          label: 'Salary Rate',
          render: (value) => formatMoney(value)
        },
        commissionEligible: {
          label: 'Commission',
          render: (value) => yesNo(value)
        },
        isActive: {
          label: 'Active',
          render: (value) => yesNo(value)
        }
      }}
      title="Personnel"
      transformBeforeSubmit={async (payload, context) => {
        const normalizedCode = String(payload.code ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (normalizedCode && (normalizedCode.length < 1 || normalizedCode.length > 8)) {
          throw new Error('Personnel code must be 1 to 8 characters (A-Z, 0-9).');
        }
        if (normalizedCode) {
          const query = new URLSearchParams();
          query.set('code', normalizedCode);
          if (context.mode === 'edit' && context.editingId) {
            query.set('excludeId', context.editingId);
          }
          const existsResult = await apiRequest<{ exists: boolean }>(
            `/master-data/personnels/code-exists?${query.toString()}`
          );
          if (existsResult.exists) {
            throw new Error(`Personnel code "${normalizedCode}" already exists.`);
          }
        }
        const branchId = String(payload.branchId ?? '').trim();
        const roleId = String(payload.roleId ?? '').trim();
        if (!branchId) {
          if (branchOptions.length === 0) {
            throw new Error('No active branches available. Create or reactivate a branch first.');
          }
          throw new Error('Branch is required.');
        }
        if (!roleId) {
          if (roleOptions.length === 0) {
            throw new Error('No active personnel roles available. Create or reactivate a role first.');
          }
          throw new Error('Personnel role is required.');
        }
        return {
          ...payload,
          code: normalizedCode,
          fullName: String(payload.fullName ?? '').trim(),
          branchId,
          roleId,
          phone: payload.phone ? String(payload.phone).trim() : null,
          email: payload.email ? String(payload.email).trim() : null,
          salaryType: String(payload.salaryType ?? 'MONTHLY'),
          salaryRate:
            payload.salaryRate === '' || payload.salaryRate === null
              ? 0
              : Number(payload.salaryRate),
          commissionEligible: Boolean(payload.commissionEligible)
        };
      }}
    />
    {selectedPersonnel ? (
      <div
        className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/55 px-4 py-6"
        onClick={(event) => {
          if (event.currentTarget === event.target) {
            closePersonnelDetails();
          }
        }}
      >
        <section className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {selectedPersonnel.fullName}
                  </h2>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      selectedPersonnel.isActive
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {selectedPersonnel.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {selectedPersonnel.code} - {selectedPersonnelBranchLabel} - {selectedPersonnelRoleLabel}
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={closePersonnelDetails}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3 flex gap-2 border-b border-slate-200 dark:border-slate-700">
              {(['details', 'transactions'] as PersonnelDetailTab[]).map((tab) => (
                <button
                  className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                    personnelDetailTab === tab
                      ? 'border-teal-700 text-teal-800 dark:border-teal-400 dark:text-teal-300'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  key={tab}
                  onClick={() => setPersonnelDetailTab(tab)}
                  type="button"
                >
                  {tab === 'details' ? 'Details' : 'Transactions'}
                </button>
              ))}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {personnelDetailTab === 'details' ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {selectedPersonnelDetails.map((item) => (
                  <div
                    className="border-b border-slate-200 pb-3 dark:border-slate-800"
                    key={item.label}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {item.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{item.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Commission Rows
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {personnelTransactions.length.toLocaleString()}
                    </p>
                  </div>
                  <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Total Commission
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoney(personnelTransactionTotal)}
                    </p>
                  </div>
                  <div className="border-b border-slate-200 pb-3 dark:border-slate-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Latest Sale
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {latestPersonnelTransaction ? formatDateTime(latestPersonnelTransaction.postedAt) : '-'}
                    </p>
                  </div>
                </div>

                {personnelTransactionsError ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                    {personnelTransactionsError}
                  </p>
                ) : null}

                {personnelTransactionsLoading ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Loading transactions...</p>
                ) : personnelTransactions.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No product commission sales found for this personnel.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="px-3 py-3 text-left">Sale</th>
                          <th className="px-3 py-3 text-left">Customer</th>
                          <th className="px-3 py-3 text-left">Product</th>
                          <th className="px-3 py-3 text-right">Qty</th>
                          <th className="px-3 py-3 text-right">Line Total</th>
                          <th className="px-3 py-3 text-right">Rate</th>
                          <th className="px-3 py-3 text-right">Split</th>
                          <th className="px-3 py-3 text-right">Commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {personnelTransactions.map((row) => (
                          <tr
                            className="border-b border-slate-100 text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            key={row.id}
                          >
                            <td className="px-3 py-3 align-top">
                              <p className="font-semibold">{row.receiptNumber ?? row.saleId}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {formatDateTime(row.postedAt)} - {saleTypeLabel(row.saleType)} - {row.saleStatus}
                              </p>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <p className="font-medium">{row.customerName ?? 'Walk-in'}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {row.customerCode ?? row.branchName ?? row.branchId}
                              </p>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <p className="font-medium">{row.productName}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {row.productSku ?? row.productId}
                              </p>
                            </td>
                            <td className="px-3 py-3 text-right align-top">{formatQuantity(row.quantity)}</td>
                            <td className="px-3 py-3 text-right align-top">{formatMoney(row.lineTotal)}</td>
                            <td className="px-3 py-3 text-right align-top">{formatMoney(row.commissionRate)}</td>
                            <td className="px-3 py-3 text-right align-top">{formatPercent(row.splitPercent)}</td>
                            <td className="px-3 py-3 text-right align-top font-semibold">
                              {formatMoney(row.commissionAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    ) : null}
    {riderUsersOpen ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 py-6"
        onClick={(event) => {
          if (event.currentTarget === event.target) {
            setRiderUsersOpen(false);
          }
        }}
      >
        <section className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Rider Users</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Rider usernames work only in the Rider app and must be assigned to one personnel record.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={riderUsersLoading || riderUsersSaving}
                onClick={() => void loadRiderUsers()}
                type="button"
              >
                Refresh
              </button>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setRiderUsersOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[1fr_360px]">
            <div className="min-h-0 overflow-auto border-b border-slate-200 dark:border-slate-700 md:border-b-0 md:border-r">
              {riderUsersError ? (
                <p className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                  {riderUsersError}
                </p>
              ) : null}
              {riderUsersNotice ? (
                <p className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {riderUsersNotice}
                </p>
              ) : null}

              {riderUsersLoading ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading rider users...</p>
              ) : riderUsers.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No rider users yet.</p>
              ) : (
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="px-4 py-3 text-left">Username</th>
                      <th className="px-4 py-3 text-left">Personnel</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Updated</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riderUsers.map((row) => (
                      <tr
                        className="border-b border-slate-100 text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        key={row.id}
                      >
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold">{row.username}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{row.roles.join(', ')}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium">{row.personnelName ?? row.personnelId}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{row.personnelCode ?? row.personnelId}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              row.isActive
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {riderStatusLabel(row.isActive)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-500 dark:text-slate-400">
                          {new Date(row.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                              disabled={riderUsersSaving}
                              onClick={() => editRiderUser(row)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                                row.isActive
                                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40'
                                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40'
                              }`}
                              disabled={riderUsersSaving}
                              onClick={() => void setRiderUserActive(row, !row.isActive)}
                              type="button"
                            >
                              {row.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <button
                              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                              disabled={riderUsersSaving}
                              onClick={() => void deleteRiderUser(row)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <aside className="overflow-auto p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {riderUserForm.mode === 'create' ? 'Create Rider Login' : 'Update Rider Login'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Username and password are for the Rider app only.
                  </p>
                </div>
                {riderUserForm.mode === 'edit' ? (
                  <button
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={resetRiderUserForm}
                    type="button"
                  >
                    New
                  </button>
                ) : null}
              </div>

              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Username</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      setRiderUserForm((current) => ({
                        ...current,
                        username: event.target.value
                      }))
                    }
                    placeholder="e.g. rider01"
                    value={riderUserForm.username}
                  />
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    3-40 characters. Letters, numbers, dot, underscore, dash.
                  </span>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">
                    {riderUserForm.mode === 'create' ? 'Password' : 'Password (optional)'}
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      setRiderUserForm((current) => ({
                        ...current,
                        password: event.target.value
                      }))
                    }
                    placeholder={riderUserForm.mode === 'create' ? 'Required' : 'Leave blank to keep password'}
                    type="password"
                    value={riderUserForm.password}
                  />
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    At least 8 characters with uppercase, lowercase, and number.
                  </span>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Assigned Personnel</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      setRiderUserForm((current) => ({
                        ...current,
                        personnelId: event.target.value
                      }))
                    }
                    value={riderUserForm.personnelId}
                  >
                    {riderPersonnelOptions.map((option) => (
                      <option key={option.value || 'none'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Active</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) =>
                      setRiderUserForm((current) => ({
                        ...current,
                        isActive: event.target.value === 'true'
                      }))
                    }
                    value={String(riderUserForm.isActive)}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <button
                  className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={riderUsersSaving || riderUsersLoading}
                  onClick={() => void saveRiderUser()}
                  type="button"
                >
                  {riderUsersSaving
                    ? 'Saving...'
                    : riderUserForm.mode === 'create'
                      ? 'Create Rider User'
                      : 'Update Rider User'}
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    ) : null}
    </>
  );
}
