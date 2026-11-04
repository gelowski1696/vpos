import type { DesktopTutorialDefinition, DesktopTutorialScope } from './tutorial-types';

export const DESKTOP_TUTORIAL_DEFINITIONS: Record<DesktopTutorialScope, DesktopTutorialDefinition> = {
  APP_WALKTHROUGH: {
    title: 'VPOS Walkthrough',
    doneLabel: 'Finish',
    steps: [
      {
        title: 'Pending Queue',
        target: 'Home > Pending Sync card',
        description: 'This shows how many records are still waiting to send after offline work.',
        icon: '\u{1F4E6}',
        targetKey: 'home-pending',
        screen: 'HOME'
      },
      {
        title: 'Order Type',
        target: 'POS > Pickup or Delivery',
        description: 'Choose the sale type before adding items so the rest of the flow stays correct.',
        icon: '\u{1F6D2}',
        targetKey: 'pos-order-type',
        screen: 'POS'
      },
      {
        title: 'Customer',
        target: 'POS > Customer selector',
        description: 'Select the customer before proceeding to payment.',
        icon: '\u{1F465}',
        targetKey: 'pos-customer',
        screen: 'POS'
      },
      {
        title: 'Items',
        target: 'POS > Item selector',
        description: 'Open the picker, add products, then review quantity and LPG flow in the cart.',
        icon: '+',
        targetKey: 'pos-item-selector',
        screen: 'POS'
      },
      {
        title: 'Payment',
        target: 'POS > Proceed To Payment',
        description: 'When the sale is ready, open the payment sheet to complete the transaction.',
        icon: '\u20B1',
        targetKey: 'pos-proceed-payment',
        screen: 'POS'
      },
      {
        title: 'Petty Cash',
        target: 'Expense > Record Petty Cash',
        description: 'Use this when the branch needs to record cash out or cash in during an active shift.',
        icon: '\u20B1',
        targetKey: 'expense-create',
        screen: 'EXPENSE'
      },
      {
        title: 'Petty Cash Filter',
        target: 'Expense > Entry filters',
        description: 'Switch between all entries, cash out, and cash in when checking recent petty cash activity.',
        icon: '\u{1F50D}',
        targetKey: 'expense-filter',
        screen: 'EXPENSE'
      },
      {
        title: 'Security PIN',
        target: 'Settings > Set or Change PIN',
        description: 'Save a 4-digit PIN so the cashier can reopen the app quickly without typing the password every time.',
        icon: '\u{1F512}',
        targetKey: 'settings-set-pin',
        screen: 'SETTINGS'
      },
      {
        title: 'Receipt Layout',
        target: 'Settings > Open Receipt Layout',
        description: 'Use the layout editor to control what appears on printed receipts before going live.',
        icon: '\u{1F9FE}',
        targetKey: 'settings-open-layout',
        screen: 'SETTINGS'
      },
      {
        title: 'Branch Data',
        target: 'Settings > Refresh Branch Data',
        description: 'Run this after the web admin updates branch prices or master data so the desktop cache stays current.',
        icon: '\u2B73',
        targetKey: 'settings-redownload-data',
        screen: 'SETTINGS'
      },
      {
        title: 'Printer Profile',
        target: 'Settings > Save and test printer profile',
        description: 'After choosing USB or LAN printer details, save the profile and test it before cashier use.',
        icon: '\u{1F5A8}',
        targetKey: 'settings-save-printer',
        screen: 'SETTINGS'
      }
    ]
  },
  HOME: {
    title: 'Home Guide',
    steps: [
      {
        title: 'Pending Sync',
        target: 'Home > Pending Sync card',
        description: 'Keep an eye on this so queued transactions are not forgotten after offline work.',
        icon: '\u{1F4E6}',
        targetKey: 'home-pending',
        screen: 'HOME'
      },
      {
        title: 'Help Button',
        target: 'Header > Help button',
        description: 'Use this any time to replay the guide for the current screen.',
        icon: '?',
        targetKey: 'module-help',
        screen: 'HOME'
      }
    ]
  },
  POS: {
    title: 'POS Guide',
    steps: [
      {
        title: 'Order Type',
        target: 'POS > Pickup or Delivery',
        description: 'Choose whether this sale is pickup or delivery before the rest of the selections.',
        icon: '\u{1F6D2}',
        targetKey: 'pos-order-type',
        screen: 'POS'
      },
      {
        title: 'Select Customer',
        target: 'POS > Customer selector',
        description: 'Select the customer before you continue to payment.',
        icon: '\u{1F465}',
        targetKey: 'pos-customer',
        screen: 'POS'
      },
      {
        title: 'Select Items',
        target: 'POS > Item selector',
        description: 'Open the item picker, add products, then set quantity and LPG flow in the cart.',
        icon: '+',
        targetKey: 'pos-item-selector',
        screen: 'POS'
      },
      {
        title: 'Proceed To Payment',
        target: 'POS > Proceed To Payment',
        description: 'Open the payment sheet when the customer, personnel, items, and totals are ready.',
        icon: '\u20B1',
        targetKey: 'pos-proceed-payment',
        screen: 'POS'
      }
    ]
  },
  EXPENSE: {
    title: 'Expense Guide',
    steps: [
      {
        title: 'Record Petty Cash',
        target: 'Expense > Record Petty Cash',
        description: 'Use this action to queue a petty cash entry for the active shift.',
        icon: '\u20B1',
        targetKey: 'expense-create',
        screen: 'EXPENSE'
      },
      {
        title: 'Filter Entries',
        target: 'Expense > Filters',
        description: 'Switch between all entries, cash out, and cash in when reviewing petty cash history.',
        icon: '\u{1F50D}',
        targetKey: 'expense-filter',
        screen: 'EXPENSE'
      },
      {
        title: 'Help Button',
        target: 'Header > Help button',
        description: 'Replay this guide any time from the header help button.',
        icon: '?',
        targetKey: 'module-help',
        screen: 'EXPENSE'
      }
    ]
  },
  SETTINGS: {
    title: 'Settings Guide',
    steps: [
      {
        title: 'Security PIN',
        target: 'Settings > Set or Change PIN',
        description: 'Save a 4-digit PIN so the cashier can unlock this workstation faster.',
        icon: '\u{1F512}',
        targetKey: 'settings-set-pin',
        screen: 'SETTINGS'
      },
      {
        title: 'Receipt Layout',
        target: 'Settings > Open Receipt Layout',
        description: 'Adjust the printed receipt layout before using this workstation at the counter.',
        icon: '\u{1F9FE}',
        targetKey: 'settings-open-layout',
        screen: 'SETTINGS'
      },
      {
        title: 'Branch Data',
        target: 'Settings > Refresh Branch Data',
        description: 'Run this whenever branch master data changes on the server.',
        icon: '\u2B73',
        targetKey: 'settings-redownload-data',
        screen: 'SETTINGS'
      },
      {
        title: 'Printer Profile',
        target: 'Settings > Save and test printer profile',
        description: 'Save the printer path and test it so receipt printing is ready for the cashier.',
        icon: '\u{1F5A8}',
        targetKey: 'settings-save-printer',
        screen: 'SETTINGS'
      },
      {
        title: 'Help Button',
        target: 'Header > Help button',
        description: 'Replay this guide at any time from the header help button.',
        icon: '?',
        targetKey: 'module-help',
        screen: 'SETTINGS'
      }
    ]
  }
};
