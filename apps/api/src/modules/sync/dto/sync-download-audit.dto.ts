import { IsISO8601, IsObject, IsOptional, IsString } from 'class-validator';

export class SyncDownloadAuditDto {
  @IsString()
  device_id!: string;

  @IsString()
  branch_id!: string;

  @IsOptional()
  @IsISO8601()
  downloaded_at?: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  counts?: Record<string, unknown>;
}

