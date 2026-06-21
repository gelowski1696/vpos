import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TenantOperationalResetDialog } from '../src/components/tenant-operational-reset-dialog';

describe('TenantOperationalResetDialog', () => {
  const baseProps = {
    open: true,
    companyCode: 'TEN001',
    companyName: 'Tenant One',
    notesValue: '',
    onClose: () => undefined,
    onConfirm: () => undefined,
    onConfirmationChange: () => undefined,
    onNotesChange: () => undefined,
    saving: false
  };

  it('renders the destructive confirmation copy and keeps submit disabled until the code matches', () => {
    const html = renderToStaticMarkup(createElement(TenantOperationalResetDialog, {
      ...baseProps,
      confirmationValue: ''
    }));

    expect(html).toContain('Reset Tenant Data');
    expect(html).toContain('Type');
    expect(html).toContain('TEN001');
    expect(html).toContain('Optional notes');
    expect(html).toContain('Reset Data');
    expect(html).toContain('disabled=""');
  });

  it('removes the disabled state once the typed confirmation matches', () => {
    const html = renderToStaticMarkup(createElement(TenantOperationalResetDialog, {
      ...baseProps,
      confirmationValue: 'TEN001'
    }));

    expect(html).toContain('Reset Tenant Data');
    expect(html).toContain('Reset Data');
    expect(html).not.toContain('disabled=""');
  });
});
