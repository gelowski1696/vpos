import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TenancyDatastoreMode, type Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

type TableMetadata = {
  tableName: string;
  columns: string[];
  primaryKeyColumn: string | null;
  hasCompanyId: boolean;
};

type ForeignKeyMetadata = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
};

type BackupTablePayload = {
  tableName: string;
  primaryKeyColumn: string | null;
  rowCount: number;
  rows: Array<Record<string, unknown>>;
};

export type TenantDatabaseBackupPayload = {
  format: 'VPOS_TENANT_DB_BACKUP_V1';
  createdAt: string;
  companyId: string;
  companyCode: string | null;
  companyName: string | null;
  datastoreMode: TenancyDatastoreMode;
  tables: BackupTablePayload[];
  summary: {
    tableCount: number;
    rowCount: number;
  };
};

export type TenantDatabaseBackupResult = {
  backupId: string;
  fileName: string;
  payload: TenantDatabaseBackupPayload;
};

export type TenantDatabaseBackupSummary = {
  id: string;
  label: string | null;
  createdAt: string;
  retentionMonths: 1 | 3 | 6;
  expiresAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  rowCount: number;
  tableCount: number;
  companyCode: string | null;
  companyName: string | null;
  datastoreMode: TenancyDatastoreMode;
};

export type TenantDatabaseRestoreResult = {
  restoredAt: string;
  companyId: string;
  tablesRestored: number;
  rowsDeleted: number;
  rowsInserted: number;
  datastoreMode: TenancyDatastoreMode;
};

type TableRowMap = Map<string, Record<string, unknown>>;
type RowsByTable = Map<string, TableRowMap>;

const SYSTEM_TABLES = new Set(['_prisma_migrations']);
const BACKUP_EXCLUDED_TABLES = new Set(['TenantDatabaseBackup']);
const BACKUP_RETENTION_OPTIONS = [1, 3, 6] as const;
const DEFAULT_BACKUP_RETENTION_MONTHS: (typeof BACKUP_RETENTION_OPTIONS)[number] = 3;

