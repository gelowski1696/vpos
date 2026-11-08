export type TransferQuantityHeaders = {
  full: string;
  empty: string;
};

export function transferQuantityHeaders(
  mode: string | null | undefined
): TransferQuantityHeaders {
  switch (mode?.trim().toUpperCase()) {
    case 'SUPPLIER_RESTOCK_IN':
      return { full: 'FULL (+)', empty: 'EMPTY (+)' };
    case 'SUPPLIER_RESTOCK_OUT':
      return { full: 'FULL (-)', empty: 'EMPTY (-)' };
    case 'CREATE':
      return { full: 'FULL (+)', empty: 'EMPTY (-)' };
    case 'USED':
      return { full: 'FULL (-)', empty: 'EMPTY (+)' };
    case 'CONVERT':
      return { full: 'EMPTY (+)', empty: 'EMPTY (-)' };
    default:
      return { full: 'FULL (- / +)', empty: 'EMPTY (- / +)' };
  }
}
