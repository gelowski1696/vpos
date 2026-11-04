import type { DesktopAppState } from '../db/schema';
import { desktopAuthService } from './desktop-auth.service';

export type DesktopSalesSummary = {
  sale_count: number;
  total_sales: number;
  discount_total: number;
  payments: Array<{ method: string; amount: number }>;
};

export type DesktopSalesListRow = {
  sale_id: string;
  receipt_number: string | null;
  customer_name: string | null;
  customer_address: string | null;
  total_amount: number;
  created_at: string;
};

export type DesktopSalesReturnRow = {
  sale_return_id: string;
  sale_id: string;
  receipt_number: string | null;
  customer_name: string | null;
  total_amount: number;
  created_at: string;
};

export type DesktopXReadRow = {
  shift_id: string;
  branch_name: string;
  cashier_name: string;
  opened_at: string;
  sale_count: number;
  total_sales: number;
};

export type DesktopActiveShiftRow = {
  shift_id: string;
  branch_name: string;
  cashier_name: string;
  opened_at: string;
  sale_count: number;
  total_sales: number;
};

export type DesktopCustomerRecord = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  outstandingBalance?: number;
};

export type DesktopCustomerPaymentRow = {
  payment_id: string;
  customer_name: string | null;
  amount: number;
  posted_at: string;
};

export type DesktopLendingRow = {
  lending_id: string;
  customer_name: string | null;
  status: string;
};

export type DesktopCashierReportBundle = {
  salesSummary: DesktopSalesSummary;
  salesRows: DesktopSalesListRow[];
  salesReturns: DesktopSalesReturnRow[];
  xReadRows: DesktopXReadRow[];
  activeShiftRows: DesktopActiveShiftRow[];
  customers: DesktopCustomerRecord[];
  customerPayments: DesktopCustomerPaymentRow[];
  lendingRows: DesktopLendingRow[];
};

export type DesktopCashierReportFilters = {
  since: string;
  until: string;
  branchId?: string | null;
  locationId?: string | null;
};

const EMPTY_BUNDLE: DesktopCashierReportBundle = {
  salesSummary: {
    sale_count: 0,
    total_sales: 0,
    discount_total: 0,
    payments: [],
  },
  salesRows: [],
  salesReturns: [],
  xReadRows: [],
  activeShiftRows: [],
  customers: [],
  customerPayments: [],
  lendingRows: [],
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function buildSharedQuery(filters: DesktopCashierReportFilters): string {
  const params = new URLSearchParams();
  params.set('since', filters.since);
  params.set('until', filters.until);
  if (filters.branchId?.trim()) {
    params.set('branch_id', filters.branchId.trim());
  }
  if (filters.locationId?.trim()) {
    params.set('location_id', filters.locationId.trim());
  }
  return params.toString();
}

export class DesktopCashierReportsService {
  private async authorizedJson<T>(
    state: DesktopAppState,
    path: string
  ): Promise<{ data: T; state: DesktopAppState }> {
    const url = `${normalizeBaseUrl(state.setup.apiBaseUrl)}${path}`;
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      url,
      { method: 'GET' }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Unable to load report data (${response.status})`);
    }
    return { data: (await response.json()) as T, state: nextState };
  }

  async loadSnapshot(
    state: DesktopAppState,
    filters: DesktopCashierReportFilters
  ): Promise<{ data: DesktopCashierReportBundle; state: DesktopAppState }> {
    if (!state.auth.accessToken?.trim()) {
      return { data: EMPTY_BUNDLE, state };
    }

    let workingState = state;
    const shared = buildSharedQuery(filters);
    const branchId = filters.branchId?.trim() ?? '';

    const salesSummaryResult = await this.authorizedJson<DesktopSalesSummary>(
      workingState,
      `/reports/sales/summary?${shared}`
    );
    workingState = salesSummaryResult.state;

    const salesListResult = await this.authorizedJson<{ rows?: DesktopSalesListRow[] }>(
      workingState,
      `/reports/sales/list?${shared}&limit=25`
    );
    workingState = salesListResult.state;

    const salesReturnsResult = await this.authorizedJson<{ rows?: DesktopSalesReturnRow[] }>(
      workingState,
      `/reports/sales/returns?${shared}&limit=25`
    );
    workingState = salesReturnsResult.state;

    const xReadResult = await this.authorizedJson<{ x_read?: DesktopXReadRow[] }>(
      workingState,
      `/reports/sales/xz-read?${shared}&limit=12`
    );
    workingState = xReadResult.state;

    const activeShiftsResult = await this.authorizedJson<{ rows?: DesktopActiveShiftRow[] }>(
      workingState,
      `/reports/shifts/active?branch_id=${encodeURIComponent(branchId)}&limit=12`
    );
    workingState = activeShiftsResult.state;

    const customersResult = await this.authorizedJson<DesktopCustomerRecord[]>(
      workingState,
      `/master-data/customers?include_balance=1&branch_id=${encodeURIComponent(branchId)}`
    );
    workingState = customersResult.state;

    const paymentsResult = await this.authorizedJson<DesktopCustomerPaymentRow[]>(
      workingState,
      `/customer-payments?branch_id=${encodeURIComponent(branchId)}&since=${encodeURIComponent(filters.since)}&until=${encodeURIComponent(filters.until)}&limit=50`
    );
    workingState = paymentsResult.state;

    const lendingResult = await this.authorizedJson<DesktopLendingRow[]>(
      workingState,
      `/lending?branch_id=${encodeURIComponent(branchId)}&status=OPEN&limit=50`
    );
    workingState = lendingResult.state;

    return {
      state: workingState,
      data: {
        salesSummary: salesSummaryResult.data,
        salesRows: salesListResult.data.rows ?? [],
        salesReturns: salesReturnsResult.data.rows ?? [],
        xReadRows: xReadResult.data.x_read ?? [],
        activeShiftRows: activeShiftsResult.data.rows ?? [],
        customers: customersResult.data,
        customerPayments: paymentsResult.data,
        lendingRows: lendingResult.data,
      },
    };
  }
}

export const desktopCashierReportsService = new DesktopCashierReportsService();

