import { SalesService, hasOpenLinkedLendingRecord } from '../src/modules/sales/sales.service';

describe('sales cancellation lending guard', () => {
  it('allows cancellation when linked lending records are closed', () => {
    expect(
      hasOpenLinkedLendingRecord([{ status: 'CLOSED' }, { status: 'FORCE_CLOSED' }, { status: 'CANCELLED' }])
    ).toBe(false);
  });

  it('blocks cancellation when any linked lending record is still open', () => {
    expect(
      hasOpenLinkedLendingRecord([{ status: 'CLOSED' }, { status: 'PARTIALLY_RETURNED' }, { status: 'OPEN' }])
    ).toBe(true);
  });

  it('splits product commission equally across selected personnel', () => {
    const service = new SalesService();
    const rows = (
      service as unknown as {
        buildEqualSplitCommissionRows(input: {
          companyId: string;
          saleId: string;
          saleType: 'PICKUP' | 'DELIVERY';
          personnel: Array<{
            personnelId: string | null;
            personnelCode: string | null;
            personnelName: string;
            personnelRole: string | null;
          }>;
          lines: Array<{
            saleLineId: string;
            productId: string;
            quantity: number;
            commissionRate: number;
          }>;
        }): Array<{
          personnelId: string | null;
          personnelNameSnapshot: string;
          splitPercent: number;
          commissionAmount: number;
        }>;
      }
    ).buildEqualSplitCommissionRows({
      companyId: 'comp-demo',
      saleId: 'sale-commission-1',
      saleType: 'DELIVERY',
      personnel: [
        {
          personnelId: 'personnel-driver-1',
          personnelCode: 'PDR1',
          personnelName: 'Demo Driver',
          personnelRole: 'DRIVER'
        },
        {
          personnelId: 'personnel-helper-1',
          personnelCode: 'PHL1',
          personnelName: 'Demo Helper',
          personnelRole: 'HELPER'
        }
      ],
      lines: [
        {
          saleLineId: 'line-1',
          productId: 'prod-11',
          quantity: 3,
          commissionRate: 10
        }
      ]
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.commissionAmount)).toEqual([15, 15]);
    expect(rows.map((row) => row.splitPercent)).toEqual([50, 50]);
    expect(rows.reduce((sum, row) => sum + row.commissionAmount, 0)).toBe(30);
  });

  it('does not infer a duplicate driver commission candidate for pickup personnel', () => {
    const service = new SalesService();
    const candidates = (
      service as unknown as {
        buildCommissionPersonnelCandidates(input: {
          sale_type?: 'PICKUP' | 'DELIVERY';
          personnel_id?: string | null;
          personnel_name?: string | null;
          personnel?: Array<{ userId?: string; role?: string; name?: string | null }>;
        }): Array<{
          ref: string | null;
          name: string | null;
          role: string;
        }>;
      }
    ).buildCommissionPersonnelCandidates({
      sale_type: 'PICKUP',
      personnel_id: 'EMP2',
      personnel_name: 'EMP2 - Employee 2',
      personnel: [{ userId: 'EMP2', role: 'DRIVER', name: 'EMP2 - Employee 2' }]
    });

    expect(candidates).toEqual([
      {
        ref: 'EMP2',
        name: 'EMP2 - Employee 2',
        role: 'PERSONNEL'
      }
    ]);
  });

  it('treats legacy delivery personnel fields as a single driver candidate', () => {
    const service = new SalesService();
    const candidates = (
      service as unknown as {
        buildCommissionPersonnelCandidates(input: {
          sale_type?: 'PICKUP' | 'DELIVERY';
          personnel_id?: string | null;
          personnel_name?: string | null;
          personnel?: Array<{ userId?: string; role?: string; name?: string | null }>;
        }): Array<{
          ref: string | null;
          name: string | null;
          role: string;
        }>;
      }
    ).buildCommissionPersonnelCandidates({
      sale_type: 'DELIVERY',
      personnel_id: 'EMP2',
      personnel_name: 'EMP2 - Employee 2',
      personnel: [{ userId: 'EMP2', role: 'DRIVER', name: 'EMP2 - Employee 2' }]
    });

    expect(candidates).toEqual([
      {
        ref: 'EMP2',
        name: 'EMP2 - Employee 2',
        role: 'DRIVER'
      }
    ]);
  });
});
