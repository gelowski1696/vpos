import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
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

  @Get('backups')
  async listBackups(
    @Req() req: AuthRequest,
    @Query('limit') limitRaw?: string
  ) {
    const companyId = this.requireCompanyId(req);
    const limit = Number.parseInt(String(limitRaw ?? '').trim(), 10);
    return this.databaseMaintenanceService.listOnlineBackups(
      companyId,
      Number.isFinite(limit) ? limit : undefined
    );
  }

  @Post('backups')
  async createBackup(
    @Req() req: AuthRequest,
    @Body() body?: { label?: string; retentionMonths?: number | string }
  ) {
    const companyId = this.requireCompanyId(req);
    const result = await this.databaseMaintenanceService.createOnlineBackup(
      companyId,
      req.user?.sub ?? null,
      body?.label,
      body?.retentionMonths
    );
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'DATABASE_BACKUP_ONLINE_CREATE',
      entity: 'TenantDatabaseBackup',
      entityId: result.id,
      metadata: {
        label: result.label ?? null,
        retention_months: result.retentionMonths,
        expires_at: result.expiresAt,
        row_count: result.rowCount,
        table_count: result.tableCount,
        created_at: result.createdAt,
        datastore_mode: result.datastoreMode
      }
    });
    return result;
  }

  // Legacy alias kept for backward compatibility with older web builds.
  @Get('backup')
  async backupAlias(@Req() req: AuthRequest) {
    return this.createBackup(req, {});
  }

  @Delete('backups/:backupId')
  async deleteBackup(
    @Req() req: AuthRequest,
    @Param('backupId') backupIdRaw: string
  ) {
    const companyId = this.requireCompanyId(req);
    const backupId = String(backupIdRaw ?? '').trim();
    if (!backupId) {
      throw new BadRequestException('Backup id is required.');
    }

    try {
      const deleted = await this.databaseMaintenanceService.deleteOnlineBackup(companyId, backupId);
      await this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'DATABASE_BACKUP_ONLINE_DELETE',
        entity: 'TenantDatabaseBackup',
        entityId: deleted.id,
        metadata: {
          label: deleted.label ?? null,
          retention_months: deleted.retentionMonths,
          expires_at: deleted.expiresAt,
          deleted_at: new Date().toISOString(),
          row_count: deleted.rowCount,
          table_count: deleted.tableCount,
          datastore_mode: deleted.datastoreMode
        },
        level: AuditActionLevel.WARNING
      });
      return {
        deleted: true,
        backup: deleted
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not delete online backup.';
      await this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'DATABASE_BACKUP_ONLINE_DELETE_FAILED',
        entity: 'TenantDatabaseBackup',
        entityId: backupId,
        metadata: {
          error: message
        },
        level: AuditActionLevel.CRITICAL
      });
      throw error;
    }
  }

  @Post('restore')
  async restore(
    @Req() req: AuthRequest,
    @Body() body: { backupId?: string; payload?: unknown; confirmation?: string }
  ) {
    const companyId = this.requireCompanyId(req);
    const confirmation = String(body?.confirmation ?? '').trim().toUpperCase();
    if (confirmation !== 'RESTORE') {
      throw new BadRequestException('Confirmation value must be RESTORE.');
    }
    try {
      if (body?.backupId?.trim()) {
        const onlineRestore = await this.databaseMaintenanceService.restoreOnlineBackup(
          companyId,
          body.backupId.trim()
        );
        await this.auditService.record({
          companyId,
          userId: req.user?.sub ?? null,
          action: 'DATABASE_RESTORE_ONLINE',
          entity: 'TenantDatabaseBackup',
          entityId: onlineRestore.backup.id,
          metadata: {
            label: onlineRestore.backup.label ?? null,
            restored_at: onlineRestore.restore.restoredAt,
            tables_restored: onlineRestore.restore.tablesRestored,
            rows_deleted: onlineRestore.restore.rowsDeleted,
            rows_inserted: onlineRestore.restore.rowsInserted,
            datastore_mode: onlineRestore.restore.datastoreMode
          },
          level: AuditActionLevel.WARNING
        });
        return onlineRestore.restore;
      }

      const result = await this.databaseMaintenanceService.restoreBackup(companyId, body?.payload);
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
        action: body?.backupId?.trim()
          ? 'DATABASE_RESTORE_ONLINE_FAILED'
          : 'DATABASE_RESTORE_IMPORT_FAILED',
        entity: 'TenantDatabaseRestore',
        entityId: `tenant-restore-failed-${companyId}-${Date.now()}`,
        metadata: {
          backup_id: body?.backupId?.trim() || null,
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
