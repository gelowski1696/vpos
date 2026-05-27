import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditActionLevel } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { DatabaseMaintenanceService } from './database-maintenance.service';

type AuthRequest = Request & {
  user?: { sub?: string; company_id?: string };
};

@Controller('database-maintenance')
@Roles('admin', 'owner', 'platform_owner')
export class DatabaseMaintenanceController {
  constructor(
    private readonly databaseMaintenanceService: DatabaseMaintenanceService,
    private readonly auditService: AuditService
  ) {}

  @Get('backup')
  async backup(@Req() req: AuthRequest) {
    const companyId = this.requireCompanyId(req);
    const result = await this.databaseMaintenanceService.createBackup(companyId);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'DATABASE_BACKUP_EXPORT',
      entity: 'TenantDatabaseBackup',
      entityId: result.backupId,
      metadata: {
        file_name: result.fileName,
        row_count: result.payload.summary.rowCount,
        table_count: result.payload.summary.tableCount,
        created_at: result.payload.createdAt,
        datastore_mode: result.payload.datastoreMode
      }
    });
    return result;
  }

  @Post('restore')
  async restore(
    @Req() req: AuthRequest,
    @Body() body: { payload?: unknown; confirmation?: string }
  ) {
    const companyId = this.requireCompanyId(req);
    const confirmation = String(body?.confirmation ?? '').trim().toUpperCase();
    if (confirmation !== 'RESTORE') {
      throw new BadRequestException('Confirmation value must be RESTORE.');
    }
    try {
      const result = await this.databaseMaintenanceService.restoreBackup(
        companyId,
        body?.payload
      );
      await this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'DATABASE_RESTORE_IMPORT',
        entity: 'TenantDatabaseRestore',
        entityId: `tenant-restore-${companyId}-${Date.now()}`,
        metadata: {
          restored_at: result.restoredAt,
          tables_restored: result.tablesRestored,
          rows_deleted: result.rowsDeleted,
          rows_inserted: result.rowsInserted,
          datastore_mode: result.datastoreMode
        },
        level: AuditActionLevel.WARNING
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Database restore failed';
      await this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'DATABASE_RESTORE_IMPORT_FAILED',
        entity: 'TenantDatabaseRestore',
        entityId: `tenant-restore-failed-${companyId}-${Date.now()}`,
        metadata: {
          error: message
        },
        level: AuditActionLevel.CRITICAL
      });
      throw error;
    }
  }

  private requireCompanyId(req: AuthRequest): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
