import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopOption,
  DesktopPurchaseOrderPulloutReason,
  DesktopPurchaseOrderRecord
} from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import {
  desktopPurchaseOrderService,
  type CreateDesktopPurchaseOrderInput,
  type DesktopPurchaseOrderDeliveryInput
} from '../services/desktop-purchase-order.service';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
};

type PurchaseOrderStatusFilter = 'ALL' | 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';
type PurchaseOrderSyncFilter = 'ALL' | 'pending' | 'failed' | 'synced';

type DraftLine = {
  id: string;
  productId: string;
  orderedQty: string;
  unitCost: string;
  notes: string;
};

type DeliveryLineDraft = {
  purchaseOrderLineId: string;
  productId: string;
  label: string;
  isLpg: boolean;
  qtyEmpty: number;
  orderedQty: number;
  receiveQty: string;
  pulloutQty: string;
  unitCost: string;
  pulloutReason: DesktopPurchaseOrderPulloutReason | '';
};

type AttachmentDraft = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const screenStackClass = 'space-y-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not recorded';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not recorded';
  }
  return date.toLocaleString();
}

function fmtShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString();
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sanitizeWholeNumberInput(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function sanitizeMoneyInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...fractionParts] = cleaned.split('.');
  if (fractionParts.length === 0) {
    return whole;
  }
  return `${whole}.${fractionParts.join('').slice(0, 2)}`;
}

function sanitizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeStatusLabel(status: DesktopPurchaseOrderRecord['status']): string {
  switch (status) {
    case 'PARTIALLY_RECEIVED':
      return 'Partial Received';
    default:
      return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}

function purchaseOrderSyncStatusClass(
  syncStatus: DesktopPurchaseOrderRecord['syncStatus']
): string {
  if (syncStatus === 'failed') {
    return 'is-failed';
  }
  if (syncStatus === 'synced') {
    return 'is-synced';
  }
  return 'is-pending';
}

function purchaseOrderSyncStatusLabel(
  syncStatus: DesktopPurchaseOrderRecord['syncStatus']
): string {
  if (syncStatus === 'failed') {
    return 'Needs Retry';
  }
  if (syncStatus === 'synced') {
    return 'Synced';
  }
  return 'Pending';
}

function purchaseOrderMetricTone(kind: 'draft' | 'submitted' | 'partial' | 'sync'): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (kind === 'submitted') {
    return {
      shell: 'border-[rgba(182,226,194,0.72)] bg-[rgba(250,255,252,0.96)]',
      icon: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]',
      label: 'text-[#1f9b4d]',
      line: 'from-[#59d48a] to-[#8ae0ab]'
    };
  }
  if (kind === 'partial') {
    return {
      shell: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,251,244,0.96)]',
      icon: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#c67d17]',
      label: 'text-[#c67d17]',
      line: 'from-[#f2b55d] to-[#f0ca7a]'
    };
  }
  if (kind === 'sync') {
    return {
      shell: 'border-[rgba(198,210,224,0.74)] bg-[rgba(252,253,255,0.96)]',
      icon: 'border-[rgba(198,210,224,0.74)] bg-[rgba(244,247,251,0.98)] text-[#5b6c83]',
      label: 'text-[#5b6c83]',
      line: 'from-[#8ea1bb] to-[#b7c4d7]'
    };
  }
  return {
    shell: 'border-[rgba(196,220,255,0.78)] bg-[rgba(248,251,255,0.98)]',
    icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
    label: 'text-[var(--accent-strong)]',
    line: 'from-[var(--accent)] to-[var(--accent-strong)]'
  };
}

function PurchaseOrderIcon({
  children,
  className = 'h-[18px] w-[18px]'
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PurchaseOrderTileIcon({
  kind,
  className = 'h-[18px] w-[18px]'
}: {
  kind: 'po' | 'draft' | 'submitted' | 'received' | 'sync' | 'supplier' | 'location' | 'create' | 'details' | 'receive' | 'pullout' | 'complete' | 'cancel' | 'attachment' | 'delete' | 'product' | 'note' | 'close';
  className?: string;
}): JSX.Element {
  if (kind === 'draft') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M6 4.8h8l1.2 1.2v9.2H4.8V6z" />
        <path d="M7.1 8.1h5.8" />
        <path d="M7.1 11h5.8" />
        <path d="M7.1 13.9h3.3" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'submitted') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M4.8 12.2 9 16.4 19.2 6.2" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'received') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M12 4.6v10.2" />
        <path d="m7.6 10.4 4.4 4.4 4.4-4.4" />
        <path d="M5 18.4h14" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'sync') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M16.5 8.2a6 6 0 0 0-10-1.7" />
        <path d="m5 6 1.5.5L7 8" />
        <path d="M7.5 15.8a6 6 0 0 0 10 1.7" />
        <path d="m19 18-1.5-.5L17 16" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'supplier') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M4.8 8.2h14.4v9H4.8z" />
        <path d="M7.2 8.2V6.6A1.8 1.8 0 0 1 9 4.8h6a1.8 1.8 0 0 1 1.8 1.8v1.6" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'location') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M12 20s6-4.4 6-10a6 6 0 1 0-12 0c0 5.6 6 10 6 10Z" />
        <circle cx="12" cy="10" r="2.2" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'receive') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M12 4.6v10.2" />
        <path d="m7.6 10.4 4.4 4.4 4.4-4.4" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'pullout') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M12 19.4V9.2" />
        <path d="m16.4 13.6-4.4-4.4-4.4 4.4" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'complete') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M4.8 12.2 9 16.4 19.2 6.2" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'close') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'cancel') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="m7 7 10 10" />
        <path d="m17 7-10 10" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'delete') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M6.8 8.2h10.4" />
        <path d="M9 8.2V6.6h6v1.6" />
        <path d="M8.2 8.2l.6 9h6.4l.6-9" />
        <path d="M10.6 11.2v3.8" />
        <path d="M13.4 11.2v3.8" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'attachment') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M8 12.2v-2.7a4 4 0 1 1 8 0v5.6a5.6 5.6 0 0 1-11.2 0V8.3" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'product') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="m12 4.8 6.4 3.4v7.6L12 19.2l-6.4-3.4V8.2L12 4.8Z" />
        <path d="M12 12.1 5.6 8.7" />
        <path d="M12 12.1V19" />
        <path d="m18.4 8.7-6.4 3.4" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'note') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M6 5.2h8l3 3v10.6H6z" />
        <path d="M14 5.2v3h3" />
        <path d="M8.4 11h6.2" />
        <path d="M8.4 14h4.8" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'details') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M3.8 12s3.2-5.2 8.2-5.2 8.2 5.2 8.2 5.2-3.2 5.2-8.2 5.2S3.8 12 3.8 12Z" />
        <circle cx="12" cy="12" r="2.2" />
      </PurchaseOrderIcon>
    );
  }
  if (kind === 'create') {
    return (
      <PurchaseOrderIcon className={className}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </PurchaseOrderIcon>
    );
  }
  return (
    <PurchaseOrderIcon className={className}>
      <path d="M6 4.8h8l1.2 1.2v9.2H4.8V6z" />
      <path d="M7.1 8.1h5.8" />
      <path d="M7.1 11h5.8" />
      <path d="M7.1 13.9h3.3" />
    </PurchaseOrderIcon>
  );
}

