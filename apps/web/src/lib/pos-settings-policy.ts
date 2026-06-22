export type TenantPosSettings = {
  reports_enabled: boolean;
  inventory_reports_enabled: boolean;
  customers_enabled: boolean;
  items_enabled: boolean;
  transfer_enabled: boolean;
  lending_enabled: boolean;
  expense_enabled: boolean;
  shift_enabled: boolean;
  settings_enabled: boolean;
  purchase_orders_enabled: boolean;
  delivery_dispatch_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type TenantPosSettingsDraft = Omit<TenantPosSettings, 'updated_at' | 'updated_by'>;

export type PosSettingsAddonFlags = {
  purchase_order_suite: boolean;
  delivery_dispatch_suite: boolean;
};

export type PosSettingsControlKey = keyof TenantPosSettingsDraft;

export type PosSettingsControlDefinition = {
  key: PosSettingsControlKey;
  label: string;
  description: string;
  addon?: keyof PosSettingsAddonFlags;
};

export type PosSettingsControlGroup = {
  title: string;
  description: string;
  items: PosSettingsControlDefinition[];
};

export const DEFAULT_TENANT_POS_SETTINGS: TenantPosSettings = {
  reports_enabled: true,
  inventory_reports_enabled: true,
  customers_enabled: true,
  items_enabled: true,
  transfer_enabled: true,
  lending_enabled: true,
  expense_enabled: true,
  shift_enabled: true,
  settings_enabled: true,
  purchase_orders_enabled: true,
  delivery_dispatch_enabled: true,
  updated_at: new Date(0).toISOString(),
  updated_by: null
};

export const POS_SETTINGS_CONTROL_GROUPS: PosSettingsControlGroup[] = [
  {
    title: 'Operations',
    description: 'Control branch workflow screens used during transfer, lending, shift, and workstation operations.',
    items: [
      {
        key: 'transfer_enabled',
        label: 'Transfer',
        description: 'Allow desktop users to create and review transfer records.'
      },
      {
        key: 'lending_enabled',
        label: 'Lending',
        description: 'Allow desktop users to access lending and return history screens.'
      },
      {
        key: 'shift_enabled',
        label: 'Shift',
        description: 'Allow shift open and close operations from the desktop workstation.'
      },
      {
        key: 'settings_enabled',
        label: 'Settings',
        description: 'Allow workstation setup, printer, and local device maintenance screens.'
      }
    ]
  },
  {
    title: 'Inventory',
    description: 'Control inventory-heavy desktop modules and add-on stock workflows.',
    items: [
      {
        key: 'items_enabled',
        label: 'Items',
        description: 'Allow desktop users to browse the branch item catalog outside live checkout.'
      },
      {
        key: 'inventory_reports_enabled',
        label: 'Inventory Reports',
        description: 'Allow the daily inventory count and inventory snapshot report section.'
      },
      {
        key: 'purchase_orders_enabled',
        label: 'Purchase Orders',
        description: 'Allow desktop purchase-order workflows when the add-on is licensed.',
        addon: 'purchase_order_suite'
      },
      {
        key: 'delivery_dispatch_enabled',
        label: 'Delivery Dispatch',
        description: 'Allow desktop dispatch workflows when the add-on is licensed.',
        addon: 'delivery_dispatch_suite'
      }
    ]
  },
  {
    title: 'Financial',
    description: 'Control reporting and petty cash access from the desktop application.',
    items: [
      {
        key: 'reports_enabled',
        label: 'Reports',
        description: 'Allow the cashier reports workspace and desktop analytics screens.'
      },
      {
        key: 'expense_enabled',
        label: 'Expense',
        description: 'Allow petty cash entry and expense review modules.'
      }
    ]
  },
  {
    title: 'Customer Access',
    description: 'Control customer lookup access outside the live POS transaction flow.',
    items: [
      {
        key: 'customers_enabled',
        label: 'Customers',
        description: 'Allow desktop users to browse customers, balances, and recent customer activity.'
      }
    ]
  }
];

export function toPosSettingsDraft(policy: TenantPosSettings): TenantPosSettingsDraft {
  const {
    updated_at: _updatedAt,
    updated_by: _updatedBy,
    ...draft
  } = policy;
  return draft;
}

export function canManagePosSettings(roles: string[]): boolean {
  return roles.some((role) => ['admin', 'owner', 'platform_owner'].includes(role.trim().toLowerCase()));
}
