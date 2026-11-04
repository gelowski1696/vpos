import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopLpgItemActionRecord } from './schema';

export type DesktopLpgActionFilter = 'ALL' | DesktopLpgItemActionRecord['actionType'];
export type DesktopLpgActionDateFilter = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
export type DesktopLpgActionSyncFilter = 'ALL' | 'SYNCED' | 'PENDING' | 'FAILED';
export type DesktopLpgActionSyncState = Exclude<DesktopLpgActionSyncFilter, 'ALL'>;
export type DesktopLpgActionSort = 'DATE_DESC' | 'DATE_ASC' | 'PRODUCT_ASC' | 'QTY_DESC';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actionType(value: unknown): DesktopLpgItemActionRecord['actionType'] | null {
  const normalized = text(value).toUpperCase();
  return normalized === 'DISPOSE' || normalized === 'REPLACE' || normalized === 'JUNK' ? normalized : null;
}

export function deriveDesktopLpgActionSyncState(
  actionId: string,
  outboxItems: OutboxItem[]
): DesktopLpgActionSyncState {
  const linked = outboxItems.filter((row) => {
    if (row.entity !== 'lpg_item_action') return false;
    const payload = row.payload ?? {};
    return row.id === actionId || text(payload['action_id'] ?? payload['id']) === actionId;
  });
  if (linked.some((row) => row.status === 'failed' || row.status === 'needs_review')) return 'FAILED';
  if (linked.some((row) => row.status === 'pending' || row.status === 'processing')) return 'PENDING';
  return 'SYNCED';
}

function actionFromOutbox(row: OutboxItem): DesktopLpgItemActionRecord | null {
  if (row.entity !== 'lpg_item_action') return null;
  const payload = row.payload ?? {};
  const type = actionType(payload['action_type'] ?? row.action);
  const id = text(payload['action_id'] ?? payload['id'] ?? row.id);
  const productId = text(payload['product_id'] ?? payload['productId']);
  const branchId = text(payload['branch_id'] ?? payload['branchId']);
  const locationId = text(payload['location_id'] ?? payload['locationId']);
  const quantity = Math.floor(Number(payload['qty']));
  const reason = text(payload['reason']);
  if (!type || !id || !productId || !locationId || !Number.isFinite(quantity) || quantity <= 0 || !reason) return null;
  const createdAt = text(payload['created_at'] ?? payload['createdAt']) || row.created_at;
  return {
    id,
    branchId,
    branchCode: null,
    branchName: null,
    locationId,
    locationCode: null,
    locationName: text(payload['location_name'] ?? payload['locationName']) || null,
    productId,
    productSku: text(payload['product_sku'] ?? payload['productSku']) || null,
    productName: text(payload['product_name'] ?? payload['productName']) || null,
    actionType: type,
    qty: quantity,
    reason,
    notes: text(payload['notes']) || null,
    referenceActionId: text(payload['reference_action_id'] ?? payload['referenceActionId']) || null,
    createdByUserId: text(payload['actor_user_id'] ?? payload['user_id'] ?? payload['userId']) || null,
    createdAt,
    updatedAt: row.updated_at || createdAt
  };
}

export function projectDesktopLpgActions(
  cachedActions: DesktopLpgItemActionRecord[],
  outboxItems: OutboxItem[],
  branchId?: string,
  locationId?: string
): DesktopLpgItemActionRecord[] {
  const projected = new Map(cachedActions.map((record) => [record.id, record]));
  for (const row of outboxItems) {
    if (!['pending', 'processing', 'failed', 'needs_review'].includes(row.status)) continue;
    const record = actionFromOutbox(row);
    if (record && !projected.has(record.id)) projected.set(record.id, record);
  }
  return [...projected.values()]
    .filter((record) => !branchId || !record.branchId || record.branchId === branchId)
    .filter((record) => !locationId || record.locationId === locationId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function filterDesktopLpgActions(
  actions: DesktopLpgItemActionRecord[],
  input: {
    search: string;
    action: DesktopLpgActionFilter;
    productId: string;
    date: DesktopLpgActionDateFilter;
    sync: DesktopLpgActionSyncFilter;
    sort: DesktopLpgActionSort;
    outboxItems?: OutboxItem[];
    now?: Date;
  }
): DesktopLpgItemActionRecord[] {
  const query = input.search.trim().toLowerCase();
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const cutoff = input.date === 'LAST_7_DAYS'
    ? today - 6 * 86_400_000
    : input.date === 'LAST_30_DAYS'
      ? today - 29 * 86_400_000
      : Number.NEGATIVE_INFINITY;
  const outbox = input.outboxItems ?? [];
  return actions.filter((record) => {
    if (input.action !== 'ALL' && record.actionType !== input.action) return false;
    if (input.productId !== 'ALL' && record.productId !== input.productId) return false;
    if (input.sync !== 'ALL' && deriveDesktopLpgActionSyncState(record.id, outbox) !== input.sync) return false;
    const created = new Date(record.createdAt).getTime();
    if (input.date === 'TODAY' && (!Number.isFinite(created) || created < today || created >= today + 86_400_000)) return false;
    if ((input.date === 'LAST_7_DAYS' || input.date === 'LAST_30_DAYS') && (!Number.isFinite(created) || created < cutoff)) return false;
    if (!query) return true;
    return [record.id, record.productSku, record.productName, record.actionType, record.reason, record.notes, record.locationName]
      .filter(Boolean).join(' ').toLowerCase().includes(query);
  }).sort((left, right) => {
    if (input.sort === 'DATE_ASC') return left.createdAt.localeCompare(right.createdAt);
    if (input.sort === 'PRODUCT_ASC') return (left.productName || left.productSku || left.productId).localeCompare(right.productName || right.productSku || right.productId) || right.createdAt.localeCompare(left.createdAt);
    if (input.sort === 'QTY_DESC') return right.qty - left.qty || right.createdAt.localeCompare(left.createdAt);
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function paginateDesktopLpgActions(
  actions: DesktopLpgItemActionRecord[],
  requestedPage: number,
  requestedPageSize: number
) {
  const pageSize = Math.max(1, Math.floor(Number(requestedPageSize)) || 10);
  const totalPages = Math.max(1, Math.ceil(actions.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage)) || 1));
  return { actions: actions.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalPages };
}

export function summarizeDesktopLpgActions(actions: DesktopLpgItemActionRecord[]) {
  const linked = new Map<string, number>();
  const summary = { disposed: 0, replaced: 0, junked: 0, remaining: 0, records: actions.length };
  for (const record of actions) {
    if (record.actionType === 'DISPOSE') summary.disposed += record.qty;
    if (record.actionType === 'REPLACE') summary.replaced += record.qty;
    if (record.actionType === 'JUNK') summary.junked += record.qty;
    if (record.referenceActionId && record.actionType !== 'DISPOSE') {
      linked.set(record.referenceActionId, (linked.get(record.referenceActionId) ?? 0) + record.qty);
    }
  }
  summary.remaining = actions
    .filter((record) => record.actionType === 'DISPOSE')
    .reduce((total, record) => total + Math.max(0, record.qty - (linked.get(record.id) ?? 0)), 0);
  return summary;
}

