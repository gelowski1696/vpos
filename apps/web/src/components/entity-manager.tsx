'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import { toastError, toastSuccess } from '../lib/web-toast';

export type FieldType = 'text' | 'number' | 'boolean' | 'textarea' | 'date' | 'select' | 'password';

export type SelectOption = {
  value: string;
  label: string;
};

export type EntityField = {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: SelectOption[];
  tableHidden?: boolean;
  formHidden?: boolean;
};

export type EntityRowAction = {
  key: string;
  label: string;
  onClick: (row: Record<string, unknown>) => void;
  buttonClassName?: string;
  isVisible?: (row: Record<string, unknown>) => boolean;
  disabled?: boolean | ((row: Record<string, unknown>) => boolean);
  showWhenReadOnly?: boolean;
};

type EntityManagerProps = {
  title: string;
  endpoint: string;
  reloadSignal?: number;
  toolbarActions?: ReactNode;
  fields: EntityField[];
  rowActions?: EntityRowAction[];
  defaultValues?: Record<string, unknown>;
  transformBeforeSubmit?: (
    payload: Record<string, unknown>,
    context: { mode: 'create' | 'edit'; editingId: string | null }
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  transformBeforeDelete?: (payload: Record<string, unknown>) => Record<string, unknown>;
  transformBeforeReactivate?: (payload: Record<string, unknown>) => Record<string, unknown>;
  onFormStateChange?: (
    form: Record<string, unknown>,
    context: { mode: 'create' | 'edit'; editingId: string | null }
  ) => void;
  renderFieldIndicator?: (args: {
    field: EntityField;
    value: unknown;
    form: Record<string, unknown>;
    mode: 'create' | 'edit';
    editingId: string | null;
  }) => ReactNode;
  renderFieldAction?: (args: {
    field: EntityField;
    value: unknown;
    form: Record<string, unknown>;
    mode: 'create' | 'edit';
    editingId: string | null;
    disabled: boolean;
    setValue: (value: unknown) => void;
  }) => ReactNode;
  readOnly?: boolean;
  readOnlyMessage?: string;
  allowDelete?: boolean;
  deleteConfirmText?: string;
  reactivateConfirmText?: string;
  tableColumnOverrides?: Record<
    string,
    {
      label?: string;
      render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
      sortable?: boolean;
      sortAccessor?: (row: Record<string, unknown>) => unknown;
    }
  >;
};

type DialogMode = 'create' | 'edit' | null;

function withRecordId(endpoint: string, id: string): string {
  const [path, query] = endpoint.split('?');
  if (!query) {
    return `${path}/${id}`;
  }
  return `${path}/${id}?${query}`;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function compactPreview(value: unknown): string {
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item)).join(', ');
    return joined.length > 80 ? `${joined.slice(0, 77)}...` : joined;
  }
  const text = stringifyValue(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function scalarFromValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : '';
  }
  return stringifyValue(value);
}

