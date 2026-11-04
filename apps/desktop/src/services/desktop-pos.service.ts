import { DesktopPosService } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopDeliveryService } from './desktop-delivery.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

// React compatibility adapter. New framework clients compose the shared service directly.
export const desktopPosService = new DesktopPosService({
  repository: desktopDb,
  subscriptionPolicy: desktopSubscriptionPolicyService,
  delivery: desktopDeliveryService
});