export function PurchaseOrdersScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DesktopPurchaseOrderRecord[]>([]);
  const [suppliers, setSuppliers] = useState<DesktopOption[]>([]);
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatusFilter>('ALL');
  const [syncFilter, setSyncFilter] = useState<PurchaseOrderSyncFilter>('ALL');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRecordId, setEditRecordId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<DraftLine[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [productPickerState, setProductPickerState] = useState<{
    lineId: string | null;
    search: string;
    category: string;
  } | null>(null);
  const [deliveryState, setDeliveryState] = useState<{
    recordId: string;
    referenceNo: string;
    notes: string;
    lines: DeliveryLineDraft[];
    busy: boolean;
  } | null>(null);
  const [attachmentState, setAttachmentState] = useState<{
    recordId: string;
    file: AttachmentDraft | null;
    busy: boolean;
  } | null>(null);
  const [cancelState, setCancelState] = useState<{ recordId: string; reason: string; busy: boolean } | null>(null);
  const [deleteState, setDeleteState] = useState<{ recordId: string; busy: boolean } | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextRecords, nextSuppliers, nextCatalog] = await Promise.all([
        desktopPurchaseOrderService.listPurchaseOrders(),
        desktopMasterDataService.loadSuppliers(),
        appState.setup.locationId ? desktopMasterDataService.loadCatalog(appState.setup.locationId) : Promise.resolve([])
      ]);
      setRecords(nextRecords);
      setSuppliers(nextSuppliers);
      setCatalog(nextCatalog);
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to load purchase orders right now.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      if (statusFilter !== 'ALL' && record.status !== statusFilter) {
        return false;
      }
      if (syncFilter !== 'ALL' && record.syncStatus !== syncFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        record.poNumber,
        record.supplierLabel,
        record.locationLabel,
        record.notes,
        ...record.lines.map((line) => `${line.productSku} ${line.productName}`)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [records, search, statusFilter, syncFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, syncFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visiblePageButtons = useMemo(() => {
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages, start + 2);
    const buttons: number[] = [];
    for (let page = Math.max(1, end - 2); page <= end; page += 1) {
      buttons.push(page);
    }
    return buttons;
  }, [safePage, totalPages]);

  const countsByStatus = useMemo(() => ({
    ALL: records.length,
    DRAFT: records.filter((record) => record.status === 'DRAFT').length,
    SUBMITTED: records.filter((record) => record.status === 'SUBMITTED').length,
    PARTIALLY_RECEIVED: records.filter((record) => record.status === 'PARTIALLY_RECEIVED').length,
    COMPLETED: records.filter((record) => record.status === 'COMPLETED').length,
    CANCELLED: records.filter((record) => record.status === 'CANCELLED').length
  }), [records]);

  const countsBySync = useMemo(
    () => ({
      ALL: records.length,
      pending: records.filter((record) => record.syncStatus === 'pending').length,
      failed: records.filter((record) => record.syncStatus === 'failed').length,
      synced: records.filter((record) => record.syncStatus === 'synced').length
    }),
    [records]
  );

  const pendingSyncCount = useMemo(
    () => records.filter((record) => record.syncStatus === 'pending' || record.syncStatus === 'failed').length,
    [records]
  );

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === detailId) ?? null,
    [detailId, records]
  );
  const editingRecord = useMemo(
    () => records.find((record) => record.id === editRecordId) ?? null,
    [editRecordId, records]
  );
  const draftSummary = useMemo(() => {
    const totalItems = lineDrafts.filter((line) => line.productId.trim()).length;
    const totalQuantity = lineDrafts.reduce((sum, line) => sum + parsePositiveNumber(line.orderedQty), 0);
    const estimatedTotal = lineDrafts.reduce(
      (sum, line) => sum + parsePositiveNumber(line.orderedQty) * parsePositiveNumber(line.unitCost),
      0
    );
    return {
      totalItems,
      totalQuantity,
      estimatedTotal
    };
  }, [lineDrafts]);

  const productPickerCategories = useMemo(() => {
    const categories = Array.from(
      new Set(
        catalog
          .map((product) => product.category.trim())
          .filter((category) => category.length > 0)
      )
    ).sort((left, right) => left.localeCompare(right));
    return ['ALL', ...categories];
  }, [catalog]);

  const filteredProductPickerCatalog = useMemo(() => {
    if (!productPickerState) {
      return [];
    }
    const term = sanitizeSearchTerm(productPickerState.search);
    return catalog.filter((product) => {
      if (productPickerState.category !== 'ALL' && product.category !== productPickerState.category) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = [
        product.sku,
        product.name,
        product.category,
        product.unit,
        product.cylinderSizeLabel
      ]
        .filter((entry) => entry && entry.trim().length > 0)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [catalog, productPickerState]);

  const closeProductPicker = (): void => {
    setProductPickerState(null);
  };

  const openProductPicker = (lineId: string | null): void => {
    setProductPickerState({ lineId, search: '', category: 'ALL' });
  };

  const updateProductPickerSearch = (value: string): void => {
    setProductPickerState((current) => (current ? { ...current, search: value } : current));
  };

  const updateProductPickerCategory = (category: string): void => {
    setProductPickerState((current) => (current ? { ...current, category } : current));
  };

  const selectProductForLine = (productId: string): void => {
    if (!productPickerState) {
      return;
    }
    const product = catalog.find((entry) => entry.id === productId);
    if (!product) {
      return;
    }
    if (productPickerState.lineId) {
      updateLineDraft(productPickerState.lineId, {
        productId: product.id,
        unitCost: sanitizeMoneyInput(String(product.unitPrice))
      });
    } else {
      setLineDrafts((current) => [
        ...current,
        {
          id: createId('po-draft-line'),
          productId: product.id,
          orderedQty: '1',
          unitCost: sanitizeMoneyInput(String(product.unitPrice)),
          notes: ''
        }
      ]);
    }
    closeProductPicker();
  };

  const startAddItemFlow = (): void => {
    openProductPicker(null);
  };

  const updateLineDraft = (id: string, patch: Partial<DraftLine>): void => {
    setLineDrafts((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const updateLineQuantity = (id: string, value: string): void => {
    updateLineDraft(id, { orderedQty: sanitizeWholeNumberInput(value) });
  };

  const adjustLineQuantity = (id: string, delta: number): void => {
    setLineDrafts((current) =>
      current.map((line) => {
        if (line.id !== id) {
          return line;
        }
        const currentQty = Math.max(1, Math.round(parsePositiveNumber(line.orderedQty || '1')));
        return {
          ...line,
          orderedQty: String(Math.max(1, currentQty + delta))
        };
      })
    );
  };

  const updateLineUnitCost = (id: string, value: string): void => {
    updateLineDraft(id, { unitCost: sanitizeMoneyInput(value) });
  };

  const removeLineDraft = (id: string): void => {
    setLineDrafts((current) => current.filter((line) => line.id !== id));
  };

  const resetCreateModal = (): void => {
    setSupplierId('');
    setCreateNotes('');
    setLineDrafts([]);
  };

  const closeEditor = (): void => {
    setCreateOpen(false);
    setEditRecordId(null);
    resetCreateModal();
  };

  const openCreateModal = (): void => {
    setEditRecordId(null);
    resetCreateModal();
    setCreateOpen(true);
  };

  const openEditModal = (record: DesktopPurchaseOrderRecord): void => {
    setSupplierId(record.supplierId);
    setCreateNotes(record.notes ?? '');
    setLineDrafts(
      record.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        orderedQty: String(line.orderedQty),
        unitCost: String(line.unitCost.toFixed(2)),
        notes: line.notes ?? ''
      }))
    );
    setEditRecordId(record.id);
    setDetailId(null);
    setCreateOpen(true);
  };

  const handleCreate = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      desktopUi.showToast({ tone: 'error', message: 'Choose a desktop location first before creating a purchase order.' });
      return;
    }
    setSavingCreate(true);
    try {
      const items: CreateDesktopPurchaseOrderInput['items'] = lineDrafts.map((line) => ({
        productId: line.productId,
        orderedQty: parsePositiveNumber(line.orderedQty),
        unitCost: parsePositiveNumber(line.unitCost),
        notes: line.notes
      }));
      const saved = editRecordId
        ? await desktopPurchaseOrderService.updateDraftPurchaseOrder(editRecordId, appState, {
            locationId: appState.setup.locationId,
            supplierId,
            notes: createNotes,
            items
          })
        : await desktopPurchaseOrderService.createPurchaseOrder(appState, {
            locationId: appState.setup.locationId,
            supplierId,
            notes: createNotes,
            items
          });
      closeEditor();
      await refresh();
      await onOutboxChanged?.();
      setDetailId(saved.id);
      desktopUi.showToast({
        tone: 'success',
        message: editRecordId
          ? 'Draft purchase order updated offline.'
          : 'Purchase order saved offline and queued for sync.'
      });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save purchase order.'
      });
    } finally {
      setSavingCreate(false);
    }
  };

  const handleDeleteDraft = async (): Promise<void> => {
    if (!deleteState) {
      return;
    }
    setDeleteState((current) => (current ? { ...current, busy: true } : current));
    try {
      await desktopPurchaseOrderService.deleteDraftPurchaseOrder(deleteState.recordId);
      setDeleteState(null);
      setDetailId(null);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Draft purchase order deleted.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to delete this draft purchase order.'
      });
      setDeleteState((current) => (current ? { ...current, busy: false } : current));
    }
  };

  const openDeliveryModal = (record: DesktopPurchaseOrderRecord): void => {
    const catalogById = new Map(catalog.map((p) => [p.id, p]));
    setDeliveryState({
      recordId: record.id,
      referenceNo: '',
      notes: '',
      busy: false,
      lines: record.lines.map((line) => {
        const product = catalogById.get(line.productId);
        return {
          purchaseOrderLineId: line.id,
          productId: line.productId,
          label: `${line.productSku} - ${line.productName}`,
          isLpg: line.isLpg || product?.isLpg || false,
          qtyEmpty: product?.qtyEmpty ?? 0,
          orderedQty: line.orderedQty,
          receiveQty: '',
          pulloutQty: '',
          unitCost: String(line.unitCost.toFixed(2)),
          pulloutReason: ''
        };
      })
    });
  };

  const handleDeliverySubmit = async (): Promise<void> => {
    if (!deliveryState) {
      return;
    }
    const record = records.find((entry) => entry.id === deliveryState.recordId);
    if (!record) {
      return;
    }

    const receiveLines = deliveryState.lines
      .filter((line) => parsePositiveNumber(line.receiveQty) > 0)
      .map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantity: parsePositiveNumber(line.receiveQty),
        unitCost: parsePositiveNumber(line.unitCost)
      }));

    const pulloutLines = deliveryState.lines
      .filter((line) => line.isLpg && parsePositiveNumber(line.pulloutQty) > 0)
      .map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantity: parsePositiveNumber(line.pulloutQty),
        unitCost: parsePositiveNumber(line.unitCost),
        pulloutReason: line.pulloutReason || null,
        qtyEmpty: line.qtyEmpty
      }));

    if (receiveLines.length === 0 && pulloutLines.length === 0) {
      desktopUi.showToast({ tone: 'error', message: 'Enter at least one receive or pullout quantity before saving.' });
      return;
    }

    setDeliveryState((current) => (current ? { ...current, busy: true } : current));
    try {
      await desktopPurchaseOrderService.receivePulloutPurchaseOrder(record.id, {
        referenceNo: deliveryState.referenceNo.trim() || null,
        notes: deliveryState.notes.trim() || null,
        receiveLines,
        pulloutLines
      } satisfies DesktopPurchaseOrderDeliveryInput);
      setDeliveryState(null);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Delivery posted offline.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save this delivery.'
      });
      setDeliveryState((current) => (current ? { ...current, busy: false } : current));
    }
  };

  const handleSubmitOrder = async (record: DesktopPurchaseOrderRecord): Promise<void> => {
    try {
      await desktopPurchaseOrderService.submitPurchaseOrder(record.id);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Purchase order submitted offline.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to submit purchase order.'
      });
    }
  };

  const handleCompleteOrder = async (record: DesktopPurchaseOrderRecord): Promise<void> => {
    try {
      await desktopPurchaseOrderService.completePurchaseOrder(record.id);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Purchase order marked complete offline.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to complete purchase order.'
      });
    }
  };

  const handleCancelSubmit = async (): Promise<void> => {
    if (!cancelState) {
      return;
    }
    if (!cancelState.reason.trim()) {
      desktopUi.showToast({ tone: 'error', message: 'Enter a cancel reason before saving.' });
      return;
    }
    setCancelState((current) => (current ? { ...current, busy: true } : current));
    try {
      await desktopPurchaseOrderService.cancelPurchaseOrder(cancelState.recordId, cancelState.reason.trim());
      setCancelState(null);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Purchase order cancelled offline.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to cancel purchase order.'
      });
      setCancelState((current) => (current ? { ...current, busy: false } : current));
    }
  };

  const handleAttachmentPicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!attachmentState || !file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] ?? '' : result;
      setAttachmentState((current) =>
        current
          ? {
              ...current,
              file: {
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: file.size,
                dataBase64: base64
              }
            }
          : current
      );
    };
    reader.readAsDataURL(file);
  };

  const handleAttachmentSubmit = async (): Promise<void> => {
    if (!attachmentState?.file) {
      desktopUi.showToast({ tone: 'error', message: 'Choose a file first.' });
      return;
    }
    setAttachmentState((current) => (current ? { ...current, busy: true } : current));
    try {
      await desktopPurchaseOrderService.addAttachment(attachmentState.recordId, attachmentState.file);
      setAttachmentState(null);
      await refresh();
      await onOutboxChanged?.();
      desktopUi.showToast({ tone: 'success', message: 'Attachment saved offline and queued for sync.' });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to attach the file.'
      });
      setAttachmentState((current) => (current ? { ...current, busy: false } : current));
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <PurchaseOrderTileIcon kind="po" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Purchase Orders
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Create and process purchase orders offline.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="primary-btn inline-flex min-h-[48px] items-center gap-2.5 rounded-[16px] px-5 text-[0.88rem]"
            type="button"
            onClick={openCreateModal}
            disabled={!appState.setup.locationId}
          >
            <PurchaseOrderTileIcon kind="create" className="h-[18px] w-[18px]" />
            <span>New Purchase Order</span>
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {([
          { key: 'draft', label: 'Draft', value: String(countsByStatus.DRAFT), icon: 'draft', tone: purchaseOrderMetricTone('draft') },
          { key: 'submitted', label: 'Submitted', value: String(countsByStatus.SUBMITTED), icon: 'submitted', tone: purchaseOrderMetricTone('submitted') },
          { key: 'partial', label: 'Partial Received', value: String(countsByStatus.PARTIALLY_RECEIVED), icon: 'received', tone: purchaseOrderMetricTone('partial') },
          { key: 'sync', label: 'Pending Sync', value: String(pendingSyncCount), icon: 'sync', tone: purchaseOrderMetricTone('sync') }
        ] as const).map((card) => (
          <article
            key={card.key}
            className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${card.tone.shell}`}
          >
            <div className="flex items-start gap-3">
              <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${card.tone.icon}`}>
                <PurchaseOrderTileIcon kind={card.icon} className="h-[21px] w-[21px]" />
              </div>
              <div className="min-w-0">
                <div className={`text-[0.82rem] font-semibold ${card.tone.label}`}>{card.label}</div>
                <strong className="mt-1.5 block text-[0.98rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)] sm:text-[1.08rem]">
                  {card.value}
                </strong>
              </div>
            </div>
            <div className={`h-[4px] rounded-full bg-gradient-to-r ${card.tone.line}`} />
          </article>
        ))}
      </section>

      <section className={`${shellCardClass} grid gap-4`}>
        <div className="desktop-section-head">
          <div>
            <div className="eyebrow">Supplier directory</div>
            <h2>Purchase order history</h2>
            <p>Search by supplier, PO number, or item, then review and update local purchase-order drafts cleanly.</p>
          </div>
          <div className="items-catalog-count-pill">
            {filteredRecords.length} record{filteredRecords.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-[22px] border border-[rgba(188,210,234,0.58)] bg-[rgba(255,255,255,0.97)] p-2 shadow-[0_10px_24px_rgba(17,40,58,0.04)]">
            {(['ALL', 'DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`inline-flex min-h-[48px] items-center gap-3 rounded-[16px] px-4 text-[0.94rem] font-semibold transition ${
                  statusFilter === entry
                    ? 'bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-white shadow-[0_14px_28px_rgba(25,118,210,0.2)]'
                    : 'text-[var(--text-strong)] hover:bg-[rgba(240,246,255,0.96)]'
                }`}
                onClick={() => setStatusFilter(entry)}
              >
                <span>
                  {entry === 'PARTIALLY_RECEIVED' ? 'Partial Received' : entry === 'ALL' ? 'All' : normalizeStatusLabel(entry)}
                </span>
                <span
                  className={`inline-flex min-w-[32px] justify-center rounded-full px-2 py-1 text-[0.78rem] font-bold ${
                    statusFilter === entry
                      ? 'bg-[rgba(255,255,255,0.22)] text-white'
                      : 'bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]'
                  }`}
                >
                  {countsByStatus[entry]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ['ALL', 'All Status'],
              ['pending', `Pending (${countsBySync.pending})`],
              ['failed', `Retry (${countsBySync.failed})`],
              ['synced', `Synced (${countsBySync.synced})`]
            ] as const).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                className={`filter-chip ${syncFilter === filter ? 'active' : ''}`}
                onClick={() => setSyncFilter(filter)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <SearchField
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder="Search PO number, supplier, item, or note"
          />
        </div>

        <div className="grid gap-3">
          {loading ? (
            <div className="empty-state">Loading purchase orders...</div>
          ) : pagedRecords.length === 0 ? (
            <div className="empty-state">No purchase orders match this filter yet.</div>
          ) : (
            pagedRecords.map((record) => {
              const itemCount = record.lines.length;
              const statusTone =
                record.status === 'COMPLETED'
                  ? 'good'
                  : record.status === 'CANCELLED'
                    ? 'danger'
                    : record.status === 'PARTIALLY_RECEIVED'
                      ? 'warn'
                      : 'accent';
              const canOpenDraftEditor = record.status === 'DRAFT' && record.syncStatus !== 'synced';
              const canDeleteDraft = canOpenDraftEditor;
              const accentClass =
                statusTone === 'good'
                  ? 'bg-[#22c55e]'
                  : statusTone === 'danger'
                    ? 'bg-[#ff4d4f]'
                    : statusTone === 'warn'
                      ? 'bg-[#f59f0b]'
                      : 'bg-[var(--accent)]';
              return (
                <article
                  key={record.id}
                  className="relative overflow-hidden rounded-[22px] border border-[rgba(188,210,234,0.56)] bg-[rgba(255,255,255,0.98)] px-5 py-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)] transition hover:border-[rgba(25,118,210,0.26)] hover:shadow-[0_16px_32px_rgba(17,40,58,0.08)]"
                  onClick={() => setDetailId(record.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setDetailId(record.id);
                    }
                  }}
                >
                  <span className={`absolute inset-y-0 left-0 w-[4px] rounded-full ${accentClass}`} aria-hidden="true" />
                  <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
                    <div
                      className={`grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border ${
                        statusTone === 'good'
                          ? 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]'
                          : statusTone === 'danger'
                            ? 'border-[rgba(247,196,201,0.78)] bg-[rgba(255,241,243,0.98)] text-[#ea3434]'
                            : statusTone === 'warn'
                              ? 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#c67d17]'
                              : 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]'
                      }`}
                    >
                      <PurchaseOrderTileIcon
                        kind={
                          record.status === 'COMPLETED'
                            ? 'submitted'
                            : record.status === 'CANCELLED'
                              ? 'cancel'
                              : record.status === 'PARTIALLY_RECEIVED'
                                ? 'received'
                                : 'draft'
                        }
                        className="h-[24px] w-[24px]"
                      />
                    </div>
                    <div className="min-w-0">
                      <strong className="block text-[1.02rem] font-extrabold text-[var(--text-strong)]">
                        {record.poNumber?.trim() || `PO ${record.id.slice(-6).toUpperCase()}`}
                      </strong>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.88rem] text-[var(--muted-strong)]">
                        <span>{record.supplierLabel}</span>
                        <span>&bull;</span>
                        <span>{record.locationLabel}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`status-badge ${
                          record.status === 'COMPLETED' ? 'status-badge--success'
                          : record.status === 'CANCELLED' ? 'status-badge--danger'
                          : record.status === 'PARTIALLY_RECEIVED' ? 'status-badge--warning'
                          : record.status === 'SUBMITTED' ? 'status-badge--pending'
                          : 'status-badge--draft'
                        }`}>
                          {normalizeStatusLabel(record.status)}
                        </span>
                        <span className={`sales-list-card-status ${purchaseOrderSyncStatusClass(record.syncStatus)}`}>
                          {purchaseOrderSyncStatusLabel(record.syncStatus)}
                        </span>
                        <span className="rounded-full border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-2.5 py-1 text-[0.78rem] font-semibold text-[var(--muted-strong)]">
                          {itemCount} item{itemCount === 1 ? '' : 's'}
                        </span>
                        <span className="rounded-full border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-2.5 py-1 text-[0.78rem] font-semibold text-[var(--muted-strong)]">
                          {record.attachmentCount} attachment{record.attachmentCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] text-[var(--muted)]">
                        <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
                        <span>&bull;</span>
                        <span>Ordered {fmtQty(record.orderedQtyTotal)}</span>
                        <span>&bull;</span>
                        <span>Received {fmtQty(record.receivedQtyTotal)}</span>
                        <span>&bull;</span>
                        <span>Pulled Out {fmtQty(record.pulledOutQtyTotal)}</span>
                        <span>&bull;</span>
                        <span>{fmtShortDate(record.updatedAt)}</span>
                      </div>
                      {record.notes ? (
                        <div className="mt-2 text-[0.88rem] leading-6 text-[var(--muted)]">{record.notes}</div>
                      ) : null}
                    </div>
                    <div className="grid justify-items-start gap-2 md:justify-items-end">
                      <strong className="text-[1.08rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)]">
                        {fmtMoney(record.lines.reduce((sum, line) => sum + line.orderedQty * line.unitCost, 0))}
                      </strong>
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDetailId(record.id);
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {filteredRecords.length > 0 ? (
          <div className="lending-records-footer">
            <div className="lending-records-footer-summary">
              Showing {(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} records
            </div>
            <div className="lending-records-pager">
              <button className="lending-records-page-btn" type="button" onClick={() => setCurrentPage(1)} disabled={safePage === 1} aria-label="First page">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>
              </button>
              <button className="lending-records-page-btn" type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1} aria-label="Previous page">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              {visiblePageButtons.map((page) => (
                <button key={page} className={`lending-records-page-btn ${page === safePage ? 'active' : ''}`} type="button" onClick={() => setCurrentPage(page)}>
                  {page}
                </button>
              ))}
              <button className="lending-records-page-btn" type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safePage === totalPages} aria-label="Next page">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button className="lending-records-page-btn" type="button" onClick={() => setCurrentPage(totalPages)} disabled={safePage === totalPages} aria-label="Last page">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></svg>
              </button>
            </div>
            <div className="lending-records-page-size">
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} per page
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </section>

      {createOpen ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div
            className="desktop-modal-card desktop-modal-card--action purchase-order-editor-modal"
            style={{
              width: 'min(1120px, calc(100vw - 48px))',
              maxWidth: 'min(1120px, calc(100vw - 48px))'
            }}
          >
            <div className="purchase-order-editor-modal-header desktop-modal-header shrink-0 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(245,249,253,0.96)] text-[var(--accent-strong)] shadow-[0_10px_22px_rgba(17,40,58,0.04)]">
                    <PurchaseOrderTileIcon kind="po" className="h-[24px] w-[24px]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[0.84rem] font-medium text-[var(--muted-strong)]">Purchase order</div>
                    <h3 className="mt-1 text-[1.28rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.42rem]">
                      {editingRecord ? 'Edit Draft Purchase Order' : 'New Purchase Order'}
                    </h3>
                    <p className="mt-2 max-w-[36rem] text-[0.9rem] leading-6 text-[var(--muted)]">
                      {editingRecord
                        ? 'Update the local draft before it is submitted or synced.'
                        : 'Create a supplier order offline and queue it for sync.'}
                    </p>
                  </div>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn h-11 w-11 shrink-0 text-[var(--text-strong)] sm:h-12 sm:w-12"
                  type="button"
                  onClick={closeEditor}
                  aria-label="Close modal"
                  title="Close"
                >
                  <PurchaseOrderIcon
                    className="h-[18px] w-[18px]"
                    children={
                      <>
                        <path d="M6 6l12 12" />
                        <path d="M18 6L6 18" />
                      </>
                    }
                  />
                </button>
              </div>
            </div>

            <div className="desktop-modal-body grid gap-3.5 pb-5">
              <div className="grid gap-3.5 lg:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                    Supplier <span className="text-[#e43f5a]">*</span>
                  </span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[12px] border border-[rgba(196,220,255,0.62)] bg-[rgba(240,246,255,0.92)] text-[var(--accent-strong)]">
                      <PurchaseOrderTileIcon kind="supplier" />
                    </span>
                    <select
                      className="min-h-[52px] w-full appearance-none rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white pl-[54px] pr-10 text-[0.88rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]"
                      value={supplierId}
                      onChange={(event) => setSupplierId(event.target.value)}
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[0.85rem] text-[var(--muted-strong)]">
                      v
                    </span>
                  </div>
                </label>

                <label className="grid gap-2">
                  <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                    Location <span className="text-[#e43f5a]">*</span>
                  </span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[12px] border border-[rgba(196,220,255,0.62)] bg-[rgba(240,246,255,0.92)] text-[var(--accent-strong)]">
                      <PurchaseOrderTileIcon kind="location" />
                    </span>
                    <div className="flex min-h-[52px] items-center rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white pl-[54px] pr-10 text-[0.88rem] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]">
                      {appState.setup.locationLabel || 'Not set'}
                    </div>
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[0.85rem] text-[var(--muted-strong)]">
                      v
                    </span>
                  </div>
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                  Notes <span className="font-normal text-[var(--muted)]">(Optional)</span>
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-3.5 text-[var(--muted)]">
                    <PurchaseOrderTileIcon kind="details" />
                  </span>
                  <textarea
                    className="min-h-[84px] w-full rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white pb-6 pl-[44px] pr-4 pt-3.5 text-[0.84rem] leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]"
                    rows={4}
                    maxLength={500}
                    value={createNotes}
                    onChange={(event) => setCreateNotes(event.target.value)}
                    placeholder="Supplier note, stock plan, or reminder..."
                  />
                  <span className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.74rem] font-medium text-[var(--muted)]">
                    {createNotes.length} / 500
                  </span>
                </div>
              </label>

              <section className="rounded-[18px] border border-[rgba(188,210,234,0.56)] bg-[rgba(255,255,255,0.98)] p-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[13px] border border-[rgba(196,220,255,0.62)] bg-[rgba(240,246,255,0.92)] text-[var(--accent-strong)]">
                      <PurchaseOrderTileIcon kind="draft" className="h-[16px] w-[16px]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[0.98rem] font-bold text-[var(--text-strong)]">Order lines</h4>
                      <p className="mt-0.5 text-[0.8rem] leading-5 text-[var(--muted)]">
                        Choose products, quantity, and unit cost for this branch order.
                      </p>
                    </div>
                  </div>
                  <button className="purchase-order-add-item-btn" type="button" onClick={startAddItemFlow}>
                    <PurchaseOrderTileIcon kind="create" className="h-[15px] w-[15px]" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  {lineDrafts.length === 0 ? (
                    <div className="purchase-order-empty-lines-state">
                      <strong>No items added yet.</strong>
                      <span>Use Add Item to choose a product and build this purchase order.</span>
                    </div>
                  ) : null}
                  {lineDrafts.map((line) => {
                    const lineTotal = parsePositiveNumber(line.orderedQty) * parsePositiveNumber(line.unitCost);
                    const selectedProduct = catalog.find((product) => product.id === line.productId) ?? null;
                    return (
                      <div
                        key={line.id}
                        className="rounded-[16px] border border-[rgba(188,210,234,0.52)] bg-[rgba(250,252,255,0.96)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]"
                      >
                        <div className="purchase-order-line-grid">
                          <label className="grid gap-1.5">
                            <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                              Product <span className="text-[#e43f5a]">*</span>
                            </span>
                            <button
                              type="button"
                              className="flex min-h-[46px] w-full items-center gap-2.5 rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white px-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)] transition hover:border-[rgba(25,118,210,0.28)] hover:bg-[rgba(247,250,255,0.98)]"
                              onClick={() => openProductPicker(line.id)}
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] border border-[rgba(196,220,255,0.62)] bg-[rgba(240,246,255,0.92)] text-[var(--accent-strong)]">
                                <PurchaseOrderTileIcon kind="product" className="h-[15px] w-[15px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-[0.83rem] font-semibold text-[var(--text-strong)]">
                                  {selectedProduct ? `${selectedProduct.sku} - ${selectedProduct.name}` : 'Select product'}
                                </strong>
                                <span className="block truncate text-[0.71rem] text-[var(--muted)]">
                                  {selectedProduct
                                    ? `${selectedProduct.category} Ã‚Â· ${selectedProduct.unit}${
                                        selectedProduct.isLpg && selectedProduct.cylinderSizeLabel
                                          ? ` Ã‚Â· ${selectedProduct.cylinderSizeLabel}`
                                          : ''
                                      }`
                                    : 'Tap to choose an item for this order line.'}
                                </span>
                              </span>
                              <span className="pointer-events-none text-[0.85rem] text-[var(--muted-strong)]">v</span>
                            </button>
                          </label>

                          <label className="grid gap-1.5">
                            <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                              Qty <span className="text-[#e43f5a]">*</span>
                            </span>
                            <div className="grid min-h-[44px] grid-cols-[38px_minmax(0,1fr)_38px] overflow-hidden rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]">
                              <button
                                type="button"
                                className="border-r border-[rgba(220,230,239,0.92)] text-[0.98rem] font-semibold text-[var(--muted-strong)] transition hover:bg-[rgba(240,246,255,0.9)]"
                                onClick={() => adjustLineQuantity(line.id, -1)}
                              >
                                -
                              </button>
                              <input
                                className="min-h-[44px] border-0 bg-transparent px-2 text-center text-[0.86rem] font-semibold shadow-none"
                                value={line.orderedQty}
                                onChange={(event) => updateLineQuantity(line.id, event.target.value)}
                              />
                              <button
                                type="button"
                                className="border-l border-[rgba(220,230,239,0.92)] text-[0.98rem] font-semibold text-[var(--accent-strong)] transition hover:bg-[rgba(240,246,255,0.9)]"
                                onClick={() => adjustLineQuantity(line.id, 1)}
                              >
                                +
                              </button>
                            </div>
                          </label>

                          <label className="grid gap-1.5">
                            <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                              Unit Cost <span className="text-[#e43f5a]">*</span>
                            </span>
                            <input
                              className="purchase-order-line-unit-cost-input"
                              value={line.unitCost}
                              onChange={(event) => updateLineUnitCost(line.id, event.target.value)}
                              placeholder="0.00"
                            />
                          </label>

                          <div className="purchase-order-line-total-group">
                            <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">Total</span>
                            <div className="purchase-order-line-total-bar">
                              <div className="purchase-order-line-total-field">
                                <strong className="purchase-order-line-total min-h-[44px] text-[0.98rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)]">
                                  {fmtMoney(lineTotal)}
                                </strong>
                              </div>
                              <button
                                className="purchase-order-line-delete-btn"
                                type="button"
                                onClick={() => removeLineDraft(line.id)}
                                disabled={lineDrafts.length === 1}
                                aria-label="Remove line"
                              >
                                <PurchaseOrderTileIcon kind="delete" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <label className="mt-2 grid gap-1.5">
                          <span className="text-[0.82rem] font-semibold text-[var(--text-strong)]">
                            Line note <span className="font-normal text-[var(--muted)]">(Optional)</span>
                          </span>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                              <PurchaseOrderTileIcon kind="note" />
                            </span>
                            <input
                              className="min-h-[38px] w-full rounded-[14px] border border-[rgba(188,210,234,0.62)] bg-white pl-[42px] pr-18 text-[0.8rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_16px_rgba(17,40,58,0.04)]"
                              value={line.notes}
                              maxLength={300}
                              onChange={(event) => updateLineDraft(line.id, { notes: event.target.value })}
                              placeholder="Optional note for this line..."
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.72rem] font-medium text-[var(--muted)]">
                              {line.notes.length} / 300
                            </span>
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[18px] border border-[rgba(188,210,234,0.56)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,255,0.96))] px-3.5 py-2.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
                <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(0,1fr))] lg:items-center">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-[rgba(196,220,255,0.72)] bg-[rgba(240,246,255,0.96)] text-[var(--accent-strong)]">
                      <PurchaseOrderTileIcon kind="po" className="h-[16px] w-[16px]" />
                    </div>
                    <div className="grid gap-1">
                      <h4 className="text-[0.92rem] font-bold text-[var(--text-strong)]">Order Summary</h4>
                    </div>
                  </div>
                  <div className="grid gap-1 border-l-0 lg:border-l lg:border-[rgba(220,230,239,0.92)] lg:pl-6">
                    <span className="text-[0.78rem] text-[var(--muted-strong)]">Total Items</span>
                    <strong className="text-[1.2rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">{draftSummary.totalItems}</strong>
                  </div>
                  <div className="grid gap-1 border-l-0 lg:border-l lg:border-[rgba(220,230,239,0.92)] lg:pl-6">
                    <span className="text-[0.78rem] text-[var(--muted-strong)]">Total Quantity</span>
                    <strong className="text-[1.2rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">{fmtQty(draftSummary.totalQuantity)}</strong>
                  </div>
                  <div className="grid gap-1 border-l-0 lg:border-l lg:border-[rgba(220,230,239,0.92)] lg:pl-6">
                    <span className="text-[0.78rem] text-[var(--muted-strong)]">Estimated Total</span>
                    <strong className="text-[1.28rem] font-extrabold tracking-[-0.03em] text-[var(--accent-strong)]">
                      {fmtMoney(draftSummary.estimatedTotal)}
                    </strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="purchase-order-editor-footer desktop-modal-footer shrink-0 flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:py-6 lg:px-8 lg:py-7">
              <button
                className="purchase-order-editor-cancel-btn secondary-btn inline-flex min-h-[52px] items-center justify-center px-8 text-[0.9rem] sm:min-w-[188px]"
                type="button"
                onClick={closeEditor}
              >
                Cancel
              </button>
              <button
                className="purchase-order-editor-save-btn primary-btn inline-flex min-h-[52px] items-center justify-center gap-3 px-8 text-[0.9rem] sm:min-w-[280px]"
                type="button"
                onClick={() => void handleCreate()}
                disabled={savingCreate}
              >
                <PurchaseOrderTileIcon kind="po" className="h-[16px] w-[16px]" />
                {savingCreate ? 'Saving...' : editingRecord ? 'Save Draft Changes' : 'Save Purchase Order'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {productPickerState ? (
        <div className="desktop-modal-backdrop" role="presentation" onClick={closeProductPicker}>
          <div
            className="desktop-modal-card desktop-modal-card--picker purchase-order-product-picker-modal"
            style={{
              width: 'min(980px, calc(100vw - 48px))',
              maxWidth: 'min(980px, calc(100vw - 48px))'
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Selection</div>
                  <h3>Select Product</h3>
                  <p className="startup-helper-copy pos-payment-copy">
                    Search by product code, name, category, or unit, then tap an item to add it to this purchase order line.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={closeProductPicker}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>

              <SearchField
                className="pos-sheet-search"
                value={productPickerState.search}
                onChange={updateProductPickerSearch}
                placeholder="Search product code or name"
                autoFocus
              />

              <div className="filter-chip-row">
                {productPickerCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`filter-chip ${productPickerState.category === category ? 'active' : ''}`}
                    onClick={() => updateProductPickerCategory(category)}
                  >
                    {category === 'ALL' ? 'All Categories' : category}
                  </button>
                ))}
              </div>
            </div>

            <div className="desktop-modal-body picker-list">
              {filteredProductPickerCatalog.length === 0 ? (
                <div className="empty-state">No matching products.</div>
              ) : (
                filteredProductPickerCatalog.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="catalog-row picker-row purchase-order-product-row"
                    onClick={() => selectProductForLine(product.id)}
                  >
                    <div className="purchase-order-product-row__main">
                      <strong>{product.sku} - {product.name}</strong>
                      <span>
                        {product.category} | {product.unit}
                        {product.isLpg && product.cylinderSizeLabel ? ` | ${product.cylinderSizeLabel}` : ''}
                      </span>
                      <span>
                        {product.isLpg
                          ? `Full ${fmtQty(product.qtyFull)} | Empty ${fmtQty(product.qtyEmpty)}`
                          : `On hand ${fmtQty(product.qtyOnHand)}`}
                      </span>
                    </div>
                    <div className="purchase-order-product-row__meta">
                      <strong>{fmtMoney(product.unitPrice)}</strong>
                      <span>{product.isLpg ? 'LPG' : 'Standard'}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {false && createOpen ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action max-w-[980px]">
            <div className="desktop-modal-header flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="eyebrow">Purchase order</div>
                <h3>{editingRecord ? 'Edit Draft Purchase Order' : 'New Purchase Order'}</h3>
                <p className="text-[0.92rem] text-[var(--muted)]">
                  {editingRecord
                    ? 'Update the local draft before it is submitted or synced.'
                    : 'Create a supplier order offline and queue it for sync.'}
                </p>
              </div>
              <button className="desktop-icon-btn" type="button" onClick={closeEditor} aria-label="Close">
                Ãƒâ€”
              </button>
            </div>

            <div className="desktop-modal-body grid gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="full-width-field">
                  <span>Supplier</span>
                  <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                    <option value="">Select supplier</option>
                    {suppliers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full-width-field">
                  <span>Location</span>
                  <input value={appState.setup.locationLabel || 'Not set'} disabled />
                </label>
              </div>

              <label className="full-width-field">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={createNotes}
                  onChange={(event) => setCreateNotes(event.target.value)}
                  placeholder="Supplier note, stock plan, or reminder"
                />
              </label>

              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="grid gap-1">
                    <strong className="text-[1rem] text-[var(--text-strong)]">Order lines</strong>
                    <span className="text-[0.86rem] text-[var(--muted)]">Choose products, quantity, and unit cost for this branch order.</span>
                  </div>
                  <button className="desktop-secondary-btn" type="button" onClick={startAddItemFlow}>
                    Add Item
                  </button>
                </div>

                <div className="grid gap-3">
                  {lineDrafts.length === 0 ? (
                    <div className="rounded-[20px] border border-dashed border-[rgba(188,210,234,0.62)] bg-[rgba(248,251,255,0.96)] px-4 py-5 text-[0.86rem] text-[var(--muted)]">
                      No items added yet.
                    </div>
                  ) : null}
                  {lineDrafts.map((line) => (
                    <div key={line.id} className="rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] p-4">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_120px_140px_auto]">
                        <label className="full-width-field">
                          <span>Product</span>
                          <select value={line.productId} onChange={(event) => updateLineDraft(line.id, { productId: event.target.value })}>
                            <option value="">Select product</option>
                            {catalog.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.sku} - {product.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="full-width-field">
                          <span>Qty</span>
                          <input value={line.orderedQty} onChange={(event) => updateLineDraft(line.id, { orderedQty: event.target.value })} />
                        </label>
                        <label className="full-width-field">
                          <span>Unit Cost</span>
                          <input value={line.unitCost} onChange={(event) => updateLineDraft(line.id, { unitCost: event.target.value })} />
                        </label>
                        <div className="flex items-end">
                          <button className="desktop-danger-btn" type="button" onClick={() => removeLineDraft(line.id)} disabled={lineDrafts.length === 1}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <label className="full-width-field mt-3">
                        <span>Line note</span>
                        <input value={line.notes} onChange={(event) => updateLineDraft(line.id, { notes: event.target.value })} placeholder="Optional note for this line" />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="purchase-order-editor-footer desktop-modal-footer shrink-0 flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:py-6 lg:px-8 lg:py-7">
              <button
                className="purchase-order-editor-cancel-btn secondary-btn inline-flex min-h-[52px] items-center justify-center px-8 text-[0.9rem] sm:min-w-[188px]"
                type="button"
                onClick={closeEditor}
              >
                Cancel
              </button>
              <button
                className="purchase-order-editor-save-btn primary-btn inline-flex min-h-[52px] items-center justify-center gap-3 px-8 text-[0.9rem] sm:min-w-[280px]"
                type="button"
                onClick={() => void handleCreate()}
                disabled={savingCreate}
              >
                <PurchaseOrderTileIcon kind="po" className="h-[16px] w-[16px]" />
                {savingCreate ? 'Saving...' : editingRecord ? 'Save Draft Changes' : 'Save Purchase Order'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedRecord ? (
        <PurchaseOrderDetailModal
          record={selectedRecord}
          onClose={() => setDetailId(null)}
          onEditDraft={() => openEditModal(selectedRecord)}
          onDeleteDraft={() => setDeleteState({ recordId: selectedRecord.id, busy: false })}
          onSubmit={() => void handleSubmitOrder(selectedRecord)}
          onPostDelivery={() => openDeliveryModal(selectedRecord)}
          onComplete={() => void handleCompleteOrder(selectedRecord)}
          onCancel={() => setCancelState({ recordId: selectedRecord.id, reason: '', busy: false })}
          onAttach={() => setAttachmentState({ recordId: selectedRecord.id, file: null, busy: false })}
        />
      ) : null}

            {deleteState ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action purchase-order-action-modal max-w-[620px]">
            <PurchaseOrderActionHeader
              eyebrow="Purchase order action"
              title="Delete Draft Purchase Order"
              description="Remove this unsynced draft from the desktop and clear its queued create request."
              icon="delete"
              tone="danger"
              onClose={() => setDeleteState(null)}
            />
            <div className="desktop-modal-body purchase-order-action-body">
              <div className="purchase-order-action-callout danger">
                This action deletes the local draft permanently. Use cancel instead once the purchase order has been synced or submitted.
              </div>
            </div>
            <div className="desktop-modal-footer purchase-order-action-footer flex items-center justify-end gap-3 px-5 py-5 sm:px-7 sm:py-6">
              <button className="secondary-btn purchase-order-action-btn purchase-order-action-btn--secondary" type="button" onClick={() => setDeleteState(null)}>
                Back
              </button>
              <button
                className="purchase-order-action-btn purchase-order-action-btn--danger"
                type="button"
                onClick={() => void handleDeleteDraft()}
                disabled={deleteState.busy}
              >
                {deleteState.busy ? 'Deleting...' : 'Delete Draft'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

            {deliveryState ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action purchase-order-action-modal max-w-[860px]">
            <PurchaseOrderActionHeader
              eyebrow="Goods Receipt &amp; Pull-out"
              title="Post Delivery"
              description="Record received and returned quantities in one document. Leave a field blank to skip that action for the line."
              icon="received"
              tone="good"
              onClose={() => setDeliveryState(null)}
            />
            <div className="desktop-modal-body purchase-order-action-body">

              <div className="purchase-order-delivery-doc-fields">
                <label className="full-width-field purchase-order-action-field">
                  <span>Reference No. (DR / supplier slip)</span>
                  <input
                    type="text"
                    placeholder="e.g. DR-2024-001"
                    value={deliveryState.referenceNo}
                    onChange={(event) =>
                      setDeliveryState((current) =>
                        current ? { ...current, referenceNo: event.target.value } : current
                      )
                    }
                  />
                </label>
                <label className="full-width-field purchase-order-action-field">
                  <span>Notes</span>
                  <input
                    type="text"
                    placeholder="Optional delivery notes"
                    value={deliveryState.notes}
                    onChange={(event) =>
                      setDeliveryState((current) =>
                        current ? { ...current, notes: event.target.value } : current
                      )
                    }
                  />
                </label>
              </div>

              <div className="purchase-order-delivery-lines-label">
                <PurchaseOrderTileIcon kind="received" className="h-[13px] w-[13px]" />
                <span>Line items — Receive Qty &amp; Pull-out Qty</span>
              </div>

              <div className="purchase-order-operation-lines">
                {deliveryState.lines.map((line) => {
                  const pulloutQtyNum = parsePositiveNumber(line.pulloutQty);
                  const hasPullout = pulloutQtyNum > 0;
                  const pulloutCap = Math.min(line.qtyEmpty, line.orderedQty);
                  return (
                    <div key={line.purchaseOrderLineId} className="purchase-order-delivery-line-card">
                      <div className="purchase-order-delivery-line-name" title={line.label}>
                        {line.label}
                        {line.isLpg && (
                          <span className="purchase-order-delivery-line-badge">
                            {`Empty: ${fmtQty(line.qtyEmpty)}`}
                          </span>
                        )}
                      </div>

                      <div className="purchase-order-delivery-line-fields">
                        <label className="full-width-field purchase-order-action-field">
                          <span>Receive Qty</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={line.receiveQty}
                            onChange={(event) =>
                              setDeliveryState((current) =>
                                current
                                  ? {
                                      ...current,
                                      lines: current.lines.map((entry) =>
                                        entry.purchaseOrderLineId === line.purchaseOrderLineId
                                          ? { ...entry, receiveQty: event.target.value }
                                          : entry
                                      )
                                    }
                                  : current
                              )
                            }
                          />
                        </label>

                        <label className="full-width-field purchase-order-action-field">
                          <span>
                            {line.isLpg
                              ? `Pull-out Qty (max ${fmtQty(pulloutCap)})`
                              : 'Pull-out Qty'}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder={line.isLpg ? '0' : 'N/A'}
                            disabled={!line.isLpg}
                            value={line.isLpg ? line.pulloutQty : ''}
                            onChange={(event) =>
                              setDeliveryState((current) =>
                                current
                                  ? {
                                      ...current,
                                      lines: current.lines.map((entry) =>
                                        entry.purchaseOrderLineId === line.purchaseOrderLineId
                                          ? { ...entry, pulloutQty: event.target.value }
                                          : entry
                                      )
                                    }
                                  : current
                              )
                            }
                          />
                        </label>

                        <label className="full-width-field purchase-order-action-field">
                          <span>Unit Cost</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.unitCost}
                            onChange={(event) =>
                              setDeliveryState((current) =>
                                current
                                  ? {
                                      ...current,
                                      lines: current.lines.map((entry) =>
                                        entry.purchaseOrderLineId === line.purchaseOrderLineId
                                          ? { ...entry, unitCost: event.target.value }
                                          : entry
                                      )
                                    }
                                  : current
                              )
                            }
                          />
                        </label>
                      </div>

                      {line.isLpg && hasPullout ? (
                        <div className="purchase-order-delivery-reason-row">
                          <label className="full-width-field purchase-order-action-field">
                            <span>Pull-out Reason <span className="font-normal text-[var(--muted)]">(Optional)</span></span>
                            <select
                              value={line.pulloutReason}
                              onChange={(event) =>
                                setDeliveryState((current) =>
                                  current
                                    ? {
                                        ...current,
                                        lines: current.lines.map((entry) =>
                                          entry.purchaseOrderLineId === line.purchaseOrderLineId
                                            ? {
                                                ...entry,
                                                pulloutReason: event.target.value as DesktopPurchaseOrderPulloutReason | ''
                                              }
                                            : entry
                                        )
                                      }
                                    : current
                                )
                              }
                            >
                              <option value="">— select reason —</option>
                              <option value="EXPIRED">Expired</option>
                              <option value="DAMAGED">Damaged</option>
                              <option value="WRONG_ITEM">Wrong Item</option>
                              <option value="OVERDELIVERY">Overdelivery</option>
                              <option value="EMPTIES">Empties</option>
                              <option value="OTHER">Other</option>
                            </select>
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

            </div>
            <div className="desktop-modal-footer purchase-order-action-footer">
              <button
                className="secondary-btn purchase-order-action-btn purchase-order-action-btn--secondary"
                type="button"
                onClick={() => setDeliveryState(null)}
              >
                Cancel
              </button>
              <button
                className="primary-btn purchase-order-action-btn purchase-order-action-btn--primary"
                type="button"
                onClick={() => void handleDeliverySubmit()}
                disabled={deliveryState.busy}
              >
                {deliveryState.busy ? 'Saving…' : 'Post Delivery'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

            {attachmentState ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action purchase-order-action-modal max-w-[720px]">
            <PurchaseOrderActionHeader
              eyebrow="Purchase order attachment"
              title="Add Attachment"
              description="Attach a proof file offline and queue it for sync."
              icon="attachment"
              tone="purple"
              onClose={() => setAttachmentState(null)}
            />
            <div className="desktop-modal-body purchase-order-action-body">
              <input ref={attachmentInputRef} type="file" className="hidden" onChange={(event) => void handleAttachmentPicked(event)} />
              <div className="purchase-order-attachment-picker">
                <button className="desktop-secondary-btn purchase-order-attachment-pick-btn" type="button" onClick={() => attachmentInputRef.current?.click()}>
                  <PurchaseOrderTileIcon kind="attachment" className="h-[16px] w-[16px]" />
                  <span>Choose File</span>
                </button>
              </div>
              <div className="purchase-order-attachment-state">
                <strong>Selected file</strong>
                <span>
                  {attachmentState.file
                    ? `${attachmentState.file.fileName} • ${attachmentState.file.mimeType || 'file'} • ${attachmentState.file.sizeBytes} bytes`
                    : 'No file selected yet.'}
                </span>
              </div>
            </div>
            <div className="desktop-modal-footer purchase-order-action-footer flex items-center justify-end gap-3 px-5 py-5 sm:px-7 sm:py-6">
              <button className="secondary-btn purchase-order-action-btn purchase-order-action-btn--secondary" type="button" onClick={() => setAttachmentState(null)}>
                Cancel
              </button>
              <button className="primary-btn purchase-order-action-btn purchase-order-action-btn--primary" type="button" onClick={() => void handleAttachmentSubmit()} disabled={attachmentState.busy}>
                {attachmentState.busy ? 'Saving...' : 'Save Attachment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

            {cancelState ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action purchase-order-action-modal max-w-[720px]">
            <PurchaseOrderActionHeader
              eyebrow="Purchase order action"
              title="Cancel Purchase Order"
              description="Record the reason before cancelling this offline purchase order."
              icon="cancel"
              tone="danger"
              onClose={() => setCancelState(null)}
            />
            <div className="desktop-modal-body purchase-order-action-body">
              <div className="purchase-order-action-callout danger">
                Cancelling stops further processing for this purchase order. Add a clear reason so the branch audit trail stays useful offline and after sync.
              </div>
              <label className="full-width-field purchase-order-action-field">
                <span>Reason</span>
                <textarea rows={4} value={cancelState.reason} onChange={(event) => setCancelState((current) => current ? { ...current, reason: event.target.value } : current)} />
              </label>
            </div>
            <div className="desktop-modal-footer purchase-order-action-footer flex items-center justify-end gap-3 px-5 py-5 sm:px-7 sm:py-6">
              <button className="secondary-btn purchase-order-action-btn purchase-order-action-btn--secondary" type="button" onClick={() => setCancelState(null)}>
                Back
              </button>
              <button
                className="purchase-order-action-btn purchase-order-action-btn--danger"
                type="button"
                onClick={() => void handleCancelSubmit()}
                disabled={cancelState.busy || !cancelState.reason.trim()}
              >
                {cancelState.busy ? 'Cancelling...' : 'Cancel Purchase Order'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PurchaseOrderDetailModal({
  record,
  onClose,
  onEditDraft,
  onDeleteDraft,
  onSubmit,
  onPostDelivery,
  onComplete,
  onCancel,
  onAttach
}: {
  record: DesktopPurchaseOrderRecord;
  onClose: () => void;
  onEditDraft: () => void;
  onDeleteDraft: () => void;
  onSubmit: () => void;
  onPostDelivery: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onAttach: () => void;
}): JSX.Element {
  const canEditDraft = record.status === 'DRAFT' && record.syncStatus !== 'synced';
  const canDeleteDraft = canEditDraft;
  const canSubmit = record.status === 'DRAFT';
  const canPostDelivery = record.status === 'SUBMITTED' || record.status === 'PARTIALLY_RECEIVED';
  const canComplete =
    canPostDelivery && record.orderedQtyTotal > 0 && record.receivedQtyTotal >= record.orderedQtyTotal;
  const canCancel = record.status !== 'COMPLETED' && record.status !== 'CANCELLED';
  const canAttach = record.status !== 'CANCELLED';
  const displayPoNumber = record.poNumber?.trim() || `PO #${record.id.slice(-6).toUpperCase()}`;
  const syncLabel = purchaseOrderSyncStatusLabel(record.syncStatus);
  const progressHandled = record.receivedQtyTotal + record.pulledOutQtyTotal;
  const progressPercent =
    record.orderedQtyTotal > 0 ? Math.min(100, Math.round((progressHandled / record.orderedQtyTotal) * 100)) : 0;
  const timelineSteps: Array<{
    label: string;
    value: string;
    active: boolean;
    tone: 'accent' | 'good' | 'danger';
    icon: 'po' | 'submitted' | 'received' | 'complete' | 'cancel';
  }> = [
    {
      label: 'Purchase Order Created',
      value: fmtDateTime(record.createdAt),
      active: true,
      tone: 'accent' as const,
      icon: 'po'
    },
    {
      label: 'Submitted',
      value: record.submittedAt ? fmtDateTime(record.submittedAt) : '—',
      active: Boolean(record.submittedAt),
      tone: 'accent' as const,
      icon: 'submitted'
    },
    {
      label: 'Received',
      value: record.receipts.length > 0 ? fmtDateTime(record.receipts[0].createdAt) : '—',
      active: record.receipts.length > 0,
      tone: 'good' as const,
      icon: 'received'
    },
    {
      label: 'Completed',
      value: record.completedAt ? fmtDateTime(record.completedAt) : '—',
      active: Boolean(record.completedAt),
      tone: 'good' as const,
      icon: 'complete'
    }
  ];

  if (record.cancelledAt) {
    timelineSteps.push({
      label: 'Cancelled',
      value: fmtDateTime(record.cancelledAt),
      active: true,
      tone: 'danger' as const,
      icon: 'cancel'
    });
  }

  return (
    <div className="desktop-modal-backdrop" role="presentation">
      <div className="desktop-modal-card desktop-modal-card--detail purchase-order-detail-modal">
        <div className="desktop-modal-header purchase-order-detail-header">
          <div className="purchase-order-detail-hero">
            <div className="purchase-order-detail-hero-main">
              <div className="purchase-order-detail-hero-icon">
                <PurchaseOrderTileIcon kind="po" className="purchase-order-detail-hero-icon-svg" />
              </div>
              <div className="purchase-order-detail-hero-copy">
                <p className="purchase-order-detail-label">Purchase Order Detail</p>
                <div className="purchase-order-detail-number-row">
                  <h3>{displayPoNumber}</h3>
                  <span className={`purchase-order-detail-status-pill ${
                    record.status === 'COMPLETED' ? 'purchase-order-detail-status-pill--completed'
                    : record.status === 'CANCELLED' ? 'purchase-order-detail-status-pill--cancelled'
                    : record.status === 'PARTIALLY_RECEIVED' ? 'purchase-order-detail-status-pill--partial'
                    : record.status === 'SUBMITTED' ? 'purchase-order-detail-status-pill--submitted'
                    : 'purchase-order-detail-status-pill--draft'
                  }`}>{normalizeStatusLabel(record.status)}</span>
                </div>
                <strong className="purchase-order-detail-supplier">{record.supplierLabel}</strong>
                <p className="purchase-order-detail-subline">{record.branchLabel} · {record.locationLabel}</p>
              </div>
            </div>

            <div className="purchase-order-detail-meta-grid">
              <PurchaseOrderDetailMeta label="Created" value={fmtDateTime(record.createdAt)} />
              <PurchaseOrderDetailMeta label="Updated" value={fmtDateTime(record.updatedAt)} />
              <PurchaseOrderDetailMeta
                label="Sync Status"
                value={<span className="purchase-order-detail-sync-pill">{syncLabel}</span>}
              />
              <PurchaseOrderDetailMeta label="Notes" value={record.notes?.trim() || 'No note recorded.'} />
            </div>
          </div>
          <PurchaseOrderModalCloseButton onClick={onClose} className="purchase-order-detail-close-btn" />
        </div>

        <div className="desktop-modal-body purchase-order-detail-body">
          <div className="purchase-order-detail-metrics">
            <DetailMetricCard label="Ordered Qty" value={fmtQty(record.orderedQtyTotal)} icon="draft" tone="accent" />
            <DetailMetricCard label="Received Qty" value={fmtQty(record.receivedQtyTotal)} icon="received" tone="good" />
            <DetailMetricCard label="Pulled Out Qty" value={fmtQty(record.pulledOutQtyTotal)} icon="pullout" tone="warn" />
            <DetailMetricCard label="Attachments" value={String(record.attachmentCount)} icon="attachment" tone="purple" />
            <div className="purchase-order-progress-card">
              <div className="purchase-order-progress-head">
                <strong>Order Progress</strong>
                <span>{progressPercent}% Completed</span>
              </div>
              <div className="purchase-order-progress-track" aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="purchase-order-progress-meta">
                <span>
                  {fmtQty(progressHandled)} of {fmtQty(record.orderedQtyTotal)}
                </span>
                <span>items received/pulled out</span>
              </div>
            </div>
          </div>

          <div className="purchase-order-detail-main-grid">
            <div className="purchase-order-detail-left-stack">
              <section className="purchase-order-detail-section">
                <div className="purchase-order-detail-section-head">
                  <div className="purchase-order-detail-section-title-wrap">
                    <span className="purchase-order-detail-section-icon accent">
                      <PurchaseOrderTileIcon kind="draft" className="h-[18px] w-[18px]" />
                    </span>
                    <div className="grid gap-1">
                      <h4>Purchase Order Lines</h4>
                      <p>Review the ordered, received, and pulled out quantities line by line.</p>
                    </div>
                  </div>
                </div>

                <div className="purchase-order-detail-table-wrap">
                  <table className="purchase-order-detail-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item / Description</th>
                        <th>Ordered</th>
                        <th>Received</th>
                        <th>Pulled Out</th>
                        <th>Unit Cost</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.lines.map((line, index) => (
                        <tr key={line.id}>
                          <td>{index + 1}</td>
                          <td>
                            <div className="purchase-order-detail-item-cell">
                              <strong>{line.productSku} - {line.productName}</strong>
                              <span>{fmtMoney(line.unitCost)}</span>
                              {line.notes ? <p>{line.notes}</p> : null}
                            </div>
                          </td>
                          <td>{fmtQty(line.orderedQty)}</td>
                          <td>{fmtQty(line.receivedQty)}</td>
                          <td>{fmtQty(line.pulledOutQty)}</td>
                          <td>{fmtMoney(line.unitCost)}</td>
                          <td>{fmtMoney(line.orderedQty * line.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td>{fmtQty(record.orderedQtyTotal)}</td>
                        <td>{fmtQty(record.receivedQtyTotal)}</td>
                        <td>{fmtQty(record.pulledOutQtyTotal)}</td>
                        <td />
                        <td>{fmtMoney(record.lines.reduce((sum, line) => sum + line.orderedQty * line.unitCost, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <div className="purchase-order-detail-bottom-grid">
                <InfoCard title="Details" icon="details" tone="accent">
                  <div className="purchase-order-detail-info-list">
                    <PurchaseOrderDetailRow label="Supplier" value={record.supplierLabel} />
                    <PurchaseOrderDetailRow label="Location" value={`${record.branchLabel} · ${record.locationLabel}`} />
                    <PurchaseOrderDetailRow label="Created" value={fmtDateTime(record.createdAt)} />
                    <PurchaseOrderDetailRow label="Updated" value={fmtDateTime(record.updatedAt)} />
                    <PurchaseOrderDetailRow
                      label="Sync Status"
                      value={<span className="purchase-order-detail-sync-pill">{syncLabel}</span>}
                    />
                    <PurchaseOrderDetailRow label="Notes" value={record.notes?.trim() || 'No note recorded.'} />
                    {record.lastError ? <PurchaseOrderDetailRow label="Last Error" value={record.lastError} /> : null}
                  </div>
                </InfoCard>

                <InfoCard title="Activity Timeline" icon="sync" tone="purple">
                  <div className="purchase-order-detail-timeline">
                    {timelineSteps.map((step) => (
                      <div key={step.label} className={`purchase-order-detail-timeline-item ${step.active ? 'active' : ''}`}>
                        <span className={`purchase-order-detail-timeline-icon ${step.tone} ${step.active ? 'active' : ''}`}>
                          <PurchaseOrderTileIcon kind={step.icon} className="h-[14px] w-[14px]" />
                        </span>
                        <div className="purchase-order-detail-timeline-copy">
                          <strong>{step.label}</strong>
                          <span>{step.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </InfoCard>
              </div>
            </div>

            <div className="purchase-order-detail-right-stack">
              <section className="purchase-order-detail-section">
                <div className="purchase-order-detail-section-head">
                  <div className="purchase-order-detail-section-title-wrap">
                    <h4>Actions</h4>
                  </div>
                </div>

                <div className="purchase-order-detail-actions-list">
                  {canSubmit ? <ActionButton label="Submit Purchase Order" kind="submitted" onClick={onSubmit} tone="primary" /> : null}
                  {canPostDelivery ? <ActionButton label="Post Delivery" kind="receive" onClick={onPostDelivery} tone="secondary" /> : null}
                  {canComplete ? <ActionButton label="Complete Purchase Order" kind="complete" onClick={onComplete} tone="primary" /> : null}
                  {canEditDraft ? <ActionButton label="Edit Draft" kind="details" onClick={onEditDraft} tone="secondary" /> : null}
                  {canAttach ? <ActionButton label="Add Attachment" kind="attachment" onClick={onAttach} tone="secondary" /> : null}
                  {canDeleteDraft || canCancel ? <div className="purchase-order-detail-danger-divider">Danger Zone</div> : null}
                  {canDeleteDraft ? <ActionButton label="Delete Draft" kind="delete" onClick={onDeleteDraft} tone="danger" /> : null}
                  {canCancel ? <ActionButton label="Cancel Purchase Order" kind="cancel" onClick={onCancel} tone="danger" /> : null}
                </div>
              </section>

              <InfoCard title="Activity Log" icon="attachment" tone="warn">
                <div className="purchase-order-detail-activity-list">
                  {record.deliveries && record.deliveries.length > 0 ? (
                    record.deliveries.map((delivery, idx) => (
                      <div key={delivery.id} className="purchase-order-delivery-log-entry">
                        <div className="purchase-order-delivery-log-header">
                          <span className="purchase-order-delivery-log-badge">Delivery {idx + 1}</span>
                          {delivery.referenceNo ? (
                            <span className="purchase-order-delivery-log-ref">{delivery.referenceNo}</span>
                          ) : null}
                        </div>
                        <div className="purchase-order-delivery-log-meta">
                          <span className="purchase-order-delivery-log-meta-item">
                            <PurchaseOrderTileIcon kind="sync" className="h-[12px] w-[12px]" />
                            {fmtDateTime(delivery.createdAt)}
                          </span>
                          <span className="purchase-order-delivery-log-meta-item">
                            <PurchaseOrderTileIcon kind="supplier" className="h-[12px] w-[12px]" />
                            {delivery.postedByUserId?.trim() || 'Offline'}
                          </span>
                        </div>
                        {delivery.receipts.length > 0 ? (
                          <div className="purchase-order-delivery-log-section">
                            <span className="purchase-order-delivery-log-section-label good">
                              <PurchaseOrderTileIcon kind="received" className="h-[11px] w-[11px]" />
                              Received
                            </span>
                            {delivery.receipts.map((receipt) =>
                              receipt.lines.map((line) => (
                                <div key={line.id} className="purchase-order-delivery-log-line">
                                  <span>{line.productSku} – {line.productName}</span>
                                  <strong>+{fmtQty(line.quantity)}</strong>
                                </div>
                              ))
                            )}
                            {delivery.receipts[0]?.notes ? (
                              <p className="purchase-order-delivery-log-note">{delivery.receipts[0].notes}</p>
                            ) : null}
                          </div>
                        ) : null}
                        {delivery.pullouts.length > 0 ? (
                          <div className="purchase-order-delivery-log-section">
                            <span className="purchase-order-delivery-log-section-label warn">
                              <PurchaseOrderTileIcon kind="pullout" className="h-[11px] w-[11px]" />
                              Pulled Out
                            </span>
                            {delivery.pullouts.map((pullout) =>
                              pullout.lines.map((line) => (
                                <div key={line.id} className="purchase-order-delivery-log-line">
                                  <span>{line.productSku} – {line.productName}{line.pulloutReason ? ` (${line.pulloutReason.replace(/_/g, ' ')})` : ''}</span>
                                  <strong>-{fmtQty(line.quantity)}</strong>
                                </div>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <>
                      <PurchaseOrderActivityCard
                        icon="received"
                        tone="good"
                        label="Receipts"
                        value={record.receipts.length > 0 ? `${record.receipts.length} record${record.receipts.length === 1 ? '' : 's'}` : 'No receipts yet.'}
                      />
                      <PurchaseOrderActivityCard
                        icon="pullout"
                        tone="warn"
                        label="Pullouts"
                        value={record.pullouts.length > 0 ? `${record.pullouts.length} record${record.pullouts.length === 1 ? '' : 's'}` : 'No pullouts recorded.'}
                      />
                    </>
                  )}
                  <PurchaseOrderActivityCard
                    icon="attachment"
                    tone="purple"
                    label="Attachments"
                    value={record.attachments.length > 0 ? `${record.attachments.length} uploaded` : 'No attachments uploaded.'}
                  />
                </div>
                {canAttach ? (
                  <button className="purchase-order-detail-attach-btn secondary-btn" type="button" onClick={onAttach}>
                    <PurchaseOrderTileIcon kind="attachment" />
                    <span>Add Attachment</span>
                  </button>
                ) : null}
              </InfoCard>
            </div>
          </div>        </div>
      </div>
    </div>
  );
}

function PurchaseOrderDetailMeta({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="purchase-order-detail-meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailMetricCard({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: string;
  icon: 'draft' | 'received' | 'pullout' | 'attachment';
  tone: 'accent' | 'good' | 'warn' | 'purple';
}): JSX.Element {
  return (
    <div className="purchase-order-detail-metric-card">
      <div className="purchase-order-detail-metric-inner">
        <span className={`purchase-order-detail-metric-icon ${tone}`}>
          <PurchaseOrderTileIcon kind={icon} className="h-[18px] w-[18px]" />
        </span>
        <div className={`purchase-order-detail-metric-copy ${tone}`}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  icon,
  tone = 'accent',
  children
}: {
  title: string;
  icon: 'details' | 'sync' | 'attachment';
  tone?: 'accent' | 'good' | 'warn' | 'purple';
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="purchase-order-detail-section">
      <div className="purchase-order-detail-section-head">
        <div className="purchase-order-detail-section-title-wrap">
          <span className={`purchase-order-detail-section-icon ${tone}`}>
            <PurchaseOrderTileIcon kind={icon} className="h-[18px] w-[18px]" />
          </span>
          <h4>{title}</h4>
        </div>
      </div>
      {children}
    </section>
  );
}

function PurchaseOrderDetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="purchase-order-detail-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PurchaseOrderActivityCard({
  icon,
  tone,
  label,
  value
}: {
  icon: 'received' | 'pullout' | 'attachment';
  tone: 'good' | 'warn' | 'purple';
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="purchase-order-detail-activity-card-row">
      <span className={`purchase-order-detail-activity-icon ${tone}`}>
        <PurchaseOrderTileIcon kind={icon} className="h-[16px] w-[16px]" />
      </span>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function PurchaseOrderModalCloseButton({
  onClick,
  className = ''
}: {
  onClick: () => void;
  className?: string;
}): JSX.Element {
  return (
    <button
      className={`secondary-btn mini-btn modal-close-icon-btn purchase-order-modal-close-btn ${className}`.trim()}
      type="button"
      onClick={onClick}
      aria-label="Close modal"
      title="Close"
    >
      <PurchaseOrderTileIcon kind="close" className="h-[16px] w-[16px]" />
    </button>
  );
}

function PurchaseOrderActionHeader({
  eyebrow,
  title,
  description,
  icon,
  tone,
  onClose
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: 'delete' | 'received' | 'pullout' | 'attachment' | 'cancel';
  tone: 'danger' | 'good' | 'warn' | 'purple';
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="purchase-order-action-header desktop-modal-header shrink-0 px-5 py-5 sm:px-7 sm:py-6">
      <div className="purchase-order-action-header-main">
        <span className={`purchase-order-action-header-icon ${tone}`}>
          <PurchaseOrderTileIcon kind={icon} className="h-[22px] w-[22px]" />
        </span>
        <div className="purchase-order-action-header-copy">
          <span className="purchase-order-action-header-eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <PurchaseOrderModalCloseButton onClick={onClose} />
    </div>
  );
}

function ActionButton({
  label,
  kind,
  tone,
  onClick
}: {
  label: string;
  kind: 'submitted' | 'receive' | 'pullout' | 'complete' | 'cancel' | 'attachment' | 'details' | 'delete';
  tone: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}): JSX.Element {
  const className =
    tone === 'primary'
      ? 'primary-btn'
      : tone === 'danger'
        ? 'purchase-order-detail-action-btn purchase-order-detail-action-btn--danger'
        : 'secondary-btn';
  return (
    <button className={`${className} purchase-order-detail-action-btn w-full justify-center gap-2`} type="button" onClick={onClick}>
      <PurchaseOrderTileIcon kind={kind} />
      <span>{label}</span>
    </button>
  );
}


