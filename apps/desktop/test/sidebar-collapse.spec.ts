import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('../src/assets/vpos-logo.png', () => 'vpos-logo.png');
import { Sidebar } from '../src/components/layout/Sidebar';
import { DESKTOP_ROUTES } from '../src/app/routes';

describe('Sidebar collapsed layout', () => {
  it('renders a stacked collapsed header with the brand mark visible', () => {
    const primaryRoutes = DESKTOP_ROUTES.filter((route) =>
      ['dashboard', 'sales'].includes(route.id)
    );
    const secondaryRoutes = DESKTOP_ROUTES.filter((route) =>
      ['items', 'settings'].includes(route.id)
    );

    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        primaryRoutes,
        secondaryRoutes,
        activeRoute: 'dashboard',
        mode: 'rail',
        open: true,
        collapsed: true,
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
      })
    );

    expect(markup).toContain('shell-sidebar-header--collapsed');
    expect(markup).toContain('shell-sidebar-brand--collapsed');
    expect(markup).toContain('alt="VPOS"');
    expect(markup).toContain('Expand sidebar');
  });
});
