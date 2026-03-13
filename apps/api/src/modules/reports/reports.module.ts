import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaModule } from '../../common/prisma.module';

@Module({
  imports: [SyncModule, EntitlementsModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService]
})
export class ReportsModule {}
