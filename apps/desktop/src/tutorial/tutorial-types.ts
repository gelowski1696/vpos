export type DesktopTutorialTargetKey =
  | 'module-help'
  | 'home-status'
  | 'home-pending'
  | 'pos-order-type'
  | 'pos-customer'
  | 'pos-item-selector'
  | 'pos-proceed-payment'
  | 'expense-create'
  | 'expense-filter'
  | 'settings-set-pin'
  | 'settings-open-layout'
  | 'settings-redownload-data'
  | 'settings-save-printer';

export type DesktopTutorialScreenKey = 'HOME' | 'POS' | 'EXPENSE' | 'SETTINGS';

export type DesktopTutorialScope = 'APP_WALKTHROUGH' | 'HOME' | 'POS' | 'EXPENSE' | 'SETTINGS';

export type DesktopTutorialStep = {
  title: string;
  target: string;
  description: string;
  icon: string;
  targetKey?: DesktopTutorialTargetKey;
  screen?: DesktopTutorialScreenKey;
};

export type DesktopTutorialDefinition = {
  title: string;
  steps: DesktopTutorialStep[];
  doneLabel?: string;
};

export type DesktopTutorialTargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
