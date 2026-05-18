import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { SalesModule } from '../sales/sales.module';
import { CustomerPaymentsModule } from '../customer-payments/customer-payments.module';
import { LendingModule } from '../lending/lending.module';
import { LpgItemActionsModule } from '../lpg-item-actions/lpg-item-actions.module';
import { TransfersModule } from '../transfers/transfers.module';
import { CylindersModule } from '../cylinders/cylinders.module';
import { PrismaModule } from '../../common/prisma.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  imports: [
    PrismaModule,
    EntitlementsModule,
    SalesModule,
    CustomerPaymentsModule,
    MasterDataModule,
    PurchaseOrdersModule,
    LendingModule,
    LpgItemActionsModule,
    TransfersModule,
    CylindersModule
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
