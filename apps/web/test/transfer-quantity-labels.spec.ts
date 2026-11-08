import { transferQuantityHeaders } from '../src/lib/transfer-quantity-labels';

describe('transfer quantity headers', () => {
  it.each([
    ['SUPPLIER_RESTOCK_IN', { full: 'FULL (+)', empty: 'EMPTY (+)' }],
    ['SUPPLIER_RESTOCK_OUT', { full: 'FULL (-)', empty: 'EMPTY (-)' }],
    ['CREATE', { full: 'FULL (+)', empty: 'EMPTY (-)' }],
    ['USED', { full: 'FULL (-)', empty: 'EMPTY (+)' }],
    ['CONVERT', { full: 'EMPTY (+)', empty: 'EMPTY (-)' }],
    ['INTER_STORE_TRANSFER', { full: 'FULL (- / +)', empty: 'EMPTY (- / +)' }],
    ['STORE_TO_WAREHOUSE', { full: 'FULL (- / +)', empty: 'EMPTY (- / +)' }],
    ['WAREHOUSE_TO_STORE', { full: 'FULL (- / +)', empty: 'EMPTY (- / +)' }],
    ['GENERAL', { full: 'FULL (- / +)', empty: 'EMPTY (- / +)' }]
  ] as const)('labels %s quantities with their inventory direction', (mode, expected) => {
    expect(transferQuantityHeaders(mode)).toEqual(expected);
  });
});
