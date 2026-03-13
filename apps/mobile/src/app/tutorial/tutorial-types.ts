export type TutorialTargetKey =
  | 'module-help'
  | 'home-status'
  | 'home-pending'
  | 'pos-order-type'
  | 'pos-customer'
  | 'pos-item-selector'
  | 'pos-proceed-payment'
  | 'sales-search'
  | 'sales-first-row'
  | 'sales-refresh'
  | 'transfer-source'
  | 'transfer-product'
  | 'transfer-queue'
  | 'expense-create'
  | 'expense-filter'
  | 'items-search'
  | 'items-first-card'
  | 'customers-search'
  | 'customers-first-card'
  | 'shift-start-duty'
  | 'shift-end-duty'
  | 'shift-cash-adjust'
  | 'settings-set-pin'
  | 'settings-open-layout'
  | 'settings-redownload-data'
  | 'settings-save-printer';

export type TutorialScreenKey =
  | 'HOME'
  | 'POS'
  | 'SALES'
  | 'TRANSFER'
  | 'EXPENSE'
  | 'ITEMS'
  | 'CUSTOMERS'
  | 'SHIFT'
  | 'SETTINGS';

export type TutorialScope =
  | 'PIN_SETUP'
  | 'APP_WALKTHROUGH'
  | 'HOME'
  | 'POS'
  | 'SALES'
  | 'TRANSFER'
  | 'EXPENSE'
  | 'ITEMS'
  | 'CUSTOMERS'
  | 'SHIFT'
  | 'SETTINGS';

export type TutorialStep = {
  title: string;
  target: string;
  description: string;
  icon: string;
  targetKey?: TutorialTargetKey;
  screen?: TutorialScreenKey;
};

export type TutorialDefinition = {
  title: string;
  steps: TutorialStep[];
  doneLabel?: string;
};

export type TutorialTargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
