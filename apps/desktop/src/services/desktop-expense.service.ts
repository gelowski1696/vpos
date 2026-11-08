import { DesktopExpenseService as CoreDesktopExpenseService, type DesktopExpensePorts } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopShiftService } from './desktop-shift.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopExpenseService extends CoreDesktopExpenseService {
  constructor(ports: DesktopExpensePorts = {
    repository: desktopDb,
    shift: desktopShiftService,
    sales: desktopDb,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopExpenseService = new DesktopExpenseService();
