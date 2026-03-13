import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [EntitlementsModule, PrismaModule],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService]
})
export class TransfersModule {}
