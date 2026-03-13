import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [EntitlementsModule, PrismaModule],
  controllers: [DeliveryController],
  providers: [DeliveryService]
})
export class DeliveryModule {}
