'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityManager } from '../../../components/entity-manager';
import {
  MasterDataImportWizard,
  type ImportColumn
} from '../../../components/master-data-import-wizard';
import { apiRequest } from '../../../lib/api-client';

function customerTypeLabel(value: unknown): string {
  if (value === 'BUSINESS') {
    return 'Business';
  }
  return 'Retail';
}

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return '-';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(amount);
}

function generateShortCode(prefix: string): string {
  const normalizedPrefix = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'CU';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

export default function CustomersPage(): JSX.Element {
  const [reloadSignal, setReloadSignal] = useState(0);
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
      void apiRequest<{ exists: boolean }>(`/master-data/customers/code-exists?${query.toString()}`)
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

  const customerTypeTemplateValues = useMemo(() => ['RETAIL', 'BUSINESS'], []);
  const customerTierTemplateValues = useMemo(() => ['REGULAR', 'PREMIUM', 'WHOLESALE'], []);
  const activeTemplateValues = useMemo(() => ['true', 'false'], []);
  const importColumns: ImportColumn[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'Customer Code',
        required: true,
        example: 'CUST001',
        aliases: ['customercode', 'customer_code']
      },
      {
        key: 'name',
        label: 'Customer Name',
        required: true,
        example: 'Walk-in Customer',
        aliases: ['customername', 'customer_name']
      },
      {
        key: 'type',
        label: 'Customer Type',
        example: 'RETAIL',
        templateDropdownValues: customerTypeTemplateValues
      },
      {
        key: 'tier',
        label: 'Tier',
        example: 'REGULAR',
        templateDropdownValues: customerTierTemplateValues
      },
      { key: 'contractPrice', label: 'Contract Price', example: 0, aliases: ['contract_price'] },
      {
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: activeTemplateValues
      }
    ],
    [activeTemplateValues, customerTierTemplateValues, customerTypeTemplateValues]
  );

  return (
    <EntityManager
      defaultValues={{ code: '', name: '', type: 'RETAIL', tier: 'REGULAR', contractPrice: null, isActive: true }}
      endpoint="/master-data/customers?include_balance=true"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Customers"
          entity="customers"
          endpointBase="/master-data/import/customers"
          columns={importColumns}
          onImported={() => {
            setReloadSignal((current) => current + 1);
          }}
        />
      }
      fields={[
        {
          key: 'code',
          label: 'Customer Code',
          helperText: 'Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.'
        },
        {
          key: 'name',
          label: 'Customer Name',
          required: true,
          helperText: 'Display name used in POS and reports.'
        },
        {
          key: 'type',
          label: 'Customer Type',
          type: 'select',
          required: true,
          options: [
            { value: 'RETAIL', label: 'Retail' },
            { value: 'BUSINESS', label: 'Business' }
          ]
        },
        {
          key: 'tier',
          label: 'Customer Tier',
          type: 'select',
          options: [
            { value: 'REGULAR', label: 'Regular' },
            { value: 'PREMIUM', label: 'Premium' },
            { value: 'WHOLESALE', label: 'Wholesale' }
          ],
          helperText: 'Used for tier-based pricing rules.'
        },
        {
          key: 'contractPrice',
          label: 'Contract Price (PHP)',
          type: 'number',
          helperText: 'Optional fixed price if this customer has a direct contract.'
        },
        {
          key: 'outstandingBalance',
          label: 'Outstanding Balance',
          formHidden: true
        },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      tableColumnOverrides={{
        type: {
          label: 'Customer Type',
          render: (value) => customerTypeLabel(value)
        },
        tier: {
          label: 'Tier',
          render: (value) => (value ? String(value) : '-')
        },
        contractPrice: {
          label: 'Contract Price',
          render: (value) => money(value)
        },
        outstandingBalance: {
          label: 'Outstanding Balance',
          render: (value) => money(value)
        },
        isActive: {
          label: 'Active',
          render: (value) => yesNo(value)
        }
      }}
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
            onClick={() => setValue(generateShortCode('CU'))}
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
      title="Customers"
      transformBeforeSubmit={async (payload, context) => {
        const normalizedCode = String(payload.code ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (normalizedCode && (normalizedCode.length < 1 || normalizedCode.length > 8)) {
          throw new Error('Customer code must be 1 to 8 characters (A-Z, 0-9).');
        }
        if (normalizedCode) {
          const query = new URLSearchParams();
          query.set('code', normalizedCode);
          if (context.mode === 'edit' && context.editingId) {
            query.set('excludeId', context.editingId);
          }
          const existsResult = await apiRequest<{ exists: boolean }>(
            `/master-data/customers/code-exists?${query.toString()}`
          );
          if (existsResult.exists) {
            throw new Error(`Customer code "${normalizedCode}" already exists.`);
          }
        }

        return {
          ...payload,
          code: normalizedCode,
          tier: payload.tier ? String(payload.tier) : null,
          contractPrice:
            payload.contractPrice === null || payload.contractPrice === undefined || payload.contractPrice === ''
              ? null
              : Number(payload.contractPrice)
        };
      }}
      allowDelete
    />
  );
}
