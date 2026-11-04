import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { ExpenseDetailModal, ExpenseScreen, PettyCashEntryModal, sanitizeExpenseAmountInput } from '../src/screens/ExpenseScreen';
import { DesktopTutorialProvider } from '../src/tutorial/tutorial-provider';

jest.mock('../src/components/feedback/DesktopUiFeedback', () => ({
  useDesktopUi: () => ({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  })
}));

describe('PettyCashEntryModal', () => {
  it('sanitizes petty cash amount input to numeric money values only', () => {
    expect(sanitizeExpenseAmountInput('abc')).toBe('');
    expect(sanitizeExpenseAmountInput('PHP 12ab3')).toBe('123');
    expect(sanitizeExpenseAmountInput('0010.999')).toBe('10.99');
    expect(sanitizeExpenseAmountInput('.5')).toBe('0.5');
  });

  it('renders the redesigned petty cash entry sections and primary action', () => {
    const markup = renderToStaticMarkup(
      React.createElement(PettyCashEntryModal, {
        saving: false,
        selectedCategory: {
          id: 'cat-1',
          label: 'Fuel',
          subtitle: 'Vehicle expense'
        },
        categoriesAvailable: true,
        direction: 'OUT',
        amount: '500',
        notes: 'Driver fuel top-up',
        reference: 'OR No. 12345',
        quickAmountOptions: ['100', '200', '500', '1000'],
        allowPettyCashAttachments: true,
        draftAttachments: [
          {
            id: 'attach-1',
            fileName: 'receipt.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 2048,
            previewDataUrl: 'data:image/jpeg;base64,AAAA',
            createdAt: '2026-06-03T10:00:00.000Z'
          }
        ],
        onClose: () => undefined,
        onOpenCategory: () => undefined,
        onDirectionChange: () => undefined,
        onAmountChange: () => undefined,
        onQuickAmount: () => undefined,
        onNotesChange: () => undefined,
        onReferenceChange: () => undefined,
        onAddAttachment: () => undefined,
        onRemoveAttachment: () => undefined,
        onAttachmentInputChange: () => undefined,
        attachmentInputRef: { current: null },
        onSubmit: () => undefined
      })
    );

    expect(markup).toContain('Add Petty Cash Record');
    expect(markup).toContain('Cash replenishment');
    expect(markup).toContain('Date &amp; Time');
    expect(markup).toContain('Payment Type');
    expect(markup).toContain('Reference');
    expect(markup).toContain('Attachment');
    expect(markup).toContain('Add file');
    expect(markup).toContain('Save Record');
    expect(markup).toContain('expense-entry-modal-shell');
    expect(markup).toContain('expense-entry-modal-body');
    expect(markup).toContain('expense-entry-modal-footer');
  });

  it('renders the expense page without the current shift card', () => {
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        operatorName: 'Cashier',
        branchId: 'branch-1',
        branchLabel: 'VMJAM - Desktop',
        locationId: 'location-1',
        locationLabel: 'VMJAM - Desktop Primary'
      }
    };

    const markup = renderToStaticMarkup(
      React.createElement(
        DesktopTutorialProvider,
        null,
        React.createElement(ExpenseScreen, {
          appState: state,
          onOutboxChanged: () => undefined
        })
      )
    );

    expect(markup).toContain('Expense Management');
    expect(markup).toContain('Cash In');
    expect(markup).not.toContain('Current Shift');
    expect(markup).toContain('Record Transaction');
  });

  it('renders expense detail modal content for a selected record', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ExpenseDetailModal, {
        entry: {
          id: 'exp-1',
          shiftId: 'desk-shift-1',
          categoryCode: 'OFFICE',
          categoryLabel: 'Office Supplies',
          direction: 'OUT',
          amount: 200,
          notes: 'Reference: OR-0091',
          attachments: [
            {
              id: 'att-1',
              fileName: 'receipt.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024,
              previewDataUrl: 'data:image/jpeg;base64,AAAA',
              createdAt: '2026-06-03T10:00:00.000Z'
            }
          ],
          syncStatus: 'pending',
          lastError: 'Waiting for internet',
          createdAt: '2026-06-03T10:00:00.000Z',
          updatedAt: '2026-06-03T10:05:00.000Z'
        },
        onClose: () => undefined
      })
    );

    expect(markup).toContain('Expense detail');
    expect(markup).toContain('Office Supplies');
    expect(markup).toContain('desk-shift-1');
    expect(markup).toContain('Waiting for internet');
    expect(markup).toContain('receipt.jpg');
    expect(markup).toContain('Expense notes');
  });
});
