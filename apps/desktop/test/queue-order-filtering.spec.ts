import type { DesktopHeldCartRecord, DesktopOption, DesktopSaleLine } from '../src/db/schema';
import {
  buildQueueOrderAddressOptions,
  filterQueueOrdersByAddress,
} from '../src/screens/queue-order-filtering';

function makeLine(productName: string): DesktopSaleLine {
  return {
    productId: productName.toLowerCase().replace(/\s+/g, '-'),
    productName,
    quantity: 1,
    unitPrice: 150,
    lineTotal: 150
  };
}

function makeHeldCart(overrides: Partial<DesktopHeldCartRecord>): DesktopHeldCartRecord {
  return {
    id: 'held-1',
    label: 'Queue 1',
    customerId: 'cust-1',
    customerName: 'Albert',
    customerProvince: 'Bulacan',
    customerCity: 'Malolos',
    saleType: 'DELIVERY',
    paymentMethod: 'CASH',
    discountAmount: 0,
    notes: null,
    lines: [makeLine('LPG 11kg')],
    createdAt: '2026-06-17T08:00:00.000Z',
    updatedAt: '2026-06-17T08:00:00.000Z',
    ...overrides
  };
}

function makeCustomer(overrides: Partial<DesktopOption>): DesktopOption {
  return {
    id: 'cust-1',
    label: 'Albert',
    province: 'Bulacan',
    city: 'Malolos',
    ...overrides
  };
}

describe('queue order filtering by address', () => {
  it('matches province and city on held queue orders', () => {
    const rows = [
      makeHeldCart({ id: 'queue-1', customerName: 'Albert', customerProvince: 'Bulacan', customerCity: 'Malolos' }),
      makeHeldCart({ id: 'queue-2', customerName: 'Bea', customerProvince: 'Pampanga', customerCity: 'San Fernando' }),
      makeHeldCart({ id: 'queue-3', customerName: 'Cara', customerProvince: null, customerCity: null })
    ];

    const filtered = filterQueueOrdersByAddress(rows, {
      search: '',
      province: 'Bulacan',
      city: 'Malolos'
    });

    expect(filtered.map((row) => row.id)).toEqual(['queue-1']);
  });

  it('uses the linked customer province and city when the held cart does not have them yet', () => {
    const rows = [
      makeHeldCart({
        id: 'queue-4',
        customerId: 'cust-4',
        customerName: 'Dina',
        customerProvince: null,
        customerCity: null
      })
    ];
    const customers = [
      makeCustomer({
        id: 'cust-4',
        label: 'Dina',
        province: 'Pampanga',
        city: 'San Fernando'
      })
    ];

    const options = buildQueueOrderAddressOptions(rows, customers, 'ALL');
    expect(options.provinceOptions).toEqual(['Pampanga']);
    expect(options.cityOptions).toEqual(['San Fernando']);

    const filtered = filterQueueOrdersByAddress(
      rows,
      {
        search: '',
        province: 'Pampanga',
        city: 'San Fernando'
      },
      customers
    );

    expect(filtered.map((row) => row.id)).toEqual(['queue-4']);
  });

  it('matches queued orders by amount text', () => {
    const rows = [
      makeHeldCart({ id: 'queue-5' }),
      makeHeldCart({
        id: 'queue-6',
        lines: [
          {
            ...makeLine('LPG 22kg'),
            unitPrice: 240,
            lineTotal: 240
          }
        ]
      })
    ];

    const filtered = filterQueueOrdersByAddress(rows, {
      search: '240',
      province: 'ALL',
      city: 'ALL'
    });

    expect(filtered.map((row) => row.id)).toEqual(['queue-6']);
  });
});
