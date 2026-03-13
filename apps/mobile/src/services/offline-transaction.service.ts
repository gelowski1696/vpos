import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteOutboxRepository } from '../outbox/sqlite-outbox.repository';
import { MobileSubscriptionPolicyService } from '../features/sync/mobile-subscription-policy.service';

type SaleInput = {
  saleId?: string;
  branchId: string;
  locationId: string;
  shiftId?: string | null;
  customerId?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL';
  }>;
  payments: Array<{ method: 'CASH' | 'CARD' | 'E_WALLET'; amount: number }>;
  discountAmount?: number;
  saleType?: 'PICKUP' | 'DELIVERY';
  cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL';
  paymentMode?: 'FULL' | 'PARTIAL';
  creditBalance?: number;
  creditNotes?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  personnel?: Array<{ userId: string; role: 'DRIVER' | 'HELPER' | 'PERSONNEL' | 'LOADER' | 'OTHER'; name?: string | null }>;
};

type CustomerPaymentInput = {
  paymentId?: string;
  saleId?: string | null;
  customerId: string;
  branchId?: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  referenceNo?: string | null;
  notes?: string | null;
};

type TransferInput = {
  transferId?: string;
  sourceLocationId: string;
  destinationLocationId: string;
  shiftId: string;
  transferMode?:
    | 'SUPPLIER_RESTOCK_IN'
    | 'SUPPLIER_RESTOCK_OUT'
    | 'INTER_STORE_TRANSFER'
    | 'STORE_TO_WAREHOUSE'
    | 'WAREHOUSE_TO_STORE'
    | 'GENERAL';
  supplierId?: string | null;
  supplierName?: string | null;
  sourceLocationLabel?: string | null;
  destinationLocationLabel?: string | null;
  lines: Array<{ productId: string; qtyFull: number; qtyEmpty: number }>;
};

type PettyCashInput = {
  entryId?: string;
  shiftId: string;
  categoryCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string;
};

type DeliveryAssignmentInput = {
  userId: string;
  role: 'DRIVER' | 'HELPER' | 'LOADER' | 'OTHER';
};

type DeliveryOrderInput = {
  orderId?: string;
  branchId: string;
  sourceLocationId: string;
  customerId: string;
  saleId?: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  personnel: DeliveryAssignmentInput[];
  notes?: string;
};

type ShiftOpenInput = {
  shiftId?: string;
  branchId: string;
  locationId: string;
  userId: string;
  openingCash: number;
};

type ShiftCloseInput = {
  shiftId: string;
  closingCash: number;
  cashVariance: number;
};

type ShiftCashEntryInput = {
  entryId?: string;
  shiftId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string;
};

