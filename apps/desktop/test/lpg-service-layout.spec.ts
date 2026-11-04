import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LpgServiceDetailModal, LpgServiceHistoryModal, LpgServiceOverviewPanel, LpgServiceRecordsPanel } from '../src/screens/LpgServiceScreen';

describe('LpgServiceOverviewPanel', () => {
  it('renders the management header and compact overview cards without a scope card', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LpgServiceOverviewPanel, {
        metrics: [
          { key: 'dispose', label: 'Disposed', value: '3', icon: 'dispose', tone: 'out' },
          { key: 'replace', label: 'Replaced', value: '1', icon: 'replace', tone: 'good' },
          { key: 'junk', label: 'Junked', value: '2', icon: 'junk', tone: 'warn' },
          { key: 'queued', label: 'Queued', value: '4', icon: 'pending', tone: 'pending' }
        ],
        onRefresh: () => undefined,
        onHistory: () => undefined,
        onDispose: () => undefined,
        refreshDisabled: false,
        disposeDisabled: false
      })
    );

    expect(markup).toContain('LPG Service Management');
    expect(markup).toContain('Disposed');
    expect(markup).toContain('Queued');
    expect(markup).not.toContain('Current service scope');
    expect(markup).toContain('Dispose Item');
    expect(markup).toContain('Service History');
  });

  it('renders the redesigned service records board with counts, focus card, and footer pager', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LpgServiceRecordsPanel, {
        title: 'Disposed Records',
        description: 'Review the full disposed, replaced, and junked trail for the current filter.',
        searchValue: '',
        onSearchChange: () => undefined,
        filterOptions: [
          { key: 'ALL', label: 'All Records', count: 28, active: false, onClick: () => undefined },
          { key: 'DISPOSE', label: 'Disposed', count: 12, active: true, onClick: () => undefined },
          { key: 'JUNK', label: 'Junked', count: 8, active: false, onClick: () => undefined },
          { key: 'REPLACE', label: 'Replaced', count: 8, active: false, onClick: () => undefined }
        ],
        records: [
          {
            key: 'disp-12',
            avatarLabel: 'B',
            avatarTone: 'dispose',
            title: 'Item B | EMPTY 5',
            subtitle: 'Disposed x 10',
            timestamp: 'May 30, 2026, 11:04:55 AM',
            chips: [
              { label: 'Junk 5', tone: 'warn' },
              { label: 'Replaced 5', tone: 'good' },
              { label: 'Disposed 10', tone: 'accent' },
              { label: 'EMPTY 5', tone: 'neutral' }
            ],
            reason: '5 Junk 5 Replace',
            statusLabel: 'Disposed',
            statusTone: 'out',
            recordCode: 'DISP-00012',
            syncLabel: null,
            actions: [
              { key: 'replace', label: 'Replace', tone: 'primary', icon: 'replace', onClick: () => undefined },
              { key: 'junk', label: 'Junk', tone: 'danger', icon: 'junk', onClick: () => undefined }
            ]
          },
          {
            key: 'disp-11',
            avatarLabel: 'A',
            avatarTone: 'replace',
            title: 'Item A | EMPTY 17',
            subtitle: 'Disposed x 1',
            timestamp: 'May 29, 2026, 12:36:44 AM',
            chips: [
              { label: 'Junk 0', tone: 'warn' },
              { label: 'Replaced 0', tone: 'good' },
              { label: 'Disposed 1', tone: 'accent' },
              { label: 'EMPTY 17', tone: 'neutral' }
            ],
            reason: 'TEST GELO 2',
            statusLabel: 'Disposed',
            statusTone: 'out',
            recordCode: 'DISP-00011',
            syncLabel: 'Pending Sync',
            actions: [{ key: 'replace', label: 'Replace', tone: 'primary', icon: 'replace', onClick: () => undefined }]
          }
        ],
        emptyMessage: 'No disposed records found for this location.'
      })
    );

    expect(markup).toContain('Disposed Records');
    expect(markup).toContain('Search LPG item, reason, or notes');
    expect(markup).not.toContain('Current Focus');
    expect(markup).not.toContain('Reset filters');
    expect(markup).not.toContain('View Details');
    expect(markup).toContain('Replace');
    expect(markup).toContain('Junk');
    expect(markup).toContain('Showing 1 to 2 of 2 records');
    expect(markup).toContain('10 per page');
  });

  it('renders the service history modal with compact chips and action cards', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LpgServiceHistoryModal, {
        filterOptions: [
          { key: 'ALL', label: 'All Records', count: 28, active: true, onClick: () => undefined },
          { key: 'DISPOSE', label: 'Disposed', count: 12, active: false, onClick: () => undefined },
          { key: 'REPLACE', label: 'Replaced', count: 8, active: false, onClick: () => undefined },
          { key: 'JUNK', label: 'Junked', count: 8, active: false, onClick: () => undefined }
        ],
        records: [
          {
            key: 'history-1',
            actionType: 'REPLACE',
            title: 'Item B | Replaced x 2',
            timestamp: 'May 30, 2026',
            timeLabel: '11:11:35 AM',
            referenceLabel: 'From B disposed on May 30, 2026, 11:04:55 AM',
            qtyLabel: 'Qty 2',
            itemLabel: 'Item B',
            reason: 'Replace 2',
            statusLabel: 'Replaced',
            onOpen: () => undefined
          },
          {
            key: 'history-2',
            actionType: 'JUNK',
            title: 'Item B | Junked x 5',
            timestamp: 'May 30, 2026',
            timeLabel: '11:11:34 AM',
            referenceLabel: 'From B disposed on May 30, 2026, 11:04:55 AM',
            qtyLabel: 'Qty 5',
            itemLabel: 'Item B',
            reason: 'Junk 5',
            statusLabel: 'Junked',
            onOpen: () => undefined
          }
        ],
        onClose: () => undefined
      })
    );

    expect(markup).toContain('LPG Service History');
    expect(markup).toContain('All Records');
    expect(markup).toContain('Showing 1 to 2 of 2 records');
    expect(markup).toContain('Item B | Replaced x 2');
    expect(markup).toContain('Reason: Replace 2');
    expect(markup).toContain('View Details');
    expect(markup).toContain('10 per page');
  });

  it('renders the LPG service detail modal for a selected record', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LpgServiceDetailModal, {
        entry: {
          id: 'lpg-1',
          branchId: 'branch-1',
          branchCode: null,
          branchName: 'VMJAM',
          locationId: 'loc-1',
          locationCode: null,
          locationName: 'Desktop Primary',
          productId: 'prod-1',
          productSku: 'SKU-1',
          productName: 'Item A',
          actionType: 'DISPOSE',
          qty: 10,
          reason: 'Damaged cylinders',
          notes: 'Moved to service yard',
          referenceActionId: null,
          createdByUserId: null,
          createdAt: '2026-06-03T10:00:00.000Z',
          updatedAt: '2026-06-03T10:05:00.000Z',
          source: 'local',
          syncStatus: 'pending'
        },
        product: {
          id: 'prod-1',
          sku: 'SKU-1',
          name: 'Item A',
          category: 'LPG',
          unit: 'Cylinder',
          cylinderSizeLabel: '11kg',
          unitPrice: 50,
          qtyOnHand: 40,
          qtyFull: 20,
          qtyEmpty: 20,
          isLpg: true
        },
        referenceDescription: null,
        derivedStats: {
          junkQty: 2,
          replacedQty: 5,
          availableQty: 3
        },
        onClose: () => undefined
      })
    );

    expect(markup).toContain('Service record');
    expect(markup).toContain('Item A');
    expect(markup).toContain('Item Code');
    expect(markup).toContain('Product Name');
    expect(markup).toContain('Damaged cylinders');
    expect(markup).toContain('Moved to service yard');
    expect(markup).toContain('Linked movement summary');
    expect(markup).toContain('Desktop Primary');
  });
});
