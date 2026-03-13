import type { SQLiteDatabase } from 'expo-sqlite';

type MasterDataRow = {
  entity: string;
  record_id: string;
  payload: string;
  updated_at: string;
};

export type MasterDataOption = {
  id: string;
  label: string;
  subtitle?: string;
  branchId?: string;
  balance?: number;
  group?: string;
  type?: string;
  code?: string;
  locationId?: string;
};

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function resolveId(payload: Record<string, unknown>, fallback: string): string {
  return (
    asString(payload.id) ??
    asString(payload.code) ??
    asString(payload.user_id) ??
    asString(payload.product_id) ??
    asString(payload.customer_id) ??
    fallback
  );
}

function isActive(payload: Record<string, unknown>): boolean {
  const value = asBoolean(payload.isActive) ?? asBoolean(payload.is_active);
  return value !== false;
}

async function loadRows(db: SQLiteDatabase, aliases: string[]): Promise<MasterDataRow[]> {
  if (!aliases.length) {
    return [];
  }

  const normalized = aliases.map((alias) => alias.toLowerCase());
  const placeholders = normalized.map(() => '?').join(', ');
  return db.getAllAsync<MasterDataRow>(
    `
    SELECT entity, record_id, payload, updated_at
    FROM master_data_local
    WHERE lower(entity) IN (${placeholders})
    ORDER BY updated_at DESC
    `,
    ...normalized
  );
}

function dedupe(options: MasterDataOption[]): MasterDataOption[] {
  const map = new Map<string, MasterDataOption>();
  for (const option of options) {
    if (!map.has(option.id)) {
      map.set(option.id, option);
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildOption(args: {
  id: string;
  label: string;
  subtitle?: string;
  branchId?: string;
  group?: string;
  type?: string;
  code?: string;
  locationId?: string;
}): MasterDataOption {
  const option: MasterDataOption = {
    id: args.id,
    label: args.label
  };
  if (args.subtitle) {
    option.subtitle = args.subtitle;
  }
  if (args.branchId) {
    option.branchId = args.branchId;
  }
  if (args.group) {
    option.group = args.group;
  }
  if (args.type) {
    option.type = args.type;
  }
  if (args.code) {
    option.code = args.code;
  }
  if (args.locationId) {
    option.locationId = args.locationId;
  }
  return option;
}

function buildFullName(payload: Record<string, unknown>): string | undefined {
  const direct =
    asString(payload.fullName) ??
    asString(payload.full_name) ??
    asString(payload.displayName) ??
    asString(payload.display_name) ??
    asString(payload.name);
  if (direct) {
    return direct;
  }

  const first = asString(payload.firstName) ?? asString(payload.first_name);
  const middle = asString(payload.middleName) ?? asString(payload.middle_name);
  const last = asString(payload.lastName) ?? asString(payload.last_name);
  const suffix = asString(payload.suffix);
  const combined = [first, middle, last, suffix].filter((value): value is string => Boolean(value)).join(' ').trim();
  return combined || undefined;
}

export async function loadBranchOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['branch', 'branches']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.code);
    const name = asString(payload.name);
    options.push(
      buildOption({
        id,
        label: name ?? code ?? id,
        subtitle: code && name ? code : undefined
      })
    );
  }
  return dedupe(options);
}

export async function loadLocationOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['location', 'locations']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.code);
    const name = asString(payload.name);
    const type = asString(payload.type);
    const branchId = asString(payload.branchId) ?? asString(payload.branch_id);
    options.push(
      buildOption({
        id,
        label: name ?? code ?? id,
        subtitle: [code, type].filter((value): value is string => Boolean(value)).join(' - ') || undefined,
        branchId,
        type: type?.toUpperCase(),
        code
      })
    );
  }
  return dedupe(options);
}

export async function loadSupplierOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['supplier', 'suppliers']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.code);
    const name = asString(payload.name);
    const locationId = asString(payload.locationId) ?? asString(payload.location_id);
    const contactPerson = asString(payload.contactPerson) ?? asString(payload.contact_person);
    options.push(
      buildOption({
        id,
        label: name ?? code ?? id,
        subtitle: [code, contactPerson].filter((value): value is string => Boolean(value)).join(' - ') || undefined,
        code,
        locationId
      })
    );
  }
  return dedupe(options);
}

