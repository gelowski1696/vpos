import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DesktopSaleRecord } from '../src/db/schema';
import { SalesDetailModalContent } from '../src/screens/SalesScreen';

describe('SalesDetailModalContent', () => {
  it('renders the redesigned sales detail sheet with assignment, context, payment history, lines, and returns', () => {
    const sale: DesktopSaleRecord = {
      id: 'desk-sale-1780643572557',
      receiptNumber: '20260605-0000006',
      saleStatus: 'ACTIVE',
      syncStatus: 'pending',
      createdAt: '2026-06-05T15:12:52.000Z',
      updatedAt: '2026-06-05T15:13:32.000Z',
      payload: {
        id: 'desk-sale-1780643572557',
        shiftId: 'shift-1',
        customerId: 'cust-1',
        customerName: 'Angelo',
        personnelId: 'pers-1',
        personnelName: 'P1DESK - Personnel-1 from Desktop',
        helperId: null,
        helperName: null,
        saleType: 'PICKUP',
        paymentMode: 'PARTIAL',
        paymentMethod: 'CASH',
        branchId: 'branch-1',
        branchLabel: 'VMJAM - Desktop',
        locationId: 'loc-1',
        locationLabel: 'VMJAM - Desktop Primary',
        subtotal: 100,
        discountAmount: 0,
        deliveryFee: 0,
        totalAmount: 100,
        paidAmount: 50,
        changeAmount: 0,
        creditBalance: 50,
        payments: [],
        rewardName: null,
        notes: null,
        lines: [
          {
            lineId: 'line-1',
            productId: 'prod-1',
            productName: 'A',
            quantity: 1,
            unitPrice: 50,
            lineTotal: 50,
            cylinderFlow: 'REFILL_EXCHANGE'
          },
          {
            lineId: 'line-2',
            productId: 'prod-2',
            productName: 'B',
            quantity: 1,
            unitPrice: 50,
            lineTotal: 50,
            cylinderFlow: 'NON_REFILL'
          }
        ],
        createdAt: '2026-06-05T15:12:52.000Z'
      },
      returns: []
    };

    const markup = renderToStaticMarkup(
      React.createElement(SalesDetailModalContent, {
        sale,
        customerAddress: 'Pasay City',
        paymentMethodLabel: 'Cash',
        statusLabel: 'Pending',
        statusTone: 'pending',
        discountAmount: 0,
        creditDue: 50,
        saleAssignmentTitle: 'Sale Assignment',
        saleAssignmentDescription: 'Branch follow-up and cashier review',
        payBalanceDisabled: false,
        returnDisabled: false,
        creditPaymentHistory: [
          {
            id: 'pay-1',
            amount: 50,
            method: 'Cash',
            referenceNo: null,
            notes: 'Settlement for sale 20260605-0000006',
            createdAt: '2026-06-05T15:13:32.000Z',
            status: 'pending'
          }
        ],
        lineRows: [
          {
            key: 'line-1',
            title: 'A',
            subtitle: 'LPG Item',
            typeLabel: 'Refill',
            sizeLabel: '5 kg',
            quantityLabel: '1',
            unitPriceLabel: 'PHP 50.00',
            lineTotalLabel: 'PHP 50.00',
            chips: [
              { label: 'Flow: Refill', tone: 'accent' },
              { label: 'Fully Lent', tone: 'good' }
            ],
            lendActionLabel: 'Lend',
            lendActionDisabled: false,
            onLend: () => undefined
          },
          {
            key: 'line-2',
            title: 'B',
            subtitle: 'LPG Item',
            typeLabel: 'Non-Refill',
            sizeLabel: '22 kg',
            quantityLabel: '1',
            unitPriceLabel: 'PHP 50.00',
            lineTotalLabel: 'PHP 50.00',
            chips: [{ label: 'Flow: Non-Refill', tone: 'accent' }]
          }
        ],
        returnHistory: [
          {
            id: 'ret-1',
            source: 'LENDING_RETURN',
            reason: 'Lending Return',
            lineCount: 1,
            amount: null,
            quantity: 1,
            createdAt: '2026-06-05T15:13:22.000Z',
            status: 'pending',
            note: 'B | GOOD'
          }
        ],
        onReprint: () => undefined,
        onOpenBreakdown: () => undefined,
        onOpenPayment: () => undefined,
        onOpenReturn: () => undefined,
        onOpenCancel: () => undefined,
        onReopenSale: () => undefined,
        onClose: () => undefined
      })
    );

    expect(markup).toContain('Sale detail');
    expect(markup).toContain('Receipt #20260605-0000006');
    expect(markup).toContain('Sale ID: desk-sale-1780643572557');
    expect(markup).toContain('Payment Breakdown');
    expect(markup).toContain('Pay Balance');
    expect(markup).toContain('Return Item');
    expect(markup).toContain('Cancel Sale');
    expect(markup).toContain('Sale Assignment');
    expect(markup).toContain('Receipt Context');
    expect(markup).toContain('Credit Payments');
    expect(markup).toContain('Sale Lines');
    expect(markup).toContain('Return History');
    expect(markup).toContain('sales-detail-modal-body');
    expect(markup).toContain('sales-detail-hero-title');
    expect(markup).toContain('sales-detail-summary-grid');
    expect(markup).toContain('sales-detail-lines-table');
    expect(markup).not.toContain('Audit context');
  });

  it('can hide sales-only actions for reused customer transaction detail views', () => {
    const sale: DesktopSaleRecord = {
      id: 'desk-sale-customer-view',
      receiptNumber: '20260606-0000001',
      saleStatus: 'ACTIVE',
      syncStatus: 'pending',
      createdAt: '2026-06-06T10:12:52.000Z',
      updatedAt: '2026-06-06T10:13:32.000Z',
      payload: {
        id: 'desk-sale-customer-view',
        customerId: 'cust-1',
        customerName: 'Albert',
        saleType: 'PICKUP',
        paymentMode: 'PARTIAL',
        paymentMethod: 'CASH',
        branchLabel: 'VMJAM - Desktop',
        locationLabel: 'VMJAM - Desktop Primary',
        subtotal: 100,
        discountAmount: 0,
        totalAmount: 100,
        paidAmount: 50,
        creditBalance: 50,
        notes: null,
        lines: [],
        createdAt: '2026-06-06T10:12:52.000Z'
      }
    } as any;

    const markup = renderToStaticMarkup(
      React.createElement(SalesDetailModalContent, {
        sale,
        customerAddress: 'Juan Luna Street',
        paymentMethodLabel: 'Cash',
        statusLabel: 'Pending',
        statusTone: 'pending',
        discountAmount: 0,
        creditDue: 50,
        saleAssignmentTitle: 'Sale Assignment',
        saleAssignmentDescription: 'Branch follow-up and cashier review',
        payBalanceDisabled: false,
        returnDisabled: true,
        creditPaymentHistory: [],
        lineRows: [],
        returnHistory: [],
        onReprint: () => undefined,
        onOpenBreakdown: () => undefined,
        onOpenPayment: () => undefined,
        onOpenReturn: () => undefined,
        onOpenCancel: () => undefined,
        showReprintAction: false,
        showBreakdownAction: false,
        showReturnAction: false,
        showCancelAction: false,
        onClose: () => undefined
      })
    );

    expect(markup).toContain('Pay Balance');
    expect(markup).not.toContain('Reprint Receipt');
    expect(markup).not.toContain('Payment Breakdown');
    expect(markup).not.toContain('Return Item');
    expect(markup).not.toContain('Cancel Sale');
  });
});
