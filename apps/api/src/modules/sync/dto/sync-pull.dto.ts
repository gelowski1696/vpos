import { IsOptional, IsString } from 'class-validator';

export class SyncPullQueryDto {
  @IsOptional()
  @IsString()
  since?: string;

  @IsString()
  device_id!: string;
}
