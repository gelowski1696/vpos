import type { DesktopOperationalOutboxInput, DesktopTransactionPolicyPort } from './operational-ports';
import { buildSaleOutboxPayload } from './sale-sync-payload';
import { isDesktopRewardEligible, resolveDesktopRewardValue } from './pos-pricing';
import type {
  DesktopAppState,
  DesktopHeldCartRecord,
  DesktopMasterDataRow,
  DesktopOption,
  DesktopPaymentMethod,
  DesktopPaymentMode,
  DesktopPosRewardRecord,
  DesktopSaleLine,
  DesktopSalePersonnelCommission,
  DesktopSaleRecord,
  DesktopSaleType
} from './schema';

const HELD_CART_ENTITY = 'held_cart';

export interface DesktopPosRepository {
  listSales(): Promise<DesktopSaleRecord[]>;
  saveSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord>;
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void>;
  replaceMasterDataEntity(entity: string, rows: DesktopMasterDataRow[]): Promise<void>;
  enqueueOutboxItem(input: DesktopOperationalOutboxInput): Promise<unknown>;
}

export interface DesktopPosDeliveryPort {
  createDeliveryOrder(input: {
    branchId: string;
    sourceLocationId: string;
    customerId: string;
    customerName?: string | null;
    saleId?: string | null;
    orderType: 'PICKUP' | 'DELIVERY';
    personnel: Array<{ userId: string; role: 'DRIVER' | 'HELPER' | 'LOADER' | 'OTHER'; name?: string | null }>;
    notes?: string | null;
  }): Promise<unknown>;
}

export type DesktopPosPorts = {
  repository: DesktopPosRepository;
  subscriptionPolicy: DesktopTransactionPolicyPort;
  delivery?: DesktopPosDeliveryPort;
};

export type DesktopPosCheckoutLine = {
  lineId?: string;
  productId: string;
  productName: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  availableQty: number;
  isLpg: boolean;
  cylinderFlow: DesktopSaleLine['cylinderFlow'];
  pickupCommissionRate?: number;
  deliveryCommissionRate?: number;
};

export type DesktopPosCheckoutInput = {
  state: DesktopAppState;
  shiftId: string;
  customer: DesktopOption | null;
  personnel: DesktopOption | null;
  helper?: DesktopOption | null;
  saleType: DesktopSaleType;
  paymentMode: DesktopPaymentMode;
  paymentMethod: DesktopPaymentMethod;
  paidAmount: number;
  discountAmount: number;
  deliveryFee: number;
  paymentReference?: string | null;
  hideAmounts?: boolean;
  reward?: DesktopPosRewardRecord | null;
  notes?: string | null;
  recreatedFromSaleId?: string | null;
  lines: DesktopPosCheckoutLine[];
  createDeliveryOrder?: boolean;
};

export type DesktopPosCheckoutResult = {
  sale: DesktopSaleRecord;
  deliveryQueued: boolean;
  deliveryError: string | null;
};

