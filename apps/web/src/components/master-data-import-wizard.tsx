'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiRequest } from '../lib/api-client';
import { toastError, toastInfo, toastPromise, toastSuccess } from '../lib/web-toast';

type ImportColumn = {
  key: string;
  label: string;
  required?: boolean;
  example?: string | number | boolean | null;
  aliases?: string[];
  templateDropdownValues?: string[];
};

type ImportValidationRow = {
  rowNumber: number;
  status: 'valid' | 'invalid';
  operation: 'create' | 'update';
  messages: string[];
  normalized: Record<string, unknown> | null;
};

type ImportValidationSummary = {
  entity:
    | 'products'
    | 'customers'
    | 'product-categories'
    | 'product-brands'
    | 'cylinder-types'
    | 'suppliers'
    | 'personnels';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createCount: number;
  updateCount: number;
  rows: ImportValidationRow[];
};

type ImportCommitResult = {
  entity:
    | 'products'
    | 'customers'
    | 'product-categories'
    | 'product-brands'
    | 'cylinder-types'
    | 'suppliers'
    | 'personnels';
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ rowNumber: number; message: string }>;
};

type Props = {
  title: string;
  entity:
    | 'products'
    | 'customers'
    | 'product-categories'
    | 'product-brands'
    | 'cylinder-types'
    | 'suppliers'
    | 'personnels';
  endpointBase:
    | '/master-data/import/products'
    | '/master-data/import/customers'
    | '/master-data/import/product-categories'
    | '/master-data/import/product-brands'
    | '/master-data/import/cylinder-types'
    | '/master-data/import/suppliers'
    | '/master-data/import/personnels';
  columns: ImportColumn[];
  onImported?: () => Promise<void> | void;
};

