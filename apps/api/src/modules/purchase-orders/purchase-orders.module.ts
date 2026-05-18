import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService]
})
export class PurchaseOrdersModule {}
