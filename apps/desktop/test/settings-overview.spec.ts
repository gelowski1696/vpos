import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import {
  isManageSetupPasswordValid,
  resolvePrinterProfileSavedMessage,
  resolvePrinterTestFeedback,
  SettingsScreen
} from '../src/screens/SettingsScreen';
import { DesktopTutorialProvider } from '../src/tutorial/tutorial-provider';

jest.mock('../src/components/feedback/DesktopUiFeedback', () => ({
  useDesktopUi: () => ({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  })
}));

describe('SettingsScreen overview', () => {
  it('validates the hardcoded manage setup access password', () => {
    expect(isManageSetupPasswordValid('Vmjamtech@2026')).toBe(true);
    expect(isManageSetupPasswordValid('vmjamtech@2026')).toBe(false);
    expect(isManageSetupPasswordValid('Vmjamtech@2025')).toBe(false);
  });

  it('builds printer feedback messages for toast notifications', () => {
    expect(resolvePrinterProfileSavedMessage('Front Counter USB')).toBe(
      'Saved printer profile "Front Counter USB" for this desktop station.'
    );
    expect(resolvePrinterTestFeedback({ success: true, profileLabel: 'Front Counter USB' })).toEqual({
      message: 'Printer test was sent using "Front Counter USB".',
      tone: 'success'
    });
    expect(resolvePrinterTestFeedback({ success: true })).toEqual({
      message: 'Printer test was sent. If nothing came out, check the selected USB printer name or LAN host and port.',
      tone: 'success'
    });
    expect(resolvePrinterTestFeedback({ success: false, errorMessage: 'USB printer not found.' })).toEqual({
      message: 'USB printer not found.',
      tone: 'error'
    });
  });

  it('renders the overview dashboard pattern for workstation settings', () => {
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        operatorName: 'Cashier',
        authEmail: 'cashier@vmjam.local',
        branchId: 'branch-1',
        branchLabel: 'VMJAM - Desktop',
        locationId: 'location-1',
        locationLabel: 'VMJAM - Desktop Primary',
        printerMode: 'USB' as const,
        printerName: 'XP-58'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'desktop-token',
        userEmail: 'cashier@vmjam.local'
      },
      sync: {
        ...DEFAULT_DESKTOP_APP_STATE.sync,
        lastSyncedAt: '2026-06-03T09:00:00.000Z',
        lastSyncStatus: 'success' as const,
        lastSyncMessage: 'Branch data ready.'
      }
    };

    const markup = renderToStaticMarkup(
      React.createElement(
        DesktopTutorialProvider,
        null,
        React.createElement(SettingsScreen, {
          state,
          onStateReload: async () => undefined
        })
      )
    );

    expect(markup).toContain('Settings Overview');
    expect(markup).toContain('Manage your workstation setup and preferences');
    expect(markup).toContain('Walkthrough');
    expect(markup).toContain('Manage Printer Settings');
    expect(markup).toContain('Reset Local Data');
    expect(markup).toContain('Desktop OTA');
    expect(markup).not.toContain('Configure workstation setup, printer paths, receipt layout, security PIN, and desktop maintenance.');
  });
});