@Injectable()
export class DatabaseMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantRouter: TenantDatasourceRouterService
  ) {}

  async createBackup(companyId: string): Promise<TenantDatabaseBackupResult> {
    const binding = await this.tenantRouter.forCompany(companyId);
    const metadata = (await this.loadTableMetadata(binding.client)).filter(
      (table) => !BACKUP_EXCLUDED_TABLES.has(table.tableName)
    );
    const foreignKeys = (await this.loadForeignKeys(binding.client)).filter(
      (fk) =>
        !BACKUP_EXCLUDED_TABLES.has(fk.childTable) &&
        !BACKUP_EXCLUDED_TABLES.has(fk.parentTable)
    );
    const rowsByTable = await this.collectTenantRows(binding.client, companyId, metadata, foreignKeys);

    const companyRow = rowsByTable.get('Company')?.values().next().value ?? null;
    const companyCode =
      companyRow && typeof companyRow.code === 'string' ? companyRow.code.trim() || null : null;
    const companyName =
      companyRow && typeof companyRow.name === 'string' ? companyRow.name.trim() || null : null;

    const tables = metadata
      .map((tableMeta) => {
        const rows = [...(rowsByTable.get(tableMeta.tableName)?.values() ?? [])];
        return {
          tableName: tableMeta.tableName,
          primaryKeyColumn: tableMeta.primaryKeyColumn,
          rowCount: rows.length,
          rows
        } satisfies BackupTablePayload;
      });

    const rowCount = tables.reduce((sum, table) => sum + table.rowCount, 0);
    const createdAt = new Date().toISOString();
    const backupId = `tenant-backup-${companyId}-${Date.now()}`;
    const safeCompanyCode = this.toFileToken(companyCode ?? companyId);
    const fileName = `vpos-backup-${safeCompanyCode}-${this.toFileTimestamp(createdAt)}.json`;

    return {
      backupId,
      fileName,
      payload: {
        format: 'VPOS_TENANT_DB_BACKUP_V1',
        createdAt,
        companyId,
        companyCode,
        companyName,
        datastoreMode: binding.mode,
        tables,
        summary: {
          tableCount: tables.length,
          rowCount
        }
      }
    };
  }

  async createOnlineBackup(
    companyId: string,
    userId: string | null,
    label?: string | null,
    retentionMonthsRaw?: number | string | null
  ): Promise<TenantDatabaseBackupSummary> {
    const retentionMonths = this.resolveRetentionMonths(retentionMonthsRaw);
    const expiresAt = this.computeBackupExpiry(retentionMonths);
    const backup = await this.createBackup(companyId);
    const saved = await this.prisma.tenantDatabaseBackup.create({
      data: {
        companyId,
        createdByUserId: userId,
        label: this.normalizeBackupLabel(label),
        retentionMonths,
        expiresAt,
        tableCount: backup.payload.summary.tableCount,
        rowCount: backup.payload.summary.rowCount,
        payload: this.serializeBackupPayloadForStorage(backup.payload)
      },
      include: {
        createdBy: {
          select: { fullName: true }
        }
      }
    });

    await this.cleanupExpiredBackups(companyId);
    return this.mapBackupSummary(saved, backup.payload);
  }

  async listOnlineBackups(
    companyId: string,
    limitRaw?: number
  ): Promise<TenantDatabaseBackupSummary[]> {
    await this.cleanupExpiredBackups(companyId);
    const limit = this.resolveOnlineBackupLimit(limitRaw);
    const rows = await this.prisma.tenantDatabaseBackup.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: {
          select: { fullName: true }
        }
      }
    });

    return rows.map((row) => {
      const payload = this.normalizeBackupPayload(row.payload);
      return this.mapBackupSummary(row, payload);
    });
  }

  async restoreOnlineBackup(
    companyId: string,
    backupId: string
  ): Promise<{ backup: TenantDatabaseBackupSummary; restore: TenantDatabaseRestoreResult }> {
    await this.cleanupExpiredBackups(companyId);
    const row = await this.prisma.tenantDatabaseBackup.findFirst({
      where: {
        id: backupId,
        companyId
      },
      include: {
        createdBy: {
          select: { fullName: true }
        }
      }
    });
    if (!row) {
      throw new BadRequestException('Selected online backup was not found for this tenant.');
    }

    const payload = this.normalizeBackupPayload(row.payload);
    const restore = await this.restoreBackup(companyId, payload);
    return {
      backup: this.mapBackupSummary(row, payload),
      restore
    };
  }

  async deleteOnlineBackup(
    companyId: string,
    backupId: string
  ): Promise<TenantDatabaseBackupSummary> {
    await this.cleanupExpiredBackups(companyId);
    const row = await this.prisma.tenantDatabaseBackup.findFirst({
      where: {
        id: backupId,
        companyId
      },
      include: {
        createdBy: {
          select: { fullName: true }
        }
      }
    });
    if (!row) {
      throw new BadRequestException('Selected online backup was not found for this tenant.');
    }

    const payload = this.normalizeBackupPayload(row.payload);
    await this.prisma.tenantDatabaseBackup.deleteMany({
      where: {
        companyId,
        id: backupId
      }
    });
    return this.mapBackupSummary(row, payload);
  }

  async restoreBackup(
    companyId: string,
    payload: unknown
  ): Promise<TenantDatabaseRestoreResult> {
    const normalized = this.normalizeBackupPayload(payload);
    if (normalized.companyId !== companyId) {
      throw new BadRequestException(
        `Backup companyId (${normalized.companyId}) does not match the signed-in tenant (${companyId}).`
      );
    }

    const binding = await this.tenantRouter.forCompany(companyId);
    const metadata = await this.loadTableMetadata(binding.client);
    const metadataByName = new Map(metadata.map((entry) => [entry.tableName, entry]));
    const foreignKeys = await this.loadForeignKeys(binding.client);
    const selfForeignKeysByTable = this.buildSelfForeignKeyMap(foreignKeys);

    const backupRowsByTable = this.normalizeBackupTables(normalized.tables, metadataByName);
    const backupTableNames = [...backupRowsByTable.keys()];
    if (backupTableNames.length === 0) {
      throw new BadRequestException('Backup payload has no restorable table rows.');
    }

    const existingRowsByTable = await this.collectTenantRows(
      binding.client,
      companyId,
      metadata,
      foreignKeys
    );
    const restoreOrder = this.topologicalTableOrder(
      backupTableNames,
      foreignKeys
    );
    const deleteOrder = [...restoreOrder].reverse();

    const rowsDeleted = await this.deleteExistingRows(
      binding.client,
      deleteOrder,
      existingRowsByTable,
      metadataByName
    );

    let rowsInserted = 0;
    for (const tableName of restoreOrder) {
      const tableMeta = metadataByName.get(tableName);
      if (!tableMeta || !tableMeta.primaryKeyColumn) {
        continue;
      }
      const tableRows = backupRowsByTable.get(tableName) ?? new Map();
      if (tableRows.size === 0) {
        continue;
      }

      if (tableName === 'Company') {
        rowsInserted += await this.restoreCompanyRow(
          binding.client,
          companyId,
          tableMeta,
          [...tableRows.values()][0] ?? null
        );
        continue;
      }

      const selfForeignKeys = selfForeignKeysByTable.get(tableName) ?? [];
      const rows = [...tableRows.values()];
      if (tableMeta.columns.includes('createdAt')) {
        rows.sort((a, b) =>
          String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
        );
      }

      for (const row of rows) {
        const prepared = this.prepareInsertRow(row, selfForeignKeys);
        await this.insertRow(binding.client, tableName, prepared);
        rowsInserted += 1;
      }

      if (selfForeignKeys.length > 0) {
        for (const row of rows) {
          await this.applySelfForeignKeyUpdates(
            binding.client,
            tableName,
            tableMeta.primaryKeyColumn,
            row,
            selfForeignKeys
          );
        }
      }
    }

    return {
      restoredAt: new Date().toISOString(),
      companyId,
      tablesRestored: backupTableNames.length,
      rowsDeleted,
      rowsInserted,
      datastoreMode: binding.mode
    };
  }

  private normalizeBackupPayload(payload: unknown): TenantDatabaseBackupPayload {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Backup payload is required.');
    }
    const record = payload as Record<string, unknown>;
    if (record.format !== 'VPOS_TENANT_DB_BACKUP_V1') {
      throw new BadRequestException('Unsupported backup format.');
    }
    const companyId = String(record.companyId ?? '').trim();
    if (!companyId) {
      throw new BadRequestException('Backup payload is missing companyId.');
    }
    const tablesRaw = Array.isArray(record.tables) ? record.tables : [];
    if (tablesRaw.length === 0) {
      throw new BadRequestException('Backup payload has no table rows.');
    }
    return {
      format: 'VPOS_TENANT_DB_BACKUP_V1',
      createdAt: String(record.createdAt ?? ''),
      companyId,
      companyCode:
        typeof record.companyCode === 'string' && record.companyCode.trim()
          ? record.companyCode.trim()
          : null,
      companyName:
        typeof record.companyName === 'string' && record.companyName.trim()
          ? record.companyName.trim()
          : null,
      datastoreMode:
        record.datastoreMode === TenancyDatastoreMode.DEDICATED_DB
          ? TenancyDatastoreMode.DEDICATED_DB
          : TenancyDatastoreMode.SHARED_DB,
      tables: tablesRaw.map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return {
          tableName: String(row.tableName ?? ''),
          primaryKeyColumn:
            typeof row.primaryKeyColumn === 'string' && row.primaryKeyColumn.trim()
              ? row.primaryKeyColumn.trim()
              : null,
          rowCount: Number(row.rowCount ?? 0),
          rows: Array.isArray(row.rows)
            ? row.rows.filter(
                (item): item is Record<string, unknown> =>
                  Boolean(item) && typeof item === 'object' && !Array.isArray(item)
              )
            : []
        };
      }),
      summary: {
        tableCount: Number((record.summary as Record<string, unknown> | undefined)?.tableCount ?? 0),
        rowCount: Number((record.summary as Record<string, unknown> | undefined)?.rowCount ?? 0)
      }
    };
  }

  private normalizeBackupTables(
    tables: BackupTablePayload[],
    metadataByName: Map<string, TableMetadata>
  ): RowsByTable {
    const rowsByTable: RowsByTable = new Map();
    for (const table of tables) {
      const tableName = String(table.tableName ?? '').trim();
      if (!tableName) {
        continue;
      }
      if (BACKUP_EXCLUDED_TABLES.has(tableName)) {
        continue;
      }
      const tableMeta = metadataByName.get(tableName);
      if (!tableMeta) {
        throw new BadRequestException(`Backup references unknown table "${tableName}".`);
      }
      if (!tableMeta.primaryKeyColumn) {
        throw new BadRequestException(
          `Table "${tableName}" does not expose a single-column primary key and cannot be restored safely.`
        );
      }
      const rowMap: TableRowMap = new Map();
      for (const row of table.rows ?? []) {
        const key = this.readPrimaryKeyValue(row, tableMeta.primaryKeyColumn);
        if (!key) {
          throw new BadRequestException(
            `Table "${tableName}" has a row without primary key "${tableMeta.primaryKeyColumn}".`
          );
        }
        rowMap.set(key, row);
      }
      rowsByTable.set(tableName, rowMap);
    }
    return rowsByTable;
  }

  private async deleteExistingRows(
    client: PrismaClient,
    deleteOrder: string[],
    existingRowsByTable: RowsByTable,
    metadataByName: Map<string, TableMetadata>
  ): Promise<number> {
    let deleted = 0;
    for (const tableName of deleteOrder) {
      if (tableName === 'Company') {
        continue;
      }
      const tableMeta = metadataByName.get(tableName);
      if (!tableMeta?.primaryKeyColumn) {
        continue;
      }
      const existingRows = existingRowsByTable.get(tableName);
      if (!existingRows || existingRows.size === 0) {
        continue;
      }
      const ids = [...existingRows.keys()];
      for (const batch of this.chunk(ids, 150)) {
        if (batch.length === 0) {
          continue;
        }
        const placeholders = batch.map((_, index) => `$${index + 1}`).join(', ');
        const sql = `DELETE FROM ${this.quoteIdentifier(tableName)} WHERE ${this.quoteIdentifier(tableMeta.primaryKeyColumn)} IN (${placeholders})`;
        deleted += await client.$executeRawUnsafe(sql, ...batch);
      }
    }
    return deleted;
  }

  private async restoreCompanyRow(
    client: PrismaClient,
    companyId: string,
    meta: TableMetadata,
    row: Record<string, unknown> | null
  ): Promise<number> {
    if (!row) {
      return 0;
    }
    const columns = meta.columns.filter((column) => column !== 'id' && Object.prototype.hasOwnProperty.call(row, column));
    if (columns.length === 0) {
      return 0;
    }
    const assignments = columns
      .map((column, index) => `${this.quoteIdentifier(column)} = $${index + 1}`)
      .join(', ');
    const values = columns.map((column) => row[column]);
    const updateSql = `UPDATE ${this.quoteIdentifier('Company')} SET ${assignments} WHERE ${this.quoteIdentifier('id')} = $${columns.length + 1}`;
    const updated = await client.$executeRawUnsafe(updateSql, ...values, companyId);
    if (updated > 0) {
      return 1;
    }
    const insertColumns = ['id', ...columns];
    const insertValues = [companyId, ...values];
    const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(', ');
    const insertSql = `INSERT INTO ${this.quoteIdentifier('Company')} (${insertColumns
      .map((column) => this.quoteIdentifier(column))
      .join(', ')}) VALUES (${placeholders})`;
    await client.$executeRawUnsafe(insertSql, ...insertValues);
    return 1;
  }

  private prepareInsertRow(
    row: Record<string, unknown>,
    selfForeignKeys: ForeignKeyMetadata[]
  ): Record<string, unknown> {
    if (selfForeignKeys.length === 0) {
      return row;
    }
    const copy: Record<string, unknown> = { ...row };
    for (const fk of selfForeignKeys) {
      copy[fk.childColumn] = null;
    }
    return copy;
  }

  private async applySelfForeignKeyUpdates(
    client: PrismaClient,
    tableName: string,
    primaryKeyColumn: string,
    row: Record<string, unknown>,
    selfForeignKeys: ForeignKeyMetadata[]
  ): Promise<void> {
    const pkValue = this.readPrimaryKeyValue(row, primaryKeyColumn);
    if (!pkValue) {
      return;
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const fk of selfForeignKeys) {
      if (!Object.prototype.hasOwnProperty.call(row, fk.childColumn)) {
        continue;
      }
      updates.push(`${this.quoteIdentifier(fk.childColumn)} = $${updates.length + 1}`);
      values.push(row[fk.childColumn] ?? null);
    }
    if (updates.length === 0) {
      return;
    }
    const sql = `UPDATE ${this.quoteIdentifier(tableName)} SET ${updates.join(', ')} WHERE ${this.quoteIdentifier(primaryKeyColumn)} = $${updates.length + 1}`;
    await client.$executeRawUnsafe(sql, ...values, pkValue);
  }

  private async insertRow(
    client: PrismaClient,
    tableName: string,
    row: Record<string, unknown>
  ): Promise<void> {
    const columns = Object.keys(row);
    if (columns.length === 0) {
      return;
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const sql = `INSERT INTO ${this.quoteIdentifier(tableName)} (${columns
      .map((column) => this.quoteIdentifier(column))
      .join(', ')}) VALUES (${placeholders})`;
    const values = columns.map((column) => row[column]);
    await client.$executeRawUnsafe(sql, ...values);
  }

  private buildSelfForeignKeyMap(
    foreignKeys: ForeignKeyMetadata[]
  ): Map<string, ForeignKeyMetadata[]> {
    const byTable = new Map<string, ForeignKeyMetadata[]>();
    for (const fk of foreignKeys) {
      if (fk.childTable !== fk.parentTable) {
        continue;
      }
      byTable.set(fk.childTable, [...(byTable.get(fk.childTable) ?? []), fk]);
    }
    return byTable;
  }

  private async collectTenantRows(
    client: PrismaClient,
    companyId: string,
    metadata: TableMetadata[],
    foreignKeys: ForeignKeyMetadata[]
  ): Promise<RowsByTable> {
    const rowsByTable: RowsByTable = new Map();
    const metadataByName = new Map(metadata.map((table) => [table.tableName, table]));

    for (const tableMeta of metadata) {
      if (!tableMeta.hasCompanyId || !tableMeta.primaryKeyColumn) {
        continue;
      }
      const sql = `SELECT * FROM ${this.quoteIdentifier(tableMeta.tableName)} WHERE ${this.quoteIdentifier('companyId')} = $1`;
      const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, companyId);
      this.addRowsToMap(rowsByTable, tableMeta, rows);
    }

    const companyMeta = metadataByName.get('Company');
    if (companyMeta?.primaryKeyColumn) {
      const sql = `SELECT * FROM ${this.quoteIdentifier('Company')} WHERE ${this.quoteIdentifier('id')} = $1`;
      const companyRows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, companyId);
      this.addRowsToMap(rowsByTable, companyMeta, companyRows);
    }

    const foreignKeysByParent = this.groupForeignKeysByParent(foreignKeys);
    const queue = [...rowsByTable.keys()];
    const queued = new Set(queue);

    while (queue.length > 0) {
      const parentTable = queue.shift() ?? '';
      queued.delete(parentTable);
      const parentMeta = metadataByName.get(parentTable);
      if (!parentMeta?.primaryKeyColumn) {
        continue;
      }
      const parentRows = rowsByTable.get(parentTable);
      if (!parentRows || parentRows.size === 0) {
        continue;
      }
      const parentIds = [...parentRows.keys()];
      const childRelations = foreignKeysByParent.get(parentTable) ?? [];
      for (const relation of childRelations) {
        const childMeta = metadataByName.get(relation.childTable);
        if (!childMeta?.primaryKeyColumn) {
          continue;
        }
        const childRows = await this.fetchRowsByForeignKey(
          client,
          childMeta.tableName,
          relation.childColumn,
          parentIds
        );
        const added = this.addRowsToMap(rowsByTable, childMeta, childRows);
        if (added > 0 && !queued.has(childMeta.tableName)) {
          queue.push(childMeta.tableName);
          queued.add(childMeta.tableName);
        }
      }
    }

    return rowsByTable;
  }

  private async fetchRowsByForeignKey(
    client: PrismaClient,
    tableName: string,
    columnName: string,
    values: string[]
  ): Promise<Array<Record<string, unknown>>> {
    if (values.length === 0) {
      return [];
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const batch of this.chunk(values, 180)) {
      const placeholders = batch.map((_, index) => `$${index + 1}`).join(', ');
      const sql = `SELECT * FROM ${this.quoteIdentifier(tableName)} WHERE ${this.quoteIdentifier(columnName)} IN (${placeholders})`;
      const batchRows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...batch);
      rows.push(...batchRows);
    }
    return rows;
  }

  private addRowsToMap(
    rowsByTable: RowsByTable,
    tableMeta: TableMetadata,
    rows: Array<Record<string, unknown>>
  ): number {
    if (!tableMeta.primaryKeyColumn || rows.length === 0) {
      return 0;
    }
    const tableRows = rowsByTable.get(tableMeta.tableName) ?? new Map<string, Record<string, unknown>>();
    let added = 0;
    for (const row of rows) {
      const key = this.readPrimaryKeyValue(row, tableMeta.primaryKeyColumn);
      if (!key || tableRows.has(key)) {
        continue;
      }
      tableRows.set(key, row);
      added += 1;
    }
    if (tableRows.size > 0) {
      rowsByTable.set(tableMeta.tableName, tableRows);
    }
    return added;
  }

  private readPrimaryKeyValue(
    row: Record<string, unknown>,
    primaryKeyColumn: string
  ): string | null {
    const raw = row[primaryKeyColumn];
    if (raw === null || raw === undefined) {
      return null;
    }
    const value = String(raw).trim();
    return value.length > 0 ? value : null;
  }

  private topologicalTableOrder(
    tableNames: string[],
    foreignKeys: ForeignKeyMetadata[]
  ): string[] {
    const selected = new Set(tableNames);
    const indegree = new Map<string, number>(tableNames.map((table) => [table, 0]));
    const childrenByParent = new Map<string, Set<string>>();

    for (const fk of foreignKeys) {
      if (!selected.has(fk.childTable) || !selected.has(fk.parentTable)) {
        continue;
      }
      if (fk.childTable === fk.parentTable) {
        continue;
      }
      childrenByParent.set(
        fk.parentTable,
        new Set([...(childrenByParent.get(fk.parentTable) ?? new Set<string>()), fk.childTable])
      );
      indegree.set(fk.childTable, (indegree.get(fk.childTable) ?? 0) + 1);
    }

    const queue = [...tableNames]
      .filter((table) => (indegree.get(table) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
    const ordered: string[] = [];

    while (queue.length > 0) {
      const next = queue.shift() ?? '';
      ordered.push(next);
      const children = [...(childrenByParent.get(next) ?? new Set())].sort((a, b) =>
        a.localeCompare(b)
      );
      for (const child of children) {
        const remaining = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, remaining);
        if (remaining === 0) {
          queue.push(child);
        }
      }
      queue.sort((a, b) => a.localeCompare(b));
    }

    if (ordered.length === tableNames.length) {
      return ordered;
    }
    const leftovers = tableNames.filter((table) => !ordered.includes(table)).sort((a, b) =>
      a.localeCompare(b)
    );
    return [...ordered, ...leftovers];
  }

  private groupForeignKeysByParent(
    foreignKeys: ForeignKeyMetadata[]
  ): Map<string, ForeignKeyMetadata[]> {
    const map = new Map<string, ForeignKeyMetadata[]>();
    for (const fk of foreignKeys) {
      map.set(fk.parentTable, [...(map.get(fk.parentTable) ?? []), fk]);
    }
    return map;
  }

  private async loadTableMetadata(client: PrismaClient): Promise<TableMetadata[]> {
    const tableRows = await client.$queryRawUnsafe<Array<{ tableName: string }>>(
      `
        SELECT t.table_name AS "tableName"
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `
    );
    const columnRows = await client.$queryRawUnsafe<
      Array<{ tableName: string; columnName: string }>
    >(
      `
        SELECT c.table_name AS "tableName", c.column_name AS "columnName"
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
        ORDER BY c.table_name, c.ordinal_position
      `
    );
    const primaryKeyRows = await client.$queryRawUnsafe<
      Array<{ tableName: string; columnName: string; ordinalPosition: number }>
    >(
      `
        SELECT
          tc.table_name AS "tableName",
          kcu.column_name AS "columnName",
          kcu.ordinal_position AS "ordinalPosition"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY tc.table_name, kcu.ordinal_position
      `
    );

    const columnsByTable = new Map<string, string[]>();
    for (const row of columnRows) {
      if (SYSTEM_TABLES.has(row.tableName)) {
        continue;
      }
      columnsByTable.set(row.tableName, [...(columnsByTable.get(row.tableName) ?? []), row.columnName]);
    }

    const primaryByTable = new Map<string, string[]>();
    for (const row of primaryKeyRows) {
      if (SYSTEM_TABLES.has(row.tableName)) {
        continue;
      }
      primaryByTable.set(row.tableName, [...(primaryByTable.get(row.tableName) ?? []), row.columnName]);
    }

    const metadata = tableRows
      .filter((row) => !SYSTEM_TABLES.has(row.tableName))
      .map((row) => {
        const columns = columnsByTable.get(row.tableName) ?? [];
        const pkColumns = primaryByTable.get(row.tableName) ?? [];
        return {
          tableName: row.tableName,
          columns,
          primaryKeyColumn: pkColumns.length === 1 ? pkColumns[0] : null,
          hasCompanyId: columns.includes('companyId')
        } satisfies TableMetadata;
      })
      .filter((row) => row.columns.length > 0)
      .sort((a, b) => a.tableName.localeCompare(b.tableName));

    if (metadata.length === 0) {
      throw new ServiceUnavailableException('No tenant tables were discovered for backup.');
    }
    return metadata;
  }

  private async loadForeignKeys(client: PrismaClient): Promise<ForeignKeyMetadata[]> {
    const rows = await client.$queryRawUnsafe<
      Array<{
        childTable: string;
        childColumn: string;
        parentTable: string;
        parentColumn: string;
      }>
    >(
      `
        SELECT
          tc.table_name AS "childTable",
          kcu.column_name AS "childColumn",
          ccu.table_name AS "parentTable",
          ccu.column_name AS "parentColumn"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
      `
    );

    return rows
      .filter((row) => !SYSTEM_TABLES.has(row.childTable) && !SYSTEM_TABLES.has(row.parentTable))
      .map((row) => ({
        childTable: row.childTable,
        childColumn: row.childColumn,
        parentTable: row.parentTable,
        parentColumn: row.parentColumn
      }));
  }

  private async cleanupExpiredBackups(companyId: string): Promise<void> {
    const now = new Date();
    await this.prisma.tenantDatabaseBackup.deleteMany({
      where: {
        companyId,
        expiresAt: { lte: now }
      }
    });
  }

  private resolveOnlineBackupLimit(limitRaw?: number): number {
    const fallback = this.readEnvInt('VPOS_ONLINE_BACKUP_LIST_LIMIT', 25, 1, 100);
    if (!Number.isFinite(Number(limitRaw))) {
      return fallback;
    }
    const value = Number(limitRaw);
    if (value <= 0) {
      return fallback;
    }
    return Math.min(Math.max(Math.floor(value), 1), 100);
  }

  private readEnvInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
  }

  private normalizeBackupLabel(label?: string | null): string | null {
    const value = String(label ?? '').trim();
    if (!value) {
      return null;
    }
    return value.slice(0, 120);
  }

  private resolveRetentionMonths(valueRaw?: number | string | null): 1 | 3 | 6 {
    const parsed = Number.parseInt(String(valueRaw ?? '').trim(), 10);
    if ((BACKUP_RETENTION_OPTIONS as readonly number[]).includes(parsed)) {
      return parsed as 1 | 3 | 6;
    }
    return DEFAULT_BACKUP_RETENTION_MONTHS;
  }

  private computeBackupExpiry(retentionMonths: 1 | 3 | 6): Date {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + retentionMonths);
    return expiresAt;
  }

  private serializeBackupPayloadForStorage(payload: TenantDatabaseBackupPayload): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  }

  private mapBackupSummary(
    row: {
      id: string;
      label: string | null;
      createdAt: Date;
      retentionMonths: number;
      expiresAt: Date;
      createdByUserId: string | null;
      rowCount: number;
      tableCount: number;
      createdBy?: { fullName: string } | null;
    },
    payload: TenantDatabaseBackupPayload
  ): TenantDatabaseBackupSummary {
    return {
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      retentionMonths: this.resolveRetentionMonths(row.retentionMonths),
      expiresAt: row.expiresAt.toISOString(),
      createdByUserId: row.createdByUserId,
      createdByName: row.createdBy?.fullName ?? null,
      rowCount: row.rowCount,
      tableCount: row.tableCount,
      companyCode: payload.companyCode,
      companyName: payload.companyName,
      datastoreMode: payload.datastoreMode
    };
  }

  private quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private toFileToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  }

  private toFileTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return `backup-${Date.now()}`;
    }
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(
      date.getUTCHours()
    )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }
}
