'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest, getSessionRoles } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type LocationRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  isLpg: boolean;
  cylinderTypeId?: string | null;
  isActive: boolean;
};

type InventoryOpeningSnapshotRow = {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productSku: string;
  productName: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  inventoryValue: number;
  hasOpeningEntry: boolean;
  hasTransactionalMovements: boolean;
  lastMovementAt: string | null;
};

type InventoryOpeningSnapshot = {
  asOf: string;
  rows: InventoryOpeningSnapshotRow[];
};

type ApplyOpeningResult = {
  ledgerId: string;
  locationId: string;
  productId: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  qtyDelta: number;
  referenceId: string;
  createdAt: string;
};

type OpeningLine = {
  id: string;
  productId: string;
  qtyOnHand: string;
  qtyFull: string;
  qtyEmpty: string;
  avgCost: string;
  notes: string;
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function InventoryOpeningPage(): JSX.Element {
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [snapshot, setSnapshot] = useState<InventoryOpeningSnapshot>({ asOf: new Date(0).toISOString(), rows: [] });

  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<OpeningLine[]>([]);
  const [force, setForce] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerCategory, setProductPickerCategory] = useState('ALL');
  const [productPickerSearch, setProductPickerSearch] = useState('');
  const [productPickerSelected, setProductPickerSelected] = useState<string[]>([]);

  const canEdit = useMemo(
    () => roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );

  const selectedLocation = useMemo(
    () => locations.find((item) => item.id === locationId) ?? null,
    [locationId, locations]
  );
  const productById = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);
  const productCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const product of products) {
      const category = String(product.category ?? '').trim();
      if (category) {
        categories.add(category);
      }
    }
    return ['ALL', ...Array.from(categories).sort((a, b) => a.localeCompare(b))];
  }, [products]);
  const productPickerRows = useMemo(() => {
    const searchTerm = productPickerSearch.trim().toLowerCase();
    return products.filter((product) => {
      const category = String(product.category ?? '').trim() || 'Uncategorized';
      const categoryMatch = productPickerCategory === 'ALL' || category === productPickerCategory;
      if (!categoryMatch) {
        return false;
      }
      if (!searchTerm) {
        return true;
      }
      return (
        product.name.toLowerCase().includes(searchTerm) ||
        product.sku.toLowerCase().includes(searchTerm) ||
        category.toLowerCase().includes(searchTerm)
      );
    });
  }, [productPickerCategory, productPickerSearch, products]);

  function buildOpeningLine(defaultProductId = ''): OpeningLine {
    return {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: defaultProductId,
      qtyOnHand: '0',
      qtyFull: '0',
      qtyEmpty: '0',
      avgCost: '0',
      notes: ''
    };
  }

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [locationRows, productRows, openingSnapshot] = await Promise.all([
        apiRequest<LocationRecord[]>('/master-data/locations'),
        apiRequest<ProductRecord[]>('/master-data/products'),
        apiRequest<InventoryOpeningSnapshot>('/master-data/inventory/opening-stock')
      ]);
      setLocations(locationRows.filter((row) => row.isActive).sort((a, b) => a.code.localeCompare(b.code)));
      setProducts(productRows.filter((row) => row.isActive).sort((a, b) => a.sku.localeCompare(b.sku)));
      setSnapshot(openingSnapshot);
      if (!locationId && locationRows.length > 0) {
        setLocationId(locationRows.find((row) => row.isActive)?.id ?? '');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load opening stock setup';
      setError(message);
      toastError('Failed to load opening stock', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRoles(getSessionRoles());
    void load();
  }, []);

  function updateLine(index: number, patch: Partial<OpeningLine>): void {
    setLines((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) {
        return prev;
      }
      next[index] = { ...current, ...patch };
      return next;
    });
  }

  function addLine(): void {
    setLines((prev) => [...prev, buildOpeningLine(products[0]?.id ?? '')]);
  }

  function openProductPicker(): void {
    setProductPickerCategory('ALL');
    setProductPickerSearch('');
    setProductPickerSelected([]);
    setProductPickerOpen(true);
  }

  function toggleProductPickerItem(productId: string): void {
    setProductPickerSelected((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  }

  function addSelectedProductsToLines(): void {
    if (productPickerSelected.length === 0) {
      toastInfo('Add products', { description: 'Select at least one product.' });
      return;
    }
    let added = 0;
    let skipped = 0;
    setLines((prev) => {
      const existing = new Set(prev.map((row) => row.productId));
      const next = [...prev];
      for (const productId of productPickerSelected) {
        if (existing.has(productId)) {
          skipped += 1;
          continue;
        }
        next.push(buildOpeningLine(productId));
        existing.add(productId);
        added += 1;
      }
      return next;
    });
    setProductPickerOpen(false);
    setProductPickerSelected([]);
    setProductPickerSearch('');
    setProductPickerCategory('ALL');
    if (added > 0) {
      toastSuccess('Products added', {
        description:
          skipped > 0
            ? `${added} added. ${skipped} already existed in the opening rows.`
            : `${added} product(s) added to opening rows.`
      });
      return;
    }
    toastInfo('No products added', { description: 'All selected products are already in the opening rows.' });
  }

  function removeLine(index: number): void {
    setLines((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!canEdit) {
      return;
    }
    if (!locationId.trim()) {
      const message = 'Select location.';
      setError(message);
      toastInfo('Opening stock validation', { description: message });
      return;
    }
    if (lines.length === 0) {
      const message = 'Add at least one product row.';
      setError(message);
      toastInfo('Opening stock validation', { description: message });
      return;
    }

    const preparedRows: Array<{
      product: ProductRecord;
      payload: {
        locationId: string;
        productId: string;
        qtyOnHand: number;
        qtyFull?: number;
        qtyEmpty?: number;
        avgCost: number;
        notes: string | null;
        force: boolean;
      };
    }> = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const product = productById.get(line.productId);
      const parsedQty = Number(line.qtyOnHand);
      const parsedFull = Number(line.qtyFull);
      const parsedEmpty = Number(line.qtyEmpty);
      const parsedCost = Number(line.avgCost);

      if (!line.productId.trim() || !product) {
        const message = `Row ${index + 1}: Select product.`;
        setError(message);
        toastInfo('Opening stock validation', { description: message });
        return;
      }
      if (product.isLpg) {
        if (!Number.isFinite(parsedFull) || parsedFull < 0 || !Number.isInteger(parsedFull)) {
          const message = `Row ${index + 1}: Opening FULL must be a non-negative whole number.`;
          setError(message);
          toastInfo('Opening stock validation', { description: message });
          return;
        }
        if (!Number.isFinite(parsedEmpty) || parsedEmpty < 0 || !Number.isInteger(parsedEmpty)) {
          const message = `Row ${index + 1}: Opening EMPTY must be a non-negative whole number.`;
          setError(message);
          toastInfo('Opening stock validation', { description: message });
          return;
        }
      } else if (!Number.isFinite(parsedQty) || parsedQty < 0) {
        const message = `Row ${index + 1}: Opening qty must be a non-negative number.`;
        setError(message);
        toastInfo('Opening stock validation', { description: message });
        return;
      }
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        const message = `Row ${index + 1}: Average cost must be a non-negative number.`;
        setError(message);
        toastInfo('Opening stock validation', { description: message });
        return;
      }

      preparedRows.push({
        product,
        payload: {
          locationId,
          productId: line.productId,
          qtyOnHand: product.isLpg ? parsedFull + parsedEmpty : parsedQty,
          qtyFull: product.isLpg ? parsedFull : undefined,
          qtyEmpty: product.isLpg ? parsedEmpty : undefined,
          avgCost: parsedCost,
          notes: line.notes.trim() || null,
          force
        }
      });
    }

    setSaving(true);
    setError(null);
    try {
      let successCount = 0;
      const failedRows: string[] = [];
      let lastResult: ApplyOpeningResult | null = null;
      for (let index = 0; index < preparedRows.length; index += 1) {
        const row = preparedRows[index];
        try {
          const result = await apiRequest<ApplyOpeningResult>('/master-data/inventory/opening-stock', {
            method: 'POST',
            body: row.payload
          });
          lastResult = result;
          successCount += 1;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Failed';
          failedRows.push(`Row ${index + 1} (${row.product.sku}): ${message}`);
        }
      }
      if (successCount > 0) {
        toastSuccess('Opening stock applied', {
          description:
            successCount === 1 && lastResult
              ? `FULL ${qty(lastResult.qtyFull)} | EMPTY ${qty(lastResult.qtyEmpty)} | New qty ${qty(lastResult.qtyOnHand)} | Avg cost ${money(lastResult.avgCost)}`
              : `${successCount} product row(s) applied successfully.`
        });
      }
      if (failedRows.length > 0) {
        const message = `Some rows failed: ${failedRows.join(' | ')}`;
        setError(message);
        toastError('Opening stock partial failure', { description: message });
      }
      setForce(false);
      if (failedRows.length === 0) {
        setApplyModalOpen(false);
      }
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to apply opening stock';
      setError(message);
      toastError('Failed to apply opening stock', { description: message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading opening stock...</p>;
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Opening Stock Setup</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Set initial quantity on hand and average cost per location and SKU using a controlled inventory ledger entry.
        </p>
      </header>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-semibold">Safe Process</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Use this only for go-live opening balances.</li>
          <li>Do not use after sales/transfers already started for the same SKU/location.</li>
          <li>After go-live, use stock adjustment workflow (not opening stock) for corrections.</li>
          <li>Use Force Replace only for opening-only corrections before transactional movements.</li>
        </ol>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Apply Opening Stock</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Use a controlled modal workflow for opening stock setup.
            </p>
          </div>
          <button
            className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canEdit}
            onClick={() => {
              setLines([buildOpeningLine(products[0]?.id ?? '')]);
              setForce(false);
              setProductPickerOpen(false);
              setProductPickerCategory('ALL');
              setProductPickerSearch('');
              setProductPickerSelected([]);
              setApplyModalOpen(true);
            }}
            type="button"
          >
            Open Apply Modal
          </button>
        </div>
        {!canEdit ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            You can view opening stock snapshot, but only admin/owner can apply opening stock.
          </p>
        ) : null}
      </section>

      {applyModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="presentation">
          <div
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Apply Opening Stock"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Apply Opening Stock</h3>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                disabled={saving}
                onClick={() => {
                  setProductPickerOpen(false);
                  setApplyModalOpen(false);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">Location</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                  disabled={!canEdit || saving}
                  onChange={(event) => setLocationId(event.target.value)}
                  value={locationId}
                >
                  <option value="">Select location</option>
                  {locations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} ({row.code})
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Products</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Add multiple products and apply opening stock in one submit.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      disabled={!canEdit || saving}
                      onClick={addLine}
                      type="button"
                    >
                      Add Single Row
                    </button>
                    <button
                      className="rounded-lg border border-brandPrimary px-3 py-1.5 text-xs font-semibold text-brandPrimary hover:bg-brandPrimary/10"
                      disabled={!canEdit || saving}
                      onClick={openProductPicker}
                      type="button"
                    >
                      Add Multiple Products
                    </button>
                  </div>
                </div>

                <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
                  {lines.map((line, index) => {
                    const product = productById.get(line.productId);
                    const isLpg = Boolean(product?.isLpg);
                    const computedOnHand = Number(line.qtyFull || '0') + Number(line.qtyEmpty || '0');
                    return (
                      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" key={line.id}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Row {index + 1}
                          </p>
                          <button
                            className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            disabled={!canEdit || saving || lines.length <= 1}
                            onClick={() => removeLine(index)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="grid gap-1 text-sm">
                            <span className="font-medium text-slate-700 dark:text-slate-200">Product</span>
                            <select
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                              disabled={!canEdit || saving}
                              onChange={(event) => updateLine(index, { productId: event.target.value })}
                              value={line.productId}
                            >
                              <option value="">Select product</option>
                              {products.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.name} ({row.sku}){row.category ? ` - ${row.category}` : ''} {row.isLpg ? '- LPG' : ''}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="grid gap-1 text-sm">
                            <span className="font-medium text-slate-700 dark:text-slate-200">Opening Avg Cost</span>
                            <input
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                              disabled={!canEdit || saving}
                              min={0}
                              onChange={(event) => updateLine(index, { avgCost: event.target.value })}
                              step="0.0001"
                              type="number"
                              value={line.avgCost}
                            />
                          </label>

                          {isLpg ? (
                            <>
                              <label className="grid gap-1 text-sm">
                                <span className="font-medium text-slate-700 dark:text-slate-200">Opening FULL</span>
                                <input
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                                  disabled={!canEdit || saving}
                                  min={0}
                                  onChange={(event) => updateLine(index, { qtyFull: event.target.value })}
                                  step="1"
                                  type="number"
                                  value={line.qtyFull}
                                />
                              </label>
                              <label className="grid gap-1 text-sm">
                                <span className="font-medium text-slate-700 dark:text-slate-200">Opening EMPTY</span>
                                <input
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                                  disabled={!canEdit || saving}
                                  min={0}
                                  onChange={(event) => updateLine(index, { qtyEmpty: event.target.value })}
                                  step="1"
                                  type="number"
                                  value={line.qtyEmpty}
                                />
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  Computed qty on hand: {qty(Number.isFinite(computedOnHand) ? computedOnHand : 0)}
                                </span>
                              </label>
                            </>
                          ) : (
                            <label className="grid gap-1 text-sm md:col-span-2">
                              <span className="font-medium text-slate-700 dark:text-slate-200">Opening Qty On Hand</span>
                              <input
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                                disabled={!canEdit || saving}
                                min={0}
                                onChange={(event) => updateLine(index, { qtyOnHand: event.target.value })}
                                step="0.0001"
                                type="number"
                                value={line.qtyOnHand}
                              />
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Non-LPG/non-cylinder items use qty on hand directly.
                              </span>
                            </label>
                          )}

                          <label className="grid gap-1 text-sm md:col-span-2">
                            <span className="font-medium text-slate-700 dark:text-slate-200">Notes (optional)</span>
                            <textarea
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                              disabled={!canEdit || saving}
                              onChange={(event) => updateLine(index, { notes: event.target.value })}
                              rows={2}
                              value={line.notes}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  checked={force}
                  className="h-4 w-4"
                  disabled={!canEdit || saving}
                  onChange={(event) => setForce(event.target.checked)}
                  type="checkbox"
                />
                Force replace existing opening-only setup
              </label>
              <button
                className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canEdit || saving}
                onClick={() => void submit()}
                type="button"
              >
                {saving ? 'Applying...' : 'Apply Opening Stock'}
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Location: {selectedLocation ? `${selectedLocation.name} (${selectedLocation.code})` : '-'} | Rows: {lines.length}
            </p>
          </div>
        </div>
      ) : null}

      {applyModalOpen && productPickerOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Select Products</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Filter by category, then select multiple products to add opening stock rows.</p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={() => setProductPickerOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="grid gap-2 border-b border-slate-200 px-4 py-3 md:grid-cols-12 dark:border-slate-700">
              <label className="text-xs md:col-span-5">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Category</span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProductPickerCategory(event.target.value)}
                  value={productPickerCategory}
                >
                  {productCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category === 'ALL' ? 'All Categories' : category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs md:col-span-7">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Search</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProductPickerSearch(event.target.value)}
                  placeholder="Search name, item code, category..."
                  value={productPickerSearch}
                />
              </label>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-3">
              {productPickerRows.length === 0 ? (
                <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No products found for current filters.
                </p>
              ) : (
                <div className="space-y-2">
                  {productPickerRows.map((product) => {
                    const checked = productPickerSelected.includes(product.id);
                    const category = String(product.category ?? '').trim() || 'Uncategorized';
                    return (
                      <label
                        className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 ${
                          checked
                            ? 'border-brandPrimary bg-brandPrimary/10'
                            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                        }`}
                        key={product.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{product.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {product.sku} | {category} | {product.isLpg ? 'LPG' : 'Non-LPG'}
                          </p>
                        </div>
                        <input
                          checked={checked}
                          className="mt-1 h-4 w-4"
                          onChange={() => toggleProductPickerItem(product.id)}
                          type="checkbox"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Selected: <span className="font-semibold">{productPickerSelected.length}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setProductPickerOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
                  onClick={addSelectedProductsToLines}
                  type="button"
                >
                  Add Selected
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Current Balance Snapshot</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            As of {new Date(snapshot.asOf).toLocaleString()}
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-2 py-2">Location</th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">FULL</th>
                <th className="px-2 py-2">EMPTY</th>
                <th className="px-2 py-2">Qty On Hand</th>
                <th className="px-2 py-2">Avg Cost</th>
                <th className="px-2 py-2">Inventory Value</th>
                <th className="px-2 py-2">Opening</th>
                <th className="px-2 py-2">Txn Movement</th>
                <th className="px-2 py-2">Last Movement</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => (
                <tr className="border-b border-slate-100 dark:border-slate-800" key={`${row.locationId}-${row.productId}`}>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                    {row.locationName} ({row.locationCode})
                  </td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                    {row.productName} ({row.productSku})
                  </td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{qty(row.qtyFull)}</td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{qty(row.qtyEmpty)}</td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{qty(row.qtyOnHand)}</td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{money(row.avgCost)}</td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{money(row.inventoryValue)}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        row.hasOpeningEntry
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {row.hasOpeningEntry ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        row.hasTransactionalMovements
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}
                    >
                      {row.hasTransactionalMovements ? 'Locked' : 'Open'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                    {row.lastMovementAt ? new Date(row.lastMovementAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
              {snapshot.rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={10}>
                    No inventory balances yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