export async function loadCustomerOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['customer', 'customers']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.code);
    const name = asString(payload.name) ?? asString(payload.display_name);
    const tier = asString(payload.tier);
    const outstandingBalance = asNumber(payload.outstandingBalance ?? payload.outstanding_balance) ?? 0;
    const balanceText = `Bal: PHP ${outstandingBalance.toFixed(2)}`;
    const built = buildOption({
      id,
      label: name ?? code ?? id,
      subtitle:
        [code, tier, balanceText].filter((value): value is string => Boolean(value)).join(' - ') || undefined
    });
    built.balance = Number(Math.max(0, outstandingBalance).toFixed(2));
    options.push(built);
  }
  const deduped = dedupe(options);

  const paymentRows = await db.getAllAsync<{ payload: string; sync_status: string }>(
    `
    SELECT payload, sync_status
    FROM customer_payments_local
    WHERE sync_status IN (?, ?, ?)
    ORDER BY created_at DESC
    `,
    'pending',
    'processing',
    'synced'
  );

  if (paymentRows.length === 0) {
    return deduped;
  }

  const creditsByCustomerId = new Map<string, number>();
  for (const row of paymentRows) {
    const payload = parsePayload(row.payload);
    const customerId =
      asString(payload.customer_id) ??
      asString(payload.customerId) ??
      asString(payload.customer_code) ??
      asString(payload.customerCode);
    const amount = asNumber(payload.amount) ?? 0;
    if (!customerId || amount <= 0) {
      continue;
    }
    creditsByCustomerId.set(
      customerId,
      Number(((creditsByCustomerId.get(customerId) ?? 0) + amount).toFixed(2))
    );
  }

  if (creditsByCustomerId.size === 0) {
    return deduped;
  }

  return deduped.map((option) => {
    const credit = creditsByCustomerId.get(option.id) ?? 0;
    if (credit <= 0) {
      return option;
    }
    const baseBalance = option.balance ?? 0;
    const adjustedBalance = Number(Math.max(0, baseBalance - credit).toFixed(2));
    const cleanedSubtitle = (option.subtitle ?? '')
      .replace(/(?:\s*-\s*)?Bal:\s*PHP\s*\d+(?:\.\d+)?/gi, '')
      .trim()
      .replace(/\s*-\s*$/g, '');
    const subtitle = [cleanedSubtitle || undefined, `Bal: PHP ${adjustedBalance.toFixed(2)}`]
      .filter((value): value is string => Boolean(value))
      .join(' - ');
    return {
      ...option,
      balance: adjustedBalance,
      subtitle
    };
  });
}

export async function loadProductOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['product', 'products']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.itemCode) ?? asString(payload.item_code) ?? asString(payload.sku);
    const name = asString(payload.name);
    const category = asString(payload.category) ?? asString(payload.category_code) ?? 'Uncategorized';
    options.push(
      buildOption({
        id,
        label: name ?? code ?? id,
        subtitle: code && name ? code : undefined,
        group: category
      })
    );
  }
  return dedupe(options);
}

export async function loadUserOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['user', 'users']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const name = buildFullName(payload);
    const email = asString(payload.email);
    const role = asString(payload.role);
    options.push(
      buildOption({
        id,
        label: name ?? email ?? id,
        subtitle: [email, role].filter((value): value is string => Boolean(value)).join(' - ') || undefined
      })
    );
  }
  return dedupe(options);
}

export async function loadPersonnelOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['personnel', 'personnels']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }
    const id = resolveId(payload, row.record_id);
    const code = asString(payload.code);
    const fullName = buildFullName(payload) ?? asString(payload.fullName) ?? asString(payload.full_name);
    const roleName =
      asString(payload.roleName) ??
      asString(payload.role_name) ??
      asString(payload.roleCode) ??
      asString(payload.role_code);
    const branchId = asString(payload.branchId) ?? asString(payload.branch_id);
    options.push(
      buildOption({
        id,
        label: fullName ?? code ?? id,
        subtitle: [code, roleName].filter((value): value is string => Boolean(value)).join(' - ') || undefined,
        branchId
      })
    );
  }
  return dedupe(options);
}

export async function loadExpenseCategoryOptions(db: SQLiteDatabase): Promise<MasterDataOption[]> {
  const rows = await loadRows(db, ['expense_category', 'expense_categories']);
  const options: MasterDataOption[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!isActive(payload)) {
      continue;
    }

    const code =
      asString(payload.code) ??
      asString(payload.categoryCode) ??
      asString(payload.category_code) ??
      asString(payload.id);
    const id = code ?? resolveId(payload, row.record_id);
    const name = asString(payload.name) ?? asString(payload.display_name);

    options.push(
      buildOption({
        id,
        label: name ?? code ?? id,
        subtitle: code && name ? code : undefined
      })
    );
  }
  return dedupe(options);
}
