import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { LpgItemActionsController } from './lpg-item-actions.controller';
import { LpgItemActionsService } from './lpg-item-actions.service';

@Module({
  imports: [EntitlementsModule, PrismaModule],
  controllers: [LpgItemActionsController],
  providers: [LpgItemActionsService],
  exports: [LpgItemActionsService]
})
export class LpgItemActionsModule {}
