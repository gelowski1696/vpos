import type { DesktopRouteId } from './routes';
import {
  DEFAULT_DESKTOP_POS_CONTROL_POLICY,
  DEFAULT_TENANT_ADDONS,
  type DesktopPosControlPolicy,
  type TenantAddonFlags
} from '../services/desktop-master-data.service';

export { DEFAULT_DESKTOP_POS_CONTROL_POLICY };

type DesktopPosAccessOptions = {
  hasActiveShift?: boolean;
};

const ROUTE_FLAG_BY_ID: Partial<Record<DesktopRouteId, keyof DesktopPosControlPolicy>> = {
  reports: 'reports_enabled',
  customers: 'customers_enabled',
  items: 'items_enabled',
  transfer: 'transfer_enabled',
  'transfer-list': 'transfer_enabled',
  lending: 'lending_enabled',
  expense: 'expense_enabled',
  settings: 'settings_enabled',
  'purchase-orders': 'purchase_orders_enabled',
  'delivery-dispatch': 'delivery_dispatch_enabled'
};

const CORE_ALWAYS_ON_ROUTES = new Set<DesktopRouteId>(['dashboard', 'pos', 'sales', 'lpg-service']);

export function isDesktopRouteAllowed(
  route: DesktopRouteId,
  policy: DesktopPosControlPolicy = DEFAULT_DESKTOP_POS_CONTROL_POLICY,
  addons: TenantAddonFlags = DEFAULT_TENANT_ADDONS,
  options: DesktopPosAccessOptions = {}
): boolean {
  if (CORE_ALWAYS_ON_ROUTES.has(route)) {
    return true;
  }

  if (route === 'shift') {
    return policy.shift_enabled || options.hasActiveShift === true;
  }

  if (route === 'purchase-orders') {
    return policy.purchase_orders_enabled && addons.purchase_order_suite;
  }

  if (route === 'delivery-dispatch') {
    return policy.delivery_dispatch_enabled && addons.delivery_dispatch_suite;
  }

  const flag = ROUTE_FLAG_BY_ID[route];
  if (!flag) {
    return true;
  }

  return policy[flag] === true;
}

export function filterDesktopRoutes(
  routes: readonly DesktopRouteId[],
  policy: DesktopPosControlPolicy = DEFAULT_DESKTOP_POS_CONTROL_POLICY,
  addons: TenantAddonFlags = DEFAULT_TENANT_ADDONS,
  options: DesktopPosAccessOptions = {}
): DesktopRouteId[] {
  return routes.filter((route) => isDesktopRouteAllowed(route, policy, addons, options));
}
