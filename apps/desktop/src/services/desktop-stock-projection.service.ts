import {
  DesktopStockProjectionService as CoreDesktopStockProjectionService,
  type DesktopStockProjectionRepository
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';

export type { DesktopProjectedInventoryTotals, DesktopStockProjectionRepository } from '@vpos/desktop-core';

export class DesktopStockProjectionService extends CoreDesktopStockProjectionService {
  constructor(repository: DesktopStockProjectionRepository = desktopDb) {
    super(repository);
  }
}

export const desktopStockProjectionService = new DesktopStockProjectionService();
