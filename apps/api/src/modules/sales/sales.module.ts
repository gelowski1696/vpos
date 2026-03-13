import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [EntitlementsModule, PrismaModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService]
})
export class SalesModule {}
