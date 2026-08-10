import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canManagePosSettings,
  DEFAULT_TENANT_POS_SETTINGS,
  type TenantPosSettings
} from '../src/lib/pos-settings-policy';
import { PosSettingsPanel } from '../src/components/pos-settings-panel';

describe('PosSettingsPanel', () => {
  const basePolicy: TenantPosSettings = {
    ...DEFAULT_TENANT_POS_SETTINGS,
    updated_at: '2026-06-22T10:00:00.000Z',
    updated_by: 'admin-user'
  };

  const baseProps = {
    policy: basePolicy,
    draft: basePolicy,
    note: '',
    dirty: false,
    saving: false,
    canEdit: true,
    addons: {
      purchase_order_suite: false,
      delivery_dispatch_suite: true
    },
    onToggle: () => undefined,
    onNoteChange: () => undefined,
    onSave: () => undefined,
    onReset: () => undefined
  };

  it('renders the grouped POS settings controls and audit note field', () => {
    const html = renderToStaticMarkup(createElement(PosSettingsPanel, baseProps));

    expect(html).toContain('POS Settings');
    expect(html).toContain('Reports');
    expect(html).toContain('Inventory Reports');
    expect(html).toContain('Transfer');
    expect(html).toContain('Optional audit note');
    expect(html).toContain('Save POS Settings');
  });

  it('shows add-on helper copy for purchase-order and delivery controls', () => {
    const html = renderToStaticMarkup(createElement(PosSettingsPanel, baseProps));

    expect(html).toContain('Purchase Orders');
    expect(html).toContain('Delivery Dispatch');
    expect(html).toContain('Requires add-on');
    expect(html).toContain('Not enabled for this tenant');
  });

  it('allows POS settings management for admin sessions only', () => {
    expect(canManagePosSettings(['admin'])).toBe(true);
    expect(canManagePosSettings(['owner'])).toBe(false);
    expect(canManagePosSettings(['platform_owner'])).toBe(false);
    expect(canManagePosSettings(['supervisor'])).toBe(false);
    expect(canManagePosSettings(['cashier'])).toBe(false);
  });
});
