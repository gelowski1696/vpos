'use client';

import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EntityManager } from '../../../components/entity-manager';
import {
  MasterDataImportWizard,
  type ImportColumn
} from '../../../components/master-data-import-wizard';
import { apiRequest } from '../../../lib/api-client';

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  cylinderTypeId: string | null;
  standardCost: number | null;
  lowStockAlertQty: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type CylinderTypeRecord = {
  id: string;
  code: string;
  name: string;
  sizeKg: number;
  depositAmount?: number;
};

type PriceRuleRecord = {
  id: string;
  productId: string;
  flowMode?: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number;
  priority: number;
};

type PriceListRecord = {
  id: string;
  code: string;
  name: string;
  scope: 'GLOBAL' | 'BRANCH' | 'TIER' | 'CUSTOMER_GROUP' | 'CONTRACT';
  branchId: string | null;
  customerTier: string | null;
  customerCategoryId?: string | null;
  customerId: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  rules: PriceRuleRecord[];
};

type LinkedPriceRow = {
  listName: string;
  listCode: string;
  scope: PriceListRecord['scope'];
  branchId: string | null;
  customerTier: string | null;
  customerCategoryId?: string | null;
  customerId: string | null;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
};

type BranchRecord = {
  id: string;
  code: string;
  name: string;
};

type CustomerRecord = {
  id: string;
  code: string;
  name: string;
};

type ProductCategoryRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type ProductBrandRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type ProductCostLocationRecord = {
  locationId: string;
  locationCode: string;
  locationName: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  inventoryValue: number;
  lastMovementType: string | null;
  lastMovementAt: string | null;
  lastUnitCost: number | null;
};

type ProductCostSnapshotRecord = {
  productId: string;
  valuationMethod: 'WAC';
  currency: 'PHP';
  asOf: string;
  totals: {
    qtyOnHand: number;
    inventoryValue: number;
    weightedAvgCost: number;
  };
  locations: ProductCostLocationRecord[];
};

type InventoryMovementRow = {
  id: string;
  created_at: string;
  movement_type: string;
  reference_type: string;
  reference_id: string;
  location_name: string;
  qty_delta: number;
  qty_full_delta: number;
  qty_empty_delta: number;
  qty_after: number;
  qty_after_known?: boolean;
  qty_full_after: number;
  qty_full_after_known?: boolean;
  qty_empty_after: number;
  qty_empty_after_known?: boolean;
};

type PriceCostAuditRow = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  oldPrice: number | null;
  newPrice: number | null;
  oldCost: number | null;
  newCost: number | null;
  contextType: string;
  contextId: string | null;
  changeReason: string | null;
  changedByUserId: string | null;
  changedByRole: string | null;
  sourceChannel: string | null;
  requestId: string | null;
  createdAt: string;
};

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'N/A';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function toDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function flowModeLabel(value: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL'): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
}

