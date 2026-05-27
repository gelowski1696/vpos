import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { DatabaseMaintenanceController } from './database-maintenance.controller';
import { DatabaseMaintenanceService } from './database-maintenance.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [DatabaseMaintenanceController],
  providers: [DatabaseMaintenanceService]
})
export class DatabaseMaintenanceModule {}
