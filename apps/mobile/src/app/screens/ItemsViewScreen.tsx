import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
};

type MasterDataRow = {
  entity: string;
  record_id: string;
  payload: string;
  updated_at: string;
};

type ProductRecord = {
  id: string;
  itemCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  isActive: boolean;
  cylinderTypeId: string | null;
  lowStockAlertQty: number | null;
  updatedAt: string;
};

type ProductStockMetrics = {
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number | null;
  source: 'LPG_INVENTORY' | 'LPG_CYLINDER' | 'INVENTORY' | 'UNAVAILABLE';
};

type CylinderTypeRecord = {
  id: string;
  code: string;
  name: string;
  sizeKg: number | null;
  depositAmount: number | null;
  isActive: boolean;
};

type PriceListRecord = {
  id: string;
  name: string;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  customerTier: string | null;
  customerId: string | null;
  branchId: string | null;
  rules: Array<{
    productId: string;
    flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
    unitPrice: number;
    discountCapPct: number | null;
    priority: number | null;
  }>;
};

type ProductPriceRule = {
  priceListId: string;
  priceListName: string;
  scope: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number | null;
  priority: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  appliesTo: string;
};

function flowLabel(value: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL'): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
}

type CylinderCountRow = {
  cylinder_type_code: string;
  status: string;
  qty: number;
};

type InventoryBalanceRow = {
  productId: string;
  locationId: string | null;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function fmtMoney(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return `PHP ${Number(value).toFixed(2)}`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function parseId(payload: Record<string, unknown>, fallback: string): string {
  return (
    asString(payload.id) ||
    asString(payload.product_id) ||
    asString(payload.code) ||
    fallback
  );
}

function parseProduct(row: MasterDataRow): ProductRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const itemCode =
    asString(payload.itemCode) ||
    asString(payload.item_code) ||
    asString(payload.sku) ||
    asString(payload.code) ||
    id;
  const name = asString(payload.name) || asString(payload.display_name) || itemCode;
  const category = asString(payload.category) || asString(payload.category_code) || null;
  const brand = asString(payload.brand) || null;
  const unit = asString(payload.unit) || 'unit';
  const isLpg = asBoolean(payload.isLpg ?? payload.is_lpg, false);
  const isActive = asBoolean(payload.isActive ?? payload.is_active, true);
  const cylinderTypeId =
    asString(payload.cylinderTypeId ?? payload.cylinder_type_id) || null;
  const lowStockAlertQty = asNumber(
    payload.lowStockAlertQty ?? payload.low_stock_alert_qty ?? payload.lowStockQty ?? payload.low_stock_qty
  );
  return {
    id,
    itemCode,
    name,
    category,
    brand,
    unit,
    isLpg,
    isActive,
    cylinderTypeId,
    lowStockAlertQty,
    updatedAt: row.updated_at
  };
}

function parseCylinderType(row: MasterDataRow): CylinderTypeRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const code = asString(payload.code) || id;
  const name = asString(payload.name) || code;
  const sizeKg = asNumber(payload.sizeKg ?? payload.size_kg);
  const depositAmount = asNumber(payload.depositAmount ?? payload.deposit_amount);
  const isActive = asBoolean(payload.isActive ?? payload.is_active, true);
  return {
    id,
    code,
    name,
    sizeKg,
    depositAmount,
    isActive
  };
}

