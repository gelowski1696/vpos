'use client';

import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminWalkthrough, type AdminTourStep } from './admin-walkthrough';
import { ChatWidget } from './chat/ChatWidget';
import {
  InventoryShiftItemBreakdown,
  type DailyInventoryShiftRow
} from '../app/(admin)/inventory-daily-count/inventory-shift-item-breakdown';
import {
  apiRequest,
  clearAuthSession,
  getAccessToken,
  getSessionRequiresPasswordChange,
  getSessionRoles
} from '../lib/api-client';
import {
  buildAfterShiftInventorySyncNotification,
  resolveInventoryCountDiscrepancyStatus,
  type AfterShiftInventorySyncNotification,
  type InventoryCountDiscrepancyStatus,
  type InventorySyncAuditRow
} from '../lib/inventory-sync-notification';
import { canManagePosSettings } from '../lib/pos-settings-policy';

type ThemeMode = 'light' | 'dark';

type BrandingTheme = {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
};

type TenantAddons = {
  email_features: boolean;
  email_report: boolean;
  email_customer_balance: boolean;
  sms_alerts: boolean;
  auto_report_digest: boolean;
  custom_pricing: boolean;
  customer_category: boolean;
  item_price_cost_audit: boolean;
  petty_cash_attachments: boolean;
  shift_security_controls: boolean;
  kilo_overview_chart: boolean;
  receipt_amount_privacy: boolean;
  purchase_order_suite: boolean;
  delivery_dispatch_suite: boolean;
  queue_order_filtering: boolean;
  cashier_end_of_day_inventory_count: boolean;
  customer_pricelist_view: boolean;
};

type CurrentEntitlement = {
  addons?: Partial<TenantAddons>;
};

const DEFAULT_TENANT_ADDONS: TenantAddons = {
  email_features: false,
  email_report: false,
  email_customer_balance: false,
  sms_alerts: false,
  auto_report_digest: false,
  custom_pricing: false,
  customer_category: false,
  item_price_cost_audit: false,
  petty_cash_attachments: false,
  shift_security_controls: false,
  kilo_overview_chart: false,
  receipt_amount_privacy: false,
  purchase_order_suite: false,
  delivery_dispatch_suite: false,
  queue_order_filtering: false,
  cashier_end_of_day_inventory_count: false,
  customer_pricelist_view: false
};

type TenantAddonKey = keyof TenantAddons;

const NAV_ROUTE_ADDON_GUARDS: Partial<Record<string, TenantAddonKey>> = {
  '/customer-categories': 'customer_category',
  '/purchase-orders': 'purchase_order_suite',
  '/delivery-dispatch': 'delivery_dispatch_suite'
};

const NAV_ROUTE_ADDON_BADGES: Partial<Record<string, TenantAddonKey>> = {
  '/customer-categories': 'customer_category',
  '/purchase-orders': 'purchase_order_suite',
  '/delivery-dispatch': 'delivery_dispatch_suite'
};

const SIDEBAR_ADDON_SECTION_TITLE = 'Add-Ons';

const ADDON_SIDEBAR_SHORTCUTS: Array<{ addon: TenantAddonKey; item: NavItem }> = [
  {
    addon: 'custom_pricing',
    item: {
      href: '/price-lists' as Route,
      label: 'Custom Pricing',
      icon: 'pricing',
      badge: 'Add-on'
    }
  },
  {
    addon: 'purchase_order_suite',
    item: {
      href: '/purchase-orders' as Route,
      label: 'Purchase Orders',
      icon: 'supplier',
      badge: 'Add-on'
    }
  },
  {
    addon: 'delivery_dispatch_suite',
    item: {
      href: '/delivery-dispatch' as Route,
      label: 'Delivery Dispatch',
      icon: 'transfer',
      badge: 'Add-on'
    }
  },
  {
    addon: 'customer_pricelist_view',
    item: {
      href: '/customer-viewing' as Route,
      label: 'Customer Viewing',
      icon: 'customer',
      badge: 'Add-on'
    }
  }
];

type NavItem = {
  href: Route;
  label: string;
  icon: NavIconName;
  badge?: string;
};

type NavSearchItem = NavItem & {
  sectionTitle: string;
};

type GlobalSalesSearchRow = {
  sale_id: string;
  receipt_number: string | null;
  branch_code: string;
  branch_name: string;
  location_code: string;
  location_name: string;
  customer_name: string | null;
  customer_code: string | null;
  total_amount: number;
  posted_at: string | null;
  created_at: string;
};

type GlobalCustomerSearchRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  tier: string | null;
  isActive: boolean;
};

type GlobalProductSearchRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  isLpg: boolean;
  isActive: boolean;
};

type InventoryNotificationDailyReport = {
  closed_shifts: DailyInventoryShiftRow[];
  open_shifts: DailyInventoryShiftRow[];
};

type SearchResultGroup = 'Pages' | 'Sales' | 'Customers' | 'Products';

type SearchResultItem = {
  id: string;
  group: SearchResultGroup;
  label: string;
  description: string;
  target: string;
  route: Route;
  icon: NavIconName;
  trailing?: string;
};

type NavIconName =
  | 'dashboard'
  | 'sales'
  | 'transfer'
  | 'card'
  | 'branch'
  | 'location'
  | 'users'
  | 'customer'
  | 'supplier'
  | 'customerPayment'
  | 'product'
  | 'cylinder'
  | 'pricing'
  | 'costing'
  | 'expense'
  | 'branding'
  | 'audit'
  | 'tenant'
  | 'syncReview';

const THEME_STORAGE_KEY = 'vpos_admin_theme';
const SIDEBAR_STORAGE_KEY = 'vpos_admin_sidebar_collapsed';
const INVENTORY_SYNC_NOTIFICATION_READ_STORAGE_KEY = 'vpos_admin_inventory_sync_notification_read_ids';
const MAX_INVENTORY_SYNC_NOTIFICATION_READ_IDS = 60;
const ADMIN_WALKTHROUGH_DONE_KEY = 'vpos_web_admin_walkthrough_v1_done';
const ADMIN_ROUTE_WALKTHROUGH_DONE_PREFIX = 'vpos_web_admin_walkthrough_route_';

const ADMIN_WALKTHROUGH_STEPS: AdminTourStep[] = [
  {
    id: 'workspace',
    title: 'Welcome to Web Admin',
    description: 'This is your workspace. You can manage operations, track sales, and maintain branch master data from here.',
    selectors: ['[data-tour="workspace"]'],
    placement: 'bottom'
  },
  {
    id: 'sidebar',
    title: 'Use the left menu to navigate',
    description: 'Modules are grouped by business flow: Sales, Inventory, Stock Movement, and Settings.',
    selectors: ['[data-tour="sidebar-nav"]', '[data-tour="mobile-nav-list"]'],
    placement: 'auto'
  },
  {
    id: 'dashboard',
    title: 'Start with Dashboard',
    description: 'Use Dashboard for daily KPIs, branch health, and quick visibility of operations.',
    selectors: ['[data-tour="nav-dashboard"]', '[data-tour="mobile-nav-dashboard"]'],
    placement: 'bottom'
  },
  {
    id: 'sales-list',
    title: 'Sales list and transaction details',
    description: 'Open Sales List to review posted transactions, balances, personnel, and payment breakdowns.',
    selectors: ['[data-tour="nav-sales-list"]', '[data-tour="mobile-nav-sales-list"]'],
    placement: 'bottom'
  },
  {
    id: 'products',
    title: 'Maintain products and stock rules',
    description: 'Configure products, categories, brands, and pricing so POS and reports stay accurate.',
    selectors: ['[data-tour="nav-products"]', '[data-tour="mobile-nav-products"]'],
    placement: 'bottom'
  },
  {
    id: 'search',
    title: 'Quick module search',
    description: 'Use search to quickly jump your attention while working across many modules.',
    selectors: ['[data-tour="global-search"]'],
    placement: 'bottom'
  },
  {
    id: 'theme',
    title: 'Personalize your display mode',
    description: 'Toggle between light and dark mode for comfort during long operating hours.',
    selectors: ['[data-tour="theme-toggle"]'],
    placement: 'bottom'
  },
  {
    id: 'logout',
    title: 'Secure logout',
    description: 'Use Logout whenever you leave the workstation to keep business data protected.',
    selectors: ['[data-tour="logout"]'],
    placement: 'top'
  }
];

