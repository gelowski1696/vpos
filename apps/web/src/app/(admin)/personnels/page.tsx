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

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
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

export default function PersonnelsPage(): JSX.Element {
  const [reloadSignal, setReloadSignal] = useState(0);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [roles, setRoles] = useState<PersonnelRoleRow[]>([]);
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
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: boolTemplateValues
      }
    ];
  }, [branches, roles]);

  return (
    <EntityManager
      allowDelete
      defaultValues={{
        code: '',
        fullName: '',
        branchId: '',
        roleId: '',
        phone: '',
        email: '',
        isActive: true
      }}
      endpoint="/master-data/personnels"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Personnel"
          entity="personnels"
          endpointBase="/master-data/import/personnels"
          columns={importColumns}
          onImported={() => {
            setReloadSignal((current) => current + 1);
          }}
        />
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
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      onFormStateChange={(form, context) => {
        setLiveFormState({
          mode: context.mode,
          editingId: context.editingId,
          code: String(form.code ?? '')
        });
      }}
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
          email: payload.email ? String(payload.email).trim() : null
        };
      }}
    />
  );
}
