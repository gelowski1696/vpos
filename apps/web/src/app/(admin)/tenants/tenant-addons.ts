export type TenantAddonKey =
  | 'email_features'
  | 'email_report'
  | 'email_customer_balance'
  | 'custom_pricing'
  | 'customer_category'
  | 'item_price_cost_audit'
  | 'petty_cash_attachments'
  | 'shift_security_controls'
  | 'kilo_overview_chart'
  | 'receipt_amount_privacy'
  | 'purchase_order_suite'
  | 'delivery_dispatch_suite'
  | 'queue_order_filtering'
  | 'cashier_end_of_day_inventory_count'
  | 'customer_pricelist_view';

export type TenantAddonDisplay = {
  key: TenantAddonKey;
  label: string;
  description: string;
};

export type TenantAddonGroup = {
  title: string;
  description: string;
  items: TenantAddonKey[];
};

export const TENANT_ADDON_DISPLAY: TenantAddonDisplay[] = [
  {
    key: 'email_features',
    label: 'Email Features',
    description: 'Enable tenant email integrations and outbound notices.'
  },
  {
    key: 'email_report',
    label: 'Email Report',
    description: 'Send reports and summaries by email.'
  },
  {
    key: 'email_customer_balance',
    label: 'Email Customer Balance',
    description: 'Share customer balance statements by email.'
  },
  {
    key: 'custom_pricing',
    label: 'Custom Pricing',
    description: 'Unlock tenant-specific price lists and overrides.'
  },
  {
    key: 'customer_category',
    label: 'Customer Category',
    description: 'Group customers into custom categories.'
  },
  {
    key: 'item_price_cost_audit',
    label: 'Item Price/Cost Audit',
    description: 'Track item price and cost changes for review.'
  },
  {
    key: 'petty_cash_attachments',
    label: 'Petty Cash Attachments',
    description: 'Attach receipt files to petty cash entries.'
  },
  {
    key: 'shift_security_controls',
    label: 'Shift Security Controls',
    description: 'Tighten cashier shift open, close, and access checks.'
  },
  {
    key: 'kilo_overview_chart',
    label: 'Kilo Overview Chart',
    description: 'Show kilo-based performance charts in the dashboard.'
  },
  {
    key: 'receipt_amount_privacy',
    label: 'Receipt Amount Privacy',
    description: 'Hide transaction totals on printed receipts.'
  },
  {
    key: 'purchase_order_suite',
    label: 'Purchase Order Suite',
    description: 'Enable purchase order workflows in POS.'
  },
  {
    key: 'delivery_dispatch_suite',
    label: 'Delivery Dispatch Suite',
    description: 'Enable dispatch scheduling and status tracking.'
  },
  {
    key: 'queue_order_filtering',
    label: 'Queue Order Filtering',
    description: 'Filter queued orders by address when the add-on is on.'
  },
  {
    key: 'cashier_end_of_day_inventory_count',
    label: 'Cashier End of Day Inventory Count',
    description: 'Capture cashier-entered counts after close shift before finalizing the day.'
  },
  {
    key: 'customer_pricelist_view',
    label: 'Customer Pricelist View',
    description: 'Show applicable price lists and the resolved final price per customer.'
  }
];

export const TENANT_ADDON_GROUPS: TenantAddonGroup[] = [
  {
    title: 'Core Communications',
    description: 'Email and customer balance notices.',
    items: ['email_features', 'email_report', 'email_customer_balance']
  },
  {
    title: 'Shift & Inventory',
    description: 'Cashier closeout and inventory capture controls.',
    items: ['shift_security_controls', 'cashier_end_of_day_inventory_count', 'kilo_overview_chart']
  },
  {
    title: 'Sales & Ordering',
    description: 'POS ordering and dispatch workflows.',
    items: ['purchase_order_suite', 'delivery_dispatch_suite', 'queue_order_filtering']
  },
  {
    title: 'Pricing & Customer',
    description: 'Customer-facing pricing and classification tools.',
    items: ['custom_pricing', 'customer_category', 'customer_pricelist_view']
  },
  {
    title: 'Operations & Audit',
    description: 'Cash handling, privacy, and operational audit helpers.',
    items: ['item_price_cost_audit', 'petty_cash_attachments', 'receipt_amount_privacy']
  }
];