function routeToTourToken(href: string): string {
  const token = href.replace(/^\/+/, '').replace(/\//g, '-').trim();
  return token.length > 0 ? token : 'dashboard';
}

function routeWalkthroughDoneKey(route: string): string {
  return `${ADMIN_ROUTE_WALKTHROUGH_DONE_PREFIX}${routeToTourToken(route)}`;
}

function readInventoryNotificationReadIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(INVENTORY_SYNC_NOTIFICATION_READ_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(-MAX_INVENTORY_SYNC_NOTIFICATION_READ_IDS);
  } catch {
    return [];
  }
}

function persistInventoryNotificationReadIds(ids: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  const compactIds = Array.from(new Set(ids.filter((value) => value.trim().length > 0))).slice(
    -MAX_INVENTORY_SYNC_NOTIFICATION_READ_IDS
  );
  window.localStorage.setItem(INVENTORY_SYNC_NOTIFICATION_READ_STORAGE_KEY, JSON.stringify(compactIds));
}

function formatInventoryNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatInventoryCount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString();
  }
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatInventorySignedCount(value: number): string {
  if (value === 0) {
    return '0';
  }
  return `${value > 0 ? '+' : '-'}${formatInventoryCount(Math.abs(value))}`;
}

function formatInventorySnapshotCount(summary: DailyInventoryShiftRow['opening_snapshot_summary']): string {
  if (!summary) {
    return 'Not captured';
  }
  return `${formatInventoryCount(summary.qty_on_hand)} on hand`;
}

function inventoryCountDiscrepancyLabel(status: InventoryCountDiscrepancyStatus): string {
  if (status === 'mismatch') {
    return 'Discrepancy';
  }
  if (status === 'match') {
    return 'No discrepancy';
  }
  return 'Checking count';
}

function inventoryCountDiscrepancyPillClass(status: InventoryCountDiscrepancyStatus): string {
  if (status === 'mismatch') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-300';
  }
  if (status === 'match') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-300';
  }
  return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function inventoryCountDiscrepancyCardClass(status: InventoryCountDiscrepancyStatus): string {
  if (status === 'mismatch') {
    return 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30';
  }
  if (status === 'match') {
    return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30';
  }
  return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60';
}

function inventoryCountDiscrepancyTextClass(status: InventoryCountDiscrepancyStatus): string {
  if (status === 'mismatch') {
    return 'text-rose-700 dark:text-rose-300';
  }
  if (status === 'match') {
    return 'text-emerald-700 dark:text-emerald-300';
  }
  return 'text-slate-900 dark:text-slate-100';
}

function buildInventoryDailyReportPath(reportDate: string): string {
  const since = new Date(`${reportDate}T00:00:00`).toISOString();
  const until = new Date(`${reportDate}T23:59:59.999`).toISOString();
  const params = new URLSearchParams({ since, until });
  return `/reports/inventory/daily-count?${params.toString()}`;
}

