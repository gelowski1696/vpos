'use client';

import { useState } from 'react';
import { EntityManager } from '../../../components/entity-manager';
import { MasterDataImportWizard, type ImportColumn } from '../../../components/master-data-import-wizard';

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
    .slice(0, 4) || 'PB';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

export default function ProductBrandsPage(): JSX.Element {
  const [reloadSignal, setReloadSignal] = useState(0);
  const importColumns: ImportColumn[] = [
    { key: 'code', label: 'Brand Code', required: true, example: 'VMJAM', aliases: ['brand_code'] },
    { key: 'name', label: 'Brand Name', required: true, example: 'VMJAM Gas', aliases: ['brand_name'] },
    {
      key: 'isActive',
      label: 'Active',
      example: true,
      aliases: ['is_active'],
      templateDropdownValues: ['TRUE', 'FALSE']
    }
  ];

  return (
    <EntityManager
      allowDelete
      defaultValues={{ code: '', name: '', isActive: true }}
      endpoint="/master-data/product-brands"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Product Brands"
          entity="product-brands"
          endpointBase="/master-data/import/product-brands"
          columns={importColumns}
          onImported={async () => {
            setReloadSignal((current) => current + 1);
          }}
        />
      }
      fields={[
        {
          key: 'code',
          label: 'Brand Code',
          required: true,
          helperText: 'Short unique code, for example VMJAM.'
        },
        {
          key: 'name',
          label: 'Brand Name',
          required: true,
          helperText: 'Display label used when assigning brand to products.'
        },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      renderFieldAction={({ field, disabled, setValue }) =>
        field.key === 'code' ? (
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => setValue(generateShortCode('PB'))}
            title="Auto-generate code"
            type="button"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
              <path d="M12 3v4M12 17v4M4.2 7.2l2.8 2.8M17 14l2.8 2.8M3 12h4M17 12h4M4.2 16.8 7 14M17 10l2.8-2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        ) : null
      }
      tableColumnOverrides={{
        isActive: {
          label: 'Active',
          render: (value) => yesNo(value)
        }
      }}
      title="Product Brands"
    />
  );
}