export type DesktopPosHoldInput = {
  label: string;
  customer: DesktopOption | null;
  personnel: DesktopOption | null;
  helper?: DesktopOption | null;
  saleType: DesktopSaleType;
  paymentMode: DesktopPaymentMode;
  paymentMethod: DesktopPaymentMethod;
  paidAmount: number;
  discountAmount: number;
  deliveryFee: number;
  paymentReference?: string | null;
  hideAmounts?: boolean;
  reward?: DesktopPosRewardRecord | null;
  notes?: string | null;
  lines: DesktopSaleLine[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function manilaDateToken(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}${value('month')}${value('day')}`;
}

export function makeDesktopReceiptNumber(existingSales: DesktopSaleRecord[], now: Date): string {
  const prefix = manilaDateToken(now);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const maxSequence = existingSales.reduce((max, sale) => {
    const match = sale.receiptNumber.match(pattern);
    const sequence = match ? Number.parseInt(match[1], 10) : 0;
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}-${String(maxSequence + 1).padStart(7, '0')}`;
}

export function buildDesktopCommissionPreview(args: {
  lines: DesktopSaleLine[];
  personnel: Array<{
    id: string | null;
    name: string | null;
    role: 'DRIVER' | 'HELPER' | 'PERSONNEL';
    commissionEligible?: boolean;
  }>;
  saleType: DesktopSaleType;
}): DesktopSalePersonnelCommission[] {
  const eligible = args.personnel.filter((person) => person.commissionEligible !== false)
    .filter((person) => Boolean(person.id?.trim() || person.name?.trim()));
  if (!eligible.length) return [];

  const splitPercent = round2(100 / eligible.length);
  const rows: DesktopSalePersonnelCommission[] = [];
  for (const line of args.lines) {
    const quantity = Math.max(0, Number(line.quantity || 0));
    const commissionRate = round2(Math.max(0, args.saleType === 'DELIVERY'
      ? Number(line.deliveryCommissionRate || 0)
      : Number(line.pickupCommissionRate || 0)));
    const totalCommission = round2(quantity * commissionRate);
    if (quantity <= 0 || totalCommission <= 0) continue;

    let allocated = 0;
    eligible.forEach((person, index) => {
      const commissionAmount = index === eligible.length - 1
        ? round2(totalCommission - allocated)
        : round2(totalCommission / eligible.length);
      allocated = round2(allocated + commissionAmount);
      if (commissionAmount <= 0) return;
      rows.push({
        productId: line.productId,
        productName: line.productName,
        personnelId: person.id,
        personnelName: person.name ?? person.id ?? 'Personnel',
        personnelRole: person.role,
        saleType: args.saleType,
        quantity,
        commissionRate,
        splitPercent,
        commissionAmount
      });
    });
  }
  return rows;
}

function parseHeldCart(payload: string): DesktopHeldCartRecord | null {
  try {
    return JSON.parse(payload) as DesktopHeldCartRecord;
  } catch {
    return null;
  }
}

export class DesktopPosService {
  constructor(private readonly ports: DesktopPosPorts) {}

  async checkout(input: DesktopPosCheckoutInput): Promise<DesktopPosCheckoutResult> {
    const { state } = input;
    if (!state.setupCompleted) throw new Error('Finish setup before saving sales.');
    if (!state.setup.locationId || !state.setup.branchId) throw new Error('Choose a branch and location before using POS.');
    if (!input.shiftId.trim()) throw new Error('Start a shift before completing a sale.');
    if (!input.lines.length) throw new Error('Add at least one item to the order.');
    if (!input.customer) throw new Error('Customer is required before payment.');
    if (!input.personnel) throw new Error('Personnel is required before payment.');
    if (input.helper?.id === input.personnel.id) throw new Error('Personnel and helper must be different people.');

    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error(`Enter a valid quantity for ${line.productName}.`);
      if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new Error(`Invalid price for ${line.productName}.`);
      if (line.quantity > Math.max(0, Number(line.availableQty || 0))) throw new Error(`${line.productName} only has ${Math.max(0, Number(line.availableQty || 0))} available.`);
      if (line.isLpg && !line.cylinderFlow) throw new Error('Choose Refill or Non-refill for each LPG item.');
    }

    const subtotal = round2(input.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
    const manualDiscountAmount = round2(Number(input.discountAmount || 0));
    const deliveryFee = input.saleType === 'DELIVERY' ? round2(Number(input.deliveryFee || 0)) : 0;
    if (manualDiscountAmount < 0 || manualDiscountAmount > subtotal) throw new Error('Discount must be between zero and the subtotal.');
    if (deliveryFee < 0) throw new Error('Delivery fee cannot be negative.');
    if (input.reward && !isDesktopRewardEligible({
      reward: input.reward,
      customer: input.customer,
      lines: input.lines,
      subtotal,
      manualDiscount: manualDiscountAmount,
      saleType: input.saleType,
      deliveryFee
    })) throw new Error('The selected reward is no longer eligible for this order.');
    const rewardValue = input.reward ? resolveDesktopRewardValue({
      reward: input.reward,
      lines: input.lines,
      subtotal,
      manualDiscount: manualDiscountAmount,
      saleType: input.saleType,
      deliveryFee
    }) : { baseAmount: round2(subtotal - manualDiscountAmount + deliveryFee), itemDiscount: 0, deliveryDiscount: 0, totalDiscount: 0 };
    const discountAmount = round2(manualDiscountAmount + rewardValue.totalDiscount);
    const totalAmount = round2(Math.max(0, subtotal - manualDiscountAmount - rewardValue.itemDiscount + deliveryFee - rewardValue.deliveryDiscount));
    const paidAmount = round2(Number(input.paidAmount));
    if (!Number.isFinite(paidAmount) || paidAmount < 0) throw new Error('Enter a valid amount paid.');
    if (input.paymentMode === 'FULL' && paidAmount + 0.0001 < totalAmount) throw new Error('Full payment requires amount equal to or greater than total.');
    if (input.paymentMode === 'PARTIAL' && paidAmount >= totalAmount) throw new Error('Partial payment must be less than total.');
    if (input.hideAmounts && (input.paymentMode === 'PARTIAL' || paidAmount + 0.0001 < totalAmount)) {
      throw new Error('Receipt amount privacy is not available for sales with balance due.');
    }

    await this.ports.subscriptionPolicy.assertCanCreateTransactions('sale');
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const saleId = createId('desk-sale');
    const saleLines: DesktopSaleLine[] = input.lines.map((line) => ({
      lineId: line.lineId?.trim() || createId('sale-line'),
      productId: line.productId,
      productName: line.productName,
      subtitle: line.sku?.trim() || null,
      quantity: line.quantity,
      unitPrice: round2(line.unitPrice),
      lineTotal: round2(line.quantity * line.unitPrice),
      cylinderFlow: line.isLpg ? line.cylinderFlow ?? null : null,
      pickupCommissionRate: round2(Number(line.pickupCommissionRate || 0)),
      deliveryCommissionRate: round2(Number(line.deliveryCommissionRate || 0))
    }));
    const primaryRole = input.saleType === 'DELIVERY' ? 'DRIVER' as const : 'PERSONNEL' as const;
    const people = [
      { id: input.personnel.id, name: input.personnel.label, role: primaryRole, commissionEligible: input.personnel.commissionEligible },
      ...(input.helper ? [{ id: input.helper.id, name: input.helper.label, role: 'HELPER' as const, commissionEligible: input.helper.commissionEligible }] : [])
    ];
    const commissions = buildDesktopCommissionPreview({ lines: saleLines, personnel: people, saleType: input.saleType });
    const commissionTotal = round2(commissions.reduce((sum, row) => sum + row.commissionAmount, 0));
    const syncedPaymentAmount = input.paymentMode === 'FULL' ? totalAmount : Math.min(paidAmount, totalAmount);

    const payload = {
      id: saleId,
      shiftId: input.shiftId,
      customerId: input.customer.id,
      customerName: input.customer.label,
      recreatedFromSaleId: input.recreatedFromSaleId?.trim() || null,
      personnelId: input.personnel.id,
      personnelName: input.personnel.label,
      helperId: input.helper?.id ?? null,
      helperName: input.helper?.label ?? null,
      personnel: [
        { userId: input.personnel.id, role: primaryRole, name: input.personnel.label },
        ...(input.helper ? [{ userId: input.helper.id, role: 'HELPER' as const, name: input.helper.label }] : [])
      ],
      saleType: input.saleType,
      paymentMode: input.paymentMode,
      paymentMethod: input.paymentMethod,
      hideAmounts: input.hideAmounts === true,
      branchId: state.setup.branchId,
      branchLabel: state.setup.branchLabel,
      locationId: state.setup.locationId,
      locationLabel: state.setup.locationLabel,
      subtotal,
      discountAmount,
      deliveryFee,
      totalAmount,
      paidAmount,
      changeAmount: round2(Math.max(0, paidAmount - totalAmount)),
      creditBalance: round2(Math.max(0, totalAmount - paidAmount)),
      payments: [{
        id: `${saleId}-payment-1`, source: 'SALE' as const, method: input.paymentMethod,
        amount: round2(syncedPaymentAmount), referenceNo: input.paymentReference?.trim() || null,
        notes: null, createdAt: now
      }],
      rewardId: input.reward?.id ?? null,
      rewardName: input.reward?.name ?? null,
      rewardPointsCost: input.reward?.pointsCost ?? 0,
      rewardDiscountAmount: rewardValue.totalDiscount,
      rewardBaseAmount: rewardValue.baseAmount,
      rewardRedemptionUsed: Boolean(input.reward),
      commissionSplitMode: 'EQUAL' as const,
      commissionTotal,
      commissions,
      notes: input.notes?.trim() || null,
      lines: saleLines,
      createdAt: now
    };
    const receiptNumber = makeDesktopReceiptNumber(await this.ports.repository.listSales(), nowDate);
    const sale: DesktopSaleRecord = {
      id: saleId,
      payload,
      syncStatus: 'pending',
      receiptNumber,
      createdAt: now,
      updatedAt: now
    };
    await this.ports.repository.saveSale(sale);
    await this.ports.repository.enqueueOutboxItem({
      id: saleId,
      entity: 'sale',
      action: 'create',
      payload: buildSaleOutboxPayload(payload),
      idempotency_key: `idem-sale-${saleId}`,
      created_at: now
    });

    let deliveryQueued = false;
    let deliveryError: string | null = null;
    if (input.saleType === 'DELIVERY' && input.createDeliveryOrder && this.ports.delivery) {
      try {
        await this.ports.delivery.createDeliveryOrder({
          branchId: state.setup.branchId,
          sourceLocationId: state.setup.locationId,
          customerId: input.customer.id,
          customerName: input.customer.label,
          saleId,
          orderType: 'DELIVERY',
          personnel: [
            { userId: input.personnel.id, role: 'DRIVER', name: input.personnel.label },
            ...(input.helper ? [{ userId: input.helper.id, role: 'HELPER' as const, name: input.helper.label }] : [])
          ],
          notes: input.notes
        });
        deliveryQueued = true;
      } catch (error) {
        deliveryError = error instanceof Error ? error.message : String(error);
      }
    }
    return { sale, deliveryQueued, deliveryError };
  }

  async listHeldCarts(): Promise<DesktopHeldCartRecord[]> {
    const rows = await this.ports.repository.listMasterData(HELD_CART_ENTITY);
    return rows.map((row) => parseHeldCart(row.payload))
      .filter((row): row is DesktopHeldCartRecord => Boolean(row))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async holdCart(input: DesktopPosHoldInput): Promise<DesktopHeldCartRecord> {
    if (!input.lines.length) throw new Error('Add at least one item before holding the order.');
    const now = new Date().toISOString();
    const record: DesktopHeldCartRecord = {
      id: createId('held-cart'),
      label: input.label.trim() || `Held order ${new Date(now).toLocaleTimeString()}`,
      customerId: input.customer?.id ?? null,
      customerName: input.customer?.label ?? null,
      customerProvince: input.customer?.province ?? null,
      customerCity: input.customer?.city ?? null,
      personnelId: input.personnel?.id ?? null,
      personnelName: input.personnel?.label ?? null,
      helperId: input.helper?.id ?? null,
      helperName: input.helper?.label ?? null,
      saleType: input.saleType,
      paymentMode: input.paymentMode,
      paymentMethod: input.paymentMethod,
      paidAmount: round2(Number(input.paidAmount || 0)),
      discountAmount: round2(Number(input.discountAmount || 0)),
      deliveryFee: round2(Number(input.deliveryFee || 0)),
      paymentReference: input.paymentReference?.trim() || null,
      hideAmounts: input.hideAmounts === true,
      rewardId: input.reward?.id ?? null,
      rewardName: input.reward?.name ?? null,
      notes: input.notes?.trim() || null,
      lines: input.lines,
      createdAt: now,
      updatedAt: now
    };
    await this.ports.repository.upsertMasterDataRows([{
      entity: HELD_CART_ENTITY,
      recordId: record.id,
      payload: JSON.stringify(record),
      updatedAt: now
    }]);
    return record;
  }

  async removeHeldCart(id: string): Promise<void> {
    const rows = (await this.listHeldCarts()).filter((row) => row.id !== id);
    await this.ports.repository.replaceMasterDataEntity(HELD_CART_ENTITY, rows.map((row) => ({
      entity: HELD_CART_ENTITY,
      recordId: row.id,
      payload: JSON.stringify(row),
      updatedAt: row.updatedAt
    })));
  }
}
