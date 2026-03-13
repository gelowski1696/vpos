import { IsArray, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class OutboxItemDto {
  @IsString()
  id!: string;

  @IsString()
  entity!: string;

  @IsString()
  action!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  idempotency_key!: string;

  @IsISO8601()
  created_at!: string;
}

export class SyncPushDto {
  @IsString()
  device_id!: string;

  @IsOptional()
  @IsString()
  last_pull_token?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutboxItemDto)
  outbox_items!: OutboxItemDto[];
}
