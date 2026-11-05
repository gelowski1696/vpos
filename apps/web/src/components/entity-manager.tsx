'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api-client';
import {
  buildCsv,
  reconcileSelection,
  togglePageSelection,
  toggleRowSelection,
  type CsvColumn
} from '../lib/admin-table-state';
import { useTablePagination } from '../lib/table-pagination';
import { toastError, toastSuccess } from '../lib/web-toast';
import { AdminModalMotion } from './admin-motion';
import { TablePaginationControls } from './table-pagination-controls';

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

export type EntitySummaryItem = {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: 'default' | 'positive' | 'warning';
};

export type EntityStatusFilter = {
  key: string;
  label: string;
  matches?: (row: Record<string, unknown>) => boolean;
};

export type EntityFilter = {
  key: string;
  label: string;
  options: SelectOption[];
  value: (row: Record<string, unknown>) => string;
};

export type EntitySelectionConfig = {
  fileName: string;
  columns: Array<CsvColumn<Record<string, unknown>>>;
};

type EntityManagerProps = {
  title: string;
  description?: string;
  primaryActionLabel?: string;
  endpoint: string;
  reloadSignal?: number;
  toolbarActions?: ReactNode;
  summary?: EntitySummaryItem[];
  statusFilters?: EntityStatusFilter[];
  filters?: EntityFilter[];
  selection?: EntitySelectionConfig;
  onItemsChange?: (items: Array<Record<string, unknown>>) => void;
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
  onRowClick?: (row: Record<string, unknown>) => void;
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
  deepLinkEditId?: string | null;
  onDeepLinkHandled?: (result: { id: string; found: boolean }) => void;
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
  description,
  primaryActionLabel,
  endpoint,
  reloadSignal = 0,
  toolbarActions,
  summary = [],
  statusFilters = [],
  filters = [],
  selection,
  onItemsChange,
  fields,
  rowActions = [],
  defaultValues = {},
  transformBeforeSubmit,
  transformBeforeDelete,
  transformBeforeReactivate,
  onFormStateChange,
  onRowClick,
  renderFieldIndicator,
  renderFieldAction,
  readOnly = false,
  readOnlyMessage,
  allowDelete = false,
  deleteConfirmText,
  reactivateConfirmText,
  tableColumnOverrides = {},
  deepLinkEditId = null,
  onDeepLinkHandled
}: EntityManagerProps): React.JSX.Element {
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
  const [statusFilterKey, setStatusFilterKey] = useState(statusFilters[0]?.key ?? 'all');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sortState, setSortState] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(
    null
  );
  const handledDeepLinkRef = useRef<string | null>(null);
  const selectPageRef = useRef<HTMLInputElement | null>(null);
  const activeDialogRef = useRef<HTMLElement | null>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const onFormStateChangeRef = useRef(onFormStateChange);
  const tourSlug = useMemo(
    () =>
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'entity',
    [title]
  );
  const tourPrefix = `${tourSlug}-entity`;

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
      onItemsChange?.(data);
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
    if (!deepLinkEditId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === deepLinkEditId) {
      return;
    }
    if (loading) {
      return;
    }
    const match = items.find((item) => String(item.id ?? '') === deepLinkEditId);
    handledDeepLinkRef.current = deepLinkEditId;
    if (!match) {
      onDeepLinkHandled?.({ id: deepLinkEditId, found: false });
      return;
    }
    openEdit(match);
    onDeepLinkHandled?.({ id: deepLinkEditId, found: true });
  }, [deepLinkEditId, items, loading, onDeepLinkHandled]);

  useEffect(() => {
    if (!dialogMode) {
      return;
    }
    onFormStateChangeRef.current?.(form, {
      mode: dialogMode,
      editingId
    });
  }, [dialogMode, editingId, form]);

  useEffect(() => {
    if (statusFilters.length === 0) {
      setStatusFilterKey('all');
      return;
    }
    if (!statusFilters.some((filter) => filter.key === statusFilterKey)) {
      setStatusFilterKey(statusFilters[0].key);
    }
  }, [statusFilterKey, statusFilters]);

  useEffect(() => {
    setSelectedIds((current) =>
      reconcileSelection(
        current,
        items.map((item) => String(item.id ?? ''))
      )
    );
  }, [items]);

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
    let filtered =
      !term
        ? items
        : items.filter((item) =>
            columns.some((column) => stringifyValue(item[column]).toLowerCase().includes(term))
          );

    const activeStatusFilter = statusFilters.find((filter) => filter.key === statusFilterKey);
    if (activeStatusFilter?.matches) {
      filtered = filtered.filter(activeStatusFilter.matches);
    }

    for (const filter of filters) {
      const selectedValue = filterValues[filter.key];
      if (selectedValue) {
        filtered = filtered.filter((item) => filter.value(item) === selectedValue);
      }
    }

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
  }, [columns, filterValues, filters, items, searchTerm, sortState, sortableColumnSet, statusFilterKey, statusFilters, tableColumnOverrides]);

  const paginatedItems = useTablePagination(filteredItems, {
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetKey: `${searchTerm}|${statusFilterKey}|${JSON.stringify(filterValues)}|${sortState?.column ?? ''}|${sortState?.direction ?? ''}|${
      filteredItems.length
    }`
  });

  const pageIds = useMemo(
    () => paginatedItems.pageRows.map((item) => String(item.id ?? '')).filter(Boolean),
    [paginatedItems.pageRows]
  );
  const selectedRows = useMemo(
    () => items.filter((item) => selectedIds.has(String(item.id ?? ''))),
    [items, selectedIds]
  );
  const allPageRowsSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageRowsSelected = pageIds.some((id) => selectedIds.has(id));
  const selectionQueryKey = `${searchTerm}|${statusFilterKey}|${JSON.stringify(filterValues)}`;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionQueryKey]);

  useEffect(() => {
    if (selectPageRef.current) {
      selectPageRef.current.indeterminate = somePageRowsSelected && !allPageRowsSelected;
    }
  }, [allPageRowsSelected, somePageRowsSelected]);

  const activeDialog = saving
    ? 'saving'
    : deleteConfirmOpen
      ? 'delete'
      : confirmOpen
        ? 'confirm'
        : dialogMode
          ? 'editor'
          : null;

  useEffect(() => {
    if (!activeDialog) {
      dialogReturnFocusRef.current?.focus();
      dialogReturnFocusRef.current = null;
      return;
    }

    if (!dialogReturnFocusRef.current && document.activeElement instanceof HTMLElement) {
      dialogReturnFocusRef.current = document.activeElement;
    }

    const dialog = activeDialogRef.current;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    (focusable[0] ?? dialog)?.focus();

    function handleDialogKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && activeDialog !== 'saving') {
        event.preventDefault();
        if (activeDialog === 'delete') {
          setDeleteConfirmOpen(false);
          setDeleteTarget(null);
        } else if (activeDialog === 'confirm') {
          setConfirmOpen(false);
        } else {
          closeDialog();
        }
        return;
      }

      if (event.key !== 'Tab' || !dialog) {
        return;
      }
      const currentFocusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeyDown);
    };
  }, [activeDialog]);

  function downloadSelection(): void {
    if (!selection || selectedRows.length === 0) {
      return;
    }
    const csv = buildCsv(selectedRows, selection.columns);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selection.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    Boolean(statusFilters.find((filter) => filter.key === statusFilterKey)?.matches) ||
    Object.values(filterValues).some(Boolean);

  function clearFilters(): void {
    setSearchTerm('');
    setStatusFilterKey(statusFilters[0]?.key ?? 'all');
    setFilterValues({});
  }

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

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLElement>, item: Record<string, unknown>): void {
    if (!onRowClick) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(item);
    }
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
    <div data-tour={`${tourPrefix}-root`} className={selectedIds.size > 0 ? 'pb-16' : undefined}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-adminText">{title}</h1>
          <p className="mt-1 text-sm text-adminTextMuted">
            {description ?? `Manage ${title.toLowerCase()} records.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {toolbarActions}
          {!readOnly ? (
            <button
              data-tour={`${tourPrefix}-add`}
              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-brandPrimary px-3.5 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(45,30,90,0.18)] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={openCreate}
              type="button"
            >
              <span aria-hidden="true" className="mr-1.5 text-base leading-none">+</span>
              {primaryActionLabel ?? `Add ${title.replace(/s$/i, '')}`}
            </button>
          ) : null}
        </div>
      </div>

      {summary.length > 0 ? (
        <section aria-label={`${title} summary`} className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map((item) => (
            <article className="rounded-xl border border-adminBorder bg-adminMuted px-3.5 py-3" key={item.label}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-adminTextMuted">{item.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${item.tone === 'positive' ? 'text-emerald-700 dark:text-emerald-300' : item.tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-adminText'}`}>
                {item.value}
              </p>
              {item.detail ? <p className="mt-1 text-[11px] text-adminTextMuted">{item.detail}</p> : null}
            </article>
          ))}
        </section>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-y border-adminBorder py-2.5">
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
            <span className="sr-only">Search {title.toLowerCase()}</span>
            <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-adminTextMuted" fill="none" viewBox="0 0 24 24">
              <path d="M21 21l-4.4-4.4M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
            <input
              data-tour={`${tourPrefix}-search`}
              className="h-9 w-full rounded-lg border border-adminBorder bg-adminSurface py-2 pl-9 pr-3 text-sm text-adminText"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}...`}
              type="search"
              value={searchTerm}
            />
          </label>
          {filters.map((filter) => (
            <label key={filter.key}>
              <span className="sr-only">{filter.label}</span>
              <select
                aria-label={filter.label}
                className="h-9 rounded-lg border border-adminBorder bg-adminSurface px-2.5 text-xs font-medium text-adminText"
                onChange={(event) => setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))}
                value={filterValues[filter.key] ?? ''}
              >
                <option value="">All {filter.label}</option>
                {filter.options.map((option) => <option key={`${filter.key}-${option.value}`} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ))}
          {hasActiveFilters ? (
            <button className="h-9 rounded-lg px-2.5 text-xs font-semibold text-adminTextMuted hover:bg-adminMuted hover:text-adminText" onClick={clearFilters} type="button">
              Clear filters
            </button>
          ) : null}
        </div>
        {statusFilters.length > 0 ? (
          <div aria-label={`${title} status`} className="flex items-center rounded-lg bg-adminMuted p-1" role="group">
            {statusFilters.map((filter) => (
              <button
                aria-pressed={statusFilterKey === filter.key}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${statusFilterKey === filter.key ? 'bg-adminSurface text-adminText shadow-sm' : 'text-adminTextMuted hover:text-adminText'}`}
                key={filter.key}
                onClick={() => setStatusFilterKey(filter.key)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
          <span>{error}</span>
          <button className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-semibold hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-950" onClick={() => void load()} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {readOnly && readOnlyMessage ? (
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
          {readOnlyMessage}
        </p>
      ) : null}

      <div data-tour={`${tourPrefix}-table`} className="overflow-hidden rounded-xl border border-adminBorder bg-adminSurface">
        {loading ? (
          <div aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`} className="space-y-2 p-4" role="status">
            {Array.from({ length: 5 }, (_, index) => <div className="h-11 animate-pulse rounded-lg bg-adminMuted" key={index} />)}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-4 py-10 text-center" role="status">
            <p className="text-sm font-semibold text-adminText">{items.length === 0 ? `No ${title.toLowerCase()} yet.` : 'No matching records.'}</p>
            <p className="mt-1 text-xs text-adminTextMuted">{items.length === 0 ? 'Add a record to get started.' : 'Try changing or clearing the current filters.'}</p>
            {hasActiveFilters ? <button className="mt-3 rounded-lg border border-adminBorder px-3 py-2 text-xs font-semibold text-adminText" onClick={clearFilters} type="button">Clear filters</button> : null}
            {items.length === 0 && !readOnly ? <button className="mt-3 rounded-lg bg-brandPrimary px-3 py-2 text-xs font-semibold text-white" onClick={openCreate} type="button">{primaryActionLabel ?? `Add ${title.replace(/s$/i, '')}`}</button> : null}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] border-collapse">
                <thead className="sticky top-0 bg-adminMuted">
                  <tr className="border-b border-adminBorder text-left text-xs uppercase tracking-wide text-adminTextMuted">
                    {selection ? (
                      <th className="w-11 px-3 py-2.5" scope="col">
                        <input
                          ref={selectPageRef}
                          aria-label={allPageRowsSelected ? 'Clear current page selection' : 'Select current page'}
                          checked={allPageRowsSelected}
                          className="h-4 w-4 rounded border-adminBorder text-brandPrimary accent-[var(--admin-accent)]"
                          onChange={(event) => setSelectedIds((current) => togglePageSelection(current, pageIds, event.target.checked))}
                          type="checkbox"
                        />
                      </th>
                    ) : null}
                    {columns.map((column) => (
                      <th
                        aria-sort={sortState?.column === column ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                        className="px-3 py-2.5"
                        key={column}
                        scope="col"
                      >
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
                    {hasActionColumn ? <th className="px-3 py-2.5" scope="col">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.pageRows.map((item) => {
                    const itemId = String(item.id ?? '');
                    const selected = selectedIds.has(itemId);
                    return (
                    <tr
                      aria-selected={selection ? selected : undefined}
                      className={`border-b border-adminBorder text-sm text-adminText transition-colors hover:bg-adminMuted ${selected ? 'bg-adminAccentSoft' : 'bg-adminSurface'} ${onRowClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandPrimary/40' : ''}`}
                      key={itemId}
                      onClick={onRowClick ? () => onRowClick(item) : undefined}
                      onKeyDown={(event) => handleRowKeyDown(event, item)}
                      role={onRowClick ? 'button' : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      {selection ? (
                        <td className="w-11 px-3 py-2.5 align-middle">
                          <input
                            aria-label={`Select ${compactPreview(item.name ?? item.code ?? item.id)}`}
                            checked={selected}
                            className="h-4 w-4 rounded border-adminBorder text-brandPrimary accent-[var(--admin-accent)]"
                            onChange={() => setSelectedIds((current) => toggleRowSelection(current, itemId))}
                            onClick={(event) => event.stopPropagation()}
                            type="checkbox"
                          />
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td className="max-w-[240px] px-3 py-2.5 align-middle" key={`${itemId}-${column}`}>
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
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    action.onClick(item);
                                  }}
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEdit(item);
                                }}
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openDelete(item);
                                }}
                                type="button"
                              >
                                {Boolean(item.isActive) ? 'Deactivate' : 'Reactivate'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {paginatedItems.pageRows.map((item) => {
                const itemId = String(item.id ?? '');
                const selected = selectedIds.has(itemId);
                return (
                <article
                  aria-selected={selection ? selected : undefined}
                  className={`rounded-xl border border-adminBorder p-3 ${selected ? 'bg-adminAccentSoft' : 'bg-adminSurface'} ${onRowClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandPrimary/40' : ''}`}
                  key={itemId}
                  onClick={onRowClick ? () => onRowClick(item) : undefined}
                  onKeyDown={(event) => handleRowKeyDown(event, item)}
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      {selection ? (
                        <input
                          aria-label={`Select ${compactPreview(item.name ?? item.code ?? item.id)}`}
                          checked={selected}
                          className="h-4 w-4 shrink-0 accent-[var(--admin-accent)]"
                          onChange={() => setSelectedIds((current) => toggleRowSelection(current, itemId))}
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                      ) : null}
                      <p className="truncate text-sm font-semibold text-adminText">{compactPreview(item.name ?? item.code ?? item.id)}</p>
                    </div>
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
                              onClick={(event) => {
                                event.stopPropagation();
                                action.onClick(item);
                              }}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(item);
                            }}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              openDelete(item);
                            }}
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
                );
              })}
            </div>

            <TablePaginationControls
              endRow={paginatedItems.endRow}
              onPageChange={paginatedItems.setPage}
              onPageSizeChange={paginatedItems.setPageSize}
              page={paginatedItems.page}
              pageSize={paginatedItems.pageSize}
              pageSizeOptions={paginatedItems.pageSizeOptions}
              startRow={paginatedItems.startRow}
              totalItems={paginatedItems.totalItems}
              totalPages={paginatedItems.totalPages}
            />
          </>
        )}
      </div>

      {selection && selectedRows.length > 0 ? (
        <div aria-live="polite" className="fixed bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-adminBorder bg-adminSurface px-3 py-2 shadow-xl">
          <span className="whitespace-nowrap text-sm font-semibold text-adminText">{selectedRows.length} selected</span>
          <span aria-hidden="true" className="h-5 w-px bg-adminBorder" />
          <button className="rounded-lg border border-adminBorder px-3 py-1.5 text-xs font-semibold text-adminText hover:bg-adminMuted" onClick={downloadSelection} type="button">
            Export CSV
          </button>
          <button className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-adminTextMuted hover:bg-adminMuted hover:text-adminText" onClick={() => setSelectedIds(new Set())} type="button">
            Clear
          </button>
        </div>
      ) : null}

      {dialogMode ? (
        <AdminModalMotion className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px]">
          <section
            ref={(node) => {
              activeDialogRef.current = node;
            }}
            aria-labelledby="entity-editor-title"
            aria-modal="true"
            className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-adminBorder bg-adminSurface shadow-xl"
            role="dialog"
            tabIndex={-1}
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100" id="entity-editor-title">
                {dialogMode === 'create' ? `Add ${title} Record` : `Edit ${title} Record`}
              </h2>
              <button
                aria-label="Close record editor"
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
        </AdminModalMotion>
      ) : null}

      {confirmOpen ? (
        <AdminModalMotion className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[3px]">
          <section
            ref={(node) => {
              activeDialogRef.current = node;
            }}
            aria-labelledby="entity-confirm-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-adminBorder bg-adminSurface p-4 shadow-2xl"
            role="alertdialog"
            tabIndex={-1}
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100" id="entity-confirm-title">Confirm {editingId ? 'Update' : 'Create'}</h3>
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
        </AdminModalMotion>
      ) : null}

      {deleteConfirmOpen && deleteTarget ? (
        <AdminModalMotion className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[3px]">
          <section
            ref={(node) => {
              activeDialogRef.current = node;
            }}
            aria-labelledby="entity-delete-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-adminBorder bg-adminSurface p-4 shadow-2xl"
            role="alertdialog"
            tabIndex={-1}
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100" id="entity-delete-title">
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
        </AdminModalMotion>
      ) : null}

      {saving ? (
        <AdminModalMotion className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px]">
          <div
            ref={(node) => {
              activeDialogRef.current = node;
            }}
            aria-live="polite"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-adminBorder bg-adminSurface px-5 py-4 shadow-xl"
            role="status"
            tabIndex={-1}
          >
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brandPrimary dark:border-slate-600 dark:border-t-brandSecondary" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{savingMessage}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Please wait. Actions are temporarily disabled.
            </p>
          </div>
        </AdminModalMotion>
      ) : null}
    </div>
  );
}
