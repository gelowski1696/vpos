import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [CustomerPaymentsController],
  providers: [CustomerPaymentsService],
  exports: [CustomerPaymentsService]
})
export class CustomerPaymentsModule {}
