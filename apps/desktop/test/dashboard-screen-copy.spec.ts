import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { DashboardScreen } from '../src/screens/DashboardScreen';

describe('DashboardScreen copy', () => {
  it('removes the local operations sync panel messaging from Home', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        state: DEFAULT_DESKTOP_APP_STATE,
        pendingOutboxCount: 0,
        onRunSync: async () => undefined,
        syncBusy: false
      })
    );

    expect(markup).toContain('Sales trail');
    expect(markup).not.toContain('Transaction trail');
    expect(markup).not.toContain('Payment records');
    expect(markup).toContain('Credit watch');
    expect(markup).not.toContain('Local operations');
    expect(markup).not.toContain('Device activity and branch sync');
    expect(markup).not.toContain('branch sync below');
    expect(markup).not.toContain('sync health on this device');
  });

  it('keeps Customers With Balance only in Credit Watch', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        state: DEFAULT_DESKTOP_APP_STATE,
        pendingOutboxCount: 0,
        onRunSync: async () => undefined,
        syncBusy: false
      })
    );

    const matches = markup.match(/Customers With Balance/g) ?? [];
    expect(matches).toHaveLength(0);
    expect(markup).toContain('Credit watch');
    expect(markup).toContain('Paid credit');
    expect(markup).toContain('Sales trail');
    expect(markup).not.toContain('Today Total Credits');
    expect(markup).not.toContain('Unpaid Receipts');
    expect(markup).not.toContain('Credit Payments');
    const badgeMatches = markup.match(/dashboard-credit-count-badge/g) ?? [];
    expect(badgeMatches).toHaveLength(3);
  });
});
