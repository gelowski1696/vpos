import { OutboxStatus } from '@vpos/shared-types';
import { LocalSessionService } from '../src/features/auth/local-session.service';
import { MobilePrinterService } from '../src/features/printer/mobile-printer.service';
import { MobileOfflineStore, MockSyncTransport } from '../src/services/mobile-offline.store';

describe('Mobile offline/sync', () => {
  it('1) queues offline sale as pending outbox', async () => {
    const store = new MobileOfflineStore();
    await store.createOfflineSale('sale-1', { total: 1000 });
    expect(await store.getOutboxStatus('sale-1')).toBe(OutboxStatus.PENDING);
  });

  it('2) queues dual outbox rows for cylinder exchange', async () => {
    const store = new MobileOfflineStore();
    await store.createCylinderExchange('cyl-full-out', 'cyl-empty-in');
    expect(await store.getOutboxStatus('cyl-full-out')).toBe(OutboxStatus.PENDING);
    expect(await store.getOutboxStatus('cyl-empty-in')).toBe(OutboxStatus.PENDING);
  });

  it('3) queues transfer creation while offline', async () => {
    const store = new MobileOfflineStore();
    await store.createTransfer('transfer-1', { from: 'warehouse', to: 'truck', qty_full: 10, qty_empty: 2 });
    expect(await store.getOutboxStatus('transfer-1')).toBe(OutboxStatus.PENDING);
  });

  it('4) queues petty cash linked to shift', async () => {
    const store = new MobileOfflineStore();
    await store.createPettyCash('petty-1', { shift_id: 'shift-1', amount: 300, direction: 'OUT' });
    expect(await store.getOutboxStatus('petty-1')).toBe(OutboxStatus.PENDING);
  });

  it('5) queues delivery order with personnel assignment while offline', async () => {
    const store = new MobileOfflineStore();
    await store.createDeliveryOrder('delivery-1', {
      customer_id: 'cust-1',
      order_type: 'DELIVERY',
      personnel: [
        { user_id: 'driver-1', role: 'DRIVER' },
        { user_id: 'helper-1', role: 'HELPER' }
      ]
    });
    expect(await store.getOutboxStatus('delivery-1')).toBe(OutboxStatus.PENDING);
  });

  it('6) queues shift open/close and shift cash entry while offline', async () => {
    const store = new MobileOfflineStore();
    await store.openShift('shift-1', { opening_cash: 2000 });
    await store.closeShift('shift-1', { closing_cash: 1980, cash_variance: -20 });
    await store.createShiftCashEntry('shift-cash-1', { shift_id: 'shift-1', amount: 100, direction: 'OUT' });
    expect(await store.getOutboxStatus('shift-1')).toBe(OutboxStatus.PENDING);
    expect(await store.getOutboxStatus('shift-1-close')).toBe(OutboxStatus.PENDING);
    expect(await store.getOutboxStatus('shift-cash-1')).toBe(OutboxStatus.PENDING);
  });

  it('7) preserves outbox across app restart snapshot', async () => {
    const store = new MobileOfflineStore();
    await store.createOfflineSale('sale-keep', { total: 500 });

    const restored = new MobileOfflineStore(store.snapshot());
    expect(await restored.getOutboxStatus('sale-keep')).toBe(OutboxStatus.PENDING);
  });

  it('8) marks pushed rows as synced on successful sync', async () => {
    const store = new MobileOfflineStore();
    await store.createOfflineSale('sale-sync', { total: 750 });

    await store.sync(new MockSyncTransport({ nextToken: '8' }), 'device-1');
    expect(await store.getOutboxStatus('sale-sync')).toBe(OutboxStatus.SYNCED);
  });

  it('9) marks rejected rows as needs_review', async () => {
    const store = new MobileOfflineStore();
    await store.createOfflineSale('sale-reject', { total: 900 });

    await store.sync(new MockSyncTransport({ rejectIds: ['sale-reject'], nextToken: '9' }), 'device-1');
    expect(await store.getOutboxStatus('sale-reject')).toBe(OutboxStatus.NEEDS_REVIEW);
  });

  it('10) applies pulled master data without overwriting unsynced local sales', async () => {
    const store = new MobileOfflineStore();
    await store.createOfflineSale('sale-local', { id: 'sale-local', total: 900 });

    store.applyPull([
      { entity: 'master_data', action: 'upsert', payload: { id: 'product-1', name: 'LPG Refill 11kg' } },
      { entity: 'sale', action: 'upsert', payload: { id: 'sale-local', total: 100 } }
    ]);

    expect(store.masterData['product-1']).toEqual({ id: 'product-1', name: 'LPG Refill 11kg' });
    expect(store.localTransactions['sale-local']).toEqual({ id: 'sale-local', total: 900 });
  });

  it('11) applies pulled delivery records without overwriting unsynced local delivery', async () => {
    const store = new MobileOfflineStore();
    await store.createDeliveryOrder('delivery-local', { id: 'delivery-local', status: 'assigned' });

    store.applyPull([{ entity: 'delivery_order', action: 'upsert', payload: { id: 'delivery-local', status: 'delivered' } }]);
    store.applyPull([{ entity: 'delivery_order', action: 'upsert', payload: { id: 'delivery-server', status: 'created' } }]);

    expect(store.localTransactions['delivery-local']).toEqual({ id: 'delivery-local', status: 'assigned' });
    expect(store.localTransactions['delivery-server']).toEqual({ id: 'delivery-server', status: 'created' });
  });

  it('12) unlocks cached session with local PIN while offline', async () => {
    const auth = new LocalSessionService();
    await auth.cacheSession('access-token', 'refresh-token', '1234');

    expect(auth.hasCachedSession()).toBe(true);
    await expect(auth.unlock('1234')).resolves.toBe(true);
    await expect(auth.unlock('9999')).resolves.toBe(false);
  });

  it('13) executes printer test print without network dependency', async () => {
    const printer = new MobilePrinterService();
    await expect(printer.runTestPrint()).resolves.toBe(true);
  });
});
