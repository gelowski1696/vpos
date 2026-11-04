import type { DesktopOption, DesktopSaleRecord } from './schema';

export type DesktopCustomerTransactionFilter = 'ALL' | 'BALANCE' | 'PENDING' | 'SYNCED' | 'CANCELLED';

export type DesktopCustomerSummary = {
  count: number;
  balance: number;
  points: number;
  withBalance: number;
};

export type DesktopCustomerTransactionSummary = {
  count: number;
  total: number;
  balance: number;
};

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function desktopCustomerCode(customer: DesktopOption): string {
  const first = (customer.subtitle ?? '')
    .split(/[|\u00b7]/)
    .map((value) => value.trim())
    .find(Boolean);
  return first || customer.id;
}

export function filterDesktopCustomers(customers: DesktopOption[], search: string): DesktopOption[] {
  const query = search.trim().toLowerCase();
  if (!query) return customers;
  return customers.filter((customer) => [
    customer.label,
    desktopCustomerCode(customer),
    customer.address,
    customer.contactNumber,
    customer.gas,
    customer.province,
    customer.city,
    customer.balance,
    customer.pointsBalance
  ].filter((value) => value !== null && value !== undefined).join(' ').toLowerCase().includes(query));
}

export function paginateDesktopCustomers(
  customers: DesktopOption[],
  requestedPage: number,
  requestedPageSize: number
): { items: DesktopOption[]; page: number; pageSize: number; totalPages: number } {
  const pageSize = Math.max(1, Math.floor(finiteNumber(requestedPageSize)) || 10);
  const totalPages = Math.max(1, Math.ceil(customers.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(finiteNumber(requestedPage)) || 1));
  const start = (page - 1) * pageSize;
  return { items: customers.slice(start, start + pageSize), page, pageSize, totalPages };
}

export function summarizeDesktopCustomers(customers: DesktopOption[]): DesktopCustomerSummary {
  return customers.reduce<DesktopCustomerSummary>((summary, customer) => {
    const balance = finiteNumber(customer.balance);
    return {
      count: summary.count + 1,
      balance: summary.balance + balance,
      points: summary.points + finiteNumber(customer.pointsBalance),
      withBalance: summary.withBalance + (balance > 0 ? 1 : 0)
    };
  }, { count: 0, balance: 0, points: 0, withBalance: 0 });
}

export function filterDesktopCustomersWithBalance(customers: DesktopOption[], search: string): DesktopOption[] {
  const query = search.trim().toLowerCase();
  return customers
    .filter((customer) => finiteNumber(customer.balance) > 0)
    .filter((customer) => !query || [
      customer.label,
      desktopCustomerCode(customer),
      customer.address
    ].filter(Boolean).join(' ').toLowerCase().includes(query))
    .sort((left, right) => finiteNumber(right.balance) - finiteNumber(left.balance));
}

export function isDesktopCustomerSaleCancelled(sale: DesktopSaleRecord): boolean {
  return String(sale.saleStatus ?? 'ACTIVE').trim().toUpperCase() === 'CANCELLED';
}

export function desktopCustomerSaleStatus(sale: DesktopSaleRecord): string {
  return isDesktopCustomerSaleCancelled(sale)
    ? 'CANCELLED'
    : String(sale.syncStatus ?? 'pending').trim().toUpperCase();
}

export function matchDesktopCustomerSales(sales: DesktopSaleRecord[], customer: DesktopOption): DesktopSaleRecord[] {
  const customerName = customer.label.trim().toLowerCase();
  return sales
    .filter((sale) =>
      sale.payload.customerId === customer.id ||
      sale.payload.customerName?.trim().toLowerCase() === customerName
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function filterDesktopCustomerSales(
  sales: DesktopSaleRecord[],
  search: string,
  filter: DesktopCustomerTransactionFilter,
  customer?: DesktopOption | null
): DesktopSaleRecord[] {
  const query = search.trim().toLowerCase();
  return sales.filter((sale) => {
    const cancelled = isDesktopCustomerSaleCancelled(sale);
    const balance = finiteNumber(sale.payload.creditBalance);
    const syncStatus = String(sale.syncStatus ?? '').trim().toLowerCase();
    if (filter === 'BALANCE' && (balance <= 0 || cancelled)) return false;
    if (filter === 'PENDING' && syncStatus !== 'pending') return false;
    if (filter === 'SYNCED' && syncStatus !== 'synced') return false;
    if (filter === 'CANCELLED' && !cancelled) return false;
    if (!query) return true;
    return [
      sale.receiptNumber,
      sale.id,
      sale.payload.customerName ?? customer?.label,
      customer?.address,
      sale.payload.saleType,
      sale.payload.paymentMethod,
      sale.syncStatus
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
}

export function summarizeDesktopCustomerSales(sales: DesktopSaleRecord[]): DesktopCustomerTransactionSummary {
  return sales.reduce<DesktopCustomerTransactionSummary>((summary, sale) => ({
    count: summary.count + 1,
    total: summary.total + finiteNumber(sale.payload.totalAmount),
    balance: summary.balance + (isDesktopCustomerSaleCancelled(sale) ? 0 : finiteNumber(sale.payload.creditBalance))
  }), { count: 0, total: 0, balance: 0 });
}

export function desktopCustomerPaymentValidationError(amountValue: unknown, balanceValue: unknown): string | null {
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than 0.';
  if (amount > finiteNumber(balanceValue)) return 'Amount cannot be greater than the customer balance.';
  return null;
}
