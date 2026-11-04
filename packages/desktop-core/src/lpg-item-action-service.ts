import type { DesktopAppState, DesktopLpgItemActionRecord } from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export type DesktopLpgItemActionPorts = {
  repository: DesktopOperationalRepository;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

const ENTITY = 'lpg_item_action';

export type DesktopLpgActionType = DesktopLpgItemActionRecord['actionType'];

export type DesktopDisposedEntry = DesktopLpgItemActionRecord & {
  junkQty: number;
  replacedQty: number;
  availableQty: number;
};

export type CreateDesktopLpgItemActionInput = {
  actionType: DesktopLpgActionType;
  productId: string;
  productSku: string;
  productName: string;
  branchId: string;
  branchLabel: string;
  locationId: string;
  locationLabel: string;
  quantity: number;
  maximumQuantity: number;
  reason: string;
  notes?: string | null;
  referenceActionId?: string | null;
};

function createId(): string {
  return `desk-lpg-action-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function parseRecord(payload: string): DesktopLpgItemActionRecord | null {
  try {
    const value = JSON.parse(payload) as DesktopLpgItemActionRecord;
    return value?.id ? value : null;
  } catch {
    return null;
  }
}

export class DesktopLpgItemActionService {
  constructor(private readonly ports: DesktopLpgItemActionPorts) {}

  async listActions(branchId?: string, locationId?: string): Promise<DesktopLpgItemActionRecord[]> {
    const rows = await this.ports.repository.listMasterData(ENTITY);
    return rows
      .map((row) => parseRecord(row.payload))
      .filter((row): row is DesktopLpgItemActionRecord => Boolean(row))
      .filter((row) => !branchId || row.branchId === branchId)
      .filter((row) => !locationId || row.locationId === locationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  deriveDisposedEntries(actions: DesktopLpgItemActionRecord[]): DesktopDisposedEntry[] {
    const replaced = new Map<string, number>();
    const junked = new Map<string, number>();
    for (const action of actions) {
      if (!action.referenceActionId) continue;
      const target = action.actionType === 'REPLACE' ? replaced : action.actionType === 'JUNK' ? junked : null;
      if (target) target.set(action.referenceActionId, (target.get(action.referenceActionId) ?? 0) + action.qty);
    }
    return actions.filter((action) => action.actionType === 'DISPOSE').map((action) => {
      const replacedQty = replaced.get(action.id) ?? 0;
      const junkQty = junked.get(action.id) ?? 0;
      return { ...action, replacedQty, junkQty, availableQty: Math.max(0, action.qty - replacedQty - junkQty) };
    });
  }

  async createAction(
    state: DesktopAppState,
    input: CreateDesktopLpgItemActionInput
  ): Promise<DesktopLpgItemActionRecord> {
    const quantity = Math.floor(Number(input.quantity));
    const maximum = Math.floor(Number(input.maximumQuantity));
    if (!input.productId.trim()) throw new Error('Select an LPG item.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a valid whole quantity.');
    if (!Number.isFinite(maximum) || maximum <= 0 || quantity > maximum) {
      throw new Error(
        input.actionType === 'DISPOSE'
          ? `Only ${Math.max(0, maximum)} empty item(s) are available to dispose.`
          : `Only ${Math.max(0, maximum)} disposed item(s) are still available.`
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error('Reason is required.');

    const referenceActionId = input.referenceActionId?.trim() || null;
    if (input.actionType !== 'DISPOSE') {
      if (!referenceActionId) throw new Error('Choose a disposed entry first.');
      const actions = await this.listActions(input.branchId, input.locationId);
      const reference = this.deriveDisposedEntries(actions).find((entry) => entry.id === referenceActionId);
      if (!reference || reference.productId !== input.productId) throw new Error('The selected disposed entry is no longer available.');
      if (quantity > reference.availableQty) throw new Error(`Only ${reference.availableQty} disposed item(s) are still available.`);
    }

    await this.ports.subscriptionPolicy.assertCanCreateTransactions('lpg_item_action');
    const id = createId();
    const createdAt = new Date().toISOString();
    const record: DesktopLpgItemActionRecord = {
      id,
      branchId: input.branchId,
      branchCode: null,
      branchName: input.branchLabel || null,
      locationId: input.locationId,
      locationCode: null,
      locationName: input.locationLabel || null,
      productId: input.productId,
      productSku: input.productSku || null,
      productName: input.productName || null,
      actionType: input.actionType,
      qty: quantity,
      reason,
      notes: input.notes?.trim() || null,
      referenceActionId,
      createdByUserId: null,
      createdAt,
      updatedAt: createdAt
    };

    await this.ports.repository.upsertMasterDataRows([{
      entity: ENTITY,
      recordId: id,
      payload: JSON.stringify({ ...record, is_local_only: true, syncStatus: 'pending' }),
      updatedAt: createdAt
    }]);
    await this.ports.repository.enqueueOutboxItem({
      id,
      entity: ENTITY,
      action: input.actionType.toLowerCase(),
      payload: {
        id,
        action_id: id,
        action_type: input.actionType,
        product_id: input.productId,
        product_sku: input.productSku,
        product_name: input.productName,
        branch_id: input.branchId,
        location_id: input.locationId,
        location_name: input.locationLabel,
        qty: quantity,
        reason,
        notes: record.notes,
        reference_action_id: referenceActionId,
        created_at: createdAt
      },
      idempotency_key: `idem-lpg-item-action-${id}`,
      created_at: createdAt
    });
    return record;
  }
}