export class OfflineTransactionService {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly subscriptionPolicy?: MobileSubscriptionPolicyService
  ) {}

  async createOfflineSale(input: SaleInput): Promise<string> {
    await this.assertCanCreate('sale');
    const id = input.saleId ?? this.id('sale');
    const now = new Date().toISOString();
    const payload = {
      id,
      branch_id: input.branchId,
      location_id: input.locationId,
      shift_id: input.shiftId ?? null,
      customer_id: input.customerId ?? null,
      sale_type: input.saleType ?? 'PICKUP',
      cylinder_flow: input.cylinderFlow ?? 'REFILL_EXCHANGE',
      lines: input.lines,
      payments: input.payments,
      discount_amount: input.discountAmount ?? 0,
      payment_mode: input.paymentMode ?? 'FULL',
      credit_balance: input.creditBalance ?? 0,
      credit_notes: input.creditNotes ?? null,
      personnel_id: input.personnelId ?? null,
      personnel_name: input.personnelName ?? null,
      driver_id: input.driverId ?? null,
      driver_name: input.driverName ?? null,
      helper_id: input.helperId ?? null,
      helper_name: input.helperName ?? null,
      personnel: input.personnel ?? [],
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO sales_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'sale',
      action: 'create',
      payload,
      idempotencyKey: `idem-sale-${id}`
    });

    return id;
  }

  async createOfflineCustomerPayment(input: CustomerPaymentInput): Promise<string> {
    await this.assertCanCreate('customer_payment');
    const id = input.paymentId ?? this.id('cust-pay');
    const now = new Date().toISOString();
    const payload = {
      id,
      payment_id: id,
      sale_id: input.saleId ?? null,
      customer_id: input.customerId,
      branch_id: input.branchId ?? null,
      method: input.method,
      amount: input.amount,
      reference_no: input.referenceNo ?? null,
      notes: input.notes ?? null,
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO customer_payments_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'customer_payment',
      action: 'create',
      payload,
      idempotencyKey: `idem-customer-payment-${id}`
    });

    return id;
  }

  async createOfflineTransfer(input: TransferInput): Promise<string> {
    await this.assertCanCreate('transfer');
    const id = input.transferId ?? this.id('transfer');
    const now = new Date().toISOString();
    const shiftId = input.shiftId.trim();
    if (!shiftId) {
      throw new Error('Transfer requires an active shift.');
    }
    const payload = {
      id,
      source_location_id: input.sourceLocationId,
      destination_location_id: input.destinationLocationId,
      shift_id: shiftId,
      transfer_mode: input.transferMode ?? 'GENERAL',
      supplier_id: input.supplierId ?? null,
      supplier_name: input.supplierName ?? null,
      source_location_label: input.sourceLocationLabel ?? null,
      destination_location_label: input.destinationLocationLabel ?? null,
      lines: input.lines,
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO transfers_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'transfer',
      action: 'create',
      payload,
      idempotencyKey: `idem-transfer-${id}`
    });

    return id;
  }

  async createOfflinePettyCash(input: PettyCashInput): Promise<string> {
    await this.assertCanCreate('petty_cash');
    const id = input.entryId ?? this.id('petty');
    const now = new Date().toISOString();
    const payload = {
      id,
      shift_id: input.shiftId,
      category_code: input.categoryCode,
      direction: input.direction,
      amount: input.amount,
      notes: input.notes ?? null,
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO petty_cash_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'petty_cash',
      action: 'create',
      payload,
      idempotencyKey: `idem-petty-${id}`
    });

    return id;
  }

  async createOfflineDeliveryOrder(input: DeliveryOrderInput): Promise<string> {
    await this.assertCanCreate('delivery_order');
    const id = input.orderId ?? this.id('delivery');
    const now = new Date().toISOString();
    const payload = {
      id,
      branch_id: input.branchId,
      source_location_id: input.sourceLocationId,
      customer_id: input.customerId,
      sale_id: input.saleId ?? null,
      order_type: input.orderType,
      status: 'created',
      personnel: input.personnel,
      notes: input.notes ?? null,
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO delivery_orders_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'delivery_order',
      action: 'create',
      payload,
      idempotencyKey: `idem-delivery-${id}`
    });

    return id;
  }

  async openOfflineShift(input: ShiftOpenInput): Promise<string> {
    await this.assertCanCreate('shift_open');
    const id = input.shiftId ?? this.id('shift');
    const now = new Date().toISOString();
    const payload = {
      id,
      branch_id: input.branchId,
      location_id: input.locationId,
      user_id: input.userId,
      opening_cash: input.openingCash,
      status: 'open',
      opened_at: now
    };

    await this.db.runAsync(
      'INSERT INTO shifts_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'shift',
      action: 'open',
      payload,
      idempotencyKey: `idem-shift-open-${id}`
    });

    return id;
  }

  async closeOfflineShift(input: ShiftCloseInput): Promise<string> {
    await this.assertCanCreate('shift_close');
    const now = new Date().toISOString();
    const closeId = this.id('shift-close');
    const payload = {
      id: input.shiftId,
      closing_cash: input.closingCash,
      cash_variance: input.cashVariance,
      status: 'closed',
      closed_at: now
    };

    await this.db.runAsync(
      'UPDATE shifts_local SET payload = ?, sync_status = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(payload),
      'pending',
      now,
      input.shiftId
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id: closeId,
      entity: 'shift',
      action: 'close',
      payload,
      idempotencyKey: `idem-shift-close-${closeId}`
    });

    return closeId;
  }

  async createOfflineShiftCashEntry(input: ShiftCashEntryInput): Promise<string> {
    await this.assertCanCreate('shift_cash_entry');
    const id = input.entryId ?? this.id('shift-cash');
    const now = new Date().toISOString();
    const payload = {
      id,
      shift_id: input.shiftId,
      direction: input.direction,
      amount: input.amount,
      notes: input.notes ?? null,
      created_at: now
    };

    await this.db.runAsync(
      'INSERT INTO shift_cash_entries_local(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'shift_cash_entry',
      action: 'create',
      payload,
      idempotencyKey: `idem-shift-cash-${id}`
    });

    return id;
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  private async assertCanCreate(context: string): Promise<void> {
    if (!this.subscriptionPolicy) {
      return;
    }
    await this.subscriptionPolicy.assertCanCreateTransactions(context);
  }
}
