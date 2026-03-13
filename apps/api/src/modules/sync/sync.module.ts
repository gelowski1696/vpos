import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { SalesModule } from '../sales/sales.module';
import { CustomerPaymentsModule } from '../customer-payments/customer-payments.module';
import { TransfersModule } from '../transfers/transfers.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [PrismaModule, EntitlementsModule, SalesModule, CustomerPaymentsModule, TransfersModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