export function EntityManager({
  title,
  endpoint,
  reloadSignal = 0,
  toolbarActions,
  fields,
  rowActions = [],
  defaultValues = {},
  transformBeforeSubmit,
  transformBeforeDelete,
  transformBeforeReactivate,
  onFormStateChange,
  renderFieldIndicator,
  renderFieldAction,
  readOnly = false,
  readOnlyMessage,
  allowDelete = false,
  deleteConfirmText,
  reactivateConfirmText,
  tableColumnOverrides = {}
}: EntityManagerProps): JSX.Element {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [form, setForm] = useState<Record<string, unknown>>({ ...defaultValues });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'delete' | 'deactivate' | 'reactivate'>('delete');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState<'create' | 'update' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortState, setSortState] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(
    null
  );
  const onFormStateChangeRef = useRef(onFormStateChange);

  const columns = useMemo(() => fields.filter((field) => !field.tableHidden).map((field) => field.key), [fields]);
  const formFields = useMemo(() => fields.filter((field) => !field.formHidden), [fields]);
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const hasActionColumn = useMemo(
    () => !readOnly || rowActions.some((action) => action.showWhenReadOnly === true),
    [readOnly, rowActions]
  );

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<Array<Record<string, unknown>>>(endpoint);
      setItems(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load records';
      setError(message);
      toastError('Failed to load records', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, reloadSignal]);

  useEffect(() => {
    onFormStateChangeRef.current = onFormStateChange;
  }, [onFormStateChange]);

  useEffect(() => {
    if (!dialogMode) {
      return;
    }
    onFormStateChangeRef.current?.(form, {
      mode: dialogMode,
      editingId
    });
  }, [dialogMode, editingId, form]);

  const sortableColumnSet = useMemo(() => {
    const sortableColumns = new Set<string>();
    for (const column of columns) {
      const field = fieldByKey.get(column);
      const override = tableColumnOverrides[column];
      if (override?.sortable === false) {
        continue;
      }
      if (override?.sortable === true || override?.sortAccessor) {
        sortableColumns.add(column);
        continue;
      }
      const type = field?.type ?? 'text';
      if (type !== 'textarea' && type !== 'password') {
        sortableColumns.add(column);
      }
    }
    return sortableColumns;
  }, [columns, fieldByKey, tableColumnOverrides]);

  useEffect(() => {
    if (!sortState) {
      return;
    }
    if (!sortableColumnSet.has(sortState.column)) {
      setSortState(null);
    }
  }, [sortState, sortableColumnSet]);

  function getSortValue(column: string, row: Record<string, unknown>): unknown {
    const override = tableColumnOverrides[column];
    if (override?.sortAccessor) {
      return override.sortAccessor(row);
    }
    return row[column];
  }

  function compareValues(left: unknown, right: unknown): number {
    if (left === right) {
      return 0;
    }
    if (left === null || left === undefined || left === '') {
      return 1;
    }
    if (right === null || right === undefined || right === '') {
      return -1;
    }
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }
    if (typeof left === 'boolean' && typeof right === 'boolean') {
      return Number(left) - Number(right);
    }

    const normalize = (value: unknown): string => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry ?? '')).join(', ').toLowerCase();
      }
      if (typeof value === 'object') {
        return JSON.stringify(value).toLowerCase();
      }
      return String(value).toLowerCase();
    };

    return normalize(left).localeCompare(normalize(right), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered =
      !term
        ? items
        : items.filter((item) =>
            columns.some((column) => stringifyValue(item[column]).toLowerCase().includes(term))
          );

    if (!sortState || !sortableColumnSet.has(sortState.column)) {
      return filtered;
    }

    const directionFactor = sortState.direction === 'asc' ? 1 : -1;
    const decorated = filtered.map((item, index) => ({
      item,
      index,
      value: getSortValue(sortState.column, item)
    }));

    decorated.sort((a, b) => {
      const compared = compareValues(a.value, b.value);
      if (compared !== 0) {
        return compared * directionFactor;
      }
      return a.index - b.index;
    });

    return decorated.map((entry) => entry.item);
  }, [columns, items, searchTerm, sortState, sortableColumnSet, tableColumnOverrides]);

  function toggleSort(column: string): void {
    if (!sortableColumnSet.has(column)) {
      return;
    }
    setSortState((current) => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  }

  function sortIndicator(column: string): string {
    if (!sortState || sortState.column !== column) {
      return '↕';
    }
    return sortState.direction === 'asc' ? '↑' : '↓';
  }

  function columnLabel(column: string): string {
    const override = tableColumnOverrides[column];
    if (override?.label) {
      return override.label;
    }
    return fieldByKey.get(column)?.label ?? column;
  }

  function renderTableValue(column: string, item: Record<string, unknown>): ReactNode {
    const override = tableColumnOverrides[column];
    if (override?.render) {
      return override.render(item[column], item);
    }
    return compactPreview(item[column]);
  }

  function isRowActionVisible(action: EntityRowAction, item: Record<string, unknown>): boolean {
    if (readOnly && action.showWhenReadOnly !== true) {
      return false;
    }
    if (action.isVisible && !action.isVisible(item)) {
      return false;
    }
    return true;
  }

  function isRowActionDisabled(action: EntityRowAction, item: Record<string, unknown>): boolean {
    if (saving) {
      return true;
    }
    if (typeof action.disabled === 'function') {
      return action.disabled(item);
    }
    return Boolean(action.disabled);
  }

  function setFieldValue(key: string, value: unknown, type: FieldType): void {
    let finalValue: unknown = value;
    if (type === 'number') {
      finalValue = value === '' || value === null || value === undefined ? null : Number(value);
    }
    if (type === 'boolean') {
      finalValue =
        value === true ||
        value === 'true' ||
        value === 1 ||
        value === '1';
    }
    if (type !== 'number' && type !== 'boolean' && !Array.isArray(value)) {
      finalValue = value === null || value === undefined ? '' : String(value);
    }
    setForm((prev) => ({ ...prev, [key]: finalValue }));
  }

  function updateField(key: string, value: string, type: FieldType): void {
    setFieldValue(key, value, type);
  }

  function openCreate(): void {
    if (readOnly) {
      return;
    }
    setError(null);
    setEditingId(null);
    const nextForm = { ...defaultValues };
    setForm(nextForm);
    setDialogMode('create');
  }

  function openEdit(item: Record<string, unknown>): void {
    if (readOnly) {
      return;
    }
    setError(null);
    setEditingId(String(item.id));
    const nextForm: Record<string, unknown> = {};
    for (const field of formFields) {
      if (field.type === 'select') {
        nextForm[field.key] = scalarFromValue(item[field.key]);
      } else {
        nextForm[field.key] = item[field.key] ?? '';
      }
    }
    setForm(nextForm);
    setDialogMode('edit');
  }

  function closeDialog(): void {
    setDialogMode(null);
    setConfirmOpen(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
    setDeleteMode('delete');
    setEditingId(null);
    setForm({ ...defaultValues });
  }

  function openDelete(item: Record<string, unknown>): void {
    if (readOnly || !allowDelete) {
      return;
    }
    setError(null);
    setDeleteTarget(item);
    const isActive = Boolean(item.isActive);
    setDeleteMode(isActive ? 'deactivate' : 'reactivate');
    setDeleteConfirmOpen(true);
  }

  function requestSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setConfirmOpen(true);
  }

  async function confirmSubmit(): Promise<void> {
    setSavingAction(editingId ? 'update' : 'create');
    setSaving(true);
    setError(null);

    try {
      const payload = transformBeforeSubmit
        ? await transformBeforeSubmit(form, {
            mode: editingId ? 'edit' : 'create',
            editingId
          })
        : form;

      if (editingId) {
        await apiRequest(withRecordId(endpoint, editingId), {
          method: 'PUT',
          body: payload
        });
        toastSuccess(`${title} record updated.`);
      } else {
        await apiRequest(endpoint, {
          method: 'POST',
          body: payload
        });
        toastSuccess(`${title} record created.`);
      }

      closeDialog();
      await load();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Save failed';
      setError(message);
      toastError('Save failed', { description: message });
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) {
      return;
    }
    const targetId = String(deleteTarget.id ?? '').trim();
    if (!targetId) {
      setError('Invalid record id for delete');
      return;
    }

    setSavingAction(deleteMode === 'reactivate' ? 'update' : 'delete');
    setSaving(true);
    setError(null);
    try {
      if (deleteMode === 'reactivate') {
        const payload = transformBeforeReactivate
          ? transformBeforeReactivate(deleteTarget)
          : { isActive: true };
        await apiRequest(withRecordId(endpoint, targetId), {
          method: 'PUT',
          body: payload
        });
        toastSuccess(`${title} record reactivated.`);
      } else {
        const payload = transformBeforeDelete ? transformBeforeDelete(deleteTarget) : {};
        await apiRequest(withRecordId(endpoint, targetId), {
          method: 'DELETE',
          body: payload
        });
        toastSuccess(`${title} record deactivated.`);
      }
      closeDialog();
      await load();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Delete failed';
      setError(message);
      toastError('Action failed', { description: message });
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }

  const savingMessage =
    savingAction === 'create'
      ? `Creating ${title} record...`
      : savingAction === 'update'
        ? `Updating ${title} record...`
        : savingAction === 'delete'
          ? `Deactivating ${title} record...`
          : 'Processing request...';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brandPrimary">{title}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage records with modal create/edit workflow.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search records..."
            value={searchTerm}
          />
          {toolbarActions}
          {!readOnly ? (
            <button
              className="rounded-lg bg-brandPrimary px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={openCreate}
              type="button"
            >
              Add New
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      {readOnly && readOnlyMessage ? (
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
          {readOnlyMessage}
        </p>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading records...</p>
        ) : filteredItems.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No records found.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] border-collapse">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/70">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {columns.map((column) => (
                      <th className="px-4 py-3" key={column}>
                        {sortableColumnSet.has(column) ? (
                          <button
                            className="inline-flex items-center gap-1 text-left hover:text-slate-700 dark:hover:text-slate-200"
                            onClick={() => toggleSort(column)}
                            type="button"
                          >
                            <span>{columnLabel(column)}</span>
                            <span
                              aria-hidden
                              className={`text-[11px] ${
                                sortState?.column === column
                                  ? 'text-brandPrimary dark:text-brandSecondary'
                                  : 'text-slate-400'
                              }`}
                            >
                              {sortIndicator(column)}
                            </span>
                          </button>
                        ) : (
                          <span>{columnLabel(column)}</span>
                        )}
                      </th>
                    ))}
                    {hasActionColumn ? <th className="px-4 py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, rowIndex) => (
                    <tr
                      className={`border-b border-slate-100 text-sm text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/50 ${rowIndex % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-900/70'}`}
                      key={String(item.id)}
                    >
                      {columns.map((column) => (
                        <td className="max-w-[240px] px-4 py-3 align-top" key={`${String(item.id)}-${column}`}>
                          <span className="block truncate">{renderTableValue(column, item)}</span>
                        </td>
                      ))}
                      {hasActionColumn ? (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {rowActions.map((action) =>
                              isRowActionVisible(action, item) ? (
                                <button
                                  className={
                                    action.buttonClassName ??
                                    'rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
                                  }
                                  disabled={isRowActionDisabled(action, item)}
                                  key={`${String(item.id)}-${action.key}`}
                                  onClick={() => action.onClick(item)}
                                  type="button"
                                >
                                  {action.label}
                                </button>
                              ) : null
                            )}
                            {!readOnly ? (
                              <button
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                disabled={saving}
                                onClick={() => openEdit(item)}
                                type="button"
                              >
                                Edit
                              </button>
                            ) : null}
                            {!readOnly && allowDelete ? (
                              <button
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                  Boolean(item.isActive)
                                    ? 'border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40'
                                    : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40'
                                }`}
                                disabled={saving}
                                onClick={() => openDelete(item)}
                                type="button"
                              >
                                {Boolean(item.isActive) ? 'Deactivate' : 'Reactivate'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {filteredItems.map((item) => (
                <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/70" key={String(item.id)}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{compactPreview(item.name ?? item.code ?? item.id)}</p>
                    {!readOnly || rowActions.some((action) => action.showWhenReadOnly === true) ? (
                      <div className="flex items-center gap-1">
                        {rowActions.map((action) =>
                          isRowActionVisible(action, item) ? (
                            <button
                              className={
                                action.buttonClassName ??
                                'rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200'
                              }
                              disabled={isRowActionDisabled(action, item)}
                              key={`${String(item.id)}-mobile-${action.key}`}
                              onClick={() => action.onClick(item)}
                              type="button"
                            >
                              {action.label}
                            </button>
                          ) : null
                        )}
                        {!readOnly ? (
                          <button
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                            disabled={saving}
                            onClick={() => openEdit(item)}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                        {!readOnly && allowDelete ? (
                          <button
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              Boolean(item.isActive)
                                ? 'border border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300'
                                : 'border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
                            }`}
                            disabled={saving}
                            onClick={() => openDelete(item)}
                            type="button"
                          >
                            {Boolean(item.isActive) ? 'Deactivate' : 'Reactivate'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {columns.map((column) => (
                      <div className="flex items-start justify-between gap-3 text-xs" key={`${String(item.id)}-${column}`}>
                        <span className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{columnLabel(column)}</span>
                        <span className="text-right text-slate-700 dark:text-slate-200">{renderTableValue(column, item)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {dialogMode ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {dialogMode === 'create' ? `Add ${title} Record` : `Edit ${title} Record`}
              </h2>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={closeDialog}
                type="button"
              >
                Close
              </button>
            </header>

            <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={requestSubmit}>
              {formFields.map((field) => {
                const fieldType = field.type ?? 'text';
                const currentValue = form[field.key];

                return (
                  <label className="text-sm" key={field.key}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="block font-medium text-slate-700 dark:text-slate-200">{field.label}</span>
                      {renderFieldAction
                        ? (
                            <span className="shrink-0">
                              {renderFieldAction({
                                field,
                                value: currentValue,
                                form,
                                mode: dialogMode,
                                editingId,
                                disabled: saving,
                                setValue: (value) => setFieldValue(field.key, value, fieldType)
                              })}
                            </span>
                          )
                        : null}
                    </div>
                    {fieldType === 'textarea' ? (
                      <textarea
                        className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        onChange={(event) => updateField(field.key, event.target.value, fieldType)}
                        placeholder={field.placeholder}
                        required={field.required}
                        value={stringifyValue(currentValue)}
                      />
                    ) : fieldType === 'select' ? (
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        onChange={(event) => updateField(field.key, event.target.value, fieldType)}
                        required={field.required}
                        value={scalarFromValue(currentValue)}
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={`${field.key}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : fieldType === 'boolean' ? (
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        onChange={(event) => updateField(field.key, event.target.value, fieldType)}
                        value={String(currentValue ?? true)}
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        onChange={(event) => updateField(field.key, event.target.value, fieldType)}
                        placeholder={field.placeholder}
                        required={field.required}
                        type={fieldType === 'date' ? 'datetime-local' : fieldType}
                        value={stringifyValue(currentValue)}
                      />
                    )}
                    {field.helperText ? <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{field.helperText}</span> : null}
                    {renderFieldIndicator
                      ? (
                          <div className="mt-1">
                            {renderFieldIndicator({
                              field,
                              value: currentValue,
                              form,
                              mode: dialogMode,
                              editingId
                            })}
                          </div>
                        )
                      : null}
                  </label>
                );
              })}

              <div className="flex items-center justify-end gap-2 md:col-span-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  disabled={saving}
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving} type="submit">
                  {dialogMode === 'create' ? 'Create' : 'Update'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Confirm {editingId ? 'Update' : 'Create'}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This will {editingId ? 'update' : 'create'} a record in <span className="font-semibold">{title}</span>. Continue?
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
                onClick={() => void confirmSubmit()}
                type="button"
              >
                {saving ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteConfirmOpen && deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {deleteMode === 'reactivate' ? 'Confirm Reactivate' : 'Confirm Deactivate'}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {deleteMode === 'reactivate'
                ? reactivateConfirmText ?? `This will reactivate this ${title} record by setting Active to Yes.`
                : deleteConfirmText ?? `This will deactivate this ${title} record by setting Active to No.`}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Target: <span className="font-semibold">{compactPreview(deleteTarget.name ?? deleteTarget.code ?? deleteTarget.id)}</span>
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeleteTarget(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  deleteMode === 'reactivate'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
                disabled={saving}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {saving
                  ? deleteMode === 'reactivate'
                    ? 'Reactivating...'
                    : 'Deactivating...'
                  : deleteMode === 'reactivate'
                    ? 'Reactivate'
                    : 'Deactivate'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {saving ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brandPrimary dark:border-slate-600 dark:border-t-brandSecondary" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{savingMessage}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Please wait. Actions are temporarily disabled.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