export default function ProductsPage(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [reloadSignal, setReloadSignal] = useState(0);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [cylinderTypes, setCylinderTypes] = useState<CylinderTypeRecord[]>([]);
  const [priceLists, setPriceLists] = useState<PriceListRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategoryRecord[]>([]);
  const [productBrands, setProductBrands] = useState<ProductBrandRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [viewProductId, setViewProductId] = useState<string | null>(null);
  const [costSnapshot, setCostSnapshot] = useState<ProductCostSnapshotRecord | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);
  const [movementRows, setMovementRows] = useState<InventoryMovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [priceCostAuditRows, setPriceCostAuditRows] = useState<PriceCostAuditRow[]>([]);
  const [priceCostAuditLoading, setPriceCostAuditLoading] = useState(false);
  const [priceCostAuditError, setPriceCostAuditError] = useState<string | null>(null);
  const [movementFromDate, setMovementFromDate] = useState(() => toDateInput(new Date()));
  const [movementToDate, setMovementToDate] = useState(() => toDateInput(new Date()));
  const [itemHistoryOpen, setItemHistoryOpen] = useState(false);
  const [handledSearchProductId, setHandledSearchProductId] = useState<string | null>(null);

  async function loadDetailData(): Promise<void> {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [
        productResult,
        cylinderResult,
        priceListResult,
        branchResult,
        customerResult,
        productCategoryResult,
        productBrandResult
      ] =
        await Promise.allSettled([
          apiRequest<ProductRecord[]>('/master-data/products'),
          apiRequest<CylinderTypeRecord[]>('/master-data/cylinder-types'),
          apiRequest<PriceListRecord[]>('/master-data/price-lists'),
          apiRequest<BranchRecord[]>('/master-data/branches'),
          apiRequest<CustomerRecord[]>('/master-data/customers'),
          apiRequest<ProductCategoryRecord[]>('/master-data/product-categories'),
          apiRequest<ProductBrandRecord[]>('/master-data/product-brands')
        ]);

      if (productResult.status === 'rejected') {
        throw productResult.reason;
      }
      if (cylinderResult.status === 'rejected') {
        throw cylinderResult.reason;
      }
      if (priceListResult.status === 'rejected') {
        throw priceListResult.reason;
      }

      setProducts(productResult.value);
      setCylinderTypes(cylinderResult.value);
      setPriceLists(priceListResult.value);
      setBranches(branchResult.status === 'fulfilled' ? branchResult.value : []);
      setCustomers(customerResult.status === 'fulfilled' ? customerResult.value : []);
      setProductCategories(
        productCategoryResult.status === 'fulfilled' ? productCategoryResult.value : []
      );
      setProductBrands(productBrandResult.status === 'fulfilled' ? productBrandResult.value : []);
    } catch (error) {
      setProducts([]);
      setCylinderTypes([]);
      setPriceLists([]);
      setBranches([]);
      setCustomers([]);
      setProductCategories([]);
      setProductBrands([]);
      setDetailError(error instanceof Error ? error.message : 'Failed to load product details');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadDetailData();
  }, []);

  useEffect(() => {
    const productId = searchParams.get('product_id')?.trim();
    if (!productId || detailLoading) {
      setHandledSearchProductId(null);
      return;
    }
    if (handledSearchProductId === productId) {
      return;
    }
    if (!products.some((row) => row.id === productId)) {
      return;
    }
    setHandledSearchProductId(productId);
    setViewProductId(productId);
    setItemHistoryOpen(false);
    setCostSnapshot(null);
    setCostError(null);
    void loadCostSnapshot(productId);
    void loadMovementHistory(productId);
    void loadPriceCostAudit(productId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('product_id');
    const nextQuery = params.toString();
    router.replace((nextQuery ? `${pathname}?${nextQuery}` : pathname) as Route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailLoading, handledSearchProductId, pathname, products, router, searchParams]);

  async function loadCostSnapshot(productId: string): Promise<void> {
    setCostLoading(true);
    setCostError(null);
    try {
      const snapshot = await apiRequest<ProductCostSnapshotRecord>(
        `/master-data/products/${productId}/cost-snapshot`
      );
      setCostSnapshot(snapshot);
    } catch (error) {
      setCostSnapshot(null);
      setCostError(
        error instanceof Error ? error.message : 'Failed to load product cost snapshot'
      );
    } finally {
      setCostLoading(false);
    }
  }

  async function loadMovementHistory(productId: string): Promise<void> {
    setMovementLoading(true);
    setMovementError(null);
    try {
      if (movementFromDate && movementToDate && movementFromDate > movementToDate) {
        throw new Error('From date must be earlier than or equal to To date.');
      }
      const params = new URLSearchParams();
      params.set('product_id', productId);
      params.set('limit', '180');
      if (movementFromDate) {
        params.set('since', movementFromDate);
      }
      if (movementToDate) {
        params.set('until', movementToDate);
      }
      const payload = await apiRequest<{ rows?: InventoryMovementRow[] }>(
        `/reports/inventory/movements?${params.toString()}`
      );
      setMovementRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (error) {
      setMovementRows([]);
      setMovementError(
        error instanceof Error ? error.message : 'Failed to load product movement history'
      );
    } finally {
      setMovementLoading(false);
    }
  }

  async function loadPriceCostAudit(productId: string): Promise<void> {
    setPriceCostAuditLoading(true);
    setPriceCostAuditError(null);
    try {
      const payload = await apiRequest<PriceCostAuditRow[]>(
        `/master-data/products/${productId}/price-cost-audit?limit=180`
      );
      setPriceCostAuditRows(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setPriceCostAuditRows([]);
      setPriceCostAuditError(
        error instanceof Error ? error.message : 'Failed to load price/cost audit history'
      );
    } finally {
      setPriceCostAuditLoading(false);
    }
  }

  useEffect(() => {
    if (!viewProductId) {
      return;
    }
    void loadMovementHistory(viewProductId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewProductId, movementFromDate, movementToDate]);

  const cylinderTypeOptions = useMemo(
    () => [
      { value: '', label: 'None (non-cylinder product)' },
      ...cylinderTypes.map((row) => ({
        value: row.id,
        label: `${row.name} (${row.code}) - ${row.sizeKg}kg`
      }))
    ],
    [cylinderTypes]
  );

  const cylinderTypeLabelById = useMemo(
    () =>
      new Map(cylinderTypes.map((row) => [row.id, `${row.name} (${row.code}) - ${row.sizeKg}kg`])),
    [cylinderTypes]
  );

  const cylinderTypeById = useMemo(
    () => new Map(cylinderTypes.map((row) => [row.id, row])),
    [cylinderTypes]
  );
  const categoryOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of productCategories) {
      if (!row.isActive) {
        continue;
      }
      values.set(row.name, `${row.name} (${row.code})`);
    }
    for (const row of products) {
      if (!row.category || values.has(row.category)) {
        continue;
      }
      values.set(row.category, `${row.category} (Legacy)`);
    }
    return [
      { value: '', label: 'None' },
      ...Array.from(values.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [productCategories, products]);
  const brandOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of productBrands) {
      if (!row.isActive) {
        continue;
      }
      values.set(row.name, `${row.name} (${row.code})`);
    }
    for (const row of products) {
      if (!row.brand || values.has(row.brand)) {
        continue;
      }
      values.set(row.brand, `${row.brand} (Legacy)`);
    }
    return [
      { value: '', label: 'None' },
      ...Array.from(values.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [productBrands, products]);
  const branchLabelById = useMemo(
    () => new Map(branches.map((row) => [row.id, `${row.name} (${row.code})`])),
    [branches]
  );
  const customerLabelById = useMemo(
    () => new Map(customers.map((row) => [row.id, `${row.name} (${row.code})`])),
    [customers]
  );

  const selectedProduct = useMemo(
    () => products.find((row) => row.id === viewProductId) ?? null,
    [products, viewProductId]
  );

  const linkedPrices = useMemo<LinkedPriceRow[]>(() => {
    if (!selectedProduct) {
      return [];
    }
    const rows: LinkedPriceRow[] = [];
    const seen = new Set<string>();
    for (const list of priceLists) {
      for (const rule of list.rules ?? []) {
        if (rule.productId !== selectedProduct.id) {
          continue;
        }
        const flowMode = rule.flowMode ?? 'ANY';
        const signature = `${list.code}|${rule.productId}|${flowMode}|${rule.unitPrice}|${rule.discountCapPct}|${rule.priority}|${list.startsAt}|${list.endsAt ?? ''}`;
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        rows.push({
          listName: list.name,
          listCode: list.code,
          scope: list.scope,
          branchId: list.branchId,
          customerTier: list.customerTier,
          customerCategoryId: list.customerCategoryId,
          customerId: list.customerId,
          flowMode,
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: rule.priority,
          startsAt: list.startsAt,
          endsAt: list.endsAt,
          isActive: list.isActive
        });
      }
    }
    return rows.sort((a, b) => a.priority - b.priority || a.listName.localeCompare(b.listName));
  }, [priceLists, selectedProduct]);

  const selectedCylinder = useMemo(() => {
    if (!selectedProduct?.cylinderTypeId) {
      return null;
    }
    return cylinderTypeById.get(selectedProduct.cylinderTypeId) ?? null;
  }, [cylinderTypeById, selectedProduct]);

  const productAttributeRows = useMemo(() => {
    if (!selectedProduct) {
      return [];
    }
    const preferredOrder = [
      'id',
      'sku',
      'name',
      'category',
      'brand',
      'unit',
      'isLpg',
      'cylinderTypeId',
      'lowStockAlertQty',
      'isActive',
      'createdAt',
      'updatedAt'
    ];
    const rows: Array<{ key: string; label: string; value: string }> = [];
    const remaining = new Set(Object.keys(selectedProduct));

    for (const key of preferredOrder) {
      if (!remaining.has(key)) {
        continue;
      }
      remaining.delete(key);
      rows.push({
        key,
        label:
          key === 'sku'
              ? 'Item Code'
              : key === 'category'
                ? 'Category'
                : key === 'brand'
                  ? 'Brand'
              : key === 'isLpg'
              ? 'LPG'
              : key === 'isActive'
                ? 'Active'
                : key === 'cylinderTypeId'
                  ? 'Cylinder Type'
                  : key === 'lowStockAlertQty'
                    ? 'Low Stock Alert Qty'
                  : key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase()),
        value:
          key === 'isLpg' || key === 'isActive'
            ? yesNo((selectedProduct as Record<string, unknown>)[key])
            : key === 'createdAt' || key === 'updatedAt'
              ? formatDate((selectedProduct as Record<string, unknown>)[key] as string)
              : key === 'cylinderTypeId'
                ? selectedProduct.cylinderTypeId
                  ? cylinderTypeLabelById.get(selectedProduct.cylinderTypeId) ??
                    selectedProduct.cylinderTypeId
                  : 'None'
                : key === 'lowStockAlertQty'
                  ? selectedProduct.lowStockAlertQty === null
                    ? 'N/A'
                    : formatQty(selectedProduct.lowStockAlertQty)
                : String((selectedProduct as Record<string, unknown>)[key] ?? '')
      });
    }

    for (const key of Array.from(remaining).sort((a, b) => a.localeCompare(b))) {
      rows.push({
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase()),
        value: String((selectedProduct as Record<string, unknown>)[key] ?? '')
      });
    }

    return rows;
  }, [cylinderTypeLabelById, selectedProduct]);

  function scopeTarget(row: LinkedPriceRow): string {
    if (row.scope === 'GLOBAL') {
      return 'All branches and customers';
    }
    if (row.scope === 'BRANCH') {
      return row.branchId
        ? `Branch: ${branchLabelById.get(row.branchId) ?? row.branchId}`
        : 'Branch: N/A';
    }
    if (row.scope === 'TIER') {
      return `Tier: ${row.customerTier ?? 'N/A'}`;
    }
    if (row.scope === 'CUSTOMER_GROUP') {
      return `Customer Category: ${row.customerCategoryId ?? 'N/A'}`;
    }
    return row.customerId
      ? `Customer: ${customerLabelById.get(row.customerId) ?? row.customerId}`
      : 'Customer: N/A';
  }

  function formatMoney(value: number): string {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatQty(value: number): string {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4
    });
  }

  const importColumns = useMemo<ImportColumn[]>(() => {
    const categoryTemplateValues = productCategories
      .filter((row) => row.isActive)
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b));
    const brandTemplateValues = productBrands
      .filter((row) => row.isActive)
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b));
    const cylinderTypeCodeTemplateValues = cylinderTypes
      .map((row) => row.code)
      .filter((value) => value?.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
    const unitTemplateValues = ['unit', 'cylinder', 'kg', 'liter'];
    const boolTemplateValues = ['true', 'false'];

    return [
      {
        key: 'sku',
        label: 'Item Code',
        required: true,
        example: 'LPG-11-REFILL',
        aliases: ['itemcode', 'item_code']
      },
      { key: 'name', label: 'Name', required: true, example: 'LPG Refill 11kg' },
      {
        key: 'category',
        label: 'Category',
        example: categoryTemplateValues[0] ?? 'LPG Refill',
        templateDropdownValues: categoryTemplateValues
      },
      {
        key: 'brand',
        label: 'Brand',
        example: brandTemplateValues[0] ?? 'VMJAM',
        templateDropdownValues: brandTemplateValues
      },
      {
        key: 'unit',
        label: 'Unit',
        example: 'unit',
        templateDropdownValues: unitTemplateValues
      },
      {
        key: 'isLpg',
        label: 'LPG',
        example: true,
        aliases: ['is_lpg'],
        templateDropdownValues: boolTemplateValues
      },
      {
        key: 'cylinderTypeCode',
        label: 'Cylinder Type Code',
        example: 'CYL-11',
        aliases: ['cylinder_type_code', 'cylindertypeid', 'cylinder_type_id'],
        templateDropdownValues: cylinderTypeCodeTemplateValues
      },
      {
        key: 'lowStockAlertQty',
        label: 'Low Stock Alert Qty',
        example: 5,
        aliases: ['low_stock_alert_qty']
      },
      {
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: boolTemplateValues
      }
    ];
  }, [cylinderTypes, productBrands, productCategories]);

  return (
    <div className="space-y-5">
      <EntityManager
        defaultValues={{
          sku: '',
          name: '',
          category: '',
          brand: '',
          unit: 'unit',
          isLpg: true,
          cylinderTypeId: '',
          lowStockAlertQty: '',
          isActive: true
        }}
        endpoint="/master-data/products"
        reloadSignal={reloadSignal}
        toolbarActions={
          <MasterDataImportWizard
            title="Products"
            entity="products"
            endpointBase="/master-data/import/products"
            columns={importColumns}
            onImported={async () => {
              setReloadSignal((current) => current + 1);
              await loadDetailData();
            }}
          />
        }
        fields={[
          {
            key: 'sku',
            label: 'Item Code',
            required: true,
            helperText: 'Unique code used to identify the product in POS and inventory.'
          },
          { key: 'name', label: 'Name', required: true },
          {
            key: 'category',
            label: 'Category',
            type: 'select',
            options: categoryOptions,
            helperText: 'Optional grouping managed from Product Categories master data.'
          },
          {
            key: 'brand',
            label: 'Brand',
            type: 'select',
            options: brandOptions,
            helperText: 'Optional brand managed from Product Brands master data.'
          },
          {
            key: 'unit',
            label: 'Unit of Measure',
            type: 'select',
            required: true,
            options: [
              { value: 'unit', label: 'Piece / Unit' },
              { value: 'cylinder', label: 'Cylinder' },
              { value: 'kg', label: 'Kilogram (kg)' },
              { value: 'liter', label: 'Liter (L)' }
            ],
            helperText: 'How this product quantity is counted in POS and inventory.'
          },
          { key: 'isLpg', label: 'LPG', type: 'boolean' },
          {
            key: 'cylinderTypeId',
            label: 'Cylinder Type',
            type: 'select',
            options: cylinderTypeOptions,
            helperText:
              'Pick a cylinder type for LPG products. Leave as None for non-cylinder products.'
          },
          {
            key: 'lowStockAlertQty',
            label: 'Low Stock Alert Qty',
            type: 'number',
            helperText:
              'Set per product. LPG products use FULL qty for low-stock alerts; non-LPG products use Qty On Hand.'
          },
          { key: 'isActive', label: 'Active', type: 'boolean' }
        ]}
        rowActions={[
          {
            key: 'view',
            label: 'View',
            onClick: (row) => {
              const productId = String(row.id);
              setViewProductId(productId);
              setItemHistoryOpen(false);
              setCostSnapshot(null);
              setCostError(null);
              setMovementRows([]);
              setMovementError(null);
              setPriceCostAuditRows([]);
              setPriceCostAuditError(null);
              void loadDetailData();
              void loadCostSnapshot(productId);
              void loadMovementHistory(productId);
              void loadPriceCostAudit(productId);
            },
            buttonClassName:
              'rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40',
            showWhenReadOnly: true
          }
        ]}
        transformBeforeSubmit={(payload) => ({
          ...payload,
          category: payload.category ? String(payload.category).trim() : null,
          brand: payload.brand ? String(payload.brand).trim() : null,
          cylinderTypeId: payload.cylinderTypeId ? payload.cylinderTypeId : null,
          lowStockAlertQty:
            payload.lowStockAlertQty === '' || payload.lowStockAlertQty === null
              ? null
              : Number(payload.lowStockAlertQty)
        })}
        tableColumnOverrides={{
          sku: { label: 'Item Code' },
          category: {
            label: 'Category',
            render: (value) => (value ? String(value) : 'N/A')
          },
          brand: {
            label: 'Brand',
            render: (value) => (value ? String(value) : 'N/A')
          },
          isLpg: {
            label: 'LPG',
            render: (value) => yesNo(value)
          },
          isActive: {
            label: 'Active',
            render: (value) => yesNo(value)
          },
          cylinderTypeId: {
            label: 'Cylinder Type',
            render: (value) => {
              const key = value ? String(value) : '';
              return key ? cylinderTypeLabelById.get(key) ?? key : 'None';
            }
          },
          lowStockAlertQty: {
            label: 'Low Stock Alert Qty',
            render: (value) => {
              if (value === null || value === undefined || value === '') {
                return 'N/A';
              }
              const parsed = Number(value);
              return Number.isFinite(parsed) ? formatQty(parsed) : String(value);
            }
          }
        }}
        allowDelete
        title="Products"
      />

      {viewProductId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Product Details
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProduct
                    ? `${selectedProduct.name} (${selectedProduct.sku})`
                    : 'Loading selected product...'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setItemHistoryOpen(true)}
                  type="button"
                >
                  Item History
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => {
                    void loadDetailData();
                    if (viewProductId) {
                      void loadCostSnapshot(viewProductId);
                      void loadMovementHistory(viewProductId);
                      void loadPriceCostAudit(viewProductId);
                    }
                  }}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => {
                    setViewProductId(null);
                    setItemHistoryOpen(false);
                    setCostSnapshot(null);
                    setCostError(null);
                    setPriceCostAuditRows([]);
                    setPriceCostAuditError(null);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="overflow-auto p-4">
              {detailLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading product details...</p>
              ) : detailError ? (
                <p className="text-sm text-rose-700">{detailError}</p>
              ) : !selectedProduct ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Product not found. It may have been removed.
                </p>
              ) : (
                <div className="space-y-4">
                  <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Attributes
                    </h3>
                    <div className="grid gap-2 text-sm md:grid-cols-2">
                      {productAttributeRows.map((row) => (
                        <p key={row.key} className={row.key === 'cylinderTypeId' ? 'md:col-span-2' : ''}>
                          <span className="font-medium text-slate-500 dark:text-slate-400">
                            {row.label}:
                          </span>{' '}
                          {row.value}
                        </p>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Linked Cylinder Type
                    </h3>
                    {!selectedCylinder ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No cylinder type linked.
                      </p>
                    ) : (
                      <div className="grid gap-2 text-sm md:grid-cols-2">
                        <p>
                          <span className="font-medium text-slate-500 dark:text-slate-400">Code:</span>{' '}
                          {selectedCylinder.code}
                        </p>
                        <p>
                          <span className="font-medium text-slate-500 dark:text-slate-400">Name:</span>{' '}
                          {selectedCylinder.name}
                        </p>
                        <p>
                          <span className="font-medium text-slate-500 dark:text-slate-400">Size:</span>{' '}
                          {selectedCylinder.sizeKg} kg
                        </p>
                        <p className="md:col-span-2">
                          <span className="font-medium text-slate-500 dark:text-slate-400">
                            Deposit Amount:
                          </span>{' '}
                          {selectedCylinder.depositAmount === undefined
                            ? 'N/A'
                            : selectedCylinder.depositAmount.toFixed(2)}
                        </p>
                      </div>
                    )}
                  </article>

                  <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Cost Snapshot (WAC)
                    </h3>
                    {costLoading ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Loading cost snapshot...
                      </p>
                    ) : costError ? (
                      <p className="text-sm text-rose-700">{costError}</p>
                    ) : !costSnapshot ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No cost snapshot loaded.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid gap-2 text-sm md:grid-cols-2">
                          <p>
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              Method:
                            </span>{' '}
                            {costSnapshot.valuationMethod}
                          </p>
                          <p>
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              As Of:
                            </span>{' '}
                            {formatDate(costSnapshot.asOf)}
                          </p>
                          <p>
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              Total Qty On Hand:
                            </span>{' '}
                            {formatQty(costSnapshot.totals.qtyOnHand)}
                          </p>
                          <p>
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              Weighted Avg Cost:
                            </span>{' '}
                            {formatMoney(costSnapshot.totals.weightedAvgCost)}
                          </p>
                          <p className="md:col-span-2">
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              Total Inventory Value:
                            </span>{' '}
                            {costSnapshot.currency} {formatMoney(costSnapshot.totals.inventoryValue)}
                          </p>
                        </div>

                        {costSnapshot.locations.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            No inventory balances yet for this product.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                  <th className="px-2 py-2">Location</th>
                                  {selectedProduct?.isLpg ? (
                                    <>
                                      <th className="px-2 py-2">FULL</th>
                                      <th className="px-2 py-2">EMPTY</th>
                                    </>
                                  ) : (
                                    <th className="px-2 py-2">Qty On Hand</th>
                                  )}
                                  <th className="px-2 py-2">Avg Cost</th>
                                  <th className="px-2 py-2">Inventory Value</th>
                                  <th className="px-2 py-2">Last Movement</th>
                                  <th className="px-2 py-2">Last Unit Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {costSnapshot.locations.map((row) => (
                                  <tr
                                    className="border-b border-slate-100 dark:border-slate-800"
                                    key={`${row.locationId}-${row.lastMovementAt ?? 'na'}`}
                                  >
                                    <td className="px-2 py-2">
                                      <p className="font-medium text-slate-900 dark:text-slate-100">
                                        {row.locationName}
                                      </p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {row.locationCode}
                                      </p>
                                    </td>
                                    {selectedProduct?.isLpg ? (
                                      <>
                                        <td className="px-2 py-2">{formatQty(row.qtyFull)}</td>
                                        <td className="px-2 py-2">{formatQty(row.qtyEmpty)}</td>
                                      </>
                                    ) : (
                                      <td className="px-2 py-2">{formatQty(row.qtyOnHand)}</td>
                                    )}
                                    <td className="px-2 py-2">{formatMoney(row.avgCost)}</td>
                                    <td className="px-2 py-2">
                                      {costSnapshot.currency} {formatMoney(row.inventoryValue)}
                                    </td>
                                    <td className="px-2 py-2">
                                      <p>{row.lastMovementType ?? 'N/A'}</p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {formatDate(row.lastMovementAt)}
                                      </p>
                                    </td>
                                    <td className="px-2 py-2">
                                      {row.lastUnitCost === null
                                        ? 'N/A'
                                        : `${costSnapshot.currency} ${formatMoney(row.lastUnitCost)}`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </article>

                  <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Price/Cost Audit History
                    </h3>
                    {priceCostAuditLoading ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Loading price/cost audit history...
                      </p>
                    ) : priceCostAuditError ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {priceCostAuditError.toLowerCase().includes('add-on is not enabled')
                          ? 'Item Price/Cost Audit add-on is not enabled for this tenant.'
                          : priceCostAuditError}
                      </p>
                    ) : priceCostAuditRows.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No price/cost audit records yet for this item.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              <th className="px-2 py-2">Date</th>
                              <th className="px-2 py-2">Context</th>
                              <th className="px-2 py-2">Old Price</th>
                              <th className="px-2 py-2">New Price</th>
                              <th className="px-2 py-2">Old Cost</th>
                              <th className="px-2 py-2">New Cost</th>
                              <th className="px-2 py-2">Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {priceCostAuditRows.slice(0, 180).map((row) => (
                              <tr className="border-b border-slate-100 dark:border-slate-800" key={row.id}>
                                <td className="px-2 py-2">{formatDate(row.createdAt)}</td>
                                <td className="px-2 py-2">
                                  <p>{row.contextType}</p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {row.contextId ?? 'N/A'}
                                  </p>
                                </td>
                                <td className="px-2 py-2">{row.oldPrice === null ? '-' : formatMoney(row.oldPrice)}</td>
                                <td className="px-2 py-2">{row.newPrice === null ? '-' : formatMoney(row.newPrice)}</td>
                                <td className="px-2 py-2">{row.oldCost === null ? '-' : formatQty(row.oldCost)}</td>
                                <td className="px-2 py-2">{row.newCost === null ? '-' : formatQty(row.newCost)}</td>
                                <td className="px-2 py-2">{row.sourceChannel ?? 'N/A'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>

                  <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Linked Pricing Rules
                    </h3>
                    {linkedPrices.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No pricing rules linked to this product yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              <th className="px-2 py-2">Price List</th>
                              <th className="px-2 py-2">Scope</th>
                              <th className="px-2 py-2">Applies To</th>
                              <th className="px-2 py-2">Flow</th>
                              <th className="px-2 py-2">Unit Price</th>
                              <th className="px-2 py-2">Discount Cap</th>
                              <th className="px-2 py-2">Priority</th>
                              <th className="px-2 py-2">Effectivity</th>
                              <th className="px-2 py-2">Active</th>
                            </tr>
                          </thead>
                          <tbody>
                            {linkedPrices.map((row) => (
                              <tr
                                className="border-b border-slate-100 dark:border-slate-800"
                                key={`${row.listCode}-${row.priority}-${row.flowMode}-${row.unitPrice}`}
                              >
                                <td className="px-2 py-2">
                                  <p className="font-medium text-slate-900 dark:text-slate-100">
                                    {row.listName}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {row.listCode}
                                  </p>
                                </td>
                                <td className="px-2 py-2">{row.scope}</td>
                                <td className="px-2 py-2">{scopeTarget(row)}</td>
                                <td className="px-2 py-2">{flowModeLabel(row.flowMode)}</td>
                                <td className="px-2 py-2">{row.unitPrice.toFixed(2)}</td>
                                <td className="px-2 py-2">{row.discountCapPct}%</td>
                                <td className="px-2 py-2">{row.priority}</td>
                                <td className="px-2 py-2">
                                  <p>{formatDate(row.startsAt)}</p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    to {formatDate(row.endsAt)}
                                  </p>
                                </td>
                                <td className="px-2 py-2">{yesNo(row.isActive)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {viewProductId && selectedProduct && itemHistoryOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-4">
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Item Movement History
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProduct.name} ({selectedProduct.sku})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => void loadMovementHistory(viewProductId)}
                  type="button"
                  disabled={movementLoading}
                >
                  {movementLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setItemHistoryOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </header>
            <div className="overflow-auto p-4">
              <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>From</span>
                  <input
                    type="date"
                    value={movementFromDate}
                    onChange={(event) => setMovementFromDate(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>To</span>
                  <input
                    type="date"
                    value={movementToDate}
                    onChange={(event) => setMovementToDate(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => {
                      setMovementFromDate('');
                      setMovementToDate('');
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {movementLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Loading movement history...
                </p>
              ) : movementError ? (
                <p className="text-sm text-rose-700">{movementError}</p>
              ) : movementRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No movement records found for this item.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Movement</th>
                        <th className="px-2 py-2">Location</th>
                        <th className="px-2 py-2">Qty</th>
                        <th className="px-2 py-2">FULL</th>
                        <th className="px-2 py-2">EMPTY</th>
                        <th className="px-2 py-2">Qty After</th>
                        <th className="px-2 py-2">FULL After</th>
                        <th className="px-2 py-2">EMPTY After</th>
                        <th className="px-2 py-2">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementRows.slice(0, 120).map((row) => (
                        <tr
                          className="border-b border-slate-100 dark:border-slate-800"
                          key={row.id}
                        >
                          <td className="px-2 py-2">{formatDate(row.created_at)}</td>
                          <td className="px-2 py-2">{row.movement_type}</td>
                          <td className="px-2 py-2">{row.location_name}</td>
                          <td className="px-2 py-2">{formatQty(row.qty_delta)}</td>
                          <td className="px-2 py-2">{formatQty(row.qty_full_delta)}</td>
                          <td className="px-2 py-2">{formatQty(row.qty_empty_delta)}</td>
                          <td className="px-2 py-2">
                            {row.qty_after_known === false ? '-' : formatQty(row.qty_after)}
                          </td>
                          <td className="px-2 py-2">
                            {row.qty_full_after_known === false ? '-' : formatQty(row.qty_full_after)}
                          </td>
                          <td className="px-2 py-2">
                            {row.qty_empty_after_known === false ? '-' : formatQty(row.qty_empty_after)}
                          </td>
                          <td className="px-2 py-2">
                            {row.reference_type}:{row.reference_id}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