function parsePriceList(row: MasterDataRow): PriceListRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const rawRules = Array.isArray(payload.rules) ? payload.rules : [];
  const rules: PriceListRecord['rules'] = [];
  for (const ruleValue of rawRules) {
    if (!ruleValue || typeof ruleValue !== 'object') {
      continue;
    }
    const rule = ruleValue as Record<string, unknown>;
    const productId = asString(rule.productId ?? rule.product_id);
    const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
    if (!productId || unitPrice === null) {
      continue;
    }
    const rawFlow = asString(rule.flowMode ?? rule.flow_mode).toUpperCase();
    const flowMode: PriceListRecord['rules'][number]['flowMode'] =
      rawFlow === 'REFILL_EXCHANGE' || rawFlow === 'NON_REFILL' ? rawFlow : 'ANY';
    rules.push({
      productId,
      flowMode,
      unitPrice,
      discountCapPct: asNumber(rule.discountCapPct ?? rule.discount_cap_pct),
      priority: asNumber(rule.priority)
    });
  }

  return {
    id,
    name: asString(payload.name) || id,
    scope: (asString(payload.scope) || 'GLOBAL').toUpperCase(),
    startsAt: asString(payload.startsAt ?? payload.starts_at) || null,
    endsAt: asString(payload.endsAt ?? payload.ends_at) || null,
    isActive: asBoolean(payload.isActive ?? payload.is_active, true),
    customerTier: asString(payload.customerTier ?? payload.customer_tier) || null,
    customerId: asString(payload.customerId ?? payload.customer_id) || null,
    branchId: asString(payload.branchId ?? payload.branch_id) || null,
    rules
  };
}

function parseInventoryBalanceRow(row: MasterDataRow): InventoryBalanceRow | null {
  const payload = parsePayload(row.payload);
  const productId = asString(payload.productId ?? payload.product_id);
  if (!productId) {
    return null;
  }
  const locationId = asString(payload.locationId ?? payload.location_id) || null;
  const qtyOnHand = asNumber(payload.qtyOnHand ?? payload.qty_on_hand);
  if (qtyOnHand === null) {
    return null;
  }
  const qtyFull = asNumber(payload.qtyFull ?? payload.qty_full) ?? 0;
  const qtyEmpty = asNumber(payload.qtyEmpty ?? payload.qty_empty) ?? 0;
  return {
    productId,
    locationId,
    qtyOnHand,
    qtyFull,
    qtyEmpty
  };
}

function formatQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function getEntityRows(
  db: SQLiteDatabase,
  aliases: string[]
): Promise<MasterDataRow[]> {
  if (!aliases.length) {
    return Promise.resolve([]);
  }
  const normalized = aliases.map((alias) => alias.toLowerCase());
  const placeholders = normalized.map(() => '?').join(', ');
  return db.getAllAsync<MasterDataRow>(
    `
    SELECT entity, record_id, payload, updated_at
    FROM master_data_local
    WHERE lower(entity) IN (${placeholders})
    ORDER BY updated_at DESC
    `,
    ...normalized
  );
}

function describePriceScope(list: PriceListRecord): string {
  if (list.scope === 'CONTRACT') {
    return list.customerId ? `Customer: ${list.customerId}` : 'Contract';
  }
  if (list.scope === 'TIER') {
    return list.customerTier ? `Tier: ${list.customerTier}` : 'Tier';
  }
  if (list.scope === 'BRANCH') {
    return list.branchId ? `Branch: ${list.branchId}` : 'Branch';
  }
  return 'Global';
}

