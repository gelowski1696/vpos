import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState, type DesktopMasterDataRow, type DesktopSalePayload, type DesktopSaleRecord } from '../src/db/schema';
import { desktopDb, type DesktopOutboxInput } from '../src/db/sqlite';
import { loadLocalRangeMetrics } from '../src/screens/DashboardScreen';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';
import { DesktopSalesService } from '../src/services/desktop-sales.service';
import { DesktopShiftService } from '../src/services/desktop-shift.service';
import type { OutboxItem } from '@vpos/shared-types';

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function makeAppState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setupCompleted: true,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      operatorName: 'Cashier 1',
      authEmail: 'cashier1@example.com',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'loc-1',
      locationLabel: 'Front Store'
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      accessToken: 'test-token',
      userEmail: 'cashier1@example.com',
      userFullName: 'Cashier 1'
    }
  };
}

function makePartialSale(input: {
  saleId: string;
  receiptNumber: string;
  customerId: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
  createdAt: string;
}): DesktopSaleRecord {
  const totalAmount = round2(input.totalAmount);
  const paidAmount = round2(input.paidAmount);
  const creditBalance = round2(Math.max(0, totalAmount - paidAmount));
  const payload: DesktopSalePayload = {
    id: input.saleId,
    shiftId: 'shift-day-1',
    customerId: input.customerId,
    customerName: input.customerName,
    recreatedFromSaleId: null,
    personnelId: 'personnel-1',
    personnelName: 'Driver 1',
    helperId: null,
    helperName: null,
    personnel: [{ userId: 'personnel-1', role: 'DRIVER', name: 'Driver 1' }],
    saleType: 'PICKUP',
    paymentMode: creditBalance > 0 ? 'PARTIAL' : 'FULL',
    paymentMethod: input.paymentMethod,
    hideAmounts: false,
    branchId: 'branch-1',
    branchLabel: 'Main Branch',
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    subtotal: totalAmount,
    discountAmount: 0,
    deliveryFee: 0,
    totalAmount,
    paidAmount,
    changeAmount: 0,
    creditBalance,
    payments: [
      {
        method: input.paymentMethod,
        amount: paidAmount,
        referenceNo: null
      }
    ],
    rewardId: null,
    rewardName: null,
    rewardPointsCost: 0,
    rewardDiscountAmount: 0,
    rewardRedemptionUsed: false,
    notes: 'Whole day simulation',
    lines: [
      {
        lineId: `${input.saleId}-line-1`,
        productId: 'lpg-11kg',
        productName: 'LPG 11kg',
        quantity: 1,
        unitPrice: totalAmount,
        lineTotal: totalAmount,
        cylinderFlow: 'NON_REFILL'
      }
    ],
    createdAt: input.createdAt
  };

  return {
    id: input.saleId,
    payload,
    syncStatus: 'pending',
    receiptNumber: input.receiptNumber,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

describe('desktop whole-day cashier simulation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs open shift -> partial sales -> mixed balance payments -> close shift with consistent balances', async () => {
    const appState = makeAppState();
    const nowIso = new Date().toISOString();

    let salesRows: DesktopSaleRecord[] = [];
    let outboxRows: OutboxItem[] = [];
    let masterRows: DesktopMasterDataRow[] = [
      {
        entity: 'customer',
        recordId: 'cust-1',
        payload: JSON.stringify({
          id: 'cust-1',
          code: 'C001',
          name: 'Customer One',
          outstandingBalance: 0,
          pointsBalance: 0
        }),
        updatedAt: nowIso
      },
      {
        entity: 'customer',
        recordId: 'cust-2',
        payload: JSON.stringify({
          id: 'cust-2',
          code: 'C002',
          name: 'Customer Two',
          outstandingBalance: 0,
          pointsBalance: 0
        }),
        updatedAt: nowIso
      }
    ];

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (!entity) {
        return masterRows;
      }
      return masterRows.filter((row) => row.entity === entity);
    });
    jest.spyOn(desktopDb, 'upsertMasterDataRows').mockImplementation(async (rows) => {
      const next = [...masterRows];
      for (const row of rows) {
        const index = next.findIndex(
          (entry) => entry.entity === row.entity && entry.recordId === row.recordId
        );
        if (index >= 0) {
          next[index] = row;
        } else {
          next.push(row);
        }
      }
      masterRows = next;
    });
    jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockImplementation(async (entity, rows) => {
      masterRows = [...masterRows.filter((row) => row.entity !== entity), ...rows];
    });

    jest.spyOn(desktopDb, 'listSales').mockImplementation(async () => salesRows);
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (sale) => {
      const next = [...salesRows];
      const index = next.findIndex((row) => row.id === sale.id);
      if (index >= 0) {
        next[index] = sale;
      } else {
        next.unshift(sale);
      }
      salesRows = next;
      return sale;
    });

    jest.spyOn(desktopDb, 'listOutboxItems').mockImplementation(async () => outboxRows);
    jest.spyOn(desktopDb, 'enqueueOutboxItem').mockImplementation(async (input: DesktopOutboxInput) => {
      const now = input.created_at;
      const row: OutboxItem = {
        ...input,
        status: 'pending',
        retry_count: 0,
        last_error: null,
        updated_at: now
      };
      outboxRows = [row, ...outboxRows.filter((entry) => entry.id !== row.id)];
      return row;
    });

    const shiftService = new DesktopShiftService();
    const salesService = new DesktopSalesService();
    const masterDataService = new DesktopMasterDataService();

    const openShift = await shiftService.openShift(appState, {
      openingCash: 2000,
      openingCashDenominations: [
        { denomination: 1000, quantity: 2 }
      ]
    });
    expect(openShift.status).toBe('OPEN');
    expect(await shiftService.findActiveShift()).not.toBeNull();

    const saleCustomerOne = makePartialSale({
      saleId: 'sale-cust-1',
      receiptNumber: '20260526-0000001',
      customerId: 'cust-1',
      customerName: 'Customer One',
      totalAmount: 700,
      paidAmount: 200,
      paymentMethod: 'CASH',
      createdAt: nowIso
    });
    const saleCustomerTwo = makePartialSale({
      saleId: 'sale-cust-2',
      receiptNumber: '20260526-0000002',
      customerId: 'cust-2',
      customerName: 'Customer Two',
      totalAmount: 500,
      paidAmount: 100,
      paymentMethod: 'CASH',
      createdAt: nowIso
    });
    await desktopDb.saveSale(saleCustomerOne);
    await desktopDb.saveSale(saleCustomerTwo);

    let currentSaleOne = salesRows.find((sale) => sale.id === 'sale-cust-1');
    let currentSaleTwo = salesRows.find((sale) => sale.id === 'sale-cust-2');
    expect(currentSaleOne).toBeDefined();
    expect(currentSaleTwo).toBeDefined();

    const paymentOneCard = await salesService.recordCustomerPayment(appState, currentSaleOne as DesktopSaleRecord, {
      customerId: 'cust-1',
      branchId: 'branch-1',
      amount: 200,
      method: 'CARD',
      referenceNo: 'CARD-001',
      notes: 'Card payment'
    });
    expect(paymentOneCard.sale.payload.creditBalance).toBe(300);
    currentSaleOne = salesRows.find((sale) => sale.id === 'sale-cust-1');

    const paymentTwoWallet = await salesService.recordCustomerPayment(appState, currentSaleTwo as DesktopSaleRecord, {
      customerId: 'cust-2',
      branchId: 'branch-1',
      amount: 100,
      method: 'E_WALLET',
      referenceNo: 'EW-001',
      notes: 'Wallet payment'
    });
    expect(paymentTwoWallet.sale.payload.creditBalance).toBe(300);
    currentSaleTwo = salesRows.find((sale) => sale.id === 'sale-cust-2');

    const paymentOneCash = await salesService.recordCustomerPayment(appState, currentSaleOne as DesktopSaleRecord, {
      customerId: 'cust-1',
      branchId: 'branch-1',
      amount: 300,
      method: 'CASH',
      referenceNo: null,
      notes: 'Cash settlement'
    });
    expect(paymentOneCash.sale.payload.creditBalance).toBe(0);

    const customers = await masterDataService.loadCustomers();
    const customerOne = customers.find((row) => row.id === 'cust-1');
    const customerTwo = customers.find((row) => row.id === 'cust-2');
    expect(customerOne?.balance).toBe(0);
    expect(customerTwo?.balance).toBe(300);

    const customersWithBalance = customers.filter((row) => Number((row.balance ?? 0).toFixed(2)) > 0);
    expect(customersWithBalance.map((row) => row.id)).toEqual(['cust-2']);

    const localMetrics = await loadLocalRangeMetrics(appState, 'today');
    const methods = localMetrics.paymentRecords.map((row) => row.method);
    expect(methods).toContain('Cash');
    expect(methods).toContain('Card');
    expect(methods).toContain('E-Wallet');

    const closedShift = await shiftService.closeShift(appState, {
      shiftId: openShift.id,
      closingCash: 2600,
      cashVariance: 0
    });
    expect(closedShift.status).toBe('CLOSED');
    expect(await shiftService.findActiveShift()).toBeNull();
  });
});
