import {
  DesktopSubscriptionPolicyService as CoreDesktopSubscriptionPolicyService,
  type DesktopSubscriptionPolicyRepository
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';

export type {
  DesktopSubscriptionAccessMode,
  DesktopSubscriptionPolicyDecision,
  DesktopSubscriptionPolicyRepository,
  DesktopSubscriptionPolicyState,
  DesktopSubscriptionPolicyUpdateInput,
  DesktopSubscriptionStatus
} from '@vpos/desktop-core';

export class DesktopSubscriptionPolicyService extends CoreDesktopSubscriptionPolicyService {
  constructor(repository: DesktopSubscriptionPolicyRepository = desktopDb) {
    super(repository);
  }
}

export const desktopSubscriptionPolicyService = new DesktopSubscriptionPolicyService();
