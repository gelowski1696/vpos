export type DesktopRouteId =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'transfer'
  | 'transfer-list'
  | 'reports'
  | 'expense'
  | 'items'
  | 'customers'
  | 'lending'
  | 'lpg-service'
  | 'shift'
  | 'purchase-orders'
  | 'delivery-dispatch'
  | 'settings';

export type DesktopRoute = {
  id: DesktopRouteId;
  label: string;
  hint: string;
  icon: string;
  description: string;
  shortcut?: string;
};

export const DESKTOP_ROUTES: DesktopRoute[] = [
  { id: 'dashboard', label: 'Home', hint: 'Overview', icon: '\u2302', description: 'Branch summary and quick actions' },
  { id: 'pos', label: 'POS', hint: 'Sales', icon: '\u25a3', description: 'Cashier sales and receipt flow', shortcut: 'F1' },
  { id: 'sales', label: 'Sales', hint: 'History', icon: '\u25a4', description: 'Sales history, returns, and recreate flow', shortcut: 'F2' },
  { id: 'transfer', label: 'Transfer', hint: 'Create', icon: '\u2194', description: 'Create a branch transfer', shortcut: 'F3' },
  { id: 'transfer-list', label: 'Transfer History', hint: 'History', icon: '\u2630', description: 'Review saved and synced transfers', shortcut: 'F4' },
  { id: 'reports', label: 'Reports', hint: 'Cashier', icon: '\u2692', description: 'Cashier summary and report snapshots', shortcut: 'F5' },
  { id: 'expense', label: 'Expense', hint: 'Petty Cash', icon: '\u20b1', description: 'Petty cash and expense logs', shortcut: 'F6' },
  { id: 'items', label: 'Items', hint: 'Read Only', icon: '\u25a6', description: 'Browse branch items, stock, and quick actions', shortcut: 'F7' },
  { id: 'customers', label: 'Customers', hint: 'Credit', icon: '\u263a', description: 'Balances, points, and lookups', shortcut: 'F8' },
  { id: 'lending', label: 'Lending', hint: 'Returns', icon: '\u27f2', description: 'Lending records and returns', shortcut: 'F9' },
  { id: 'lpg-service', label: 'LPG Service', hint: 'Dispose', icon: '\u267a', description: 'Disposed, junked, and replaced records', shortcut: 'F10' },
  { id: 'shift', label: 'Shift', hint: 'Register', icon: '\u25f7', description: 'Open duty, close duty, and shift cash actions', shortcut: 'F11' },
  { id: 'purchase-orders', label: 'Purchase Orders', hint: 'Add-on', icon: '\u25a9', description: 'Supplier purchase orders and receiving flow' },
  { id: 'delivery-dispatch', label: 'Delivery Dispatch', hint: 'Add-on', icon: '\u27a6', description: 'Dispatch orders, delivery status, and handoff tracking' },
  { id: 'settings', label: 'Settings', hint: 'Device', icon: '\u2699', description: 'Printer, sync, and device setup' }
];
