'use client';

import { useEffect, useRef, useState } from 'react';
import { EntityManager } from '../../../components/entity-manager';
import { MasterDataImportWizard, type ImportColumn } from '../../../components/master-data-import-wizard';
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
    .slice(0, 4) || 'PC';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

export default function ProductCategoriesPage(): JSX.Element {
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
  const importColumns: ImportColumn[] = [
    { key: 'code', label: 'Category Code', required: true, example: 'LPG11', aliases: ['category_code'] },
    { key: 'name', label: 'Category Name', required: true, example: 'LPG 11kg', aliases: ['category_name'] },
    {
      key: 'isActive',
      label: 'Active',
      example: true,
      aliases: ['is_active'],
      templateDropdownValues: ['TRUE', 'FALSE']
    }
  ];

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
      void apiRequest<{ exists: boolean }>(`/master-data/product-categories/code-exists?${query.toString()}`)
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

  return (
    <EntityManager
      allowDelete
      defaultValues={{ code: '', name: '', isActive: true }}
      endpoint="/master-data/product-categories"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Product Categories"
          entity="product-categories"
          endpointBase="/master-data/import/product-categories"
          columns={importColumns}
          onImported={async () => {
            setReloadSignal((current) => current + 1);
          }}
        />
      }
      fields={[
        {
          key: 'code',
          label: 'Category Code',
          helperText: 'Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.'
        },
        {
          key: 'name',
          label: 'Category Name',
          required: true,
          helperText: 'Display label used when assigning category to products.'
        },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      tableColumnOverrides={{
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
            onClick={() => setValue(generateShortCode('PC'))}
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
      transformBeforeSubmit={async (payload, context) => {
        const normalizedCode = String(payload.code ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (!normalizedCode) {
          return {
            ...payload,
            code: ''
          };
        }
        if (normalizedCode.length < 1 || normalizedCode.length > 8) {
          throw new Error('Category code must be 1 to 8 characters (A-Z, 0-9).');
        }

        const query = new URLSearchParams();
        query.set('code', normalizedCode);
        if (context.mode === 'edit' && context.editingId) {
          query.set('excludeId', context.editingId);
        }
        const existsResult = await apiRequest<{ exists: boolean }>(
          `/master-data/product-categories/code-exists?${query.toString()}`
        );
        if (existsResult.exists) {
          throw new Error(`Category code "${normalizedCode}" already exists.`);
        }

        return {
          ...payload,
          code: normalizedCode
        };
      }}
      title="Product Categories"
    />
  );
}
