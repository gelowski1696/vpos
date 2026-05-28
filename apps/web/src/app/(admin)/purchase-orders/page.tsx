'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type CurrentEntitlement = {
  addons?: {
    purchase_order_suite?: boolean;
  };
};

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type LocationRecord = {
  id: string;
  code: string;
  name: string;
  branchId?: string | null;
  isActive: boolean;
};

type SupplierRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  standardCost?: number | null;
  isActive: boolean;
};

type PurchaseOrderSummary = {
  id: string;
  po_number: string;
  status: 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';
  branch_id: string;
  branch_name: string;
  location_id: string;
  location_name: string;
  supplier_id: string;
  supplier_name: string;
  notes: string | null;
  ordered_qty_total: number;
  received_qty_total: number;
  pulled_out_qty_total: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

type PurchaseOrderLine = {
  id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  notes: string | null;
};

type PurchaseOrderReceipt = {
  id: string;
  location_id: string;
  location_name: string;
  received_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  lines: Array<{
    id: string;
    purchase_order_line_id: string;
    product_id: string;
    product_sku: string;
    product_name: string;
    quantity: number;
    unit_cost: number;
  }>;
};

type PurchaseOrderPullout = {
  id: string;
  location_id: string;
  location_name: string;
  pulled_out_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  lines: Array<{
    id: string;
    purchase_order_line_id: string;
    product_id: string;
    product_sku: string;
    product_name: string;
    quantity: number;
    unit_cost: number;
  }>;
};

type PurchaseOrderAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_url: string;
  source_channel: string | null;
  retention_until: string | null;
  created_at: string;
};

type PurchaseOrderDetail = PurchaseOrderSummary & {
  lines: PurchaseOrderLine[];
  receipts: PurchaseOrderReceipt[];
  pullouts: PurchaseOrderPullout[];
  attachments: PurchaseOrderAttachment[];
};

