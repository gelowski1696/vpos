import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { LendingController } from './lending.controller';
import { LendingService } from './lending.service';

@Module({
  imports: [PrismaModule, EntitlementsModule, AuditModule],
  controllers: [LendingController],
  providers: [LendingService],
  exports: [LendingService]
})
export class LendingModule {}
