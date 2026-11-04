import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../src/assets/vpos-logo.png', () => 'vpos-logo.png');

import { DESKTOP_ROUTES } from '../src/app/routes';
import { Sidebar } from '../src/components/layout/Sidebar';

describe('Sidebar add-on navigation group', () => {
  it('renders the Add-ons group only when add-on routes are provided', () => {
    const primaryRoutes = DESKTOP_ROUTES.filter((route) => ['dashboard', 'sales'].includes(route.id));
    const secondaryRoutes = DESKTOP_ROUTES.filter((route) => ['items', 'settings'].includes(route.id));
    const addonRoutes = DESKTOP_ROUTES.filter((route) => ['purchase-orders', 'delivery-dispatch'].includes(route.id));

    const baseProps = {
      primaryRoutes,
      secondaryRoutes,
      activeRoute: 'dashboard' as const,
      mode: 'rail' as const,
      open: true,
      collapsed: false,
      onToggleCollapsed: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
      setupCompleted: true,
      syncBusy: false,
      syncNeedsAttention: false,
      branchDataBusy: false,
      pendingOutboxCount: 0,
      lastSyncedAt: '2026-06-06T00:00:00.000Z',
      onSyncNow: () => undefined,
      onDownloadBranchData: () => undefined,
      brandTitle: 'VPOS Desktop',
      brandSubtitle: 'VMJAM - Desktop'
    };

    const withoutAddons = renderToStaticMarkup(
      React.createElement(Sidebar, baseProps)
    );
    const withAddons = renderToStaticMarkup(
      React.createElement(Sidebar, {
        ...baseProps,
        addonRoutes
      } as React.ComponentProps<typeof Sidebar> & { addonRoutes: typeof addonRoutes })
    );

    expect(withoutAddons).not.toContain('Add-ons');
    expect(withoutAddons).not.toContain('Purchase Orders');
    expect(withAddons).toContain('Add-ons');
    expect(withAddons).toContain('Purchase Orders');
    expect(withAddons).toContain('Delivery Dispatch');
  });
});