type CreateLineDraft = {
  product_id: string;
  ordered_qty: string;
  unit_cost: string;
  notes: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatQty(value: number): string {
  return Number(value ?? 0).toFixed(4);
}

function formatMoney(value: number): string {
  return Number(value ?? 0).toFixed(2);
}

function statusTone(status: PurchaseOrderSummary['status']): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    case 'SUBMITTED':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
    case 'PARTIALLY_RECEIVED':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    default:
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  }
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export default function PurchaseOrdersPage(): JSX.Element {
  const webReadOnly = true;
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PurchaseOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [poNumber, setPoNumber] = useState('');
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [lineDraft, setLineDraft] = useState<CreateLineDraft>({
    product_id: '',
    ordered_qty: '',
    unit_cost: '',
    notes: ''
  });
  const [createLines, setCreateLines] = useState<CreateLineDraft[]>([]);

  const [receiveLineId, setReceiveLineId] = useState('');
  const [receiveQty, setReceiveQty] = useState('');
  const [receiveUnitCost, setReceiveUnitCost] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');

  const [pulloutLineId, setPulloutLineId] = useState('');
  const [pulloutQty, setPulloutQty] = useState('');
  const [pulloutUnitCost, setPulloutUnitCost] = useState('');
  const [pulloutNotes, setPulloutNotes] = useState('');

  const [cancelReason, setCancelReason] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  const activeBranches = useMemo(() => branches.filter((row) => row.isActive), [branches]);
  const activeSuppliers = useMemo(() => suppliers.filter((row) => row.isActive), [suppliers]);
  const activeProducts = useMemo(() => products.filter((row) => row.isActive), [products]);
  const availableLocations = useMemo(
    () =>
      locations.filter(
        (row) => row.isActive && (!branchId || !row.branchId || row.branchId === branchId)
      ),
    [locations, branchId]
  );
  const filteredOrders = useMemo(() => {
    if (statusFilter === 'ALL') {
      return purchaseOrders;
    }
    return purchaseOrders.filter((row) => row.status === statusFilter);
  }, [purchaseOrders, statusFilter]);

  const remainingByLineId = useMemo(() => {
    const result = new Map<string, number>();
    if (!selectedDetail) {
      return result;
    }
    for (const line of selectedDetail.lines) {
      const pulled = selectedDetail.pullouts
        .flatMap((event) => event.lines)
        .filter((entry) => entry.purchase_order_line_id === line.id)
        .reduce((sum, entry) => sum + Number(entry.quantity), 0);
      result.set(line.id, Number((line.received_qty - pulled).toFixed(4)));
    }
    return result;
  }, [selectedDetail]);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const entitlement = await apiRequest<CurrentEntitlement>('/platform/entitlements/current');
      const enabled = entitlement.addons?.purchase_order_suite === true;
      setFeatureEnabled(enabled);
      if (!enabled) {
        setPurchaseOrders([]);
        return;
      }

      const [branchRows, locationRows, supplierRows, productRows] = await Promise.all([
        apiRequest<BranchRecord[]>('/master-data/branches'),
        apiRequest<LocationRecord[]>('/master-data/locations'),
        apiRequest<SupplierRecord[]>('/master-data/suppliers'),
        apiRequest<ProductRecord[]>('/master-data/products')
      ]);

      setBranches(branchRows);
      setLocations(locationRows);
      setSuppliers(supplierRows);
      setProducts(productRows);
      setBranchId((current) => current || branchRows.find((row) => row.isActive)?.id || '');
      setSupplierId((current) => current || supplierRows.find((row) => row.isActive)?.id || '');
      await loadPurchaseOrders(statusFilter);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load purchase order data.';
      setError(message);
      toastError('Failed to load purchase order data', { description: message });
    } finally {
      setLoading(false);
    }
  }

  async function loadPurchaseOrders(filter = statusFilter): Promise<void> {
    if (!featureEnabled && !loading) {
      return;
    }
    const query = new URLSearchParams();
    if (filter && filter !== 'ALL') {
      query.set('status', filter);
    }
    const rows = await apiRequest<PurchaseOrderSummary[]>(
      `/purchase-orders${query.toString() ? `?${query.toString()}` : ''}`
    );
    setPurchaseOrders(rows);
  }

  async function openDetail(id: string): Promise<void> {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const detail = await apiRequest<PurchaseOrderDetail>(`/purchase-orders/${id}`);
      setSelectedDetail(detail);
      if (!receiveLineId && detail.lines.length > 0) {
        setReceiveLineId(detail.lines[0].id);
      }
      if (!pulloutLineId && detail.lines.length > 0) {
        setPulloutLineId(detail.lines[0].id);
      }
    } catch (detailError) {
      const message = detailError instanceof Error ? detailError.message : 'Failed to load PO details.';
      setError(message);
      toastError('Failed to load PO details', { description: message });
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (branchId && !locationId) {
      const match = availableLocations[0];
      if (match) {
        setLocationId(match.id);
      }
    }
    if (locationId && !availableLocations.some((row) => row.id === locationId)) {
      setLocationId(availableLocations[0]?.id ?? '');
    }
  }, [branchId, locationId, availableLocations]);

  async function refreshSelectedDetail(): Promise<void> {
    if (!selectedId) {
      return;
    }
    await openDetail(selectedId);
  }

  function addCreateLine(): void {
    if (!lineDraft.product_id || !lineDraft.ordered_qty || !lineDraft.unit_cost) {
      toastInfo('Create PO line', { description: 'Select product, quantity, and unit cost first.' });
      return;
    }
    const qty = Number(lineDraft.ordered_qty);
    const cost = Number(lineDraft.unit_cost);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost <= 0) {
      toastInfo('Create PO line', { description: 'Quantity and unit cost must be greater than zero.' });
      return;
    }
    setCreateLines((prev) => [...prev, lineDraft]);
    setLineDraft({
      product_id: '',
      ordered_qty: '',
      unit_cost: '',
      notes: ''
    });
  }

  function removeCreateLine(index: number): void {
    setCreateLines((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function createPurchaseOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!branchId || !locationId || !supplierId) {
      toastInfo('Create purchase order', { description: 'Select branch, location, and supplier.' });
      return;
    }
    if (createLines.length === 0) {
      toastInfo('Create purchase order', { description: 'Add at least one PO line.' });
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<PurchaseOrderDetail>('/purchase-orders', {
        method: 'POST',
        body: {
          po_number: poNumber.trim() || undefined,
          branch_id: branchId,
          location_id: locationId,
          supplier_id: supplierId,
          notes: poNotes.trim() || null,
          lines: createLines.map((line) => ({
            product_id: line.product_id,
            ordered_qty: Number(line.ordered_qty),
            unit_cost: Number(line.unit_cost),
            notes: line.notes.trim() || null
          }))
        }
      });
      toastSuccess('Purchase order created.');
      setPoNumber('');
      setPoNotes('');
      setCreateLines([]);
      await loadPurchaseOrders();
      await openDetail(created.id);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to create purchase order.';
      setError(message);
      toastError('Failed to create purchase order', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function submitSelected(): Promise<void> {
    if (!selectedId) return;
    setSaving(true);
    try {
      await apiRequest(`/purchase-orders/${selectedId}/submit`, { method: 'POST', body: {} });
      toastSuccess('Purchase order submitted.');
      await loadPurchaseOrders();
      await refreshSelectedDetail();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Failed to submit PO.';
      setError(message);
      toastError('Failed to submit PO', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function receiveSelected(): Promise<void> {
    if (!selectedId || !receiveLineId) return;
    const qty = Number(receiveQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toastInfo('Receive line', { description: 'Enter a valid receive quantity.' });
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/purchase-orders/${selectedId}/receive`, {
        method: 'POST',
        body: {
          notes: receiveNotes.trim() || null,
          lines: [
            {
              purchase_order_line_id: receiveLineId,
              quantity: qty,
              unit_cost: receiveUnitCost.trim() ? Number(receiveUnitCost) : undefined
            }
          ]
        }
      });
      toastSuccess('PO receive posted.');
      setReceiveQty('');
      setReceiveUnitCost('');
      setReceiveNotes('');
      await loadPurchaseOrders();
      await refreshSelectedDetail();
    } catch (receiveError) {
      const message = receiveError instanceof Error ? receiveError.message : 'Failed to receive PO line.';
      setError(message);
      toastError('Failed to receive PO line', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function pulloutSelected(): Promise<void> {
    if (!selectedId || !pulloutLineId) return;
    const qty = Number(pulloutQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toastInfo('Pullout line', { description: 'Enter a valid pullout quantity.' });
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/purchase-orders/${selectedId}/pullout`, {
        method: 'POST',
        body: {
          notes: pulloutNotes.trim() || null,
          lines: [
            {
              purchase_order_line_id: pulloutLineId,
              quantity: qty,
              unit_cost: pulloutUnitCost.trim() ? Number(pulloutUnitCost) : undefined
            }
          ]
        }
      });
      toastSuccess('PO pullout posted.');
      setPulloutQty('');
      setPulloutUnitCost('');
      setPulloutNotes('');
      await loadPurchaseOrders();
      await refreshSelectedDetail();
    } catch (pulloutError) {
      const message = pulloutError instanceof Error ? pulloutError.message : 'Failed to post pullout.';
      setError(message);
      toastError('Failed to post pullout', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function completeSelected(): Promise<void> {
    if (!selectedId) return;
    setSaving(true);
    try {
      await apiRequest(`/purchase-orders/${selectedId}/complete`, { method: 'POST', body: {} });
      toastSuccess('Purchase order completed.');
      await loadPurchaseOrders();
      await refreshSelectedDetail();
    } catch (completeError) {
      const message = completeError instanceof Error ? completeError.message : 'Failed to complete PO.';
      setError(message);
      toastError('Failed to complete PO', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function cancelSelected(): Promise<void> {
    if (!selectedId) return;
    setSaving(true);
    try {
      await apiRequest(`/purchase-orders/${selectedId}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason.trim() || null }
      });
      toastSuccess('Purchase order cancelled.');
      setCancelReason('');
      await loadPurchaseOrders();
      await refreshSelectedDetail();
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Failed to cancel PO.';
      setError(message);
      toastError('Failed to cancel PO', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function uploadAttachment(): Promise<void> {
    if (!selectedId || !attachmentFile) {
      toastInfo('PO attachment', { description: 'Choose a file first.' });
      return;
    }
    setSaving(true);
    try {
      const base64 = await fileToBase64(attachmentFile);
      await apiRequest(`/purchase-orders/${selectedId}/attachments`, {
        method: 'POST',
        body: {
          file_name: attachmentFile.name,
          mime_type: attachmentFile.type || 'application/octet-stream',
          size_bytes: attachmentFile.size,
          data_base64: base64,
          source_channel: 'web'
        }
      });
      toastSuccess('Attachment uploaded.');
      setAttachmentFile(null);
      await refreshSelectedDetail();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to upload attachment.';
      setError(message);
      toastError('Failed to upload attachment', { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="space-y-4" data-tour="purchase-orders-root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandPrimary">Add-on Workspace</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Purchase Orders</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Web is view-only for purchase order records. Create and process PO flows on Desktop/Mobile POS (offline first), then review here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            onChange={(event) => {
              const next = event.target.value;
              setStatusFilter(next);
              void loadPurchaseOrders(next);
            }}
            value={statusFilter}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="PARTIALLY_RECEIVED">Partially Received</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void loadAll()}
            type="button"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {!loading && !featureEnabled ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <h2 className="text-base font-semibold">Purchase Order Suite add-on is not enabled</h2>
          <p className="mt-1">
            Enable Purchase Order Suite in Owner Tenant Console to access PO creation, receiving, and pullout flows.
          </p>
        </section>
      ) : null}

      {featureEnabled ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Web Access</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Purchase Orders are read-only on web. Create, submit, receive, pullout, attach, complete, and cancel flows are handled in Desktop/Mobile POS and synced here.
            </p>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Purchase Order List</h2>
              </div>
              <div className="max-h-[72vh] overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/90 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">PO</th>
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Totals</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {loading ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>
                          Loading...
                        </td>
                      </tr>
                    ) : filteredOrders.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>
                          No purchase orders found.
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((row) => (
                        <tr
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${selectedId === row.id ? 'bg-brandPrimary/10 dark:bg-brandPrimary/20' : ''}`}
                          key={row.id}
                          onClick={() => void openDetail(row.id)}
                        >
                          <td className="px-3 py-2 align-top">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{row.po_number}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{row.branch_name} - {row.location_name}</p>
                          </td>
                          <td className="px-3 py-2 align-top">{row.supplier_name}</td>
                          <td className="px-3 py-2 align-top">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
                              {row.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-slate-600 dark:text-slate-300">
                            <div>Ordered: {formatQty(row.ordered_qty_total)}</div>
                            <div>Received: {formatQty(row.received_qty_total)}</div>
                            <div>Pulled Out: {formatQty(row.pulled_out_qty_total)}</div>
                            <div>Attachments: {row.attachment_count}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-slate-500 dark:text-slate-400">
                            {formatDate(row.updated_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">PO Details</h2>
              {!selectedId ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Select a PO row to view synced details.</p>
              ) : detailLoading || !selectedDetail ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading details...</p>
              ) : (
                <div className="mt-3 space-y-4">
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{selectedDetail.po_number}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{selectedDetail.supplier_name}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(selectedDetail.status)}`}>
                        {selectedDetail.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {selectedDetail.branch_name} - {selectedDetail.location_name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Created: {formatDate(selectedDetail.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{selectedDetail.notes || '-'}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Lines</p>
                    <div className="max-h-44 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/70">
                          <tr>
                            <th className="px-2 py-1">Item</th>
                            <th className="px-2 py-1">Ordered</th>
                            <th className="px-2 py-1">Received</th>
                            <th className="px-2 py-1">Remaining</th>
                            <th className="px-2 py-1">Unit Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {selectedDetail.lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-2 py-1">
                                <p className="font-semibold">{line.product_sku}</p>
                                <p>{line.product_name}</p>
                              </td>
                              <td className="px-2 py-1">{formatQty(line.ordered_qty)}</td>
                              <td className="px-2 py-1">{formatQty(line.received_qty)}</td>
                              <td className="px-2 py-1">
                                {formatQty(Math.max(0, line.ordered_qty - line.received_qty))}
                              </td>
                              <td className="px-2 py-1">{formatMoney(line.unit_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {webReadOnly ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      This panel is read-only on web. All PO actions are completed in Desktop/Mobile POS and reflected here after sync.
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Attachments</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedDetail.attachments.length}/5 uploaded. Completion requires at least one.
                    </p>
                    <div className="mt-2 max-h-32 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                      {selectedDetail.attachments.length === 0 ? (
                        <p className="text-slate-500 dark:text-slate-400">No attachments yet.</p>
                      ) : (
                        selectedDetail.attachments.map((attachment) => (
                          <a
                            className="block truncate text-brandPrimary underline-offset-2 hover:underline"
                            href={attachment.uploaded_url}
                            key={attachment.id}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {attachment.file_name} ({attachment.size_bytes} bytes)
                          </a>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Activity</p>
                    <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-300">Receipts</p>
                    <div className="max-h-24 overflow-auto text-xs text-slate-600 dark:text-slate-300">
                      {selectedDetail.receipts.length === 0 ? (
                        <p className="text-slate-500 dark:text-slate-400">No receive events.</p>
                      ) : (
                        selectedDetail.receipts.map((event) => (
                          <p key={event.id}>
                            {formatDate(event.created_at)} | {event.location_name} | {event.lines.length} line(s)
                          </p>
                        ))
                      )}
                    </div>
                    <p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Pullouts</p>
                    <div className="max-h-24 overflow-auto text-xs text-slate-600 dark:text-slate-300">
                      {selectedDetail.pullouts.length === 0 ? (
                        <p className="text-slate-500 dark:text-slate-400">No pullout events.</p>
                      ) : (
                        selectedDetail.pullouts.map((event) => (
                          <p key={event.id}>
                            {formatDate(event.created_at)} | {event.location_name} | {event.lines.length} line(s)
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