function buildEntityRouteSteps(route: string, slug: string, label: string): AdminTourStep[] {
  const token = routeToTourToken(route);
  return [
    {
      id: `${token}-intro`,
      title: `${label} module`,
      description: `This page manages ${label.toLowerCase()} records for your branch operations.`,
      selectors: [`[data-tour="nav-${token}"]`, `[data-tour="mobile-nav-${token}"]`, '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: `${token}-search`,
      title: 'Search and locate records',
      description: 'Use search to quickly find existing entries before creating new records.',
      selectors: [`[data-tour="${slug}-entity-search"]`],
      placement: 'bottom'
    },
    {
      id: `${token}-add`,
      title: 'Add new record',
      description: 'Click Add New to open the modal form, then save your changes.',
      selectors: [`[data-tour="${slug}-entity-add"]`],
      placement: 'bottom'
    },
    {
      id: `${token}-table`,
      title: 'Review and update records',
      description: 'Use table actions like View, Edit, Deactivate, and Reactivate to keep data clean.',
      selectors: [`[data-tour="${slug}-entity-table"]`],
      placement: 'top'
    }
  ];
}

const ROUTE_SPECIFIC_WALKTHROUGHS: Record<string, AdminTourStep[]> = {
  '/sales-list': [
    {
      id: 'sales-list-overview',
      title: 'Sales list overview',
      description: 'This page shows posted transactions from mobile and web, with branch and date filters.',
      selectors: ['[data-tour="sales-list-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'sales-list-filters',
      title: 'Filter by branch and date',
      description: 'Use these filters first, then click Refresh to load the sales records you need.',
      selectors: ['[data-tour="sales-list-filters"]'],
      placement: 'bottom'
    },
    {
      id: 'sales-list-table',
      title: 'Open transaction details',
      description: 'Click View on any row to open full sale details, line items, and payment breakdown.',
      selectors: ['[data-tour="sales-list-view"]', '[data-tour="sales-list-table"]'],
      placement: 'top'
    }
  ],
  '/products': [
    {
      id: 'products-overview',
      title: 'Products setup',
      description: 'Maintain LPG and non-LPG items, linked cylinder type, and stock alert settings here.',
      selectors: ['[data-tour="products-entity-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'products-search',
      title: 'Find product records',
      description: 'Search by item code or product name to avoid duplicates before adding a new record.',
      selectors: ['[data-tour="products-entity-search"]'],
      placement: 'bottom'
    },
    {
      id: 'products-add',
      title: 'Add product',
      description: 'Use Add New to define product basics, LPG flag, cylinder type, and pricing-related fields.',
      selectors: ['[data-tour="products-entity-add"]'],
      placement: 'bottom'
    },
    {
      id: 'products-table',
      title: 'View and maintain',
      description: 'Use the table actions to view details, edit records, and manage active status.',
      selectors: ['[data-tour="products-entity-table"]'],
      placement: 'top'
    }
  ],
  '/reports': [
    {
      id: 'reports-overview',
      title: 'Reports center',
      description: 'This page combines sales, inventory, LPG, operations, and customer reports in one workspace.',
      selectors: ['[data-tour="reports-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'reports-filters',
      title: 'Set branch and date range',
      description: 'Start here so all report widgets and tables reflect the same filter scope.',
      selectors: ['[data-tour="reports-filters"]'],
      placement: 'bottom'
    },
    {
      id: 'reports-tabs',
      title: 'Switch report sections',
      description: 'Choose a section or use Show All Sections depending on how detailed your review needs to be.',
      selectors: ['[data-tour="reports-tabs"]'],
      placement: 'top'
    },
    {
      id: 'reports-export',
      title: 'Export and print',
      description: 'Use Export buttons for CSV files and Print for quick sharing during operations review.',
      selectors: ['[data-tour="reports-export"]'],
      placement: 'bottom'
    }
  ],
  '/branches': buildEntityRouteSteps('/branches', 'branches', 'Branches'),
  '/locations': buildEntityRouteSteps('/locations', 'locations', 'Locations'),
  '/users': buildEntityRouteSteps('/users', 'users', 'Users'),
  '/customers': buildEntityRouteSteps('/customers', 'customers', 'Customers'),
  '/customer-cards': buildEntityRouteSteps('/customer-cards', 'customer-cards', 'Customer Cards'),
  '/lending': [
    {
      id: 'lending-overview',
      title: 'Lending tracker',
      description: 'Use this page to review open lendings, inspect what is still with customers, and record returns.',
      selectors: ['[data-tour="lending-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'lending-filters',
      title: 'Search by branch or status',
      description: 'Filter the list first so operators can quickly focus on open, partial, or overdue lendings.',
      selectors: ['[data-tour="lending-search"]', '[data-tour="lending-branch-filter"]', '[data-tour="lending-status-filter"]'],
      placement: 'bottom'
    },
    {
      id: 'lending-table',
      title: 'Open the full detail view',
      description: 'Select any lending record to review the line items, return history, and record new returns.',
      selectors: ['[data-tour="lending-table"]'],
      placement: 'top'
    }
  ],
  '/lending/return-history': [
    {
      id: 'lending-return-history-overview',
      title: 'Lending return history',
      description: 'Review posted and reversed sales returns by branch and date range from this dedicated page.',
      selectors: ['[data-tour="lending-return-history-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'lending-return-history-filters',
      title: 'Filter by branch and date',
      description: 'Set branch and date range first, then refresh to load return history records.',
      selectors: ['[data-tour="lending-return-history-filters"]'],
      placement: 'bottom'
    },
    {
      id: 'lending-return-history-table',
      title: 'Review return postings',
      description: 'Each row shows the return status, amount, customer, and related sale reference.',
      selectors: ['[data-tour="lending-return-history-table"]'],
      placement: 'top'
    }
  ],
  '/customer-categories': [
    {
      id: 'customer-categories-overview',
      title: 'Customer categories',
      description: 'Create customer groups, assign members, and use them for custom pricing price lists.',
      selectors: ['[data-tour="header-page-title"]'],
      placement: 'bottom'
    }
  ],
  '/product-categories': buildEntityRouteSteps('/product-categories', 'product-categories', 'Product Categories'),
  '/product-brands': buildEntityRouteSteps('/product-brands', 'product-brands', 'Product Brands'),
  '/lpg-item-actions': [
    {
      id: 'lpg-item-actions-overview',
      title: 'LPG item service workspace',
      description: 'Use this page to record LPG item dispose, replace, and junk actions against empty stock at a selected location.',
      selectors: ['[data-tour="lpg-item-actions-root"]', '[data-tour="header-page-title"]'],
      placement: 'bottom'
    },
    {
      id: 'lpg-item-actions-filters',
      title: 'Choose branch and location first',
      description: 'Location matters because dispose and replace adjust the empty qty for that LPG item at that exact site.',
      selectors: ['[data-tour="lpg-item-actions-filters"]'],
      placement: 'bottom'
    },
    {
      id: 'lpg-item-actions-list',
      title: 'Select the LPG item to service',
      description: 'Open an LPG item card to review current empty qty, view history, and record dispose, replace, or junk activity.',
      selectors: ['[data-tour="lpg-item-actions-list"]'],
      placement: 'top'
    }
  ],
  '/cylinder-types': buildEntityRouteSteps('/cylinder-types', 'cylinder-types', 'Cylinder Types'),
  '/expenses': buildEntityRouteSteps('/expenses', 'expense-categories', 'Expense Categories'),
  '/suppliers': buildEntityRouteSteps('/suppliers', 'suppliers', 'Suppliers'),
  '/personnels': buildEntityRouteSteps('/personnels', 'personnel', 'Personnel'),
  '/personnel-roles': buildEntityRouteSteps('/personnel-roles', 'personnel-roles', 'Personnel Roles')
};

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard' as Route, label: 'Dashboard', icon: 'dashboard' },
      { href: '/reports', label: 'Reports', icon: 'audit' }
    ]
  },
  {
    title: 'Sales',
    items: [
      { href: '/sales-list' as Route, label: 'Sales List', icon: 'sales' },
      { href: '/customer-payments' as Route, label: 'Customer Payments', icon: 'customerPayment' },
      { href: '/customers', label: 'Customers', icon: 'customer' },
      { href: '/customer-categories' as Route, label: 'Customer Categories', icon: 'customer' },
      { href: '/customer-cards' as Route, label: 'Customer Cards', icon: 'card' }
    ]
  },
  {
    title: 'Inventory',
    items: [
      { href: '/products', label: 'Products', icon: 'product' },
      { href: '/product-categories' as Route, label: 'Product Categories', icon: 'product' },
      { href: '/product-brands' as Route, label: 'Product Brands', icon: 'product' },
      { href: '/lpg-item-actions' as Route, label: 'LPG Item Service', icon: 'cylinder' },
      { href: '/cylinder-types', label: 'Cylinder Types', icon: 'cylinder' },
      { href: '/inventory-opening' as Route, label: 'Opening Stock', icon: 'product' },
      { href: '/inventory-daily-count' as Route, label: 'Daily Inventory Count', icon: 'audit' },
      { href: '/price-lists', label: 'Price Lists', icon: 'pricing' },
      { href: '/costing', label: 'Costing Setup', icon: 'costing' }
    ]
  },
  {
    title: 'Stock Movement',
    items: [
      { href: '/transfer-list' as Route, label: 'Transfer List', icon: 'transfer' },
      { href: '/lending' as Route, label: 'Lending', icon: 'transfer' },
      { href: '/lending/return-history' as Route, label: 'Return History', icon: 'sales' },
      { href: '/purchase-orders' as Route, label: 'Purchase Orders', icon: 'supplier' },
      { href: '/delivery-dispatch' as Route, label: 'Delivery Dispatch', icon: 'transfer' },
      { href: '/branches', label: 'Branches', icon: 'branch' },
      { href: '/locations', label: 'Locations', icon: 'location' },
      { href: '/users', label: 'Users', icon: 'users' },
      { href: '/personnels', label: 'Personnel', icon: 'users' },
      { href: '/suppliers' as Route, label: 'Suppliers', icon: 'supplier' }
    ]
  },
  {
    title: 'Settings',
    items: [
      { href: '/personnel-roles', label: 'Personnel Roles', icon: 'users' },
      { href: '/expenses', label: 'Expense Categories', icon: 'expense' },
      { href: '/pos-settings' as Route, label: 'POS Settings', icon: 'audit' },
      { href: '/database-maintenance' as Route, label: 'Backup & Restore', icon: 'syncReview' },
      { href: '/sync-reviews' as Route, label: 'Sync Reviews', icon: 'syncReview' },
      { href: '/audit-logs', label: 'Audit Logs', icon: 'audit' }
    ]
  },
  {
    title: 'Platform',
    items: [
      { href: '/tenants', label: 'Tenants', icon: 'tenant' }
    ]
  }
];

const PLATFORM_OWNER_ALLOWED_ROUTES: Route[] = [
  '/tenants',
  '/audit-logs',
  '/database-maintenance' as Route,
  '/sync-reviews' as Route,
  '/branches',
  '/locations',
  '/users'
];

function routeIsActive(pathname: string, href: Route): boolean {
  if (pathname === href) {
    return true;
  }
  return pathname.startsWith(`${href}/`);
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function NavIcon({ name, className }: { name: NavIconName; className?: string }): JSX.Element {
  switch (name) {
    case 'dashboard':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 4h7v7H4V4ZM13 4h7v4h-7V4ZM13 10h7v10h-7V10ZM4 13h7v7H4v-7Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'sales':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 5h16v14H4zM8 9h8M8 13h5M8 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'transfer':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 7h12m0 0-3-3m3 3-3 3M20 17H8m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      );
    case 'card':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 10h18M7.5 14h4M7.5 17h6.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'branch':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20h18M6 20V8l6-4 6 4v12M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'location':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'users':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'customer':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'supplier':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-2a4 4 0 0 1 4-4h4m10 6v-4l-3-2h-4v6M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          <circle cx="16.5" cy="18.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="20.5" cy="18.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'customerPayment':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-1a5 5 0 0 1 5-5h4M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14 14h7M17.5 11.5v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'product':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="m12 3 9 4.5-9 4.5L3 7.5 12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      );
    case 'cylinder':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M9 6V4h6v2M8 6h8a2 2 0 0 1 2 2v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'pricing':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 2v20M17 6.5a3.5 3.5 0 0 0-3.5-2.5h-3A3.5 3.5 0 0 0 7 7.5c0 2 1.6 3.5 3.5 3.5h3A3.5 3.5 0 0 1 17 14.5 3.5 3.5 0 0 1 13.5 18h-3A3.5 3.5 0 0 1 7 15.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'costing':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path
            d="M4 7h16M4 12h16M4 17h16M9 7v10M15 7v10"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <circle cx="9" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="15" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'expense':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 7h16M7 4h10M6 11h12M8 15h8M10 19h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'branding':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 3a9 9 0 0 0 0 18h1.6a2.4 2.4 0 0 0 2.4-2.4 2.4 2.4 0 0 0-.8-1.8 2.4 2.4 0 0 1-.8-1.8 2.4 2.4 0 0 1 2.4-2.4h2.2A3 3 0 0 0 22 9.6C21.6 5.8 17.2 3 12 3Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="7.5" cy="10" r="1" fill="currentColor" />
          <circle cx="10.5" cy="7.5" r="1" fill="currentColor" />
          <circle cx="14" cy="7.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'audit':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 5h12l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 5v4h4M8 13h8M8 17h6M8 9h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'syncReview':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 4a8 8 0 1 1-7.1 4.3M4 4v5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          <path d="M12 8v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'tenant':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 20v-2.5A3.5 3.5 0 0 1 7.5 14h9a3.5 3.5 0 0 1 3.5 3.5V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M18.5 8.5h3M20 7v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    default:
      return <svg className={className} />;
  }
}

export function AdminShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [brandName, setBrandName] = useState('VPOS');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [tenantAddons, setTenantAddons] = useState<TenantAddons>(DEFAULT_TENANT_ADDONS);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [walkthroughSteps, setWalkthroughSteps] = useState<AdminTourStep[]>(ADMIN_WALKTHROUGH_STEPS);
  const [walkthroughDoneKeys, setWalkthroughDoneKeys] = useState<string[]>([ADMIN_WALKTHROUGH_DONE_KEY]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadError, setSearchLoadError] = useState<string | null>(null);
  const [globalSalesRows, setGlobalSalesRows] = useState<GlobalSalesSearchRow[]>([]);
  const [globalCustomerRows, setGlobalCustomerRows] = useState<GlobalCustomerSearchRow[]>([]);
  const [globalProductRows, setGlobalProductRows] = useState<GlobalProductSearchRow[]>([]);
  const [globalSearchLoadedAt, setGlobalSearchLoadedAt] = useState(0);
  const [inventorySyncNotifications, setInventorySyncNotifications] = useState<AfterShiftInventorySyncNotification[]>([]);
  const [inventoryNotificationDiscrepancyById, setInventoryNotificationDiscrepancyById] = useState<Record<string, InventoryCountDiscrepancyStatus>>({});
  const [selectedInventorySyncNotificationId, setSelectedInventorySyncNotificationId] = useState<string | null>(null);
  const [inventoryNotificationReadIds, setInventoryNotificationReadIds] = useState<string[]>([]);
  const [inventoryNotificationDropdownOpen, setInventoryNotificationDropdownOpen] = useState(false);
  const [inventoryNotificationModalOpen, setInventoryNotificationModalOpen] = useState(false);
  const [inventoryReportShift, setInventoryReportShift] = useState<DailyInventoryShiftRow | null>(null);
  const [inventoryReportLoading, setInventoryReportLoading] = useState(false);
  const [inventoryReportError, setInventoryReportError] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const notificationContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const initialTheme = resolveInitialTheme();
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');

    const storedSidebar = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(storedSidebar === '1');
    setInventoryNotificationReadIds(readInventoryNotificationReadIds());

    setHasToken(Boolean(getAccessToken()));
    setRequiresPasswordChange(getSessionRequiresPasswordChange());
    setRoles(getSessionRoles());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !hasToken || !requiresPasswordChange) {
      return;
    }
    window.location.replace('/change-password');
  }, [ready, hasToken, requiresPasswordChange]);

  useEffect(() => {
    if (!ready || !hasToken) {
      return;
    }

    (async () => {
      try {
        const branding = await apiRequest<BrandingTheme>('/branding/config');
        if (branding.companyName) {
          setBrandName(branding.companyName);
        }
        if (branding.primaryColor) {
          document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
        }
        if (branding.secondaryColor) {
          document.documentElement.style.setProperty('--brand-secondary', branding.secondaryColor);
        }
      } catch {
        // Keep defaults if branding fetch fails.
      }

      try {
        const entitlement = await apiRequest<CurrentEntitlement>('/platform/entitlements/current');
        setTenantAddons({
          ...DEFAULT_TENANT_ADDONS,
          ...entitlement.addons
        });
      } catch {
        setTenantAddons(DEFAULT_TENANT_ADDONS);
      }
    })();
  }, [ready, hasToken]);

  const canManageOrgStructure = useMemo(
    () => roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );
  const canAccessWebAdmin = useMemo(
    () => roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );
  const canViewOrgStructure = useMemo(
    () => canManageOrgStructure || roles.includes('admin'),
    [canManageOrgStructure, roles]
  );
  const isPlatformOwner = useMemo(() => roles.includes('platform_owner'), [roles]);
  const canViewAuditLogs = useMemo(
    () => roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );

  useEffect(() => {
    if (!ready || !hasToken || !canViewAuditLogs) {
      setInventorySyncNotifications([]);
      setInventoryNotificationDiscrepancyById({});
      setSelectedInventorySyncNotificationId(null);
      setInventoryNotificationDropdownOpen(false);
      setInventoryNotificationModalOpen(false);
      return;
    }

    let active = true;
    const loadInventorySyncNotification = async (): Promise<void> => {
      try {
        const query = new URLSearchParams({
          action: 'SHIFT_CLOSE',
          entity: 'Shift',
          limit: '12'
        });
        const payload = await apiRequest<{ rows: InventorySyncAuditRow[] }>(`/reports/audit-logs?${query.toString()}`);
        if (!active) {
          return;
        }
        const notifications =
          (payload.rows ?? [])
            .map((row) => buildAfterShiftInventorySyncNotification(row))
            .filter((row): row is AfterShiftInventorySyncNotification => Boolean(row));
        setInventorySyncNotifications(notifications);
        setSelectedInventorySyncNotificationId((current) =>
          current && notifications.some((notification) => notification.id === current) ? current : null
        );
      } catch {
        if (active) {
          setInventorySyncNotifications([]);
          setInventoryNotificationDiscrepancyById({});
          setSelectedInventorySyncNotificationId(null);
        }
      }
    };

    void loadInventorySyncNotification();
    const intervalId = window.setInterval(() => {
      void loadInventorySyncNotification();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [canViewAuditLogs, hasToken, ready]);

  useEffect(() => {
    if (!ready || !hasToken || !canViewAuditLogs) {
      return;
    }
    if (inventorySyncNotifications.length === 0) {
      setInventoryNotificationDiscrepancyById({});
      return;
    }

    let cancelled = false;
    async function loadInventoryNotificationDiscrepancyStatuses(): Promise<void> {
      const notificationsByDate = new Map<string, AfterShiftInventorySyncNotification[]>();
      inventorySyncNotifications.forEach((notification) => {
        const rows = notificationsByDate.get(notification.reportDate) ?? [];
        rows.push(notification);
        notificationsByDate.set(notification.reportDate, rows);
      });

      const nextStatuses: Record<string, InventoryCountDiscrepancyStatus> = {};
      await Promise.all(
        Array.from(notificationsByDate.entries()).map(async ([reportDate, notifications]) => {
          try {
            const payload = await apiRequest<InventoryNotificationDailyReport>(
              buildInventoryDailyReportPath(reportDate)
            );
            const reportRows = [...(payload.closed_shifts ?? []), ...(payload.open_shifts ?? [])];
            notifications.forEach((notification) => {
              const shiftRow =
                reportRows.find((row) => row.shift_id === notification.shiftId || row.id === notification.shiftId) ??
                null;
              nextStatuses[notification.id] = resolveInventoryCountDiscrepancyStatus(shiftRow);
            });
          } catch {
            notifications.forEach((notification) => {
              nextStatuses[notification.id] = 'unknown';
            });
          }
        })
      );

      if (cancelled) {
        return;
      }
      setInventoryNotificationDiscrepancyById(() => {
        const next: Record<string, InventoryCountDiscrepancyStatus> = {};
        inventorySyncNotifications.forEach((notification) => {
          next[notification.id] = nextStatuses[notification.id] ?? 'unknown';
        });
        return next;
      });
    }

    void loadInventoryNotificationDiscrepancyStatuses();
    return () => {
      cancelled = true;
    };
  }, [canViewAuditLogs, hasToken, inventorySyncNotifications, ready]);

  const inventorySyncNotification = useMemo(
    () =>
      selectedInventorySyncNotificationId
        ? inventorySyncNotifications.find((notification) => notification.id === selectedInventorySyncNotificationId) ?? null
        : null,
    [inventorySyncNotifications, selectedInventorySyncNotificationId]
  );
  const inventoryNotificationRead = useMemo(
    () => Boolean(inventorySyncNotification && inventoryNotificationReadIds.includes(inventorySyncNotification.id)),
    [inventoryNotificationReadIds, inventorySyncNotification]
  );
  const inventoryNotificationUnreadCount = useMemo(
    () =>
      inventorySyncNotifications.filter((notification) => !inventoryNotificationReadIds.includes(notification.id)).length,
    [inventoryNotificationReadIds, inventorySyncNotifications]
  );
  const inventoryNotificationUnread = inventoryNotificationUnreadCount > 0;
  const inventoryNotificationModalDiscrepancyStatus = useMemo<InventoryCountDiscrepancyStatus>(() => {
    const reportStatus = resolveInventoryCountDiscrepancyStatus(inventoryReportShift);
    if (reportStatus !== 'unknown') {
      return reportStatus;
    }
    if (!inventorySyncNotification) {
      return 'unknown';
    }
    return inventoryNotificationDiscrepancyById[inventorySyncNotification.id] ?? 'unknown';
  }, [inventoryNotificationDiscrepancyById, inventoryReportShift, inventorySyncNotification]);

  useEffect(() => {
    if (!inventoryNotificationModalOpen) {
      return;
    }
    const notification = inventorySyncNotification;
    if (!notification) {
      setInventoryReportShift(null);
      setInventoryReportLoading(false);
      setInventoryReportError(null);
      return;
    }
    const reportDate = notification.reportDate;
    const shiftId = notification.shiftId;
    const notificationId = notification.id;

    let cancelled = false;
    async function loadInventoryReport(): Promise<void> {
      setInventoryReportLoading(true);
      setInventoryReportError(null);
      setInventoryReportShift(null);
      try {
        const payload = await apiRequest<InventoryNotificationDailyReport>(
          buildInventoryDailyReportPath(reportDate)
        );
        if (cancelled) {
          return;
        }
        const rows = [...(payload.closed_shifts ?? []), ...(payload.open_shifts ?? [])];
        const shiftRow =
          rows.find((row) => row.shift_id === shiftId || row.id === shiftId) ??
          null;
        if (!shiftRow) {
          setInventoryReportError('Inventory report is synced but the matching shift row was not found yet.');
        }
        setInventoryReportShift(shiftRow);
        if (shiftRow) {
          setInventoryNotificationDiscrepancyById((current) => ({
            ...current,
            [notificationId]: resolveInventoryCountDiscrepancyStatus(shiftRow)
          }));
        }
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : 'Unable to load inventory count report.';
          setInventoryReportError(message);
        }
      } finally {
        if (!cancelled) {
          setInventoryReportLoading(false);
        }
      }
    }

    void loadInventoryReport();
    return () => {
      cancelled = true;
    };
  }, [
    inventoryNotificationModalOpen,
    inventorySyncNotification?.id,
    inventorySyncNotification?.reportDate,
    inventorySyncNotification?.shiftId
  ]);

  useEffect(() => {
    if (!inventoryNotificationModalOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInventoryNotificationModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [inventoryNotificationModalOpen]);

  const visibleNavSections = useMemo(
    () => {
      const visibleSections = NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items
          .filter((item) => {
            if (isPlatformOwner) {
              return PLATFORM_OWNER_ALLOWED_ROUTES.includes(item.href);
            }

            if (item.href === '/tenants') {
              return false;
            }

            if (String(item.href) === '/pos-settings') {
              return canManagePosSettings(roles);
            }

            if (item.href === '/audit-logs' && !canViewAuditLogs) {
              return false;
            }

            const requiredAddon = NAV_ROUTE_ADDON_GUARDS[item.href];
            if (requiredAddon && !tenantAddons[requiredAddon]) {
              return false;
            }

            if (
              !canViewOrgStructure &&
              (item.href === '/branches' || item.href === '/locations' || item.href === '/users')
            ) {
              return false;
            }
            return true;
          })
          .map((item) => {
            const badgeAddonKey = NAV_ROUTE_ADDON_BADGES[item.href];
            if (badgeAddonKey && tenantAddons[badgeAddonKey]) {
              return { ...item, badge: 'Add-on' };
            }
            return item;
          })
      })).filter((section) => section.items.length > 0);

      if (isPlatformOwner) {
        return visibleSections;
      }

      const addonItems: NavItem[] = [];
      const sectionsWithoutAddonGroupMembers = visibleSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => {
            const addonKey = NAV_ROUTE_ADDON_GUARDS[item.href];
            if (!addonKey) {
              return true;
            }
            addonItems.push({ ...item, badge: 'Add-on' });
            return false;
          })
        }))
        .filter((section) => section.items.length > 0);

      if (addonItems.length === 0) {
        const shortcutItems = ADDON_SIDEBAR_SHORTCUTS
          .filter((entry) => tenantAddons[entry.addon])
          .map((entry) => entry.item);
        if (shortcutItems.length === 0) {
          return sectionsWithoutAddonGroupMembers;
        }
        return [
          ...sectionsWithoutAddonGroupMembers,
          {
            title: SIDEBAR_ADDON_SECTION_TITLE,
            items: shortcutItems
          }
        ];
      }

      const seen = new Set<string>();
      const dedupedAddonItems = [
        ...addonItems,
        ...ADDON_SIDEBAR_SHORTCUTS.filter((entry) => tenantAddons[entry.addon]).map((entry) => entry.item)
      ].filter((item) => {
        if (seen.has(item.href)) {
          return false;
        }
        seen.add(item.href);
        return true;
      });

      return [
        ...sectionsWithoutAddonGroupMembers,
        {
          title: SIDEBAR_ADDON_SECTION_TITLE,
          items: dedupedAddonItems
        }
      ];
    },
    [canViewOrgStructure, canViewAuditLogs, isPlatformOwner, roles, tenantAddons]
  );

  const visibleNavItems = useMemo(() => visibleNavSections.flatMap((section) => section.items), [visibleNavSections]);
  const navSearchItems = useMemo<NavSearchItem[]>(
    () =>
      visibleNavSections.flatMap((section) =>
        section.items.map((item) => ({
          ...item,
          sectionTitle: section.title
        }))
      ),
    [visibleNavSections]
  );
  const pageSearchItems = useMemo<SearchResultItem[]>(() => {
    const term = searchQuery.trim().toLowerCase();
    const filtered = navSearchItems
      .filter((item) => {
        if (!term) {
          return true;
        }
        return (
          item.label.toLowerCase().includes(term) ||
          item.href.toLowerCase().includes(term) ||
          item.sectionTitle.toLowerCase().includes(term)
        );
      })
      .slice(0, term ? 8 : 6);
    return filtered.map((item) => ({
      id: `page:${item.href}`,
      group: 'Pages',
      label: item.label,
      description: item.sectionTitle,
      target: item.href,
      route: item.href,
      icon: item.icon
    }));
  }, [navSearchItems, searchQuery]);

  const salesSearchItems = useMemo<SearchResultItem[]>(() => {
    const term = searchQuery.trim().toLowerCase();
    if (term.length < 2) {
      return [];
    }
    return globalSalesRows
      .filter((row) =>
        [
          row.sale_id,
          row.receipt_number ?? '',
          row.customer_name ?? '',
          row.customer_code ?? '',
          row.branch_name,
          row.branch_code,
          row.location_name,
          row.location_code
        ]
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
      .slice(0, 6)
      .map((row) => ({
        id: `sale:${row.sale_id}`,
        group: 'Sales',
        label: row.sale_id,
        description: `${row.receipt_number ? `Receipt ${row.receipt_number} | ` : ''}${row.customer_name ?? 'Walk-in'} | ${row.branch_code}`,
        target: `/sales-list?sale_id=${encodeURIComponent(row.sale_id)}`,
        route: '/sales-list' as Route,
        icon: 'sales',
        trailing: row.total_amount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      }));
  }, [globalSalesRows, searchQuery]);

  const customerSearchItems = useMemo<SearchResultItem[]>(() => {
    const term = searchQuery.trim().toLowerCase();
    if (term.length < 2) {
      return [];
    }
    return globalCustomerRows
      .filter((row) =>
        [row.code, row.name, row.type, row.tier ?? '']
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
      .slice(0, 6)
      .map((row) => ({
        id: `customer:${row.id}`,
        group: 'Customers',
        label: row.name,
        description: `${row.code} | ${row.type}${row.tier ? ` | ${row.tier}` : ''}${row.isActive ? '' : ' | Inactive'}`,
        target: `/customers?customer_id=${encodeURIComponent(row.id)}`,
        route: '/customers' as Route,
        icon: 'customer'
      }));
  }, [globalCustomerRows, searchQuery]);

  const productSearchItems = useMemo<SearchResultItem[]>(() => {
    const term = searchQuery.trim().toLowerCase();
    if (term.length < 2) {
      return [];
    }
    return globalProductRows
      .filter((row) =>
        [row.sku, row.name, row.category ?? '', row.isLpg ? 'lpg' : '']
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
      .slice(0, 6)
      .map((row) => ({
        id: `product:${row.id}`,
        group: 'Products',
        label: row.name,
        description: `${row.sku}${row.category ? ` | ${row.category}` : ''}${row.isLpg ? ' | LPG' : ''}${row.isActive ? '' : ' | Inactive'}`,
        target: `/products?product_id=${encodeURIComponent(row.id)}`,
        route: '/products' as Route,
        icon: 'product'
      }));
  }, [globalProductRows, searchQuery]);

  const groupedSearchItems = useMemo<
    Array<{ group: SearchResultGroup; items: SearchResultItem[] }>
  >(
    () =>
      [
        { group: 'Pages' as const, items: pageSearchItems },
        { group: 'Sales' as const, items: salesSearchItems },
        { group: 'Customers' as const, items: customerSearchItems },
        { group: 'Products' as const, items: productSearchItems }
      ].filter((entry) => entry.items.length > 0),
    [pageSearchItems, salesSearchItems, customerSearchItems, productSearchItems]
  );

  const flatSearchItems = useMemo(
    () => groupedSearchItems.flatMap((entry) => entry.items),
    [groupedSearchItems]
  );
  const flatSearchIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    flatSearchItems.forEach((item, index) => {
      indexById.set(item.id, index);
    });
    return indexById;
  }, [flatSearchItems]);

  const active = useMemo(() => pathname ?? '/', [pathname]);
  const activeRouteKey = useMemo(() => {
    const exactMatch = visibleNavItems.find((item) => routeIsActive(active, item.href));
    return exactMatch?.href ?? active;
  }, [active, visibleNavItems]);
  const pageTitle = useMemo(() => visibleNavItems.find((item) => routeIsActive(active, item.href))?.label ?? 'Web Admin', [active, visibleNavItems]);
  const routeSpecificSteps = useMemo<AdminTourStep[]>(() => {
    const found = ROUTE_SPECIFIC_WALKTHROUGHS[activeRouteKey];
    if (found && found.length > 0) {
      return found;
    }

    const token = routeToTourToken(activeRouteKey);
    return [
      {
        id: `${token}-route-nav`,
        title: `${pageTitle} module`,
        description: 'Use this module menu item to return quickly while moving across admin pages.',
        selectors: [`[data-tour="nav-${token}"]`, `[data-tour="mobile-nav-${token}"]`, '[data-tour="header-page-title"]'],
        placement: 'bottom' as const
      },
      {
        id: `${token}-route-workspace`,
        title: 'Main work area',
        description: 'The main content for this module appears in this workspace section.',
        selectors: ['[data-tour="workspace"]'],
        placement: 'top' as const
      }
    ];
  }, [activeRouteKey, pageTitle]);
  const routeDoneKey = useMemo(() => routeWalkthroughDoneKey(activeRouteKey), [activeRouteKey]);
  const platformOwnerRouteBlocked = useMemo(
    () =>
      isPlatformOwner &&
      !PLATFORM_OWNER_ALLOWED_ROUTES.some((route) => routeIsActive(active, route)),
    [active, isPlatformOwner]
  );

  useEffect(() => {
    if (!ready || !hasToken || roles.length === 0 || isPlatformOwner || walkthroughOpen) {
      return;
    }

    const shellDone = window.localStorage.getItem(ADMIN_WALKTHROUGH_DONE_KEY) === '1';
    const routeDone = window.localStorage.getItem(routeDoneKey) === '1';

    if (!shellDone) {
      setWalkthroughSteps([...ADMIN_WALKTHROUGH_STEPS, ...routeSpecificSteps]);
      setWalkthroughDoneKeys([ADMIN_WALKTHROUGH_DONE_KEY, routeDoneKey]);
      setWalkthroughOpen(true);
      return;
    }

    if (!routeDone && routeSpecificSteps.length > 0) {
      setWalkthroughSteps(routeSpecificSteps);
      setWalkthroughDoneKeys([routeDoneKey]);
      setWalkthroughOpen(true);
    }
  }, [hasToken, isPlatformOwner, ready, roles.length, routeDoneKey, routeSpecificSteps, walkthroughOpen]);

  useEffect(() => {
    const term = searchQuery.trim();
    if (!searchOpen || term.length < 2) {
      setSearchLoading(false);
      setSearchLoadError(null);
      return;
    }

    const now = Date.now();
    const cacheWindowMs = 90 * 1000;
    if (globalSearchLoadedAt > 0 && now - globalSearchLoadedAt < cacheWindowMs) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchLoadError(null);
      Promise.all([
        apiRequest<{ rows: GlobalSalesSearchRow[] }>('/reports/sales/list?limit=250'),
        apiRequest<GlobalCustomerSearchRow[]>('/master-data/customers'),
        apiRequest<GlobalProductSearchRow[]>('/master-data/products')
      ])
        .then(([salesRes, customersRes, productsRes]) => {
          if (cancelled) {
            return;
          }
          setGlobalSalesRows(Array.isArray(salesRes?.rows) ? salesRes.rows : []);
          setGlobalCustomerRows(Array.isArray(customersRes) ? customersRes : []);
          setGlobalProductRows(Array.isArray(productsRes) ? productsRes : []);
          setGlobalSearchLoadedAt(Date.now());
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setSearchLoadError('Unable to load global records right now.');
        })
        .finally(() => {
          if (cancelled) {
            return;
          }
          setSearchLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [globalSearchLoadedAt, searchOpen, searchQuery]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchHighlightIndex(0);
    setSearchQuery('');
    setSearchLoadError(null);
    setInventoryNotificationDropdownOpen(false);
  }, [active]);

  useEffect(() => {
    setSearchHighlightIndex((current) => {
      if (flatSearchItems.length === 0) {
        return 0;
      }
      return Math.min(current, flatSearchItems.length - 1);
    });
  }, [flatSearchItems]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setSearchOpen(false);
      }
      if (
        notificationContainerRef.current &&
        !notificationContainerRef.current.contains(target)
      ) {
        setInventoryNotificationDropdownOpen(false);
      }
    };

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInventoryNotificationDropdownOpen(false);
      }
      const target = event.target as HTMLElement | null;
      const targetTag = target?.tagName?.toLowerCase();
      const targetEditable = target instanceof HTMLElement && target.isContentEditable;
      const isTypingContext =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetTag === 'select' ||
        targetEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (isTypingContext && target !== searchInputRef.current) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleShortcut);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleShortcut);
    };
  }, []);

  function openSearchResult(item: SearchResultItem): void {
    setSearchOpen(false);
    setSearchHighlightIndex(0);
    setSearchQuery('');
    if (routeIsActive(active, item.route) && item.target === item.route) {
      return;
    }
    router.push(item.target as Route);
  }

  function openManualTutorial(): void {
    const shellDone = window.localStorage.getItem(ADMIN_WALKTHROUGH_DONE_KEY) === '1';
    if (shellDone) {
      setWalkthroughSteps(routeSpecificSteps);
      setWalkthroughDoneKeys([routeDoneKey]);
    } else {
      setWalkthroughSteps([...ADMIN_WALKTHROUGH_STEPS, ...routeSpecificSteps]);
      setWalkthroughDoneKeys([ADMIN_WALKTHROUGH_DONE_KEY, routeDoneKey]);
    }
    setWalkthroughOpen(true);
  }

  function openInventoryNotificationModal(notification: AfterShiftInventorySyncNotification): void {
    setSearchOpen(false);
    setInventoryNotificationDropdownOpen(false);
    setSelectedInventorySyncNotificationId(notification.id);
    setInventoryNotificationModalOpen(true);
  }

  function closeInventoryNotificationModal(): void {
    setInventoryNotificationModalOpen(false);
  }

  function setInventoryNotificationReadState(read: boolean): void {
    if (!inventorySyncNotification) {
      return;
    }
    const notificationId = inventorySyncNotification.id;
    setInventoryNotificationReadIds((current) => {
      const next = new Set(current);
      if (read) {
        next.add(notificationId);
      } else {
        next.delete(notificationId);
      }
      const nextIds = Array.from(next).slice(-MAX_INVENTORY_SYNC_NOTIFICATION_READ_IDS);
      persistInventoryNotificationReadIds(nextIds);
      return nextIds;
    });
  }

  function switchTheme(nextTheme: ThemeMode): void {
    setTheme(nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function toggleSidebar(): void {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextValue ? '1' : '0');
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="rounded-2xl border border-slate-300/60 bg-white/80 px-6 py-4 text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          Loading admin workspace...
        </div>
      </main>
    );
  }

  if (!hasToken) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-300/60 bg-white/85 p-6 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          <h1 className="text-xl font-semibold">Authentication Required</h1>
          <p className="mt-2 text-sm">Please login to access the VPOS Web Admin modules.</p>
          <Link className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900" href="/login">
            Go to Login
          </Link>
        </section>
      </main>
    );
  }

  if (requiresPasswordChange) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-300/60 bg-white/85 p-6 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          <h1 className="text-xl font-semibold">Password Change Required</h1>
          <p className="mt-2 text-sm">Redirecting to password update...</p>
        </section>
      </main>
    );
  }

  if (!canAccessWebAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-300/60 bg-white/85 p-6 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
          <h1 className="text-xl font-semibold">Web Admin Access Required</h1>
          <p className="mt-2 text-sm">This account is intended for mobile/POS use. Login using an owner/admin account for Web Admin.</p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
              onClick={() => {
                clearAuthSession();
                window.location.href = '/login';
              }}
              type="button"
            >
              Back to Login
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <aside
        data-tour="sidebar"
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200/70 bg-white/90 text-slate-700 shadow-2xl shadow-slate-300/20 transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-950/90 dark:text-slate-200 dark:shadow-black/40 md:block ${sidebarCollapsed ? 'w-20' : 'w-72'}`}
      >
        <div className={`flex h-16 items-center border-b border-slate-200/70 dark:border-slate-800 ${sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-6'}`}>
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-slate-300/60 bg-white/70 dark:border-slate-700 dark:bg-slate-900/70">
            <Image src="/logo.png" alt="VPOS logo" width={32} height={32} className="h-8 w-8 object-contain p-0.5" />
          </div>
          {!sidebarCollapsed ? (
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">System</p>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{brandName}</p>
            </div>
          ) : null}
        </div>

        <div data-tour="sidebar-nav" className={`h-[calc(100vh-4rem)] overflow-y-auto py-5 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}>
          {visibleNavSections.map((section) => (
            <div className="mb-6" key={section.title}>
              {!sidebarCollapsed ? (
                <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{section.title}</p>
              ) : null}
              <nav className="space-y-1">
                {section.items.map((item) => {
                  const isActive = routeIsActive(active, item.href);
                  const dataTour = `nav-${routeToTourToken(item.href)}`;
                  return (
                    <Link
                      data-tour={dataTour}
                      className={`flex items-center rounded-xl px-3 py-2 text-sm transition ${sidebarCollapsed ? 'justify-center' : 'justify-between'} ${
                        isActive
                          ? 'bg-slate-900 text-white shadow-lg shadow-slate-400/30 dark:bg-slate-100 dark:text-slate-900'
                          : 'text-slate-700 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                      }`}
                      href={item.href}
                      key={item.href}
                      title={item.label}
                    >
                      {sidebarCollapsed ? (
                        <NavIcon className="h-4 w-4" name={item.icon} />
                      ) : (
                        <>
                          <span className="flex items-center gap-2">
                            <NavIcon className="h-4 w-4" name={item.icon} />
                            <span>{item.label}</span>
                          </span>
                          {item.badge ? (
                            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {item.badge}
                            </span>
                          ) : null}
                        </>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${sidebarCollapsed ? 'md:pl-20' : 'md:pl-72'}`}>
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/85">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="flex min-w-[220px] flex-1 items-center gap-2">
              <button
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="hidden rounded-lg border border-slate-300/70 p-2 text-slate-700 hover:bg-slate-200/70 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70 md:inline-flex"
                onClick={toggleSidebar}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  {sidebarCollapsed ? (
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  ) : (
                    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  )}
                </svg>
              </button>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{brandName}</p>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100" data-tour="header-page-title">{pageTitle}</h1>
              </div>
            </div>

            <div
              data-tour="global-search"
              ref={searchContainerRef}
              className="relative flex w-full max-w-xl items-center gap-2 rounded-xl border border-slate-300/70 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 md:w-auto md:flex-1"
            >
              <svg aria-hidden="true" className="h-4 w-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24">
                <path d="M21 21L16.65 16.65M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
              <input
                ref={searchInputRef}
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (!searchOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    setSearchOpen(true);
                    return;
                  }
                  if (event.key === 'Escape') {
                    setSearchOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSearchHighlightIndex((current) =>
                      flatSearchItems.length === 0
                        ? 0
                        : (current + 1) % flatSearchItems.length
                    );
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSearchHighlightIndex((current) =>
                      flatSearchItems.length === 0
                        ? 0
                        : (current - 1 + flatSearchItems.length) % flatSearchItems.length
                    );
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const selected =
                      flatSearchItems[searchHighlightIndex] ?? flatSearchItems[0];
                    if (selected) {
                      openSearchResult(selected);
                    }
                  }
                }}
                placeholder="Search pages, sales, customers, products... (Ctrl/Cmd + K)"
                value={searchQuery}
              />
              <span className="hidden rounded-md border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400 md:inline">
                Ctrl K
              </span>
              {searchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="max-h-96 overflow-y-auto py-1">
                    {searchLoadError ? (
                      <p className="px-3 py-2 text-xs text-rose-600 dark:text-rose-300">{searchLoadError}</p>
                    ) : null}
                    {searchLoading ? (
                      <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Loading global records...</p>
                    ) : null}
                    {flatSearchItems.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        No results found. Try another keyword.
                      </p>
                    ) : (
                      groupedSearchItems.map((group) => (
                        <div key={group.group}>
                          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                            {group.group}
                          </p>
                          <ul>
                            {group.items.map((item) => {
                              const itemIndex = flatSearchIndexById.get(item.id) ?? 0;
                              const highlighted = itemIndex === searchHighlightIndex;
                              const isCurrent = routeIsActive(active, item.route);
                              return (
                                <li key={item.id}>
                                  <button
                                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition ${
                                      highlighted
                                        ? 'bg-slate-100 dark:bg-slate-800'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                    }`}
                                    onClick={() => openSearchResult(item)}
                                    onMouseEnter={() => setSearchHighlightIndex(itemIndex)}
                                    type="button"
                                  >
                                    <span className="flex min-w-0 items-start gap-2">
                                      <NavIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" name={item.icon} />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                          {item.label}
                                        </span>
                                        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                                          {item.description}
                                        </span>
                                      </span>
                                    </span>
                                    {isCurrent ? (
                                      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                        Current
                                      </span>
                                    ) : (
                                      <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                                        {item.trailing ?? item.route}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative" ref={notificationContainerRef}>
                <button
                  aria-expanded={inventoryNotificationDropdownOpen}
                  aria-haspopup="menu"
                  aria-label={
                    inventoryNotificationUnread
                      ? `Open ${inventoryNotificationUnreadCount} unread after-shift inventory notification${inventoryNotificationUnreadCount === 1 ? '' : 's'}`
                      : 'Open after-shift inventory notifications'
                  }
                  className={`relative rounded-lg border p-2 transition ${
                    inventoryNotificationUnread
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70'
                      : 'border-slate-300/70 text-slate-700 hover:bg-slate-200/70 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70'
                  }`}
                  onClick={() => {
                    setSearchOpen(false);
                    setInventoryNotificationDropdownOpen((open) => !open);
                  }}
                  title="Notifications"
                  type="button"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M15 17H9m9-3.5V10a6 6 0 0 0-12 0v3.5L4.5 16h15L18 13.5ZM10 19a2 2 0 0 0 4 0"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  {inventoryNotificationUnread ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white dark:ring-slate-950">
                      {inventoryNotificationUnreadCount > 9 ? '9+' : inventoryNotificationUnreadCount}
                    </span>
                  ) : null}
                </button>

                {inventoryNotificationDropdownOpen ? (
                  <div
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(calc(100vw-2rem),24rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:shadow-black/40"
                    role="menu"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                      <div>
                        <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                          Notifications
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {inventoryNotificationUnreadCount > 0
                            ? `${inventoryNotificationUnreadCount} unread`
                            : 'All caught up'}
                        </p>
                      </div>
                    </div>
                    <div className="max-h-[28rem] overflow-y-auto py-1">
                      {inventorySyncNotifications.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
                          No after-shift inventory notifications yet.
                        </div>
                      ) : (
                        inventorySyncNotifications.map((notification) => {
                          const isRead = inventoryNotificationReadIds.includes(notification.id);
                          const discrepancyStatus = inventoryNotificationDiscrepancyById[notification.id] ?? 'unknown';
                          return (
                            <button
                              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                                isRead
                                  ? 'hover:bg-slate-50 dark:hover:bg-slate-900'
                                  : 'bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/35'
                              }`}
                              key={notification.id}
                              onClick={() => openInventoryNotificationModal(notification)}
                              role="menuitem"
                              type="button"
                            >
                              <span
                                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                                  isRead
                                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                                }`}
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M4 5h12l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                  />
                                  <path d="M16 5v4h4M8 13h8M8 17h6M8 9h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                                </svg>
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    After-shift inventory count report
                                  </span>
                                  {!isRead ? (
                                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-600" aria-label="Unread" />
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-300">
                                  Shift {notification.shiftId} inventory count is ready.
                                </span>
                                <span
                                  className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] ${inventoryCountDiscrepancyPillClass(discrepancyStatus)}`}
                                >
                                  {inventoryCountDiscrepancyLabel(discrepancyStatus)}
                                </span>
                                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                                  {notification.lineCount !== null
                                    ? `${notification.lineCount.toLocaleString()} item line${notification.lineCount === 1 ? '' : 's'} committed`
                                    : 'Inventory count committed'}
                                  {' | '}
                                  {formatInventoryNotificationTime(notification.closedAt)}
                                </span>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                data-tour="theme-toggle"
                aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                className="rounded-lg border border-slate-300/70 p-2 text-slate-700 transition hover:bg-slate-200/70 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
                onClick={() => switchTheme(theme === 'light' ? 'dark' : 'light')}
                type="button"
              >
                {theme === 'light' ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path
                      d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
              {!isPlatformOwner ? (
                <button
                  className="rounded-lg border border-slate-300/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-200/70 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
                  onClick={openManualTutorial}
                  type="button"
                >
                  Tutorial
                </button>
              ) : null}
              <button
                data-tour="logout"
                className="rounded-lg border border-slate-300/70 bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-slate-700 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                onClick={() => {
                  clearAuthSession();
                  window.location.href = '/login';
                }}
                type="button"
              >
                Logout
              </button>
            </div>
          </div>

          <div data-tour="mobile-nav-list" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
            {visibleNavItems.map((item) => {
              const isActive = routeIsActive(active, item.href);
              const dataTour = `mobile-nav-${routeToTourToken(item.href)}`;
              return (
                <Link
                  data-tour={dataTour}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${isActive ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-300/70 text-slate-700 dark:border-slate-700 dark:text-slate-300'}`}
                  href={item.href}
                  key={item.href}
                >
                  <span className="flex items-center gap-1.5">
                    <NavIcon className="h-3.5 w-3.5" name={item.icon} />
                    <span>{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full border border-current/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </header>

        <main className="px-4 py-4 md:px-6 md:py-5">
          <section data-tour="workspace" className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/55 md:p-6">
            {platformOwnerRouteBlocked ? (
              <div className="rounded-2xl border border-slate-300/70 bg-slate-100 p-5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
                <h2 className="text-xl font-semibold">Platform Console Scope</h2>
                <p className="mt-2 text-sm">
                  This module is outside the current platform-owner menu scope. Use Tenants, Branches, Locations, Users, Sync Reviews, and Audit Logs from the left menu.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900" href="/tenants">
                    Open Tenants
                  </Link>
                  <Link className="rounded-lg border border-slate-300/70 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" href="/audit-logs">
                    Open Audit Logs
                  </Link>
                </div>
              </div>
            ) : (
              children
            )}
          </section>
        </main>
      </div>
      {inventoryNotificationModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 p-3 py-6 md:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeInventoryNotificationModal();
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="inventory-sync-notification-title"
            aria-modal="true"
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            role="dialog"
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 md:px-5">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.16em] text-brandPrimary">
                  Notifications
                </p>
                <h2 id="inventory-sync-notification-title" className="mt-0.5 text-base font-semibold md:text-lg">
                  After-shift inventory count report
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Review the committed system count against the cashier input count.
                </p>
              </div>
              <button
                aria-label="Close notification report"
                className="rounded-lg border border-slate-300/70 p-2 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={closeInventoryNotificationModal}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                </svg>
              </button>
            </header>

            {!inventorySyncNotification ? (
              <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
                No committed after-shift inventory sync notification is available yet.
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 md:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] ${
                            inventoryNotificationRead
                              ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          }`}
                        >
                          {inventoryNotificationRead ? 'Read' : 'Unread'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Shift {inventorySyncNotification.shiftId}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] ${inventoryCountDiscrepancyPillClass(inventoryNotificationModalDiscrepancyStatus)}`}
                        >
                          {inventoryCountDiscrepancyLabel(inventoryNotificationModalDiscrepancyStatus)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        After-shift sync committed
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {inventorySyncNotification.lineCount !== null
                          ? `${inventorySyncNotification.lineCount.toLocaleString()} item line${inventorySyncNotification.lineCount === 1 ? '' : 's'} committed`
                          : 'Inventory count committed'}
                        {' | '}
                        Closed {formatInventoryNotificationTime(inventorySyncNotification.closedAt)}
                        {inventorySyncNotification.cashierName ? ` | ${inventorySyncNotification.cashierName}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-lg border border-slate-300/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => setInventoryNotificationReadState(!inventoryNotificationRead)}
                        type="button"
                      >
                        {inventoryNotificationRead ? 'Mark Unread' : 'Mark Read'}
                      </button>
                      <Link
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                        href={inventorySyncNotification.href as Route}
                        onClick={closeInventoryNotificationModal}
                      >
                        Open Full Report
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="overflow-y-auto px-4 py-4 md:px-5">
                  {inventoryReportLoading ? (
                    <div className="grid gap-3">
                      <div className="min-h-[76px] animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
                      <div className="min-h-[240px] animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />
                    </div>
                  ) : null}

                  {inventoryReportError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                      {inventoryReportError}
                    </div>
                  ) : null}

                  {!inventoryReportLoading && !inventoryReportError && inventoryReportShift ? (
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            System Count
                          </p>
                          <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                            {formatInventorySnapshotCount(inventoryReportShift.opening_snapshot_summary)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Opening snapshot
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            User Input Count
                          </p>
                          <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                            {formatInventorySnapshotCount(inventoryReportShift.closing_snapshot_summary)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Cashier close input
                          </p>
                        </div>
                        <div className={`rounded-xl border px-3 py-3 ${inventoryCountDiscrepancyCardClass(inventoryNotificationModalDiscrepancyStatus)}`}>
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            Discrepancy
                          </p>
                          <p className={`mt-1 text-sm font-extrabold ${inventoryCountDiscrepancyTextClass(inventoryNotificationModalDiscrepancyStatus)}`}>
                            {inventoryCountDiscrepancyLabel(inventoryNotificationModalDiscrepancyStatus)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            System count vs user input
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            Delta
                          </p>
                          <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                            {inventoryReportShift.inventory_report
                              ? `${formatInventorySignedCount(inventoryReportShift.inventory_report.totals.delta_qty_on_hand)} on hand`
                              : 'Unavailable'}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            System vs input
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            Location
                          </p>
                          <p className="mt-1 break-words text-sm font-extrabold text-slate-900 dark:text-slate-100">
                            {inventoryReportShift.location_name ?? 'Location not recorded'}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {inventoryReportShift.branch_name}
                          </p>
                        </div>
                      </div>

                      <InventoryShiftItemBreakdown row={inventoryReportShift} />
                    </div>
                  ) : null}

                  {!inventoryReportLoading && !inventoryReportError && !inventoryReportShift ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      The inventory count report will appear here once the synced shift row is available.
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
      {!isPlatformOwner ? (
        <AdminWalkthrough
          onClose={() => {
            walkthroughDoneKeys.forEach((key) => window.localStorage.setItem(key, '1'));
            setWalkthroughOpen(false);
          }}
          onComplete={() => {
            walkthroughDoneKeys.forEach((key) => window.localStorage.setItem(key, '1'));
            setWalkthroughOpen(false);
          }}
          open={walkthroughOpen}
          steps={walkthroughSteps}
        />
      ) : null}
      {!isPlatformOwner ? <ChatWidget /> : null}
    </div>
  );
}