function normalizeHeader(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function MasterDataImportWizard({
  title,
  entity,
  endpointBase,
  columns,
  onImported
}: Props): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [validation, setValidation] = useState<ImportValidationSummary | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [commitSuccessAnimated, setCommitSuccessAnimated] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const column of columns) {
      map.set(normalizeHeader(column.key), column.key);
      map.set(normalizeHeader(column.label), column.key);
      for (const alias of column.aliases ?? []) {
        map.set(normalizeHeader(alias), column.key);
      }
    }
    return map;
  }, [columns]);

  const previewRows = useMemo(() => rows.slice(0, 8), [rows]);
  const requiredColumns = useMemo(
    () => columns.filter((column) => column.required).map((column) => column.label),
    [columns]
  );
  const currentStep = useMemo<number>(() => {
    if (commitResult) {
      return 4;
    }
    if (validation) {
      return 3;
    }
    if (rows.length > 0) {
      return 2;
    }
    return 1;
  }, [rows.length, validation, commitResult]);

  const resetState = (): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setFileName('');
    setRows([]);
    setValidation(null);
    setCommitResult(null);
    setError(null);
    setSkipInvalid(true);
    setCommitSuccessAnimated(false);
  };

  const close = (): void => {
    setOpen(false);
    resetState();
  };

  const backToStep = (step: number): void => {
    if (step >= currentStep) {
      return;
    }
    if (step === 1) {
      resetState();
      return;
    }
    if (step === 2) {
      setValidation(null);
      setCommitResult(null);
      setCommitSuccessAnimated(false);
      setError(null);
      return;
    }
    if (step === 3) {
      setCommitResult(null);
      setCommitSuccessAnimated(false);
      setError(null);
    }
  };

  const scheduleAutoClose = (): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      close();
    }, 1600);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const downloadTemplate = (): void => {
    const dropdownColumns = columns
      .map((column, index) => ({
        column,
        index,
        values: Array.from(
          new Set(
            (column.templateDropdownValues ?? [])
              .map((value) => String(value ?? '').trim())
              .filter((value) => value.length > 0)
          )
        )
      }))
      .filter((entry) => entry.values.length > 0);

    const sampleRow: Record<string, unknown> = {};
    for (const column of columns) {
      sampleRow[column.label] = column.example ?? '';
    }
    const downloadFallback = (): void => {
      const worksheet = XLSX.utils.json_to_sheet([sampleRow]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
      const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([output], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `vpos-${entity}-import-template.xlsx`;
      anchor.click();
      URL.revokeObjectURL(href);
    };

    if (dropdownColumns.length === 0) {
      downloadFallback();
      return;
    }

    const buildWithDropdowns = async (): Promise<void> => {
      try {
        const exceljs = await import('exceljs');
        const workbook = new exceljs.Workbook();
        const templateSheet = workbook.addWorksheet('Template');
        const listsSheet = workbook.addWorksheet('Lists');
        listsSheet.state = 'veryHidden';

        const headers = columns.map((column) => column.label);
        templateSheet.addRow(headers);
        templateSheet.addRow(columns.map((column) => column.example ?? ''));
        templateSheet.views = [{ state: 'frozen', ySplit: 1 }];

        headers.forEach((header, index) => {
          templateSheet.getColumn(index + 1).width = Math.max(16, header.length + 4);
          templateSheet.getCell(1, index + 1).font = { bold: true };
        });

        let listColumn = 1;
        for (const entry of dropdownColumns) {
          for (let rowIndex = 0; rowIndex < entry.values.length; rowIndex += 1) {
            listsSheet.getCell(rowIndex + 1, listColumn).value = entry.values[rowIndex];
          }
          const listColumnLetter = listsSheet.getColumn(listColumn).letter;
          if (!listColumnLetter) {
            listColumn += 1;
            continue;
          }
          const formula = `Lists!$${listColumnLetter}$1:$${listColumnLetter}$${entry.values.length}`;
          for (let rowNumber = 2; rowNumber <= 2000; rowNumber += 1) {
            templateSheet.getCell(rowNumber, entry.index + 1).dataValidation = {
              type: 'list',
              allowBlank: !entry.column.required,
              formulae: [formula],
              showErrorMessage: true,
              errorStyle: 'stop',
              errorTitle: 'Invalid selection',
              error: `Please select a valid ${entry.column.label}.`
            };
          }
          listColumn += 1;
        }

        for (let rowNumber = 2; rowNumber <= 2000; rowNumber += 1) {
          for (let columnNumber = 1; columnNumber <= headers.length; columnNumber += 1) {
            templateSheet.getCell(rowNumber, columnNumber).protection = { locked: false };
          }
        }
        await templateSheet.protect('VPOS_TEMPLATE', {
          selectLockedCells: true,
          selectUnlockedCells: true,
          formatCells: false,
          formatColumns: false,
          formatRows: false,
          insertColumns: false,
          insertRows: false,
          insertHyperlinks: false,
          deleteColumns: false,
          deleteRows: false,
          sort: false,
          autoFilter: false,
          pivotTables: false
        });
        await listsSheet.protect('VPOS_TEMPLATE', {
          selectLockedCells: false,
          selectUnlockedCells: false,
          formatCells: false,
          formatColumns: false,
          formatRows: false,
          insertColumns: false,
          insertRows: false,
          insertHyperlinks: false,
          deleteColumns: false,
          deleteRows: false,
          sort: false,
          autoFilter: false,
          pivotTables: false
        });

        const output = await workbook.xlsx.writeBuffer();
        const blob = new Blob([output], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = `vpos-${entity}-import-template.xlsx`;
        anchor.click();
        URL.revokeObjectURL(href);
      } catch {
        downloadFallback();
      }
    };

    void buildWithDropdowns();
  };

  const onFileSelected = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }
    setError(null);
    setValidation(null);
    setCommitResult(null);
    setCommitSuccessAnimated(false);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        throw new Error('Excel file is empty.');
      }
      const worksheet = workbook.Sheets[firstSheet];
      const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
        raw: false
      });

      const normalizedRows = parsedRows
        .map((entry) => {
          const normalized: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(entry)) {
            const mappedKey = headerMap.get(normalizeHeader(key));
            if (!mappedKey) {
              continue;
            }
            normalized[mappedKey] = value;
          }
          return normalized;
        })
        .filter((entry) => Object.keys(entry).length > 0);

      if (!normalizedRows.length) {
        throw new Error('No import rows found. Please use the template headers.');
      }

      setFileName(file.name);
      setRows(normalizedRows);
      toastSuccess('Import file loaded', {
        description: `${normalizedRows.length} row(s) ready for validation.`
      });
    } catch (cause) {
      setRows([]);
      setFileName(file.name);
      const message = cause instanceof Error ? cause.message : 'Unable to parse file.';
      setError(message);
      toastError('Failed to read file', { description: message });
    }
  };

  const processSelectedFiles = (files: FileList | null): void => {
    const file = files?.[0] ?? null;
    void onFileSelected(file);
  };

  const validate = async (): Promise<void> => {
    if (!rows.length) {
      const message = 'Please upload a file first.';
      setError(message);
      toastInfo('Import file required', { description: message });
      return;
    }
    setError(null);
    setCommitResult(null);
    setCommitSuccessAnimated(false);
    setValidating(true);
    try {
      const result = await toastPromise(
        () =>
          apiRequest<ImportValidationSummary>(`${endpointBase}/validate`, {
            method: 'POST',
            body: { rows }
          }),
        {
          loading: {
            title: 'Validating import...',
            description: `${rows.length} row(s)`
          },
          success: (summary) => ({
            title: 'Validation complete',
            description: `${summary.validRows} valid, ${summary.invalidRows} invalid.`
          }),
          error: (cause) => ({
            title: 'Validation failed',
            description: errorMessage(cause, 'Validation failed.')
          })
        }
      );
      setValidation(result);
    } catch (cause) {
      setValidation(null);
      setError(errorMessage(cause, 'Validation failed.'));
    } finally {
      setValidating(false);
    }
  };

  const commit = async (): Promise<void> => {
    if (!rows.length) {
      const message = 'Please upload a file first.';
      setError(message);
      toastInfo('Import file required', { description: message });
      return;
    }
    setError(null);
    setCommitSuccessAnimated(false);
    setCommitting(true);
    try {
      const result = await toastPromise(
        () =>
          apiRequest<ImportCommitResult>(`${endpointBase}/commit`, {
            method: 'POST',
            body: {
              rows,
              skipInvalid
            }
          }),
        {
          loading: {
            title: 'Committing import...',
            description: 'Posting rows to server'
          },
          success: (summary) => ({
            title: 'Import completed',
            description: `Created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}, failed ${summary.failed}.`
          }),
          error: (cause) => ({
            title: 'Import failed',
            description: errorMessage(cause, 'Import commit failed.')
          })
        }
      );
      setCommitResult(result);
      setCommitSuccessAnimated(true);
      scheduleAutoClose();
      if (onImported) {
        void Promise.resolve(onImported()).catch((cause) => {
          const message = cause instanceof Error ? cause.message : 'Refresh after import failed.';
          toastInfo('Import saved, refresh failed', { description: message });
        });
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Import commit failed.'));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <button
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        onClick={() => setOpen(true)}
        type="button"
      >
        Import Excel
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title} Import Wizard</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Fast, guided import with preview and validation.</p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={close}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="space-y-4 overflow-auto p-4">
              <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-3 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900">
                <div className="grid gap-2 md:grid-cols-4">
                  {[
                    { step: 1, label: 'Template' },
                    { step: 2, label: 'Upload' },
                    { step: 3, label: 'Validate' },
                    { step: 4, label: 'Import' }
                  ].map((item) => {
                    const active = currentStep === item.step;
                    const done = currentStep > item.step;
                    return (
                      <button
                        key={item.step}
                        type="button"
                        onClick={() => backToStep(item.step)}
                        disabled={!done}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          active
                            ? 'border-brandPrimary bg-brandPrimary/10 text-brandPrimary'
                            : done
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                              : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400'
                        } ${done ? 'cursor-pointer hover:ring-1 hover:ring-emerald-400/70' : ''}`}
                      >
                        <p className="font-semibold">
                          {done ? 'DONE' : active ? 'CURRENT' : 'PENDING'} - Step {item.step}
                        </p>
                        <p className="mt-0.5">{item.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className={`rounded-xl border-2 border-dashed p-4 transition ${
                  dragActive
                    ? 'border-brandPrimary bg-brandPrimary/5'
                    : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60'
                }`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  processSelectedFiles(event.dataTransfer.files);
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {fileName ? `Uploaded: ${fileName}` : 'Drop Excel/CSV file here'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Supported: `.xlsx`, `.xls`, `.csv`. Use template headers for best results.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg bg-brandPrimary px-3 py-2 text-xs font-semibold text-white hover:brightness-110"
                      onClick={downloadTemplate}
                      type="button"
                    >
                      Download Template
                    </button>
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      Choose File
                    </button>
                    <input
                      ref={fileInputRef}
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(event) => {
                        processSelectedFiles(event.target.files);
                        event.currentTarget.value = '';
                      }}
                      type="file"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {requiredColumns.map((column) => (
                    <span
                      key={column}
                      className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </div>

              {error ? <p className="text-sm text-rose-700">{error}</p> : null}

              {rows.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Parsed Rows: {rows.length}
                    </p>
                    <span className="rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300">
                      Step 2 of 4
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <th className="px-2 py-2">#</th>
                          {columns.map((column) => (
                            <th className="px-2 py-2" key={column.key}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr className="border-b border-slate-100 dark:border-slate-800" key={`preview-${index}`}>
                            <td className="px-2 py-2 text-slate-500">{index + 2}</td>
                            {columns.map((column) => (
                              <td className="px-2 py-2 text-slate-700 dark:text-slate-200" key={`${index}-${column.key}`}>
                                {toDisplay(row[column.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > previewRows.length ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Showing first {previewRows.length} rows only.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {validation ? (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <div className="grid gap-2 sm:grid-cols-5">
                    <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                      <p className="text-slate-500 dark:text-slate-400">Total</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{validation.totalRows}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 p-2 text-xs dark:border-emerald-700/50">
                      <p className="text-emerald-700 dark:text-emerald-300">Valid</p>
                      <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">{validation.validRows}</p>
                    </div>
                    <div className="rounded-lg border border-rose-200 p-2 text-xs dark:border-rose-700/50">
                      <p className="text-rose-700 dark:text-rose-300">Invalid</p>
                      <p className="text-base font-semibold text-rose-700 dark:text-rose-300">{validation.invalidRows}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                      <p className="text-slate-500 dark:text-slate-400">Creates</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{validation.createCount}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                      <p className="text-slate-500 dark:text-slate-400">Updates</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{validation.updateCount}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      checked={skipInvalid}
                      id={`skip-invalid-${entity}`}
                      onChange={(event) => setSkipInvalid(event.target.checked)}
                      type="checkbox"
                    />
                    <label className="text-xs text-slate-700 dark:text-slate-300" htmlFor={`skip-invalid-${entity}`}>
                      Skip invalid rows and import only valid rows
                    </label>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <th className="px-2 py-2">Row</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Operation</th>
                          <th className="px-2 py-2">Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validation.rows.slice(0, 40).map((row) => (
                          <tr
                            className={`border-b dark:border-slate-800 ${
                              row.status === 'invalid' ? 'border-rose-100 bg-rose-50/60 dark:border-rose-900/30 dark:bg-rose-950/20' : 'border-slate-100'
                            }`}
                            key={`val-${row.rowNumber}`}
                          >
                            <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.rowNumber}</td>
                            <td className="px-2 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 font-semibold ${
                                  row.status === 'valid'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                }`}
                              >
                                {row.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.operation}</td>
                            <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                              {row.messages.length ? row.messages.join('; ') : 'OK'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              ) : null}

              {commitResult ? (
                <div
                  className={`rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 transition-all duration-300 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200 ${
                    commitSuccessAnimated ? 'scale-100 opacity-100' : 'scale-95 opacity-70'
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                      OK
                    </span>
                    <p className="font-semibold">Import completed. Closing automatically...</p>
                  </div>
                  <p className="mt-1">
                    Created: {commitResult.created} | Updated: {commitResult.updated} | Skipped: {commitResult.skipped} | Failed: {commitResult.failed}
                  </p>
                  {commitResult.errors.length ? (
                    <div className="mt-2 space-y-1">
                      {commitResult.errors.slice(0, 8).map((entry) => (
                        <p key={`${entry.rowNumber}-${entry.message}`}>Row {entry.rowNumber}: {entry.message}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {validation
                  ? `Ready: ${validation.validRows} valid row(s). ${skipInvalid ? 'Invalid rows will be skipped.' : 'Fix invalid rows before commit.'}`
                  : rows.length
                    ? 'Next step: Validate your file.'
                    : 'Next step: Upload your file.'}
              </p>
              <div className="flex items-center gap-2">
                {rows.length > 0 ? (
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={resetState}
                    type="button"
                  >
                    Reset
                  </button>
                ) : null}
                <button
                  className="rounded-lg bg-brandSecondary px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
                  disabled={validating || committing || rows.length === 0}
                  onClick={() => void validate()}
                  type="button"
                >
                  {validating ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                      Validating...
                    </span>
                  ) : (
                    'Validate'
                  )}
                </button>
                <button
                  className="rounded-lg bg-brandPrimary px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
                  disabled={committing || validating || !validation || validation.validRows === 0}
                  onClick={() => void commit()}
                  type="button"
                >
                  {committing ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                      Importing...
                    </span>
                  ) : (
                    'Commit Import'
                  )}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

export type { ImportColumn };

