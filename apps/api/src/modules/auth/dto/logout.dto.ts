import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @IsOptional()
  @IsString()
  refresh_token?: string;
}