export function ItemsViewScreen({ db, theme }: Props): JSX.Element {
  const tutorialSearch = useTutorialTarget('items-search');
  const tutorialFirstCard = useTutorialTarget('items-first-card');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ProductRecord[]>([]);
  const [cylinderMap, setCylinderMap] = useState<Record<string, CylinderTypeRecord>>({});
  const [priceLists, setPriceLists] = useState<PriceListRecord[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, ProductStockMetrics>>({});
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'LPG' | 'NON_LPG'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const selectedLocation = await db.getFirstAsync<{ selected_location_id: string | null }>(
        'SELECT selected_location_id FROM app_state WHERE id = 1'
      );
      const activeLocationId = selectedLocation?.selected_location_id ?? null;
      setSelectedLocationId(activeLocationId);

      const [productRows, cylinderRows, priceListRows, inventoryRows, cylinderCountRows] = await Promise.all([
        getEntityRows(db, ['product', 'products']),
        getEntityRows(db, ['cylinder_type', 'cylinder_types', 'cylinder-type', 'cylinder-types']),
        getEntityRows(db, ['price_list', 'price_lists', 'price-list', 'price-lists']),
        getEntityRows(db, ['inventory_balance', 'inventory_balances']),
        db.getAllAsync<CylinderCountRow>(
          `
          SELECT cylinder_type_code, status, COUNT(1) AS qty
          FROM cylinders_local
          WHERE (? IS NULL OR location_id = ?)
          GROUP BY cylinder_type_code, status
          `,
          activeLocationId,
          activeLocationId
        )
      ]);

      const productMap = new Map<string, ProductRecord>();
      for (const row of productRows) {
        const parsed = parseProduct(row);
        const existing = productMap.get(parsed.id);
        if (!existing || Date.parse(parsed.updatedAt) > Date.parse(existing.updatedAt)) {
          productMap.set(parsed.id, parsed);
        }
      }
      const nextProducts = [...productMap.values()].sort((a, b) => a.name.localeCompare(b.name));

      const nextCylinderMap: Record<string, CylinderTypeRecord> = {};
      for (const row of cylinderRows) {
        const parsed = parseCylinderType(row);
        nextCylinderMap[parsed.id] = parsed;
      }

      const priceListMap = new Map<string, PriceListRecord>();
      for (const row of priceListRows) {
        const parsed = parsePriceList(row);
        const existing = priceListMap.get(parsed.id);
        if (!existing || parsed.rules.length >= existing.rules.length) {
          priceListMap.set(parsed.id, parsed);
        }
      }
      const nextPriceLists = [...priceListMap.values()].sort((a, b) => a.name.localeCompare(b.name));

      const cylinderCountsByCode = new Map<string, { qtyFull: number; qtyEmpty: number }>();
      for (const row of cylinderCountRows) {
        const code = asString(row.cylinder_type_code).toUpperCase();
        if (!code) {
          continue;
        }
        const existing = cylinderCountsByCode.get(code) ?? { qtyFull: 0, qtyEmpty: 0 };
        const status = asString(row.status).toUpperCase();
        const qty = Number(row.qty ?? 0);
        if (status === 'FULL') {
          existing.qtyFull += qty;
        }
        if (status === 'EMPTY') {
          existing.qtyEmpty += qty;
        }
        cylinderCountsByCode.set(code, existing);
      }

      const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
      for (const row of inventoryRows) {
        const parsed = parseInventoryBalanceRow(row);
        if (!parsed) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        const existing = inventoryByProduct.get(parsed.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        existing.qtyOnHand += parsed.qtyOnHand;
        existing.qtyFull += parsed.qtyFull;
        existing.qtyEmpty += parsed.qtyEmpty;
        inventoryByProduct.set(parsed.productId, existing);
      }

      const nextStockByProduct: Record<string, ProductStockMetrics> = {};
      for (const product of nextProducts) {
        if (product.isLpg && product.cylinderTypeId) {
          const inventory = inventoryByProduct.get(product.id);
          if (inventory) {
            nextStockByProduct[product.id] = {
              qtyFull: inventory.qtyFull,
              qtyEmpty: inventory.qtyEmpty,
              qtyOnHand: inventory.qtyOnHand,
              source: 'LPG_INVENTORY'
            };
          } else {
            const typeCode = nextCylinderMap[product.cylinderTypeId]?.code?.toUpperCase() ?? '';
            const counted = typeCode ? cylinderCountsByCode.get(typeCode) : undefined;
            const qtyFull = counted?.qtyFull ?? 0;
            const qtyEmpty = counted?.qtyEmpty ?? 0;
            nextStockByProduct[product.id] = {
              qtyFull,
              qtyEmpty,
              qtyOnHand: qtyFull + qtyEmpty,
              source: 'LPG_CYLINDER'
            };
          }
          continue;
        }

        const qtyOnHand = inventoryByProduct.get(product.id)?.qtyOnHand;
        nextStockByProduct[product.id] = {
          qtyFull: 0,
          qtyEmpty: 0,
          qtyOnHand: qtyOnHand ?? null,
          source: qtyOnHand === undefined ? 'UNAVAILABLE' : 'INVENTORY'
        };
      }

      setRows(nextProducts);
      setCylinderMap(nextCylinderMap);
      setPriceLists(nextPriceLists);
      setStockByProduct(nextStockByProduct);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<void> => {
      await refresh();
      if (!mounted) {
        return;
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [db]);

  const categoryOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const value = row.category?.trim();
      if (!value) {
        continue;
      }
      set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo<ProductRecord[]>(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter === 'LPG' && !row.isLpg) {
        return false;
      }
      if (typeFilter === 'NON_LPG' && row.isLpg) {
        return false;
      }
      if (categoryFilter !== 'ALL' && (row.category?.trim() ?? '') !== categoryFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return `${row.name} ${row.itemCode} ${row.id} ${row.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, query, typeFilter, categoryFilter]);

  const summary = useMemo(() => {
    const active = rows.filter((row) => row.isActive).length;
    const lpg = rows.filter((row) => row.isLpg).length;
    return {
      total: rows.length,
      active,
      lpg
    };
  }, [rows]);

  const selectedItem = useMemo(
    () => (selectedItemId ? rows.find((row) => row.id === selectedItemId) ?? null : null),
    [rows, selectedItemId]
  );

  const selectedCylinder = useMemo(() => {
    if (!selectedItem?.cylinderTypeId) {
      return null;
    }
    return cylinderMap[selectedItem.cylinderTypeId] ?? null;
  }, [selectedItem, cylinderMap]);

  const selectedStock = useMemo<ProductStockMetrics>(() => {
    if (!selectedItem) {
      return { qtyFull: 0, qtyEmpty: 0, qtyOnHand: null, source: 'UNAVAILABLE' };
    }
    return stockByProduct[selectedItem.id] ?? {
      qtyFull: 0,
      qtyEmpty: 0,
      qtyOnHand: null,
      source: 'UNAVAILABLE'
    };
  }, [selectedItem, stockByProduct]);

  const selectedRules = useMemo<ProductPriceRule[]>(() => {
    if (!selectedItem) {
      return [];
    }
    const rules: ProductPriceRule[] = [];
    for (const list of priceLists) {
      for (const rule of list.rules) {
        if (rule.productId !== selectedItem.id) {
          continue;
        }
        rules.push({
          priceListId: list.id,
          priceListName: list.name,
          scope: list.scope,
          flowMode: rule.flowMode,
          unitPrice: rule.unitPrice,
          discountCapPct: rule.discountCapPct,
          priority: rule.priority,
          startsAt: list.startsAt,
          endsAt: list.endsAt,
          isActive: list.isActive,
          appliesTo: describePriceScope(list)
        });
      }
    }
    rules.sort((a, b) => {
      const pA = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 999;
      const pB = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 999;
      if (pA !== pB) {
        return pA - pB;
      }
      return a.priceListName.localeCompare(b.priceListName);
    });
    return rules;
  }, [selectedItem, priceLists]);

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[styles.title, { color: theme.heading }]}>Items</Text>
      <Text style={[styles.sub, { color: theme.subtext }]}>Read-only item catalog with stock snapshot, linked pricing, and cylinder details (without cost fields).</Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Total</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{summary.total}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Active</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{summary.active}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>LPG</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{summary.lpg}</Text>
        </View>
      </View>

      <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search item code or product name..."
          placeholderTextColor={theme.inputPlaceholder}
          style={[
            styles.input,
            { backgroundColor: theme.inputBg, color: theme.inputText },
            tutorialSearch.active ? styles.tutorialTargetFocus : null
          ]}
        />
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'LPG', 'NON_LPG'] as const).map((value) => {
          const selected = typeFilter === value;
          return (
            <Pressable
              key={value}
              onPress={() => setTypeFilter(value)}
              style={[styles.filterChip, { backgroundColor: selected ? theme.pillActive : theme.pillBg }]}
            >
              <Text style={[styles.filterChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}>{value === 'NON_LPG' ? 'NON-LPG' : value}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => void refresh()}
          style={[styles.refreshChip, { backgroundColor: loading ? theme.primaryMuted : theme.primary }]}
          disabled={loading}
        >
          <Text style={styles.refreshChipText}>{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        <Pressable
          onPress={() => setCategoryFilter('ALL')}
          style={[
            styles.categoryChip,
            { backgroundColor: categoryFilter === 'ALL' ? theme.primary : theme.pillBg }
          ]}
        >
          <Text style={[styles.categoryChipText, { color: categoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }]}>
            All Categories
          </Text>
        </Pressable>
        {categoryOptions.map((category) => {
          const selected = categoryFilter === category;
          return (
            <Pressable
              key={category}
              onPress={() => setCategoryFilter(category)}
              style={[
                styles.categoryChip,
                { backgroundColor: selected ? theme.primary : theme.pillBg }
              ]}
            >
              <Text style={[styles.categoryChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}>
                {category}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
        {loading ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>Loading items...</Text>
        ) : filtered.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No items found.</Text>
        ) : (
          filtered.map((row, index) => (
            <Pressable
              key={row.id}
              onPress={() => setSelectedItemId(row.id)}
              style={[
                styles.itemCard,
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
                tutorialFirstCard.active && index === 0 ? styles.tutorialTargetFocus : null
              ]}
              ref={index === 0 ? tutorialFirstCard.ref : undefined}
              onLayout={index === 0 ? tutorialFirstCard.onLayout : undefined}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: theme.heading }]} numberOfLines={1}>{row.name}</Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                  {row.itemCode} | {row.unit} | {row.category ?? 'Uncategorized'}
                </Text>
                {row.isLpg ? (
                  <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                    FULL {formatQty(stockByProduct[row.id]?.qtyFull ?? 0)} | EMPTY {formatQty(stockByProduct[row.id]?.qtyEmpty ?? 0)} | QOH {formatQty(stockByProduct[row.id]?.qtyOnHand ?? 0)}
                  </Text>
                ) : (
                  <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                    QOH {formatQty(stockByProduct[row.id]?.qtyOnHand)} {stockByProduct[row.id]?.source === 'UNAVAILABLE' ? '(not synced yet)' : ''}
                  </Text>
                )}
              </View>
              <View style={styles.itemRight}>
                <View style={[styles.badge, { backgroundColor: row.isLpg ? theme.primary : theme.pillBg }]}>
                  <Text style={[styles.badgeText, { color: row.isLpg ? '#FFFFFF' : theme.pillText }]}>
                    {row.isLpg ? 'LPG' : 'NON-LPG'}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: row.isActive ? '#DCFCE7' : '#FEE2E2' }]}>
                  <Text style={[styles.badgeText, { color: row.isActive ? '#166534' : '#991B1B' }]}>
                    {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
                <Text style={[styles.viewText, { color: theme.primary }]}>View</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedItem)} transparent animationType="slide" onRequestClose={() => setSelectedItemId(null)}>
        {selectedItem ? (
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={() => setSelectedItemId(null)} />
            <View style={[styles.modalCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: theme.heading }]}>{selectedItem.name}</Text>
                  <Text style={[styles.modalSub, { color: theme.subtext }]}>{selectedItem.itemCode}</Text>
                </View>
                <Pressable
                  onPress={() => setSelectedItemId(null)}
                  style={[styles.modalCloseBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                >
                  <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator>
                <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.blockTitle, { color: theme.heading }]}>Item Details</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Item Code: {selectedItem.itemCode}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Product Name: {selectedItem.name}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Product ID: {selectedItem.id}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Unit: {selectedItem.unit}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Category: {selectedItem.category ?? '-'}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Brand: {selectedItem.brand ?? '-'}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Type: {selectedItem.isLpg ? 'LPG' : 'Non-LPG'}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>
                    Low Stock Alert Qty: {selectedItem.lowStockAlertQty === null ? '-' : formatQty(selectedItem.lowStockAlertQty)}
                  </Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Active: {selectedItem.isActive ? 'Yes' : 'No'}</Text>
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>Updated: {fmtDate(selectedItem.updatedAt)}</Text>
                </View>

                <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.blockTitle, { color: theme.heading }]}>Stock Snapshot</Text>
                  {selectedItem.isLpg ? (
                    <>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Opening FULL: {formatQty(selectedStock.qtyFull)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Opening EMPTY: {formatQty(selectedStock.qtyEmpty)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Qty On Hand: {formatQty(selectedStock.qtyOnHand)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Rule: LPG qty on hand = FULL + EMPTY.</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Low-stock rule: compare FULL qty only.</Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Qty On Hand: {formatQty(selectedStock.qtyOnHand)}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Rule: Non-LPG qty on hand comes from inventory balances (no FULL/EMPTY split).
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Low-stock rule: compare Qty On Hand.</Text>
                    </>
                  )}
                  <Text style={[styles.detailLine, { color: theme.subtext }]}>
                    Location Scope: {selectedLocationId ?? 'All downloaded locations'}
                  </Text>
                </View>

                <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.blockTitle, { color: theme.heading }]}>Linked Cylinder Type</Text>
                  {!selectedItem.cylinderTypeId ? (
                    <Text style={[styles.detailLine, { color: theme.subtext }]}>No cylinder type linked.</Text>
                  ) : selectedCylinder ? (
                    <>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Code: {selectedCylinder.code}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Name: {selectedCylinder.name}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Size: {selectedCylinder.sizeKg === null ? '-' : `${selectedCylinder.sizeKg} kg`}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Deposit Amount: {fmtMoney(selectedCylinder.depositAmount)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Active: {selectedCylinder.isActive ? 'Yes' : 'No'}</Text>
                    </>
                  ) : (
                    <Text style={[styles.detailLine, { color: theme.subtext }]}>
                      Linked cylinder type ID: {selectedItem.cylinderTypeId}
                    </Text>
                  )}
                </View>

                <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.blockTitle, { color: theme.heading }]}>Linked Pricing Rules</Text>
                  {selectedRules.length === 0 ? (
                    <Text style={[styles.detailLine, { color: theme.subtext }]}>No linked pricing rules.</Text>
                  ) : (
                    selectedRules.map((rule) => (
                      <View key={`${rule.priceListId}-${rule.priority ?? 'na'}-${rule.flowMode}-${rule.unitPrice}`} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                        <Text style={[styles.ruleTitle, { color: theme.heading }]}>{rule.priceListName}</Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Scope: {rule.scope} | {rule.appliesTo}</Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Flow: {flowLabel(rule.flowMode)}</Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Unit Price: {fmtMoney(rule.unitPrice)}</Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                          Discount Cap: {rule.discountCapPct === null ? '-' : `${rule.discountCapPct}%`} | Priority: {rule.priority === null ? '-' : rule.priority}
                        </Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                          Effectivity: {fmtDate(rule.startsAt)} to {rule.endsAt ? fmtDate(rule.endsAt) : 'N/A'}
                        </Text>
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Active: {rule.isActive ? 'Yes' : 'No'}</Text>
                      </View>
                    ))
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 12
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800'
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  filterChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  refreshChip: {
    marginLeft: 'auto',
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  refreshChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  },
  categoryRow: {
    gap: 6,
    paddingRight: 8
  },
  categoryChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  list: {
    maxHeight: 520
  },
  listContent: {
    gap: 8,
    paddingBottom: 10
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  itemRight: {
    alignItems: 'flex-end',
    gap: 4
  },
  badge: {
    borderRadius: 999,
    minHeight: 22,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700'
  },
  itemMeta: {
    marginTop: 2,
    fontSize: 11
  },
  viewText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 16, 28, 0.52)'
  },
  modalCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    maxHeight: '86%'
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSub: {
    fontSize: 12
  },
  modalCloseBtn: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  modalScroll: {
    maxHeight: 620
  },
  modalContent: {
    gap: 10,
    paddingBottom: 8
  },
  detailBlock: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2
  },
  detailLine: {
    fontSize: 12
  },
  ruleCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  ruleTitle: {
    fontSize: 12,
    fontWeight: '700'
  },
  ruleLine: {
    fontSize: 11
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  }
});
