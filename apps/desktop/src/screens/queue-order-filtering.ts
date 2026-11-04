import type { DesktopHeldCartRecord, DesktopOption } from '../db/schema';

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSelectValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === 'all' ? '' : normalized;
}

function matchesText(haystack: string, term: string): boolean {
  return term.length === 0 || haystack.includes(term);
}

function buildCustomerAddressMap(customers: DesktopOption[]): Map<string, DesktopOption> {
  return new Map(customers.map((customer) => [customer.id, customer]));
}

export function resolveQueueOrderAddress(
  row: Pick<DesktopHeldCartRecord, 'customerId' | 'customerProvince' | 'customerCity'>,
  customersById: Map<string, DesktopOption>
): { province: string | null; city: string | null } {
  const customer = row.customerId ? customersById.get(row.customerId) ?? null : null;
  const province = row.customerProvince?.trim() || customer?.province?.trim() || null;
  const city = row.customerCity?.trim() || customer?.city?.trim() || null;
  return { province, city };
}

export function buildQueueOrderAddressOptions(
  rows: DesktopHeldCartRecord[],
  customers: DesktopOption[],
  selectedProvince = 'ALL'
): {
  provinceOptions: string[];
  cityOptions: string[];
} {
  const customersById = buildCustomerAddressMap(customers);
  const provinceValues = new Set<string>();
  const cityValues = new Set<string>();
  const selectedProvinceTerm = normalizeSelectValue(selectedProvince);

  rows.forEach((row) => {
    const { province, city } = resolveQueueOrderAddress(row, customersById);
    if (province) {
      provinceValues.add(province);
    }
    if (selectedProvinceTerm && province?.trim().toLowerCase() !== selectedProvinceTerm) {
      return;
    }
    if (city) {
      cityValues.add(city);
    }
  });

  return {
    provinceOptions: [...provinceValues].sort((left, right) => left.localeCompare(right)),
    cityOptions: [...cityValues].sort((left, right) => left.localeCompare(right))
  };
}

export function filterQueueOrdersByAddress(
  rows: DesktopHeldCartRecord[],
  filters: {
    search: string;
    province: string;
    city: string;
  },
  customers: DesktopOption[] = []
): DesktopHeldCartRecord[] {
  const searchTerm = normalizeSearchValue(filters.search);
  const provinceTerm = normalizeSelectValue(filters.province);
  const cityTerm = normalizeSelectValue(filters.city);
  const customersById = buildCustomerAddressMap(customers);

  return rows.filter((row) => {
    const { province, city } = resolveQueueOrderAddress(row, customersById);
    const rowProvince = province?.trim().toLowerCase() ?? '';
    const rowCity = city?.trim().toLowerCase() ?? '';
    if (provinceTerm && rowProvince !== provinceTerm) {
      return false;
    }
    if (cityTerm && rowCity !== cityTerm) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    const searchable = [
      row.label,
      row.customerName ?? '',
      province ?? '',
      city ?? '',
      row.lines
        .reduce(
          (sum, line) => sum + line.lineTotal,
          0
        )
        .toFixed(2),
      row.lines.map((line) => line.productName).join(' ')
    ]
      .join(' ')
      .toLowerCase();

    return matchesText(searchable, searchTerm);
  });
}
