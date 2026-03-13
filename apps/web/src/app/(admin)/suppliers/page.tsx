'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityManager, type SelectOption } from '../../../components/entity-manager';
import {
  MasterDataImportWizard,
  type ImportColumn
} from '../../../components/master-data-import-wizard';
import { apiRequest } from '../../../lib/api-client';

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
    .slice(0, 4) || 'SUP';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

type LocationRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export default function SuppliersPage(): JSX.Element {
  const [reloadSignal, setReloadSignal] = useState(0);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
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
        const rows = await apiRequest<LocationRecord[]>('/master-data/locations');
        if (!active) {
          return;
        }
        setLocations(rows.filter((row) => row.isActive));
      } catch {
        if (!active) {
          return;
        }
        setLocations([]);
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
      void apiRequest<{ exists: boolean }>(`/master-data/suppliers/code-exists?${query.toString()}`)
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

  const locationOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: 'Not linked' },
      ...locations.map((location) => ({
        value: location.id,
        label: `${location.name} (${location.code})`
      }))
    ],
    [locations]
  );

  const locationLabelById = useMemo(
    () => new Map(locationOptions.map((option) => [option.value, option.label])),
    [locationOptions]
  );
  const importColumns = useMemo<ImportColumn[]>(() => {
    const locationTemplateValues = locations
      .filter((row) => row.isActive)
      .map((row) => row.code)
      .sort((a, b) => a.localeCompare(b));
    const boolValues = ['TRUE', 'FALSE'];

    return [
      {
        key: 'code',
        label: 'Supplier Code',
        required: true,
        example: 'SUP001',
        aliases: ['supplier_code']
      },
      {
        key: 'name',
        label: 'Supplier Name',
        required: true,
        example: 'ABC Gas Supplier',
        aliases: ['supplier_name']
      },
      {
        key: 'locationCode',
        label: 'Linked Location Code',
        example: locationTemplateValues[0] ?? '',
        aliases: ['location_code', 'locationId', 'location_id'],
        templateDropdownValues: locationTemplateValues
      },
      { key: 'contactPerson', label: 'Contact Person', example: 'Juan Dela Cruz', aliases: ['contact_person'] },
      { key: 'phone', label: 'Phone', example: '09171234567' },
      { key: 'email', label: 'Email', example: 'supplier@example.com' },
      { key: 'address', label: 'Address', example: 'Demo City' },
      {
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: boolValues
      }
    ];
  }, [locations]);

  return (
    <EntityManager
      allowDelete
      defaultValues={{
        code: '',
        name: '',
        locationId: '',
        contactPerson: '',
        phone: '',
        email: '',
        address: '',
        isActive: true
      }}
      endpoint="/master-data/suppliers"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Suppliers"
          entity="suppliers"
          endpointBase="/master-data/import/suppliers"
          columns={importColumns}
          onImported={() => {
            setReloadSignal((current) => current + 1);
          }}
        />
      }
      fields={[
        {
          key: 'code',
          label: 'Supplier Code',
          helperText: 'Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.'
        },
        { key: 'name', label: 'Supplier Name', required: true },
        {
          key: 'locationId',
          label: 'Linked Location',
          type: 'select',
          options: locationOptions,
          helperText: 'Optional location assignment for this supplier.'
        },
        { key: 'contactPerson', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'address', label: 'Address', type: 'textarea' },
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
            onClick={() => setValue(generateShortCode('SUP'))}
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
        locationId: {
          label: 'Linked Location',
          render: (value) => {
            const key = value ? String(value) : '';
            return key ? locationLabelById.get(key) ?? key : 'Not linked';
          }
        },
        isActive: {
          label: 'Active',
          render: (value) => yesNo(value)
        }
      }}
      title="Suppliers"
      transformBeforeSubmit={async (payload, context) => {
        const normalizedCode = String(payload.code ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (normalizedCode && (normalizedCode.length < 1 || normalizedCode.length > 8)) {
          throw new Error('Supplier code must be 1 to 8 characters (A-Z, 0-9).');
        }
        if (normalizedCode) {
          const query = new URLSearchParams();
          query.set('code', normalizedCode);
          if (context.mode === 'edit' && context.editingId) {
            query.set('excludeId', context.editingId);
          }
          const existsResult = await apiRequest<{ exists: boolean }>(
            `/master-data/suppliers/code-exists?${query.toString()}`
          );
          if (existsResult.exists) {
            throw new Error(`Supplier code "${normalizedCode}" already exists.`);
          }
        }

        return {
          ...payload,
          code: normalizedCode,
          locationId: payload.locationId ? String(payload.locationId) : null,
          contactPerson: payload.contactPerson ? String(payload.contactPerson).trim() : null,
          phone: payload.phone ? String(payload.phone).trim() : null,
          email: payload.email ? String(payload.email).trim() : null,
          address: payload.address ? String(payload.address).trim() : null
        };
      }}
    />
  );
}
