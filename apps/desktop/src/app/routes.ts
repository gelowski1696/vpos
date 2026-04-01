export type DesktopRouteId =
  | 'dashboard'
  | 'pos'
  | 'customers'
  | 'sales'
  | 'lending'
  | 'loyalty'
  | 'lpg-service'
  | 'settings';

export type DesktopRoute = {
  id: DesktopRouteId;
  label: string;
  description: string;
  shortcut?: string;
};

export const DESKTOP_ROUTES: DesktopRoute[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Branch health and sync status' },
  { id: 'pos', label: 'POS', description: 'Cashier sales and receipt flow', shortcut: 'F1' },
  { id: 'customers', label: 'Customers', description: 'Balances, points, and lookups', shortcut: 'F2' },
  { id: 'sales', label: 'Sales', description: 'History, returns, and recreate flow', shortcut: 'F3' },
  { id: 'lending', label: 'Lending', description: 'Lending records and returns', shortcut: 'F4' },
  { id: 'loyalty', label: 'Loyalty', description: 'Points, rewards, and redemptions', shortcut: 'F5' },
  { id: 'lpg-service', label: 'LPG Service', description: 'Disposed, junked, and replaced records', shortcut: 'F6' },
  { id: 'settings', label: 'Settings', description: 'Printer, sync, and device setup' }
];
